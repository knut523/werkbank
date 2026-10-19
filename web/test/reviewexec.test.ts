// `@review deep` führt Tests aus (Release 17c): Erlaubtliste, geleerte Umgebung, Postgres-Vorlage wiederverwenden, Aufräumen.
// Ohne echte Postgres: ein Schein-Läufer spielt psql/createdb/dropdb nach und merkt sich die Datenbanken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as X from '../server/reviewexec.ts';

const TMP = mkdtempSync(join(tmpdir(), 'reviewexec-'));
const SHA = 'c'.repeat(40);
const Z: X.PgZiel = { host: '127.0.0.1', port: '55433', user: 'review', password: 'pw', db: 'postgres' };

/** Schein-Postgres + npm/npx/tar; zeichnet jeden Aufruf mit seiner Umgebung auf. */
function schein(o: { belegt?: number; fremde?: string[]; testFehlschlag?: boolean } = {}) {
  let oid = 100;
  const dbs = new Map<string, { oid: number; template: boolean }>();
  for (const f of o.fremde ?? []) dbs.set(f, { oid: oid++, template: false });
  let belegt = o.belegt ?? 0;
  const calls: { cmd: string; args: string[]; env: Record<string, string> }[] = [];
  const run: X.Run = async (cmd, args, opt) => {
    calls.push({ cmd, args, env: opt.env });
    const name = cmd.split('/').pop();
    if (name === 'psql') {
      const q = args[args.indexOf('-c') + 1];
      let m;
      if ((m = /datname = '([\w]+)'/.exec(q))) return { code: 0, out: dbs.has(m[1]) ? '1\n' : '' };
      if (/ or \(/.test(q)) return { code: 0, out: [...dbs.keys()].filter((n) => n.startsWith('olaf_rv_') || (n.startsWith('olaf_tpl_') && n.endsWith('_bau'))).join('\n') };
      if ((m = /datname like '([^']+)%'/.exec(q))) {
        const pre = m[1].replace(/\\_/g, '_');
        return { code: 0, out: [...dbs].filter(([n]) => n.startsWith(pre) && !n.endsWith('_bau')).sort((a, b) => b[1].oid - a[1].oid).map(([n]) => n).join('\n') };
      }
      if ((m = /alter database (\w+) rename to (\w+)/.exec(q))) { const d = dbs.get(m[1])!; dbs.delete(m[1]); dbs.set(m[2], d); return { code: 0, out: '' }; }
      if ((m = /alter database (\w+) with is_template (\w+)/.exec(q))) { dbs.get(m[1])!.template = m[2] === 'true'; return { code: 0, out: '' }; }
      return { code: 1, out: `unbekannt: ${q}` };
    }
    if (name === 'createdb') {
      const [t, tpl, n] = args[0] === '-T' ? args : [null, null, args[0]];
      if (t && belegt > 0) { belegt--; return { code: 1, out: `createdb: error: database creation failed: ERROR:  source database "${tpl}" is being accessed by other users` }; }
      if (tpl && !dbs.has(tpl)) return { code: 1, out: 'template fehlt' };
      dbs.set(n!, { oid: oid++, template: false }); return { code: 0, out: '' };
    }
    if (name === 'dropdb') { dbs.delete(args[args.length - 1]); return { code: 0, out: '' }; }
    if (name === 'npm') return { code: o.testFehlschlag && args[1] === 'test' ? 1 : 0, out: o.testFehlschlag && args[1] === 'test' ? 'FAIL x.test.ts\n1 failing' : 'ok' };
    if (name === 'npx' || name === 'tar') return { code: 0, out: '' };
    return { code: 127, out: `unbekannt ${cmd}` };
  };
  return { run, dbs, calls, pg: X.pgVia(Z, run) };
}

