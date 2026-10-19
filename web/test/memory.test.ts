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

test('Walkthrough 19.10.: echter Verbrauch = anon + slab_unreclaimable (memory.stat), nicht memory.current mit Platten-Cache', () => {
  const d = cg(16 * G, 16 * G, 0);   // memory.current voll (Cache)
  writeFileSync(join(d, 'memory.stat'), `anon ${Math.round(7 * G)}\nfile ${Math.round(8 * G)}\nslab_unreclaimable ${Math.round(0.3 * G)}\n`);
  const m = memoryState({ WERKBANK_CGROUP_DIR: d } as any)!;
  assert.equal(m.warn, null, 'kein Fehlalarm bei 7,3 GiB echt');
  assert.equal(m.pct, 46);
  writeFileSync(join(d, 'memory.stat'), `anon ${Math.round(14 * G)}\nslab_unreclaimable ${Math.round(0.2 * G)}\n`);
  assert.match(String(memoryState({ WERKBANK_CGROUP_DIR: d } as any)!.warn), /echt 14\.2 von 16 GiB/);
});
