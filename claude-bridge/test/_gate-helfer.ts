// Gemeinsame Bauteile der Gate-Tests: Wegwerf-Repo mit base/head-Commit und echter Lauf von scripts/abnahme.sh.
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, chmodSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts');
export const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();

export function repo(files: Record<string, string>, extraBase: Record<string, string> = {}, weg: string[] = []) {
  const d = mkdtempSync(join(tmpdir(), 'abnahme-gate-'));
  mkdirSync(join(d, 'scripts'));
  for (const f of ['abnahme.sh', 'sauber-env.sh', 'secret-env.pattern', 'drop-env.names']) if (existsSync(join(SCRIPTS, f))) copyFileSync(join(SCRIPTS, f), join(d, 'scripts', f));
  chmodSync(join(d, 'scripts', 'abnahme.sh'), 0o755); chmodSync(join(d, 'scripts', 'sauber-env.sh'), 0o755);
  git(d, 'init', '-q'); git(d, 'config', 'user.email', 't@t'); git(d, 'config', 'user.name', 't');
  const put = (m: Record<string, string>) => { for (const [p, c] of Object.entries(m)) { mkdirSync(join(d, dirname(p)), { recursive: true }); writeFileSync(join(d, p), c); } };
  put({ 'README.md': 'x\n', ...extraBase }); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'base');
  const base = git(d, 'rev-parse', 'HEAD');
  for (const p of weg) git(d, 'rm', '-q', p);
  put(files); git(d, 'add', '-A'); git(d, 'commit', '-qm', 'head');
  return { d, base };
}
export const gate = (d: string, base: string, env: Record<string, string | undefined> = {}) =>
  spawnSync('bash', ['scripts/abnahme.sh', base], { cwd: d, encoding: 'utf8', timeout: 90_000, env: { ...process.env, NODE_TEST_CONTEXT: undefined, ABNAHME_TSC: 'aus', ...env } });

