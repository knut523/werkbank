// Agenten-Dateien landen von selbst in „Meine Dateien“ (Plan 81, Schnitt 3; Knut, 07.10.2026: „Dateien, die kreiert
// werden, sollen in meinen Dateien fertiggestellt sichtbar sein“).
//
// Die Brücke merkt sich je Sitzung, welche Dateien Claude geschrieben hat (`written`). Ist die Sitzung fertig
// (Status „bereit“), übernimmt die Werkbank jede dieser Dateien:
//   - eine Vault-Notiz als Eintrag mit Link in den Vault (keine Kopie, der Vault ist die Quelle);
//   - eine Datei im Arbeitsordner der Person als Kopie in den Datei-Speicher, mit Ticket und Projekt des Laufs.
// Alles andere (Repos, fremde Ordner, Programme, zu große Dateien) bleibt draußen. Erneut geschriebene Dateien
// ersetzen ihre Kopie (gleicher Eintrag), statt einen zweiten anzulegen.

import { randomUUID, createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, chmodSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { cfg } from './config.ts';
import { wb } from './db.ts';
import type { User } from './auth.ts';
import { ALLOWED_EXT, safeName, scratchDir } from './sharing.ts';

const within = (p: string, dir: string) => p === dir || p.startsWith(dir.endsWith(sep) ? dir : dir + sep);
const real = (p: string) => { try { return realpathSync(p); } catch { return resolve(p); } };

/** Dateien, die nie übernommen werden, auch im Arbeitsordner nicht (Zugänge, Konfiguration, Werkbank-Zustand). */
const SENSITIVE = /(^|\/)(\.env[^/]*|\.ssh|\.claude|\.config|\.runtime|node_modules|\.git)(\/|$)/;

export type Classified =
  | { kind: 'vault'; vaultPath: string }
  | { kind: 'file'; abs: string }
  | { kind: 'skip'; why: string };

/** Was mit einer geschriebenen Datei passiert. Rein bis auf realpath/stat. */
export function classifyWritten(u: User, path: string): Classified {
  const abs = real(path);
  const vault = real(cfg.vaultDir);
  if (within(abs, vault)) {
    if (extname(abs).toLowerCase() !== '.md') return { kind: 'skip', why: 'im Vault, keine Notiz' };
    return { kind: 'vault', vaultPath: relative(vault, abs).split(sep).join('/') };
  }
  const scratch = real(scratchDir(u));
  if (!within(abs, scratch)) return { kind: 'skip', why: 'außerhalb des Arbeitsordners' };
  const rel = relative(scratch, abs).split(sep).join('/');
  if (SENSITIVE.test(rel)) return { kind: 'skip', why: 'geschützter Pfad' };
  if (!ALLOWED_EXT[extname(abs).toLowerCase()]) return { kind: 'skip', why: 'Dateityp nicht erlaubt' };
  let size = 0;
  try { size = statSync(abs).size; } catch { return { kind: 'skip', why: 'gibt es nicht mehr' }; }
  if (!size) return { kind: 'skip', why: 'leer' };
  if (size > cfg.fileMaxBytes) return { kind: 'skip', why: 'zu groß' };
  return { kind: 'file', abs };
}

const filesDir = () => join(cfg.dataDir, 'files');

export interface RunContext { conv: string; key?: string | null; projectId?: string | null; runId?: string | null }

/** Eine geschriebene Datei übernehmen. Liefert 'neu', 'aktualisiert', 'unverändert' oder den Grund fürs Auslassen. */
export async function ingestOne(u: User, path: string, ctx: RunContext): Promise<string> {
  const c = classifyWritten(u, path);
  if (c.kind === 'skip') return c.why;
  const col = wb().collection('files');
  const sourcePath = c.kind === 'vault' ? `vault:${c.vaultPath}` : real(c.abs);
  const existing: any = await col.findOne({ owner: u.id, 'source.path': sourcePath });
  const tickets = ctx.key ? [ctx.key] : [];
  const now = new Date();
  if (c.kind === 'vault') {
    if (existing) {
      await col.updateOne({ _id: existing._id }, { $set: { updatedAt: now, ...(ctx.projectId ? { projectId: ctx.projectId } : {}) }, $addToSet: { tickets: { $each: tickets } } });
      return 'unverändert';
    }
    await col.insertOne({
      _id: randomUUID() as any, kind: 'vault', vaultPath: c.vaultPath, name: basename(c.vaultPath), size: 0, mime: 'text/markdown',
      owner: u.id, ownerEmail: u.email, ownerName: u.name, sharedWith: [], personal: false, tickets, projectId: ctx.projectId ?? null,
      source: { path: sourcePath, conv: ctx.conv, runId: ctx.runId ?? null }, status: 'fertig', createdAt: now, updatedAt: now,
    } as any);
    return 'neu';
  }
  const bytes = readFileSync(c.abs);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (existing && existing.sha256 === sha256) return 'unverändert';
  const id = existing?._id ?? randomUUID();
  const name = existing?.name ?? safeName(basename(c.abs));
  const dir = join(filesDir(), id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  copyFileSync(c.abs, join(dir, name));
  chmodSync(join(dir, name), 0o600);
  if (existing) {
    await col.updateOne({ _id: id }, { $set: { size: bytes.length, sha256, updatedAt: now, status: 'fertig', ...(ctx.projectId ? { projectId: ctx.projectId } : {}) }, $addToSet: { tickets: { $each: tickets } } });
    return 'aktualisiert';
  }
  await col.insertOne({
    _id: id as any, kind: 'agent', name, size: bytes.length, mime: ALLOWED_EXT[extname(name).toLowerCase()], sha256,
    owner: u.id, ownerEmail: u.email, ownerName: u.name, sharedWith: [], personal: false, tickets, projectId: ctx.projectId ?? null,
    source: { path: sourcePath, conv: ctx.conv, runId: ctx.runId ?? null }, status: 'fertig', createdAt: now, updatedAt: now,
  } as any);
  return 'neu';
}

/**
 * Alle fertigen Sitzungen einer Person durchgehen. `sessions` ist die Antwort von `GET /sessions?user=` der Brücke.
 * Liefert die Projekte, deren Dateien sich geändert haben (für die Workstream-Übersicht).
 */
export async function ingestSessions(u: User, sessions: Array<{ conv: string; status: string; written?: string[] }>): Promise<{ changed: number; projects: Set<string> }> {
  const projects = new Set<string>();
  let changed = 0;
  for (const s of sessions) {
    if (s.status !== 'bereit' || !s.written?.length) continue;
    const run: any = await wb().collection('agent_runs').findOne({ userId: u.id, conv: s.conv }, { sort: { startedAt: -1 } });
    const ctx: RunContext = { conv: s.conv, key: run?.key ?? null, projectId: run?.projectId ?? null, runId: run?._id ?? null };
    for (const path of s.written) {
      const r = await ingestOne(u, path, ctx);
      if (r === 'neu' || r === 'aktualisiert') { changed++; if (ctx.projectId) projects.add(ctx.projectId); }
    }
  }
  return { changed, projects };
}

/** Pfad einer Datei im Speicher bzw. im Vault (für Download und „Im Chat“). */
export const storedPath = (f: any) => (f.kind === 'vault' ? join(cfg.vaultDir, f.vaultPath) : join(filesDir(), f._id, f.name));

export const exists = (f: any) => existsSync(storedPath(f));
