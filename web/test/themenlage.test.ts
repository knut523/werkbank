// B2 (Knut 07.11., Release 2.0): Status nach Thema — eine Zeile je Thema, wer ist dran. Für v2 (Arbeit) und `orch lage`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { themenLage, lageText } from '../server/themenlage.ts';

const z = (id: string, thema: string, zustand: string, titel = `Strang ${id}`) => ({ id, thema, zustand, titel }) as any;

test('je Thema eine Zeile mit Zählern; dran nach Vorrang Knut → Hauptsitzung → Unter-Chat → niemand', () => {
  const offen = [
    z('a1', 'Tarifrechner', 'laeuft'), z('a2', 'Tarifrechner', 'wartet', 'Rechner: Rundung'),
    z('b1', 'Bot', 'haengt', 'Bot: Persona'), z('b2', 'Bot', 'laeuft'),
    z('c1', 'Admin', 'laeuft'), z('c2', 'Admin', 'schlange'),
    z('d1', 'Werkbank', 'fertig', 'Werkbank 2.0'),
  ];
  const erledigt = [z('e1', 'Tarifrechner', 'erledigt'), z('e2', 'Ruhig', 'erledigt')];
  const l = themenLage(offen, erledigt, { bedarfJe: new Map([['c1', 1]]) });
  const t = (th: string) => l.find((x) => x.thema === th)!;
  assert.deepEqual([t('Tarifrechner').laeuft, t('Tarifrechner').wartetKnut, t('Tarifrechner').erledigt], [1, 1, 1]);
  assert.equal(t('Tarifrechner').dran, 'Knut'); assert.match(t('Tarifrechner').warum, /Rückfrage/); assert.equal(t('Tarifrechner').als!.titel, 'Rechner: Rundung');
  assert.equal(t('Bot').dran, 'Hauptsitzung'); assert.match(t('Bot').warum, /hängt/);
  assert.equal(t('Admin').dran, 'Hauptsitzung', 'offener Bedarf'); assert.match(t('Admin').warum, /Bedarf/);
  assert.equal(t('Werkbank').dran, 'Knut'); assert.match(t('Werkbank').warum, /abnehmen/);
  assert.equal(t('Ruhig').dran, 'niemand'); assert.equal(t('Ruhig').offen, 0);
  assert.deepEqual(l.map((x) => x.dran), ['Knut', 'Knut', 'Hauptsitzung', 'Hauptsitzung', 'niemand'], 'Knut zuerst, „niemand“ zuletzt');
});

test('Unter-Chat ist dran, wenn nur gearbeitet wird; blockiert geht an Knut', () => {
  const l = themenLage([z('a', 'X', 'laeuft'), z('b', 'Y', 'blockiert', 'Y: G0')], []);
  assert.equal(l.find((x) => x.thema === 'X')!.dran, 'Unter-Chat');
  const y = l.find((x) => x.thema === 'Y')!; assert.equal(y.dran, 'Knut'); assert.equal(y.blockiert, 1);
});

test('Textzeile für `orch lage`: erledigt · läuft · blockiert · wer ist dran', () => {
  const [zeile] = themenLage([z('a', 'Bot', 'haengt', 'Bot: Persona'), z('b', 'Bot', 'laeuft')], [z('c', 'Bot', 'erledigt')]);
  const s = lageText(zeile);
  assert.match(s, /^Bot — /); assert.match(s, /1 läuft/); assert.match(s, /1 hängt/); assert.match(s, /1 erledigt/);
  assert.match(s, /dran: Hauptsitzung — hängt: „Bot: Persona“ \(b?a\)/);
});
