// Konzept J, J1 (Knut 05.11., Go): jcode-Strang — Ergebnis zählt nur mit Status-Zeile und ohne Schreiben außerhalb; sonst einmal
// neu, dann opencode (falls installiert), dann Claude. Gleiche Status-Zeilen wie Claude-Stränge.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let mod: typeof import('../src/sessions.ts');
before(async () => {
  process.env.BRIDGE_STATE_DIR = mkdtempSync(join(tmpdir(), 'bridge-jstrang-'));
  mod = await import('../src/sessions.ts');
});

test('J1: Ergebnis mit Status-Zeile zählt; leer, ohne Status, Exit ≠ 0, Schreiben außerhalb → nicht (mit Grund)', () => {
  const ok = mod.jcodeStrangErgebnis({ code: 0, j: { text: '### Stand\n- Erledigt: Review\nStatus: fertig' }, draussen: [] });
  assert.equal(ok.ok, true);
  assert.match(mod.jcodeStrangErgebnis({ code: 0, j: { text: '' }, draussen: [] }).grund, /leer/);
  assert.match(mod.jcodeStrangErgebnis({ code: 0, j: { text: 'Habe geschaut.' }, draussen: [] }).grund, /Status-Zeile/);
  assert.match(mod.jcodeStrangErgebnis({ code: 1, j: null, draussen: [] }).grund, /Exit 1/);
  assert.match(mod.jcodeStrangErgebnis({ code: 0, j: { text: 'Status: fertig' }, draussen: ['/home/x/.bashrc'] }).grund, /außerhalb/);
  assert.equal(mod.jcodeStrangErgebnis({ code: 0, j: { text: 'Frage …\nStatus: braucht Antwort' }, draussen: [] }).ok, true);
});

test('J1: Fallback-Reihe — jcode, jcode (Neustart), opencode nur wenn installiert, dann Claude', () => {
  assert.deepEqual(mod.jcodeReihe(false), ['jcode', 'jcode']);
  assert.deepEqual(mod.jcodeReihe(true), ['jcode', 'jcode', 'opencode']);
  delete process.env.BRIDGE_JCODE_OPENCODE;
  assert.equal(mod.opencodeAn(), false, 'ohne Schalter nie opencode — auch wenn installiert (läuft ohne jcode-Wächter, ggf. nicht EU)');
  assert.deepEqual(mod.jcodeReihe(), ['jcode', 'jcode']);
});

test('J1: Anmeldung trägt den Läufer; Schätzung nimmt dann den jcode-Topf', () => {
  mod.registerOrchestration('u1', '11111111-1111-1111-1111-111111111111', process.env.BRIDGE_STATE_DIR!, 'strand', { laeufer: 'jcode', profil: 'leser' });
  const s = mod.orchStateOf('u1').find((x: any) => x.conv === '11111111-1111-1111-1111-111111111111');
  assert.equal(s?.laeufer, 'jcode');
});
