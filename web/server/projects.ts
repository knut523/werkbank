// Projekte (Plan 81, Schnitt 6; Knut, 07.10.2026): „wenn ein Agent an einer Task in einem Workstream arbeitet, dann
// auch ein Projekt kreieren oder zuordnen“ — Entscheidung b): ein Projekt ist eine Gruppe in der Werkbank (Mongo
// `projects`), gehört zu genau einem Workstream, und jeder Workstream ist automatisch ein eigener Bereich im Vault.
//
// Zuordnen vor Anlegen: das Projekt, das das Ticket schon hat → ein passendes im Workstream (Titelbegriffe) → neu.
// Im Vault schreibt die Werkbank nur zwischen den Markern in der Übersicht des Workstream-Bereichs; der Rest der
// Notiz gehört den Menschen.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, renameSync } from 'node:fs';
import { join, relative } from 'node:path';
import { cfg, browseUrl } from './config.ts';
import { wb } from './db.ts';
import type { User } from './auth.ts';
import type { Issue } from './jira.ts';

export interface Project {
  _id: string; name: string; workstream: string | null; tickets: string[];
  createdBy: string; createdByName: string; createdAt: Date; updatedAt: Date;
}

const STOP = new Set(['und', 'oder', 'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'mit', 'für', 'fuer', 'von', 'auf',
  'aus', 'bei', 'nach', 'über', 'ueber', 'unter', 'zum', 'zur', 'ist', 'sind', 'wird', 'werden', 'noch', 'neue', 'neuer', 'alle',
  'olaf', 'the', 'and', 'for', 'with', 'task', 'ticket', 'klären', 'klaeren', 'prüfen', 'pruefen', 'erstellen', 'umsetzen', 'machen',
  // Allgemeine Projektwörter, die nichts über das Thema sagen (Review 07.10.: „Abstimmung“ verband fremde Tickets).
  'abstimmung', 'dokumentation', 'anforderungen', 'anforderung', 'konzept', 'umsetzung', 'analyse', 'planung', 'update',
  'review', 'test', 'tests', 'testen', 'fehler', 'anpassen', 'anpassung', 'erweitern', 'erweiterung', 'thema', 'themen']);

/** Begriffe eines Titels: klein, ohne Key, ohne Füllwörter, ab 4 Zeichen. */
export function terms(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/\b[a-z]+-\d+\b/g, ' ').split(/[^a-z0-9äöüß]+/).filter((w) => w.length >= 4 && !STOP.has(w)));
}

/** Passt ein Projektname zum Ticket? Mindestens zwei gemeinsame Begriffe (ein einzelnes Wort verband fremde Tickets). */
export function matches(projectName: string, title: string): boolean {
  const a = terms(projectName), b = terms(title);
  return [...a].filter((w) => b.has(w)).length >= 2;
}

/** Name eines neuen Projekts: der Ticket-Titel ohne führenden Key. */
export const projectNameFor = (i: Pick<Issue, 'summary'>) => i.summary.replace(/^\s*[A-Z]+-\d+\s*[·:-]?\s*/, '').trim().slice(0, 80) || 'Projekt';

const col = () => wb().collection<Project>('projects');

/**
 * Das Projekt für ein Ticket: vorhandene Zuordnung, sonst ein passendes im selben Workstream, sonst ein neues.
 * Ein Workstream-Ticket selbst bekommt kein Projekt (es ist der Bereich, nicht die Arbeit darin).
 */
