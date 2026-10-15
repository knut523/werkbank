// Backup als Download (Plan 81, Schnitt 5): die DB `werkbank` + die Dateien der Ablage + `share-log.jsonl` als ein
// `.tar.gz`, gestreamt — nichts bleibt liegen. Nächtlich dasselbe Archiv auf der VM (7 Stück aufbewahrt).
//
// - Mongo als Canonical EJSON über den Treiber (je Sammlung Teile zu 1000 Dokumenten, dazu die Indizes) — `mongodump`
//   ist auf der VM nicht installiert, und so braucht das Backup kein weiteres Programm.
// - Ohne Zugangsdaten: `creds` (verschlüsselte Claude-/Jira-Zugänge) und `sessions` (Anmeldungen) fehlen absichtlich.
// - Personendaten-Dateien (Knut, 09.10.2026: mit hinein, verschlüsselt, nur für Admins): AES-256-GCM mit
//   `WERKBANK_BACKUP_KEY` als `<name>.enc` (`WBENC1` | IV 12 | Chiffrat | Tag 16). Ohne Schlüssel bleiben sie draußen,
//   das Manifest sagt es.
// - Nur Dateien, die die Werkbank kennt (Mongo `files`), nicht Knuts übrige Dokumente im selben Ordner.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createGzip } from 'node:zlib';
import type { Writable } from 'node:stream';
import { BSON } from 'mongodb';
import { cfg } from './config.ts';
import { wb } from './db.ts';
import { filePath } from './sharing.ts';

export const EXCLUDED = ['creds', 'sessions'];
export const CHUNK = 1000;
const MAGIC = Buffer.from('WBENC1');

// ---------- tar (ustar + pax für Umlaute und lange Namen) ----------

function octal(n: number, len: number) { return Buffer.from(n.toString(8).padStart(len - 1, '0') + '\0', 'ascii'); }

function header(name: string, size: number, mtime: number, type: '0' | 'x'): Buffer {
  const h = Buffer.alloc(512, 0);
  h.write(name, 0, 100, 'utf8');
  octal(0o600, 8).copy(h, 100); octal(0, 8).copy(h, 108); octal(0, 8).copy(h, 116);
  octal(size, 12).copy(h, 124); octal(Math.floor(mtime / 1000), 12).copy(h, 136);
  h.fill(0x20, 148, 156);
  h.write(type, 156, 1, 'ascii');
  h.write('ustar\0', 257, 6, 'ascii'); h.write('00', 263, 2, 'ascii');
  let sum = 0; for (const b of h) sum += b;
  Buffer.from(sum.toString(8).padStart(6, '0') + '\0 ', 'ascii').copy(h, 148);
  return h;
}

/** Ein pax-Satz `<len> path=<name>\n`; die Länge zählt sich selbst mit. */
function paxRecord(key: string, value: string): Buffer {
  const body = ` ${key}=${value}\n`;
  let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body);
  return Buffer.from(`${len}${body}`, 'utf8');
}

export class TarGz {
  private gz = createGzip();
  constructor(out: Writable) { this.gz.pipe(out); }
  private write(b: Buffer): Promise<void> {
    return new Promise((res) => { if (this.gz.write(b)) res(); else this.gz.once('drain', () => res()); });
  }
  private async raw(name: string, data: Buffer, type: '0' | 'x', mtime: number) {
    await this.write(header(name, data.length, mtime, type));
    await this.write(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad) await this.write(Buffer.alloc(pad));
  }
  async entry(name: string, data: Buffer, mtime = Date.now()) {
    // Nicht-ASCII oder länger als 100 Bytes: der echte Name steht im pax-Kopf, der ustar-Name ist nur Ersatz.
    if (!/^[\x20-\x7e]*$/.test(name) || Buffer.byteLength(name) > 100) {
      await this.raw(`PaxHeader/${createHash('sha1').update(name).digest('hex')}`, paxRecord('path', name), 'x', mtime);
      await this.raw(name.replace(/[^\x20-\x7e]/g, '_').slice(-100), data, '0', mtime);
    } else await this.raw(name, data, '0', mtime);
  }
  async end(): Promise<void> {
    await this.write(Buffer.alloc(1024));
    await new Promise<void>((res) => this.gz.end(res));
  }
}

// ---------- Verschlüsselung ----------

export function keyOf(hex = cfg.backupKey): Buffer | null {
  return /^[0-9a-f]{64}$/i.test(hex) ? Buffer.from(hex, 'hex') : null;
}
export function encrypt(data: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(data), c.final()]);
  return Buffer.concat([MAGIC, iv, body, c.getAuthTag()]);
}
export function decrypt(blob: Buffer, key: Buffer): Buffer {
  if (!blob.subarray(0, 6).equals(MAGIC)) throw new Error('Kein verschlüsselter Werkbank-Eintrag.');
  const d = createDecipheriv('aes-256-gcm', key, blob.subarray(6, 18));
  d.setAuthTag(blob.subarray(blob.length - 16));
  return Buffer.concat([d.update(blob.subarray(18, blob.length - 16)), d.final()]);
}

