// Jira-Kopie des Projekts PM (Projektname "OLAF" — nicht das Projekt mit dem Schlüssel OLAF).
// Lesen: REST über das api.atlassian.com-Gateway (scoped Tokens gehen nur dort), wie jira-read.sh.
// Schreiben (Kommentar, Status, Fälligkeit): nur nach Bestätigung in der Oberfläche und nur mit
// dem Token der Person, die klickt. Neue Tickets legt die Werkbank nicht an (olaf-jira-Regel).

import { jiraChanged } from './events.ts';
import { cfg, jiraBase } from './config.ts';
import { wb } from './db.ts';
import type { JiraCreds } from './creds.ts';

export const STATUS_COLUMNS = ['Backlog', 'To Do', 'In Progress', 'Ongoing', 'Done'];
const FIELDS = ['summary', 'status', 'assignee', 'parent', 'duedate', 'priority', 'updated', 'created', 'description', 'comment', 'issuetype', 'labels'];

export class JiraError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function jiraFetch(creds: JiraCreds, method: string, path: string, body?: unknown): Promise<any> {
  const auth = Buffer.from(`${creds.email}:${creds.token}`).toString('base64');
  const r = await fetch(jiraBase() + path, {
    method,
    headers: { authorization: `Basic ${auth}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (r.status === 204) return null;
  const text = await r.text();
  if (!r.ok) {
    let msg = `Jira antwortet mit ${r.status}`;
    try { const j = JSON.parse(text); msg += ': ' + [...(j.errorMessages ?? []), ...Object.values(j.errors ?? {})].join('; '); } catch { /* kein JSON */ }
    if (r.status === 401 || r.status === 403) msg += ' — der Token hat dafür keine Berechtigung (für Schreiben braucht er write:jira-work).';
    throw new JiraError(r.status, msg.slice(0, 400));
  }
  return text ? JSON.parse(text) : null;
}

// ---------- Atlassian Document Format → Text ----------

export function adfText(node: any, max = 600): string {
  const parts: string[] = [];
  const walk = (n: any) => {
    if (!n || parts.join('').length > max * 2) return;
    if (typeof n === 'string') { parts.push(n); return; }
    if (n.type === 'text') parts.push(n.text ?? '');
    else if (n.type === 'hardBreak') parts.push('\n');
    else if (n.type === 'mention') parts.push(n.attrs?.text ?? '@');
    else if (n.type === 'inlineCard') parts.push(n.attrs?.url ?? '');
    for (const c of n.content ?? []) walk(c);
    if (['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote'].includes(n.type)) parts.push('\n');
  };
  walk(node);
  const t = parts.join('').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

export const adfDoc = (text: string) => ({
  type: 'doc', version: 1,
  content: text.split(/\n{2,}/).map((p) => ({
    type: 'paragraph',
    content: p.split('\n').flatMap((line, i) => [...(i ? [{ type: 'hardBreak' }] : []), ...(line ? [{ type: 'text', text: line }] : [])]),
  })),
});

// ---------- Abbildung ----------

export interface Issue {
  key: string; summary: string; status: string; statusCategory?: string; type: string;
  assignee: string | null; assigneeId?: string | null; parent: string | null; parentSummary?: string | null;
  duedate: string | null; priority: string | null; updated: string; created?: string;
  description: string; comments: number; lastComment?: { author: string; created: string; text: string } | null;
  labels?: string[]; workstream?: string | null; syncedAt?: Date;
}

export function mapIssue(raw: any): Issue {
  const f = raw.fields ?? {};
  const cs = f.comment?.comments ?? [];
  const last = cs[cs.length - 1];
  return {
    key: raw.key,
    summary: f.summary ?? '',
    status: f.status?.name ?? '?',
    statusCategory: f.status?.statusCategory?.key,
    type: f.issuetype?.name ?? '',
    assignee: f.assignee?.displayName ?? null,
    assigneeId: f.assignee?.accountId ?? null,
    parent: f.parent?.key ?? null,
    parentSummary: f.parent?.fields?.summary ?? null,
    duedate: f.duedate ?? null,
    priority: f.priority?.name ?? null,
    updated: f.updated ?? '',
    created: f.created,
    description: adfText(f.description),
    comments: f.comment?.total ?? cs.length,
    lastComment: last ? { author: last.author?.displayName ?? '?', created: last.created, text: adfText(last.body, 400) } : null,
    labels: f.labels ?? [],
  };
}

/** Workstream je Ticket: Workstream selbst, Parent, oder Parent des Parents (Sub-task). */
export function assignWorkstreams(issues: Issue[]): Issue[] {
  const by = new Map(issues.map((i) => [i.key, i]));
  for (const i of issues) {
    if (i.type === 'Workstream') { i.workstream = i.key; continue; }
    let p = i.parent ? by.get(i.parent) : undefined;
    let hops = 0;
    while (p && p.type !== 'Workstream' && p.parent && hops++ < 3) p = by.get(p.parent);
    i.workstream = p?.type === 'Workstream' ? p.key : (i.parent && !by.has(i.parent) ? i.parent : null);
  }
  return issues;
}

// ---------- Synchronisation ----------

export async function fetchAll(creds: JiraCreds, jql = `project = ${cfg.jiraProject} ORDER BY updated DESC`, max = 2000): Promise<any[]> {
  const out: any[] = [];
  let token = '';
  while (out.length < max) {
    const body: any = { jql, fields: FIELDS, maxResults: 100 };
    if (token) body.nextPageToken = token;
    const r = await jiraFetch(creds, 'POST', '/search/jql', body);
    out.push(...(r.issues ?? []));
    token = r.nextPageToken ?? '';
    if (!token || !(r.issues ?? []).length) break;
  }
  return out;
}

let syncing: Promise<any> | null = null;

export async function syncMirror(creds: JiraCreds, by: string): Promise<{ count: number; removed: number; at: Date }> {
  if (syncing) return syncing;
  syncing = (async () => {
    const started = new Date();
    const raw = await fetchAll(creds);
    const issues = assignWorkstreams(raw.map(mapIssue));
    const col = wb().collection('jira_issues');
    if (issues.length) {
      await col.bulkWrite(issues.map((i) => ({ replaceOne: { filter: { key: i.key }, replacement: { ...i, syncedAt: started }, upsert: true } })));
    }
    // Vollständiger Lauf: was nicht mehr kommt (gelöscht/verschoben), fällt aus der Kopie.
    const removed = (await col.deleteMany({ syncedAt: { $lt: started } })).deletedCount ?? 0;
    const at = new Date();
    await wb().collection('meta').updateOne({ _id: 'jira_sync' as any }, { $set: { at, by, source: creds.source, count: issues.length, error: null } }, { upsert: true });
    jiraChanged([], 'sync', true);
    return { count: issues.length, removed, at };
  })();
  try { return await syncing; } catch (e: any) {
    await wb().collection('meta').updateOne({ _id: 'jira_sync' as any }, { $set: { errorAt: new Date(), error: String(e.message).slice(0, 300) } }, { upsert: true });
    throw e;
  } finally { syncing = null; }
}

/** Einzelnes Ticket nach einer Änderung neu in die Kopie holen. */
export async function refreshIssue(creds: JiraCreds, key: string): Promise<Issue> {
  const raw = await jiraFetch(creds, 'GET', `/issue/${encodeURIComponent(key)}?fields=${FIELDS.join(',')}`);
  const i = mapIssue(raw);
  const col = wb().collection('jira_issues');
  if (i.parent) {
    const p: any = await col.findOne({ key: i.parent });
    i.workstream = p?.type === 'Workstream' ? p.key : p?.workstream ?? i.parent;
  } else i.workstream = i.type === 'Workstream' ? i.key : null;
  await col.replaceOne({ key }, { ...i, syncedAt: new Date() }, { upsert: true });
  jiraChanged([key, ...(i.parent ? [i.parent] : [])], 'refresh');
  return i;
}

// ---------- Board ----------

export function isOverdue(i: Pick<Issue, 'duedate' | 'statusCategory' | 'status'>, today = new Date().toISOString().slice(0, 10)) {
  return !!i.duedate && i.duedate < today && i.statusCategory !== 'done' && i.status !== 'Done';
}

export function boardModel(issues: (Issue & { hygiene?: string[] })[], opts: { owner?: string; filter?: string; q?: string; showDone?: boolean } = {}) {
  const ws = issues.filter((i) => i.type === 'Workstream');
  const names = new Map(ws.map((w) => [w.key, w.summary]));
  const today = new Date().toISOString().slice(0, 10);
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const isDoneI = (i: Issue) => i.status === 'Done' || i.statusCategory === 'done';
  const oldDone = (i: Issue) => isDoneI(i) && (i.updated ?? '') < new Date(Date.now() - 14 * 864e5).toISOString();
  const matches = (i: Issue & { hygiene?: string[] }) => {
    if (opts.owner && (i.assignee ?? '—') !== opts.owner) return false;
    if (opts.filter === 'overdue' && !isOverdue(i, today)) return false;
    if (opts.filter === 'undated' && (i.duedate || isDoneI(i))) return false;
    if (opts.filter === 'pflege' && !i.hygiene?.length) return false;
    if (opts.q) { const q = opts.q.toLowerCase(); if (!`${i.key} ${i.summary} ${i.assignee ?? ''}`.toLowerCase().includes(q)) return false; }
    return true;
  };
  // Sub-tasks mit Parent in der Kopie hängen unter ihrer Karte; ohne Parent sind sie „kaputt“ und eigene Karten.
  const nested = (i: Issue) => i.type === 'Sub-task' && !!i.parent && byKey.has(i.parent) && byKey.get(i.parent)!.type !== 'Workstream';
  const children = new Map<string, Issue[]>();
  for (const i of issues) if (nested(i)) children.set(i.parent!, [...(children.get(i.parent!) ?? []), i]);
  const cards = issues.filter((i) => i.type !== 'Workstream' && !nested(i)).flatMap((i) => {
    const subs = (children.get(i.key) ?? []).slice().sort((a, b) => a.key.localeCompare(b.key, 'de', { numeric: true }))
      .map((s) => ({ ...s, overdue: isOverdue(s, today), match: matches(s) }));
    const self = matches(i);
    const viaSub = subs.some((s) => s.match && !oldDone(s));
    if (!self && !viaSub) return [];
    if (!opts.showDone && oldDone(i) && !viaSub) return [];
    const broken = i.type === 'Sub-task' ? (i.parent ? (byKey.get(i.parent)?.type === 'Workstream' ? 'Sub-task direkt unter Workstream' : 'Parent nicht in der Kopie') : 'Sub-task ohne Parent') : null;
    return [{ ...i, subtasks: subs, subtaskDone: subs.filter(isDoneI).length, broken, onlyViaSubtask: !self }];
  });
  const statuses = [...STATUS_COLUMNS, ...[...new Set(cards.map((c) => c.status))].filter((s) => !STATUS_COLUMNS.includes(s)).sort()];
  const laneKeys = [...new Set(cards.map((c) => c.workstream ?? '—'))];
  const lanes = laneKeys.map((k) => ({
    key: k,
    name: k === '—' ? 'Ohne Workstream' : names.get(k) ?? k,
    workstream: ws.find((w) => w.key === k) ?? null,
    columns: Object.fromEntries(statuses.map((s) => [s, cards.filter((c) => (c.workstream ?? '—') === k && c.status === s)
      .sort((a, b) => (a.duedate ?? '9999').localeCompare(b.duedate ?? '9999'))])),
    count: cards.filter((c) => (c.workstream ?? '—') === k).length,
  })).sort((a, b) => (a.key === '—' ? 1 : b.key === '—' ? -1 : a.name.localeCompare(b.name, 'de')));
  const owners = [...new Set(issues.filter((i) => i.type !== 'Workstream').map((i) => i.assignee ?? '—'))].sort((a, b) => a.localeCompare(b, 'de'));
  return {
    statuses, lanes, owners,
    totals: {
      cards: cards.length,
      subtasks: cards.reduce((n, c) => n + c.subtasks.length, 0),
      broken: cards.filter((c) => c.broken).length,
      overdue: issues.filter((i) => i.type !== 'Workstream' && isOverdue(i, today)).length,
      undated: issues.filter((i) => i.type !== 'Workstream' && !i.duedate && !isDoneI(i)).length,
    },
  };
}

// ---------- Schreiben (nur nach Bestätigung, aufgerufen aus main.ts) ----------

export async function addComment(creds: JiraCreds, key: string, text: string) {
  return jiraFetch(creds, 'POST', `/issue/${encodeURIComponent(key)}/comment`, { body: adfDoc(text) });
}

export async function transitions(creds: JiraCreds, key: string): Promise<{ id: string; name: string; to: string }[]> {
  const r = await jiraFetch(creds, 'GET', `/issue/${encodeURIComponent(key)}/transitions`);
  return (r.transitions ?? []).map((t: any) => ({ id: String(t.id), name: t.name, to: t.to?.name ?? t.name }));
}

export async function transitionTo(creds: JiraCreds, key: string, target: string) {
  const ts = await transitions(creds, key);
  const t = ts.find((x) => x.to.toLowerCase() === target.toLowerCase()) ?? ts.find((x) => x.name.toLowerCase() === target.toLowerCase());
  if (!t) throw new JiraError(400, `Von hier aus gibt es keinen Übergang nach „${target}“ (möglich: ${ts.map((x) => x.to).join(', ') || '—'}).`);
  await jiraFetch(creds, 'POST', `/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: t.id } });
  return t;
}

export async function setDueDate(creds: JiraCreds, key: string, date: string | null) {
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new JiraError(400, 'Datum im Format JJJJ-MM-TT.');
  await jiraFetch(creds, 'PUT', `/issue/${encodeURIComponent(key)}`, { fields: { duedate: date } });
}
