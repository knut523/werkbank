// Läufer-Abstraktion (Konzept J, Hauptsitzung 06.11.): jcode und opencode-2-Server; Pilot ab ~5 parallelen lesenden Aufträgen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { opencode2Laeufer, opencode2Pool, oc2Antwort, oc2Fertig, opencode2An, opencode2Ab, NUR_LESEN, OC2_WEITER } from '../src/laeufer.ts';

/** Nachgebauter opencode-2-Server: zeichnet Aufrufe auf; die Sitzung wird nach `fertigNach` Abfragen fertig. */
function server(o: { fertigNach?: number; outcome?: string; status?: number; wegBei?: number[]; nach404?: number; id?: string } = {}) {
  const aufrufe: { method: string; pfad: string; body: any; auth: string }[] = [];
  let abfragen = 0;
  const sid = o.id ?? 'ses_abc';
  const fetchFn = (async (url: string, init: any) => {
    const u = new URL(url), pfad = u.pathname + u.search;
    aufrufe.push({ method: init.method, pfad, body: init.body ? JSON.parse(init.body) : null, auth: init.headers.authorization });
    const ok = (d: unknown) => new Response(JSON.stringify(d), { status: 200 });
    if (o.status) return new Response('kaputt', { status: o.status });
    if (pfad === '/api/session' && init.method === 'POST') return ok({ data: { id: sid } });
    if (pfad.endsWith('/prompt') || pfad.endsWith('/interrupt')) return ok({ data: {} });
    if (pfad === `/api/session/${sid}`) {
      abfragen++;
      if (o.wegBei?.includes(abfragen)) throw new TypeError('fetch failed');   // Server gerade weg (Absturz/Neustart)
      if (o.nach404 && abfragen >= o.nach404) return new Response('{}', { status: 404 });
      const fertig = abfragen >= (o.fertigNach ?? 2);
      return ok({ data: { model: { id: 'glm-5.3-flash' }, tokens: { input: 122, output: 400, reasoning: 2500, cache: { read: 46000, write: 0 } }, ...(fertig ? { outcome: o.outcome ?? 'succeeded', time: { busy: 1, idle: 2 } } : { time: { busy: 2, idle: 1 } }) } });
    }
    if (pfad.startsWith(`/api/session/${sid}/message`)) return ok({ data: [{ type: 'idle' }, { type: 'assistant', content: [{ type: 'reasoning', text: 'denke' }, { type: 'text', text: 'Zwei Risiken: a.ts:1' }] }, { type: 'user', text: 'Frage' }] });
    return new Response('?', { status: 404 });
  }) as unknown as typeof fetch;
  return { aufrufe, fetchFn };
}
const auftrag = (x: Partial<Parameters<ReturnType<typeof opencode2Laeufer>['zug']>[0]> = {}) => ({ cwd: '/repo', prompt: 'Lies a.ts', model: 'glm-5.3-flash', timeoutS: 60, abbruch: () => false, ...x });

test('opencode 2: Sitzung nur lesend anlegen, Prompt, warten bis fertig, Antwort und Nutzung auslesen', async () => {
  const s = server({ fertigNach: 2 });
  const r = await opencode2Laeufer({ base: 'http://127.0.0.1:47811', passwort: 'pw', fetchFn: s.fetchFn, taktMs: 1 }).zug(auftrag());
  assert.equal(r.code, 0); assert.equal(r.text, 'Zwei Risiken: a.ts:1'); assert.equal(r.gelaufen, 'glm-5.3-flash');
  assert.deepEqual(r.usage, { input: 122, output: 2900, cacheRead: 46000, cacheWrite: 0 });
  const neu = s.aufrufe[0];
  assert.equal(neu.pfad, '/api/session'); assert.deepEqual(neu.body.permissions, NUR_LESEN); assert.equal(neu.body.location.directory, '/repo');
  assert.equal(neu.auth, `Basic ${Buffer.from('opencode:pw').toString('base64')}`);
  assert.deepEqual(s.aufrufe[1].body, { text: 'Lies a.ts' });
  assert.ok(!s.aufrufe.some((a) => a.pfad.endsWith('/interrupt')));
});

