// Läufer-Abstraktion (Konzept J, Hauptsitzung 06.11.): jcode heute, opencode-2-Server über HTTP als zweiter Läufer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { opencode2Laeufer, oc2Antwort, oc2Fertig, laeuferName, NUR_LESEN } from '../src/laeufer.ts';

/** Nachgebauter opencode-2-Server: zeichnet Aufrufe auf; die Sitzung wird nach `fertigNach` Abfragen fertig. */
function server(o: { fertigNach?: number; outcome?: string; status?: number } = {}) {
  const aufrufe: { method: string; pfad: string; body: any; auth: string }[] = [];
  let abfragen = 0;
  const fetchFn = (async (url: string, init: any) => {
    const pfad = new URL(url).pathname + new URL(url).search;
    aufrufe.push({ method: init.method, pfad, body: init.body ? JSON.parse(init.body) : null, auth: init.headers.authorization });
    const ok = (d: unknown) => new Response(JSON.stringify(d), { status: 200 });
    if (o.status) return new Response('kaputt', { status: o.status });
    if (pfad === '/api/session' && init.method === 'POST') return ok({ data: { id: 'ses_abc' } });
    if (pfad.endsWith('/prompt') || pfad.endsWith('/interrupt')) return ok({ data: {} });
    if (pfad === '/api/session/ses_abc') {
      abfragen++;
      const fertig = abfragen >= (o.fertigNach ?? 2);
      return ok({ data: { model: { id: 'glm-5.3-flash' }, tokens: { input: 122, output: 400, reasoning: 2500, cache: { read: 46000, write: 0 } }, ...(fertig ? { outcome: o.outcome ?? 'succeeded', time: { busy: 1, idle: 2 } } : { time: { busy: 2, idle: 1 } }) } });
    }
    if (pfad.startsWith('/api/session/ses_abc/message')) return ok({ data: [{ type: 'idle' }, { type: 'assistant', content: [{ type: 'reasoning', text: 'denke' }, { type: 'text', text: 'Zwei Risiken: a.ts:1' }] }, { type: 'user', text: 'Frage' }] });
    return new Response('?', { status: 404 });
  }) as unknown as typeof fetch;
  return { aufrufe, fetchFn };
}

test('opencode 2: Sitzung nur lesend anlegen, Prompt, warten bis fertig, Antwort und Nutzung auslesen', async () => {
  const s = server({ fertigNach: 2 });
  const l = opencode2Laeufer({ base: 'http://127.0.0.1:47811', passwort: 'pw', fetchFn: s.fetchFn, taktMs: 1 });
  const r = await l.zug({ cwd: '/repo', prompt: 'Lies a.ts', model: 'glm-5.3-flash', timeoutS: 60, abbruch: () => false });
  assert.equal(r.code, 0); assert.equal(r.text, 'Zwei Risiken: a.ts:1'); assert.equal(r.gelaufen, 'glm-5.3-flash');
  assert.deepEqual(r.usage, { input: 122, output: 2900, cacheRead: 46000, cacheWrite: 0 });
  const neu = s.aufrufe[0];
  assert.equal(neu.pfad, '/api/session'); assert.deepEqual(neu.body.permissions, NUR_LESEN); assert.equal(neu.body.location.directory, '/repo');
  assert.equal(neu.auth, `Basic ${Buffer.from('opencode:pw').toString('base64')}`);
  assert.deepEqual(s.aufrufe[1].body, { text: 'Lies a.ts' });
  assert.ok(!s.aufrufe.some((a) => a.pfad.endsWith('/interrupt')));
});

test('opencode 2: Abbruch und Zeitdeckel unterbrechen die Sitzung; Fehler-Ausgang und HTTP-Fehler sind kein Erfolg', async () => {
  const s = server({ fertigNach: 1000 });
  let n = 0;
  const r = await opencode2Laeufer({ base: 'http://x', passwort: 'pw', fetchFn: s.fetchFn, taktMs: 1 }).zug({ cwd: '/r', prompt: 'p', model: null, timeoutS: 60, abbruch: () => ++n > 3 });
  assert.equal(r.code, -1); assert.equal(r.grund, 'abgebrochen');
  assert.ok(s.aufrufe.some((a) => a.pfad === '/api/session/ses_abc/interrupt'));
  let t = 0;
  const z = await opencode2Laeufer({ base: 'http://x', passwort: 'pw', fetchFn: server({ fertigNach: 1000 }).fetchFn, taktMs: 1, jetzt: () => (t += 1000) }).zug({ cwd: '/r', prompt: 'p', model: null, timeoutS: 5, abbruch: () => false });
  assert.match(String(z.grund), /Zeit \(5 s\)/);
  const f = await opencode2Laeufer({ base: 'http://x', passwort: 'pw', fetchFn: server({ outcome: 'failed', fertigNach: 1 }).fetchFn, taktMs: 1 }).zug({ cwd: '/r', prompt: 'p', model: null, timeoutS: 60, abbruch: () => false });
  assert.equal(f.code, 1); assert.match(String(f.grund), /failed/);
  const h = await opencode2Laeufer({ base: 'http://x', passwort: 'pw', fetchFn: server({ status: 500 }).fetchFn, taktMs: 1 }).zug({ cwd: '/r', prompt: 'p', model: null, timeoutS: 60, abbruch: () => false });
  assert.equal(h.code, -1); assert.match(String(h.grund), /HTTP 500/);
});

test('Antwort, Fertig-Erkennung und Wahl des Läufers', async () => {
  assert.equal(oc2Antwort([{ type: 'assistant', content: [{ type: 'tool' }] }, { type: 'assistant', content: [{ type: 'text', text: 'alt' }] }]), 'alt', 'neueste Nachricht mit Text');
  assert.equal(oc2Antwort([]), '');
  assert.equal(oc2Fertig({ outcome: 'succeeded', time: { busy: 5, idle: 4 } }), false, 'nach dem letzten busy noch nicht ruhig');
  assert.equal(laeuferName({}), 'jcode'); assert.equal(laeuferName({ BRIDGE_LAEUFER: 'opencode2' }), 'opencode2');
  const { opencode2Fuer } = await import('../src/sessions.ts');
  assert.equal(opencode2Fuer({ BRIDGE_LAEUFER: 'opencode2' }), null, 'ohne Server-Adresse kein opencode 2');
  const d = mkdtempSync(join(tmpdir(), 'oc2-')); writeFileSync(join(d, 'pw'), 'geheim\n');
  assert.equal(opencode2Fuer({ BRIDGE_OPENCODE2_URL: 'http://127.0.0.1:1', BRIDGE_OPENCODE2_PW_DATEI: join(d, 'pw') }), null, 'ohne BRIDGE_LAEUFER=opencode2 bleibt jcode');
  assert.equal(opencode2Fuer({ BRIDGE_LAEUFER: 'opencode2', BRIDGE_OPENCODE2_URL: 'http://127.0.0.1:1', BRIDGE_OPENCODE2_PW_DATEI: join(d, 'pw') })?.name, 'opencode2');
});
