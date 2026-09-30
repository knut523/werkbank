// OLAF-Werkbank Web-App (Port 3070): Einrichtung, Wissen, Board, Sprint, Skills, Dateien & Teilen.
// Kein Framework: node:http, JSON-API unter /api, die Oberfläche (Vite/React) aus web/dist.
// Schreibende Aufrufe brauchen eine Sitzung, den Header "x-werkbank: 1" (gegen CSRF) und — wo sie
// den Vault oder Jira ändern — "confirm: true" im Body, den die Oberfläche erst nach dem
// Bestätigungsdialog setzt. Ohne confirm liefern sie nur die Vorschau.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream, writeFileSync, mkdirSync, watch } from 'node:fs';
import { join, extname, resolve, normalize } from 'node:path';
import { execFile } from 'node:child_process';
import YAML from 'yaml';
import { cfg, WEB_DIR, WB_ROOT, sprintRoot, browseUrl } from './config.ts';
import { connect, wb } from './db.ts';
import { librechatLogin, createSession, destroySession, currentUser, allowed, teammates, userById, type User } from './auth.ts';
import { claudeStatus, setClaudeToken, removeClaudeToken, getClaudeToken, jiraCreds, githubReadToken, jiraStatus, setJiraCreds, removeJiraCreds, markJiraWrite } from './creds.ts';
import { getIndex, readNote, tree, roadmap, teams, invalidateIndex, parseFrontmatter } from './vault.ts';
import { reindex, search, searchState } from './search.ts';
import { syncMirror, syncIncremental, recordSyncError, boardModel, refreshIssue, addComment, transitionTo, transitions, setDueDate, jiraFetch, isOverdue, isRecurring, JiraError, type Issue } from './jira.ts';
import { startAgentRun, chatUrl, ticketPrompt, startChatAgent, refreshChatRuns } from './agent.ts';
import { listCycles, parseQuestions, parseGoal, parseOutcomes, applyAnswer, hashText, newCycleFiles } from './sprint.ts';
import { runSyncPlan, proposalsFor, type Proposal } from './syncplan.ts';
import { listSkills, syncSkills } from './skills.ts';
import { saveUpload, listFiles, fileFor, filePath, shareFile, deleteFile, copyToScratch, chatsSharedWithMe, chatsSharedByMe, copySharedChat, watchChatShares, readShareLog } from './sharing.ts';
import { log } from './log.ts';
import { hygieneOf, snoozeItem, sessionStart, contextStats, proposeFromAnswer, applyActions, hygieneAll, allIssues, recordMeasure } from './assist.ts';
import { timingSafeEqual } from 'node:crypto';
import { writeJira, checkMcp, mcpState, writeMode, JiraWriteError, dryRun, describe, type JiraAction } from './jirawrite.ts';
import { jiraEventStream } from './events.ts';
import { syncGithub, livePrs, GH_ORG } from './github.ts';
import { moveActions, describeMove } from '../src/boardMove.ts';
import { suggestTickets, addJiraFrontmatter } from './links.ts';
import { parseDecisions, fillDecision, parseRankTable, parseReasons, prRefs, parsePrRegister, parseCheck, addRankProposal, roadmapInsights, KANBAN_STATES } from './roadmap.ts';
import { inSprint, goalsOf, sprintLabel, goalLabel, labelCfg, parseGoalsFile, goalTree, sprintGoalsFromOutcomes, sprintTag, valueOf, GOAL_ID, type GoalNode } from './goals.ts';

const DIST = join(WEB_DIR, 'dist');
// Vorschau-Instanz: WERKBANK_DRYRUN=1 schaltet Jira- und Vault-Schreiben auf Trockenlauf (zeigen statt schreiben).
const vaultDry = () => process.env.WERKBANK_VAULT_DRYRUN === '1' || process.env.WERKBANK_DRYRUN === '1';
const FONTS = join(cfg.librechatDist, 'client', 'public', 'fonts');
const TEMPLATES = join(WB_ROOT, 'templates', 'sprint');

class HttpError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }

// ---------- Hilfen ----------

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function body(req: IncomingMessage, max = 1 << 20): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) { size += c.length; if (size > max) throw new HttpError(413, 'Anfrage zu groß.'); chunks.push(c as Buffer); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Ungültiges JSON.'); }
}

const isMutation = (req: IncomingMessage) => req.method !== 'GET' && req.method !== 'HEAD';

async function needUser(req: IncomingMessage): Promise<User> {
  const u = await currentUser(req);
  if (!u) throw new HttpError(401, 'Bitte anmelden.');
  if (isMutation(req) && req.headers['x-werkbank'] !== '1') throw new HttpError(403, 'Fehlender Werkbank-Header.');
  return u;
}

async function needJira(u: User | null) {
  const c = await jiraCreds(u);
  if (!c) throw new HttpError(412, 'Kein Jira-Zugang hinterlegt — unter „Einrichtung“ verbinden.');
  return c;
}

const vaultIdx = () => getIndex(cfg.vaultDir);

function vaultPath(rel: string): string {
  const abs = resolve(cfg.vaultDir, normalize(rel));
  if (!abs.startsWith(cfg.vaultDir + '/') || !abs.endsWith('.md')) throw new HttpError(400, 'Ungültiger Pfad.');
  return abs;
}

async function issueMap(): Promise<Map<string, Issue>> {
  const all = (await wb().collection('jira_issues').find({}, { projection: { _id: 0 } }).toArray()) as unknown as Issue[];
  return new Map(all.map((i) => [i.key, i]));
}

// ---------- Verknüpfung Vault ↔ Tickets (Index-Refresh bei jeder Vault-Änderung über vaultIdx) ----------

let suggestCache: { at: number; n: number; map: Map<string, any[]> } | null = null;
async function suggestions(): Promise<Map<string, any[]>> {
  const idx = vaultIdx();
  const im = await issueMap();
  if (suggestCache && suggestCache.at === idx.builtAt && suggestCache.n === im.size) return suggestCache.map;
  const dismissed = new Set((await wb().collection('link_dismissed').find({}).toArray()).map((d: any) => String(d._id)));
  const map = suggestTickets([...idx.notes.values()], [...im.values()].filter((i) => i.type !== 'Workstream'), dismissed);
  suggestCache = { at: idx.builtAt, n: im.size, map };
  return map;
}

async function ticketDocs(u: User, key: string) {
  const idx = vaultIdx();
  const refs = idx.tickets.get(key) ?? [];
  const notes = refs.map((r) => ({ path: r.path, title: idx.notes.get(r.path)?.title ?? r.path, via: r.via, mtime: idx.notes.get(r.path)?.mtime }))
    .sort((a, b) => (a.via === 'frontmatter' ? -1 : 0) - (b.via === 'frontmatter' ? -1 : 0) || (b.mtime ?? 0) - (a.mtime ?? 0));
  const prs = [...new Set(refs.flatMap((r) => r.prs))];
  const files = (await wb().collection('files').find({ tickets: key, $or: [{ owner: u.id }, { sharedWith: u.id }] }, { projection: { name: 1, size: 1, ownerName: 1, createdAt: 1 } }).toArray())
    .map((f: any) => ({ id: f._id, name: f.name, size: f.size, ownerName: f.ownerName, createdAt: f.createdAt }));
  const sugg = (await suggestions()).get(key) ?? [];
  // Was ein Karten-Agent geschrieben hat (auch ohne Key in der Datei).
  const written = [...new Set((await wb().collection('agent_runs').find({ key, mode: 'chat' }, { projection: { written: 1 } }).toArray()).flatMap((r: any) => r.written ?? []))]
    .map((f: string) => ({ file: f, path: f.startsWith(cfg.vaultDir + '/') ? f.slice(cfg.vaultDir.length + 1) : null }))
    .filter((w) => !w.path || !notes.some((n) => n.path === w.path));
  return { notes: notes.slice(0, 40), notesTotal: notes.length, prs, files, suggestions: sugg, agentFiles: written };
}

async function jiraWrite<T>(u: User, fn: () => Promise<T>): Promise<T> {
  try {
    const r = await fn();
    await markJiraWrite(u, true);
    return r;
  } catch (e) {
    if (e instanceof JiraError && (e.status === 401 || e.status === 403)) await markJiraWrite(u, false);
    throw e;
  }
}

