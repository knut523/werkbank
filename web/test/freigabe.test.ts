// Review → Freigabe → Push (docs/plan-hauptchat-monitor.md §9, Council R3, Bedingung 9): Vorschau nur aus dem Register und
// ohne Körper/Weiterleitung, Entscheidungen aus dem Bericht, Freigabe an Kopf + Patch gebunden (sauber, gesehener Stand),
// Prüfweg nach Rebase, Zurückziehen, gepusht. Echte git-Repos in tmp, eigene Test-Mongo.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

const tag = randomBytes(4).toString('hex');
process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_freigabe_test_${tag}`;
const HOME = realpathSync(mkdtempSync(join(tmpdir(), 'freigabe-home-')));
process.env.HOME = HOME;
const F = await import('../server/freigabe.ts');
const { connect } = await import('../server/db.ts');
let client: any;
before(async () => { client = await connect(); });
after(async () => { await client.db(process.env.WERKBANK_DB).dropDatabase(); await client.close(); });

const u = { id: 'u1', email: 'knut@maxenergy.at', name: 'Knut', role: 'ADMIN' } as any;

// ---------- Vorschau ----------

const YAML = `
- port: 3070, 3080, 3090
  was: Live-Werkbank
  schutz: live
  link: https://3080--main--dev--knut.ws.konekto.energy
- port: 3136, 4136
  was: Flex-Admin Umfragen
  paket: 148
  link: https://4136--main--dev--knut.ws.konekto.energy
- port: 55433
  was: Postgres
  paket: 148
  link: https://55433--main--dev--knut.ws.konekto.energy
- port: 4139
  was: Hardware-Liste
  paket: 152
  link: https://4139--main--dev--knut.ws.konekto.energy/hardware
- port: 4140
  was: fremd
  paket: 999
  link: https://evil.example.com:4140/
