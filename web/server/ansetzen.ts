// „Agent ansetzen“ an einer Spec (docs/plan-agent-ansetzen.md, Schnitt 2 von docs/plan-roadmap-zu-agent.md):
// Spec in 3-Plan → Vorschau → ein Klick → genau ein PM-Ticket anlegen, zurücklesen, `jira:` in die Spec, Agent starten.
//
// Schalter WERKBANK_ANSETZEN (Wochenend-Regel 10./11.10.2026: kein echtes Jira):
//   leer/aus  Knopf ausgeschaltet, Route 403 (Vorgabe — die Live-Werkbank ändert sich erst, wenn Knut `live` setzt)
//   sim       simuliertes Jira (Tickets SIM-n in werkbank.jira_sim, nie in der Jira-Kopie); nur mit
//             WERKBANK_VAULT_IS_COPY=1, und in die Spec kommt `sim-jira:` statt `jira:` (wird nie als Verknüpfung gelesen)
//   live      echtes Anlegen über den konfigurierten Schreibweg (MCP createJiraIssue oder REST POST /issue)
// Alles andere gilt als „aus“ (mit Hinweis).

import { createHash, randomUUID } from 'node:crypto';
import { cfg, browseUrl } from './config.ts';
import { wb } from './db.ts';
import { jiraCreds } from './creds.ts';
import { jiraFetch, refreshIssue, JiraError, type Issue } from './jira.ts';
import { writeMode, mcpWrite, writeJira, JiraWriteError, type JiraAction } from './jirawrite.ts';
import { parseDecisions, type Decision } from './roadmap.ts';
import { tokens } from './links.ts';
import type { User } from './auth.ts';

export type AnsetzenMode = 'aus' | 'sim' | 'live';

export function ansetzenMode(env: Record<string, string | undefined> = process.env): { mode: AnsetzenMode; problem: string | null } {
  const v = (env.WERKBANK_ANSETZEN ?? '').trim();
  if (v === 'live') return { mode: 'live', problem: null };
  if (v === 'sim') return env.WERKBANK_VAULT_IS_COPY === '1'
    ? { mode: 'sim', problem: null }
    : { mode: 'aus', problem: 'WERKBANK_ANSETZEN=sim nur mit einer Vault-Kopie (WERKBANK_VAULT_IS_COPY=1) — sonst landeten simulierte Tickets im echten Vault.' };
  if (v && v !== 'aus') return { mode: 'aus', problem: `Unbekannter Wert WERKBANK_ANSETZEN=„${v.slice(0, 20)}“ — gilt als aus (erlaubt: aus, sim, live).` };
  return { mode: 'aus', problem: null };
}

export const PLAN_STATE = '3-Plan';
export const DEFAULT_WORKSTREAM = 'PM-70';   // E4 (Knut, 09.10.2026)
export const LEASE_MS = 4 * 60_000;          // länger als der langsamste Anlege-Weg (Brücke 150 s)

const PROJECT = () => cfg.jiraProject;
export const specSlug = (path: string) => path.split('/').pop()!.replace(/\.md$/, '');
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

// ---------- reine Funktionen ----------

export interface SpecLike { path: string; name: string; title: string; topic: string; state: string; text: string; fm: Record<string, unknown> }

/** Bedingung 4: nur Specs in 3-Plan ohne offene „- Knut:“-Zeile. */
export function specGate(sp: Pick<SpecLike, 'state' | 'text'>): { ok: boolean; why: string | null; open: Decision[] } {
  const open = parseDecisions(sp.text).filter((d) => d.open);
  if (sp.state !== PLAN_STATE) return { ok: false, why: `Agent ansetzen nur für Specs in ${PLAN_STATE} (diese steht in ${sp.state}).`, open };
  if (open.length) return { ok: false, why: `${open.length} offene Entscheidung${open.length > 1 ? 'en' : ''} („- Knut:“) — erst entscheiden, dann ansetzen.`, open };
  return { ok: true, why: null, open };
}

