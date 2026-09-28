// Teilen im Team: Dateien (eigener Bereich der Werkbank) und Chats (geteilte Links von LibreChat,
// nur für angemeldete Werkbank-Konten, ALLOW_SHARED_LINKS_PUBLIC=false).
// Protokoll: append-only JSON-Lines unter .runtime/werkbank/share-log.jsonl — wer, was (nur ID),
// mit wem, wann. Kein Inhalt, kein Dateiname im Protokoll.

import { mkdirSync, appendFileSync, existsSync, readFileSync, createWriteStream, copyFileSync, chmodSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { ObjectId } from 'mongodb';
import { cfg } from './config.ts';
import { wb, lc } from './db.ts';
import type { User } from './auth.ts';

const filesDir = () => join(cfg.dataDir, 'files');
const logFile = () => join(cfg.dataDir, 'share-log.jsonl');

export function logShare(e: { actor: string; action: 'share' | 'unshare' | 'upload' | 'delete' | 'copy'; kind: 'file' | 'chat'; resource: string; target?: string }) {
  mkdirSync(cfg.dataDir, { recursive: true });
  appendFileSync(logFile(), JSON.stringify({ ts: new Date().toISOString(), ...e }) + '\n', { mode: 0o600 });
}

export function readShareLog(limit = 200) {
  if (!existsSync(logFile())) return [];
  return readFileSync(logFile(), 'utf8').trim().split('\n').filter(Boolean).slice(-limit).map((l) => JSON.parse(l)).reverse();
}

// ---------- Dateien ----------

// Nur Dokumente, Tabellen, Bilder, Text. Nichts Ausführbares, keine Archive, kein HTML/SVG.
export const ALLOWED_EXT: Record<string, string> = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv', '.tsv': 'text/tab-separated-values', '.json': 'application/json',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xls': 'application/vnd.ms-excel',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.doc': 'application/msword',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text', '.ods': 'application/vnd.oasis.opendocument.spreadsheet', '.eml': 'message/rfc822',
};

export function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'datei';
  const cleaned = base.normalize('NFC').replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/^\.+/, '').trim().slice(0, 120);
  return cleaned || 'datei';
}

export function checkUpload(name: string, size: number): string | null {
  const ext = extname(name).toLowerCase();
  if (!ALLOWED_EXT[ext]) return `Dateityp ${ext || '(ohne Endung)'} ist nicht erlaubt. Erlaubt: ${Object.keys(ALLOWED_EXT).join(' ')}`;
  if (size > cfg.fileMaxBytes) return `Datei ist größer als ${Math.round(cfg.fileMaxBytes / 1048576)} MB.`;
  if (size <= 0) return 'Leere Datei.';
  return null;
}

export async function saveUpload(u: User, req: IncomingMessage, rawName: string, personal: boolean) {
  const name = safeName(rawName);
  const declared = Number(req.headers['content-length'] ?? 0);
  const err = checkUpload(name, declared || 1);
  if (err) throw Object.assign(new Error(err), { status: 400 });
  const id = randomUUID();
  const dir = join(filesDir(), id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const dest = join(dir, name);
  const h = createHash('sha256');
  let size = 0;
  await new Promise<void>((resolve, reject) => {
    const ws = createWriteStream(dest, { mode: 0o600 });
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > cfg.fileMaxBytes) { req.destroy(); ws.destroy(); reject(Object.assign(new Error('Datei zu groß.'), { status: 413 })); return; }
      h.update(c);
      ws.write(c);
    });
    req.on('end', () => ws.end(resolve));
    req.on('error', reject);
  }).catch((e) => { rmSync(dir, { recursive: true, force: true }); throw e; });
  if (!size) { rmSync(dir, { recursive: true, force: true }); throw Object.assign(new Error('Leere Datei.'), { status: 400 }); }
  const doc = {
    _id: id as any, name, size, mime: ALLOWED_EXT[extname(name).toLowerCase()], sha256: h.digest('hex'),
    owner: u.id, ownerEmail: u.email, ownerName: u.name, sharedWith: [] as string[], personal, createdAt: new Date(),
  };
  await wb().collection('files').insertOne(doc);
  logShare({ actor: u.email, action: 'upload', kind: 'file', resource: id });
  return doc;
}

export async function fileFor(u: User, id: string): Promise<any> {
  const f: any = await wb().collection('files').findOne({ _id: id as any });
  if (!f || (f.owner !== u.id && !f.sharedWith.includes(u.id))) return null;
  return f;
}

export const filePath = (f: any) => join(filesDir(), f._id, f.name);

