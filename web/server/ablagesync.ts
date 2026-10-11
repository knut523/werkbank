// Ablage-Abgleich (docs/plan-dateien-vollstaendig.md, S1; Knut, 11.10.2026: „warum sind da nicht alle Dateien, die wir
// schon haben“). Jede Datei in der Ablage (`WERKBANK_DOCS_DIR`) steht im Register `files` — auch die, die nie über die
// Werkbank hereinkam (Herkunft `kind: 'ablage'`, Besitzer = Ablage-Besitzer). Der Abgleich folgt dem Dateisystem:
// neu → Eintrag, verschoben/umbenannt → Pfad folgt (gleiche ID, Freigaben bleiben), geändert → Größe/Prüfsumme,
// gelöscht → Eintrag weg (nur Herkunft Ablage). Er schreibt, verschiebt und löscht NIE eine Datei — nur Mongo.

import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { wb, lc } from './db.ts';
import type { User } from './auth.ts';
import { docsDir } from './ablage.ts';

const SKIP_DIR = new Set(['node_modules', '.git', '__pycache__']);
export const SYNC_MAX_FILES = 5000, SYNC_MAX_DEPTH = 8, SYNC_MIN_AGE_MS = 2 * 60_000;

export interface DiskFile { size: number; mtimeMs: number }
export interface SyncResult { skipped?: string; neu: number; verschoben: number; geaendert: number; geloescht: number; doppelt: number; schutz?: boolean }

/** Ablage ablaufen. null = nicht lesbar oder zu groß (dann ändert der Abgleich nichts). */
export function walkAblage(root: string): Map<string, DiskFile> | null {
  const out = new Map<string, DiskFile>();
  try { if (!statSync(root).isDirectory()) return null; readdirSync(root); } catch { return null; }
  let tooMany = false;
  const walk = (abs: string, rel: string, depth: number) => {
    let ents;
    try { ents = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (tooMany) return;
      if (e.name.startsWith('.')) continue; // versteckt, auch Teildateien `.upload-*`
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (depth < SYNC_MAX_DEPTH && !SKIP_DIR.has(e.name)) walk(join(abs, e.name), r, depth + 1); continue; }
      if (!e.isFile()) continue; // keine Symlinks
      if (out.size >= SYNC_MAX_FILES) { tooMany = true; return; }
      try { const st = statSync(join(abs, e.name)); out.set(r, { size: st.size, mtimeMs: st.mtimeMs }); } catch { /* eben weg */ }
    }
  };
  walk(root, '', 1);
  return tooMany ? null : out;
}