function presets() {
  try {
    const y = YAML.parse(readFileSync(join(WB_ROOT, 'librechat', 'librechat.yaml'), 'utf8'));
    return (y.modelSpecs?.list ?? []).map((s: any) => ({ name: s.name, label: s.label, description: s.description, skill: s.preset?.promptPrefix?.match(/Skill `([^`]+)`/)?.[1] ?? null, url: `${cfg.librechatPublicUrl}/c/new?spec=${encodeURIComponent(s.name)}` }));
  } catch { return []; }
}

async function health() {
  const probe = async (url: string, init?: RequestInit) => { try { const r = await fetch(url, { ...init, signal: AbortSignal.timeout(2500) }); return r.status < 500; } catch { return false; } };
  const [librechat, bridge, meili] = await Promise.all([
    probe(cfg.librechatUrl + '/health'), probe(cfg.bridgeUrl + '/health'), probe(cfg.meiliHost + '/health'),
  ]);
  let mongo = false;
  try { await wb().command({ ping: 1 }); mongo = true; } catch { /* aus */ }
  return { librechat, bridge, mongodb: mongo, meilisearch: meili, vault: existsSync(cfg.vaultDir) };
}

// ---------- Sprint-Helfer ----------

function cycles() {
  return listCycles(sprintRoot(), join(sprintRoot(), '..', '4-Archive'));
}

function cycleById(id: string) {
  const c = cycles().find((x) => x.id === id);
  if (!c) throw new HttpError(404, 'Zyklus nicht gefunden.');
  return c;
}

async function sprintView(id: string) {
  const c = cycleById(id);
  const im = await issueMap();
  const files: Record<string, any> = {};
  for (const k of ['summary', 'review', 'planning'] as const) {
    const f = c.files[k];
    if (!f) continue;
    const text = readFileSync(f, 'utf8');
    const qs = parseQuestions(text, f).map((q) => ({
      ...q, file: k,
      issue: q.ticket && im.get(q.ticket) ? { status: im.get(q.ticket)!.status, assignee: im.get(q.ticket)!.assignee, duedate: im.get(q.ticket)!.duedate, summary: im.get(q.ticket)!.summary } : null,
    }));
    const { fm } = parseFrontmatter(text);
    files[k] = {
      path: f.slice(cfg.vaultDir.length + 1), hash: hashText(text), title: fm.title ?? k, status: fm.status ?? null,
      goal: parseGoal(text), outcomes: parseOutcomes(text), questions: qs,
    };
  }
  const today = new Date().toISOString().slice(0, 10);
  const open = [...im.values()].filter((i) => i.type !== 'Workstream' && i.status !== 'Done');
  const sync: any = await wb().collection('meta').findOne({ _id: 'jira_sync' as any });
  return {
    cycle: { id: c.id, date: c.date, archived: c.archived },
    ...goalsView(c, files, im),
    files,
    overdue: open.filter((i) => isOverdue(i, today)).sort((a, b) => a.duedate!.localeCompare(b.duedate!)),
    undated: open.filter((i) => !i.duedate && !isRecurring(i)),
    jiraSync: sync ? { at: sync.at, count: sync.count } : null,
  };
}


// ---------- Ziele & Sprint (Zielbaum, Im Sprint, Kandidaten) ----------

const GOALS_FILE = () => process.env.WERKBANK_GOALS_FILE || 'olaf/1-Projects/ziele-olaf.md';
const tinyIssue = (i: Issue) => ({ key: i.key, summary: i.summary, status: i.status, statusCategory: i.statusCategory, assignee: i.assignee, duedate: i.duedate, type: i.type, labels: i.labels ?? [], goals: goalsOf(i.labels), overdue: isOverdue(i), blockedBy: i.blockedBy ?? [] });
const stripTree = (n: GoalNode): any => ({ ...n, children: n.children.map(stripTree) });

function goalsView(c: { id: string; date: string }, files: Record<string, any>, im: Map<string, Issue>) {
  const text = readVault(GOALS_FILE());
  const parsed = text ? parseGoalsFile(text) : { goals: [], ratings: [] };
  const sprintRows = sprintGoalsFromOutcomes(files.planning?.outcomes ?? [], c.date);
  const issues = [...im.values()];
  const { roots, byId } = goalTree([...parsed.goals, ...sprintRows], parsed.ratings, issues);
  const tag = sprintTag(c.date);
  const sprintGoals = [...byId.values()].filter((n) => n.level === 'Sprint' && n.id.startsWith(`S${tag}-`)).sort((a, b) => a.id.localeCompare(b.id, 'de', { numeric: true }));
  const end = new Date(c.date + 'T12:00:00Z'); end.setUTCDate(end.getUTCDate() + 13);
  const months = new Set([c.date.slice(5, 7), end.toISOString().slice(5, 7)]);
  const monthGoals = [...byId.values()].filter((n) => n.level === 'Monat' && months.has(n.id.slice(1, 3)));
  const label = sprintLabel(c.date);
  const members = issues.filter((i) => i.type !== 'Workstream' && inSprint(i, c.date));
  const sprintIds = new Set(sprintGoals.map((g) => g.id));
  const groups = sprintGoals.map((g) => ({ goal: { id: g.id, result: g.result }, tickets: members.filter((i) => goalsOf(i.labels).includes(g.id) || g.tickets.includes(i.key)).map(tinyIssue) }));
  const otherGoal = members.filter((i) => !groups.some((gr) => gr.tickets.some((t) => t.key === i.key)) && goalsOf(i.labels).length);
  const noGoal = members.filter((i) => !groups.some((gr) => gr.tickets.some((t) => t.key === i.key)) && !goalsOf(i.labels).length);
  // Kandidaten: Mitnahme (→ mitnehmen mit Ticket), Tickets der Sprintziele/Monatsziele, überfällige, Top-Rang-Specs — nicht im Sprint.
  const why = new Map<string, Set<string>>();
  const add = (k: string, w: string) => { const i = im.get(k); if (!i || i.type === 'Workstream' || i.status === 'Done' || inSprint(i, c.date)) return; if (!why.has(k)) why.set(k, new Set()); why.get(k)!.add(w); };
  for (const f of Object.values(files)) for (const q of f.questions ?? []) if (q.ticket && q.answers.some((a: any) => a.kind === 'carry')) add(q.ticket, 'Mitnahme');
  for (const g of [...sprintGoals, ...monthGoals]) for (const k of [...g.tickets, ...g.labelTickets]) add(k, `Ziel ${g.id}`);
  for (const i of issues) if (isOverdue(i)) add(i.key, 'überfällig');
  const idx = vaultIdx();
  const nameToPath = new Map([...idx.notes.values()].map((n) => [n.name, n]));
  for (const r of parseRankTable(readVault(`${OVERVIEW}/priorisierung-roadmap-produkt-olaf.md`)).filter((r) => r.rank <= 10)) {
    for (const k of nameToPath.get(r.spec)?.tickets ?? []) add(k, `Rang ${r.rank}`);
  }
  const candidates = [...why.entries()].map(([k, w]) => ({ ...tinyIssue(im.get(k)!), why: [...w] }))
    .sort((a, b) => Number(b.why.includes('Mitnahme')) - Number(a.why.includes('Mitnahme')) || b.why.length - a.why.length || a.key.localeCompare(b.key, 'de', { numeric: true }));
  return {
    goals: {
      file: GOALS_FILE(), missing: !text, roots: roots.map(stripTree), gate: roots.filter((r) => r.level === 'Gate').map((r) => ({ id: r.id, result: r.result })),
      sprintGoals: sprintGoals.map(stripTree), monthGoals: monthGoals.map(stripTree),
      labels: { sprint: label, goalPrefix: labelCfg().goalPrefix, sprintPrefix: labelCfg().sprintPrefix },
      goalIds: [...byId.values()].filter((n) => n.level !== 'Gate').map((n) => ({ id: n.id, level: n.level, result: valueOf(n.result) ?? n.id })),
    },
    inSprint: { label, count: members.length, groups, otherGoal: otherGoal.map(tinyIssue), noGoal: noGoal.map(tinyIssue) },
    candidates: candidates.slice(0, 60),
    dryRun: dryRun(),
  };
}

// ---------- Routen ----------

type Handler = (req: IncomingMessage, res: ServerResponse, m: RegExpMatchArray, url: URL) => Promise<void>;
const routes: [string, RegExp, Handler][] = [];
const on = (method: string, path: RegExp, h: Handler) => routes.push([method, path, h]);

on('GET', /^\/api\/health$/, async (_q, res) => send(res, 200, { ok: true, ...(await health()) }));

on('GET', /^\/api\/config$/, async (req, res) => {
  const u = await currentUser(req);
  send(res, 200, {
    librechatUrl: cfg.librechatPublicUrl, publicUrl: cfg.publicUrl, demo: cfg.demo, user: u, forge: !!process.env.WERKBANK_FORGE_MCP,
    jiraSite: cfg.jiraSite, project: cfg.jiraProject, vault: cfg.vaultDir,
    dryRun: dryRun(), vaultDryRun: vaultDry(),
  });
});

on('POST', /^\/api\/login$/, async (req, res) => {
  if (req.headers['x-werkbank'] !== '1') throw new HttpError(403, 'Fehlender Werkbank-Header.');
  const { email, password } = await body(req);
  if (!email || !password) throw new HttpError(400, 'E-Mail und Passwort angeben.');
  // Letzter Eintrag = vom Coder-Proxy angehängt (der erste ist vom Client frei wählbar).
  const ip = String(req.headers['x-forwarded-for'] ?? '').split(',').pop()!.trim() || req.socket.remoteAddress || undefined;
  const u = await librechatLogin(String(email), String(password), ip);
  if (!allowed(u.email)) throw new HttpError(403, 'Dein Konto ist für die Werkbank noch nicht freigeschaltet (Pilot). Frag Knut.');
  await createSession(res, u);
  log('login', { user: u.id });
  send(res, 200, { user: u });
});

on('POST', /^\/api\/logout$/, async (req, res) => { await destroySession(req, res); send(res, 200, { ok: true }); });

// --- Einrichtung ---

on('GET', /^\/api\/setup\/status$/, async (req, res) => {
  const u = await needUser(req);
  const skills = listSkills(cfg.skillsSource, cfg.skillsTarget);
  send(res, 200, {
    user: u,
    claude: await claudeStatus(u),
    jira: await jiraStatus(u),
    services: await health(),
    skills: { total: skills.length, linked: skills.filter((s) => s.state === 'verlinkt').length, missing: skills.filter((s) => s.state === 'fehlt').length },
    search: searchState,
    links: { librechat: cfg.librechatPublicUrl, register: cfg.librechatPublicUrl + '/register' },
  });
});

on('POST', /^\/api\/setup\/claude$/, async (req, res) => {
  const u = await needUser(req);
  const { token } = await body(req);
  await setClaudeToken(u, String(token ?? '').trim());
  log('claude token gesetzt', { user: u.id });
  send(res, 200, { ok: true, claude: await claudeStatus(u) });
});

on('DELETE', /^\/api\/setup\/claude$/, async (req, res) => { const u = await needUser(req); await removeClaudeToken(u); send(res, 200, { ok: true }); });

on('POST', /^\/api\/setup\/jira$/, async (req, res) => {
  const u = await needUser(req);
  const { email, token } = await body(req);
  const e = String(email ?? '').trim(), t = String(token ?? '').trim();
  if (!/^[^@\s]+@[^@\s]+$/.test(e) || t.length < 20) throw new HttpError(400, 'E-Mail und API-Token angeben.');
  // Prüfen, ob der Token lesen darf (zählt die Tickets in PM). Schreibrecht zeigt sich erst beim ersten Schreiben.
  const creds = { email: e, token: t, source: 'eigener Token' as const };
  let count: number | null = null;
  if (!cfg.demo) {
    const r = await jiraFetch(creds, 'POST', '/search/approximate-count', { jql: `project = ${cfg.jiraProject}` });
    count = r?.count ?? null;
  }
  await setJiraCreds(u, e, t, null);
  log('jira token gesetzt', { user: u.id });
  send(res, 200, { ok: true, count, jira: await jiraStatus(u) });
});

// Einmalige Anmeldung beim Atlassian-MCP, ohne Terminal: im Werkbank-Chat bietet Claude Code bei „needs-auth“ die
// Werkzeuge authenticate/complete_authentication an (Link → Anmeldung → Adresse der Fehlerseite zurück in den Chat).
const MCP_LOGIN_PROMPT = 'Melde mich beim Atlassian-MCP (Jira) an: Ruf das Werkzeug mcp__atlassian__authenticate auf und gib mir den Link. Ich melde mich im Browser an und kopiere dir danach die komplette Adresse der Seite, auf der ich lande (auch wenn sie einen Verbindungsfehler zeigt). Damit schließt du die Anmeldung mit mcp__atlassian__complete_authentication ab. Sonst nichts tun.';
const ATLASSIAN_JSON = JSON.stringify({ mcpServers: { atlassian: { type: 'http', url: process.env.BRIDGE_ATLASSIAN_MCP_URL || 'https://mcp.atlassian.com/v1/mcp' } } });
const mcpExtras = (home: any) => ({
  loginChatUrl: chatUrl(MCP_LOGIN_PROMPT),
  terminal: home?.dir ? `CLAUDE_CONFIG_DIR=${home.dir} claude --strict-mcp-config --mcp-config '${ATLASSIAN_JSON}'` : home ? 'claude' : null,
});

on('GET', /^\/api\/setup\/mcp$/, async (req, res) => {
  const u = await needUser(req);
  const st = await mcpState(u);
  send(res, 200, { ...st, mode: writeMode(), ...mcpExtras(st.home) });
});

on('POST', /^\/api\/setup\/mcp\/check$/, async (req, res) => {
  const u = await needUser(req);
  const st = await checkMcp(u);
  send(res, 200, { ...st, mode: writeMode(), ...mcpExtras(st.home) });
});

on('DELETE', /^\/api\/setup\/jira$/, async (req, res) => { const u = await needUser(req); await removeJiraCreds(u); send(res, 200, { ok: true }); });

// --- Wissen ---

on('GET', /^\/api\/vault\/overview$/, async (req, res) => {
  await needUser(req);
  const idx = vaultIdx();
  send(res, 200, { notes: idx.notes.size, teams: teams(idx), roadmap: roadmap(idx), tree: tree(idx), builtAt: idx.builtAt, search: searchState });
});

on('GET', /^\/api\/vault\/note$/, async (req, res, _m, url) => {
  await needUser(req);
  const idx = vaultIdx();
  const path = url.searchParams.get('path') ?? '';
  const n = readNote(idx, path);
  if (!n) throw new HttpError(404, 'Notiz nicht gefunden.');
  const info = (p: string) => ({ path: p, title: idx.notes.get(p)?.title ?? p, team: idx.notes.get(p)?.team });
  send(res, 200, {
    path, title: n.meta.title, fm: n.meta.fm, mtime: n.meta.mtime, html: n.html,
    links: n.meta.links.map(info), unresolved: n.meta.unresolved,
    backlinks: [...(idx.backlinks.get(path) ?? [])].sort().map(info),
    tickets: await (async () => { const im = await issueMap(); return n.meta.tickets.map((k) => { const i = im.get(k); const r = (idx.tickets.get(k) ?? []).find((x) => x.path === path); return { key: k, summary: i?.summary ?? null, status: i?.status ?? null, assignee: i?.assignee ?? null, via: r?.via ?? 'text' }; }); })(),
    suggestedTickets: n.meta.tickets.length ? [] : await (async () => { const im = await issueMap(); const out: any[] = []; for (const [k, list] of await suggestions()) { const hit = list.find((x: any) => x.path === path); if (hit) out.push({ key: k, summary: im.get(k)?.summary, status: im.get(k)?.status, why: hit.why, score: hit.score }); } return out.sort((a, b) => b.score - a.score).slice(0, 5); })(),
    chatUrl: chatUrl(`Lies die Notiz ${cfg.vaultDir}/${path} („${n.meta.title}“) und fass kurz zusammen, was drinsteht und was offen ist. Danach arbeiten wir damit weiter. Änderungen am Vault nur nach meiner Bestätigung.`),
  });
});

on('GET', /^\/api\/vault\/search$/, async (req, res, _m, url) => {
  await needUser(req);
  const q = (url.searchParams.get('q') ?? '').trim();
  if (!q) return send(res, 200, { hits: [] });
  send(res, 200, { hits: await search(q, { team: url.searchParams.get('team') || undefined }) });
});

on('POST', /^\/api\/vault\/reindex$/, async (req, res) => {
  await needUser(req);
  invalidateIndex();
  send(res, 200, await reindex(vaultIdx(), true));
});

// --- Board ---

on('GET', /^\/api\/board$/, async (req, res, _m, url) => {
  await needUser(req);
  const all = [...(await issueMap()).values()];
  const hyg = hygieneAll(all);
  await refreshChatRuns();
  const running = new Map<string, string>();
  for (const r of await wb().collection('agent_runs').find({ status: { $in: ['läuft', 'wartet auf ja'] } }, { projection: { key: 1, status: 1 } }).toArray() as any[]) {
    if (running.get(r.key) !== 'wartet auf ja') running.set(r.key, r.status);
  }
  const annotated = all.map((i) => ({ ...i, hygiene: hyg.get(i.key) ?? [], agent: running.get(i.key) ?? null, goals: goalsOf(i.labels) }));
  const curCycle = cycles().find((c) => !c.archived);
  const sprintOnly = url.searchParams.get('sprint') === '1' && curCycle ? sprintLabel(curCycle.date) : undefined;
  const filter = url.searchParams.get('filter') || undefined;
  const issues = annotated;
  const sync: any = await wb().collection('meta').findOne({ _id: 'jira_sync' as any });
  const model = boardModel(issues as Issue[], {
    owner: url.searchParams.get('owner') || undefined, filter,
    q: url.searchParams.get('q') || undefined, showDone: url.searchParams.get('done') === '1', label: sprintOnly,
  });
  const perOwner: Record<string, number> = {};
  for (const i of annotated) if (i.hygiene.length && i.type !== 'Workstream') perOwner[i.assignee ?? '—'] = (perOwner[i.assignee ?? '—'] ?? 0) + 1;
  send(res, 200, {
    ...model,
    lanes: model.lanes.map((l) => ({ ...l, hygiene: Object.values(l.columns).flat().reduce((n: number, c: any) => n + (c.hygiene?.length ? 1 : 0) + c.subtasks.filter((x: any) => x.hygiene?.length).length, 0) })),
    hygiene: { perOwner, total: [...hyg.keys()].length },
    sync: sync ? { at: sync.at, by: sync.by, count: sync.count, source: sync.source, error: sync.error, errorAt: sync.errorAt, errorKind: sync.errorKind ?? null, incAt: sync.incAt ?? null } : null,
    site: cfg.jiraSite,
    sprint: curCycle ? { id: curCycle.id, date: curCycle.date, label: sprintLabel(curCycle.date), count: all.filter((i) => inSprint(i, curCycle.date)).length } : null,
    dryRun: dryRun(),
  });
});

// Änderungen an der Jira-Kopie live (SSE): Board und Sprint laden betroffene Karten ohne Neuladen nach.
on('GET', /^\/api\/events$/, async (req, res) => {
  await needUser(req);
  jiraEventStream(req, res);
});

on('POST', /^\/api\/board\/sync$/, async (req, res) => {
  const u = await needUser(req);
  send(res, 200, await syncMirror(await needJira(u), u.email));
});

on('GET', /^\/api\/board\/issue\/([A-Z][A-Z0-9]+-\d+)$/, async (req, res, m) => {
  const u = await needUser(req);
  const im = await issueMap();
  const i = im.get(m[1]);
  if (!i) throw new HttpError(404, 'Ticket nicht in der Kopie.');
  await refreshChatRuns({ key: i.key });
  const runs = await wb().collection('agent_runs').find({ key: i.key }).sort({ startedAt: -1 }).limit(8).toArray();
  const hygI = hygieneAll([...im.values()]);
  const children = [...im.values()].filter((x) => x.parent === i.key).sort((a, b) => a.key.localeCompare(b.key, 'de', { numeric: true }))
    .map((x) => ({ key: x.key, summary: x.summary, status: x.status, statusCategory: x.statusCategory, assignee: x.assignee, duedate: x.duedate, overdue: isOverdue(x), hygiene: hygI.get(x.key) ?? [] }));
  send(res, 200, {
    issue: i, url: browseUrl(i.key), children, runs,
    parent: i.parent ? { key: i.parent, summary: im.get(i.parent)?.summary ?? i.parentSummary } : null,
    docs: await ticketDocs(u, i.key),
    chatUrl: chatUrl(`${ticketPrompt(i)}\n\nLass uns an diesem Ticket arbeiten. Lies zuerst, was Vault und Jira dazu sagen.`),
  });
});

on('GET', /^\/api\/board\/issue\/([A-Z][A-Z0-9]+-\d+)\/transitions$/, async (req, res, m) => {
  const u = await needUser(req);
  send(res, 200, { transitions: await transitions(await needJira(u), m[1]) });
});

const writeRoute = (kind: 'comment' | 'status' | 'due') => async (req: IncomingMessage, res: ServerResponse, m: RegExpMatchArray) => {
  const u = await needUser(req);
  const b = await body(req);
  const key = m[1];
  const preview = kind === 'comment' ? `Kommentar auf ${key}: „${String(b.text ?? '').slice(0, 200)}“`
    : kind === 'status' ? `Status von ${key} → „${b.to}“` : `Fälligkeit von ${key} → ${b.date || 'ohne Datum'}`;
  if (b.confirm !== true) return send(res, 200, { preview, needsConfirm: true, via: writeMode() });
  if (kind === 'comment' && !String(b.text ?? '').trim()) throw new HttpError(400, 'Leerer Kommentar.');
  const action = kind === 'comment' ? { type: 'comment' as const, text: String(b.text) } : kind === 'status' ? { type: 'status' as const, to: String(b.to) } : { type: 'due' as const, date: b.date ? String(b.date) : null };
  const r = await jiraWrite(u, () => writeJira(u, key, [action]));
  const issue = (await issueMap()).get(key) ?? null;
  send(res, 200, { ok: true, issue, via: r.via, dryRun: r.dryRun ?? false, calls: r.calls });
};
on('POST', /^\/api\/board\/issue\/([A-Z][A-Z0-9]+-\d+)\/comment$/, writeRoute('comment'));
on('POST', /^\/api\/board\/issue\/([A-Z][A-Z0-9]+-\d+)\/status$/, writeRoute('status'));
on('POST', /^\/api\/board\/issue\/([A-Z][A-Z0-9]+-\d+)\/due$/, writeRoute('due'));

// Karte gezogen (Spalte = Status, Bahn = Parent). Ohne confirm nur Prüfung + Vorschau; mit confirm schreiben (Trockenlauf in der Vorschau).
on('POST', /^\/api\/board\/issue\/([A-Z][A-Z0-9]+-\d+)\/move$/, async (req, res, m) => {
  const u = await needUser(req);
  const b = await body(req);
  const im = await issueMap();
  const i = im.get(m[1]);
  if (!i) throw new HttpError(404, 'Ticket nicht in der Kopie.');
  const wantStatus = b.status ? String(b.status) : undefined;
  const ts = wantStatus && wantStatus !== i.status ? await transitions(await needJira(u), i.key) : [];
  const r = moveActions(i, { status: wantStatus, lane: b.lane ? String(b.lane) : undefined }, ts, (k) => im.get(k)?.type === 'Workstream');
  if ('error' in r) throw new HttpError(400, r.error);
  if (!r.actions.length) return send(res, 200, { ok: true, nothing: true });
  const preview = describeMove(i, r.actions, (k) => im.get(k)?.summary ?? k);
  if (b.confirm !== true) return send(res, 200, { needsConfirm: true, preview, dryRun: dryRun() });
  // Parent vor Status: der Übergang gilt für das Ticket unabhängig vom Workstream.
  const acts = [...r.actions].sort((a, c) => (a.type === 'parent' ? -1 : 0) - (c.type === 'parent' ? -1 : 0)) as JiraAction[];
  const w = await jiraWrite(u, () => writeJira(u, i.key, acts));
  send(res, 200, { ok: true, preview, done: w.done, dryRun: w.dryRun ?? false, calls: w.calls, issue: (await issueMap()).get(i.key) ?? null });
});

// Einstellungen je Person (z. B. „Statuswechsel beim Ziehen bestätigen“, Vorgabe an).
on('GET', /^\/api\/prefs$/, async (req, res) => {
  const u = await needUser(req);
  const d: any = await wb().collection('user_prefs').findOne({ _id: u.id as any });
  send(res, 200, { confirmMove: d?.confirmMove ?? true });
});
on('POST', /^\/api\/prefs$/, async (req, res) => {
  const u = await needUser(req);
  const b = await body(req);
  const set: any = {};
  if (typeof b.confirmMove === 'boolean') set.confirmMove = b.confirmMove;
  await wb().collection('user_prefs').updateOne({ _id: u.id as any }, { $set: { ...set, at: new Date() } }, { upsert: true });
  send(res, 200, { ok: true, ...set });
});

on('POST', /^\/api\/board\/issue\/([A-Z][A-Z0-9]+-\d+)\/agent$/, async (req, res, m) => {
  const u = await needUser(req);
  if (dryRun()) throw new HttpError(409, 'Vorschau (Trockenlauf): Agenten und Chats sind hier aus.');
  const b = await body(req);
  const i = (await issueMap()).get(m[1]);
  if (!i) throw new HttpError(404, 'Ticket nicht in der Kopie.');
  const token = await getClaudeToken(u);
  if (!token) throw new HttpError(412, 'Noch kein Claude verbunden — unter „Einrichtung“ den Token aus `claude setup-token` eintragen.');
  // Standard: echter Chat („PM-123 · Titel“), der Agent arbeitet mit Rückfrage vor jedem Schreiben.
  // „Nur Entwurf“: wie bisher lesend im Hintergrund, Ergebnis als Kommentarentwurf an der Karte.
  if (b.mode !== 'draft') {
    const r = await startChatAgent(u, i, String(b.note ?? '').slice(0, 2000), 'work');
    log('agent chat', { user: u.id, key: i.key, conv: r.conv });
    return send(res, 200, { ...r, mode: 'chat' });
  }
  const id = await startAgentRun(u, token, i, String(b.note ?? '').slice(0, 2000));
  send(res, 200, { id, mode: 'draft' });
});

on('POST', /^\/api\/board\/issue\/([A-Z][A-Z0-9]+-\d+)\/discuss$/, async (req, res, m) => {
  const u = await needUser(req);
  if (dryRun()) throw new HttpError(409, 'Vorschau (Trockenlauf): Agenten und Chats sind hier aus.');
  const i = (await issueMap()).get(m[1]);
  if (!i) throw new HttpError(404, 'Ticket nicht in der Kopie.');
  if (!(await getClaudeToken(u))) throw new HttpError(412, 'Noch kein Claude verbunden — unter „Einrichtung“ den Token aus `claude setup-token` eintragen.');
  send(res, 200, await startChatAgent(u, i, '', 'discuss'));
});

on('POST', /^\/api\/board\/runs\/([0-9a-f-]{36})\/followup$/, async (req, res, m) => {
  const u = await needUser(req);
  const b = await body(req);
  const run: any = await wb().collection('agent_runs').findOne({ _id: m[1] as any });
  if (!run) throw new HttpError(404, 'Lauf nicht gefunden.');
  if (!String(b.text ?? '').trim()) throw new HttpError(400, 'Leere Nachfrage.');
  const i = (await issueMap()).get(run.key);
  const token = await getClaudeToken(u);
  if (!i || !token) throw new HttpError(412, 'Ticket oder Claude-Zugang fehlt.');
  // Nur die eigene Sitzung fortsetzen: die Brücke ordnet sie ohnehin dem Nutzer zu.
  const conv = run.userId === u.id ? run.conv : undefined;
  const id = await startAgentRun(u, token, i, String(b.text).slice(0, 2000), conv ? { conv, parent: run._id } : undefined);
  send(res, 200, { id });
});

on('POST', /^\/api\/board\/issue\/([A-Z][A-Z0-9]+-\d+)\/forge$/, async (req, res, m) => {
  const u = await needUser(req);
  if (!process.env.WERKBANK_FORGE_MCP) throw new HttpError(412, 'forge-review ist noch nicht angebunden (wird gerade abgesichert).');
  const b = await body(req);
  const pr = String(b.pr ?? '').trim();
  if (!/^([\w.-]+\/[\w.-]+)?#\d+$|^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(pr)) throw new HttpError(400, 'PR als „repo#123“ oder GitHub-Link angeben.');
  const i = (await issueMap()).get(m[1]);
  const token = await getClaudeToken(u);
  if (!i || !token) throw new HttpError(412, 'Ticket oder Claude-Zugang fehlt.');
  send(res, 200, { id: await startAgentRun(u, token, i, pr, undefined, 'forge') });
});

on('GET', /^\/api\/sessions$/, async (req, res) => {
  const u = await needUser(req);
  try {
    const r = await fetch(`${cfg.bridgeUrl}/sessions?user=${encodeURIComponent(u.id)}`, { headers: { 'x-werkbank-internal': process.env.WERKBANK_INTERNAL_TOKEN ?? '' }, signal: AbortSignal.timeout(3000) });
    const j: any = await r.json();
    send(res, 200, { sessions: (j.sessions ?? []).map((s: any) => ({ ...s, url: s.conv.startsWith('board-') ? null : `${cfg.librechatPublicUrl}/c/${s.conv}` })) });
  } catch { send(res, 200, { sessions: [], error: 'Brücke nicht erreichbar' }); }
});

on('GET', /^\/api\/board\/runs\/([0-9a-f-]{36})$/, async (req, res, m) => {
  await needUser(req);
  let r: any = await wb().collection('agent_runs').findOne({ _id: m[1] as any });
  if (!r) throw new HttpError(404, 'Lauf nicht gefunden.');
  if (r.mode === 'chat' && r.status !== 'fertig') { await refreshChatRuns({ _id: r._id }); r = await wb().collection('agent_runs').findOne({ _id: m[1] as any }); }
  send(res, 200, r);
});

on('POST', /^\/api\/board\/runs\/([0-9a-f-]{36})\/send$/, async (req, res, m) => {
  const u = await needUser(req);
  const b = await body(req);
  const run: any = await wb().collection('agent_runs').findOne({ _id: m[1] as any });
  if (!run) throw new HttpError(404, 'Lauf nicht gefunden.');
  const text = String(b.text ?? run.draft ?? '').trim();
  if (!text) throw new HttpError(400, 'Leerer Entwurf.');
  if (b.confirm !== true) return send(res, 200, { preview: `Kommentar auf ${run.key}: „${text.slice(0, 300)}“`, needsConfirm: true });
  const r = await jiraWrite(u, () => writeJira(u, run.key, [{ type: 'comment', text }]));
  await wb().collection('agent_runs').updateOne({ _id: m[1] as any }, { $set: { sentAt: new Date(), sentBy: u.email, draft: text } });
  log('agent draft gesendet', { user: u.id, key: run.key });
  send(res, 200, { ok: true, via: r.via });
});

// --- Verknüpfen: Vault-Notiz ↔ Ticket (jira:-Frontmatter, optional Kommentar im Ticket über den MCP) ---

on('POST', /^\/api\/links\/confirm$/, async (req, res) => {
  const u = await needUser(req);
  const b = await body(req);
  const key = String(b.key ?? '');
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key) || !(await issueMap()).has(key)) throw new HttpError(404, 'Ticket nicht in der Kopie.');
  const abs = vaultPath(String(b.path ?? ''));
  if (!existsSync(abs)) throw new HttpError(404, 'Notiz nicht gefunden.');
  const text = readFileSync(abs, 'utf8');
  const next = addJiraFrontmatter(text, key);
  const rel = abs.slice(cfg.vaultDir.length + 1);
  if (next === null) return send(res, 200, { ok: true, already: true });
  const head = (t: string) => t.slice(0, Math.min(t.length, (t.indexOf('\n---', 3) + 4) || 300));
  if (b.confirm !== true) return send(res, 200, { needsConfirm: true, hash: hashText(text), preview: { path: rel, before: text.startsWith('---') ? head(text) : '(kein Frontmatter)', after: head(next) } });
  if (String(b.hash ?? '') !== hashText(text)) throw new HttpError(409, 'Die Notiz hat sich inzwischen geändert — bitte neu laden.');
  if (vaultDry()) return send(res, 200, { ok: true, dryRun: true, wouldWrite: rel });
  writeFileSync(abs, next);
  invalidateIndex(); suggestCache = null;
  log('vault link', { user: u.id, key, path: rel });
  let commented = false;
  if (b.comment === true) {
    await jiraWrite(u, () => writeJira(u, key, [{ type: 'comment', text: `Vault-Notiz verknüpft: ${idxTitle(rel)} (${rel})` }]));
    commented = true;
  }
  send(res, 200, { ok: true, path: rel, commented });
});

function idxTitle(rel: string) { return vaultIdx().notes.get(rel)?.title ?? rel; }

on('POST', /^\/api\/links\/dismiss$/, async (req, res) => {
  await needUser(req);
  const b = await body(req);
  await wb().collection('link_dismissed').updateOne({ _id: `${b.key}|${b.path}` as any }, { $set: { at: new Date() } }, { upsert: true });
  suggestCache = null;
  send(res, 200, { ok: true });
});

on('POST', /^\/api\/files\/([0-9a-f-]{36})\/ticket$/, async (req, res, m) => {
  const u = await needUser(req);
  const b = await body(req);
  const key = String(b.key ?? '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key) || !(await issueMap()).has(key)) throw new HttpError(404, 'Ticket nicht in der Kopie.');
  const f = await fileFor(u, m[1]);
  if (!f) throw new HttpError(404, 'Datei nicht gefunden.');
  await wb().collection('files').updateOne({ _id: m[1] as any }, b.remove ? { $pull: { tickets: key } } as any : { $addToSet: { tickets: key } });
  log('datei an ticket', { user: u.id, key, remove: !!b.remove });
  send(res, 200, { ok: true });
});

// --- Roadmap (Priorisierung, Zustands-Kanban, PR-Review, offene Entscheidungen, Konsistenz) ---

const ROADMAP_BASE = 'olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap';
const OVERVIEW = `${ROADMAP_BASE}/0-Overview`;
let checkCache: { at: number; built: number; data: any } | null = null;

function runRoadmapCheck(): Promise<any> {
  const idx = vaultIdx();
  if (checkCache && checkCache.built === idx.builtAt && Date.now() - checkCache.at < 5 * 60_000) return Promise.resolve(checkCache.data);
  const script = process.env.WERKBANK_ROADMAP_CHECK || join(cfg.skillsTarget, 'olaf-produkt-roadmap', 'scripts', 'roadmap_check.py');
  if (!existsSync(script)) return Promise.resolve({ available: false, findings: [], errors: 0, warnings: 0 });
  return new Promise((resolve) => execFile('python3', [script, join(cfg.vaultDir, ROADMAP_BASE)], { timeout: 30_000, maxBuffer: 4 << 20 }, (_err, stdout) => {
    const data = { available: true, at: new Date(), ...parseCheck(String(stdout ?? '')) };
    checkCache = { at: Date.now(), built: idx.builtAt, data };
    resolve(data);
  }));
}

const readVault = (rel: string) => { try { return readFileSync(join(cfg.vaultDir, rel), 'utf8'); } catch { return ''; } };

on('GET', /^\/api\/roadmap$/, async (req, res) => {
  await needUser(req);
  const idx = vaultIdx();
  const im = await issueMap();
  const rm = roadmap(idx, ROADMAP_BASE);
  const byName = new Map<string, any>();
  const decisions: any[] = [];
  const specPrs = new Map<string, string[]>();
  for (const t of rm.topics) {
    for (const [state, specs] of Object.entries(t.states)) {
      for (const sp of specs) {
        const text = readVault(sp.path);
        const ds = parseDecisions(text);
        const prs = prRefs(text);
        const n = idx.notes.get(sp.path)!;
        const tickets = n.tickets.map((k) => ({ key: k, status: im.get(k)?.status ?? null, summary: im.get(k)?.summary ?? null }));
        const info = { path: sp.path, name: n.name, title: sp.title, topic: t.name, state, status: sp.status ?? null, open: ds.filter((d) => d.open).length, prs, tickets, hash: hashText(text), jiraKey: n.fm.jira != null && String(n.fm.jira).trim() !== '' && String(n.fm.jira) !== '[]' };
        byName.set(n.name, info);
        for (const pr of prs) specPrs.set(pr, [...(specPrs.get(pr) ?? []), n.name]);
        for (const d of ds) if (d.open) decisions.push({ ...d, path: sp.path, spec: n.name, title: sp.title, topic: t.name, state, hash: info.hash });
      }
    }
  }
  // Übersichtsseiten und Register haben auch „- Knut:“-Zeilen.
  for (const o of [...rm.overview, ...rm.topics.filter((t) => t.overview).map((t) => ({ path: t.overview!, title: idx.notes.get(t.overview!)?.title ?? t.overview! }))]) {
    const text = readVault(o.path);
    for (const d of parseDecisions(text)) if (d.open) decisions.push({ ...d, path: o.path, spec: idx.notes.get(o.path)?.name, title: o.title, topic: o.path.includes('/0-Overview/') ? 'Übersicht' : o.path.split('/').at(-2), state: 'Übersicht', hash: hashText(text) });
  }
  const prio = readVault(`${OVERVIEW}/priorisierung-roadmap-produkt-olaf.md`);
  const reasons = parseReasons(prio);
  const ranking = parseRankTable(prio).map((r) => {
    const sp = byName.get(r.spec);
    return { ...r, why: reasons.get(r.spec.replace(/^[a-z]+-spec-/, '')) ?? reasons.get(r.spec) ?? [...reasons].find(([k]) => r.spec.endsWith('-' + k))?.[1] ?? null, path: sp?.path ?? null, folderState: sp?.state ?? null, open: sp?.open ?? 0, tickets: sp?.tickets ?? [], prs: sp?.prs ?? [] };
  });
  const register = parsePrRegister(readVault(`${OVERVIEW}/pr-stand-produkt-olaf.md`));
  const prMap = new Map<string, any>();
  for (const r of register) {
    const p = prMap.get(r.pr) ?? { pr: r.pr, url: `https://github.com/WirStrom1/${r.pr.replace('#', '/pull/')}`, rows: [], specs: specPrs.get(r.pr) ?? [] };
    p.rows.push({ section: r.section, cols: r.cols });
    prMap.set(r.pr, p);
  }
  for (const [pr, specs] of specPrs) if (!prMap.has(pr)) prMap.set(pr, { pr, url: `https://github.com/WirStrom1/${pr.replace('#', '/pull/')}`, rows: [], specs });
  // Live-Zustand aus GitHub (alle 5 min gecacht): offene PRs, die nicht im Register stehen, kommen dazu.
  const gh = await livePrs();
  for (const pr of gh.map.keys()) if (!prMap.has(pr)) prMap.set(pr, { pr, url: gh.map.get(pr)!.url, rows: [], specs: specPrs.get(pr) ?? [] });
  const ghOk = !!gh.sync?.at && !gh.sync?.error;
  const prs = [...prMap.values()].map((p) => {
    const txt = p.rows.map((r: any) => Object.values(r.cols).join(' ')).join(' ');
    const live = gh.map.get(p.pr) ?? null;
    let review = /CHANGES_REQUESTED|❌/.test(txt) ? 'Änderungen verlangt' : /APPROVED|✅/.test(txt) ? 'freigegeben' : /merged|gemergt/i.test(txt) ? 'gemergt' : p.rows.length ? 'offen' : 'nur in Specs';
    let turn = review === 'Änderungen verlangt' ? 'Autor' : review === 'freigegeben' ? 'Merge (Mensch)' : review === 'offen' ? 'Reviewer' : '—';
    if (live) {
      review = live.isDraft ? 'Entwurf' : live.reviewDecision === 'APPROVED' ? 'freigegeben' : live.reviewDecision === 'CHANGES_REQUESTED' ? 'Änderungen verlangt' : 'offen';
      turn = live.turn.who;
    } else if (ghOk && /^[\w.-]+#\d+$/.test(p.pr) && review !== 'gemergt') {
      review = 'nicht mehr offen'; turn = '—';   // GitHub kennt ihn nicht als offen: gemergt oder geschlossen
    }
    const gates = [...new Set((txt.match(/\b(Deploy[^.;|]*|Migration[^.;|]*|Rotation[^.;|]*|Flag[^.;|]*)/g) ?? []).map((g: string) => g.trim().slice(0, 80)))].slice(0, 3);
    const tickets = [...new Set(p.specs.flatMap((s: string) => (byName.get(s)?.tickets ?? []).map((t: any) => t.key)))];
    return { ...p, review, turn, gates, tickets, live };
  }).sort((a, b) => (a.live ? 0 : 1) - (b.live ? 0 : 1) || a.pr.localeCompare(b.pr, 'de', { numeric: true }));
  const github = { at: gh.sync?.at ?? null, error: gh.sync?.error ?? null, count: gh.map.size, org: GH_ORG };
  // Thema → Rang, Swimlanes, „Als Nächstes“ (Sprint-Zuordnung über Ticket-Labels), Konsistenz Spec ↔ Ticket.
  const cur = cycles().find((c) => !c.archived);
  const sprintTickets = new Set(cur ? [...im.values()].filter((i) => inSprint(i, cur.date)).map((i) => i.key) : []);
  const livePr = (pr: string) => { const l = gh.map.get(pr); return l ? { pr, conflict: l.mergeable === 'CONFLICTING', draft: l.isDraft, review: l.reviewDecision, turn: l.turn.who } : { pr, closed: ghOk }; };
  const specList = [...byName.values()].map((x) => ({ ...x, prLive: x.prs.map(livePr) }));
  const insights = roadmapInsights(specList, ranking, { sprintTickets });
  send(res, 200, {
    ...insights, kanbanStates: KANBAN_STATES, sprint: cur ? { id: cur.id, date: cur.date, tickets: sprintTickets.size } : null,
    base: ROADMAP_BASE, states: rm.states, overview: rm.overview,
    topics: rm.topics.map((t) => ({ name: t.name, overview: t.overview, states: Object.fromEntries(Object.entries(t.states).map(([st, specs]) => [st, specs.map((sp) => byName.get(idx.notes.get(sp.path)!.name))])) })),
    ranking, prs, decisions, github,
    hub: { path: `${OVERVIEW}/0-roadmap-produkt-olaf.md`, prio: `${OVERVIEW}/priorisierung-roadmap-produkt-olaf.md`, register: `${OVERVIEW}/pr-stand-produkt-olaf.md` },
    githubReadOnly: true,
  });
});

on('POST', /^\/api\/roadmap\/github$/, async (req, res) => {
  await needUser(req);
  const r = await syncGithub(await githubReadToken()).catch((e: any) => { throw new HttpError(502, e.message); });
  send(res, 200, r ?? { count: 0, changed: 0, error: 'Kein GitHub-Lesetoken.' });
});

on('GET', /^\/api\/roadmap\/check$/, async (req, res) => { await needUser(req); send(res, 200, await runRoadmapCheck()); });

on('POST', /^\/api\/roadmap\/answer$/, async (req, res) => {
  const u = await needUser(req);
  const b = await body(req);
  const abs = vaultPath(String(b.path ?? ''));
  if (!abs.includes(`/${ROADMAP_BASE}/`)) throw new HttpError(400, 'Nur Roadmap-Notizen.');
  const text = readFileSync(abs, 'utf8');
  let r;
  try { r = fillDecision(text, Number(b.line), String(b.text ?? ''), String(b.hash ?? '')); }
  catch (e: any) { throw new HttpError(/geändert/.test(e.message) ? 409 : 400, e.message); }
  const rel = abs.slice(cfg.vaultDir.length + 1);
  if (b.confirm !== true) return send(res, 200, { needsConfirm: true, preview: { path: rel, line: r.line, before: r.before, after: r.after } });
  if (vaultDry()) return send(res, 200, { ok: true, dryRun: true, wouldWrite: rel, path: rel, line: r.line });
  writeFileSync(abs, r.text);
  invalidateIndex(); checkCache = null;
  log('roadmap antwort', { user: u.id, path: rel, line: r.line });
  send(res, 200, { ok: true, path: rel, line: r.line });
});

on('POST', /^\/api\/roadmap\/rank-proposal$/, async (req, res) => {
  const u = await needUser(req);
  const b = await body(req);
  const rel = `${OVERVIEW}/priorisierung-roadmap-produkt-olaf.md`;
  const abs = vaultPath(rel);
  if (!existsSync(abs)) throw new HttpError(404, 'Priorisierungsseite fehlt.');
  const text = readFileSync(abs, 'utf8');
  const from = Number(b.from), to = Number(b.to);
  if (!/^[a-z0-9-]+$/.test(String(b.spec ?? '')) || !(from > 0) || !(to > 0) || from === to) throw new HttpError(400, 'Spec und neuer Rang angeben.');
  if (String(b.hash ?? '') && String(b.hash) !== hashText(text)) throw new HttpError(409, 'Die Priorisierung hat sich inzwischen geändert — bitte neu laden.');
  const d = new Date();
  const next = addRankProposal(text, { spec: String(b.spec), from, to, why: String(b.why ?? '').slice(0, 300), who: u.name.split(' ')[0], date: `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}` });
  if (b.confirm !== true) return send(res, 200, { needsConfirm: true, hash: hashText(text), preview: { path: rel, add: next.slice(text.replace(/\n*$/, '').length).trim() } });
  if (vaultDry()) return send(res, 200, { ok: true, dryRun: true, wouldWrite: rel });
  writeFileSync(abs, next);
  invalidateIndex();
  log('rang vorschlag', { user: u.id, spec: b.spec, from, to });
  send(res, 200, { ok: true });
});

// --- Sprint ---

on('GET', /^\/api\/sprint\/cycles$/, async (req, res) => {
  await needUser(req);
  send(res, 200, { cycles: cycles().map((c) => ({ id: c.id, date: c.date, archived: c.archived, files: Object.keys(c.files).filter((k) => (c.files as any)[k]) })), root: sprintRoot() });
});

on('GET', /^\/api\/sprint\/(sprint-\d{4}-\d{2}-\d{2})$/, async (req, res, m) => { await needUser(req); send(res, 200, await sprintView(m[1])); });

on('POST', /^\/api\/sprint\/(sprint-\d{4}-\d{2}-\d{2})\/answer$/, async (req, res, m) => {
  const u = await needUser(req);
  const b = await body(req);
  const c = cycleById(m[1]);
  const f = (c.files as any)[b.file];
  if (!f) throw new HttpError(404, 'Notiz nicht gefunden.');
  const text = readFileSync(f, 'utf8');
  let edit;
  try { edit = applyAnswer(text, Number(b.line), String(b.speaker ?? u.name.split(' ')[0]), String(b.text ?? ''), String(b.hash ?? '')); }
  catch (e: any) { throw new HttpError(/geändert/.test(e.message) ? 409 : 400, e.message); }
  const rel = f.slice(cfg.vaultDir.length + 1);
  if (b.confirm !== true) return send(res, 200, { needsConfirm: true, preview: { file: rel, line: edit.line, before: edit.before, after: edit.after, mode: edit.mode } });
  // Unmittelbar vor dem Schreiben nochmals prüfen (Obsidian-Sync, andere Person).
  if (hashText(readFileSync(f, 'utf8')) !== b.hash) throw new HttpError(409, 'Die Notiz hat sich inzwischen geändert — bitte neu laden.');
  if (vaultDry()) return send(res, 200, { ok: true, dryRun: true, wouldWrite: rel, line: edit.line, hash: b.hash });
  writeFileSync(f, edit.text);
  invalidateIndex();
  log('vault antwort', { user: u.id, file: rel, line: edit.line });
  send(res, 200, { ok: true, line: edit.line, hash: hashText(edit.text) });
});

on('POST', /^\/api\/sprint\/(sprint-\d{4}-\d{2}-\d{2})\/syncplan$/, async (req, res, m) => {
  await needUser(req);
  const c = cycleById(m[1]);
  const rows = await runSyncPlan(c.dir);
  const props = proposalsFor(rows, await issueMap(), c.date).map((p) => ({ ...p, row: { ...p.row, file: p.row.file.slice(cfg.vaultDir.length + 1) } }));
  send(res, 200, { proposals: props });
});

on('POST', /^\/api\/sprint\/(sprint-\d{4}-\d{2}-\d{2})\/apply$/, async (req, res, m) => {
  const u = await needUser(req);
  const b = await body(req);
  if (b.confirm !== true) throw new HttpError(400, 'Nur mit Freigabe.');
  const c = cycleById(m[1]);
  // Plan frisch berechnen und nur die freigegebenen IDs ausführen, deren Inhalt unverändert ist.
  const props = proposalsFor(await runSyncPlan(c.dir), await issueMap(), c.date);
  const approved: Record<string, any> = b.approved ?? {};
  const results: any[] = [];
  const done = new Map<string, number[]>();
  for (const p of props) {
    const a = approved[p.id];
    if (!a || p.carry || !p.ticket) continue;
    if (a.payload !== p.row.payload) { results.push({ id: p.id, ok: false, error: 'Notiz hat sich geändert — neu vorbereiten.' }); continue; }
    const actions = (Array.isArray(a.actions) ? a.actions : p.actions) as Proposal['actions'];
    try {
      await jiraWrite(u, () => writeJira(u, p.ticket!, actions.map((act: any) => act.type === 'comment' ? { type: 'comment', text: String(act.text) } : act.type === 'status' ? { type: 'status', to: String(act.to) } : { type: 'due', date: act.date ? String(act.date) : null })));
      results.push({ id: p.id, ok: true });
      if (!done.has(p.row.file)) done.set(p.row.file, []);
      done.get(p.row.file)!.push(p.row.line);
    } catch (e: any) { results.push({ id: p.id, ok: false, error: String(e.message).slice(0, 300) }); }
  }
  // Nur vollständig erfolgreiche Notizen markieren (✓ Datum → Jira), mit dem Skript des Skills.
  const marked: string[] = [];
  if (!dryRun() && !vaultDry()) for (const [file, lines] of done) {
    await new Promise<void>((resolve) => execFile(join(cfg.jiraScripts, 'jira-sync-mark.sh'), ['--file', file, ...lines.map(String)], { timeout: 20_000 }, (err) => { if (!err) marked.push(file.slice(cfg.vaultDir.length + 1)); resolve(); }));
  }
  log('sprint sync', { user: u.id, cycle: c.id, ok: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).length });
  send(res, 200, { results, marked });
});

