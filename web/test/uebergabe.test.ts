// R29 D / S1+S3: Meldungen gehen nicht mehr verloren (Paket 159 V1) und die Übergabe beim Neustart ist lesbar (Zusammenfassung + offene Punkte).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uebergabeLesbarAn, meldungsZeilen, standZeilen } from '../server/uebergabe.ts';

const cell = (t: unknown) => String(t ?? '').replace(/[|\n]/g, ' ').trim().slice(0, 120);
const NOW = Date.parse('2026-10-26T12:00:00Z');

test('Schalter für die Zusammenfassung: Vorgabe aus', () => {
  assert.equal(uebergabeLesbarAn({}), false);
  assert.equal(uebergabeLesbarAn({ WERKBANK_UEBERGABE_LESBAR: 'on' }), true);
});

test('Meldungen: neueste zuerst, nur die letzten 3 Tage, mit Strang, Art und Text', () => {
  const docs = [
    { title: 'Strang A', meldungen: [{ at: new Date(NOW - 3600_000), art: 'blocker', text: 'Braucht Entscheidung X' }, { at: new Date(NOW - 5 * 86400_000), art: 'risiko', text: 'alt' }] },
    { title: 'Strang B', meldungen: [{ at: new Date(NOW - 600_000), art: 'risiko', text: 'Plan ändert sich' }] },
  ];
  const z = meldungsZeilen(docs, NOW, cell);
  assert.equal(z.length, 2);
  assert.match(z[0], /Strang B.*risiko.*Plan ändert sich/);
  assert.match(z[1], /Strang A.*blocker.*Braucht Entscheidung X/);
  assert.ok(!z.join('\n').includes('alt'));
});

test('Meldungen: Tabellenzeichen und Zeilenumbrüche aus Agententext werden entschärft, höchstens 10', () => {
  const docs = [{ title: 'S', meldungen: Array.from({ length: 15 }, (_, i) => ({ at: new Date(NOW - i * 1000), art: 'blocker', text: `a|b\nc ${i}` })) }];
  const z = meldungsZeilen(docs, NOW, cell);
  assert.equal(z.length, 10);
  for (const l of z) assert.equal(l.split('\n').length, 1);
});

test('Meldungen: nichts da → leere Liste', () => {
  assert.deepEqual(meldungsZeilen([{ title: 'x' }, { title: 'y', meldungen: [] }], NOW, cell), []);
});

test('Stand: Zusammenfassung zählt Stränge nach Status und nennt Titel', () => {
  const s = standZeilen({
    strangs: [
      { title: 'Strang A', wort: 'läuft', braucht: null, offen: '' },
      { title: 'Strang B', wort: 'wartet auf dich', braucht: 'Push freigeben', offen: ' · 1 offene Entscheidung: D1 Titel' },
      { title: 'Strang C', wort: 'zu prüfen', braucht: null, offen: '' },
    ],
    entschieden: [{ id: 'q-1', title: 'Frage 1', antwort: 'Option „Ja“' }],
    cell,
  });
  assert.match(s.arbeit, /3 offene Unter-Chats/);
  assert.match(s.arbeit, /1 läuft/);
  assert.match(s.arbeit, /1 wartet auf dich/);
  assert.match(s.arbeit, /1 zu prüfen/);
  assert.match(s.arbeit, /Strang A/);
  assert.match(s.entschieden, /q-1.*Frage 1.*Option „Ja“/);
  assert.equal(s.naechste.length, 1);
  assert.match(s.naechste[0], /Strang B.*Push freigeben.*D1 Titel/);
});

test('Stand: keine Stränge, keine Entscheidungen → ehrliche Leerzeilen, keine erfundenen Sätze', () => {
  const s = standZeilen({ strangs: [], entschieden: [], cell });
  assert.match(s.arbeit, /keine offenen Unter-Chats/i);
  assert.match(s.entschieden, /keine/i);
  assert.deepEqual(s.naechste, []);
});