export async function listFiles(u: User) {
  const col = wb().collection('files');
  const mine = await col.find({ owner: u.id }).sort({ createdAt: -1 }).toArray();
  const shared = await col.find({ sharedWith: u.id }).sort({ createdAt: -1 }).toArray();
  return { mine, shared };
}

export async function shareFile(u: User, id: string, target: User, share: boolean) {
  const f: any = await wb().collection('files').findOne({ _id: id as any, owner: u.id });
  if (!f) throw Object.assign(new Error('Nur die eigene Datei kann geteilt werden.'), { status: 403 });
  if (target.id === u.id) throw Object.assign(new Error('Das bist du selbst.'), { status: 400 });
  await wb().collection('files').updateOne({ _id: id as any }, share ? { $addToSet: { sharedWith: target.id } } : { $pull: { sharedWith: target.id } } as any);
  logShare({ actor: u.email, action: share ? 'share' : 'unshare', kind: 'file', resource: id, target: target.email });
}

export async function deleteFile(u: User, id: string) {
  const f: any = await wb().collection('files').findOne({ _id: id as any, owner: u.id });
  if (!f) throw Object.assign(new Error('Nur die eigene Datei kann gelöscht werden.'), { status: 403 });
  rmSync(join(filesDir(), id), { recursive: true, force: true });
  await wb().collection('files').deleteOne({ _id: id as any });
  logShare({ actor: u.email, action: 'delete', kind: 'file', resource: id });
}

/** Arbeitsverzeichnis der Claude-Sitzungen einer Person (wie in claude-bridge/sessions.ts). */
export function scratchDir(u: User): string {
  const safe = /^[A-Za-z0-9_-]{1,64}$/.test(u.id) ? u.id : createHash('sha256').update(u.id).digest('hex').slice(0, 24);
  return join(cfg.bridgeState, 'scratch', safe);
}

/** Datei in das Arbeitsverzeichnis der eigenen Claude-Sitzung legen (Kopie, nicht ausführbar). */
export function copyToScratch(u: User, f: any): string {
  const dir = join(scratchDir(u), 'dateien');
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, f.name);
  copyFileSync(filePath(f), dest);
  chmodSync(dest, 0o600);
  return `dateien/${f.name}`;
}

// ---------- Chats (LibreChat-Links) ----------

const SHARE_RT = 'sharedLink';

export async function chatsSharedWithMe(u: User) {
  const acl = await lc().collection('aclentries').find({ principalType: 'user', principalId: new ObjectId(u.id), resourceType: SHARE_RT }).toArray();
  if (!acl.length) return [];
  const links = await lc().collection('sharedlinks').find({ _id: { $in: acl.map((a: any) => a.resourceId) } }).toArray();
  const owners = await lc().collection('users').find({ _id: { $in: links.map((l: any) => { try { return new ObjectId(l.user); } catch { return null; } }).filter(Boolean) as ObjectId[] } }, { projection: { name: 1, email: 1 } }).toArray();
  return links.filter((l: any) => l.user !== u.id).map((l: any) => {
    const o: any = owners.find((x: any) => String(x._id) === l.user);
    const a: any = acl.find((x: any) => String(x.resourceId) === String(l._id));
    return {
      shareId: l.shareId, title: l.title || 'Ohne Titel', owner: o?.name ?? '?', ownerEmail: o?.email ?? '',
      sharedAt: a?.grantedAt ?? a?.createdAt ?? l.createdAt, messages: (l.messages ?? []).length,
      url: `${cfg.librechatPublicUrl}/share/${l.shareId}`,
    };
  }).sort((a: any, b: any) => String(b.sharedAt).localeCompare(String(a.sharedAt)));
}

export async function chatsSharedByMe(u: User) {
  const links = await lc().collection('sharedlinks').find({ user: u.id }).sort({ createdAt: -1 }).toArray();
  const acl = await lc().collection('aclentries').find({ resourceType: SHARE_RT, resourceId: { $in: links.map((l: any) => l._id) } }).toArray();
  const ids = acl.filter((a: any) => a.principalType === 'user').map((a: any) => a.principalId);
  const people = await lc().collection('users').find({ _id: { $in: ids } }, { projection: { name: 1, email: 1 } }).toArray();
  return links.map((l: any) => ({
    shareId: l.shareId, title: l.title || 'Ohne Titel', createdAt: l.createdAt, url: `${cfg.librechatPublicUrl}/share/${l.shareId}`,
    public: acl.some((a: any) => String(a.resourceId) === String(l._id) && a.principalType === 'public'),
    with: acl.filter((a: any) => String(a.resourceId) === String(l._id) && a.principalType === 'user' && String(a.principalId) !== u.id)
      .map((a: any) => people.find((p: any) => String(p._id) === String(a.principalId))).filter(Boolean).map((p: any) => p.name),
  }));
}