// Sprint-Mitgliedschaft / Ziel zuordnen = Jira-Labels (nur Sprint-/Ziel-Labels, nur nach Bestätigung, Trockenlauf in der Vorschau).
on('POST', /^\/api\/sprint\/(sprint-\d{4}-\d{2}-\d{2})\/labels$/, async (req, res, m) => {
  const u = await needUser(req);
  const b = await body(req);
  const c = cycleById(m[1]);
  const key = String(b.key ?? '');
  const i = (await issueMap()).get(key);
  if (!i) throw new HttpError(404, 'Ticket nicht in der Kopie.');
  const lc = labelCfg();
  const ok = (l: string) => l === sprintLabel(c.date) || (l.startsWith(lc.goalPrefix) && GOAL_ID.test(l.slice(lc.goalPrefix.length)));
  const addL = (Array.isArray(b.add) ? b.add : []).map(String), rmL = (Array.isArray(b.remove) ? b.remove : []).map(String);
  const bad = [...addL, ...rmL].filter((l) => !ok(l));
  if (bad.length) throw new HttpError(400, `Nur Sprint-/Ziel-Labels: ${bad.join(', ')}`);
  const action: JiraAction = { type: 'labels', add: addL, remove: rmL };
  const preview = `${key}: ${describe(action)}`;
  if (b.confirm !== true) return send(res, 200, { needsConfirm: true, preview, dryRun: dryRun(), labels: i.labels ?? [] });
  const r = await jiraWrite(u, () => writeJira(u, key, [action]));
  send(res, 200, { ok: true, done: r.done, dryRun: r.dryRun ?? false, calls: r.calls });
});