export async function assignProject(u: User, i: Issue): Promise<Project | null> {
  if (i.type === 'Workstream') return null;
  const had = await col().findOne({ tickets: i.key });
  if (had) return had;
  const ws = i.workstream ?? null;
  const candidates = await col().find({ workstream: ws }).sort({ updatedAt: -1 }).toArray();
  const hit = candidates.find((p) => (i.parent && p.tickets.includes(i.parent)) || matches(p.name, i.summary));
  const now = new Date();
  if (hit) {
    await col().updateOne({ _id: hit._id }, { $addToSet: { tickets: i.key }, $set: { updatedAt: now } });
    return { ...hit, tickets: [...hit.tickets, i.key] };
  }
  const p: Project = { _id: randomUUID(), name: projectNameFor(i), workstream: ws, tickets: [i.key], createdBy: u.id, createdByName: u.name, createdAt: now, updatedAt: now };
  await col().insertOne(p as any);
  // Zwei gleichzeitige Starts am selben Ticket: das älteste Projekt gewinnt, das jüngere geht wieder.
  const all = await col().find({ tickets: i.key }).sort({ createdAt: 1, _id: 1 }).toArray();
  if (all.length > 1 && all[0]._id !== p._id) { await col().deleteOne({ _id: p._id }); return all[0]; }
  return p;
}

export async function projectOfTicket(key: string): Promise<Project | null> {
  return col().findOne({ tickets: key });
}

export async function listProjects(): Promise<Project[]> {
  return col().find({}).sort({ workstream: 1, updatedAt: -1 }).toArray();
}

export async function renameProject(id: string, name: string): Promise<Project> {
  const n = name.trim().slice(0, 80);
  if (!n) throw Object.assign(new Error('Name fehlt.'), { status: 400 });
  const r = await col().findOneAndUpdate({ _id: id }, { $set: { name: n, updatedAt: new Date() } }, { returnDocument: 'after' });
  if (!r) throw Object.assign(new Error('Projekt nicht gefunden.'), { status: 404 });
  return r as Project;
}

/** Ticket einem anderen (oder neuen) Projekt zuordnen; Dateien und Läufe des Tickets ziehen mit. */
export async function moveTicket(u: User, i: Issue, target: { projectId?: string; newName?: string }): Promise<Project> {
  let dest: Project | null = null;
  if (target.projectId) {
    dest = await col().findOne({ _id: target.projectId });
    if (!dest) throw Object.assign(new Error('Projekt nicht gefunden.'), { status: 404 });
    if ((dest.workstream ?? null) !== (i.workstream ?? null)) throw Object.assign(new Error('Das Projekt gehört zu einem anderen Workstream.'), { status: 400 });
  }
  await col().updateMany({ tickets: i.key }, { $pull: { tickets: i.key } } as any);
  const now = new Date();
  if (dest) {
    await col().updateOne({ _id: dest._id }, { $addToSet: { tickets: i.key }, $set: { updatedAt: now } });
  } else {
    dest = { _id: randomUUID(), name: (target.newName ?? '').trim().slice(0, 80) || projectNameFor(i), workstream: i.workstream ?? null, tickets: [i.key], createdBy: u.id, createdByName: u.name, createdAt: now, updatedAt: now };
    await col().insertOne(dest as any);
  }
  await wb().collection('files').updateMany({ tickets: i.key }, { $set: { projectId: dest._id } });
  await wb().collection('agent_runs').updateMany({ key: i.key }, { $set: { projectId: dest._id } });
  await col().deleteMany({ tickets: { $size: 0 } });
  return dest;
}

/** Zwei Projekte desselben Workstreams zusammenlegen (from geht in into auf). */
export async function mergeProjects(fromId: string, intoId: string): Promise<void> {
  if (fromId === intoId) return;
  const [from, into] = await Promise.all([col().findOne({ _id: fromId }), col().findOne({ _id: intoId })]);
  if (!from || !into) throw Object.assign(new Error('Projekt nicht gefunden.'), { status: 404 });
  if ((from.workstream ?? null) !== (into.workstream ?? null)) throw Object.assign(new Error('Nur Projekte desselben Workstreams lassen sich zusammenlegen.'), { status: 400 });
  await col().updateOne({ _id: intoId }, { $addToSet: { tickets: { $each: from.tickets } }, $set: { updatedAt: new Date() } });
  await wb().collection('files').updateMany({ projectId: fromId }, { $set: { projectId: intoId } });
  await wb().collection('agent_runs').updateMany({ projectId: fromId }, { $set: { projectId: intoId } });
  await col().deleteOne({ _id: fromId });
}

