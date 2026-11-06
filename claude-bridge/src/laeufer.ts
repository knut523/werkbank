// Läufer-Abstraktion (Konzept J, Entscheidung der Hauptsitzung 06.11.): ein lesender Strang- oder Worker-Zug läuft über einen
// Läufer — jcode (ein Prozess je Auftrag) oder ein opencode-2-Server (Sitzungen über HTTP: /api/session, /prompt, interrupt;
// Test 06.11. in review-pakete/opencode2-test-0611: 20 parallel fehlerfrei, 524 MB statt 2062 MB bei jcode).
// Entschieden (Hauptsitzung 06.11., umkehrbar, Pilot): lesende Aufträge laufen ab ~5 parallelen auf opencode-2-Servern, darunter auf
// jcode. Bedingungen: (1) Wiederaufnahme nach einem Server-Absturz (hier: warten, Sitzung neu anstoßen; den Neustart macht die
// Brücke, oc2server.ts), (2) feste Version 2.2.5 (oc2server.ts prüft), (3) mehrere Server, verteilt (opencode2Pool).
// Schalter: BRIDGE_OPENCODE2=an, BRIDGE_OPENCODE2_PORTS (47811 47812), BRIDGE_OPENCODE2_HOME, BRIDGE_OPENCODE2_AB (5). Rein bis auf fetch.

import { FLASH } from './modellwahl.ts';

export interface LaeuferAuftrag { cwd: string; prompt: string; model: string | null; timeoutS: number; abbruch: () => boolean; titel?: string }
export interface LaeuferNutzung { input: number; output: number; cacheRead: number; cacheWrite: number }
/** code: 0 = sauber zu Ende, sonst Fehler/Abbruch/Zeit; text: Antwort; gelaufen: tatsächliches Modell. */
export interface LaeuferErgebnis { code: number | null; text: string; usage: LaeuferNutzung; gelaufen: string; draussen: string[]; grund?: string }
export interface Laeufer { name: 'jcode' | 'opencode2'; zug(a: LaeuferAuftrag): Promise<LaeuferErgebnis> }

type Env = Record<string, string | undefined>;
export const opencode2An = (env: Env = process.env) => env.BRIDGE_OPENCODE2 === 'an';
/** Ab wie vielen gleichzeitig laufenden lesenden Aufträgen opencode 2 übernimmt (darunter jcode: sparsamer, kein Server nötig). */
export const opencode2Ab = (env: Env = process.env) => { const n = Math.floor(Number(env.BRIDGE_OPENCODE2_AB)); return env.BRIDGE_OPENCODE2_AB !== undefined && Number.isFinite(n) && n >= 0 ? n : 5; };

// Nur lesen: alles verboten, dann read/glob/grep erlaubt (die letzte passende Regel gewinnt) — verbotene Werkzeuge bietet der
// Server dem Modell gar nicht erst an (Test „Schreibverbot“). ponytail: opencode 2 bedient nur lesende Aufträge; schreibende
// bleiben bei jcode (dort prüft die Brücke Schreibzugriffe außerhalb des Ordners über die Sitzungsdatei).
// Phase 4 (Pass A/B): der Melious-Schlüssel steht in der Umgebung des Servers — wie beim jcode-Hook (jcode-pre-tool.ts, GEHEIM)
// danach ausdrücklich verboten: außerhalb des Arbeitsordners lesen, Prozess-Umgebung, Umgebungs- und Zugangsdateien.
// ponytail: Muster wie beim jcode-Hook; ob opencode 2.2.5 jede Pfadform darauf abbildet, belegt erst ein echter Lauf (Bericht).
export const GEHEIM_MUSTER = ['/proc/**', '**/environ', '**/.env', '**/.env.*', '**/.ssh/**', '**/.claude/**', '**/.claude.json', '**/.melious/**', '**/.jcode/**',
  '**/.config/vw/**', '**/.config/gh/**', '**/.aws/**', '**/.netrc', '**/.git-credentials', '**/testkonten*', '**/.local/opencode2/**', '**/.runtime/**'];