on('GET', /^\/api\/dryrun$/, async (req, res) => {
  const u = await needUser(req);
  send(res, 200, { dryRun: dryRun(), entries: await wb().collection('jira_dryrun').find({ userId: u.id }).sort({ at: -1 }).limit(50).toArray() });
});

on('POST', /^\/api\/sprint\/new$/, async (req, res) => {
  const u = await needUser(req);
  const b = await body(req);
  const date = String(b.date ?? '');
  const id = `sprint-${date}`;
  const prev = cycles().filter((c) => !c.archived)[0]?.id;
  let files;
  try { files = newCycleFiles(TEMPLATES, date, prev); } catch (e: any) { throw new HttpError(400, e.message); }
  const dir = join(sprintRoot(), id);
  if (existsSync(dir)) throw new HttpError(409, `${id} gibt es schon.`);
  const rel = dir.slice(cfg.vaultDir.length + 1);
  if (b.confirm !== true) return send(res, 200, { needsConfirm: true, preview: { dir: rel, files: files.map((f) => ({ name: f.name, lines: f.content.split('\n').length, head: f.content.slice(0, 1200) })) } });
  if (vaultDry()) return send(res, 200, { ok: true, dryRun: true, wouldWrite: rel, id, dir: rel });
  mkdirSync(dir);
  for (const f of files) writeFileSync(join(dir, f.name), f.content, { flag: 'wx' });
  invalidateIndex();
  log('sprint neu', { user: u.id, cycle: id });
  send(res, 200, { ok: true, id, dir: rel });
});