/** Prüfsumme gestreamt (blockiert den Server nicht bei großen Dateien). */
export function hashFile(abs: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(abs).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

/** Wem die Ablage gehört: `WERKBANK_DOCS_OWNER` (E-Mail), sonst das einzige Admin-Konto. Unklar → null. */
export async function ablageOwner(): Promise<User | null> {
  const email = (process.env.WERKBANK_DOCS_OWNER ?? '').trim().toLowerCase();
  const proj = { projection: { email: 1, name: 1, username: 1, role: 1 } };
  const toUser = (u: any): User => ({ id: String(u._id), email: String(u.email).toLowerCase(), name: String(u.name || u.username || u.email), role: u.role });
  if (email) {
    const u = await lc().collection('users').findOne({ email }, proj);
    return u ? toUser(u) : null;
  }
  const admins = await lc().collection('users').find({ role: 'ADMIN' }, proj).limit(2).toArray();
  return admins.length === 1 ? toUser(admins[0]) : null;
}

let running: Promise<SyncResult> | null = null;
let lastRun = 0;
export const lastSyncAt = () => lastRun;

/** Abgleich, höchstens einer zur Zeit (ein zweiter Aufruf wartet auf den laufenden). */
export function syncAblage(owner: User, opts: { now?: number; root?: string } = {}): Promise<SyncResult> {
  if (running) return running;
  running = doSync(owner, opts).finally(() => { running = null; lastRun = Date.now(); });
  return running;
}

async function doSync(owner: User, opts: { now?: number; root?: string }): Promise<SyncResult> {
  const r: SyncResult = { neu: 0, verschoben: 0, geaendert: 0, geloescht: 0, doppelt: 0 };
  const root = opts.root ?? docsDir();
  const now = opts.now ?? Date.now();
  const disk = walkAblage(root);
  if (!disk) return { ...r, skipped: 'Ablage nicht lesbar oder über dem Deckel' };
  const col = wb().collection('files');
  const docs: any[] = await col.find({ kind: { $ne: 'vault' }, path: { $exists: true } }).toArray();

  // Doppelt: derselbe Pfad mit Ablage-Eintrag und einem Eintrag anderer Herkunft (Upload/Agent kamen nach dem Abgleich)
  // → die andere Herkunft gewinnt, Freigaben und Tickets des Ablage-Eintrags gehen auf sie über.
  const byPath = new Map<string, any[]>();
  for (const d of docs) byPath.set(d.path, [...(byPath.get(d.path) ?? []), d]);
  const gone = new Set<string>();
  for (const list of byPath.values()) {
    const other = list.find((d) => d.kind !== 'ablage');
    if (!other) continue;
    for (const d of list.filter((x) => x.kind === 'ablage')) {
      const share = (d.sharedWith ?? []).filter((id: string) => id !== other.owner); // nie „mit sich selbst geteilt“
      await col.updateOne({ _id: other._id }, { $addToSet: { sharedWith: { $each: share }, tickets: { $each: d.tickets ?? [] } } } as any);
      await col.deleteOne({ _id: d._id, kind: 'ablage' });
      gone.add(d._id); r.doppelt++;
    }
  }
  const live = docs.filter((d) => !gone.has(d._id));
  const known = new Set(live.map((d) => d.path));
  const missing = live.filter((d) => !disk.has(d.path));
  const fresh = [...disk.entries()].filter(([p, st]) => !known.has(p) && now - st.mtimeMs >= SYNC_MIN_AGE_MS);
  // Noch zu junge, unbekannte Dateien (Kopie statt `mv`): ein fehlender Eintrag gleicher Größe wartet auf den nächsten Lauf,
  // statt mitsamt Freigaben gelöscht zu werden.
  const youngSizes = new Set([...disk.entries()].filter(([p, st]) => !known.has(p) && now - st.mtimeMs < SYNC_MIN_AGE_MS).map(([, st]) => st.size));

  // Umzug: eine neue Datei mit gleicher Größe und Prüfsumme wie genau ein fehlender Eintrag (und umgekehrt).
  const moved = new Set<string>();
  const newHash = new Map<string, string>();
  const bySize = new Map<number, any[]>();
  for (const d of missing) if (d.sha256) bySize.set(d.size, [...(bySize.get(d.size) ?? []), d]);
  const pairs = new Map<string, string[]>(); // doc-id → neue Pfade mit gleicher Prüfsumme
  const cand = new Map<string, any[]>();     // neuer Pfad → passende Einträge
  for (const [p, st] of fresh) {
    const c = bySize.get(st.size);
    if (!c?.length) continue;
    let sha = '';
    try { sha = await hashFile(join(root, p)); } catch { continue; }
    newHash.set(p, sha);
    const hits = c.filter((d) => d.sha256 === sha);
    cand.set(p, hits);
    for (const d of hits) pairs.set(d._id, [...(pairs.get(d._id) ?? []), p]);
  }
  for (const [p, hits] of cand) {
    if (hits.length !== 1 || pairs.get(hits[0]._id)?.length !== 1) continue; // mehrdeutig → neu + gelöscht
    const d = hits[0], st = disk.get(p)!;
    await col.updateOne({ _id: d._id }, { $set: { path: p, name: basename(p), updatedAt: new Date(now), ...(d.kind === 'ablage' ? { mtimeMs: st.mtimeMs } : {}) } });
    moved.add(d._id); known.add(p); r.verschoben++;
  }

  // Neu
  for (const [p, st] of fresh) {
    if (known.has(p)) continue;
    let sha = newHash.get(p);
    if (!sha) { try { sha = await hashFile(join(root, p)); } catch { continue; } }
    await col.insertOne({
      _id: randomUUID() as any, kind: 'ablage', path: p, name: basename(p), size: st.size, mtimeMs: st.mtimeMs, sha256: sha,
      owner: owner.id, ownerEmail: owner.email, ownerName: owner.name, sharedWith: [], tickets: [], personal: false,
      createdAt: new Date(st.mtimeMs), updatedAt: new Date(now),
    } as any);
    r.neu++;
  }

  // Geändert (nur Herkunft Ablage — Uploads/Agenten-Dateien pflegt ihr eigener Weg)
  for (const d of live) {
    if (d.kind !== 'ablage' || moved.has(d._id)) continue;
    const st = disk.get(d.path);
    if (!st || (st.size === d.size && st.mtimeMs === d.mtimeMs)) continue;
    let sha = '';
    try { sha = await hashFile(join(root, d.path)); } catch { continue; }
    await col.updateOne({ _id: d._id }, { $set: { size: st.size, mtimeMs: st.mtimeMs, sha256: sha, updatedAt: new Date(now) } });
    r.geaendert++;
  }

  // Gelöscht (nur Herkunft Ablage). Schutz: fehlt mehr als die Hälfte (und mehr als 20), ist eher die Ablage weg
  // (Mount, Rechte) als alles gelöscht — dann bleibt das Register, wie es ist.
  const lost = missing.filter((d) => d.kind === 'ablage' && !moved.has(d._id) && !youngSizes.has(d.size));
  const total = live.filter((d) => d.kind === 'ablage').length;
  if (lost.length > 20 && lost.length * 2 > total) r.schutz = true;
  else for (const d of lost) { await col.deleteOne({ _id: d._id, kind: 'ablage', path: d.path }); r.geloescht++; }
  return r;
}

/** Für Tests: Zustand zurücksetzen. */
export const _resetSync = () => { running = null; lastRun = 0; };