export const NUR_LESEN = [
  { action: '*', resource: '*', effect: 'deny' },
  ...['read', 'glob', 'grep'].map((action) => ({ action, resource: '*', effect: 'allow' })),
  { action: 'external_directory', resource: '*', effect: 'deny' },
  ...['read', 'glob', 'grep'].flatMap((action) => GEHEIM_MUSTER.map((resource) => ({ action, resource, effect: 'deny' }))),
];

const leer = (): LaeuferNutzung => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

/** Antworttext aus der Nachrichtenliste (neueste zuerst): die Text-Teile der neuesten Assistenten-Nachricht. */
export function oc2Antwort(nachrichten: any[]): string {
  // Neueste nach Zeitstempel (die API liefert neueste zuerst; ohne Zeitstempel bleibt diese Reihenfolge).
  const mitText = (nachrichten ?? []).filter((m) => m?.type === 'assistant' && Array.isArray(m.content) && m.content.some((c: any) => c?.type === 'text'));
  const a = mitText.reduce<any>((best, m) => (best && Number(best.time?.created ?? 0) >= Number(m.time?.created ?? 0) ? best : m), null);
  return a ? a.content.filter((c: any) => c?.type === 'text').map((c: any) => String(c.text ?? '')).join('\n').trim() : '';
}
/** Nutzung aus den Sitzungsdaten (tokens.input ist frisch, cache.read aus dem Prompt-Cache). */
export function oc2Nutzung(s: any): LaeuferNutzung {
  const t = s?.tokens ?? {};
  return { input: Number(t.input) || 0, output: (Number(t.output) || 0) + (Number(t.reasoning) || 0), cacheRead: Number(t.cache?.read) || 0, cacheWrite: Number(t.cache?.write) || 0 };
}
/** Fertig, wenn der Server einen Ausgang meldet und die Sitzung nach dem letzten „busy“ wieder ruhig ist. */
export const oc2Fertig = (s: any): boolean => !!s?.outcome && Number(s?.time?.idle ?? 0) >= Number(s?.time?.busy ?? 0);
/** Nach einem Server-Neustart bleibt die Sitzung erhalten, läuft aber nicht von selbst weiter (Test 06.11.) — ein neuer Prompt bringt sie zu Ende. */
export const OC2_WEITER = 'Der Server wurde neu gestartet. Mach dort weiter, wo du warst, und liefere das vollständige Ergebnis.';