// --- Skills ---

on('GET', /^\/api\/skills$/, async (req, res) => {
  await needUser(req);
  const usage = new Map((await wb().collection('skill_usage').find({}).toArray()).map((d: any) => [String(d._id), { count: d.count ?? 0, users: (d.users ?? []).length, lastUsed: d.lastUsed ?? null, since: d.since ?? null }]));
  const core: string[] = (() => { try { const j = JSON.parse(readFileSync(join(WB_ROOT, 'claude-bridge', 'skills-core.json'), 'utf8')); return Array.isArray(j) ? j : j.core ?? j.skills ?? []; } catch { return []; } })();
  send(res, 200, { source: cfg.skillsSource, target: cfg.skillsTarget, skills: listSkills(cfg.skillsSource, cfg.skillsTarget).map((x: any) => ({ ...x, usage: usage.get(x.name) ?? null, core: core.includes(x.name) })), presets: presets(), usageSince: [...usage.values()].map((u) => u.since).filter(Boolean).sort()[0] ?? null });
});

on('POST', /^\/api\/skills\/sync$/, async (req, res) => {
  const u = await needUser(req);
  const r = syncSkills(cfg.skillsSource, cfg.skillsTarget);
  log('skills sync', { user: u.id, linked: r.linked.length });
  send(res, 200, r);
});