test('Bedingung 1: Server kurz weg (Absturz/Neustart) → warten, Sitzung einmal neu anstoßen, Ergebnis kommt; zu lange weg oder Sitzung verloren → Fehler', async () => {
  const s = server({ wegBei: [2, 3], fertigNach: 5 });
  const r = await opencode2Laeufer({ base: 'http://x', passwort: 'pw', fetchFn: s.fetchFn, taktMs: 1 }).zug(auftrag());
  assert.equal(r.code, 0, String(r.grund));
  const weiter = s.aufrufe.filter((a) => a.pfad.endsWith('/prompt') && a.body?.text === OC2_WEITER);
  assert.equal(weiter.length, 1, 'genau einmal neu angestoßen');
  let t = 0;
  const lang = await opencode2Laeufer({ base: 'http://x', passwort: 'pw', fetchFn: server({ wegBei: Array.from({ length: 50 }, (_, i) => i + 2), fertigNach: 99 }).fetchFn, taktMs: 1, wiederMs: 5000, jetzt: () => (t += 1000) }).zug(auftrag());
  assert.match(String(lang.grund), /Server antwortet nicht mehr/);
  const weg = await opencode2Laeufer({ base: 'http://x', passwort: 'pw', fetchFn: server({ nach404: 2 }).fetchFn, taktMs: 1 }).zug(auftrag());
  assert.match(String(weg.grund), /Sitzung nach Server-Neustart verloren/);
});

test('opencode 2: Abbruch und Zeitdeckel unterbrechen die Sitzung; Fehler-Ausgang und HTTP-Fehler sind kein Erfolg', async () => {
  const s = server({ fertigNach: 1000 });
  let n = 0;
  const r = await opencode2Laeufer({ base: 'http://x', passwort: 'pw', fetchFn: s.fetchFn, taktMs: 1 }).zug(auftrag({ abbruch: () => ++n > 3 }));
  assert.equal(r.code, -1); assert.equal(r.grund, 'abgebrochen');
  assert.ok(s.aufrufe.some((a) => a.pfad === '/api/session/ses_abc/interrupt'));
  let t = 0;
  const z = await opencode2Laeufer({ base: 'http://x', passwort: 'pw', fetchFn: server({ fertigNach: 1000 }).fetchFn, taktMs: 1, jetzt: () => (t += 1000) }).zug(auftrag({ timeoutS: 5 }));
  assert.match(String(z.grund), /Zeit \(5 s\)/);
  const f = await opencode2Laeufer({ base: 'http://x', passwort: 'pw', fetchFn: server({ outcome: 'failed', fertigNach: 1 }).fetchFn, taktMs: 1 }).zug(auftrag());
  assert.equal(f.code, 1); assert.match(String(f.grund), /failed/);
  const h = await opencode2Laeufer({ base: 'http://x', passwort: 'pw', fetchFn: server({ status: 500 }).fetchFn, taktMs: 1 }).zug(auftrag());
  assert.equal(h.code, -1); assert.match(String(h.grund), /HTTP 500/);
});

test('Bedingung 3: mehrere Server — jeder Lauf geht an den mit den wenigsten aktiven Sitzungen', async () => {
  const s = server({ fertigNach: 3 });
  const pool = opencode2Pool({ urls: ['http://127.0.0.1:1', 'http://127.0.0.1:2'], passwort: 'pw', fetchFn: s.fetchFn, taktMs: 5 });
  const laeufe = [pool.zug(auftrag()), pool.zug(auftrag()), pool.zug(auftrag()), pool.zug(auftrag())];
  await new Promise((r) => setTimeout(r, 1));
  assert.deepEqual(pool.aktiv(), { 'http://127.0.0.1:1': 2, 'http://127.0.0.1:2': 2 }, 'gleichmäßig verteilt');
  for (const r of await Promise.all(laeufe)) assert.equal(r.code, 0);
  assert.deepEqual(pool.aktiv(), { 'http://127.0.0.1:1': 0, 'http://127.0.0.1:2': 0 });
  const leer = await opencode2Pool({ urls: [], passwort: 'pw', fetchFn: s.fetchFn }).zug(auftrag());
  assert.match(String(leer.grund), /kein opencode-2-Server/);
});

