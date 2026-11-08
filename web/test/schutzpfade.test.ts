// Paket G: Schutzpfade — Globs, Pflicht (Opus-Endprüfung + Knuts Go) in freigeben(), gebündeltes Sammeln der Endprüfungen.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_schutz_test_${randomBytes(4).toString('hex')}`;
const HOME = realpathSync(mkdtempSync(join(tmpdir(), 'schutz-home-')));
process.env.HOME = HOME;
const S = await import('../server/schutzpfade.ts');
const F = await import('../server/freigabe.ts');
const { connect } = await import('../server/db.ts');
let client: any;
before(async () => { client = await connect(); });
after(async () => { await client.db(process.env.WERKBANK_DB).dropDatabase(); await client.close(); });

test('Glob-Liste: Migrationen, Anmeldung, Abrechnung, Zahlung, Workflows, .env; Harmloses nicht', () => {
  const t = S.schutzTreffer(['src/app.ts', 'db/migrations/001_a.sql', 'web/server/auth/token.ts', 'server/billing/rechnung.ts', 'x/abrechnung.ts', 'pay/payment/stripe.ts', '.github/workflows/ci.yml', '.env', 'web/.env.production', 'README.md', 'src/authors.ts', 'docs/billing-notes.md']);
  assert.deepEqual(t, ['db/migrations/001_a.sql', 'web/server/auth/token.ts', 'server/billing/rechnung.ts', 'x/abrechnung.ts', 'pay/payment/stripe.ts', '.github/workflows/ci.yml', '.env', 'web/.env.production']);
  assert.deepEqual(S.schutzTreffer(['db/migrations/a.sql'], { WERKBANK_SCHUTZPFADE: 'aus' }), [], 'Abschaltung');
  assert.deepEqual(S.schutzTreffer(['sql/x.sql', 'src/a.ts'], { WERKBANK_SCHUTZPFADE: 'sql/**' }), ['sql/x.sql'], 'zusätzliche Globs');
});

const git = (dir: string, ...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } }).trim();
const u = { id: 'u1', email: 'knut@maxenergy.at', name: 'Knut', role: 'ADMIN' } as any;

function repo(datei: string) {
  const bare = join(HOME, `o-${randomBytes(3).toString('hex')}.git`); mkdirSync(bare);
  git(bare, 'init', '--bare', '-b', 'develop');
  const dir = join(HOME, 'work', `r-${randomBytes(3).toString('hex')}`); mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-b', 'develop'); git(dir, 'remote', 'add', 'origin', bare);
  writeFileSync(join(dir, 'a.txt'), 'a'); git(dir, 'add', '.'); git(dir, 'commit', '-m', 'basis'); git(dir, 'push', 'origin', 'develop');
  git(dir, 'fetch', 'origin'); git(dir, 'checkout', '-b', 'feat/x');
  mkdirSync(join(dir, datei, '..'), { recursive: true }); writeFileSync(join(dir, datei), 'neu'); git(dir, 'add', '.'); git(dir, 'commit', '-m', 'aenderung');
  return dir;
}

test('freigeben: Schutzpfad → ohne Endprüfung 409, mit Endprüfung aber ohne Go 409, mit beidem frei; harmloser Diff braucht nichts', async () => {
  const dir = repo('db/migrations/002_x.sql');
  const d: any = { _id: 's1', title: 'Migration', cwd: dir, lastStatus: 'fertig' };
  const f = F.repoFakten(dir);
  assert.deepEqual(f.dateien, ['db/migrations/002_x.sql']);
  const seen = { head: f.head, patchId: f.patchId };
  await assert.rejects(F.freigeben(u, d, seen), (e: any) => e.status === 409 && /Opus-Endprüfung/.test(e.message));
  await assert.rejects(F.freigeben(u, d, { ...seen, schutzGo: true }), (e: any) => /Opus-Endprüfung/.test(e.message), 'Go allein reicht nicht');
  const [e1] = await S.endpruefungen().find({ strand: 's1' }).toArray() as any[];
  assert.equal(e1.status, 'offen');
  assert.equal(await S.endpruefungUrteil(String(e1._id), 'ok', 'opus'), true);
  await assert.rejects(F.freigeben(u, d, seen), (e: any) => /schutzGo/.test(e.message), 'Endprüfung grün, aber kein Go');
  const fg = await F.freigeben(u, d, { ...seen, schutzGo: true });
  assert.equal(fg.aktiv, true);
  // harmloser Diff: wie bisher
  const dir2 = repo('src/app.ts');
  const f2 = F.repoFakten(dir2);
  const fg2 = await F.freigeben(u, { _id: 's2', title: 'harmlos', cwd: dir2, lastStatus: 'fertig' } as any, { head: f2.head, patchId: f2.patchId });
  assert.equal(fg2.aktiv, true);
});

test('Sammeln: alle offenen Endprüfungen in EINEM Bündel, kein Doppelanmelden, Urteil nur einmal', async () => {
  const a = await S.endpruefungAnfordern({ strand: 'sa', titel: 'A', key: 'https://x/a', head: 'h1', treffer: ['db/migrations/1.sql'] });
  const a2 = await S.endpruefungAnfordern({ strand: 'sa', titel: 'A', key: 'https://x/a', head: 'h1', treffer: ['db/migrations/1.sql'] });
  assert.equal(a2._id, a._id, 'je Strang und Kopf genau einmal');
  const b = await S.endpruefungAnfordern({ strand: 'sb', titel: 'B', key: 'https://x/b', head: 'h2', treffer: ['.github/workflows/ci.yml'] });
  const paket = await S.endpruefungSammeln();
  assert.ok(paket && paket.ids.includes(a._id) && paket.ids.includes(b._id));
  assert.equal(new Set((await S.endpruefungen().find({ _id: { $in: [a._id, b._id] } as any }).toArray()).map((x: any) => x.buendel)).size, 1, 'ein gemeinsames Bündel');
  assert.match(paket.auftrag, new RegExp(`${a._id}[\\s\\S]*${b._id}`));
  assert.equal(await S.endpruefungUrteil(a._id, 'maengel', 'opus', 'Rollback fehlt'), true);
  assert.equal(await S.endpruefungUrteil(a._id, 'ok', 'opus'), false);
  assert.equal(await S.endpruefungGruen('sa', 'h1'), false);
});