// --- Dateien & Teilen ---

on('GET', /^\/api\/team$/, async (req, res) => {
  const u = await needUser(req);
  send(res, 200, { people: (await teammates()).filter((p) => p.id !== u.id && allowed(p.email)) });
});

on('GET', /^\/api\/files$/, async (req, res) => {
  const u = await needUser(req);
  const { mine, shared } = await listFiles(u);
  const people = await teammates();
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? '?';
  send(res, 200, {
    mine: mine.map((f: any) => ({ ...f, id: f._id, sharedWithNames: f.sharedWith.map(name) })),
    shared: shared.map((f: any) => ({ ...f, id: f._id, sharedWith: undefined })),
    maxMb: Math.round(cfg.fileMaxBytes / 1048576),
  });
});

on('PUT', /^\/api\/files$/, async (req, res, _m, url) => {
  const u = await needUser(req);
  const f = await saveUpload(u, req, url.searchParams.get('name') ?? '', url.searchParams.get('personal') === '1');
  send(res, 200, { ok: true, id: f._id, name: f.name });
});

on('GET', /^\/api\/files\/([0-9a-f-]{36})\/download$/, async (req, res, m) => {
  const u = await needUser(req);
  const f = await fileFor(u, m[1]);
  if (!f) throw new HttpError(404, 'Datei nicht gefunden.');
  res.writeHead(200, {
    'content-type': 'application/octet-stream', 'x-content-type-options': 'nosniff',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'content-security-policy': "sandbox; default-src 'none'", 'cache-control': 'no-store',
  });
  createReadStream(filePath(f)).pipe(res);
});

