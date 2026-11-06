// Läufer-Abstraktion (Konzept J, Entscheidung der Hauptsitzung 06.11.): ein lesender Strang- oder Worker-Zug läuft über einen
// Läufer — heute jcode (ein Prozess je Auftrag), wahlweise ein opencode-2-Server (Sitzungen über HTTP: /api/session, /prompt,
// interrupt; Test 06.11. in review-pakete/opencode2-test-0611: 20 parallel fehlerfrei, 524 MB statt 2062 MB bei jcode).
// Die Entscheidung für opencode 2 steht noch aus (Pilot, D1); bis dahin BRIDGE_LAEUFER=jcode (Vorgabe). Rein bis auf fetch.

export interface LaeuferAuftrag { cwd: string; prompt: string; model: string | null; timeoutS: number; abbruch: () => boolean; titel?: string }
export interface LaeuferNutzung { input: number; output: number; cacheRead: number; cacheWrite: number }
/** code: 0 = sauber zu Ende, sonst Fehler/Abbruch/Zeit; text: Antwort; gelaufen: tatsächliches Modell. */
export interface LaeuferErgebnis { code: number | null; text: string; usage: LaeuferNutzung; gelaufen: string; draussen: string[]; grund?: string }
export interface Laeufer { name: 'jcode' | 'opencode2'; zug(a: LaeuferAuftrag): Promise<LaeuferErgebnis> }

export const laeuferName = (env: Record<string, string | undefined> = process.env): 'jcode' | 'opencode2' => (env.BRIDGE_LAEUFER === 'opencode2' ? 'opencode2' : 'jcode');

// Nur lesen: alles verboten, dann read/glob/grep erlaubt (die letzte passende Regel gewinnt) — verbotene Werkzeuge bietet der
// Server dem Modell gar nicht erst an (Test „Schreibverbot“). ponytail: opencode 2 bedient vorerst nur lesende Aufträge; schreibende
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

export function opencode2Laeufer(o: { base: string; passwort: string; fetchFn?: typeof fetch; taktMs?: number; jetzt?: () => number }): Laeufer {
  const f = o.fetchFn ?? fetch, takt = o.taktMs ?? 2000, jetzt = o.jetzt ?? Date.now;
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
      try {
        sid = String((await call('POST', '/api/session', { title: a.titel ?? 'werkbank', location: { directory: a.cwd }, model: { providerID: 'melious', id: modell }, permissions: NUR_LESEN }))?.data?.id ?? '');
        if (!sid) return { code: -1, text: '', usage: leer(), gelaufen: modell, draussen: [], grund: 'keine Sitzung' };
        await call('POST', `/api/session/${sid}/prompt`, { text: a.prompt });
        const ende = jetzt() + a.timeoutS * 1000;
        let s: any = null;
        for (;;) {
          await new Promise((r) => setTimeout(r, takt));
          if (a.abbruch() || jetzt() > ende) {
            await call('POST', `/api/session/${sid}/interrupt`).catch(() => null);
            return { code: -1, text: '', usage: oc2Nutzung(s), gelaufen: modell, draussen: [], grund: a.abbruch() ? 'abgebrochen' : `Zeit (${a.timeoutS} s)` };
          }
          s = (await call('GET', `/api/session/${sid}`))?.data;
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
