import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PFLEGE, befundText, zusammenfassung, GLOSSAR } from '../src/pflege.ts';

test('Pflege-Texte: jede Regel hat Klartext, Satz und Knopf', () => {
  for (const [rule, t] of Object.entries(PFLEGE)) {
    assert.ok(t.label(3).length > 0 && t.tun.length > 10 && t.knopf, rule);
  }
});

test('Pflege-Texte: Tage und Klartext statt Regelnamen', () => {
  assert.equal(befundText({ rule: 'überfällig', days: 26 }), '26 Tage überfällig');
  assert.equal(befundText({ rule: 'überfällig', days: 1 }), '1 Tag überfällig');
  assert.equal(befundText({ rule: 'still', days: 14 }), 'seit 14 Tagen still');
  assert.equal(befundText({ rule: 'Widerspruch' }), 'Kommentar sagt „erledigt“');
  assert.equal(befundText({ rule: 'ohne Datum' }), 'Datum fehlt');
  assert.equal(befundText({ rule: 'Sub-task ohne Owner' }), 'Owner fehlt');
});

test('Pflege-Zusammenfassung: nach Art mit Anzahl, häufigste zuerst', () => {
  assert.equal(zusammenfassung([{ rule: 'ohne Datum' }, { rule: 'überfällig', days: 3 }, { rule: 'ohne Datum' }, { rule: 'still', days: 9 }, { rule: 'überfällig', days: 1 }, { rule: 'ohne Datum' }]),
    '3 ohne Datum · 2 überfällig · 1 still');
  assert.equal(zusammenfassung([]), '');
});

test('Glossar erklärt die unklaren Begriffe', () => {
  const words = GLOSSAR.map(([w]) => w);
  for (const w of ['still', 'Widerspruch', 'ohne Workstream']) assert.ok(words.includes(w), w);
});