`;

test('Vorschau: nur Register-Einträge zum Paket bzw. mit Port im Bericht; Infrastruktur und fremde Hosts nie', () => {
  const v = F.vorschauEintraege(YAML, 148, []);
  assert.deepEqual(v.map((x) => x.port), [4136], 'Postgres 55433 gesperrt, Live (schutz) nie');
  const w = F.vorschauEintraege(YAML, 147, ['https://4139--main--dev--knut.ws.konekto.energy/hardware', 'https://4140--main--dev--knut.ws.konekto.energy/']);
  assert.deepEqual(w.map((x) => x.port), [4139], 'Port aus dem Bericht nur, wenn er im Register steht; fremder Host nie');
  assert.deepEqual(F.vorschauEintraege('kein: [yaml', 148, []), []);
});

test('Vorschau-Prüfung: keine Weiterleitung, Körper nie gelesen, 502 = Proxy ohne Ziel, zu = antwortet nicht', async () => {
  let bodyRead = false;
  const srv = (code: number, extra: Record<string, string> = {}) => new Promise<Server>((r) => {
    const s = createServer((req, res) => { res.writeHead(code, extra); const big = 'x'.repeat(1 << 20); res.write(big); res.end(); });
    s.listen(0, '127.0.0.1', () => r(s));
  });
  const ok = await srv(200), redir = await srv(302, { location: 'http://169.254.169.254/' }), prox = await srv(502);
  const port = (s: Server) => (s.address() as any).port;
  const p = (s: Server) => F.pruefeVorschau({ port: port(s), link: 'x', was: '' }, true);
  assert.equal((await p(ok)).ergebnis, 'läuft');
  const r = await p(redir); assert.equal(r.status, 302); assert.equal(r.ergebnis, 'läuft', 'Weiterleitung nicht verfolgt');
  assert.equal((await p(prox)).ergebnis, 'Proxy läuft, Ziel antwortet nicht');
  const zu = (s: Server) => new Promise<void>((r) => { s.closeAllConnections(); s.close(() => r()); });
  const closed = port(ok); await zu(ok);
  assert.equal((await F.pruefeVorschau({ port: closed, link: 'x', was: '' }, true)).ergebnis, 'antwortet nicht');
  await zu(redir); await zu(prox);
  void bodyRead;
});

// ---------- Entscheidungen ----------

test('Entscheidungen: D-/E-Blöcke zeilengenau, nicht in Codezäunen, „Knut:“ am Blockende', () => {
  const md = [
    '## Offene Entscheidungen', '',
    '**D1 — Status-Begriffe vereinheitlichen?**', '- a) ja', '- b) nein', '- Empfehlung: a', '  - Knut:', '',
    '**E-147-2 · Event-Name**', '- a) calc_done', '  - Knut: a, passt', '',
    '```', '**D9 — im Codezaun, zählt nicht**', '```',
    '## Danach', '**kein Block**',
  ].join('\n');
  const e = F.entscheidungen(md);
  assert.deepEqual(e.map((x) => x.id), ['D1', 'E-147-2']);
  assert.equal(e[0].titel, 'Status-Begriffe vereinheitlichen?');
  assert.equal(e[0].knut, '');
  assert.equal(e[1].knut, 'a, passt');
  assert.match(e[0].text, /Empfehlung: a/);
});

// ---------- Freigabe an echten Repos ----------

const sh = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
function setup() {
  const work = join(HOME, 'work', 'knut'); mkdirSync(work, { recursive: true });
  const origin = mkdtempSync(join(HOME, 'origin-')) + '.git';
  sh(HOME, 'init', '-q', '--bare', '-b', 'develop', origin);
  const seed = mkdtempSync(join(HOME, 'seed-'));
  sh(seed, 'clone', '-q', origin, '.');
  writeFileSync(join(seed, 'a.txt'), 'a\n'); sh(seed, 'add', '.'); sh(seed, 'commit', '-q', '-m', 'basis'); sh(seed, 'push', '-q', 'origin', 'HEAD:develop');
  const wt = mkdtempSync(join(work, 'strang-'));
  sh(wt, 'clone', '-q', origin, '.');
  sh(wt, 'checkout', '-q', '-b', 'feat/x');
  writeFileSync(join(wt, 'b.txt'), 'b\n'); sh(wt, 'add', '.'); sh(wt, 'commit', '-q', '-m', 'feat: b');
  return { origin, seed, wt };
}

test('Freigabe: sauber + gesehener Stand; unsauber/anderer Stand → 409; zweimal = eine; nur genau dieser SHA — auch ein Rebase mit gleichem Patch verfällt (Teil C, D2/C-7); zurückziehen; gepusht', async () => {
  const { seed, wt } = setup();
  const d = { _id: 'st1', title: 'Strang', cwd: wt, lastStatus: 'done' };
  const f = F.repoFakten(F.strandRepo(d));
  assert.equal(f.branch, 'feat/x'); assert.equal(f.clean, true); assert.equal(f.baseRef, 'origin/develop');
  assert.equal(f.commits.length, 1); assert.match(f.stat, /b\.txt/); assert.ok(f.patchId);
  // Unsauber → 409.
  writeFileSync(join(wt, 'c.txt'), 'c\n');
  await assert.rejects(F.freigeben(u, d, { head: f.head, patchId: f.patchId }), /Ungespeicherte Änderungen/);
  sh(wt, 'clean', '-fq');
  await assert.rejects(F.freigeben(u, { ...d, lastStatus: 'running' }, { head: f.head, patchId: f.patchId }), /arbeitet gerade/);
  await assert.rejects(F.freigeben(u, d, { head: 'f'.repeat(40), patchId: f.patchId }), /inzwischen geändert/);
  const fg = await F.freigeben(u, d, { head: f.head, patchId: f.patchId });
  assert.equal((await F.freigeben(u, d, { head: f.head, patchId: f.patchId })).id, fg.id, 'zweimal = dieselbe Freigabe');
  // Prüfweg: genau dieser Stand.
  assert.equal((await F.pruefeFreigabe(u, wt, f.head)).ok, true);
  // develop geht weiter (anderes File), der Strang rebased: neuer SHA, derselbe Patch → verfällt (Knut 14.10.: nur genau der gesehene Stand).
  writeFileSync(join(seed, 'd.txt'), 'd\n'); sh(seed, 'add', '.'); sh(seed, 'commit', '-q', '-m', 'develop weiter'); sh(seed, 'push', '-q', 'origin', 'HEAD:develop');
  sh(wt, 'fetch', '-q', 'origin'); sh(wt, 'rebase', '-q', 'origin/develop');
  const neu = sh(wt, 'rev-parse', 'HEAD');
  assert.notEqual(neu, f.head);
  const p = await F.pruefeFreigabe(u, wt, neu);
  assert.equal(p.ok, false, p.grund); assert.match(p.grund, /neue Freigabe/);
  assert.equal((await F.pruefeFreigabe(u, wt, f.head)).ok, true, 'der freigegebene Stand selbst bleibt grün');
  // Inhalt geändert → nicht freigegeben.
  writeFileSync(join(wt, 'b.txt'), 'b geändert\n'); sh(wt, 'commit', '-qam', 'heimlich');
  const anders = sh(wt, 'rev-parse', 'HEAD');
  assert.equal((await F.pruefeFreigabe(u, wt, anders)).ok, false);
  // Andere Person sieht die Freigabe nicht.
  assert.equal((await F.pruefeFreigabe({ ...u, id: 'u2' }, wt, f.head)).ok, false);
  // Zurückziehen → Prüfweg nein; zweimal → 409.
  await F.zurueckziehen(u, 'st1', fg.id);
  assert.equal((await F.pruefeFreigabe(u, wt, f.head)).ok, false);
  await assert.rejects(F.zurueckziehen(u, 'st1', fg.id), /schon zurückgezogen/);
  // Neu freigeben (aktueller Stand), gepusht → nicht mehr zurückziehbar; nicht mehr in der offenen Liste.
  const f2 = F.repoFakten(wt);
  const fg2 = await F.freigeben(u, d, { head: f2.head, patchId: f2.patchId });
  await assert.rejects(F.gepusht(u, fg2.id, 'https://evil.example/pr/1'), /PR-Link/);
  await F.gepusht(u, fg2.id, 'https://github.com/WirStrom1/olaf-admin/pull/400');
  await assert.rejects(F.zurueckziehen(u, 'st1', fg2.id), /gepusht/);
  assert.equal((await F.listeFreigaben(u)).length, 0);
  assert.equal((await F.listeFreigaben(u, { alle: true })).length, 2);
});

test('pre-push-Hook (templates/git-hooks/pre-push): ohne Freigabe kein Push; Löschen/Tags frei; Notausgang mit Spur', () => {
  const hook = join(import.meta.dirname, '..', '..', 'templates', 'git-hooks', 'pre-push');
  const repo = mkdtempSync(join(HOME, 'hookrepo-')); sh(repo, 'init', '-q');
  const stub = join(HOME, 'orch-stub');
  // Ersatz für scripts/orch: „freigegeben“ nur für SHA aaaa…
  writeFileSync(stub, `#!/usr/bin/env bash\n[ "$1" = freigabe-pruefen ] && [ "$3" = "${'a'.repeat(40)}" ] && { echo ok; exit 0; }\necho nein >&2; exit 2\n`);
  execFileSync('chmod', ['+x', stub]);
  const run = (stdin: string, env: Record<string, string> = {}) => { try { execFileSync(hook, ['origin', 'https://github.com/x/y'], { cwd: repo, input: stdin, env: { ...process.env, HOME, WERKBANK_ORCH: stub, ...env }, stdio: ['pipe', 'pipe', 'pipe'] }); return 0; } catch (e: any) { return e.status; } };
  const z = '0'.repeat(40);
  assert.equal(run(`refs/heads/x ${'a'.repeat(40)} refs/heads/x ${z}\n`), 0, 'freigegeben');
  assert.equal(run(`refs/heads/x ${'b'.repeat(40)} refs/heads/x ${z}\n`), 1, 'nicht freigegeben');
  assert.equal(run(`refs/heads/x ${'a'.repeat(40)} refs/heads/x ${z}\nrefs/heads/y ${'b'.repeat(40)} refs/heads/y ${z}\n`), 1, 'einer fehlt → kein Push');
  assert.equal(run(`(delete) ${z} refs/heads/x ${'c'.repeat(40)}\n`), 0, 'Branch löschen ist kein Code-Push');
  assert.equal(run(`refs/tags/v1 ${'b'.repeat(40)} refs/tags/v1 ${z}\n`), 0, 'Tags sind nicht betroffen');
  assert.equal(run(`refs/heads/x ${'b'.repeat(40)} refs/heads/x ${z}\n`, { WERKBANK_PUSH_OHNE_FREIGABE: '1' }), 0, 'Notausgang');
  assert.match(execFileSync('cat', [join(HOME, '.local', 'state', 'werkbank-push-ohne-freigabe.log')], { encoding: 'utf8' }), /ohne Freigabe/);
  assert.equal(run(`refs/heads/x ${'a'.repeat(40)} refs/heads/x ${z}\n`, { WERKBANK_ORCH: join(HOME, 'fehlt') }), 1, 'ohne Prüfweg kein Push');
});

test('Arbeitsordner außerhalb von ~/work oder ohne Repo → kein Freigeben', async () => {
  assert.throws(() => F.strandRepo({ cwd: '/tmp' }), /nicht unter ~\/work/);
  const leer = mkdtempSync(join(HOME, 'work', 'knut', 'leer-'));
  assert.throws(() => F.repoFakten(leer), /kein git-Repo/);
});
