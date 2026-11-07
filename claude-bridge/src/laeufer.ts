// Läufer-Abstraktion (Konzept J, Entscheidung der Hauptsitzung 06.11.): ein lesender Strang- oder Worker-Zug läuft über einen
// Läufer — jcode (ein Prozess je Auftrag) oder ein opencode-2-Server (Sitzungen über HTTP: /api/session, /prompt, interrupt;
// Test 06.11. in review-pakete/opencode2-test-0611: 20 parallel fehlerfrei, 524 MB statt 2062 MB bei jcode).
// Entschieden (Hauptsitzung 06.11., umkehrbar, Pilot): lesende Aufträge laufen ab ~5 parallelen auf opencode-2-Servern, darunter auf
// jcode. Bedingungen: (1) Wiederaufnahme nach einem Server-Absturz (hier: warten, Sitzung neu anstoßen; den Neustart macht die
// Brücke, oc2server.ts), (2) feste Version 2.2.5 (oc2server.ts prüft), (3) mehrere Server, verteilt (opencode2Pool).
// Schalter: BRIDGE_OPENCODE2=an, BRIDGE_OPENCODE2_PORTS (47811 47812), BRIDGE_OPENCODE2_HOME, BRIDGE_OPENCODE2_AB (5). Rein bis auf fetch.

import { FLASH } from './modellwahl.ts';

export interface LaeuferAuftrag {
  cwd: string; prompt: string; model: string | null; timeoutS: number; abbruch: () => boolean; titel?: string;
  // Schreibende Stränge (Knut 07.11.): eigene Rechte statt NUR_LESEN, eine Sitzung über alle Züge (sitzung = Kennung aus dem
  // letzten Zug, server = dessen Server im Pool) und die Nachkontrolle der Werkzeug-Teile dieses Zugs (pruefe → Pfade draußen).
  rechte?: Oc2Regel[]; sitzung?: string; server?: string; pruefe?: (nachrichten: any[]) => string[];
  // Werkbank-Werkzeuge (oc2mcp.ts): MCP-Server je Arbeitsordner, vor jedem Zug eingetragen (idempotent, übersteht Server-Neustarts).
  mcp?: { name: string; config: Record<string, unknown> };
}
export interface LaeuferNutzung { input: number; output: number; cacheRead: number; cacheWrite: number }
/** code: 0 = sauber zu Ende, sonst Fehler/Abbruch/Zeit; text: Antwort; gelaufen: tatsächliches Modell. */
export interface LaeuferErgebnis { code: number | null; text: string; usage: LaeuferNutzung; gelaufen: string; draussen: string[]; grund?: string; sitzung?: string; server?: string }
export interface Oc2Regel { action: string; resource: string; effect: 'allow' | 'deny' }
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
  '**/.config/vw/**', '**/.config/gh/**', '**/.aws/**', '**/.netrc', '**/.git-credentials', '**/testkonten*', '**/.local/opencode2/**', '**/.runtime/**',
  // Pass C (Runde 3): wie GEHEIM im jcode-Hook
  '**/.config/coderv2/**', '**/.npmrc', '**/.pgpass', '**/.docker/config.json', '**/.kube/**', '**/Bitwarden CLI/**', '**/*_history', '**/.envrc'];
// Test am echten 2.2.5 (07.11., test/oc2-schreibgrenze.test.ts): Pfadregeln gelten für den Pfad RELATIV zum Arbeitsordner, und
// `**/x` trifft `x` in der obersten Ebene nicht — jedes Muster deshalb auch ohne führendes `**/`.
const mitOberster = (m: string) => (m.startsWith('**/') ? [m, m.slice(3)] : [m]);
const sperre = (actions: string[], muster: string[]): Oc2Regel[] => actions.flatMap((action) => muster.flatMap(mitOberster).map((resource) => ({ action, resource, effect: 'deny' as const })));
export const NUR_LESEN: Oc2Regel[] = [
  { action: '*', resource: '*', effect: 'deny' },
  ...['read', 'glob', 'grep'].map((action) => ({ action, resource: '*', effect: 'allow' as const })),
  { action: 'external_directory', resource: '*', effect: 'deny' },
  ...sperre(['read', 'glob', 'grep'], GEHEIM_MUSTER),
];

