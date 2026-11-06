// Phase 4: zwei gleichzeitige Meldungen desselben Bedarfs ergeben einen Eintrag (eindeutiger Index für offene Bedarfe). Eigene Test-Mongo.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_bedarf_test_${randomBytes(4).toString('hex')}`;
const B = await import('../server/bedarf.ts');
const { connect, wb } = await import('../server/db.ts');
let client: any;
before(async () => { client = await connect(); });
after(async () => { await client.db(process.env.WERKBANK_DB).dropDatabase(); await client.close(); });

test('gleichzeitig zweimal derselbe Bedarf → ein offener Eintrag, die zweite Meldung ist „schon da“', async () => {
  const u = { id: 'k' } as any, d = { _id: 'aa000001', title: 'S' };
  const p = { art: 'zugang' as const, text: 'Zugang zu /w/x', pfad: '/w/x' };
  const r = await Promise.all([B.bedarfMelden(u, d, p), B.bedarfMelden(u, d, p), B.bedarfMelden(u, d, p)]);
  assert.equal(r.filter((x) => x.neu).length, 1);
  assert.equal(new Set(r.map((x) => x.id)).size, 1, 'alle bekommen dieselbe Kennung');
  assert.equal(await wb().collection('strang_bedarf').countDocuments({ status: 'offen' }), 1);
});