function worktree(scripts: Record<string, string> = { typecheck: 'tsc', test: 'vitest', build: 'vite build', dev: 'vite' }, prisma = true) {
  const wt = mkdtempSync(join(TMP, 'wt-'));
  writeFileSync(join(wt, 'package.json'), JSON.stringify({ scripts }));
  if (prisma) mkdirSync(join(wt, 'prisma', 'migrations'), { recursive: true });
  return wt;
}
const git = (hash: () => string) => async (args: string[]) => {
  if (args[0] === 'rev-parse') return hash();
  if (args[0] === 'archive') { writeFileSync(args[args.indexOf('-o') + 1], ''); return ''; }
  return '';
};
const job = (wt: string, o: Partial<X.ExecJob> = {}): X.ExecJob => ({ repo: 'WirStrom1/olaf-admin', number: 354, head: SHA, basis: 'b'.repeat(40), wt, paket: '999-x', autor: 'bizarrochris', ...o });
const env = { WERKBANK_REVIEW_PG_URL: 'postgresql://review:pw@127.0.0.1:55433/postgres', HOME: TMP } as any;

test('Erlaubtliste: nur Autor:innen der Liste, nur WirStrom1 und knut523/werkbank; Modus off / spätere Adapter = statisch', () => {
  assert.equal(X.execModus({} as any), 'local-allowlist', 'Vorgabe');
  assert.equal(X.execErlaubt('WirStrom1/olaf-admin', 'bizarrochris', {} as any).ok, true);
  assert.equal(X.execErlaubt('WirStrom1/olaf-admin', 'Knut523', {} as any).ok, true);
  assert.equal(X.execErlaubt('knut523/werkbank', 'knut523', {} as any).ok, true);
  assert.match(X.execErlaubt('WirStrom1/olaf-admin', 'fremd', {} as any).grund, /author is not on the allow-list/);
  assert.match(X.execErlaubt('WirStrom1/olaf-admin', null, {} as any).grund, /author/);
  assert.match(X.execErlaubt('knut523/anderes', 'knut523', {} as any).grund, /repository is not on the allow-list/);
  assert.match(X.execErlaubt('WirStrom1/olaf-admin', 'knut523', { WERKBANK_REVIEW_EXEC: 'off' } as any).grund, /switched off/);
  assert.match(X.execErlaubt('WirStrom1/olaf-admin', 'knut523', { WERKBANK_REVIEW_EXEC: 'docker-remote' } as any).grund, /docker-remote is not available yet/);
  assert.equal(X.execModus({ WERKBANK_REVIEW_EXEC: 'unsinn' } as any), 'off');
});

test('Nicht erlaubt → statisch, kein einziger Befehl', async () => {
  const s = schein();
  const e = await X.lokalAdapter({ run: s.run, pg: s.pg, env, git: git(() => 'a1'.repeat(20)), base: join(TMP, 'b0') }).lauf(job(worktree(), { autor: 'fremd' }));
  assert.equal(e.ausgefuehrt, false); assert.equal(s.calls.length, 0);
  assert.match(e.md, /static deep review — PR author is not on the allow-list/);
  assert.match(e.md, /No commands from the PR were executed/);
});