// Schreibende Stränge (Knut 07.11.: „V2 is promised to run on opencode … why should they be off“). Belegt am echten 2.2.5:
// - `write` und `edit` hängen an der Aktion `edit`; `external_directory: deny` lehnt absolute Pfade draußen und `../` ab.
// - Ein Symlink im Arbeitsordner, der nach draußen zeigt, wird NICHT abgefangen → je Symlink eine Sperre (linksDraussen).
// - `opencode_worktree_remove` hängt ebenfalls an `edit` — die Nachkontrolle (oc2SchreibtDraussen) verwirft jeden Aufruf.
// - Die Shell ruft `bash` über PATH → der Wächter (shim/bash, nur lesende Befehle) steht vorn im PATH des Servers (oc2server.ts).
// Nicht erlaubt: execute (Code Mode mit fetch), subagent, webfetch, skill, question, MCP außer den Werkbank-Werkzeugen.
// Zweite Linie: Nachkontrolle der Werkzeug-Teile; dritte: Sandbox-Nutzer D13 (sandbox.ts), sobald eingerichtet.
export const SCHREIB_SPERRE = ['.git', '.git/**', '**/.git', '**/.git/**', 'node_modules/**', '**/node_modules/**', 'opencode.json', 'opencode.jsonc', '.opencode/**', '**/.opencode/**', '.claude/**', '**/.claude/**', '.werkbank/**', '.husky/**', '.github/**'];
export function oc2Schreibrechte(linksDraussen: string[] = [], mcp: string[] = []): Oc2Regel[] {
  return [
    { action: '*', resource: '*', effect: 'deny' },
    ...['read', 'glob', 'grep', 'edit', 'shell', ...mcp].map((action) => ({ action, resource: '*', effect: 'allow' as const })),
    { action: 'external_directory', resource: '*', effect: 'deny' },
    ...sperre(['read', 'glob', 'grep', 'edit'], GEHEIM_MUSTER),
    ...sperre(['edit'], SCHREIB_SPERRE),
    ...linksDraussen.flatMap((l) => [l, `${l}/**`]).map((resource) => ({ action: 'edit', resource, effect: 'deny' as const })),
    // Test 07.11.: opencode_worktree_remove prüft `edit` auf dem Zielordner, ohne external_directory — Ziele außerhalb haben einen
    // absoluten Ressourcen-Namen (innen sind sie relativ). Absolutes Ziel → gesperrt.
    { action: 'edit', resource: '/*', effect: 'deny' }, { action: 'edit', resource: '/**', effect: 'deny' },
    // … und der Arbeitsordner selbst (Ressource „.“ bzw. leer) — sonst könnte der Strang seinen eigenen Worktree entfernen.
    { action: 'edit', resource: '.', effect: 'deny' }, { action: 'edit', resource: '', effect: 'deny' },
  ];
}
/** Nachkontrolle (wie jcodeWritesOutside): Ziele der ausgeführten schreibenden Werkzeug-Teile. `istDraussen` ist dieselbe Regel wie
 *  der jcode-Hook (schreibzielProblem: echter Pfad außerhalb, node_modules, .git). Abgelehnte Aufrufe haben nichts geschrieben. */
export function oc2SchreibtDraussen(nachrichten: any[], istDraussen: (pfad: string) => boolean): string[] {
  const out: string[] = [];
  for (const m of nachrichten ?? []) for (const c of Array.isArray(m?.content) ? m.content : []) {
    if (c?.type !== 'tool' || c.state?.status === 'error') continue;
    const name = String(c.name ?? '');
    if (/worktree_remove|session_move|worktree_create/.test(name)) { out.push(`${name}(${String(c.state?.input?.directory ?? '')})`); continue; }
    if (!/^(write|edit|patch|apply_patch|multiedit)$/.test(name)) continue;
    const i = c.state?.input ?? {};
    const pfade = [i.path, i.filePath, i.file_path, ...(Array.isArray(c.state?.metadata?.files) ? c.state.metadata.files.map((f: any) => f?.file) : [])].filter((x) => typeof x === 'string' && x);
    for (const p of pfade) if (istDraussen(p)) out.push(p);
  }
  return [...new Set(out)];
}

const leer = (): LaeuferNutzung => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