export function opencode2Laeufer(o: { base: string; passwort: string; fetchFn?: typeof fetch; taktMs?: number; jetzt?: () => number; wiederMs?: number }): Laeufer {
  const f = o.fetchFn ?? fetch, takt = o.taktMs ?? 2000, jetzt = o.jetzt ?? Date.now, wiederMs = o.wiederMs ?? 120_000;
  const auth = `Basic ${Buffer.from(`opencode:${o.passwort}`).toString('base64')}`;
  const call = async (method: string, pfad: string, body?: unknown) => {
    const r = await f(o.base.replace(/\/$/, '') + pfad, { method, headers: { authorization: auth, 'content-type': 'application/json' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`opencode2 ${method} ${pfad.replace(/ses_[\w]+/, 'ses_…')}: HTTP ${r.status}`);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  };
  return {
    name: 'opencode2',
    async zug(a) {
      const modell = a.model ?? FLASH;
      let sid: string | null = null;
      const fehler = (s: any, grund: string): LaeuferErgebnis => ({ code: -1, text: '', usage: oc2Nutzung(s), gelaufen: modell, draussen: [], grund });
      try {
        sid = String((await call('POST', '/api/session', { title: a.titel ?? 'werkbank', location: { directory: a.cwd }, model: { providerID: 'melious', id: modell }, permissions: NUR_LESEN }))?.data?.id ?? '');
        if (!sid) return fehler(null, 'keine Sitzung');
        await call('POST', `/api/session/${sid}/prompt`, { text: a.prompt });
        const ende = jetzt() + a.timeoutS * 1000;
        let s: any = null, wegSeit: number | null = null, angestossen = false;
        for (;;) {
          await new Promise((r) => setTimeout(r, takt));
          if (a.abbruch() || jetzt() > ende) {
            await call('POST', `/api/session/${sid}/interrupt`).catch(() => null);
            return fehler(s, a.abbruch() ? 'abgebrochen' : `Zeit (${a.timeoutS} s)`);
          }
          let neu: any;
          try { neu = (await call('GET', `/api/session/${sid}`))?.data; }
          catch (e: any) {
            // Sitzung weg (404) → verloren; Server nicht erreichbar → auf den Neustart (Wächter) warten, höchstens wiederMs.
            if (/HTTP 404/.test(String(e?.message))) return fehler(s, 'Sitzung nach Server-Neustart verloren');
            if (wegSeit === null) angestossen = false;   // Pass C (S1): jeder neue Ausfall wird nach dem Neustart wieder angestoßen
            wegSeit ??= jetzt();
            if (jetzt() - wegSeit > wiederMs) return fehler(s, `Server antwortet nicht mehr (${Math.round(wiederMs / 1000)} s)`);
            continue;
          }
          s = neu;
          // Bedingung 1: nach einem Ausfall läuft die Sitzung nicht von selbst weiter — einmal neu anstoßen.
          // Gegenprüfung 06.11.: schlägt das Anstoßen direkt nach dem Neustart fehl, im nächsten Takt erneut (nicht den Lauf abbrechen).
          if (wegSeit !== null && !s?.outcome && !angestossen) {
            angestossen = await call('POST', `/api/session/${sid}/prompt`, { text: OC2_WEITER }).then(() => true, () => false);
            if (!angestossen) continue;
          }
          wegSeit = null;
          if (oc2Fertig(s)) break;
        }
        const text = oc2Antwort((await call('GET', `/api/session/${sid}/message?limit=200`))?.data ?? []);
        const gelaufen = String(s?.model?.id ?? modell);
        return s.outcome === 'succeeded' ? { code: 0, text, usage: oc2Nutzung(s), gelaufen, draussen: [] } : { code: 1, text, usage: oc2Nutzung(s), gelaufen, draussen: [], grund: `Ausgang ${s.outcome}` };
      } catch (e: any) {
        return { code: -1, text: '', usage: leer(), gelaufen: modell, draussen: [], grund: String(e?.message ?? e).slice(0, 200) };
      }
    },
  };
}

/** Mehrere Server, verteilt (Bedingung 3): jeder Lauf geht an den Server mit den wenigsten aktiven Sitzungen. */
export function opencode2Pool(o: { urls: string[]; passwort: string; fetchFn?: typeof fetch; taktMs?: number; jetzt?: () => number; wiederMs?: number }): Laeufer & { aktiv: () => Record<string, number> } {
  const aktiv = new Map(o.urls.map((u) => [u, 0]));
  const einzeln = new Map(o.urls.map((u) => [u, opencode2Laeufer({ ...o, base: u })]));
  // Gegenprüfung 06.11.: ein nicht erreichbarer Server pausiert 60 s, statt weiter jeden zweiten Lauf zu bekommen.
  const pause = new Map<string, number>(), jetzt = o.jetzt ?? Date.now;
  const NICHT_DA = /antwortet nicht|fetch failed|ECONNREFUSED|ECONNRESET|socket/i;
  return {
    name: 'opencode2',
    aktiv: () => Object.fromEntries(aktiv),
    async zug(a) {
      const frei = [...aktiv.entries()].filter(([u]) => (pause.get(u) ?? 0) <= jetzt());
      const url = (frei.length ? frei : [...aktiv.entries()]).sort((x, y) => x[1] - y[1])[0]?.[0];
      if (!url) return { code: -1, text: '', usage: leer(), gelaufen: a.model ?? '', draussen: [], grund: 'kein opencode-2-Server eingetragen' };
      aktiv.set(url, aktiv.get(url)! + 1);
      try {
        const r = await einzeln.get(url)!.zug(a);
        if (r.code !== 0 && NICHT_DA.test(String(r.grund))) pause.set(url, jetzt() + 60_000);
        return r.grund ? { ...r, grund: `${r.grund} (Server ${url})` } : r;
      } finally { aktiv.set(url, aktiv.get(url)! - 1); }
    },
  };
}
