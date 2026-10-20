// Abwesenheits-Bremse (Council-Bedingung 3, F4a): wer nicht da war, dem wird nichts automatisch angenommen; nach der Rückkehr
// läuft die Frist neu. Per Schalter an (WERKBANK_ABWESENHEIT_BREMSE=0 = aus).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bremseAn, naechste, frei, merkeDa } from '../server/anwesenheit.ts';

const H = 3600_000, T = 24 * H, t0 = Date.parse('2026-10-19T08:00:00Z');

test('Schalter: Vorgabe an, 0 = aus', () => {
  assert.equal(bremseAn({}), true); assert.equal(bremseAn({ WERKBANK_ABWESENHEIT_BREMSE: '0' }), false);
});

test('da gewesen → frei; abwesend → nicht frei; nach der Rückkehr erst nach einer vollen Frist', () => {
  let a = naechste(null, t0, T);
  assert.deepEqual(frei(a, t0 + H, T), { frei: false, ab: new Date(t0 + T), grund: 'seit der Rückkehr noch keine volle Frist' }, 'erstes Mal: Frist ab jetzt');
  a = naechste(a, t0 + 20 * H, T);
  assert.equal(frei(a, t0 + T + H, T).frei, true, 'durchgehend da, Frist vorbei');
  // drei Tage Urlaub
  assert.match(frei(a, t0 + 4 * T, T).grund!, /abwesend/);
  a = naechste(a, t0 + 4 * T, T);
  const f = frei(a, t0 + 4 * T + H, T);
  assert.equal(f.frei, false); assert.equal(f.ab!.getTime(), t0 + 5 * T, 'Frist läuft ab der Rückkehr');
  a = naechste(a, t0 + 4 * T + 23 * H, T);
  assert.equal(frei(a, t0 + 5 * T + H, T).frei, true);
  assert.equal(frei(null, t0, T).frei, false);
  assert.equal(frei(null, t0, 0).frei, true, 'Frist 0 (Tests): keine Bremse');
});

test('merkeDa: höchstens ein Schreiben je 5 Minuten, Rückkehr wird erkannt', async () => {
  const db = new Map<string, any>(); let schreiben = 0;
  const col = { findOne: async (q: any) => db.get(q._id) ?? null, updateOne: async (q: any, u: any) => { schreiben++; db.set(q._id, { ...(db.get(q._id) ?? {}), ...u.$set }); } };
  await merkeDa(col, 'u1', T, t0); await merkeDa(col, 'u1', T, t0 + 60_000);
  assert.equal(schreiben, 1);
  await merkeDa(col, 'u1', T, t0 + 3 * T);
  assert.equal(db.get('u1').rueckkehrAt.getTime(), t0 + 3 * T);
});