on('POST', /^\/api\/files\/([0-9a-f-]{36})\/share$/, async (req, res, m) => {
  const u = await needUser(req);
  const b = await body(req);
  const target = await userById(String(b.userId ?? ''));
  if (!target || !allowed(target.email)) throw new HttpError(404, 'Person nicht gefunden oder nicht freigeschaltet.');
  await shareFile(u, m[1], target, b.share !== false);
  send(res, 200, { ok: true });
});

on('DELETE', /^\/api\/files\/([0-9a-f-]{36})$/, async (req, res, m) => { const u = await needUser(req); await deleteFile(u, m[1]); send(res, 200, { ok: true }); });

on('POST', /^\/api\/files\/([0-9a-f-]{36})\/chat$/, async (req, res, m) => {
  const u = await needUser(req);
  const f = await fileFor(u, m[1]);
  if (!f) throw new HttpError(404, 'Datei nicht gefunden.');
  const rel = copyToScratch(u, f);
  send(res, 200, { chatUrl: chatUrl(`Ich habe dir die Datei \`${rel}\` in dein Arbeitsverzeichnis gelegt („${f.name}“). Lies sie und sag mir kurz, was drinsteht.`) });
});

on('GET', /^\/api\/chats\/shared$/, async (req, res) => {
  const u = await needUser(req);
  send(res, 200, { withMe: await chatsSharedWithMe(u), byMe: await chatsSharedByMe(u) });
});

on('POST', /^\/api\/chats\/([A-Za-z0-9_-]{6,64})\/copy$/, async (req, res, m) => {
  const u = await needUser(req);
  const c = await copySharedChat(u, m[1]);
  send(res, 200, { ...c, chatUrl: chatUrl(`${c.owner} hat den Chat „${c.title}“ mit mir geteilt. Der Verlauf liegt als \`${c.file}\` in deinem Arbeitsverzeichnis. Lies ihn und mach mit mir dort weiter, wo er aufhört — als neue, eigene Unterhaltung.`) });
});

on('GET', /^\/api\/sharelog$/, async (req, res) => {
  const u = await needUser(req);
  const all = readShareLog(500);
  send(res, 200, { entries: u.role === 'ADMIN' ? all : all.filter((e: any) => e.actor === u.email || e.target === u.email) });
});

// --- Task-Hygiene und Kontext ---

on('GET', /^\/api\/hygiene$/, async (req, res) => {
  const u = await needUser(req);
  send(res, 200, { ...(await hygieneOf(u)), eodUrl: chatUrl('Tagesabschluss', { spec: 'vorlage-tagesabschluss' }) });
});

on('POST', /^\/api\/hygiene\/([A-Z][A-Z0-9]+-\d+)\/snooze$/, async (req, res, m) => {
  const u = await needUser(req);
  await snoozeItem(u, m[1]);
  send(res, 200, { ok: true });
});

on('POST', /^\/api\/hygiene\/([A-Z][A-Z0-9]+-\d+)\/answer$/, async (req, res, m) => {
  const u = await needUser(req);
  const b = await body(req);
  if (b.confirm !== true) {
    const p = await proposeFromAnswer(u, m[1], String(b.text ?? ''));
    if (p.snooze) { await snoozeItem(u, m[1]); return send(res, 200, { snoozed: true }); }
    return send(res, 200, { needsConfirm: true, ...p });
  }
  const actions = Array.isArray(b.actions) ? b.actions : [];
  if (!actions.length) throw new HttpError(400, 'Keine Aktion.');
  const done = await jiraWrite(u, () => applyActions(u, m[1], actions));
  log('hygiene write', { user: u.id, key: m[1], n: done.length });
  send(res, 200, { ok: true, done });
});

on('GET', /^\/api\/context$/, async (req, res) => {
  const u = await needUser(req);
  send(res, 200, await contextStats(u));
});

// --- intern: nur für die Brücke und ihre Werkzeuge (Header mit WERKBANK_INTERNAL_TOKEN) ---

async function internalUser(req: IncomingMessage, b: any): Promise<User> {
  const want = Buffer.from(process.env.WERKBANK_INTERNAL_TOKEN ?? '');
  const got = Buffer.from(String(req.headers['x-werkbank-internal'] ?? ''));
  if (!want.length || want.length !== got.length || !timingSafeEqual(want, got)) throw new HttpError(403, 'Nicht erlaubt.');
  const u = await userById(String(b.userId ?? ''));
  if (!u || !allowed(u.email)) throw new HttpError(403, 'Konto nicht freigeschaltet.');
  return u;
}

