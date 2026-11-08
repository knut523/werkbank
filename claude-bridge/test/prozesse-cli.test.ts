// Plan Prozessregister R6: die Claude-CLI läuft über `starte`; `erzwinge` beendet ihre Gruppe.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const STATE = mkdtempSync(join(tmpdir(), 'bridge-prozcli-'));
let mod: typeof import('../src/sessions.ts');
let mock: typeof import('../src/mock.ts');
let proz: typeof import('../src/prozesse.ts');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('Zeit abgelaufen'); await sleep(50); } };

before(async () => {
  process.env.BRIDGE_STATE_DIR = STATE;
  process.env.BRIDGE_SKILLS = '';
  process.env.BRIDGE_NACHLAUF_S = '1';
  delete process.env.BRIDGE_PERMISSION_MODE;
  mod = await import('../src/sessions.ts');
  mock = await import('../src/mock.ts');
  proz = await import('../src/prozesse.ts');
});

// Fake-CLI: ignoriert TERM, hat einen Enkel (der ebenfalls TERM ignoriert), meldet beide PIDs.
const fake = () => {
  const f = join(STATE, `fake-${randomUUID()}.sh`);
  writeFileSync(f, `trap '' TERM\nsh -c 'trap "" TERM; echo $$ > "${f}.enkel"; while :; do sleep 1; done' &\nwhile :; do sleep 1; done\n`);
  return f;
};
const tot = (pid: number) => { try { process.kill(pid, 0); return false; } catch { return true; } };

test('Spawn-Hook trägt die CLI als art claude-cli ein und liest stdout', async () => {
  const besitzer = `b-${randomUUID()}`;
  const k = mod.cliStarter(besitzer)({ command: 'sh', args: ['-c', 'echo hallo; sleep 30'], env: process.env as any, signal: new AbortController().signal });
  const e = proz.liste({ art: 'claude-cli', besitzer });
  assert.equal(e.length, 1);
  assert.equal(e[0].pid, k.pid);
  let out = ''; k.stdout!.on('data', (d) => { out += d; });
  await until(() => out.includes('hallo'), 3000);
  await proz.beenden(besitzer, 1000);
  await until(() => proz.liste({ besitzer }).length === 0, 3000);
});

test('Spawn-Hook: abort-Signal beendet die Gruppe', async () => {
  const besitzer = `b-${randomUUID()}`;
  const ac = new AbortController();
  const k = mod.cliStarter(besitzer)({ command: 'sh', args: ['-c', 'sleep 30'], env: process.env as any, signal: ac.signal });
  ac.abort();
  await until(() => proz.liste({ besitzer }).length === 0, 8000);
  assert.ok(tot(k.pid!));
});

test('erzwinge: Fake-CLI (ignoriert TERM, Enkel) — nach Gnadenfrist Gruppe tot, Konto frei, Eintrag weg', async () => {
  const conv = randomUUID();
  const script = fake();
  let key = '';
  const query = (p: any) => { key = key || p.options.__k || ''; (query as any).k = p.options.spawnClaudeCodeProcess({ command: 'sh', args: [script], env: process.env, cwd: tmpdir(), signal: new AbortController().signal }); return mock.mockQuery(p); };
  let out = ''; const closers: (() => void)[] = [];
  const s = { closed: false, done: false, write(t: string) { out += t; }, finish() { s.done = true; s.closed = true; closers.splice(0).forEach((f) => f()); }, onClose(f: () => void) { closers.push(f); } };
  void mod.handleTurn({ userId: 'u1', convId: conv, token: 'tok-a', prompt: 'mock-zombie', history: '', sink: s as any, query } as any);
  await until(() => !!(query as any).k && proz.liste({ art: 'claude-cli' }).length > 0, 10_000);
  const e = proz.liste({ art: 'claude-cli' })[0];
  await until(() => { try { return !!Number(fs.readFileSync(`${script}.enkel`, 'utf8')); } catch { return false; } }, 5000);
  const enkel = Number(fs.readFileSync(`${script}.enkel`, 'utf8'));
  assert.ok(!tot(e.pid) && !tot(enkel), 'läuft vor dem Zwangsende');
  await until(() => s.done, 25_000);   // Grenze 1 s + 5 s hart → erzwinge
  await until(() => tot(e.pid) && tot(enkel), 12_000);   // + Gnadenfrist 6 s, dann KILL
  assert.equal(proz.liste({ art: 'claude-cli' }).filter((x) => x.id === e.id).length, 0, 'Registereintrag weg');
  const t2 = { out: '', done: false }; const s2 = { closed: false, done: false, write(t: string) { t2.out += t; }, finish() { s2.done = true; s2.closed = true; }, onClose() {} };
  void mod.handleTurn({ userId: 'u1', convId: conv, token: 'tok-a', prompt: 'hallo', history: '', sink: s2 as any, query: mock.mockQuery } as any);
  await until(() => s2.done, 10_000);
  assert.doesNotMatch(t2.out, /arbeitet noch an der vorigen Nachricht/, 'Konto/Strang frei');
});
