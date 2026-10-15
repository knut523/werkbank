// Neuester Code für Werkbank-Agenten (fresh.ts): Entscheidung rein getestet (veraltet / aktuell / kein Remote / fetch
// scheitert / Code-Auftrag), dazu ein echter Durchlauf mit lokalen Git-Repos (ein „GitHub“-origin als bare repo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { decideFresh, gatherFacts, prepareFresh, scrub, type RepoFacts } from '../server/fresh.ts';

const base: RepoFacts = { top: '/r/olaf-admin', origin: 'https://github.com/WirStrom1/olaf-admin.git', fetchOk: true, fetchError: null, branch: 'develop', upstream: 'origin/develop', behind: 0, base: 'origin/develop' };

test('veraltet: „Stand: N Commits hinter origin/<zweig>“, kein Worktree ohne Code-Auftrag', () => {
  assert.deepEqual(decideFresh({ ...base, behind: 142 }, false), { action: 'none', status: 'Stand: 142 Commits hinter origin/develop.' });
});

test('aktuell: Stand aktuell; Code-Auftrag → frischer Worktree vom Integrationszweig', () => {
  assert.equal(decideFresh(base, false).status, 'Stand: aktuell mit origin/develop.');
  const d = decideFresh({ ...base, behind: 3 }, true);
  assert.equal(d.action, 'worktree');
  assert.match(String(d.status), /frischer Worktree von origin\/develop.*3 Commits hinter origin\/develop/);
});

test('kein Remote / fremdes Remote / kein Repo: nichts tun, keine Zeile', () => {
  assert.deepEqual(decideFresh({ ...base, origin: null }, true), { action: 'none', status: null });
  assert.deepEqual(decideFresh({ ...base, origin: 'https://gitlab.com/x/y.git' }, true), { action: 'none', status: null });
  assert.deepEqual(decideFresh({ ...base, top: null }, true), { action: 'none', status: null });
  assert.deepEqual(decideFresh({ ...base, origin: 'git@github.com:knut523/werkbank.git', behind: 1 }, false).status, 'Stand: 1 Commits hinter origin/develop.');
});

test('fetch scheitert: im Chat sagen und im Ordner weiterarbeiten (auch bei Code-Auftrag kein Worktree)', () => {
  const d = decideFresh({ ...base, fetchOk: false, fetchError: 'Authentication failed' }, true);
  assert.equal(d.action, 'none');
  assert.match(String(d.status), /git fetch fehlgeschlagen \(Authentication failed\).*weiter/);
});

test('Zugangsdaten tauchen nie im Text auf', () => {
  assert.equal(scrub('fatal: https://x-access-token:ghp_abcdefghijklmnop@github.com/WirStrom1/a.git nicht gefunden'), 'fatal: https://github.com/WirStrom1/a.git nicht gefunden');
  assert.equal(scrub('token github_pat_11ABCDEF_xyz'), 'token ***');
});

test('echter Durchlauf: Klon 2 Commits hinter origin → Stand; --code → Worktree auf dem neuesten Stand', () => {
  const t = mkdtempSync(join(tmpdir(), 'wb-fresh-'));
  const g = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@x', ...a], { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' }).trim();
  const bare = join(t, 'olaf-admin.git');
  g(t, 'init', '-q', '--bare', '-b', 'develop', bare);
  const up = join(t, 'up'); g(t, 'clone', '-q', bare, up);
  writeFileSync(join(up, 'a.txt'), '1'); g(up, 'add', '.'); g(up, 'commit', '-qm', 'eins'); g(up, 'push', '-q', 'origin', 'HEAD:develop');
  const clone = join(t, 'olaf-admin'); g(t, 'clone', '-q', bare, clone);
  for (const n of ['zwei', 'drei']) { writeFileSync(join(up, 'a.txt'), n); g(up, 'commit', '-qam', n); }
  g(up, 'push', '-q', 'origin', 'HEAD:develop');
  // origin sieht aus wie GitHub (die Prüfung gilt der URL); geholt wird über insteadOf aus dem lokalen bare repo.
  g(clone, 'remote', 'set-url', 'origin', 'https://github.com/WirStrom1/olaf-admin.git');
  g(clone, 'config', `url.${bare}.insteadOf`, 'https://github.com/WirStrom1/olaf-admin.git');
  const f = gatherFacts(clone);
  assert.equal(f.fetchOk, true); assert.equal(f.behind, 2); assert.equal(f.base, 'origin/develop');
  assert.equal(prepareFresh(clone, 'x1', false).status, 'Stand: 2 Commits hinter origin/develop.');
  const r = prepareFresh(clone, 'x2', true);
  assert.equal(r.worktree, true);
  assert.equal(r.cwd, join(t, 'olaf-admin-agent-x2'));
  assert.equal(execFileSync('git', ['log', '-1', '--format=%s'], { cwd: r.cwd, encoding: 'utf8' }).trim(), 'drei', 'Worktree hat den neuesten Stand');
  assert.equal(execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: r.cwd, encoding: 'utf8' }).trim(), 'agent/x2');
  // fetch scheitert (origin nicht erreichbar): weiter im Ordner, Zeile sagt es
  g(clone, 'config', '--unset', `url.${bare}.insteadOf`);
  g(clone, 'remote', 'set-url', 'origin', 'https://github.com/WirStrom1/gibt-es-nicht-wb-test.git');
  g(clone, 'config', 'url.file:///nonexistent/x.git.insteadOf', 'https://github.com/WirStrom1/gibt-es-nicht-wb-test.git');
  const bad = prepareFresh(clone, 'x3', true);
  assert.equal(bad.worktree, false); assert.equal(bad.cwd, clone);
  assert.match(String(bad.status), /git fetch fehlgeschlagen/);
  assert.ok(!existsSync(join(t, 'olaf-admin-agent-x3')));
});