test('Geleerte Umgebung: keine Tokens/Sitzungen, Wegwerf-HOME (danach weg), npm-Cache je Repo bleibt, Heap-Deckel', async () => {
  const vorher = { ...process.env };
  Object.assign(process.env, { GH_TOKEN: 'ghp_x', GITHUB_TOKEN: 'y', BW_SESSION: 'z', SSH_AUTH_SOCK: '/tmp/a', ANTHROPIC_API_KEY: 'k', WERKBANK_GITHUB_WRITE_TOKEN: 'w' });
  try {
    const s = schein();
    const a = X.lokalAdapter({ run: s.run, pg: null, env: { HOME: TMP } as any, base: join(TMP, 'b1') });
    await a.lauf(job(worktree({ test: 'vitest' }, false)));
    await a.lauf(job(worktree({ test: 'vitest' }, false)));
    const npm = s.calls.filter((c) => c.cmd === 'npm');
    assert.ok(npm.length >= 4);
    for (const c of npm) {
      for (const k of ['GH_TOKEN', 'GITHUB_TOKEN', 'BW_SESSION', 'SSH_AUTH_SOCK', 'ANTHROPIC_API_KEY', 'WERKBANK_GITHUB_WRITE_TOKEN']) assert.equal(c.env[k], undefined, k);
      assert.ok(Object.keys(c.env).every((k) => !/TOKEN|SECRET|KEY|PASSWORD|SESSION/i.test(k) || k === 'NODE_OPTIONS'), Object.keys(c.env).join(','));
      assert.match(c.env.NODE_OPTIONS, /--max-old-space-size=\d+/);
      assert.ok(c.env.HOME.startsWith(join(TMP, 'b1', 'home')));
      assert.equal(existsSync(c.env.HOME), false, 'Wegwerf-HOME aufgeräumt');
    }
    assert.equal(new Set(npm.map((c) => c.env.npm_config_cache)).size, 1, 'npm-Cache wiederverwendet');
    assert.notEqual(npm[0].env.HOME, npm.at(-1)!.env.HOME, 'je Lauf ein eigenes HOME');
    assert.deepEqual(npm.slice(0, 2).map((c) => c.args.slice(0, 2)), [['ci', '--no-audit'], ['run', 'test']], 'nur Skripte der Liste (kein dev)');
  } finally { for (const k of Object.keys(process.env)) if (!(k in vorher)) delete process.env[k]; }
});

test('Vorlage: erster Lauf baut sie einmal (Basis-Migrationen), zweiter Lauf kopiert nur (kein Neu-Migrieren), Delta-Migration je Review, Review-DB danach weg', async () => {
  const s = schein({ fremde: ['olaf_admin', 'postgres'] });
  const hash = 'd'.repeat(40);
  const a = X.lokalAdapter({ run: s.run, pg: s.pg, env, git: git(() => hash), base: join(TMP, 'b2') });
  const e1 = await a.lauf(job(worktree()));
  const tpl = X.vorlageName('WirStrom1/olaf-admin', hash);
  assert.equal(tpl, 'olaf_tpl_admin_dddddddddd');
  assert.equal(e1.ausgefuehrt, true); assert.deepEqual(e1.db, { vorlage: tpl, neu: true, review: 'olaf_rv_admin_354_cccccccc' });
  assert.equal(s.dbs.get(tpl)?.template, true, 'als Template gesperrt (ohne Verbindungen)');
  const migr1 = s.calls.filter((c) => c.cmd === 'npx');
  assert.equal(migr1.length, 2, 'Basis in die Bau-DB + Delta in die Review-DB');
  assert.match(migr1[0].env.DATABASE_URL, /\/olaf_tpl_admin_dddddddddd_bau$/); assert.ok(migr1[0].args.includes('--schema'), 'Basis-Schema aus git archive');
  assert.match(migr1[1].env.DATABASE_URL, /\/olaf_rv_admin_354_cccccccc$/); assert.ok(!migr1[1].args.includes('--schema'), 'Delta mit dem Stand des PRs');
  assert.ok(s.calls.some((c) => c.cmd === 'createdb' && c.args.join(' ') === `-T ${tpl} olaf_rv_admin_354_cccccccc`));
  assert.equal(s.dbs.has('olaf_rv_admin_354_cccccccc'), false, 'Review-DB gelöscht');
  const tests = s.calls.filter((c) => c.cmd === 'npm' && c.args[0] === 'run');
  assert.ok(tests.every((c) => /olaf_rv_admin_354_cccccccc$/.test(c.env.DATABASE_URL)), 'Suiten gegen die Review-DB');
  assert.ok(tests.every((c) => c.env.DB_NAME === 'olaf_rv_admin_354_cccccccc' && c.env.DB_HOST === '127.0.0.1' && c.env.DB_PORT === '55433' && c.env.DB_SSL === 'disable'), 'DB_* für Apps, die nicht DATABASE_URL lesen (olaf-admin prisma.ts)');
  assert.match(e1.md, /tests executed on the workspace VM \(not network-isolated\)/);
  assert.match(e1.md, /built for this migration state/);
  // zweiter Lauf, gleicher Migrationsstand der Basis
  const n = s.calls.length;
  const e2 = await a.lauf(job(worktree(), { number: 355 }));
  const neu = s.calls.slice(n);
  assert.equal(e2.db?.neu, false);
  assert.equal(neu.filter((c) => c.cmd === 'npx').length, 1, 'nur das Delta, keine Basis-Migration');
  assert.ok(!neu.some((c) => c.cmd === 'createdb' && !c.args.includes('-T')), 'keine neue Bau-DB');
  assert.match(e2.md, /reused/);
  assert.ok(s.dbs.has('olaf_admin') && s.dbs.has('postgres'), 'fremde DBs unberührt');
});

