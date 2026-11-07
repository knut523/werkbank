// Knut 07.11.: schreibende Stränge auf opencode 2 — Läufer-Wahl (nur ausdrücklich), Strang-Auftrag (Werkzeuge über MCP, Claude-Gate,
// Shell nur lesend, Bericht im Arbeitsordner). Rein.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laeuferWahl } from '../server/jstrang.ts';
import { orchBrief } from '../server/orchestrator.ts';
import { OC2_BERICHT_HINWEIS } from '../server/reviewdatei.ts';

test('oc2: nur ausdrücklich, auch für Code und schreibende Profile, unabhängig vom jcode-Schalter; Kundendaten bleiben bei Claude', () => {
  const basis = { titel: 'Tarifrechner bauen', prompt: 'Baue X', code: true, profil: 'bauer' };
  assert.deepEqual(laeuferWahl({ ...basis, laeufer: 'oc2' }, {}).laeufer, 'oc2');
  assert.match(laeuferWahl({ ...basis, laeufer: 'opencode2' }, {}).grund, /Claude prüft/);
  assert.equal(laeuferWahl({ ...basis, laeufer: null }, { WERKBANK_JCODE_STRANG: 'on' }).laeufer, 'claude', 'nie automatisch');
  assert.equal(laeuferWahl({ ...basis, laeufer: 'oc2', prompt: 'Kundenliste exportieren' }, {}).laeufer, 'claude');
  assert.equal(laeuferWahl({ ...basis, laeufer: 'claude' }, {}).laeufer, 'claude');
});

test('oc2: Strang-Auftrag nennt die MCP-Werkzeuge, das Claude-Gate und die lesende Shell; Bericht im Arbeitsordner, kein challenge', () => {
  const b = orchBrief({ title: 'Bau', prompt: 'Baue X', cwd: '/w/x', person: 'Knut', oc2: true });
  assert.match(b, /werkbank_bedarf_melden/); assert.match(b, /werkbank_review_ready/); assert.match(b, /Claude-Gate/);
  assert.match(b, /Shell ist nur lesend/); assert.doesNotMatch(b, /gibt es für dich nicht/);
  assert.match(b, /`bericht\.md` in deinem Arbeitsordner/); assert.doesNotMatch(b, /review-pakete\/NNN/);
  assert.doesNotMatch(b, /challenge/);
  assert.match(OC2_BERICHT_HINWEIS, /werkbank_review_ready/);
});
