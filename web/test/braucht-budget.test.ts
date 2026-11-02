// „Braucht dich“-Budget-Knöpfe (R30b Teil A, S3, Knut 30.10.): Budget-Fragen bekommen die Knöpfe „schließen“
// und „+50 % Budget“ statt „Anhalten“/„Weiter mit +50 %“ — der Faktor 1,5 bleibt, „schließen“ ist der Anhalten-Weg.
// Schalter WERKBANK_BRAUCHT_DICH (Vorgabe aus). Reine Funktionen: Labels und Wirkung ohne Mongo, wie braucht.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetOptionen, budgetWirkung, budgetEmpfehlung } from '../server/braucht.ts';

test('Budget-Knöpfe (S3): Schalter an → „schließen“ und „+50 % Budget“ in Knuts Worten', () => {
  const an = budgetOptionen(1000, { WERKBANK_BRAUCHT_DICH: 'an' });
  assert.deepEqual(an.map((o) => o.label), ['+50 % Budget', 'schließen']);
  assert.match(an[0].consequence, /1[\s.  ]500/, 'Konsequenz nennt das neue Budget: 1 500 Tokens');
  assert.match(an[0].consequence, /weiter/);
  assert.match(an[1].consequence, /gilt als geprüft/);
  const aus = budgetOptionen(1000, {});
  assert.deepEqual(aus.map((o) => o.label), ['Weiter mit +50 %', 'Anhalten'], 'Vorgabe aus: alte Knöpfe, wie bisher');
  const kurz = budgetOptionen(60, { WERKBANK_BRAUCHT_DICH: 'an' });
  assert.match(kurz[0].consequence, /90/);   // auch bei kleinen Werten gerundet, nie „NaN“
});

test('Wirkung (S3): „+50 % Budget“ und „schließen“ wirken wie die alten Knöpfe — Faktor 1,5 bleibt', () => {
  assert.equal(budgetWirkung('+50 % Budget'), 'weiter');
  assert.equal(budgetWirkung('schließen'), 'anhalten');
  assert.equal(budgetWirkung('Weiter mit +50 %'), 'weiter', 'alte Fragen (Schalter lief mal an) bleiben beantwortbar');
  assert.equal(budgetWirkung('Anhalten'), 'anhalten');
  assert.equal(budgetWirkung('Etwas anderes'), null);
});

test('Empfehlung (S3): passt zu den neuen Knöpfen, bleibt sonst bei den alten', () => {
  const rAn = budgetEmpfehlung({ WERKBANK_BRAUCHT_DICH: 'an' });
  assert.match(rAn, /\+50 % Budget/); assert.match(rAn, /schließen/);
  const rAus = budgetEmpfehlung({});
  assert.match(rAus, /Weiter mit \+50 %/); assert.match(rAus, /Anhalten/);
  assert.equal(rAus, 'Chat ansehen: kommt der Unter-Chat voran und der Rest ist klein, „Weiter mit +50 %“; sonst „Anhalten“ und den Auftrag schärfen.');
});
