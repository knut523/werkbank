// Speicherwarnung (RAM-Plan 125, 11.10.2026): die Workspace hat ein cgroup-Limit (16 GiB) und lief oft daran. Liegt
// der echte Verbrauch über WERKBANK_MEM_WARN_PCT (Vorgabe 85 %) von memory.max oder der Swap über WERKBANK_SWAP_WARN_GB
// (Vorgabe 12), sehen Admins auf „Heute“ eine Warnung; ins Log höchstens alle 10 Minuten.
// Echt = anon + slab_unreclaimable aus memory.stat, wie ~/bin/speicher-waechter (Walkthrough 19.10.: memory.current zählt den
// Platten-Cache mit und zeigte 16/16 GiB bei 7,3 GB echtem Verbrauch). Ohne memory.stat: memory.current als Rückfall.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface MemState { current: number; max: number | null; swap: number | null; pct: number | null; warn: string | null }

const read = (dir: string, f: string): number | null => {
  try { const v = readFileSync(join(dir, f), 'utf8').trim(); return v === 'max' ? null : Number(v); } catch { return null; }
};
const GiB = 2 ** 30;
/** anon + slab_unreclaimable (Bytes) aus memory.stat, null ohne Datei. */
function echt(dir: string): number | null {
  try {
    const st = readFileSync(join(dir, 'memory.stat'), 'utf8');
    const wert = (k: string) => Number(st.match(new RegExp(`^${k} (\\d+)`, 'm'))?.[1] ?? NaN);
    const a = wert('anon'), s = wert('slab_unreclaimable');
    return Number.isFinite(a) ? a + (Number.isFinite(s) ? s : 0) : null;
  } catch { return null; }
}

export function memoryState(env = process.env, dir = env.WERKBANK_CGROUP_DIR || '/sys/fs/cgroup'): MemState | null {
  const current = echt(dir) ?? read(dir, 'memory.current');
  if (current === null || Number.isNaN(current)) return null;
  const max = read(dir, 'memory.max'), swap = read(dir, 'memory.swap.current');
  const pct = max ? Math.round((current / max) * 100) : null;
  const pctLimit = Number(env.WERKBANK_MEM_WARN_PCT || 85), swapLimit = Number(env.WERKBANK_SWAP_WARN_GB || 12);
  const parts: string[] = [];
  if (pct !== null && pct >= pctLimit) parts.push(`Arbeitsspeicher echt ${(current / GiB).toFixed(1)} von ${(max! / GiB).toFixed(0)} GiB belegt (${pct} %)`);
  if (swap !== null && swap / GiB >= swapLimit) parts.push(`Swap ${(swap / GiB).toFixed(1)} GiB`);
  return { current, max, swap, pct, warn: parts.length ? parts.join(' · ') : null };
}

let lastLog = 0;
/** Für Admins: Warnung oder null; protokolliert höchstens alle 10 Minuten. */
export function memoryWarning(log: (msg: string, data?: Record<string, unknown>) => void, env = process.env, now = Date.now()): MemState | null {
  const m = memoryState(env);
  if (!m?.warn) return null;
  if (now - lastLog > 600_000) { lastLog = now; log('speicher knapp', { warn: m.warn, pct: m.pct, swapGiB: m.swap !== null ? +(m.swap / GiB).toFixed(1) : null }); }
  return m;
}