test('Aufräumen: höchstens zwei Vorlagen je Repo, andere Repos und fremde DBs bleiben', async () => {
  const s = schein({ fremde: ['olaf_admin', 'olaf_tpl_tariff_app_1111111111'] });
  let hash = '1'.repeat(40);
  const a = X.lokalAdapter({ run: s.run, pg: s.pg, env, git: git(() => hash), base: join(TMP, 'b3') });
  for (const h of ['1', '2', '3', '4']) { hash = h.repeat(40); await a.lauf(job(worktree())); }
  const tpl = [...s.dbs.keys()].filter((n) => n.startsWith('olaf_tpl_admin_')).sort();
  assert.deepEqual(tpl, ['olaf_tpl_admin_3333333333', 'olaf_tpl_admin_4444444444']);
  assert.ok(s.dbs.has('olaf_admin') && s.dbs.has('olaf_tpl_tariff_app_1111111111'));
  assert.ok(![...s.dbs.keys()].some((n) => n.startsWith('olaf_rv_')), 'keine Review-DB übrig');
  // vor dem Löschen wird die Template-Sperre aufgehoben
  assert.ok(s.calls.some((c) => c.cmd === 'psql' && /olaf_tpl_admin_1111111111 with is_template false/.test(c.args.join(' '))));
});

test('Vorlage kurz belegt → Kopie mit Retry; fremde Namen werden nie angefasst', async () => {
  const s = schein({ belegt: 2 });
  s.dbs.set('olaf_tpl_admin_aaaaaaaaaa', { oid: 1, template: true });
  await X.reviewDb(s.pg, 'olaf_tpl_admin_aaaaaaaaaa', 'olaf_rv_admin_1_aaaaaaaa', 5, 1);
  assert.ok(s.dbs.has('olaf_rv_admin_1_aaaaaaaa'));
  assert.equal(s.calls.filter((c) => c.cmd === 'createdb').length, 3);
  await assert.rejects(s.pg.dropdb('olaf_admin'), /fremder DB-Name/);
  await assert.rejects(s.pg.createdb('olaf_rv_x', 'olaf_admin'), /fremder DB-Name/);
  assert.equal(X.unsere('olaf_rv_x; drop database y'), false);
});

test('Ohne Review-Postgres: Suiten laufen, Hinweis statt DB; fehlgeschlagener Schritt mit letzten Zeilen; Ergebnis-Absatz für den Auftrag', async () => {
  const s = schein({ testFehlschlag: true });
  const e = await X.lokalAdapter({ run: s.run, pg: null, env: { HOME: TMP } as any, git: git(() => 'e'.repeat(40)), base: join(TMP, 'b4') }).lauf(job(worktree()));
  assert.equal(e.ausgefuehrt, true); assert.equal(e.db, null);
  assert.match(e.md, /no review database configured/);
  assert.match(e.md, /\| npm run test \| failed \(exit 1\)/);
  assert.match(e.md, /1 failing/);
  const dir = mkdtempSync(join(TMP, 'paket-'));
  assert.match(X.schreibeErgebnis(dir, e), /tests\.md.*tests executed on the workspace VM/);
  assert.ok(existsSync(join(dir, 'tests.md')));
  assert.equal(X.pgZiel({ WERKBANK_REVIEW_PG_URL: 'postgresql://u:p%40@127.0.0.1:55433/postgres' } as any)?.password, 'p@');
  assert.equal(X.pgZiel({} as any), null);
});