/** Text eines Abschnitts (## Name) bis zur nächsten Überschrift gleicher oder höherer Ebene. */
export function section(text: string, name: RegExp): string {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => /^#{2,3}\s/.test(l) && name.test(l.replace(/^#+\s*/, '')));
  if (i < 0) return '';
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) { if (/^#{1,3}\s/.test(l)) break; out.push(l); }
  return out.join('\n').trim();
}

export function specGoal(text: string): string {
  const inline = text.match(/^\*\*Ziel:\*\*\s*(.+)$/m)?.[1]?.trim();
  if (inline && !/^‹/.test(inline)) return inline;
  const s = section(text, /^Ziel\b/i);
  return s.split(/\n\s*\n/)[0]?.replace(/\s+/g, ' ').trim() ?? '';
}

export function specDod(text: string): string[] {
  return section(text, /^Definition of Done/i).split('\n').map((l) => l.match(/^\s*(?:[-*]|\d+\.)\s+(.+)$/)?.[1]?.trim()).filter((x): x is string => !!x && !/^‹/.test(x)).slice(0, 20);
}

/** E3: Ende des laufenden Sprints. Sprintordner = Beginn (sprint-JJJJ-MM-TT). */
export function sprintEnd(starts: string[], today: string): { date: string; how: string } {
  const add = (d: string, n: number) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const sorted = [...new Set(starts)].sort();
  const cur = sorted.filter((d) => d <= today).at(-1);
  const next = sorted.find((d) => d > today);
  if (cur && next) return { date: add(next, -1), how: `Sprintende (Sprint ${cur})` };
  if (cur) return { date: add(cur, 13), how: `Sprintende (Sprint ${cur} + 13 Tage)` };
  return { date: add(today, 14), how: 'kein Sprintordner gefunden — heute + 14 Tage' };
}

export type AgentMode = 'review' | 'plan';
export interface TicketDraft { summary: string; description: string; parent: string; assigneeId: string; ownerName: string; priority: string; duedate: string; dueHow: string; slug: string; specPath: string; goal: string; dod: string[]; ergebnis: string }

export function ticketDraft(sp: SpecLike, o: { parent?: string; summary?: string; mode: AgentMode; accountId: string; ownerName: string; due: { date: string; how: string } }): TicketDraft {
  const slug = specSlug(sp.path);
  const goal = specGoal(sp.text);
  const dod = specDod(sp.text);
  const ergebnis = o.mode === 'plan' ? 'Plandatei (Vault, neben der Spec) mit Schnitten und Definition of Done — noch kein Code.' : 'Plandatei, Umsetzung auf einem lokalen Feature-Branch, Review-Paket; gepusht wird erst nach Freigabe.';
  const summary = (o.summary?.replace(/\s+/g, ' ').trim() || sp.title.replace(/^olaf — Spec:\s*/i, '')).slice(0, 200);
  const description = [
    `Ziel: ${goal || '(steht in der Spec)'}`,
    `Ergebnis: ${ergebnis}`,
    '',
    `Spec: ${sp.path}`,
    `spec: ${slug}`,
    '',
    'Definition of Done:',
    ...(dod.length ? dod.map((d) => `- ${d}`) : ['- siehe Spec']),
    '',
    'Angelegt über die Werkbank („Agent ansetzen“); ein Agent arbeitet bis zum Review-Stand.',
  ].join('\n');
  return { summary, description, parent: o.parent || DEFAULT_WORKSTREAM, assigneeId: o.accountId, ownerName: o.ownerName, priority: 'Medium', duedate: o.due.date, dueHow: o.due.how, slug, specPath: sp.path, goal, dod, ergebnis };
}

export interface Dup { key: string; summary: string; status: string; why: string }

/** Dubletten in der Jira-Kopie: `jira:` der Spec, Slug in der Beschreibung, ≥ 2 seltene gemeinsame Titel-Begriffe. */
export function localDuplicates(sp: Pick<SpecLike, 'path' | 'title' | 'fm'>, issues: Pick<Issue, 'key' | 'summary' | 'status' | 'description' | 'type'>[]): Dup[] {
  const slug = specSlug(sp.path);
  const linked = new Set(String([sp.fm.jira].flat().join(' ')).match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? []);
  const generic = new Set(['spec', 'olaf', 'service', 'view', 'admin', 'seite', 'neue', 'neuer']);
  const st = tokens(sp.title.replace(/^olaf — Spec:\s*/i, '')).filter((t) => !generic.has(t));
  const out: Dup[] = [];
  for (const i of issues) {
    if (i.type === 'Workstream') continue;
    const why = linked.has(i.key) ? '`jira:` der Spec'
      : (i.description ?? '').includes(`spec: ${slug}`) ? 'Spec-Kennung in der Beschreibung'
        : (() => { const c = st.filter((t) => tokens(i.summary).includes(t)); return c.length >= Math.min(2, st.length) && c.length ? `Titel: ${c.join(', ')}` : ''; })();
    if (why) out.push({ key: i.key, summary: i.summary, status: i.status, why });
  }
  return out.slice(0, 8);
}

/** Bedingung 3: Live-Suche — ganzer Titel, die zwei längsten Begriffe, Spec-Kennung in der Beschreibung. */
export function dupJql(sp: Pick<SpecLike, 'path' | 'title'>, project = PROJECT()): string {
  const q = (s: string) => s.replace(/["\\]/g, ' ').trim();
  const title = q(sp.title.replace(/^olaf — Spec:\s*/i, '')).slice(0, 80);
  const longest = tokens(title).sort((a, b) => b.length - a.length).slice(0, 2);
  const parts = [`summary ~ "${title}"`, ...(longest.length === 2 ? [`summary ~ "${longest.join(' ')}"`] : []), `text ~ "spec: ${q(specSlug(sp.path))}"`];
  return `project = ${project} AND (${parts.join(' OR ')}) ORDER BY created DESC`;
}

/**
 * Schlüssel aus der Antwort von createJiraIssue (MCP). Streng: JSON-Feld `key`, sonst `"key": "PM-n"`, sonst genau ein
 * PM-Schlüssel im Text, der nicht der Parent ist. Alles andere → null (= Ergebnis unklar, nicht raten).
 */
export function parseCreatedKey(text: string, parent: string, project = PROJECT()): string | null {
  const re = new RegExp(`^${project}-\\d+$`);
  try { const j = JSON.parse(text); const k = j?.key ?? j?.issue?.key; if (typeof k === 'string' && re.test(k) && k !== parent) return k; } catch { /* kein JSON */ }
  const f = text.match(new RegExp(`"key"\\s*:\\s*"(${project}-\\d+)"`));
  if (f && f[1] !== parent) return f[1];
  const all = [...new Set(text.match(new RegExp(`\\b${project}-\\d+\\b`, 'g')) ?? [])].filter((k) => k !== parent);
  return all.length === 1 ? all[0] : null;
}

/** Einfaches ADF aus Zeilen (REST-Weg). */
export function adf(text: string) {
  return { type: 'doc', version: 1, content: text.split('\n').filter((l) => l.trim()).map((l) => ({ type: 'paragraph', content: [{ type: 'text', text: l }] })) };
}

export interface ReadBack { key: string; summary: string; parent: string | null; assigneeId: string | null; priority: string | null; duedate: string | null; status: string; type: string }

/** Felder, die nach dem Anlegen nicht stimmen → Aktionen zum Nachziehen. */
export function deviations(d: Pick<TicketDraft, 'parent' | 'assigneeId' | 'priority' | 'duedate' | 'ownerName'>, r: ReadBack): { field: string; action: JiraAction }[] {
  const out: { field: string; action: JiraAction }[] = [];
  if (r.parent !== d.parent) out.push({ field: 'parent', action: { type: 'parent', key: d.parent } });
  if (r.assigneeId !== d.assigneeId) out.push({ field: 'assignee', action: { type: 'assignee', accountId: d.assigneeId, name: d.ownerName } });
  if ((r.priority ?? '').toLowerCase() !== d.priority.toLowerCase()) out.push({ field: 'priority', action: { type: 'priority', name: d.priority } });
  if (r.duedate !== d.duedate) out.push({ field: 'duedate', action: { type: 'due', date: d.duedate } });
  return out;
}

// ---------- Jira: simuliert oder echt ----------

/** Anlegen mit unklarem Ausgang (Zeitüberschreitung, 5xx, Schlüssel nicht lesbar): nie automatisch neu anlegen. */
export class UnclearCreate extends Error {}

export interface AnsetzenJira {
  kind: 'sim' | 'live';
  me(): Promise<{ accountId: string; displayName: string }>;
  search(jql: string, sp: Pick<SpecLike, 'path' | 'title'>): Promise<Dup[]>;
  create(d: TicketDraft): Promise<string>;
  get(key: string): Promise<ReadBack | null>;
  fix(key: string, actions: JiraAction[]): Promise<void>;
  /** Ticket als Issue für den Agenten (live: frisch in die Kopie geholt). */
  issue(key: string, fromMirror: () => Promise<Map<string, Issue>>): Promise<Issue | null>;
}

const SIM = () => wb().collection('jira_sim');

export function simJira(u: User): AnsetzenJira {
  const toRead = (d: any): ReadBack => ({ key: d._id, summary: d.summary, parent: d.parent ?? null, assigneeId: d.assigneeId ?? null, priority: d.priority ?? null, duedate: d.duedate ?? null, status: d.status, type: 'Task' });
  return {
    kind: 'sim',
    me: async () => ({ accountId: `sim-${u.id}`, displayName: u.name }),
    search: async (_jql, sp) => {
      const slug = specSlug(sp.path);
      const docs: any[] = await SIM().find({ $or: [{ description: { $regex: `spec: ${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` } }, { summary: sp.title }] }).toArray();
      return docs.map((d) => ({ key: d._id, summary: d.summary, status: d.status, why: 'simuliertes Ticket (Spec-Kennung)' }));
    },
    create: async (d) => {
      const seq: any = await wb().collection('meta').findOneAndUpdate({ _id: 'jira_sim_seq' as any }, { $inc: { n: 1 } }, { upsert: true, returnDocument: 'after' });
      const key = `SIM-${seq?.n ?? seq?.value?.n ?? 1}`;
      await SIM().insertOne({ _id: key as any, summary: d.summary, description: d.description, parent: d.parent, assigneeId: d.assigneeId, assignee: d.ownerName, priority: d.priority, duedate: d.duedate, status: 'To Do', createdAt: new Date(), by: u.id });
      return key;
    },
    get: async (key) => { const d = await SIM().findOne({ _id: key as any }); return d ? toRead(d) : null; },
    fix: async (key, actions) => {
      const set: Record<string, unknown> = {};
      for (const a of actions) {
        if (a.type === 'parent') set.parent = a.key;
        if (a.type === 'assignee') set.assigneeId = a.accountId;
        if (a.type === 'priority') set.priority = a.name;
        if (a.type === 'due') set.duedate = a.date;
      }
      await SIM().updateOne({ _id: key as any }, { $set: set });
    },
    issue: async (key) => {
      const d: any = await SIM().findOne({ _id: key as any });
      if (!d) return null;
      return { key, summary: d.summary, status: d.status, statusCategory: 'new', type: 'Task', assignee: d.assignee, assigneeId: d.assigneeId, parent: d.parent, workstream: d.parent, priority: d.priority, duedate: d.duedate, updated: new Date().toISOString(), description: `SIMULIERTES TICKET (nicht in Jira — dort weder suchen noch schreiben).\n\n${d.description}`, comments: 0, lastComment: null, labels: [] } as unknown as Issue;
    },
  };
}

function normalize(j: any): ReadBack {
  const f = j?.fields ?? {};
  return { key: j.key, summary: f.summary ?? '', parent: f.parent?.key ?? null, assigneeId: f.assignee?.accountId ?? null, priority: f.priority?.name ?? null, duedate: f.duedate ?? null, status: f.status?.name ?? '', type: f.issuetype?.name ?? '' };
}

/** Echter Weg. Lesen: eigener Jira-Zugang, sonst der der Kopie (nur lesen). Owner nie aus dem Zugang der Kopie. */
export async function liveJira(u: User): Promise<AnsetzenJira> {
  const own = await jiraCreds(u);
  const read = own ?? (await jiraCreds(null));
  if (!read) throw new JiraWriteError(412, 'jira_missing', 'Kein Jira-Lesezugang — Dublettenprüfung und Zurücklesen gehen so nicht. Unter „Einrichtung“ verbinden.');
  return {
    kind: 'live',
    me: async () => {
      if (own) { const m = await jiraFetch(own, 'GET', '/myself'); return { accountId: m.accountId, displayName: m.displayName }; }
      // Ohne eigenen Zugang: die Atlassian-Anmeldung der Person über den MCP (nie der gemeinsame Token → falscher Owner).
      const t = await mcpWrite(u, 'mcp__atlassian__atlassianUserInfo', {});
      const id = t.match(/"account_id"\s*:\s*"([^"]+)"/)?.[1] ?? t.match(/"accountId"\s*:\s*"([^"]+)"/)?.[1];
      if (!id) throw new JiraWriteError(412, 'me_unknown', 'Dein Jira-Konto ist nicht bestimmbar (Owner) — nichts angelegt.');
      return { accountId: id, displayName: t.match(/"name"\s*:\s*"([^"]+)"/)?.[1] ?? u.name };
    },
    search: async (jql) => {
      const r = await jiraFetch(read, 'POST', '/search/jql', { jql, fields: ['summary', 'status'], maxResults: 20 });
      return (r?.issues ?? []).map((i: any) => ({ key: i.key, summary: i.fields?.summary ?? '', status: i.fields?.status?.name ?? '', why: 'Jira-Suche' }));
    },
    create: async (d) => {
      if (writeMode() === 'rest') {
        if (!own) throw new JiraWriteError(412, 'jira_missing', 'REST-Schreibweg ohne eigenen Jira-Zugang — nichts angelegt.');
        try {
          const r = await jiraFetch(own, 'POST', '/issue', { fields: { project: { key: PROJECT() }, issuetype: { name: 'Task' }, summary: d.summary, description: adf(d.description), parent: { key: d.parent }, assignee: { accountId: d.assigneeId }, priority: { name: d.priority }, duedate: d.duedate } });
          if (!r?.key) throw new UnclearCreate('Jira hat keinen Schlüssel zurückgegeben.');
          return String(r.key);
        } catch (e: any) {
          // 4xx = abgelehnt, nichts angelegt; alles andere (5xx, Zeit, Netz) = unklar.
          if (e instanceof JiraError && e.status >= 400 && e.status < 500) throw new JiraWriteError(e.status === 401 || e.status === 403 ? 412 : 400, 'create_rejected', `Jira lehnt das Anlegen ab: ${e.message}`);
          if (e instanceof UnclearCreate) throw e;
          throw new UnclearCreate(`Anlegen ohne klare Antwort (${String(e?.message ?? e).slice(0, 160)}).`);
        }
      }
      let text: string;
      try {
        text = await mcpWrite(u, 'mcp__atlassian__createJiraIssue', {
          cloudId: cfg.jiraCloudId, projectKey: PROJECT(), issueTypeName: 'Task', summary: d.summary, description: d.description, contentFormat: 'markdown',
          parent: d.parent, assignee_account_id: d.assigneeId, additional_fields: { priority: { name: d.priority }, duedate: d.duedate },
        });
      } catch (e: any) {
        // Nicht angemeldet / kein Claude / Werkzeug lehnt ab / nicht aufgerufen = nichts angelegt; sonst unklar.
        // tool_error nur bei eindeutiger Ablehnung (4xx, Pflichtfeld, Berechtigung); ein 5xx kann schon angelegt haben.
        if (e instanceof JiraWriteError && (['mcp_auth', 'mcp_missing', 'claude_missing', 'claude_auth', 'not_called'].includes(e.code)
          || (e.code === 'tool_error' && /\b(400|401|403|404)\b|invalid|required|not allowed|permission|berechtigung/i.test(e.message) && !/\b5\d\d\b/.test(e.message)))) throw e;
        throw new UnclearCreate(`Anlegen über den MCP ohne klare Antwort (${String(e?.message ?? e).slice(0, 160)}).`);
      }
      const key = parseCreatedKey(text, d.parent);
      if (!key) throw new UnclearCreate('Schlüssel aus der MCP-Antwort nicht lesbar.');
      return key;
    },
    get: async (key) => {
      try { return normalize(await jiraFetch(read, 'GET', `/issue/${encodeURIComponent(key)}?fields=summary,parent,assignee,priority,duedate,status,issuetype`)); }
      catch (e: any) { if (e instanceof JiraError && e.status === 404) return null; throw e; }
    },
    fix: async (key, actions) => { await writeJira(u, key, actions); },
    issue: async (key, fromMirror) => {
      try { await refreshIssue(read, key); } catch { /* nächster Sync */ }
      return (await fromMirror()).get(key) ?? null;
    },
  };
}

// ---------- Ablauf ----------

export interface Deps {
  jira: AnsetzenJira;
  mirror: () => Promise<Map<string, Issue>>;
  /** `jira:` (bzw. `sim-jira:`) in die Spec; Ergebnis: ok · schon · offen:<Grund> · trocken */
  linkSpec: (sp: SpecLike, key: string, field: 'jira' | 'sim-jira') => Promise<string>;
  startAgent: (issue: Issue, note: string, specPath: string) => Promise<{ id: string; conv: string; url: string }>;
}

export interface Opts { summary?: string; parent?: string; mode: AgentMode; note?: string; useKey?: string; newTicket?: boolean; draft: TicketDraft }

const ST = () => wb().collection('spec_tickets');
export const ticketUrl = (key: string) => (key.startsWith('SIM-') ? null : browseUrl(key));

export async function specTicketState(slug: string) {
  return (await ST().findOne({ _id: slug as any })) as any;
}

/** Atomar die Sperre für diese Spec nehmen (Doppelklick, zwei Admins). null = ein anderer Lauf ist dran. */
async function claim(slug: string, path: string, runId: string): Promise<any | null> {
  const now = new Date();
  try {
    return await ST().findOneAndUpdate(
      { _id: slug as any, $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: null }, { leaseUntil: { $lt: now } }] },
      { $set: { leaseUntil: new Date(now.getTime() + LEASE_MS), runId, path }, $setOnInsert: { createdAt: now } },
      { upsert: true, returnDocument: 'after' },
    );
  } catch (e: any) { if (e?.code === 11000) return null; throw e; }
}

export async function runAnsetzen(u: User, sp: SpecLike, o: Opts, deps: Deps): Promise<any> {
  const slug = specSlug(sp.path);
  const runId = randomUUID();
  const doc = await claim(slug, sp.path, runId);
  if (!doc) throw Object.assign(new Error('Für diese Spec läuft „Agent ansetzen“ gerade schon — gleich neu laden.'), { status: 409 });
  const set = async (s: Record<string, unknown>) => { Object.assign(doc, s); await ST().updateOne({ _id: slug as any, runId }, { $set: s }); };
  const log = (step: string, detail: string) => ST().updateOne({ _id: slug as any }, { $push: { history: { $each: [{ at: new Date(), step, detail: detail.slice(0, 300), by: u.email }], $slice: -30 } } as any });
  try {
    const sim = deps.jira.kind === 'sim';
    const fmKey = String([sp.fm[sim ? 'sim-jira' : 'jira']].flat().join(' ')).match(sim ? /\bSIM-\d+\b/ : new RegExp(`\\b${PROJECT()}-\\d+\\b`))?.[0];
    let key: string | null = null;
    let created = false;
    if (o.useKey) {
      key = o.useKey;
      // Nach unklarem Anlegen übernimmt Knut meist das eben angelegte Ticket → wie angelegt behandeln (Felder nachziehen).
      created = doc.state === 'unklar' || doc.state === 'anlegen';
      await log('übernommen', key);
    } else if (doc.key) {
      key = doc.key;
    } else if (fmKey) {
      key = fmKey;
      await log('aus der Spec', key);
    } else if ((doc.state === 'unklar' || doc.state === 'anlegen') && !o.newTicket) {
      // Voriger Lauf: Anlegen ohne klares Ergebnis — nie still ein zweites Ticket. Kandidaten zeigen, Knut wählt.
      const candidates = await deps.jira.search(dupJql(sp), sp).catch(() => []);
      await set({ state: 'unklar' });
      return { ...view(doc), needsChoice: 'unklar', candidates };
    } else {
      if (!o.newTicket) {
        // Kurz vor dem Anlegen noch einmal suchen (die Vorschau kann alt sein); ohne Live-Suche kein Anlegen.
        let live: Dup[];
        try { live = await deps.jira.search(dupJql(sp), sp); }
        catch (e: any) { throw Object.assign(new Error(`Dublettenprüfung in Jira nicht möglich (${String(e?.message ?? e).slice(0, 120)}) — nichts angelegt.`), { status: 502 }); }
        const local = sim ? [] : localDuplicates(sp, [...(await deps.mirror()).values()]);
        const dups = [...new Map([...live, ...local].map((d) => [d.key, d])).values()];
        if (dups.length) return { ...view(doc), needsChoice: 'dublette', candidates: dups };
      }
      await set({ state: 'anlegen', key: null, startedAt: new Date(), by: u.email, sim });
      try {
        key = await deps.jira.create(o.draft);
      } catch (e: any) {
        if (e instanceof UnclearCreate) {
          await set({ state: 'unklar', why: e.message });
          await log('unklar', e.message);
          return { ...view(doc), needsChoice: 'unklar', candidates: await deps.jira.search(dupJql(sp), sp).catch(() => []) };
        }
        await set({ state: null, why: String(e?.message ?? e).slice(0, 300) });
        throw e;
      }
      created = true;
      await set({ state: 'angelegt', key, createdKeyAt: new Date(), why: null });
      await log('angelegt', key);
    }
    if (!doc.ticket || doc.ticket.key !== key) await set({ key, state: 'angelegt', ticket: { key, url: ticketUrl(key), created, sim }, readback: null, link: null, agent: null });

    // Zurücklesen (Bedingung 2). Nur am frisch angelegten Ticket werden Felder nachgezogen — ein übernommenes bleibt, wie es ist.
    if (created || doc.readback?.ok !== true) {
      let r = await deps.jira.get(key);
      if (!r) { await set({ readback: { ok: false, problems: ['Ticket nicht lesbar'] } }); return view(doc); }
      if (created || doc.ticket?.created) {
        const dev = deviations(o.draft, r);
        if (dev.length) {
          await deps.jira.fix(key, dev.map((d) => d.action));
          r = await deps.jira.get(key);
          const still = r ? deviations(o.draft, r).map((d) => d.field) : ['alles'];
          if (still.length) {
            await set({ readback: { ok: false, fixed: dev.map((d) => d.field), problems: still } });
            await log('zurücklesen', `weicht ab: ${still.join(', ')}`);
            return view(doc);
          }
          await set({ readback: { ok: true, fixed: dev.map((d) => d.field), summary: r!.summary } });
        } else await set({ readback: { ok: true, fixed: [], summary: r.summary } });
      } else await set({ readback: { ok: true, fixed: [], summary: r.summary, existing: true } });
    }

    // `jira:` in die Spec (Bedingung 7).
    if (doc.link?.state !== 'ok' && doc.link?.state !== 'schon') {
      const res = await deps.linkSpec(sp, key, sim ? 'sim-jira' : 'jira');
      const [state, why] = res.split(':');
      await set({ link: { state, why: why ?? null, field: sim ? 'sim-jira' : 'jira' } });
    }

    // Agent (Bedingungen 8, 9): höchstens einer je Ansetzen; volle Grenze oder schon laufend → „offen“ mit Grund.
    if (doc.agent?.state !== 'gestartet') {
      const issue = await deps.jira.issue(key, deps.mirror);
      if (!issue) { await set({ agent: { state: 'offen', why: 'Ticket noch nicht in der Jira-Kopie — gleich „Agent starten“.' } }); return view(doc); }
      const note = [o.mode === 'plan' ? 'Modus NUR PLAN: Schreib den Plan (Ziel, Ergebnis, Schnitte, DoD wörtlich aus der Spec) und hör dann auf — kein Code.' : 'Modus BIS REVIEW: Plan, dann Umsetzung bis zum Review-Stand.', o.note?.trim() ? `Hinweis von ${u.name.split(' ')[0]}: ${o.note.trim()}` : ''].filter(Boolean).join('\n');
      try {
        const a = await deps.startAgent(issue, note.slice(0, 2000), sp.path);
        await set({ agent: { state: 'gestartet', url: a.url, conv: a.conv, runId: a.id, at: new Date() } });
        await log('agent', a.url);
      } catch (e: any) {
        const why = e?.status === 429 ? 'Parallelgrenze voll — wartet auf freien Platz.' : String(e?.message ?? e).slice(0, 200);
        await set({ agent: { state: 'offen', why, status: e?.status ?? 500 } });
        await log('agent offen', why);
      }
    }
    return view(doc);
  } finally {
    await ST().updateOne({ _id: slug as any, runId }, { $set: { leaseUntil: null } });
  }
}

/** Was die Oberfläche braucht (ohne Verlauf/Interna). */
export function view(d: any) {
  if (!d) return null;
  return { slug: d._id, path: d.path, state: d.state ?? null, key: d.key ?? null, why: d.why ?? null, ticket: d.ticket ?? null, readback: d.readback ?? null, link: d.link ?? null, agent: d.agent ?? null, sim: !!d.sim };
}

/** `sim-jira: SIM-n` ins Frontmatter (Sim-Modus) — absichtlich nicht `jira:`, damit es nie als Verknüpfung gilt. */
export function addSimField(text: string, key: string): string | null {
  if (!text.startsWith('---\n')) return `---\nsim-jira: ${key}\n---\n${text}`;
  const end = text.indexOf('\n---', 3);
  if (end < 0) return `---\nsim-jira: ${key}\n---\n${text}`;
  const head = text.slice(4, end);
  if (new RegExp(`^sim-jira:.*\\b${key}\\b`, 'm').test(head)) return null;
  return `---\n${head.replace(/^sim-jira:.*\n?/m, '')}${head && !head.endsWith('\n') ? '\n' : ''}sim-jira: ${key}${text.slice(end)}`;
}

export const draftHashOf = (specText: string) => hash(specText);
