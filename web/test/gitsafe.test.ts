// Härtung der git-Aufrufe (Plan 154, Council R3, Bedingung 1): ein Strang setzt in seinem Worktree core.fsmonitor bzw.
// einen Hook — git im Web-Server darf das nicht ausführen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realGit } from '../server/releasestand.ts';

test('fsmonitor und Hooks aus der Repo-Config laufen bei git im Web-Server nicht', async () => {
  const d = mkdtempSync(join(tmpdir(), 'gitsafe-'));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: d, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', HOME: d } });
  g('init', '-q'); g('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'x');
  const marker = join(d, 'GELAUFEN');
  const evil = join(d, 'evil.sh');
  writeFileSync(evil, `#!/bin/sh\ntouch ${marker}\nexit 1\n`); chmodSync(evil, 0o755);
  g('config', 'core.fsmonitor', evil);
  mkdirSync(join(d, '.git', 'hooks'), { recursive: true });
  writeFileSync(join(d, 'neu.txt'), 'x');
  await realGit(['status', '--porcelain'], d);
  await realGit(['rev-parse', 'HEAD'], d);
  assert.equal(existsSync(marker), false, 'core.fsmonitor darf nicht laufen');
  // Gegenprobe: ohne Härtung läuft er wirklich (sonst prüft der Test nichts).
  try { g('status', '--porcelain'); } catch { /* fsmonitor endet mit 1 */ }
  assert.equal(existsSync(marker), true, 'Gegenprobe: ungehärtetes git ruft fsmonitor auf');
});