// ---------- Archiv ----------

let running = false;
export const backupRunning = () => running;

/** Das Archiv in `out` schreiben. Liefert das Manifest (auch im Archiv als `manifest.json`). */
export async function writeBackup(out: Writable): Promise<any> {
  if (running) throw Object.assign(new Error('Es läuft schon ein Backup — gleich noch einmal versuchen.'), { status: 409 });
  running = true;
  try {
    const tar = new TarGz(out);
    const key = keyOf();
    const manifest: any = {
      format: 'werkbank-backup/1', createdAt: new Date().toISOString(), db: cfg.db, excluded: EXCLUDED,
      collections: {} as Record<string, number>, files: 0, encrypted: 0, skipped: [] as Array<{ id: string; why: string }>,
      keyId: key ? createHash('sha256').update(key).digest('hex').slice(0, 12) : null,
    };
    const db = wb();
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c: any) => c.name)
      .filter((n: string) => !EXCLUDED.includes(n) && !n.startsWith('system.')).sort();
    for (const name of names) {
      const col = db.collection(name);
      let part = 0, n = 0, lines: string[] = [];
      const flush = async () => {
        if (!lines.length) return;
        await tar.entry(`werkbank/${name}/${String(++part).padStart(4, '0')}.jsonl`, Buffer.from(lines.join('\n') + '\n'));
        lines = [];
      };
      for await (const d of col.find({})) {
        lines.push(BSON.EJSON.stringify(d, { relaxed: false }));
        n++;
        if (lines.length >= CHUNK) await flush();
      }
      await flush();
      const idx = (await col.indexes()).filter((i: any) => i.name !== '_id_');
      await tar.entry(`werkbank/${name}/_indexes.json`, Buffer.from(JSON.stringify(idx, null, 1)));
      manifest.collections[name] = n;
    }
    for await (const f of db.collection('files').find({ kind: { $ne: 'vault' } }) as any) {
      const abs = filePath(f);
      let st;
      try { st = lstatSync(abs); } catch { manifest.skipped.push({ id: f._id, why: 'nicht mehr am Ablageort' }); continue; }
      if (!st.isFile()) { manifest.skipped.push({ id: f._id, why: 'keine Datei' }); continue; }
      const name = f.path ? `ablage/${f.path}` : `speicher/${f._id}/${f.name}`;
      if (f.personal) {
        if (!key) { manifest.skipped.push({ id: f._id, why: 'Personendaten, kein WERKBANK_BACKUP_KEY' }); continue; }
        await tar.entry(`${name}.enc`, encrypt(readFileSync(abs), key), st.mtimeMs);
        manifest.encrypted++;
      } else await tar.entry(name, readFileSync(abs), st.mtimeMs);
      manifest.files++;
    }
    const log = join(cfg.dataDir, 'share-log.jsonl');
    if (existsSync(log)) await tar.entry('share-log.jsonl', readFileSync(log));
    await tar.entry('manifest.json', Buffer.from(JSON.stringify(manifest, null, 1)));
    await tar.end();
    return manifest;
  } finally { running = false; }
}

// ---------- Nachtarchiv ----------

export const backupDir = () => join(cfg.dataDir, 'backups');

export function listBackups(): Array<{ name: string; size: number; at: string }> {
  const dir = backupDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => /^werkbank-\d{4}-\d{2}-\d{2}\.tar\.gz$/.test(n)).sort().reverse()
    .map((n) => { const st = statSync(join(dir, n)); return { name: n, size: st.size, at: st.mtime.toISOString() }; });
}

/** Einmal je Tag ab `WERKBANK_BACKUP_HOUR`: Archiv auf die VM, die neuesten `WERKBANK_BACKUP_KEEP` bleiben. */
export async function nightly(now = new Date()): Promise<string | null> {
  if (cfg.backupHour < 0 || now.getHours() < cfg.backupHour) return null;
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const dir = backupDir();
  const dest = join(dir, `werkbank-${day}.tar.gz`);
  if (existsSync(dest)) return null;
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${dest}.tmp`;
  const ws = createWriteStream(tmp, { mode: 0o600 });
  const done = new Promise<void>((res, rej) => { ws.on('finish', () => res()); ws.on('error', rej); });
  try { await writeBackup(ws); await done; } catch (e) { rmSync(tmp, { force: true }); throw e; }
  renameSync(tmp, dest);
  for (const old of listBackups().slice(Math.max(1, cfg.backupKeep))) rmSync(join(dir, old.name), { force: true });
  return dest;
}
