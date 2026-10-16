// Jira-Kopie des Projekts PM (Projektname "OLAF" — nicht das Projekt mit dem Schlüssel OLAF).
// Lesen: REST über das api.atlassian.com-Gateway (scoped Tokens gehen nur dort), wie jira-read.sh.
// Schreiben (Kommentar, Status, Fälligkeit): nur nach Bestätigung in der Oberfläche und nur mit
// dem Token der Person, die klickt. Neue Tickets legt die Werkbank nicht an (olaf-jira-Regel).

import { jiraChanged } from './events.ts';
import { cfg, jiraBase, jiraSites, siteFor, siteBase, type JiraSite } from './config.ts';
import { wb } from './db.ts';
import type { JiraCreds } from './creds.ts';
import { needsGoal } from './goals.ts';

export const STATUS_COLUMNS = ['Backlog', 'To Do', 'In Progress', 'Ongoing', 'Done'];
const FIELDS = ['summary', 'status', 'assignee', 'parent', 'duedate', 'priority', 'updated', 'created', 'description', 'comment', 'issuetype', 'labels', 'issuelinks', 'statuscategorychangedate'];

export class JiraError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** REST-Aufruf; ohne `site` an die Hauptseite (Kopie, Board, Schreiben), sonst an die Gateway-Adresse dieser Seite. */
export async function jiraFetch(creds: JiraCreds, method: string, path: string, body?: unknown, site?: JiraSite): Promise<any> {
  const auth = Buffer.from(`${creds.email}:${creds.token}`).toString('base64');
  const r = await fetch((site && !site.main ? siteBase(site) : jiraBase()) + path, {
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

// ---------- Weitere Seiten: nur lesen, live nach Präfix (Release 17b) ----------
// Tickets anderer Seiten (OLAF-123 auf max-energy) stehen nicht in der Kopie. Gelesen wird je Schlüssel über die cloudId der
// Seite, 10 Minuten im Speicher. Im Demo-/Testbetrieb nur, wenn die Seite eine eigene Test-Basis hat (nie ins Netz).

const FREMD_MS = 10 * 60_000;
const fremdCache = new Map<string, { at: number; issue: Issue | null }>();
export const fremdLesbar = (s: JiraSite) => !s.main && (!!s.base || (!cfg.demo && !cfg.jiraBase));

/** Ticket einer anderen Seite lesen; null = gibt es nicht / nicht lesbar. Hauptseiten-Schlüssel: null (die stehen in der Kopie). */
export async function fremdesTicket(creds: JiraCreds | null, key: string, now = Date.now()): Promise<(Issue & { site: string }) | null> {
  const s = siteFor(key);
  if (!creds || !fremdLesbar(s)) return null;
  // Je Person (Gegenprüfung Pass C): ein Ticket, das A lesen darf, sieht B nur mit eigenem Zugang.
  const ck = `${creds.email}|${key}`;
  const c = fremdCache.get(ck);
  if (c && now - c.at < FREMD_MS) return c.issue ? { ...c.issue, site: s.site } : null;
  let issue: Issue | null = null;
  try { issue = mapIssue(await jiraFetch(creds, 'GET', `/issue/${encodeURIComponent(key)}?fields=${FIELDS.join(',')}`, undefined, s)); }
  catch (e: any) { if (e?.status !== 404) throw e; }
  if (fremdCache.size > 2000) fremdCache.clear();
  fremdCache.set(ck, { at: now, issue });
  return issue ? { ...issue, site: s.site } : null;
}

/** Mehrere Schlüssel: nur die der anderen Seiten, parallel; Fehler je Schlüssel werden zu „nicht lesbar“. */
export async function fremdeTickets(creds: JiraCreds | null, keys: string[]): Promise<Map<string, Issue & { site: string }>> {
  const want = [...new Set(keys)].filter((k) => !siteFor(k).main).slice(0, 30);
  const out = new Map<string, Issue & { site: string }>();
  await Promise.all(want.map(async (k) => { try { const i = await fremdesTicket(creds, k); if (i) out.set(k, i); } catch { /* nicht lesbar */ } }));
  return out;
}

/** Lesezugang je Seite (GET /myself), 10 Minuten im Speicher — für „Jira verbinden“ in der Einrichtung. */
const leseCache = new Map<string, { at: number; ok: boolean; why?: string }>();
export async function siteLesen(creds: JiraCreds | null, s: JiraSite, now = Date.now()): Promise<{ ok: boolean | null; why?: string }> {
  if (!creds) return { ok: null, why: 'nicht verbunden' };
  // Demo-/Testbetrieb: nur Seiten mit eigener Test-Basis (Hauptseite: WERKBANK_JIRA_BASE) — nie ins Netz.
  const testBasis = s.main ? !!(cfg.jiraBase || s.base) : !!s.base;
  if ((cfg.demo || cfg.jiraBase) && !testBasis) return { ok: null, why: 'im Test-/Demobetrieb nicht geprüft' };
  const k = `${creds.email}|${s.prefix}`;
  const c = leseCache.get(k);
  if (c && now - c.at < FREMD_MS) return { ok: c.ok, ...(c.why ? { why: c.why } : {}) };
  let r: { ok: boolean; why?: string };
  try { await jiraFetch(creds, 'GET', '/myself', undefined, s); r = { ok: true }; }
  catch (e: any) { r = { ok: false, why: String(e?.message ?? e).slice(0, 160) }; }
  leseCache.set(k, { at: now, ...r });
  return r;
}
// mirror (17c): Seite hat eine eigene Kopie mit Board und Sprint-Übersicht (Hauptseite immer, weitere wie beim Lesen).
export const jiraSitesPublic = () => jiraSites().map((s) => ({ prefix: s.prefix, site: s.site, main: s.main, mirror: s.main || fremdLesbar(s) }));

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
  /** Werkbank-Zuordnung (nicht Jira): undefined = keine lokale, null = lokal entfernt, 'KEINS' = bewusst ohne. */
  localGoal?: string | null;
  /** Werkbank-Sprint-Mitgliedschaft je Sprintdatum (true drin, false rausgenommen). */
  localSprints?: Record<string, boolean>;
  /** Seit wann in der aktuellen Statuskategorie (Jira: statuscategorychangedate). */
  statusSince?: string | null;
  links?: IssueLink[];
  /** Offene Tickets, die dieses blockieren („is blocked by“, Blocker nicht erledigt). */
  blockedBy?: string[];
  /** Nur Kopien weiterer Seiten (17c): im laufenden Jira-Sprint. */
  openSprint?: boolean;
}

export interface IssueLink { type: string; label: string; key: string; summary?: string; status?: string; done?: boolean; blocks?: 'blocks' | 'blocked-by' }

/** issuelinks → kurze Liste; „Blocks“-Links bekommen eine Richtung (dieses Ticket blockiert / wird blockiert). */
export function mapLinks(raw: any[]): IssueLink[] {
  return (raw ?? []).map((l: any) => {
    const other = l.inwardIssue ?? l.outwardIssue;
    if (!other?.key) return null;
    const inward = !!l.inwardIssue;
    const type = l.type?.name ?? '';
    const isBlock = /^block/i.test(type) || /block/i.test(l.type?.inward ?? '');
    return {
      type, key: other.key, label: (inward ? l.type?.inward : l.type?.outward) ?? type,
      summary: other.fields?.summary, status: other.fields?.status?.name,
      done: other.fields?.status?.statusCategory?.key === 'done' || other.fields?.status?.name === 'Done',
      ...(isBlock ? { blocks: inward ? 'blocked-by' as const : 'blocks' as const } : {}),
    };
  }).filter(Boolean) as IssueLink[];
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
    statusSince: f.statuscategorychangedate ?? null,
    ...(() => { const links = mapLinks(f.issuelinks); return { links, blockedBy: links.filter((l) => l.blocks === 'blocked-by' && !l.done).map((l) => l.key) }; })(),
  };
}

/** Workstream je Ticket: Workstream selbst, Parent, oder Parent des Parents (Sub-task). `laneType`: Bahnen-Typ der Seite
 *  (PM: Workstream, weitere Seiten: Epic). */
export function assignWorkstreams(issues: Issue[], laneType = 'Workstream'): Issue[] {
  const by = new Map(issues.map((i) => [i.key, i]));
  for (const i of issues) {
    if (i.type === laneType) { i.workstream = i.key; continue; }
    let p = i.parent ? by.get(i.parent) : undefined;
    let hops = 0;
    while (p && p.type !== laneType && p.parent && hops++ < 3) p = by.get(p.parent);
    i.workstream = p?.type === laneType ? p.key : (i.parent && !by.has(i.parent) ? i.parent : null);
  }
  return issues;
}

// ---------- Synchronisation ----------
// Vollabgleich (alle 15 min, Knopf) holt das ganze Projekt und löscht, was nicht mehr kommt — aber nur mit
// Löschschutz. Der inkrementelle Abgleich (jede Minute) holt nur kürzlich Geändertes und löscht nie.

export async function fetchPages(creds: JiraCreds, jql = `project = ${cfg.jiraProject} ORDER BY updated DESC`, max = 2000, site?: JiraSite, fields = FIELDS): Promise<{ issues: any[]; complete: boolean }> {
  const out: any[] = [];
  let token = '';
  while (out.length < max) {
    const body: any = { jql, fields, maxResults: 100 };
    if (token) body.nextPageToken = token;
    const r = await jiraFetch(creds, 'POST', '/search/jql', body, site);
    const page = r.issues ?? [];
    out.push(...page);
    token = r.nextPageToken ?? '';
    if (!token) return { issues: out, complete: true };
    if (!page.length) return { issues: out, complete: false };   // Seite leer, aber „es gibt mehr“: nicht vollständig
  }
  return { issues: out, complete: false };   // Obergrenze erreicht
}

export async function fetchAll(creds: JiraCreds, jql?: string, max?: number): Promise<any[]> {
  return (await fetchPages(creds, jql, max)).issues;
}

export const DELETE_MIN_SHARE = 0.8;

/** Löschschutz: nur löschen, wenn vollständig geblättert und nicht drastisch weniger als beim letzten Lauf. */
export function deletionAllowed(complete: boolean, count: number, lastCount: number | null | undefined): { ok: true } | { ok: false; reason: string } {
  if (!complete) return { ok: false, reason: 'Jira hat nicht alle Seiten geliefert — nichts gelöscht.' };
  if (count === 0 && (lastCount ?? 0) > 0) return { ok: false, reason: `Jira liefert 0 Tickets (letzter Lauf: ${lastCount}) — nichts gelöscht.` };
  if (lastCount && count < lastCount * DELETE_MIN_SHARE) return { ok: false, reason: `Jira liefert nur ${count} Tickets (letzter Lauf: ${lastCount}, Schwelle ${Math.round(DELETE_MIN_SHARE * 100)} %) — nichts gelöscht.` };
  return { ok: true };
}

type SyncErrorKind = 'zugang' | 'voll' | 'inkrementell' | 'löschschutz';

// ---------- Kopie je Seite (Release 17c) ----------
// Hauptseite (PM): Collection `jira_issues`, Stand `meta.jira_sync` — unverändert, alles PM-Spezifische (Pflege, Ziele,
// Sprint-Zyklus, Mein Tag) liest nur sie. Weitere Seiten (OLAF): eigene Collection `jira_issues_<präfix>`, eigener Stand,
// Bahnen nach Epic (dort gibt es keine Workstreams), nur lesen.
export interface Mirror { site: JiraSite; col: string; meta: string; project: string; laneType: string }
export function mirrorOf(site: JiraSite = jiraSites()[0]): Mirror {
  if (site.main) return { site, col: 'jira_issues', meta: 'jira_sync', project: cfg.jiraProject, laneType: 'Workstream' };
  const p = site.prefix.toLowerCase();
  return { site, col: `jira_issues_${p}`, meta: `jira_sync_${p}`, project: site.prefix, laneType: 'Epic' };
}
/** Weitere Seiten mit eigener Kopie (gleiche Regel wie das Lesen je Schlüssel: im Test-/Demobetrieb nur mit Test-Basis). */
export const mirrorSites = () => jiraSites().filter(fremdLesbar);
/** Seite zu einem Präfix aus der Anfrage (`?site=OLAF`); leer/unbekannt → Hauptseite. */
export const siteByPrefix = (prefix?: string | null) => jiraSites().find((s) => s.prefix === String(prefix ?? '').toUpperCase()) ?? jiraSites()[0];

export async function recordSyncError(kind: SyncErrorKind, message: string, site?: JiraSite) {
  await wb().collection('meta').updateOne({ _id: mirrorOf(site).meta as any }, { $set: { errorAt: new Date(), error: message.slice(0, 300), errorKind: kind } }, { upsert: true });
}

/** Workstream (bzw. Epic) aller Tickets neu rechnen und geänderte zurückschreiben; gibt die geänderten Schlüssel zurück. */
export async function recomputeWorkstreams(site?: JiraSite): Promise<string[]> {
  const mi = mirrorOf(site);
  const col = wb().collection(mi.col);
  const all = (await col.find({}, { projection: { _id: 0, key: 1, type: 1, parent: 1, workstream: 1 } }).toArray()) as any[];
  const before = new Map(all.map((i) => [i.key, i.workstream ?? null]));
  assignWorkstreams(all as Issue[], mi.laneType);
  const changed = all.filter((i) => (i.workstream ?? null) !== before.get(i.key));
  if (changed.length) await col.bulkWrite(changed.map((i) => ({ updateOne: { filter: { key: i.key }, update: { $set: { workstream: i.workstream ?? null } } } })));
  return changed.map((i) => i.key);
}

// Eine Sperre je Seite: ein Vollabgleich der einen Seite hält die andere nicht auf.
const locks = new Map<string, { p: Promise<any>; kind: 'voll' | 'inkrementell' }>();

export async function syncMirror(creds: JiraCreds, by: string, opts: { force?: boolean } = {}, site?: JiraSite): Promise<{ count: number; removed: number; at: Date; complete: boolean }> {
  const mi = mirrorOf(site);
  const lk = mi.col;
  if (locks.get(lk)?.kind === 'voll') return locks.get(lk)!.p;
  while (locks.has(lk)) { try { await locks.get(lk)!.p; } catch { /* egal */ } if (locks.get(lk)?.kind === 'voll') return locks.get(lk)!.p; }
  const run = (async () => {
    const started = new Date();
    // Nach Schlüssel blättern (nicht nach „updated“): ein während des Laufs geändertes Ticket springt sonst von hinten
    // nach vorn, fehlt in der Liste und würde gelöscht.
    const { issues: raw, complete } = await fetchPages(creds, `project = ${mi.project} ORDER BY key ASC`, 20_000, mi.site);
    const issues = assignWorkstreams(raw.map(mapIssue), mi.laneType);
    // Weitere Seiten: Mitgliedschaft im laufenden Jira-Sprint (Sprint-Übersicht OLAF). Ein Projekt ohne Sprints (Jira: 400)
    // heißt „kein Sprint“, kein Abbruch. ponytail: nur im Vollabgleich (15 min) — ein frisch in den Sprint gezogenes Ticket
    // erscheint dort spätestens mit dem nächsten Vollabgleich.
    let sprintKeys: Set<string> | null = null;
    if (!mi.site.main) {
      try { sprintKeys = new Set((await fetchPages(creds, `project = ${mi.project} AND sprint in openSprints() ORDER BY key ASC`, 2000, mi.site, ['summary'])).issues.map((r: any) => r.key)); }
      catch (e: any) { if (!(e instanceof JiraError) || e.status !== 400) throw e; sprintKeys = new Set(); }
    }
    const col = wb().collection(mi.col);
    const meta: any = await wb().collection('meta').findOne({ _id: mi.meta as any });
    if (issues.length) {
      await col.bulkWrite(issues.map((i) => ({ replaceOne: { filter: { key: i.key }, replacement: { ...i, ...(sprintKeys ? { openSprint: sprintKeys.has(i.key) } : {}), syncedAt: started }, upsert: true } })));
    }
    // force (bestätigt in der Oberfläche): Schwelle ignorieren — z. B. nach echtem Schrumpfen; Vollständigkeit bleibt Pflicht.
    const guard = deletionAllowed(complete, issues.length, opts.force ? null : meta?.count);
    if (!guard.ok) {
      await recordSyncError('löschschutz', guard.reason, mi.site);
      jiraChanged(issues.map((i) => i.key), 'sync', true);
      throw Object.assign(new JiraError(502, guard.reason), { guard: true });
    }
    // Vollständiger Lauf: was nicht mehr kommt (gelöscht/verschoben), fällt aus der Kopie.
    const removed = (await col.deleteMany({ syncedAt: { $lt: started } })).deletedCount ?? 0;
    const at = new Date();
    await wb().collection('meta').updateOne({ _id: mi.meta as any }, { $set: { at, by, source: creds.source, count: issues.length, complete, error: null, errorKind: null, ...(sprintKeys ? { sprintCount: sprintKeys.size } : {}) } }, { upsert: true });
    jiraChanged([], 'sync', true);
    return { count: issues.length, removed, at, complete };
  })();
  locks.set(lk, { p: run, kind: 'voll' });
  try { return await run; } catch (e: any) {
    if (!e?.guard) await recordSyncError('voll', String(e.message), mi.site);
    throw e;
  } finally { if (locks.get(lk)?.p === run) locks.delete(lk); }
}

/** Inkrementell: nur in den letzten `minutes` Minuten Geändertes holen, einspielen, Workstreams nachrechnen. Löscht nie. */
export async function syncIncremental(creds: JiraCreds, minutes = 2, site?: JiraSite): Promise<{ keys: string[]; at: Date } | null> {
  const mi = mirrorOf(site);
  const lk = mi.col;
  if (locks.has(lk)) return null;   // ein Abgleich dieser Seite läuft gerade
  const run = (async () => {
    const jql = `project = ${mi.project} AND updated >= -${Math.max(1, Math.round(minutes))}m ORDER BY updated DESC`;
    const { issues: raw } = await fetchPages(creds, jql, 500, mi.site);
    const issues = raw.map(mapIssue);
    const col = wb().collection(mi.col);
    const now = new Date();
    if (issues.length) {
      // Workstream (und offener Sprint) vorerst behalten, gleich darauf aus der ganzen Kopie neu gerechnet.
      await col.bulkWrite(issues.map((i) => ({ updateOne: { filter: { key: i.key }, update: { $set: { ...i, syncedAt: now } }, upsert: true } })));
    }
    const ws = issues.length ? await recomputeWorkstreams(mi.site) : [];
    const at = new Date();
    const meta: any = await wb().collection('meta').findOne({ _id: mi.meta as any });
    const clear = meta?.errorKind === 'zugang' || meta?.errorKind === 'inkrementell' ? { error: null, errorKind: null } : {};
    await wb().collection('meta').updateOne({ _id: mi.meta as any }, { $set: { incAt: at, incCount: issues.length, ...clear } }, { upsert: true });
    const keys = [...new Set([...issues.map((i) => i.key), ...ws])];
    if (keys.length) jiraChanged(keys, 'inkrementell');
    return { keys, at };
  })();
  locks.set(lk, { p: run, kind: 'inkrementell' });
  try { return await run; } catch (e: any) {
    await recordSyncError('inkrementell', String(e.message), mi.site);
    throw e;
  } finally { if (locks.get(lk)?.p === run) locks.delete(lk); }
}

/** Einzelnes Ticket nach einer Änderung neu in die Kopie holen (Workstreams der Kinder werden mitgerechnet). */
export async function refreshIssue(creds: JiraCreds, key: string): Promise<Issue> {
  const raw = await jiraFetch(creds, 'GET', `/issue/${encodeURIComponent(key)}?fields=${FIELDS.join(',')}`);
  const i = mapIssue(raw);
  const col = wb().collection('jira_issues');
  await col.updateOne({ key }, { $set: { ...i, syncedAt: new Date() } }, { upsert: true });
  const changed = await recomputeWorkstreams();
  const fresh = ((await col.findOne({ key }, { projection: { _id: 0 } })) ?? i) as unknown as Issue;
  jiraChanged([key, ...(i.parent ? [i.parent] : []), ...changed], 'refresh');
  return fresh;
}

// ---------- Board ----------

/** Ongoing = wiederkehrend (kein Enddatum): nie überfällig, braucht kein Datum. */
export const isRecurring = (i: Pick<Issue, 'status'>) => i.status === 'Ongoing';

export function isOverdue(i: Pick<Issue, 'duedate' | 'statusCategory' | 'status'>, today = new Date().toISOString().slice(0, 10)) {
  return !!i.duedate && i.duedate < today && i.statusCategory !== 'done' && i.status !== 'Done' && !isRecurring(i);
}

/** Spalten einer weiteren Seite: die vorkommenden Status nach Jira-Kategorie (neu → in Arbeit → fertig), dann nach Name. */
export function siteColumns(issues: Pick<Issue, 'status' | 'statusCategory'>[]): string[] {
  const rank = (c?: string) => (c === 'new' ? 0 : c === 'done' ? 2 : 1);
  const cat = new Map<string, number>();
  for (const i of issues) if (!cat.has(i.status)) cat.set(i.status, rank(i.statusCategory));
  return [...cat.keys()].sort((a, b) => cat.get(a)! - cat.get(b)! || a.localeCompare(b, 'de'));
}

export function boardModel(issues: (Issue & { hygiene?: unknown[] })[], opts: { owner?: string; filter?: string; q?: string; showDone?: boolean; label?: string; keys?: Set<string>; knownGoals?: Set<string>; laneType?: string; columns?: string[]; pmRules?: boolean } = {}) {
  // Bahnen-Typ und Spalten je Seite (17c): PM = Workstreams und die festen Spalten; weitere Seiten = Epics und ihre Status.
  const LT = opts.laneType ?? 'Workstream';
  const COLS = opts.columns ?? STATUS_COLUMNS;
  // PM-Regeln (Ziel nötig, Datum nötig) nur auf der Hauptseite; weitere Seiten: `fremd` (keine Ziel-/Datums-Mahnung).
  const pm = opts.pmRules ?? true;
  const noGoalOf = (x: Issue) => (pm ? needsGoal(x, byKey, opts.knownGoals) : false);
  const extra = pm ? {} : { fremd: true };
  const ws = issues.filter((i) => i.type === LT);
  const isSub = (i: Pick<Issue, 'type'>) => /^sub-?task$/i.test(i.type);   // Jira: „Sub-task“, team-verwaltet „Subtask“
  const names = new Map(ws.map((w) => [w.key, w.summary]));
  const today = new Date().toISOString().slice(0, 10);
  const byKey = new Map(issues.map((i) => [i.key, i]));
  const isDoneI = (i: Issue) => i.status === 'Done' || i.statusCategory === 'done';
  const oldDone = (i: Issue) => isDoneI(i) && (i.updated ?? '') < new Date(Date.now() - 14 * 864e5).toISOString();
  const matches = (i: Issue & { hygiene?: unknown[] }) => {
    if (opts.owner && (i.assignee ?? '—') !== opts.owner) return false;
    if (opts.filter === 'overdue' && !isOverdue(i, today)) return false;
    if (opts.filter === 'undated' && (i.duedate || isDoneI(i) || isRecurring(i))) return false;
    if (opts.filter === 'pflege' && !i.hygiene?.length) return false;
    if (opts.label && !(i.labels ?? []).includes(opts.label)) return false;
    if (opts.keys && !opts.keys.has(i.key)) return false;
    if (opts.filter === 'ohneziel' && !needsGoal(i, byKey, opts.knownGoals)) return false;
    if (opts.q) { const q = opts.q.toLowerCase(); if (!`${i.key} ${i.summary} ${i.assignee ?? ''}`.toLowerCase().includes(q)) return false; }
    return true;
  };
  // Sub-tasks mit Parent in der Kopie hängen unter ihrer Karte; ohne Parent sind sie „kaputt“ und eigene Karten.
  const nested = (i: Issue) => isSub(i) && !!i.parent && byKey.has(i.parent) && byKey.get(i.parent)!.type !== LT;
  const children = new Map<string, Issue[]>();
  for (const i of issues) if (nested(i)) children.set(i.parent!, [...(children.get(i.parent!) ?? []), i]);
  const cards = issues.filter((i) => i.type !== LT && !nested(i)).flatMap((i) => {
    const subs = (children.get(i.key) ?? []).slice().sort((a, b) => a.key.localeCompare(b.key, 'de', { numeric: true }))
      .map((s) => ({ ...s, overdue: isOverdue(s, today), match: matches(s), noGoal: noGoalOf(s), ...extra }));
    const self = matches(i);
    const viaSub = subs.some((s) => s.match && !oldDone(s));
    if (!self && !viaSub) return [];
    if (!opts.showDone && oldDone(i) && !viaSub) return [];
    const broken = isSub(i) ? (i.parent ? (byKey.get(i.parent)?.type === LT ? `Sub-task direkt unter ${LT}` : 'Parent nicht in der Kopie') : 'Sub-task ohne Parent')
      : !i.parent ? (LT === 'Workstream' ? 'ohne Parent — keinem Workstream zugeordnet' : null) : null;
    return [{ ...i, subtasks: subs, subtaskDone: subs.filter(isDoneI).length, broken, onlyViaSubtask: !self, noGoal: noGoalOf(i), ...extra }];
  });
  const statuses = [...COLS, ...[...new Set(cards.map((c) => c.status))].filter((s) => !COLS.includes(s)).sort()];
  // Ohne Filter: Bahnen für alle Workstreams, auch ohne sichtbare Kinder (PM-223); alte erledigte nur mit showDone.
  const filtered = !!(opts.owner || opts.filter || opts.q || opts.label || opts.keys);
  const wsLanes = filtered ? [] : ws.filter((w) => opts.showDone || !oldDone(w)).map((w) => w.key);
  const laneKeys = [...new Set([...wsLanes, ...cards.map((c) => c.workstream ?? '—')])];
  const lanes = laneKeys.map((k) => ({
    key: k,
    name: k === '—' ? (LT === 'Workstream' ? 'Ohne Workstream' : `Ohne ${LT}`) : names.get(k) ?? k,
    workstream: ws.find((w) => w.key === k) ?? null,
    head: (() => { const w = byKey.get(k); return w && w.type === LT ? { status: w.status, owner: w.assignee ?? null, duedate: w.duedate ?? null, overdue: isOverdue(w, today), done: isDoneI(w) } : null; })(),
    columns: Object.fromEntries(statuses.map((s) => [s, cards.filter((c) => (c.workstream ?? '—') === k && c.status === s)
      .sort((a, b) => (a.duedate ?? '9999').localeCompare(b.duedate ?? '9999'))])),
    count: cards.filter((c) => (c.workstream ?? '—') === k).length,
  })).sort((a, b) => (a.key === '—' ? 1 : b.key === '—' ? -1 : a.name.localeCompare(b.name, 'de')));
  const owners = [...new Set(issues.filter((i) => i.type !== LT).map((i) => i.assignee ?? '—'))].sort((a, b) => a.localeCompare(b, 'de'));
  return {
    statuses, lanes, owners,
    totals: {
      cards: cards.length,
      subtasks: cards.reduce((n, c) => n + c.subtasks.length, 0),
      broken: cards.filter((c) => c.broken && isSub(c)).length,
      orphans: cards.filter((c) => c.broken && !isSub(c)).length,
      overdue: issues.filter((i) => i.type !== LT && isOverdue(i, today)).length,
      undated: issues.filter((i) => i.type !== LT && !i.duedate && !isDoneI(i) && !isRecurring(i)).length,
      noGoal: pm ? issues.filter((i) => needsGoal(i, byKey, opts.knownGoals)).length : 0,
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
