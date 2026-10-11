// Arbeitsordner aufräumen (Plan 81, Schnitt 4): Zwischenstände im Arbeitsordner der Claude-Sitzungen
// (`.runtime/bridge/scratch/<person>/`) werden nach `WERKBANK_SCRATCH_DAYS` (30) Tagen ohne Zugriff gelöscht —
// vorher einmal angekündigt (Hinweis auf der Dateien-Seite, mindestens 7 Tage vorher). Was in der Ablage oder im Vault
// liegt, ist nie betroffen: beide liegen außerhalb, Symlinks werden nie verfolgt, und liegt einer von beiden doch im
// Arbeitsordner, räumt die Werkbank gar nicht auf. Verzeichnisse bleiben stehen (Chat-Ordner der Brücke).

import { lstatSync, readdirSync, realpathSync, unlinkSync, utimesSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { cfg } from './config.ts';
import { wb } from './db.ts';
import { scratchDir } from './sharing.ts';
import type { User } from './auth.ts';

export const NOTICE_DAYS = 7;
const DAY = 86_400_000;
/** Nie anfassen, auch wenn alt: Zugänge, Konfiguration, Git. */
const KEEP = /(^|\/)(\.env[^/]*|\.ssh|\.claude|\.config|\.git|\.credentials\.json)(\/|$)/;
const within = (p: string, dir: string) => p === dir || p.startsWith(dir.endsWith(sep) ? dir : dir + sep);
const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };
/** Liegt `rel` wirklich im Arbeitsordner — auch kein Symlink-Ordner unterwegs (lstat prüft nur das letzte Glied)? */
const inside = (r: string, rel: string): string | null => {
  const abs = resolve(r, rel);
  if (!within(abs, r) || abs === r || KEEP.test(rel)) return null;
  try { if (!within(realpathSync(dirname(abs)), r)) return null; } catch { return null; }
  return abs;
};

export interface ScratchFile { rel: string; size: number; lastUse: number }

/** Alle Dateien unter `root` (ohne Symlinks zu folgen), mit letztem Zugriff = max(atime, mtime). */
export function scan(root: string): ScratchFile[] {
  const out: ScratchFile[] = [];
  const walk = (dir: string) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const abs = join(dir, e.name);
      const rel = relative(root, abs).split(sep).join('/');
      if (KEEP.test(rel)) continue;
      if (e.isDirectory()) { walk(abs); continue; }
      if (!e.isFile()) continue; // Symlinks, Sockets … bleiben
      try { const st = lstatSync(abs); out.push({ rel, size: st.size, lastUse: Math.max(st.atimeMs, st.mtimeMs) }); } catch { /* weg */ }
    }
  };
  walk(root);
  return out;
}

/** Darf hier überhaupt aufgeräumt werden? Nein, wenn Ablage, Vault oder Werkbank-Daten im Arbeitsordner liegen (oder umgekehrt). */
export function unsafeRoot(root: string): string | null {
  const r = real(root);
  for (const dir of [cfg.docsDir, cfg.vaultDir, cfg.dataDir]) {
    const p = real(dir);
    if (within(p, r) || within(r, p)) return `${dir} und der Arbeitsordner überschneiden sich — kein Aufräumen.`;
  }
  return null;
}

/**
 * Plan für eine Person, rein: was angekündigt und was gelöscht wird. `noticedAt` = wann der Hinweis zuerst erschien
 * (null = noch nie). Gelöscht wird nur, was abgelaufen ist UND seit mindestens NOTICE_DAYS angekündigt war.
 */
export function plan(files: ScratchFile[], now: number, days: number, noticedAt: number | null) {
  if (days <= 0) return { warn: [] as ScratchFile[], remove: [] as ScratchFile[], deleteFrom: null as number | null };
  const expire = now - days * DAY;
  const soon = now - Math.max(0, days - NOTICE_DAYS) * DAY;
  const warn = files.filter((f) => f.lastUse < soon).sort((a, b) => a.lastUse - b.lastUse);
  const announced = noticedAt != null && noticedAt <= now - NOTICE_DAYS * DAY;
  const remove = announced ? files.filter((f) => f.lastUse < expire) : [];
  // Frühestens: Ablauf der ältesten Datei, aber nicht vor Ende der Ankündigungsfrist.
  const deleteFrom = warn.length ? Math.max(warn[0].lastUse + days * DAY, (noticedAt ?? now) + NOTICE_DAYS * DAY) : null;
  return { warn, remove, deleteFrom };
}

/** Löschen — nur echte Dateien innerhalb von `root`, noch einmal geprüft. Liefert die Zahl der gelöschten. */
export function removeFiles(root: string, rels: string[]): number {
  const r = real(root);
  let n = 0;
  for (const rel of rels) {
    const abs = inside(r, rel);
    if (!abs) continue;
    try { if (!lstatSync(abs).isFile()) continue; unlinkSync(abs); n++; } catch { /* schon weg */ }
  }
  return n;
}

/** „Behalten“: setzt die Frist einer Datei zurück (Zugriff = jetzt). */
export function keep(root: string, rel: string): boolean {
  const r = real(root);
  const abs = inside(r, rel);
  if (!abs) return false;
  try { if (!lstatSync(abs).isFile()) return false; const now = new Date(); utimesSync(abs, now, now); return true; } catch { return false; }
}

/**
 * Ein Durchlauf für eine Person: ankündigen, Fälliges löschen, Stand für die Dateien-Seite merken (`scratch_notice`).
 * `noticedAt` bleibt stehen, solange etwas angekündigt ist, und fällt weg, sobald nichts mehr ansteht.
 */
export async function runScratch(u: User, now = Date.now()): Promise<{ removed: number; warn: number; skipped?: string }> {
  const root = scratchDir(u);
  const col = wb().collection('scratch_notice');
  const bad = unsafeRoot(root);
  if (bad) return { removed: 0, warn: 0, skipped: bad };
  const state: any = await col.findOne({ _id: u.id as any });
  const before = plan(scan(root), now, cfg.scratchDays, state?.noticedAt ? +new Date(state.noticedAt) : null);
  const removed = before.remove.length ? removeFiles(root, before.remove.map((f) => f.rel)) : 0;
  const p = removed ? plan(scan(root), now, cfg.scratchDays, state?.noticedAt ? +new Date(state.noticedAt) : null) : before;
  if (!p.warn.length) { await col.deleteOne({ _id: u.id as any }); return { removed, warn: 0 }; }
  const noticedAt = state?.noticedAt ?? new Date(now);
  const again = plan(p.warn, now, cfg.scratchDays, +new Date(noticedAt));
  await col.updateOne({ _id: u.id as any }, { $set: {
    noticedAt, at: new Date(now), count: p.warn.length, bytes: p.warn.reduce((a, f) => a + f.size, 0),
    deleteFrom: again.deleteFrom ? new Date(again.deleteFrom) : null,
    files: p.warn.slice(0, 100).map((f) => ({ rel: f.rel, size: f.size, lastUse: new Date(f.lastUse) })),
  } }, { upsert: true });
  return { removed, warn: p.warn.length };
}
