// Umbenennung darf den Schutzpfad nicht verstecken: `git diff --name-only` mit Rename-Erkennung listet nur den NEUEN Pfad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, renameSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const S = await import('../server/schutzpfade.ts');
const F = await import('../server/freigabe.ts');
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();

function repo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'rename-')));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t'); git(dir, 'config', 'user.name', 't');
  mkdirSync(join(dir, 'db/migrations'), { recursive: true });
  writeFileSync(join(dir, 'db/migrations/001.sql'), Array.from({ length: 30 }, (_, i) => `create table t${i} (id int);`).join('\n') + '\n');
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'base');
  git(dir, 'update-ref', 'refs/remotes/origin/main', 'HEAD'); // Basis für repoFakten (BASES)
  const base = git(dir, 'rev-parse', 'HEAD');
  mkdirSync(join(dir, 'archive'));
  renameSync(join(dir, 'db/migrations/001.sql'), join(dir, 'archive/001.sql'));
  git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'rename');
  return { dir, base, head: git(dir, 'rev-parse', 'HEAD') };
}

test('repoFakten: umbenannte Migration listet den alten Pfad und löst den Schutzpfad aus', () => {
  const { dir } = repo();
  const f = F.repoFakten(dir);
  assert.ok(f.dateien.includes('db/migrations/001.sql'), `alter Pfad fehlt: ${JSON.stringify(f.dateien)}`);
  assert.ok(f.dateien.includes('archive/001.sql'));
  assert.deepEqual(S.schutzTreffer(f.dateien), ['db/migrations/001.sql']);
});

test('geaenderteDateienArgs: gemeinsamer Helfer ist rename-fest', () => {
  const { dir, base, head } = repo();
  const out = git(dir, ...S.geaenderteDateienArgs(base, head)).split('\n');
  assert.deepEqual(out.sort(), ['archive/001.sql', 'db/migrations/001.sql']);
});
