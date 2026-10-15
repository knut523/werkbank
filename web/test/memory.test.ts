// Speicherwarnung: Schwellen für cgroup-Belegung und Swap, ohne cgroup kein Ergebnis, Log höchstens alle 10 min.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { memoryState, memoryWarning } from '../server/memory.ts';

const G = 2 ** 30;
const cg = (cur: number, max: number | 'max', swap: number) => {
  const d = mkdtempSync(join(tmpdir(), 'cg-'));
  writeFileSync(join(d, 'memory.current'), String(cur)); writeFileSync(join(d, 'memory.max'), String(max)); writeFileSync(join(d, 'memory.swap.current'), String(swap));
  return d;
};

test('unter den Schwellen: keine Warnung; darüber: Text mit GiB und Prozent', () => {
  assert.equal(memoryState({ WERKBANK_CGROUP_DIR: cg(10 * G, 16 * G, 2 * G) } as any)!.warn, null);
  assert.match(String(memoryState({ WERKBANK_CGROUP_DIR: cg(14 * G, 16 * G, 2 * G) } as any)!.warn), /14\.0 von 16 GiB.*88 %/);
  assert.match(String(memoryState({ WERKBANK_CGROUP_DIR: cg(4 * G, 16 * G, 13 * G) } as any)!.warn), /Swap 13\.0 GiB/);
  assert.equal(memoryState({ WERKBANK_CGROUP_DIR: cg(14 * G, 16 * G, 0), WERKBANK_MEM_WARN_PCT: '90' } as any)!.warn, null);
  assert.equal(memoryState({ WERKBANK_CGROUP_DIR: cg(14 * G, 'max', 0) } as any)!.pct, null, 'ohne Limit keine Prozentwarnung');
  assert.equal(memoryState({ WERKBANK_CGROUP_DIR: '/gibt/es/nicht' } as any), null);
});

test('Log höchstens alle 10 Minuten', () => {
  const env = { WERKBANK_CGROUP_DIR: cg(15 * G, 16 * G, 0) } as any;
  const logs: string[] = [];
  const log = (m: string) => { logs.push(m); };
  memoryWarning(log, env, 1e12); memoryWarning(log, env, 1e12 + 60_000); memoryWarning(log, env, 1e12 + 700_000);
  assert.deepEqual(logs, ['speicher knapp', 'speicher knapp']);
});
