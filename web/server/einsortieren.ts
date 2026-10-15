// Einsortieren in die Ablage (Plan 81, Schnitte 1–3): Vorschlag je Datei, „Ablegen“ nach Bestätigung, Agenten-Dateien
// ohne Klick (nur wenn der Vorschlag sicher ist), und der einmalige Umzug des alten Speichers `files/<id>/<name>`.

import { existsSync, rmSync } from 'node:fs';
import { basename, dirname, extname } from 'node:path';
import { wb } from './db.ts';
import type { User } from './auth.ts';
import { checkVorschlag, EINGANG, folders, isEingang, isPlainFile, moveInto, ortAus, schemaName, sha256File, suggest, type Vorschlag } from './ablage.ts';
import { filePath, legacyPath, logShare } from './sharing.ts';

const today = () => new Date().toISOString().slice(0, 10);

async function projectName(id?: string | null): Promise<string | null> {
  if (!id) return null;
  const p: any = await wb().collection('projects').findOne({ _id: id as any }, { projection: { name: 1 } });
  return p?.name ?? null;
}

/** Vorschlag für eine Datei aus Mongo (Name, Tickets, Projekt, vorhandene Ordner). */
export async function suggestFor(f: any, known = folders()): Promise<Vorschlag> {
  return suggest({ name: f.originalName ?? f.name, tickets: f.tickets ?? [], projectName: await projectName(f.projectId), folders: known, today: today() });
}

/** Zielort für eine Datei, die ohne Klick abgelegt wird: sicher → Vorgangsordner mit Schema-Namen, sonst `_eingang/`. */
export function autoTarget(name: string, v: Vorschlag): { relDir: string; name: string } {
  return v.sicher ? { relDir: `${v.team}/${v.vorgang}`, name: schemaName(v, extname(name)) } : { relDir: EINGANG, name };
}

/** „Ablegen“: die eigene Datei mit den (geprüften) Angaben an ihren Platz bringen. */
export async function ablegen(u: User, id: string, input: any): Promise<{ path: string; name: string }> {
  const col = wb().collection('files');
  const f: any = await col.findOne({ _id: id as any, owner: u.id });
  if (!f) throw Object.assign(new Error('Nur die eigene Datei kann abgelegt werden.'), { status: 403 });
  if (f.kind === 'vault') throw Object.assign(new Error('Vault-Notizen bleiben im Vault.'), { status: 400 });
  // Ablage-Datei in einem Unterordner (z. B. eine Website mit fonts/, shots/): nicht herauslösen (Council, Bedingung 1).
  if (f.kind === 'ablage' && f.path && ortAus(f.path).sub) throw Object.assign(new Error('Die Datei gehört zu einem Unterordner in deiner Ablage — dort verschieben.'), { status: 400 });
  const v = checkVorschlag(input);
  const src = filePath(f);
  if (!isPlainFile(src)) throw Object.assign(new Error('Die Datei liegt nicht mehr an ihrem Ablageort.'), { status: 404 });
  const path = moveInto(src, `${v.team}/${v.vorgang}`, schemaName(v, extname(f.name)));
  const ticket = String(input?.ticket ?? '').trim().toUpperCase();
  const set: any = { path, name: basename(path), originalName: f.originalName ?? f.name, ablage: { ...v, at: new Date(), by: u.email }, updatedAt: new Date() };
  await col.updateOne({ _id: id as any }, { $set: set, ...(/^[A-Z][A-Z0-9]+-\d+$/.test(ticket) ? { $addToSet: { tickets: ticket } } : {}) } as any);
  if (!f.path) rmSync(dirname(legacyPath(f)), { recursive: true, force: true }); // Altbestand: leeren Ordner aufräumen
  logShare({ actor: u.email, action: 'ablegen', kind: 'file', resource: id });
  return { path, name: basename(path) };
}

/**
 * Einmaliger Umzug (beim Start, idempotent): jede Datei ohne `path` aus `files/<id>/<name>` in die Ablage.
 * Reihenfolge: Kopie am Ziel (Prüfsumme) → Mongo → Altkopie weg. Ein Abbruch hinterlässt höchstens eine Kopie zu viel,
 * nie einen Eintrag ohne Datei. Uploads kommen nach `_eingang/` (bestätigt wird von Hand), Agenten-Dateien mit sicherem
 * Vorschlag direkt in ihren Vorgangsordner. `_id`, Tickets, Freigaben und Personendaten bleiben unverändert.
 */
export async function migrateLegacy(log: (m: string, x?: any) => void = () => {}): Promise<{ moved: number; missing: number; failed: number }> {
  const col = wb().collection('files');
  const known = folders();
  let moved = 0, missing = 0, failed = 0;
  for await (const f of col.find({ kind: { $ne: 'vault' }, path: { $exists: false } }) as any) {
    const src = legacyPath(f);
    if (!existsSync(src)) { missing++; continue; }
    try {
      const t = f.kind === 'agent' ? autoTarget(f.name, await suggestFor(f, known)) : { relDir: EINGANG, name: f.name };
      const path = moveInto(src, t.relDir, t.name, { copy: true });
      if (f.sha256 && sha256File(filePath({ path })) !== f.sha256) { rmSync(filePath({ path }), { force: true }); throw new Error('Prüfsumme weicht ab'); }
      const r = await col.updateOne({ _id: f._id, path: { $exists: false } }, { $set: { path, name: basename(path), originalName: f.name } });
      if (!r.modifiedCount) { rmSync(filePath({ path }), { force: true }); continue; } // anderer Lauf war schneller
      rmSync(dirname(src), { recursive: true, force: true });
      moved++;
    } catch (e: any) { failed++; log('ablage-umzug', { id: f._id, error: String(e?.message ?? e).slice(0, 200) }); }
  }
  if (moved || missing || failed) log('ablage-umzug', { moved, missing, failed });
  return { moved, missing, failed };
}

/** Für die Liste: liegt die Datei noch an ihrem Ort, und ist sie noch einzusortieren? */
export function placeInfo(f: any): { place: string | null; eingang: boolean; fehlt: boolean } {
  if (f.kind === 'vault') return { place: null, eingang: false, fehlt: false };
  const p = filePath(f);
  return { place: f.path ? f.path.split('/').slice(0, -1).join('/') : null, eingang: !f.path || isEingang(f.path), fehlt: !isPlainFile(p) };
}
