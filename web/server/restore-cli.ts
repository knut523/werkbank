// Wiederherstellen aus einem entpackten Werkbank-Backup (Plan 81, Schnitt 5). Aufruf über `scripts/restore.sh <archiv>`.
//
//   node server/restore-cli.ts <entpackter-ordner> [--dry-run]
//
// Ziel: `MONGO_URI_WERKBANK` / `WERKBANK_DB`, Ablage `WERKBANK_DOCS_DIR`, Daten `WERKBANK_DATA_DIR`. Bricht ab, wenn die
// Ziel-DB nicht leer ist. Dateien werden nie überschrieben: gleiche Prüfsumme → übersprungen, abweichend → gemeldet.
// Personendaten-Dateien (`.enc`) brauchen `WERKBANK_BACKUP_KEY`; ohne ihn werden sie gemeldet und ausgelassen.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { BSON } from 'mongodb';
import { cfg } from './config.ts';
import { connect, closeDb, wb } from './db.ts';
import { decrypt, keyOf } from './backup.ts';
import { inDocs } from './ablage.ts';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.isFile() ? [join(dir, e.name)] : []));
}

export async function restore(src: string, opts: { dryRun?: boolean } = {}) {
  const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
  if (manifest.format !== 'werkbank-backup/1') throw new Error(`Unbekanntes Format: ${manifest.format}`);
  // Kein connect() vor der Prüfung: connect() legt Indizes an und machte eine leere DB „nicht leer“ — erst prüfen.
  const { MongoClient } = await import('mongodb');
  const probe = await MongoClient.connect(cfg.mongoUri, { serverSelectionTimeoutMS: 4000 });
  const existing = (await probe.db(cfg.db).listCollections({}, { nameOnly: true }).toArray()).filter((c: any) => !c.name.startsWith('system.'));
  await probe.close();
  if (existing.length) throw new Error(`Ziel-DB „${cfg.db}“ ist nicht leer (${existing.length} Sammlungen) — Wiederherstellen nur in eine leere DB.`);
  const report: any = { db: cfg.db, docsDir: cfg.docsDir, collections: {}, files: { written: 0, same: 0, conflict: [] as string[], noKey: [] as string[] }, shareLog: 'nicht im Archiv' };
  const key = keyOf();
  if (manifest.keyId && key && createHash('sha256').update(key).digest('hex').slice(0, 12) !== manifest.keyId) throw new Error('WERKBANK_BACKUP_KEY passt nicht zu diesem Archiv.');
  if (opts.dryRun) return { ...report, dryRun: true, manifest };

  const mongo = await import('mongodb');
  const client = await mongo.MongoClient.connect(cfg.mongoUri, { serverSelectionTimeoutMS: 4000 });
  try {
    const db = client.db(cfg.db);
    const base = join(src, 'werkbank');
    for (const name of existsSync(base) ? readdirSync(base).sort() : []) {
      let n = 0;
      for (const part of readdirSync(join(base, name)).filter((p) => p.endsWith('.jsonl')).sort()) {
        const docs = readFileSync(join(base, name, part), 'utf8').split('\n').filter(Boolean).map((l) => BSON.EJSON.parse(l, { relaxed: false }));
        if (docs.length) { await db.collection(name).insertMany(docs as any[], { ordered: true }); n += docs.length; }
      }
      const idxFile = join(base, name, '_indexes.json');
      if (existsSync(idxFile)) {
        for (const i of JSON.parse(readFileSync(idxFile, 'utf8'))) {
          const { key: k, v: _v, ns: _ns, ...o } = i;
          await db.collection(name).createIndex(k, o);
        }
      }
      if (n === 0) await db.createCollection(name).catch(() => {});
      report.collections[name] = n;
    }
  } finally { await client.close(); }

  const put = (dest: string, data: Buffer, rel: string) => {
    if (existsSync(dest)) { if (sha(readFileSync(dest)) === sha(data)) report.files.same++; else report.files.conflict.push(rel); return; }
    mkdirSync(dirname(dest), { recursive: true, mode: 0o700 });
    writeFileSync(dest, data, { mode: 0o600, flag: 'wx' });
    report.files.written++;
  };
  for (const abs of walk(join(src, 'ablage'))) {
    let rel = relative(join(src, 'ablage'), abs).split(sep).join('/');
    let data = readFileSync(abs);
    if (rel.endsWith('.enc')) {
      if (!key) { report.files.noKey.push(rel); continue; }
      data = decrypt(data, key);
      rel = rel.slice(0, -4);
    }
    put(inDocs(rel), data, rel);
  }
  for (const abs of walk(join(src, 'speicher'))) {
    let rel = relative(join(src, 'speicher'), abs).split(sep).join('/');
    let data = readFileSync(abs);
    if (rel.endsWith('.enc')) { if (!key) { report.files.noKey.push(rel); continue; } data = decrypt(data, key); rel = rel.slice(0, -4); }
    if (rel.split('/').some((p) => p === '..' || p === '')) continue;
    put(join(cfg.dataDir, 'files', rel), data, `speicher/${rel}`);
  }
  const log = join(src, 'share-log.jsonl');
  if (existsSync(log)) {
    const dest = join(cfg.dataDir, 'share-log.jsonl');
    if (existsSync(dest)) report.shareLog = 'vorhanden, nicht überschrieben';
    else { mkdirSync(cfg.dataDir, { recursive: true }); writeFileSync(dest, readFileSync(log), { mode: 0o600 }); report.shareLog = 'wiederhergestellt'; }
  }
  // Gegenprobe über die Werkbank-Verbindung: stehen die Dateien aus Mongo wieder an ihrem Ort?
  await connect();
  const files = await wb().collection('files').find({ kind: { $ne: 'vault' }, path: { $exists: true } }).toArray();
  report.check = { filesInDb: files.length, presentOnDisk: files.filter((f: any) => existsSync(inDocs(f.path))).length };
  await closeDb();
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const src = process.argv[2];
  if (!src) { console.error('Aufruf: node server/restore-cli.ts <entpackter-ordner> [--dry-run]'); process.exit(2); }
  restore(src, { dryRun: process.argv.includes('--dry-run') })
    .then((r) => { console.log(JSON.stringify(r, null, 1)); process.exit(0); })
    .catch((e) => { console.error(`Wiederherstellen abgebrochen: ${e.message}`); process.exit(1); });
}