test('Pass C: Ausgaben maskiert (DB-URL, Passwort), verwaiste Review-/Bau-DBs weg, kein zweiter Lauf auf derselben Review-DB, Unsinn im Deckel → 20 min', async () => {
  // Ausgabe druckt die Verbindungs-URL
  const s = schein({ fremde: ['olaf_rv_admin_1_deadbeef', 'olaf_tpl_admin_0000000000_bau', 'olaf_admin', 'olaf_tpl_admin_9999999999'] });
  const laut: X.Run = async (cmd, args, o) => (cmd === 'npm' && args[1] === 'test' ? { code: 1, out: `Error: connect ${o.env.DATABASE_URL} failed (password pw)` } : s.run(cmd, args, o));
  const e = await X.lokalAdapter({ run: laut, pg: X.pgVia(Z, s.run), env: { ...env, WERKBANK_REVIEW_PG_URL: 'postgresql://review:geheim123@127.0.0.1:55433/postgres' }, git: git(() => 'f'.repeat(40)), base: join(TMP, 'b5') }).lauf(job(worktree()));
  assert.doesNotMatch(e.md, /geheim123/); assert.match(e.md, /postgresql:\/\/\*\*\*/);
  assert.ok(!s.dbs.has('olaf_rv_admin_1_deadbeef') && !s.dbs.has('olaf_tpl_admin_0000000000_bau'), 'Verwaiste weg');
  assert.ok(s.dbs.has('olaf_admin') && s.dbs.has('olaf_tpl_admin_9999999999'), 'fremde und fertige Vorlagen bleiben');
  // derselbe PR-Stand zweimal gleichzeitig: der zweite bekommt keine DB (zerstört nicht die des ersten)
  const s2 = schein();
  let auf!: () => void; const riegel = new Promise<void>((r) => { auf = r; });
  const langsam: X.Run = async (cmd, args, o) => { if (cmd === 'npm' && args[1] === 'test') await riegel; return s2.run(cmd, args, o); };
  const a = X.lokalAdapter({ run: langsam, pg: s2.pg, env, git: git(() => '7'.repeat(40)), base: join(TMP, 'b6') });
  const p1 = a.lauf(job(worktree({ test: 'x' })));
  await new Promise((r) => setTimeout(r, 50));
  const e2 = await X.lokalAdapter({ run: s2.run, pg: s2.pg, env, git: git(() => '7'.repeat(40)), base: join(TMP, 'b6') }).lauf(job(worktree({ test: 'x' })));
  assert.match(e2.md, /already using its database/);
  assert.ok(s2.dbs.has('olaf_rv_admin_354_cccccccc'), 'DB des ersten Laufs unberührt');
  auf(); await p1;
  assert.equal(s2.dbs.has('olaf_rv_admin_354_cccccccc'), false);
  assert.equal(X.execMinuten({ WERKBANK_REVIEW_EXEC_MIN: '12min' } as any), 20, 'Unsinn → Vorgabe 20 (19.10.)');
  assert.equal(X.execMinuten({ WERKBANK_REVIEW_EXEC_MIN: '20' } as any), 20);
});

test('realRun: Zeitdeckel beendet die ganze Prozessgruppe; Umgebung genau wie übergeben', async () => {
  const t0 = Date.now();
  const kind = 'setTimeout(() => {}, 20000)';
  const r = await X.realRun(process.execPath, ['-e', `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(kind)}], { stdio: 'ignore' }); ${kind}`], { env: { PATH: '/usr/bin:/bin' }, timeoutMs: 400 });
  assert.equal(r.timedOut, true); assert.ok(Date.now() - t0 < 5000);
  const e = await X.realRun(process.execPath, ['-e', 'console.log(Object.keys(process.env).sort().join(","))'], { env: { PATH: '/usr/bin:/bin', HOME: '/tmp/x' }, timeoutMs: 5000 });
  assert.equal(e.code, 0); assert.equal(e.out.trim(), 'HOME,PATH');
});

