// „Braucht dich“-Schließen und Strang-Archivierung (R30b Teil A, S2): (c)-Punkte werden mit Log-Zeile und
// Nachricht an den Strang geschlossen (nur mit Schalter, nie still), und „archivieren“ setzt einen Strang auf
// erledigt, ohne zu löschen (aufraeumen.ts-Muster, Compare-and-Set). Eigene Test-Mongo.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_brauchtab_test_${randomBytes(4).toString('hex')}`;
const T = await import('../server/brauchtab.ts');
const { connect, wb, closeDb } = await import('../server/db.ts');
let client: any;
before(async () => { client = await connect(); });
after(async () => { await client.db(process.env.WERKBANK_DB).dropDatabase(); await closeDb(); await client.close(); });

const now = Date.UTC(2026, 10, 2, 10);
const run = (id: string, o: Record<string, unknown> = {}) => ({ _id: id, userId: 'u1', kind: 'strand', title: id, zustand: 'wartet', lastStatus: 'braucht', lauf: id, startedAt: new Date(now - 7200_000), ...o });

test('Schließen ohne Schalter schreibt nichts; mit Schalter: Log-Zeile, Nachricht an den Strang', async () => {
  const R = wb().collection('orchestrator_runs');
  const L = wb().collection('entscheidungs_log');
  await R.insertOne(run('dd100001') as any);
  const g = { strand: 'dd100001', titel: 'Ticker-Fix', kennung: 'b-dd100001-abc123', frage: 'Push-Ok für den Zweig, D1 entscheiden',
    grund: 'Paket 269 ist im Live-Stand (Merge-Commit nach Paketnummer)' };
  assert.deepEqual(await T.schliesseBraucht('u1', [], { env: {} }), [], 'leer schließt nichts');
  assert.deepEqual(await T.schliesseBraucht('u1', [g], { env: {} }), [], 'Vorgabe aus: nichts');

  const w = await T.schliesseBraucht('u1', [g], { env: { WERKBANK_BRAUCHT_DICH: 'an' }, now });
  assert.deepEqual(w.map((x) => x.strand), ['dd100001']);
  const z: any = await L.findOne({ userId: 'u1', kennung: 'b-dd100001-abc123' });
  assert.ok(z, 'Log-Zeile steht im Entscheidungs-Log');
  assert.equal(z.auto, true);
  assert.equal(z.durch, 'auto');
  assert.match(z.antwort, /Paket 269/);
  const d: any = await R.findOne({ _id: 'dd100001' as any });
  const m = (d.meldungen ?? []).find((x: any) => /Braucht dich/.test(String(x.text)));
  assert.ok(m, 'Nachricht an den Strang geht raus');
  assert.match(String(m.text), /Paket 269 ist im Live-Stand/);
  assert.equal(String(m.art), 'braucht-geschlossen');
});

test('Log-Zeile ist nachvollziehbar: Frage, Begründung, Strang — nicht nur ein Häkchen', async () => {
  const z = T.logZeile('u1', 'dd100009', 'b-dd100009-def', 'D1–D3 vom Admin-UAT entscheiden', { antwort: 'automatisch geschlossen: schon beantwortet', durch: 'auto', auto: true });
  assert.equal(z.kennung, 'b-dd100009-def');
  assert.equal(z.userId, 'u1');
  assert.equal(z.strand?.id, 'dd100009');
  assert.match(z.frage, /Admin-UAT/);
  assert.equal(z.auto, true);
});