/** Antworttext aus der Nachrichtenliste (neueste zuerst): die Text-Teile der neuesten Assistenten-Nachricht. */
export function oc2Antwort(nachrichten: any[]): string {
  // Neueste nach Zeitstempel (die API liefert neueste zuerst; ohne Zeitstempel bleibt diese Reihenfolge). Bei einer fortgesetzten
  // Sitzung übergibt der Läufer nur die Nachrichten dieses Zugs (zugNachrichten) — sonst käme die Antwort des Vorzugs zurück.
  const mitText = (nachrichten ?? []).filter((m) => m?.type === 'assistant' && Array.isArray(m.content) && m.content.some((c: any) => c?.type === 'text'));
  const a = mitText.reduce<any>((best, m) => (best && Number(best.time?.created ?? 0) >= Number(m.time?.created ?? 0) ? best : m), null);
  return a ? a.content.filter((c: any) => c?.type === 'text').map((c: any) => String(c.text ?? '')).join('\n').trim() : '';
}
/** Nachrichten ab einem Zeitpunkt (ms): die eines Zugs in einer fortgesetzten Sitzung. Ohne Zeitstempel: mitnehmen. */
export const zugNachrichten = (nachrichten: any[], seit: number) => (nachrichten ?? []).filter((m) => !(Number(m?.time?.created) < seit));
/** Nutzung eines Zugs: die Sitzung zählt über alle Züge, gebucht wird der Unterschied. */
export const nutzungSeit = (nach: LaeuferNutzung, vor: LaeuferNutzung): LaeuferNutzung => ({ input: Math.max(0, nach.input - vor.input), output: Math.max(0, nach.output - vor.output), cacheRead: Math.max(0, nach.cacheRead - vor.cacheRead), cacheWrite: Math.max(0, nach.cacheWrite - vor.cacheWrite) });
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
      let sid: string | null = null, vor = leer(), seit = 0;
      const fehler = (s: any, grund: string): LaeuferErgebnis => ({ code: -1, text: '', usage: nutzungSeit(oc2Nutzung(s), vor), gelaufen: modell, draussen: [], grund, ...(sid ? { sitzung: sid } : {}) });
      try {
        if (a.mcp) {
          // Test 07.11.: location als deepObject; schlägt das Eintragen fehl, läuft der Zug ohne die Werkzeuge (Stand-Block reicht).
          const q = `location%5Bdirectory%5D=${encodeURIComponent(a.cwd)}`, n = encodeURIComponent(a.mcp.name);
          await call('PUT', `/api/experimental/mcp/${n}?${q}`, { config: a.mcp.config }).then(() => call('POST', `/api/experimental/mcp/${n}/connect?${q}`)).catch(() => null);
        }
        // Schreibende Stränge: dieselbe Sitzung über alle Züge (der Kontext bleibt). Ist sie weg (404), beginnt eine neue.
        if (a.sitzung && /^ses_\w{1,80}$/.test(a.sitzung)) {
          const alt = await call('GET', `/api/session/${a.sitzung}`).then((x) => x?.data, (e: any) => { if (/HTTP 404/.test(String(e?.message))) return null; throw e; });
          if (alt) { sid = a.sitzung; vor = oc2Nutzung(alt); }
        }
        sid ||= String((await call('POST', '/api/session', { title: a.titel ?? 'werkbank', location: { directory: a.cwd }, model: { providerID: 'melious', id: modell }, permissions: a.rechte ?? NUR_LESEN }))?.data?.id ?? '');
        if (!sid) return fehler(null, 'keine Sitzung');
        // Fortgesetzt: der Ausgang des Vorzugs steht noch an der Sitzung — fertig erst, wenn sie NACH diesem Prompt ruhig wurde.
        seit = jetzt();
        const fortgesetzt = sid === a.sitzung;
        const fertig = (x: any) => oc2Fertig(x) && (!fortgesetzt || Number(x?.time?.idle ?? 0) >= seit);
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
          // ponytail (Pass A S7): ein langsamer GET zählt hier wie ein Ausfall und stößt einmal an. Nach einem echten Neustart steht
          // die Sitzung weiter auf „busy“ (Test 06.11.), „ruhig“ unterscheidet die Fälle also nicht — dafür bräuchte es die Prozessnummer
          // des Servers aus oc2server; bis dahin lieber einmal zu viel anstoßen als eine Sitzung liegen lassen.
          if (wegSeit !== null && !fertig(s) && !angestossen) {
            angestossen = await call('POST', `/api/session/${sid}/prompt`, { text: OC2_WEITER }).then(() => true, () => false);
            if (!angestossen) continue;
          }
          wegSeit = null;
          if (fertig(s)) break;
        }
        const alle = (await call('GET', `/api/session/${sid}/message?limit=200`))?.data ?? [];
        const dieser = fortgesetzt ? zugNachrichten(alle, seit) : alle;
        const text = oc2Antwort(dieser);
        const gelaufen = String(s?.model?.id ?? modell), usage = nutzungSeit(oc2Nutzung(s), vor);
        const draussen = a.pruefe ? a.pruefe(dieser) : [];
        const basis = { text, usage, gelaufen, draussen, sitzung: sid };
        return s.outcome === 'succeeded' ? { code: 0, ...basis } : { code: 1, ...basis, grund: `Ausgang ${s.outcome}` };
      } catch (e: any) {
        return { code: -1, text: '', usage: leer(), gelaufen: modell, draussen: [], grund: String(e?.message ?? e).slice(0, 200), ...(sid ? { sitzung: sid } : {}) };
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
      // Fortgesetzte Strang-Sitzung: sie lebt auf ihrem Server — dorthin, auch wenn er gerade pausiert (der Läufer wartet auf den
      // Neustart). Ein unbekannter Server (andere Ports) → neu verteilen, die Sitzung beginnt dort neu.
      const fest = a.server && aktiv.has(a.server) ? a.server : null;
      const url = fest ?? (frei.length ? frei : [...aktiv.entries()]).sort((x, y) => x[1] - y[1])[0]?.[0];
      if (!url) return { code: -1, text: '', usage: leer(), gelaufen: a.model ?? '', draussen: [], grund: 'kein opencode-2-Server eingetragen' };
      aktiv.set(url, aktiv.get(url)! + 1);
      try {
        const r = { ...(await einzeln.get(url)!.zug(fest ? a : { ...a, sitzung: undefined })), server: url };
        if (r.code !== 0 && NICHT_DA.test(String(r.grund))) pause.set(url, jetzt() + 60_000);
        return r.grund ? { ...r, grund: `${r.grund} (Server ${url})` } : r;
      } finally { aktiv.set(url, aktiv.get(url)! - 1); }
    },
  };
}