// ---------- Workstream = eigener Bereich im Vault ----------

/**
 * Domäne unter olaf/2-Areas je Workstream — wie `olaf/2-Areas/olaf-2-areas.md` sie führt (Review 07.10.2026; vorher
 * aus dem Titel geraten, das legte einen fünften Ordner an). Überschreibbar: WERKBANK_WORKSTREAM_AREAS='{"PM-70":"Product",…}'.
 * Ein Workstream ohne Eintrag bekommt keinen automatisch angelegten Bereich (kein erfundener Ordner).
 */
const DEFAULT_AREAS: Record<string, string> = {
  'PM-69': 'Governance', 'PM-75': 'Governance', 'PM-150': 'Governance', 'PM-152': 'Governance', 'PM-154': 'Governance', 'PM-155': 'Governance',
  'PM-70': 'Product', 'PM-72': 'Product', 'PM-223': 'Product',
  'PM-71': 'Marketing',
  'PM-73': 'Operations', 'PM-153': 'Operations',
};

function areaRules(): Record<string, string> {
  try {
    const raw = process.env.WERKBANK_WORKSTREAM_AREAS;
    if (raw) return { ...DEFAULT_AREAS, ...(JSON.parse(raw) as Record<string, string>) };
  } catch { /* Vorgabe */ }
  return DEFAULT_AREAS;
}

/** „Vermarktung & GTM OLAF“ → „Vermarktung-GTM-OLAF“ (Groß/klein bleibt, wie `Produkt-OLAF`). */
export function workstreamSlug(title: string): string {
  return title.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss')
    .replace(/&/g, ' ').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'Workstream';
}

const olafRoot = () => join(cfg.vaultDir, 'olaf');

/** Vorhandener Ordner gleichen Namens unter olaf/2-Areas/* (eine Ebene tief), sonst null. */
function existingArea(slug: string): string | null {
  const areas = join(olafRoot(), '2-Areas');
  if (!existsSync(areas)) return null;
  for (const d of readdirSync(areas)) {
    const p = join(areas, d, slug);
    try { if (statSync(p).isDirectory()) return p; } catch { /* nicht da */ }
  }
  return null;
}

/** Ordner und Übersicht des Workstream-Bereichs (relativ zum Vault); null, wenn der Workstream keine Domäne hat. */
export function workstreamArea(ws: Pick<Issue, 'key' | 'summary'>): { dir: string; overview: string } | null {
  const slug = workstreamSlug(ws.summary);
  const domain = areaRules()[ws.key];
  if (!domain || !/^[A-Za-z0-9-]+$/.test(domain)) return null;
  const abs = existingArea(slug) ?? join(olafRoot(), '2-Areas', domain, slug);
  const dir = relative(cfg.vaultDir, abs);
  return { dir, overview: join(dir, `0-${slug.toLowerCase()}-uebersicht.md`) };
}

export const MARK_START = '<!-- werkbank:projekte -->';
export const MARK_END = '<!-- /werkbank:projekte -->';

const count = (s: string, x: string) => s.split(x).length - 1;

/**
 * Setzt den Werkbank-Block in eine Notiz ein: ersetzt ihn, wenn genau ein Start- und danach genau ein End-Marker
 * stehen; hängt ihn an, wenn keiner da ist. Bei jedem anderen Zustand (einer fehlt, doppelt, vertauscht) null — dann
 * schreibt die Werkbank NICHT, statt menschlichen Text zu löschen oder einen zweiten Block anzuhängen (Review B1).
 */
