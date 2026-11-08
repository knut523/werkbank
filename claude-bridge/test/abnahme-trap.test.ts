// Gate: Abbruch zwischen mongod-Start und Aufräumen räumt auf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repo, gate } from './_gate-helfer.ts';

test('Abbruch zwischen mongod-Start und Aufräumen killt mongod und löscht $TM/$TM.log', async () => {
  const mongod = "#!/usr/bin/env bash\nwhile [ $# -gt 0 ]; do [ \"$1\" = --port ] && P=$2; [ \"$1\" = --dbpath ] && echo \"$2\" > \"$FAKE_MONGO_INFO\"; shift; done\necho $$ >> \"$FAKE_MONGO_INFO\"\nexec node -e \"require('net').createServer().listen(+process.argv[1],'127.0.0.1')\" \"$P\"\n";
  const hang = "import { test } from 'node:test'; import { writeFileSync } from 'node:fs';\ntest('haengt', async () => { writeFileSync(process.env.WERKBANK_TEST_OUT, 'laeuft'); await new Promise((r) => setTimeout(r, 60000)); });\n";
  const { d, base } = repo({ 'web/h.test.mjs': hang }, {});
  mkdirSync(join(d, '.runtime', 'bin'), { recursive: true }); writeFileSync(join(d, '.runtime', 'bin', 'mongod'), mongod); chmodSync(join(d, '.runtime', 'bin', 'mongod'), 0o755);
  const info = join(d, '..', `mongo-info-${process.pid}`), marker = join(d, '..', `marker-${process.pid}`);
  const p = spawn('bash', ['scripts/abnahme.sh', base], { cwd: d, stdio: 'ignore', detached: true, env: { ...process.env, ABNAHME_TSC: 'aus', NODE_TEST_CONTEXT: undefined, FAKE_MONGO_INFO: info, WERKBANK_TEST_OUT: marker } });
  const exited = new Promise<number | null>((res) => p.on('exit', (c) => res(c)));
  for (let i = 0; i < 100 && !existsSync(marker); i++) await new Promise((r) => setTimeout(r, 200));
  assert.ok(existsSync(marker), 'Test läuft');
  const [tm, pid] = readFileSync(info, 'utf8').trim().split('\n');
  assert.ok(existsSync(tm) && existsSync(`${tm}.log`));
  process.kill(p.pid!, 'SIGTERM');
  await Promise.race([exited, new Promise((r) => setTimeout(r, 15_000))]);
  await new Promise((r) => setTimeout(r, 500));
  let alive = true; try { process.kill(Number(pid), 0); } catch { alive = false; }
  if (alive) process.kill(Number(pid), 'SIGKILL');
  try { process.kill(-p.pid!, 'SIGKILL'); } catch { /* weg */ }
  const tmGone = !existsSync(tm), logGone = !existsSync(`${tm}.log`);
  rmSync(tm, { recursive: true, force: true }); rmSync(`${tm}.log`, { force: true }); rmSync(d, { recursive: true, force: true }); rmSync(info, { force: true }); rmSync(marker, { force: true });
  assert.equal(alive, false, 'mongod gekillt');
  assert.ok(tmGone && logGone, '$TM und $TM.log entfernt');
});
