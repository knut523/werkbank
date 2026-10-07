// Projekte (Plan 81, Schnitt 6; Knut, 07.10.2026): „wenn ein Agent an einer Task in einem Workstream arbeitet, dann
// auch ein Projekt kreieren oder zuordnen“ — Entscheidung b): ein Projekt ist eine Gruppe in der Werkbank (Mongo
// `projects`), gehört zu genau einem Workstream, und jeder Workstream ist automatisch ein eigener Bereich im Vault.
//
// Zuordnen vor Anlegen: das Projekt, das das Ticket schon hat → ein passendes im Workstream (Titelbegriffe) → neu.
// Im Vault schreibt die Werkbank nur zwischen den Markern in der Übersicht des Workstream-Bereichs; der Rest der
// Notiz gehört den Menschen.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
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
  'olaf', 'the', 'and', 'for', 'with', 'task', 'ticket', 'klären', 'klaeren', 'prüfen', 'pruefen', 'erstellen', 'umsetzen', 'machen']);

/** Begriffe eines Titels: klein, ohne Key, ohne Füllwörter, ab 4 Zeichen. */
export function terms(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/\b[a-z]+-\d+\b/g, ' ').split(/[^a-z0-9äöüß]+/).filter((w) => w.length >= 4 && !STOP.has(w)));
}

/** Passt ein Projektname zum Ticket? Zwei gemeinsame Begriffe, oder einer, der lang (≥ 8) ist. */
export function matches(projectName: string, title: string): boolean {
  const a = terms(projectName), b = terms(title);
  const common = [...a].filter((w) => b.has(w));
  return common.length >= 2 || common.some((w) => w.length >= 8);
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

/** Domäne unter olaf/2-Areas je Workstream-Titel. Überschreibbar: WERKBANK_WORKSTREAM_AREAS='[["regex","Domäne"],…]'. */
const DEFAULT_AREAS: [RegExp, string][] = [
  [/produkt/i, 'Product'],
  [/vermarktung|gtm|marketing/i, 'Marketing'],
  [/operations|betrieb/i, 'Operations'],
  [/strategie|intern|orga/i, 'Governance'],
  [/gf-modell|geschäftsfeld|geschaeftsfeld/i, 'Neue-Geschaeftsfelder'],
];

function areaRules(): [RegExp, string][] {
  try {
    const raw = process.env.WERKBANK_WORKSTREAM_AREAS;
    if (raw) return (JSON.parse(raw) as [string, string][]).map(([re, d]) => [new RegExp(re, 'i'), d]);
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

/** Ordner und Übersicht des Workstream-Bereichs (relativ zum Vault). */
export function workstreamArea(ws: Pick<Issue, 'key' | 'summary'>): { dir: string; overview: string } {
  const slug = workstreamSlug(ws.summary);
  const domain = areaRules().find(([re]) => re.test(ws.summary))?.[1] ?? 'Workstreams';
  const abs = existingArea(slug) ?? join(olafRoot(), '2-Areas', domain, slug);
  const dir = relative(cfg.vaultDir, abs);
  return { dir, overview: join(dir, `0-${slug.toLowerCase()}-uebersicht.md`) };
}

export const MARK_START = '<!-- werkbank:projekte -->';
export const MARK_END = '<!-- /werkbank:projekte -->';

/** Setzt den Werkbank-Block in eine Notiz ein (ersetzt ihn, oder hängt ihn an); der Rest bleibt unangetastet. */
export function spliceBlock(note: string, block: string): string {
  const full = `${MARK_START}\n${block.trim()}\n${MARK_END}`;
  const a = note.indexOf(MARK_START), b = note.indexOf(MARK_END);
  if (a >= 0 && b > a) return note.slice(0, a) + full + note.slice(b + MARK_END.length);
  return note.replace(/\s*$/, '') + `\n\n## Projekte (Werkbank)\n\n${full}\n`;
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
export async function syncWorkstreamOverview(ws: Pick<Issue, 'key' | 'summary'>, issues: Map<string, Issue>): Promise<string> {
  const { dir, overview } = workstreamArea(ws);
  const projects = await col().find({ workstream: ws.key }).sort({ updatedAt: -1 }).toArray();
  const lines: string[] = [];
  if (!projects.length) lines.push('_Noch keine Projekte._');
  for (const p of projects) {
    lines.push(`### ${p.name}`);
    for (const k of p.tickets) {
      const i = issues.get(k);
      lines.push(`- [${k}](${browseUrl(k)}) ${i ? `${i.summary} — ${i.status}${i.assignee ? `, ${i.assignee}` : ''}` : ''}`.trimEnd());
    }
    // Dateien: nur Namen und nur nicht personenbezogene (die Datei selbst bleibt privat in der Werkbank).
    const files = await wb().collection('files').find({ projectId: p._id, personal: { $ne: true } }, { projection: { name: 1, kind: 1, vaultPath: 1 } }).toArray();
    for (const f of files as any[]) lines.push(f.kind === 'vault' && f.vaultPath ? `- 📝 [[${String(f.vaultPath).replace(/\.md$/, '')}]]` : `- 📎 ${f.name}`);
    const chats = await wb().collection('agent_runs').find({ projectId: p._id, url: { $exists: true } }, { projection: { url: 1, key: 1, startedAt: 1 } }).sort({ startedAt: -1 }).limit(5).toArray();
    for (const c of chats as any[]) lines.push(`- 💬 [Chat ${c.key}, ${new Date(c.startedAt).toISOString().slice(0, 10)}](${c.url})`);
    lines.push('');
  }
  const abs = join(cfg.vaultDir, overview);
  const existed = existsSync(abs);
  const before = existed ? readFileSync(abs, 'utf8') : newOverview(ws);
  const after = spliceBlock(before, lines.join('\n'));
  if (!existed || after !== before) {
    mkdirSync(join(cfg.vaultDir, dir), { recursive: true });
    writeFileSync(abs, after);
  }
  return overview;
}