export function spliceBlock(note: string, block: string): string | null {
  const full = `${MARK_START}\n${block.trim()}\n${MARK_END}`;
  const starts = count(note, MARK_START), ends = count(note, MARK_END);
  if (starts === 0 && ends === 0) return note.replace(/\s*$/, '') + `\n\n## Projekte (Werkbank)\n\n${full}\n`;
  const a = note.indexOf(MARK_START);
  const b = note.indexOf(MARK_END, a + MARK_START.length);
  if (starts !== 1 || ends !== 1 || a < 0 || b < 0) return null;
  return note.slice(0, a) + full + note.slice(b + MARK_END.length);
}

function newOverview(ws: Pick<Issue, 'key' | 'summary'>): string {
  return [
    '---',
    `jira: ${ws.key}`,
    'tags: [workstream, werkbank]',
    '---',
    '',
    `# ${ws.summary}`,
    '',
    `Bereich des Workstreams [${ws.key}](${browseUrl(ws.key)}). Die Liste unten pflegt die Werkbank (Projekte, Tickets, Dateien, Chats);`,
    'alles außerhalb des markierten Blocks gehört euch.',
    '',
  ].join('\n');
}

/** Übersicht eines Workstreams neu schreiben (nur den Werkbank-Block). Liefert den Vault-Pfad. */
export async function syncWorkstreamOverview(ws: Pick<Issue, 'key' | 'summary'>, issues: Map<string, Issue>): Promise<string | null> {
  const area = workstreamArea(ws);
  if (!area) return null;
  const { dir, overview } = area;
  const projects = await col().find({ workstream: ws.key }).sort({ updatedAt: -1 }).toArray();
  const lines: string[] = [];
  if (!projects.length) lines.push('_Noch keine Projekte._');
  for (const p of projects) {
    lines.push(`### ${p.name}`);
    for (const k of p.tickets) {
      const i = issues.get(k);
      lines.push(`- [${k}](${browseUrl(k)}) ${i ? `${i.summary} — ${i.status}${i.assignee ? `, ${i.assignee}` : ''}` : ''}`.trimEnd());
    }
    // Vault-Notizen als Link; Dateien nur als Anzahl — ein Dateiname kann Personendaten tragen (Review S4), die Dateien
    // selbst bleiben privat in der Werkbank.
    const files = await wb().collection('files').find({ projectId: p._id }, { projection: { kind: 1, vaultPath: 1 } }).toArray();
    for (const f of files as any[]) if (f.kind === 'vault' && f.vaultPath) lines.push(`- 📝 [[${String(f.vaultPath).replace(/\.md$/, '')}]]`);
    const other = (files as any[]).filter((f) => f.kind !== 'vault').length;
    if (other) lines.push(`- 📎 ${other} ${other === 1 ? 'Datei' : 'Dateien'} in der Werkbank (an den Tickets)`);
    const chats = await wb().collection('agent_runs').find({ projectId: p._id, url: { $exists: true } }, { projection: { url: 1, key: 1, startedAt: 1 } }).sort({ startedAt: -1 }).limit(5).toArray();
    for (const c of chats as any[]) lines.push(`- 💬 [Chat ${c.key}, ${new Date(c.startedAt).toISOString().slice(0, 10)}](${c.url})`);
    lines.push('');
  }
  const abs = join(cfg.vaultDir, overview);
  const existed = existsSync(abs);
  const before = existed ? readFileSync(abs, 'utf8') : newOverview(ws);
  const after = spliceBlock(before, lines.join('\n'));
  if (after === null) throw new Error(`Werkbank-Marker in ${overview} unvollständig oder doppelt — nicht geschrieben`);
  if (!existed || after !== before) {
    mkdirSync(join(cfg.vaultDir, dir), { recursive: true });
    const tmp = `${abs}.werkbank-${process.pid}.tmp`;
    writeFileSync(tmp, after);
    renameSync(tmp, abs); // atomar: nie eine halbe Übersicht im Vault
  }
  return overview;
}