/** Darf `u` den geteilten Chat sehen? (Besitzer oder eigener ACL-Eintrag; öffentliche Links gibt es hier nicht.) */
async function canSee(u: User, link: any): Promise<boolean> {
  if (link.user === u.id) return true;
  return !!(await lc().collection('aclentries').findOne({ resourceType: SHARE_RT, resourceId: link._id, principalType: 'user', principalId: new ObjectId(u.id) }));
}

/**
 * "Als Kopie weiterführen": den Verlauf als Markdown in das Arbeitsverzeichnis der EIGENEN Sitzung
 * legen. Weiter geht es mit dem eigenen Claude-Token — nie mit Token oder Sitzung der teilenden Person.
 */
export async function copySharedChat(u: User, shareId: string): Promise<{ file: string; title: string; owner: string }> {
  const link: any = await lc().collection('sharedlinks').findOne({ shareId });
  if (!link || !(await canSee(u, link))) throw Object.assign(new Error('Dieser Chat ist nicht mit dir geteilt.'), { status: 403 });
  const msgs = await lc().collection('messages').find({ _id: { $in: link.messages ?? [] } }).sort({ createdAt: 1 }).toArray();
  const owner: any = ObjectId.isValid(link.user) ? await lc().collection('users').findOne({ _id: new ObjectId(link.user) }, { projection: { name: 1 } }) : null;
  const textOf = (m: any) => (m.text && String(m.text)) || (m.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text?.value ?? c.text ?? '').join('\n');
  const md = [
    `# Geteilter Chat: ${link.title || 'Ohne Titel'}`,
    '',
    `Geteilt von ${owner?.name ?? '?'} · kopiert am ${new Date().toISOString().slice(0, 10)} · Nur Lesekopie des Verlaufs; die Sitzung der teilenden Person wird nicht fortgesetzt.`,
    '',
    ...msgs.map((m: any) => `## ${m.isCreatedByUser ? (owner?.name ?? 'Nutzer') : 'Claude'}\n\n${textOf(m)}\n`),
  ].join('\n');
  const dir = join(scratchDir(u), 'geteilt');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${shareId.replace(/[^A-Za-z0-9_-]/g, '')}.md`);
  writeFileSync(file, md, { mode: 0o600 });
  logShare({ actor: u.email, action: 'copy', kind: 'chat', resource: shareId });
  return { file: `geteilt/${shareId.replace(/[^A-Za-z0-9_-]/g, '')}.md`, title: link.title || 'Ohne Titel', owner: owner?.name ?? '?' };
}

/** Protokoll für Chat-Freigaben: LibreChat schreibt sie in aclentries; wir vergleichen periodisch. */
export async function watchChatShares() {
  const acl = await lc().collection('aclentries').find({ resourceType: SHARE_RT }).toArray();
  const now = new Set(acl.map((a: any) => `${a.resourceId}|${a.principalType}|${a.principalId ?? ''}|${a.grantedBy ?? ''}`));
  const state: any = await wb().collection('meta').findOne({ _id: 'chat_shares' as any });
  const before = new Set<string>(state?.entries ?? []);
  if (state) {
    const links = await lc().collection('sharedlinks').find({}, { projection: { shareId: 1 } }).toArray();
    const sid = (rid: string) => (links.find((l: any) => String(l._id) === rid) as any)?.shareId ?? rid;
    const emailOf = async (id: string) => {
      if (!id || !ObjectId.isValid(id)) return id || '?';
      const x: any = await lc().collection('users').findOne({ _id: new ObjectId(id) }, { projection: { email: 1 } });
      return x?.email ?? id;
    };
    for (const e of now) if (!before.has(e)) {
      const [rid, type, pid, by] = e.split('|');
      if (pid && pid === by) continue; // Besitzer-Eintrag beim Anlegen
      logShare({ actor: await emailOf(by), action: 'share', kind: 'chat', resource: sid(rid), target: type === 'user' ? await emailOf(pid) : type });
    }
    for (const e of before) if (!now.has(e)) {
      const [rid, type, pid, by] = e.split('|');
      if (pid && pid === by) continue;
      logShare({ actor: await emailOf(by), action: 'unshare', kind: 'chat', resource: sid(rid), target: type === 'user' ? await emailOf(pid) : type });
    }
  }
  await wb().collection('meta').updateOne({ _id: 'chat_shares' as any }, { $set: { entries: [...now], at: new Date() } }, { upsert: true });
}

export const fileStat = (f: any) => { try { return statSync(filePath(f)).size; } catch { return 0; } };