test('Gegenprüfung 06.11.: toter Server pausiert 60 s (nächster Lauf geht an den lebenden); Anstoßen nach Neustart fehlgeschlagen → nächster Takt', async () => {
  const lebt = server({ fertigNach: 1 });
  const tot = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
  const f = (async (url: string, init: any) => (url.startsWith('http://127.0.0.1:1/') ? tot(url, init) : lebt.fetchFn(url, init))) as unknown as typeof fetch;
  const pool = opencode2Pool({ urls: ['http://127.0.0.1:1', 'http://127.0.0.1:2'], passwort: 'pw', fetchFn: f, taktMs: 1 });
  const a = await pool.zug(auftrag());   // beide 0 aktiv → der erste (tote) wird genommen
  assert.equal(a.code, -1); assert.match(String(a.grund), /fetch failed \(Server http:\/\/127\.0\.0\.1:1\)/);
  const b = await pool.zug(auftrag());
  assert.equal(b.code, 0, 'der tote Server pausiert, der lebende übernimmt');
  // Anstoßen: erster POST nach dem Ausfall scheitert, der zweite gelingt
  let prompts = 0;
  const s = server({ wegBei: [2], fertigNach: 6 });
  const f2 = (async (url: string, init: any) => { if (url.endsWith('/prompt') && ++prompts === 2) throw new TypeError('fetch failed'); return s.fetchFn(url, init); }) as unknown as typeof fetch;
  const r = await opencode2Laeufer({ base: 'http://x', passwort: 'pw', fetchFn: f2, taktMs: 1 }).zug(auftrag());
  assert.equal(r.code, 0, String(r.grund));
  assert.equal(s.aufrufe.filter((x) => x.body?.text === OC2_WEITER).length, 1, 'beim zweiten Versuch angestoßen');
});

test('Schalter: an nur mit BRIDGE_OPENCODE2=an, Schwelle 5 (einstellbar), nur Server auf dieser Maschine; Antwort und Fertig-Erkennung', async () => {
  assert.equal(opencode2An({}), false); assert.equal(opencode2An({ BRIDGE_OPENCODE2: 'an' }), true);
  assert.equal(opencode2Ab({}), 5); assert.equal(opencode2Ab({ BRIDGE_OPENCODE2_AB: '0' }), 0); assert.equal(opencode2Ab({ BRIDGE_OPENCODE2_AB: 'x' }), 5);
  assert.equal(oc2Antwort([{ type: 'assistant', content: [{ type: 'tool' }] }, { type: 'assistant', content: [{ type: 'text', text: 'alt' }] }]), 'alt', 'neueste Nachricht mit Text');
  assert.equal(oc2Antwort([]), '');
  assert.equal(oc2Fertig({ outcome: 'succeeded', time: { busy: 5, idle: 4 } }), false, 'nach dem letzten busy noch nicht ruhig');
  const { opencode2Fuer } = await import('../src/sessions.ts');
  assert.equal(await opencode2Fuer('sk-x', {}), null, 'ohne BRIDGE_OPENCODE2=an bleibt jcode');
  assert.equal(await opencode2Fuer(undefined, { BRIDGE_OPENCODE2: 'an' }), null, 'ohne Schlüssel aus dem Konto kein opencode 2');
  assert.equal(await opencode2Fuer('sk-x', { BRIDGE_OPENCODE2: 'an', BRIDGE_OPENCODE2_PORTS: 'x 80' }), null, 'ohne gültigen Port kein opencode 2');
  const d = mkdtempSync(join(tmpdir(), 'oc2-'));
  assert.equal(await opencode2Fuer('sk-x', { BRIDGE_OPENCODE2: 'an', BRIDGE_OPENCODE2_HOME: d }), null, 'ohne Installation kein opencode 2 (Rückfall jcode)');
});