test('Archivieren (Compare-and-Set): nur einmal, nur offen, nur mit Schalter', async () => {
  const R = wb().collection('orchestrator_runs');
  await R.insertMany([run('dd100003', { zustand: 'fertig' }), run('dd100004', { zustand: 'fertig', reviewedBy: 'auto' })] as any[]);
  assert.equal(await T.archiviere('u1', 'dd100003', 'Paket 269 ist im Live-Stand', { env: {} }), false, 'ohne Schalter: nichts');
  assert.equal(await T.archiviere('u1', 'dd100003', 'Paket 269 ist im Live-Stand', { env: { WERKBANK_BRAUCHT_DICH: 'an' }, now }), true);
  const d: any = await R.findOne({ _id: 'dd100003' as any });
  assert.equal(d.reviewedBy, 'auto');
  assert.equal(d.zustand, 'erledigt');
  assert.match(d.zustandGrund, /Paket 269/);
  assert.equal(await T.archiviere('u1', 'dd100003', 'nochmal', { env: { WERKBANK_BRAUCHT_DICH: 'an' }, now }), false, 'zweites Mal: schon erledigt');
  assert.equal(await T.archiviere('u1', 'dd100004', 'schon weg', { env: { WERKBANK_BRAUCHT_DICH: 'an' }, now }), false, 'schon von auto weggeräumt');
  assert.equal(await T.archiviere('u2', 'dd100003', 'fremd', { env: { WERKBANK_BRAUCHT_DICH: 'an' }, now }), false, 'nur eigene');
});

test('Zurückholen: nur automatisch Archiviertes, wie aufraeumen.ts; danach nie wieder automatisch', async () => {
  assert.equal(await T.zurueckholen('u2', 'dd100003'), false);
  assert.equal(await T.zurueckholen('u1', 'dd100003'), true);
  const d: any = await wb().collection('orchestrator_runs').findOne({ _id: 'dd100003' as any });
  assert.equal(d.reviewedAt, null);
  assert.equal(d.zustand, 'fertig');
  assert.equal(d.nichtAutoSchliessen, true);
  assert.equal(await T.zurueckholen('u1', 'dd100003'), false, 'zweites Zurückholen: kein auto-Eintrag mehr da');
});

test('Fakten aus der Live-Maschinerie: Merge nach Paketnummer zählt als „paket live“ (Inhalt, nicht Abstammung)', async () => {
  const idx = T.testIndex({ entries: [{ branch: 'release/werkbank-2026-11-02', sha: '1111111111111111111111111111111111111111' }],
    merges: [{ sha: '2222222222222222222222222222222222222222', at: now - 3600_000, subject: 'Merge branch fix/ticker into dev: Paket 269 Ticker' }] });
  assert.equal(await T.paketLiveFakten(idx).live(269), true, 'Paket 269 im Betreff eines Merges, der im Live-Zweig liegt');
  assert.equal(await T.paketLiveFakten(idx).live(302), false, 'anderes Paket nicht');
  assert.equal(await T.paketLiveFakten(null).live(269), false, 'ohne Index kein Beleg — kein stilles Schließen');
});

test('Pass C: Schließen ist idempotent — der 10-min-Takt schreibt Log-Zeile und Nachricht nur einmal', async () => {
  const R = wb().collection('orchestrator_runs');
  const L = wb().collection('entscheidungs_log');
  await R.insertOne(run('dd100020') as any);
  const g = { strand: 'dd100020', titel: 'T', kennung: 'b-dd100020-xyz', frage: 'Push-Ok', grund: 'Paket 270 ist im Live-Stand' };
  const env = { WERKBANK_BRAUCHT_DICH: 'an' };
  const a = await T.schliesseBraucht('u1', [g], { env, now });
  const [b, c] = await Promise.all([T.schliesseBraucht('u1', [g], { env, now: now + 600_000 }), T.schliesseBraucht('u1', [g], { env, now: now + 600_001 })]);
  assert.equal(a.length, 1); assert.equal(b.length + c.length, 0, 'zweiter und gleichzeitiger Takt: nichts');
  assert.equal(await L.countDocuments({ userId: 'u1', kennung: 'b-dd100020-xyz' }), 1);
  const d: any = await R.findOne({ _id: 'dd100020' as any });
  assert.equal((d.meldungen ?? []).length, 1);
});