test('19.10.: Repos ohne `test` (olaf-admin) — die CI-Suiten laufen, passende zuerst, Deploy/Sync nie', async () => {
  const wt = worktree({ typecheck: 'tsc', lint: 'eslint', build: 'next build', 'follow-up:test': 'tsx --test src/lib/follow-up.test.ts',
    'follow-up:test:db': 'tsx --test tools/follow-up-staff-opt-out-db.test.ts', 'otp:test': 'tsx --test tools/otp-mail.test.ts', 'tariff-parity:sync': 'tsx sync.ts' }, false);
  mkdirSync(join(wt, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(wt, '.github', 'workflows', 'deploy.yml'), 'steps:\n - run: npm run typecheck\n - run: npm run otp:test\n - run: npm run follow-up:test:db\n - run: npm run tariff-parity:sync\n - run: npm run otp:test\n - run: npm run cockpit:e2e\n - run: npm run tariff-parity:check\n');
  assert.deepEqual(X.ciSkripte(wt), ['typecheck', 'otp:test', 'follow-up:test:db']);
  const plan = X.skriptPlan(X.SKRIPTE({} as any), X.ciSkripte(wt), JSON.parse(readFileSync(join(wt, 'package.json'), 'utf8')).scripts, ['src/lib/follow-up-staff-opt-out.ts']);
  assert.deepEqual(plan, ['typecheck', 'lint', 'follow-up:test:db', 'build', 'otp:test']);
  const s = schein();
  const e = await X.lokalAdapter({ run: s.run, pg: null, env: { HOME: TMP } as any, git: async (a) => (a[0] === 'diff' ? 'src/lib/follow-up-staff-opt-out.ts\n' : ''), base: join(TMP, 'b9') }).lauf(job(wt));
  assert.deepEqual(e.schritte.map((x) => x.name), ['npm ci', 'npm run typecheck', 'npm run lint', 'npm run follow-up:test:db', 'npm run build', 'npm run otp:test']);
  assert.doesNotMatch(e.md, /tariff-parity:sync|cockpit:e2e|tariff-parity:check/);
  // mit Prisma-Migrationen, aber ohne Review-DB: DB-Suiten nicht „grün“, sondern übersprungen
  mkdirSync(join(wt, 'prisma', 'migrations'), { recursive: true });
  const e2 = await X.lokalAdapter({ run: s.run, pg: null, env: { HOME: TMP } as any, git: async (a) => (a[0] === 'diff' ? 'src/lib/follow-up-staff-opt-out.ts\n' : ''), base: join(TMP, 'b10') }).lauf(job(wt));
  assert.match(e2.md, /\| npm run follow-up:test:db \| skipped \(no review database\)/);
  assert.equal(s.calls.filter((c) => c.args[1] === 'follow-up:test:db').length, 1, 'nur im ersten Lauf (ohne Migrationen) ausgeführt');
});

test('Paket 223: Umgebung der CI-Suiten aus dem Workflow (olaf-admin deploy.yml) — Testwerte ja, Secrets nie, Postgres → Review-DB', async () => {
  const wt = worktree({ 'bulk-registration:test:db': 'tsx --test a', 'pii:test:backfill': 'tsx --test b', 'brevo:events:test': 'tsx --test c', 'parity:test': 'tsx --test d', 'cockpit:test': 'tsx --test e' });
  mkdirSync(join(wt, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(wt, '.github', 'workflows', 'deploy.yml'), readFileSync(join(import.meta.dirname, 'fixtures', 'workflows', 'olaf-admin-deploy.yml'), 'utf8'));
  writeFileSync(join(wt, '.github', 'workflows', 'parity.yml'), 'env:\n  BASE: main\njobs:\n  p:\n    env:\n      READ_TOKEN: ${{ secrets.TARIFF_APP_READ_TOKEN }}\n      REF: ${{ env.BASE }}\n      SHARD: ${{ matrix.shard }}\n      PATH: /evil\n      LD_PRELOAD: /evil.so\n      BASH_ENV: /evil.sh\n      https_proxy: http://evil:1\n    steps:\n      - run: npm run parity:test\n');
  const ci = X.ciUmgebung(wt);
  const bulk = ci.get('bulk-registration:test:db')!;
  assert.equal(bulk.env.BULK_TEST_DATABASE_URL, X.REVIEW_DB); assert.equal(bulk.db, true);
  assert.equal(bulk.env.BETTER_AUTH_SECRET, 'ci-only-test-sessions-not-a-secret'); assert.deepEqual(bulk.secrets, []);
  assert.equal(bulk.env.NODE_OPTIONS, undefined, 'Shard/Heap nie aus der CI');
  assert.equal(ci.get('pii:test:backfill')!.env.PII_TEST_DATABASE_URL, X.REVIEW_DB, 'Inline-VAR=wert vor npm run');
  assert.equal(ci.get('brevo:events:test')!.env.TZ, 'Europe/Vienna', 'erstes Vorkommen gilt');
  // Pass C: submit-route:test läuft im checks-Job ohne und im db-Job mit SUBMIT_TEST_DATABASE_URL → Vereinigung
  assert.equal(ci.get('submit-route:test')!.env.SUBMIT_TEST_DATABASE_URL, X.REVIEW_DB);
  writeFileSync(join(wt, '.github', 'workflows', 'inline.yml'), 'jobs:\n  i:\n    steps:\n      - run: |\n          STRIPE_KEY=${{ secrets.STRIPE_KEY }} npm run pay:test\n          TZ="Europe/Vienna" MSG=\'a b\' npm run quote:test\n');
  const ci2 = X.ciUmgebung(wt);
  assert.deepEqual(ci2.get('pay:test')!.secrets, ['STRIPE_KEY']);
  assert.deepEqual(ci2.get('quote:test')!.env, { TZ: 'Europe/Vienna', MSG: 'a b' });
  const p = ci.get('parity:test')!;
  assert.deepEqual(p.secrets, ['TARIFF_APP_READ_TOKEN']); assert.equal(p.env.REF, 'main'); assert.equal(p.env.SHARD, undefined); assert.equal(p.env.PATH, undefined);
  assert.deepEqual(Object.keys(p.env).sort(), ['BASE', 'REF'], 'LD_*, BASH_ENV, Proxy nie');
  for (const e of ci.values()) for (const [k, v] of Object.entries(e.env)) { assert.doesNotMatch(v, /\$\{\{/, k); assert.doesNotMatch(k, /^DB_/, 'DB_* setzt die Review-DB'); }
  // Lauf: Secret-Suite übersprungen mit Namen; DB-Suite bekommt die Review-DB unter dem CI-Namen; ohne DB übersprungen
  const s = schein();
  const e = await X.lokalAdapter({ run: s.run, pg: s.pg, env, git: git(() => 'e'.repeat(40)), base: join(TMP, 'b223') }).lauf(job(wt));
  assert.match(e.md, /\| npm run parity:test \| skipped \(needs secret TARIFF_APP_READ_TOKEN\)/);
  const bulkRun = s.calls.find((c) => c.args[1] === 'bulk-registration:test:db')!;
  assert.match(bulkRun.env.BULK_TEST_DATABASE_URL, /\/olaf_rv_admin_354_cccccccc$/); assert.equal(bulkRun.env.BETTER_AUTH_SECRET, 'ci-only-test-sessions-not-a-secret');
  assert.match(bulkRun.env.NODE_OPTIONS, /--max-old-space-size/); assert.ok(!bulkRun.env.PATH.includes('/evil'));
  assert.equal(s.calls.some((c) => c.args[1] === 'parity:test'), false);
  const s2 = schein();
  const e2 = await X.lokalAdapter({ run: s2.run, pg: null, env: { HOME: TMP } as any, git: git(() => 'e'.repeat(40)), base: join(TMP, 'b224') }).lauf(job(wt));
  assert.match(e2.md, /\| npm run bulk-registration:test:db \| skipped \(no review database\)/);
  assert.match(e2.md, /\| npm run cockpit:test \| passed/);
});
