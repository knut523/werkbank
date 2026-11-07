// Release 2.0 (B3, Knut 07.11.; Council 07.11. Punkte 3 und 8): Melious hart aus, Energie-Untergrenze, Warnungen, Claude-Luft vor dem Start.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meliousHartAus, meliousBoden, bodenGrund } from '../server/melious.ts';
import { warnungenAus, claudeLuft, luftPruefungAn } from '../server/kontingent.ts';

test('hart aus nur mit WERKBANK_MELIOUS=aus; Notgrenze mit Vorgabe 5 und gültigen Werten', () => {
  assert.equal(meliousHartAus({ WERKBANK_MELIOUS: 'aus' }), true);
  assert.equal(meliousHartAus({ WERKBANK_MELIOUS: ' AUS ' }), true);
  assert.equal(meliousHartAus({}), false);
  assert.equal(meliousHartAus({ WERKBANK_MELIOUS: 'an' }), false);
  assert.equal(meliousBoden({}), 5);
  assert.equal(meliousBoden({ WERKBANK_MELIOUS_BODEN: '15' }), 15);
  assert.equal(meliousBoden({ WERKBANK_MELIOUS_BODEN: '0' }), 0);
  assert.equal(meliousBoden({ WERKBANK_MELIOUS_BODEN: 'x' }), 5);
  assert.equal(meliousBoden({ WERKBANK_MELIOUS_BODEN: '150' }), 5);
});

test('Untergrenze: darunter Sperrgrund mit echtem Prozent, darüber und unbekannt frei', () => {
  assert.match(bodenGrund(0.19, false, 20)!, /19 % — unter der Notgrenze 20 %/);
  assert.match(bodenGrund(0.05, true, 20)!, /geschätzt bei 5 %/);
  assert.equal(bodenGrund(0.2, false, 20), null);
  assert.equal(bodenGrund(null, false, 20), null);
  assert.equal(bodenGrund(0.1, false, 0), null, 'Boden 0 = aus');
});

const mel = (o: Partial<{ restProzent: number | null; sperre: string | null; fuellProzent: number | null; geschaetzt: boolean }> = {}) =>
  ({ restProzent: 50, geschaetzt: false, sperre: null, monat: [], monatProzent: 10, fuellProzent: 50, ...o });
const now = Date.UTC(2026, 10, 7, 12);

test('Warnungen: hart aus, gesperrt, Energie unter 10 %, Claude knapp oder erschöpft — sonst keine', () => {
  const frei = [{ id: 'a', label: 'A', erschoepftBis: null, zuegeHeute: 3 }];
  assert.deepEqual(warnungenAus({ melious: mel(), hartAus: false, konten: frei, auslastung: { fuenfH: 40, siebenT: 30, reset: null }, now }), []);
  const w1 = warnungenAus({ melious: null, hartAus: true, konten: frei, auslastung: null, now });
  assert.equal(w1.length, 1); assert.match(w1[0], /hart ausgeschaltet/);
  const w2 = warnungenAus({ melious: mel({ fuellProzent: 4, restProzent: 0, sperre: 'Energie bei 4 % — unter der Notgrenze 5 %' }), hartAus: false, konten: frei, auslastung: null, now });
  assert.ok(w2.some((w) => /gesperrt: Energie bei 4 %/.test(w)) && w2.some((w) => /unter 10 %/.test(w)), w2.join(' | '));
  const w3 = warnungenAus({ melious: mel(), hartAus: false, konten: frei, auslastung: { fuenfH: 85, siebenT: 81, reset: '15:00' }, now });
  assert.equal(w3.length, 1); assert.match(w3[0], /unter 20 % frei\): 5 h 85 % · Woche 81 %/); assert.match(w3[0], /frei ab 15:00/);
  const w5 = warnungenAus({ melious: { ...mel(), heuteEnergie: 200_500, nachfuellungTag: 192_000 }, hartAus: false, konten: frei, auslastung: null, now });
  assert.equal(w5.length, 1); assert.match(w5[0], /Verbrauch heute 200\.500 Energie liegt über dem Tagesnachladen \(192\.000\)/);
  assert.equal(warnungenAus({ melious: { ...mel(), heuteEnergie: 100, nachfuellungTag: 192_000 }, hartAus: false, konten: frei, auslastung: null, now }).length, 0);
  const alle = [{ id: 'a', label: 'A', erschoepftBis: now + 3600_000, zuegeHeute: 9 }, { id: 'b', label: 'B', erschoepftBis: now + 7200_000, zuegeHeute: 1 }];
  const w4 = warnungenAus({ melious: mel(), hartAus: false, konten: alle, auslastung: { fuenfH: 99, siebenT: 99, reset: null }, now });
  assert.equal(w4.length, 1); assert.match(w4[0], /Alle Claude-Konten erschöpft/);
});

test('Claude-Luft vor dem Start: ein freies Konto genügt; alle erschöpft → kein Start mit frühestem Reset; abschaltbar', () => {
  const k = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
  assert.equal(claudeLuft([], {}, now).frei, true, 'ohne Kontenliste nicht blockieren');
  assert.equal(claudeLuft(k, { a: now + 1000 }, now).frei, true);
  assert.equal(claudeLuft(k, { a: now - 1000, b: now + 1000 }, now).frei, true, 'abgelaufene Sperre zählt als frei');
  const l = claudeLuft(k, { a: now + 7200_000, b: now + 3600_000 }, now);
  assert.equal(l.frei, false); assert.equal(l.bis, now + 3600_000); assert.match(l.text!, /Kein Claude-Konto frei/);
  assert.equal(luftPruefungAn({}), true);
  assert.equal(luftPruefungAn({ WERKBANK_KONTINGENT_PRUEFUNG: 'aus' }), false);
});
