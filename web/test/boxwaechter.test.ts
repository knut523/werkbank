// Box-Heartbeat (19.10.): Stufen aus echtem Speicher + Host frei; Meldung nur beim Stufenwechsel.
// Hysterese (q-d76f5c, 23.10.2026): „knapp“ unter 6 GB, „grün“ erst wieder ab 8 GB — ohne Pendeln;
// höchstens eine warnung/ok-Meldung je 30 min; kritisch geht ungehindert sofort raus.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { MongoClient } from 'mongodb';

process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_test_box_${randomBytes(4).toString('hex')}`;
const db = await import('../server/db.ts');
let raw: MongoClient;
before(async () => { await db.connect(); raw = await MongoClient.connect(TEST_MONGO); });
after(async () => { await raw.db(process.env.WERKBANK_DB).dropDatabase(); await raw.close(); process.exit(0); });

const W = () => raw.db(process.env.WERKBANK_DB!);

const B = await import('../server/boxwaechter.ts');
const T0 = 1_700_000_000_000;

test('Stufen: ok · warnung (keine schweren Starts) · kritisch (gleich eng)', () => {
  assert.equal(B.boxStufe({ echtGb: 3, hostFreiGb: 14 }), 'ok');
  assert.equal(B.boxStufe({ echtGb: 9.5, hostFreiGb: 14 }), 'warnung');
  assert.equal(B.boxStufe({ echtGb: 3, hostFreiGb: 5 }), 'warnung', 'Nachbarn auf dem Host');
  assert.equal(B.boxStufe({ echtGb: 11.5, hostFreiGb: 14 }), 'kritisch');
  assert.equal(B.boxStufe({ echtGb: 3, hostFreiGb: 2.5 }), 'kritisch');
  assert.equal(B.boxStufe(null), 'ok', 'nicht lesbar → nicht falsch alarmieren');
});

test('Hysterese: pendelnde Folge 5,5 → 6,5 → 5,8 → 7,0 → 8,5 meldet genau einmal „knapp“ und einmal „grün“', () => {
  // alt = gemeldete Stufe; unter 6 GB knapp, zurück auf ok erst ab 8 GB. 6,5 und 5,8 und 7,0 bleiben in „warnung“.
  assert.equal(B.boxStufe({ echtGb: 2, hostFreiGb: 5.5 }, 'ok'), 'warnung', '5,5: knapp');
  assert.equal(B.boxStufe({ echtGb: 2, hostFreiGb: 6.5 }, 'warnung'), 'warnung', '6,5: bleibt knapp (grün erst ab 8)');
  assert.equal(B.boxStufe({ echtGb: 2, hostFreiGb: 5.8 }, 'warnung'), 'warnung', '5,8: bleibt knapp');
  assert.equal(B.boxStufe({ echtGb: 2, hostFreiGb: 7.0 }, 'warnung'), 'warnung', '7,0: bleibt knapp');
  assert.equal(B.boxStufe({ echtGb: 2, hostFreiGb: 8.5 }, 'warnung'), 'ok', '8,5: wieder grün');
  assert.equal(B.boxStufe({ echtGb: 2, hostFreiGb: 8.0 }, 'warnung'), 'ok', 'genau 8 zählt als grün');
  assert.equal(B.boxStufe({ echtGb: 2, hostFreiGb: 6.5 }, 'ok'), 'ok', 'von grün aus ist 6,5 grün — knapp erst unter 6');
});

test('Hysterese-Schwellen sind einstellbar (SPEICHER: knapp 6, grün 8, Meldungspause 30 min)', () => {
  assert.equal(B.SPEICHER.hostMinGb, 6);
  assert.equal(B.SPEICHER.hostGruenGb, 8);
  assert.equal(B.SPEICHER.meldungPauseMin, 30);
});

test('Hysterese-Schwellen einstellbar: engere Grenzen verschieben die Wechsel', () => {
  const sp = { ...B.SPEICHER, hostMinGb: 4, hostGruenGb: 5 };
  assert.equal(B.boxStufe({ echtGb: 2, hostFreiGb: 3.9 }, 'ok', sp), 'warnung', 'unter knapp 4');
  assert.equal(B.boxStufe({ echtGb: 2, hostFreiGb: 4.5 }, 'ok', sp), 'ok', '4,5 über knapp 4 → ok');
  assert.equal(B.boxStufe({ echtGb: 2, hostFreiGb: 4.5 }, 'warnung', sp), 'warnung', 'grün erst ab 5');
  assert.equal(B.boxStufe({ echtGb: 2, hostFreiGb: 5.1 }, 'warnung', sp), 'ok', '5,1 über grün 5');
});

test('kritisch geht trotz der Zeitdrossel sofort raus', async () => {
  const W_ = W();
  await W_.collection('meta').deleteOne({ _id: 'box_heartbeat' as any });
  const meldungen: string[] = [];
  const deps = {
    userById: async () => null,
    ownerId: async () => null,
    log: (m: string, d: any) => { meldungen.push(`${m} ${JSON.stringify(d ?? {})}`); },
    speicher: () => ({ echtGb: 2, hostFreiGb: 5.5 }),   // knapp
  };
  const r1 = await B.boxTick(deps, T0);
  assert.equal(r1, 'warnung', 'erste Meldung: knapp');
  // zwölf Takte im Minutentakt, Speicher pendelt — keine weitere Meldung innerhalb 30 min:
  for (let i = 1; i <= 12; i++) {
    const sp = i % 2 ? { echtGb: 2, hostFreiGb: 6.5 } : { echtGb: 2, hostFreiGb: 5.8 };
    (deps as any).speicher = () => sp;
    const r = await B.boxTick(deps, T0 + i * 60_000);
    assert.equal(r, null, `Takt ${i}: gedrosselt`);
  }
  // nach der Pause wieder eine Meldung (hier: grün):
  (deps as any).speicher = () => ({ echtGb: 2, hostFreiGb: 8.5 });
  assert.equal(await B.boxTick(deps, T0 + 31 * 60_000), 'ok', 'nach 30 min wieder eine Meldung');
  // kritisch sofort, ungehindert — auch mitten in der Pause:
  (deps as any).speicher = () => ({ echtGb: 2, hostFreiGb: 2.5 });
  assert.equal(await B.boxTick(deps, T0 + 32 * 60_000), 'kritisch', 'kritisch ohne Pause');
  // gleiche Stufe noch einmal: keine Wiederholung (Wechsel, kein Taktgeber)
  assert.equal(await B.boxTick(deps, T0 + 33 * 60_000), null, 'kritisch bleibt kritisch — kein erneutes Melden ohne Wechsel');
  // kritisch → ok wird wie jede normale Meldung nach der Pause nachgeholt (kritisch wurde eben gemeldet):
  (deps as any).speicher = () => ({ echtGb: 2, hostFreiGb: 9 });
  assert.equal(await B.boxTick(deps, T0 + 34 * 60_000), null, 'grün-Meldung folgt erst nach der Pause');
  (deps as any).speicher = () => ({ echtGb: 2, hostFreiGb: 9 });
  assert.equal(await B.boxTick(deps, T0 + 62 * 60_000), 'ok', '… hier');
});