on('POST', /^\/internal\/session-start$/, async (req, res) => {
  const b = await body(req);
  const u = await internalUser(req, b);
  const r = await sessionStart(u, String(b.conv ?? ''), { eod: b.eod === true, skills: b.skills });
  log('kontext', { user: u.id, tokens: r.tokens, cached: r.cached, slot: r.slot, questions: r.questions.length });
  send(res, 200, r);
});

on('POST', /^\/internal\/measure$/, async (req, res) => {
  const b = await body(req);
  const u = await internalUser(req, b);
  await recordMeasure(u, String(b.conv ?? ''), b.measured);
  send(res, 200, { ok: true });
});

// Nutzung je Skill (Knut, 29.09.: nach einer Woche den Skill-Kern mit echten Zahlen nachschärfen).
on('POST', /^\/internal\/skill-used$/, async (req, res) => {
  const b = await body(req);
  const u = await internalUser(req, b);
  const skill = String(b.skill ?? '');
  if (!/^[\w:.-]{1,80}$/.test(skill)) throw new HttpError(400, 'Ungültiger Skill.');
  await wb().collection('skill_usage').updateOne({ _id: skill as any }, { $inc: { count: 1 }, $addToSet: { users: u.id }, $set: { lastUsed: new Date() }, $setOnInsert: { since: new Date() } }, { upsert: true });
  send(res, 200, { ok: true });
});

on('POST', /^\/internal\/hygiene$/, async (req, res) => {
  const u = await internalUser(req, await body(req));
  send(res, 200, await hygieneOf(u));
});

on('POST', /^\/internal\/hygiene-snooze$/, async (req, res) => {
  const b = await body(req);
  const u = await internalUser(req, b);
  await snoozeItem(u, String(b.key ?? ''));
  send(res, 200, { ok: true });
});

on('POST', /^\/internal\/jira-update$/, async (req, res) => {
  const b = await body(req);
  const u = await internalUser(req, b);
  const key = String(b.key ?? '');
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key)) throw new HttpError(400, 'Ungültiger Schlüssel.');
  if (!(await allIssues()).some((i) => i.key === key)) throw new HttpError(404, 'Ticket nicht in der Jira-Kopie (nur bestehende Tickets, keine neuen).');
  const actions: any[] = [];
  if (b.comment) actions.push({ type: 'comment', text: String(b.comment) });
  if (b.status) actions.push({ type: 'status', to: String(b.status) });
  if (b.due !== undefined && b.due !== null) actions.push({ type: 'due', date: String(b.due) || null });
  if (!actions.length) throw new HttpError(400, 'Nichts zu tun.');
  // Die Bestätigung ist schon passiert: die Brücke fragt vor jedem jira_update im Chat nach ("ja").
  const done = await jiraWrite(u, () => applyActions(u, key, actions));
  log('jira write (chat)', { user: u.id, key, n: done.length });
  send(res, 200, { ok: true, done });
});

// Die Brücke hat im Chat einen schreibenden Atlassian-Aufruf gesehen (Kommentar, Status, Anlegen …): diese Tickets
// sofort in die Kopie holen — refreshIssue schiebt die Änderung an offene Board-/Sprint-Seiten.
on('POST', /^\/internal\/jira-touched$/, async (req, res) => {
  const b = await body(req);
  const u = await internalUser(req, b);
  const prefix = cfg.jiraProject + '-';
  const keys = [...new Set((Array.isArray(b.keys) ? b.keys : []).map(String))].filter((k) => /^[A-Z][A-Z0-9]+-\d+$/.test(k) && k.startsWith(prefix)).slice(0, 10);
  const creds = (await jiraCreds(u)) ?? (await jiraCreds(null));
  const done: string[] = [];
  if (creds) for (const k of keys) { try { await refreshIssue(creds, k); done.push(k); } catch (e: any) { log('jira nachziehen', { key: k, error: String(e.message).slice(0, 120) }); } }
  log('jira im chat geschrieben', { user: u.id, keys: done, tool: String(b.tool ?? '').slice(0, 80) });
  send(res, 200, { ok: true, refreshed: done });
});

// ---------- Statische Dateien ----------

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

function serveStatic(req: IncomingMessage, res: ServerResponse, path: string) {
  let base = DIST, rel = path;
  if (path.startsWith('/fonts/')) { base = FONTS; rel = path.slice(6); }
  const abs = resolve(base, '.' + normalize(decodeURIComponent(rel)));
  const ok = abs.startsWith(base) && existsSync(abs) && statSync(abs).isFile();
  const file = ok ? abs : join(DIST, 'index.html');
  if (!existsSync(file)) { res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Oberfläche nicht gebaut: cd web && npm run build'); return; }
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': file.includes('/assets/') || file.startsWith(FONTS) ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'x-frame-options': 'SAMEORIGIN',
    'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'",
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

// ---------- Server ----------

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  try {
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/internal/')) {
      for (const [method, re, h] of routes) {
        const m = url.pathname.match(re);
        if (m && method === req.method) return await h(req, res, m, url);
      }
      throw new HttpError(404, 'Nicht gefunden.');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Nicht erlaubt.');
    serveStatic(req, res, url.pathname);
  } catch (e: any) {
    const status = e.status ?? (e instanceof JiraError ? 502 : 500);
    const known = e instanceof JiraError || e instanceof JiraWriteError;
    if (status >= 500) log('fehler', { path: url.pathname, error: String(e.message ?? e).slice(0, 300) });
    if (!res.headersSent) send(res, status, { error: status >= 500 && !known ? 'Interner Fehler.' : e.message, ...(e instanceof JiraWriteError ? { code: e.code } : {}) });
    else res.end();
  }
});

// ---------- Hintergrund: Vault-Index, Jira-Kopie, Chat-Freigaben ----------

async function backgroundJobs() {
  const vaultTick = async () => { try { invalidateIndex(); await reindex(vaultIdx()); } catch (e: any) { log('suche', { error: String(e.message).slice(0, 200) }); } };
  setTimeout(vaultTick, 2000);
  setInterval(vaultTick, 10 * 60_000);
  // Änderungen am Vault: gebündelt nach 20 s neu indizieren.
  let t: NodeJS.Timeout | null = null;
  try {
    const w = watch(cfg.vaultDir, { recursive: true }, (_ev, f) => {
      if (!f || !String(f).endsWith('.md')) return;
      if (t) clearTimeout(t);
      t = setTimeout(vaultTick, 20_000);
    });
    // Fehler kommen später als Ereignis (z. B. ENOSPC, wenn die Dateibeobachter des Systems aufgebraucht
    // sind — Node beobachtet rekursiv je Datei). Ohne Handler reißt das den ganzen Server mit (29.09.2026).
    // Dann ohne Beobachtung weiter: das 10-Minuten-Intervall hält den Index trotzdem aktuell.
    w.on('error', (e: any) => {
      log('vault-beobachtung aus', { code: e?.code, error: String(e?.message ?? e).slice(0, 200) });
      try { w.close(); } catch { /* schon zu */ }
    });
  } catch { /* ohne Beobachtung reicht das Intervall */ }

  // Jira-Kopie: Vollabgleich alle 15 min (mit Löschschutz), inkrementell jede Minute. Fehlt der Zugang, steht das als
  // Fehler in meta.jira_sync (rot am Board) statt still auszufallen.
  const noJobs = () => cfg.demo && !process.env.WERKBANK_JIRA_BASE;
  const credsOrError = async () => {
    const creds = await jiraCreds(null);   // Pilot: Vaultwarden der VM; sonst nur auf Knopfdruck
    if (!creds) await recordSyncError('zugang', 'Kein Jira-Zugang für den automatischen Abgleich (Vaultwarden-Sitzung der VM fehlt oder ist abgelaufen) — die Kopie veraltet. „Jetzt synchronisieren“ geht mit dem eigenen Token.');
    return creds;
  };
  const jiraTick = async () => {
    if (noJobs()) return;
    try {
      const creds = await credsOrError();
      if (!creds) return;
      const r = await syncMirror(creds, 'Intervall');
      log('jira sync', { count: r.count, removed: r.removed });
    } catch (e: any) { log('jira sync', { error: String(e.message).slice(0, 200) }); }
  };
  setTimeout(jiraTick, 5000);
  setInterval(jiraTick, cfg.jiraSyncMinutes * 60_000);
  const incTick = async () => {
    if (noJobs()) return;
    try {
      const creds = await credsOrError();
      if (!creds) return;
      const r = await syncIncremental(creds, cfg.jiraIncMinutes * 2);
      if (r?.keys.length) log('jira inkrementell', { n: r.keys.length });
    } catch (e: any) { log('jira inkrementell', { error: String(e.message).slice(0, 200) }); }
  };
  if (cfg.jiraIncMinutes > 0) setInterval(incTick, cfg.jiraIncMinutes * 60_000);

  // PR-Review live: offene PRs der Organisation alle 5 Minuten (nur lesend).
  const ghTick = async () => {
    if (cfg.demo && !process.env.WERKBANK_GITHUB_API) return;
    try { const r = await syncGithub(await githubReadToken()); if (r?.changed) log('github', { count: r.count, changed: r.changed }); }
    catch (e: any) { log('github', { error: String(e.message).slice(0, 200) }); }
  };
  setTimeout(ghTick, 8000);
  setInterval(ghTick, Number(process.env.WERKBANK_GITHUB_MIN || 5) * 60_000);

  const shareTick = async () => { try { await watchChatShares(); } catch (e: any) { log('freigaben', { error: String(e.message).slice(0, 200) }); } };
  setTimeout(shareTick, 3000);
  setInterval(shareTick, 60_000);
}

await connect();
mkdirSync(cfg.dataDir, { recursive: true });
server.listen(cfg.port, cfg.host, () => log('listening', { host: cfg.host, port: cfg.port, demo: cfg.demo, vault: cfg.vaultDir }));
if (process.env.WERKBANK_NO_JOBS !== '1') backgroundJobs();
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { server.close(); process.exit(0); });
