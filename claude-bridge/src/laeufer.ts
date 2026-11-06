// Läufer-Abstraktion (Konzept J, Entscheidung der Hauptsitzung 06.11.): ein lesender Strang- oder Worker-Zug läuft über einen
// Läufer — jcode (ein Prozess je Auftrag) oder ein opencode-2-Server (Sitzungen über HTTP: /api/session, /prompt, interrupt;
// Test 06.11. in review-pakete/opencode2-test-0611: 20 parallel fehlerfrei, 524 MB statt 2062 MB bei jcode).
// Entschieden (Hauptsitzung 06.11., umkehrbar, Pilot): lesende Aufträge laufen ab ~5 parallelen auf opencode-2-Servern, darunter auf
// jcode. Bedingungen: (1) Wiederaufnahme nach einem Server-Absturz (hier: warten, Sitzung neu anstoßen; Neustart macht
// scripts/opencode2-waechter.sh), (2) feste Version 2.2.5 (Wächter prüft), (3) mehrere Server, verteilt (opencode2Pool).
// Schalter: BRIDGE_OPENCODE2=an, BRIDGE_OPENCODE2_URLS (kommagetrennt), BRIDGE_OPENCODE2_PW_DATEI, BRIDGE_OPENCODE2_AB (5). Rein bis auf fetch.

export interface LaeuferAuftrag { cwd: string; prompt: string; model: string | null; timeoutS: number; abbruch: () => boolean; titel?: string }
export interface LaeuferNutzung { input: number; output: number; cacheRead: number; cacheWrite: number }
/** code: 0 = sauber zu Ende, sonst Fehler/Abbruch/Zeit; text: Antwort; gelaufen: tatsächliches Modell. */
export interface LaeuferErgebnis { code: number | null; text: string; usage: LaeuferNutzung; gelaufen: string; draussen: string[]; grund?: string }
export interface Laeufer { name: 'jcode' | 'opencode2'; zug(a: LaeuferAuftrag): Promise<LaeuferErgebnis> }

type Env = Record<string, string | undefined>;
export const opencode2An = (env: Env = process.env) => env.BRIDGE_OPENCODE2 === 'an';
/** Ab wie vielen gleichzeitig laufenden lesenden Aufträgen opencode 2 übernimmt (darunter jcode: sparsamer, kein Server nötig). */
export const opencode2Ab = (env: Env = process.env) => { const n = Math.floor(Number(env.BRIDGE_OPENCODE2_AB)); return env.BRIDGE_OPENCODE2_AB !== undefined && Number.isFinite(n) && n >= 0 ? n : 5; };
/** Server-Adressen — nur auf dieser Maschine (127.0.0.1/localhost); alles andere fällt weg. */
export const opencode2Urls = (env: Env = process.env) => (env.BRIDGE_OPENCODE2_URLS ?? '').split(',').map((u) => u.trim()).filter((u) => /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(u));

// Nur lesen: alles verboten, dann read/glob/grep erlaubt (die letzte passende Regel gewinnt) — verbotene Werkzeuge bietet der
// Server dem Modell gar nicht erst an (Test „Schreibverbot“). ponytail: opencode 2 bedient nur lesende Aufträge; schreibende
// bleiben bei jcode (dort prüft die Brücke Schreibzugriffe außerhalb des Ordners über die Sitzungsdatei).
export const NUR_LESEN = [{ action: '*', resource: '*', effect: 'deny' }, ...['read', 'glob', 'grep'].map((action) => ({ action, resource: '*', effect: 'allow' }))];

const leer = (): LaeuferNutzung => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

/** Antworttext aus der Nachrichtenliste (neueste zuerst): die Text-Teile der neuesten Assistenten-Nachricht. */
export function oc2Antwort(nachrichten: any[]): string {
  const a = (nachrichten ?? []).find((m) => m?.type === 'assistant' && Array.isArray(m.content) && m.content.some((c: any) => c?.type === 'text'));
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
      const modell = a.model ?? 'glm-5.3-flash';
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
            wegSeit ??= jetzt();
            if (jetzt() - wegSeit > wiederMs) return fehler(s, `Server antwortet nicht mehr (${Math.round(wiederMs / 1000)} s)`);
            continue;
          }
          s = neu;
          // Bedingung 1: nach einem Ausfall läuft die Sitzung nicht von selbst weiter — einmal neu anstoßen.
          if (wegSeit !== null && !s?.outcome && !angestossen) { angestossen = true; await call('POST', `/api/session/${sid}/prompt`, { text: OC2_WEITER }); }
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
  return {
    name: 'opencode2',
    aktiv: () => Object.fromEntries(aktiv),
    async zug(a) {
      const url = [...aktiv.entries()].sort((x, y) => x[1] - y[1])[0]?.[0];
      if (!url) return { code: -1, text: '', usage: leer(), gelaufen: a.model ?? '', draussen: [], grund: 'kein opencode-2-Server eingetragen' };
      aktiv.set(url, aktiv.get(url)! + 1);
      try { const r = await einzeln.get(url)!.zug(a); return r.grund ? { ...r, grund: `${r.grund} (Server ${url})` } : r; }
      finally { aktiv.set(url, aktiv.get(url)! - 1); }
    },
  };
}
