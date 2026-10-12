// OLAF-Werkbank Web-App (Port 3070): Einrichtung, Wissen, Board, Sprint, Skills, Dateien & Teilen.
// Kein Framework: node:http, JSON-API unter /api, die Oberfläche (Vite/React) aus web/dist.
// Schreibende Aufrufe brauchen eine Sitzung, den Header "x-werkbank: 1" (gegen CSRF) und — wo sie
// den Vault oder Jira ändern — "confirm: true" im Body, den die Oberfläche erst nach dem
// Bestätigungsdialog setzt. Ohne confirm liefern sie nur die Vorschau.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream, writeFileSync, mkdirSync, watch } from 'node:fs';
import { join, extname, resolve, normalize, basename } from 'node:path';
import { execFile } from 'node:child_process';
import YAML from 'yaml';
import { cfg, WEB_DIR, WB_ROOT, sprintRoot, browseUrl } from './config.ts';
import { connect, wb, lc } from './db.ts';
import { librechatLogin, createSession, destroySession, currentUser, allowed, teammates, userById, type User } from './auth.ts';
import { listClaudeAccounts, addClaudeAccount, removeClaudeAccount, reorderClaudeAccounts, claudeAccountToken, claudeAccountsForBridge } from './creds.ts';
import { claudeStatus, setClaudeToken, removeClaudeToken, getClaudeToken, jiraCreds, githubReadToken, jiraIdentity, jiraStatus, setJiraCreds, removeJiraCreds, markJiraWrite } from './creds.ts';
import { getIndex, readNote, tree, roadmap, teams, invalidateIndex, parseFrontmatter } from './vault.ts';
import { reindex, search, searchState } from './search.ts';
import { syncMirror, syncIncremental, recordSyncError, boardModel, refreshIssue, addComment, transitionTo, transitions, setDueDate, jiraFetch, isOverdue, isRecurring, JiraError, type Issue } from './jira.ts';
import { startAgentRun, chatUrl, ticketPrompt, startChatAgent, refreshChatRuns, replyInChat } from './agent.ts';
import { parseReview, reviewQueue, reviewComment, END_TEXT, markValid } from './review.ts';
import { startOrch, listOrch, showOrch, sendOrch, reviewOrch, startAutoWeiter, startStatusTick, askKnut, listQuestions, getQuestion, answerQuestion, withdrawQuestion, runs as orchRuns, strandStates, nachtbau, g0Blocked, g0Repos, injectBridge, injectStateBridge } from './orchestrator.ts';
import { pruefe, protokolliere, g0Text, g0Optionen, vorbauAus, type VorbauErgebnis } from './vorbau.ts';
import { startLeitstand, startLeitstandTick, leitstandLine, overview, strandCards, handoverDraft } from './leitstand.ts';
import { readBericht, paketDatei } from './bericht.ts';
import { assignProject, workstreamArea, syncWorkstreamOverview } from './projects.ts';
import { ingestSessions } from './agentfiles.ts';
import { ARTEN, folders, schemaName, ortAus, vorschlagAusPfad, isEingang } from './ablage.ts';
import { ablageOwner, syncAblage, lastSyncAt } from './ablagesync.ts';
import { listPakete, paketFile, renderPaketMd, strandFor, BILD_MIME } from './reviewpakete.ts';
import { FEATURES, featuresFor, blockedFeature } from './features.ts';
import { memoryWarning } from './memory.ts';
import { ablegen, migrateLegacy, placeInfo, suggestFor } from './einsortieren.ts';
import { keep as keepScratch, runScratch } from './scratch.ts';
import { backupRunning, listBackups, nightly, writeBackup, keyOf } from './backup.ts';
import { listCycles, parseQuestions, parseGoal, parseOutcomes, applyAnswer, hashText, newCycleFiles, parsePackages, reviewDraftVars, carryList, currentCycle, isDone, syncPlanRows, isNoop, realOutcomes, viennaToday } from './sprint.ts';
import { runSyncPlan, proposalsFor, type Proposal } from './syncplan.ts';
import { listSkills, syncSkills } from './skills.ts';
import { saveUpload, listFiles, fileFor, filePath, shareFile, deleteFile, copyToScratch, chatsSharedWithMe, chatsSharedByMe, copySharedChat, watchChatShares, readShareLog, logShare, scratchDir } from './sharing.ts';
import { log } from './log.ts';
import { hygieneOf, snoozeItem, sessionStart, contextStats, proposeFromAnswer, applyActions, hygieneAll, allIssues, recordMeasure } from './assist.ts';
import { timingSafeEqual } from 'node:crypto';
import { writeJira, checkMcp, mcpState, writeMode, JiraWriteError, dryRun, describe, canWriteJira, type JiraAction } from './jirawrite.ts';
import { jiraEventStream, jiraChanged, roadmapChanged } from './events.ts';
import { buildFeed, prLinks, newQueue, takeDue, parseSyncQuestions, doneIds, notDone, textKey, renderApprovals, replaceWorkBlock, draftBody, feedPath, approvalsPath, writeAtomic, readOr, mtime, startVaultSync, syncLocked, type Approval } from './roadmapauto.ts';
import { syncGithub, livePrs, GH_ORG } from './github.ts';
import { attachLocal, setGoal, resetGoal, setSprint, goalHistory, assignments, goalsToJira, autoSetGoal } from './local.ts';
import { moveActions, describeMove } from '../src/boardMove.ts';
import { cleanBlock, carryOver, daySummary, sortMyTickets, nextDay } from './timebox.ts';
import { isMine, resolveIdentity, vienna } from './hygiene.ts';
import { ObjectId } from 'mongodb';
import { suggestTickets, addJiraFrontmatter } from './links.ts';
import { ansetzenMode, specGate, sprintEnd, ticketDraft, localDuplicates, dupJql, simJira, liveJira, runAnsetzen, specTicketState, specSlug, view as ansetzenView, draftHashOf, addSimField, DEFAULT_WORKSTREAM, type AnsetzenJira, type Dup } from './ansetzen.ts';
import { collectDecisions, todayQuestions, todayPayload } from './fragen.ts';
import { parseDecisions, fillDecision, parseRankTable, parseReasons, prRefs, parsePrRegister, parseCheck, addRankProposal, roadmapInsights, KANBAN_STATES, specChecks, specTemplate } from './roadmap.ts';
import { inSprint, goalsOf, sprintLabel, goalLabel, labelCfg, parseGoalsFile, goalTree, sprintGoalsFromOutcomes, sprintTag, valueOf, GOAL_ID, needsGoal, effectiveGoals, exemptLabel, goalLevel, sameLevelRemovals, ownGoals, rule1Goals, specProposals, autoEligible, type GoalNode } from './goals.ts';

const DIST = join(WEB_DIR, 'dist');
// Vorschau-Instanz: WERKBANK_DRYRUN=1 schaltet Jira- und Vault-Schreiben auf Trockenlauf (zeigen statt schreiben).
const specCreate = () => process.env.WERKBANK_SPEC_CREATE === 'on';   // „Neue Spec“: Standard aus (Knut, 30.09.)
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
  if (isMutation(req) && req.headers['x-werkbank'] !== '1') throw new HttpError(403, 'Fehlender Workspace-Header.');
  // Freigabe je Funktion fürs Team (features.ts): Admins alles, sonst WERKBANK_TEAM_FEATURES.
  const f = blockedFeature(u, String(req.url ?? '').split('?')[0]);
  if (f) throw new HttpError(403, `„${FEATURES.find((x) => x.id === f)!.label}“ ist für das Team noch nicht freigegeben.`);
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
  // Jira-Kopie + Werkbank-Zuordnung (Ziel/Sprint lokal, Runde 7).
  const all = await attachLocal((await wb().collection('jira_issues').find({}, { projection: { _id: 0 } }).toArray()) as unknown as Issue[]);
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
  const files = (await wb().collection('files').find({ tickets: key, $or: [{ owner: u.id }, { sharedWith: u.id }] }, { projection: { name: 1, size: 1, ownerName: 1, createdAt: 1, kind: 1, vaultPath: 1 } }).toArray())
    .map((f: any) => ({ id: f._id, name: f.name, size: f.size, ownerName: f.ownerName, createdAt: f.createdAt, vaultPath: f.kind === 'vault' ? f.vaultPath : undefined }));
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
    if (!dryRun()) await markJiraWrite(u, true);   // Trockenlauf beweist kein Schreibrecht
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

/** Vorzyklus = neuester Zyklus mit früherem Startdatum (auch archiviert). */
function previousCycle(date: string) {
  return cycles().filter((x) => x.date < date).sort((a, b) => b.date.localeCompare(a.date))[0];
}

/** Arbeitspakete der Review-Notiz mit Ticketstand aus der Kopie (Schritt 2: Updates je Paket). */
function packagesOf(text: string, im: Map<string, Issue>) {
  const today = viennaToday();
  return parsePackages(text).map((p) => ({
    ...p,
    tickets: p.tickets.map((k) => {
      const i = im.get(k);
      return i ? { key: k, summary: i.summary, status: i.status, done: isDone(i), owner: (i.assignee ?? '').split(' ')[0] || null, overdue: !isDone(i) && !!i.duedate && i.duedate < today } : { key: k, missing: true };
    }),
  }));
}

/** Review-Entwurf + Vorlagen für einen Zyklus (Schritt 1). Schreibt nichts. */
async function prepareCycle(date: string) {
  const prev = previousCycle(date);
  const im = await issueMap();
  const sync: any = await wb().collection('meta').findOne({ _id: 'jira_sync' as any });
  const rd = (f?: string) => (f ? readFileSync(f, 'utf8') : undefined);
  const { vars, stats } = im.size
    ? reviewDraftVars({ date, prevId: prev?.id, prevReview: rd(prev?.files.review), prevPlanning: rd(prev?.files.planning), issues: im, today: viennaToday(), syncedAt: sync?.at ? new Date(sync.at).toISOString() : null })
    : { vars: {}, stats: null };
  const files = newCycleFiles(TEMPLATES, date, prev?.id, vars);
  return { prev, files, stats, empty: !im.size };
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
      // Offene Notizen für den Write-back (wie jira-sync-plan.sh): Schritt 4/5 der Schrittleiste.
      openNotes: syncPlanRows(qs).filter((r) => r.kind !== 'carry' && !isNoop(r.payload)).length,
      ...(k === 'review' ? { packages: packagesOf(text, im) } : {}),
    };
  }
  const today = new Date().toISOString().slice(0, 10);
  const open = [...im.values()].filter((i) => i.type !== 'Workstream' && i.status !== 'Done');
  const sync: any = await wb().collection('meta').findOne({ _id: 'jira_sync' as any });
  const prev = previousCycle(c.date);
  return {
    cycle: { id: c.id, date: c.date, archived: c.archived, current: currentCycle(cycles())?.id === c.id },
    previous: prev ? { id: prev.id, outcomes: prev.files.planning ? realOutcomes(parseOutcomes(readFileSync(prev.files.planning, 'utf8'))) : [], goal: prev.files.planning ? parseGoal(readFileSync(prev.files.planning, 'utf8')).goal ?? null : null } : null,
    ...goalsView(c, files, im),
    files,
    overdue: open.filter((i) => isOverdue(i, today)).sort((a, b) => a.duedate!.localeCompare(b.duedate!)),
    undated: open.filter((i) => !i.duedate && !isRecurring(i)),
    jiraSync: sync ? { at: sync.at, count: sync.count } : null,
  };
}


// ---------- Ziele & Sprint (Zielbaum, Im Sprint, Kandidaten) ----------

const GOALS_FILE = () => process.env.WERKBANK_GOALS_FILE || 'olaf/1-Projects/ziele-olaf.md';
const tinyIssue = (i: Issue, im?: Map<string, Issue>, known?: Set<string>) => ({ noGoal: im ? needsGoal(i, im, known) : undefined, exempt: im ? effectiveGoals(i, im, known).exempt : undefined, key: i.key, summary: i.summary, status: i.status, statusCategory: i.statusCategory, assignee: i.assignee, duedate: i.duedate, type: i.type, labels: i.labels ?? [], goals: ownGoals(i), overdue: isOverdue(i), blockedBy: i.blockedBy ?? [] });
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
  const known = new Set(byId.keys());
  const eff = (i: Issue) => effectiveGoals(i, im, known).goals;
  const groups = sprintGoals.map((g) => ({ goal: { id: g.id, result: g.result }, tickets: members.filter((i) => eff(i).includes(g.id) || g.tickets.includes(i.key)).map((i) => tinyIssue(i, im, known)) }));
  const otherGoal = members.filter((i) => !groups.some((gr) => gr.tickets.some((t) => t.key === i.key)) && eff(i).length);
  const noGoal = members.filter((i) => !groups.some((gr) => gr.tickets.some((t) => t.key === i.key)) && !eff(i).length);   // inkl. „bewusst ohne“ (Chip)
  // Kandidaten: Mitnahme (→ mitnehmen mit Ticket), Tickets der Sprintziele/Monatsziele, überfällige, Top-Rang-Specs — nicht im Sprint.
  const why = new Map<string, Set<string>>();
  const add = (k: string, w: string) => { const i = im.get(k); if (!i || i.type === 'Workstream' || i.status === 'Done' || i.statusCategory === 'done' || inSprint(i, c.date)) return; if (!why.has(k)) why.set(k, new Set()); why.get(k)!.add(w); };
  for (const f of Object.values(files)) for (const q of f.questions ?? []) if (q.ticket && q.answers.some((a: any) => a.kind === 'carry')) add(q.ticket, 'Mitnahme');
  for (const g of [...sprintGoals, ...monthGoals]) for (const k of [...g.tickets, ...g.labelTickets]) add(k, `Ziel ${g.id}`);
  for (const i of issues) if (isOverdue(i)) add(i.key, 'überfällig');
  const idx = vaultIdx();
  const nameToPath = new Map([...idx.notes.values()].map((n) => [n.name, n]));
  for (const r of parseRankTable(readVault(`${OVERVIEW}/priorisierung-roadmap-produkt-olaf.md`)).filter((r) => r.rank <= 10)) {
    for (const k of nameToPath.get(r.spec)?.tickets ?? []) add(k, `Rang ${r.rank}`);
  }
  const candidates = [...why.entries()].map(([k, w]) => ({ ...tinyIssue(im.get(k)!, im, known), why: [...w] }))
    .sort((a, b) => Number(b.why.includes('Mitnahme')) - Number(a.why.includes('Mitnahme')) || b.why.length - a.why.length || a.key.localeCompare(b.key, 'de', { numeric: true }));
  return {
    goals: {
      file: GOALS_FILE(), missing: !text, roots: roots.map(stripTree), gate: roots.filter((r) => r.level === 'Gate').map((r) => ({ id: r.id, result: r.result })),
      sprintGoals: sprintGoals.map(stripTree), monthGoals: monthGoals.map(stripTree),
      labels: { sprint: label, goalPrefix: labelCfg().goalPrefix, sprintPrefix: labelCfg().sprintPrefix },
      goalIds: [...byId.values()].filter((n) => n.level !== 'Gate').map((n) => ({ id: n.id, level: n.level, result: valueOf(n.result) ?? n.id })),
    },
    inSprint: { label, count: members.length, groups, otherGoal: otherGoal.map((i) => tinyIssue(i, im, known)), noGoal: noGoal.map((i) => tinyIssue(i, im, known)) },
    candidates: candidates.slice(0, 60),
    dryRun: dryRun(),
  };
}

// ---------- Ziele: ganzer Baum, Zuordnung, Deep-Dive (Runde 6) ----------

/** Zielbaum aus ziele-olaf.md + Sprintzielen des aktuellen Planning. */
function goalsAll(im: Map<string, Issue>) {
  const text = readVault(GOALS_FILE());
  const parsed = text ? parseGoalsFile(text) : { goals: [], ratings: [] };
  const cur = currentCycle(cycles());
  let sprintRows: ReturnType<typeof sprintGoalsFromOutcomes> = [];
  if (cur?.files.planning) { try { sprintRows = sprintGoalsFromOutcomes(parseOutcomes(readFileSync(cur.files.planning, 'utf8')), cur.date); } catch { /* ohne */ } }
  const t = goalTree([...parsed.goals, ...sprintRows], parsed.ratings, [...im.values()]);
  return { ...t, ratings: parsed.ratings, missing: !text, cur };
}

const knownGoals = (g: { byId: Map<string, GoalNode> }) => new Set([...g.byId.keys()]);

const PROPOSALS = () => process.env.WERKBANK_GOAL_PROPOSALS || join(cfg.dataDir, 'ziel-vorschlag.json');

/** Vorschlagsdatei {key, ziel, begruendung, sicherheit} (Liste oder {vorschlaege: […]}) → key → Vorschlag. */
function loadProposals(): { map: Map<string, { ziel: string; begruendung: string; sicherheit: any }>; file: string; error: string | null } {
  const file = PROPOSALS();
  const map = new Map<string, any>();
  if (!existsSync(file)) return { map, file, error: null };
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    const list = Array.isArray(j) ? j : j.vorschlaege ?? j.proposals ?? j.items ?? [];
    for (const x of list) {
      const key = String(x.key ?? '').trim();
      let ziel = String(x.ziel ?? x.goal ?? '').trim();
      const pre = labelCfg().goalPrefix;
      if (ziel.toLowerCase().startsWith(pre)) ziel = ziel.slice(pre.length);
      ziel = ziel.toUpperCase();
      if (/^[A-Z][A-Z0-9]+-\d+$/.test(key) && (GOAL_ID.test(ziel) || ziel === 'KEINS')) map.set(key, { ziel, begruendung: String(x.begruendung ?? x.reason ?? '').slice(0, 500), sicherheit: x.sicherheit ?? x.confidence ?? null });
    }
    return { map, file, error: null };
  } catch (e: any) { return { map, file, error: `Vorschlagsdatei nicht lesbar: ${String(e.message).slice(0, 120)}` }; }
}

const wsName = (im: Map<string, Issue>, k?: string | null) => (k ? im.get(k)?.summary ?? k : 'Ohne Workstream');
const richIssue = (im: Map<string, Issue>, i: Issue, known?: Set<string>) => ({ ...tinyIssue(i, im, known), statusSince: i.statusSince ?? null, priority: i.priority, workstream: i.workstream ?? null, workstreamName: wsName(im, i.workstream), parent: i.parent, noGoal: needsGoal(i, im, known), recurring: isRecurring(i) });

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
    dryRun: dryRun(), vaultDryRun: vaultDry(), specCreate: specCreate(), features: featuresFor(u),
  });
});

on('POST', /^\/api\/login$/, async (req, res) => {
  if (req.headers['x-werkbank'] !== '1') throw new HttpError(403, 'Fehlender Workspace-Header.');
  const { email, password } = await body(req);
  if (!email || !password) throw new HttpError(400, 'E-Mail und Passwort angeben.');
  // Letzter Eintrag = vom Coder-Proxy angehängt (der erste ist vom Client frei wählbar).
  const ip = String(req.headers['x-forwarded-for'] ?? '').split(',').pop()!.trim() || req.socket.remoteAddress || undefined;
  const u = await librechatLogin(String(email), String(password), ip);
  if (!allowed(u.email)) throw new HttpError(403, 'Dein Konto ist für den OLAF Workspace noch nicht freigeschaltet (Pilot). Frag Knut.');
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

// --- Mehrere Claude-Konten (Knut, 06.10.2026): bei ausgeschöpftem Kontingent übernimmt das nächste ---
// Nie Tokens an den Browser oder ins Log: nur Name, die letzten 4 Zeichen, Herkunft und der Zustand aus der Brücke.

const bridgeInternal = { 'x-werkbank-internal': process.env.WERKBANK_INTERNAL_TOKEN ?? '' };

async function accountsView(u: User) {
  const list = await listClaudeAccounts(u);
  let exhausted: Record<string, number> = {};
  try {
    const r = await fetch(`${cfg.bridgeUrl}/internal/accounts-state?user=${encodeURIComponent(u.id)}`, { headers: bridgeInternal, signal: AbortSignal.timeout(1500) });
    if (r.ok) exhausted = ((await r.json()) as any).exhausted ?? {};
  } catch { /* Brücke nicht erreichbar: ohne Zustand */ }
  const now = Date.now();
  const accounts = list.map((a) => ({ ...a, exhaustedUntil: exhausted[a.id] > now ? exhausted[a.id] : null }));
  return { accounts, active: accounts.find((a) => !a.exhaustedUntil)?.id ?? null, max: 5 };
}

on('GET', /^\/api\/setup\/claude-accounts$/, async (req, res) => send(res, 200, await accountsView(await needUser(req))));

on('POST', /^\/api\/setup\/claude-accounts$/, async (req, res) => {
  const u = await needUser(req);
  const b = await body(req);
  const a = await addClaudeAccount(u, String(b.label ?? ''), String(b.token ?? ''));
  log('claude konto hinzugefügt', { user: u.id, konto: a.id });
  send(res, 200, { ok: true, account: a, ...(await accountsView(u)) });
});

on('PUT', /^\/api\/setup\/claude-accounts\/order$/, async (req, res) => {
  const u = await needUser(req);
  await reorderClaudeAccounts(u, (await body(req)).ids);
  send(res, 200, { ok: true, ...(await accountsView(u)) });
});

on('DELETE', /^\/api\/setup\/claude-accounts\/([\w-]{1,40})$/, async (req, res, m) => {
  const u = await needUser(req);
  await removeClaudeAccount(u, m[1]);
  log('claude konto entfernt', { user: u.id, konto: m[1] });
  send(res, 200, { ok: true, ...(await accountsView(u)) });
});

// Ein Konto testen: die Brücke macht einen Minimalzug mit genau diesem Token (ein kleiner Modellaufruf).
on('POST', /^\/api\/setup\/claude-accounts\/([\w-]{1,40})\/test$/, async (req, res, m) => {
  const u = await needUser(req);
  const token = await claudeAccountToken(u, m[1]);
  if (!token) throw new HttpError(404, 'Konto nicht gefunden.');
  let r: any;
  try {
    const resp = await fetch(`${cfg.bridgeUrl}/internal/account-test`, {
      method: 'POST', headers: { ...bridgeInternal, 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ userId: u.id, email: u.email, accountId: m[1] }), signal: AbortSignal.timeout(75_000),
    });
    r = await resp.json();
  } catch { throw new HttpError(502, 'Die Brücke antwortet nicht — Test nicht möglich.'); }
  log('claude konto getestet', { user: u.id, konto: m[1], ok: !!r.ok, error: r.error });
  send(res, 200, { ok: !!r.ok, error: r.error ?? null, resetsAt: r.resetsAt ? new Date(r.resetsAt).toISOString() : null });
});

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
  const annotated = all.map((i) => ({ ...i, hygiene: hyg.get(i.key) ?? [], agent: running.get(i.key) ?? null, goals: ownGoals(i) }));
  const curCycle = currentCycle(cycles());
  const sprintOnly = url.searchParams.get('sprint') === '1' && curCycle ? new Set(all.filter((i) => inSprint(i, curCycle.date)).map((i) => i.key)) : undefined;
  const filter = url.searchParams.get('filter') || undefined;
  const issues = annotated;
  const sync: any = await wb().collection('meta').findOne({ _id: 'jira_sync' as any });
  const model = boardModel(issues as Issue[], {
    owner: url.searchParams.get('owner') || undefined, filter,
    q: url.searchParams.get('q') || undefined, showDone: url.searchParams.get('done') === '1', keys: sprintOnly,
    knownGoals: knownGoals(goalsAll(new Map(all.map((i) => [i.key, i])))),
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
  const b = await body(req);
  // force: Löschschutz-Schwelle einmal übergehen (nach echtem Schrumpfen) — nur mit Bestätigung aus der Oberfläche.
  const force = b.force === true && b.confirm === true;
  if (force) log('jira sync erzwungen', { user: u.id });
  send(res, 200, await syncMirror(await needJira(u), u.email, { force }));
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
    issue: i, url: browseUrl(i.key), children, runs, hygiene: hygI.get(i.key) ?? [],
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

const PRIORITIES = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];

on('GET', /^\/api\/jira\/meta$/, async (req, res) => {
  await needUser(req);
  const im = await issueMap();
  const people = new Map<string, string>();
  for (const i of im.values()) if (i.assigneeId && i.assignee) people.set(i.assigneeId, i.assignee);
  const g = goalsAll(im);
  send(res, 200, {
    people: [...people.entries()].map(([accountId, name]) => ({ accountId, name })).sort((a, b) => a.name.localeCompare(b.name, 'de')),
    priorities: [...new Set([...PRIORITIES, ...[...im.values()].map((i) => i.priority).filter(Boolean) as string[]])],
    goalIds: [...g.byId.values()].filter((n) => n.level !== 'Gate').map((n) => ({ id: n.id, level: n.level, result: valueOf(n.result) ?? n.id })),
    exempt: exemptLabel(), goalPrefix: labelCfg().goalPrefix, dryRun: dryRun(),
  });
});

// Ticket bearbeiten (Priorität, Owner, Ziel-Label) — Vorschau ohne confirm, dann schneller Schreibweg (Trockenlauf in der Vorschau).
on('POST', /^\/api\/board\/issue\/([A-Z][A-Z0-9]+-\d+)\/edit$/, async (req, res, m) => {
  const u = await needUser(req);
  const b = await body(req);
  const im = await issueMap();
  const i = im.get(m[1]);
  if (!i) throw new HttpError(404, 'Ticket nicht in der Kopie.');
  const actions: JiraAction[] = [];
  if (b.priority !== undefined) {
    const known = new Set([...PRIORITIES, ...[...im.values()].map((x) => x.priority).filter(Boolean) as string[]]);
    if (!known.has(String(b.priority))) throw new HttpError(400, `Unbekannte Priorität „${b.priority}“.`);
    if (String(b.priority) !== i.priority) actions.push({ type: 'priority', name: String(b.priority) });
  }
  if (b.assignee !== undefined) {
    const acc = b.assignee ? String(b.assignee) : null;
    const name = acc ? [...im.values()].find((x) => x.assigneeId === acc)?.assignee : 'niemand';
    if (acc && !name) throw new HttpError(400, 'Unbekannte Person (nur Personen aus der Jira-Kopie).');
    if (acc !== (i.assigneeId ?? null)) actions.push({ type: 'assignee', accountId: acc, name: name ?? undefined });
  }
  // Ziel: lokal in der Werkbank (Runde 7), nicht als Jira-Label.
  let goal: string | null = null;
  if (b.goal !== undefined && b.goal !== '') {
    goal = String(b.goal).toUpperCase();
    const g = goalsAll(im);
    if (!g.byId.has(goal) || goalLevel(goal) === 'Gate') throw new HttpError(400, `Unbekanntes Ziel ${goal}.`);
  }
  if (!actions.length && !goal) return send(res, 200, { ok: true, nothing: true });
  const preview = `${i.key}: ${[...actions.map(describe), ...(goal ? [`Ziel → ${goal} (OLAF Workspace)`] : [])].join(' · ')}`;
  if (b.confirm !== true) return send(res, 200, { needsConfirm: true, preview, dryRun: dryRun() && actions.length > 0 });
  const done: string[] = [];
  if (goal) {
    const r: any = await assignGoals(u, [{ key: i.key, goal }], im, true);
    if (!r.results?.[0]?.ok) throw new HttpError(500, `Ziel nicht gespeichert: ${r.results?.[0]?.error ?? 'unbekannt'}`);
    done.push(`Ziel → ${goal} (OLAF Workspace)`);
  }
  const w = actions.length ? await jiraWrite(u, () => writeJira(u, i.key, actions)) : null;
  send(res, 200, { ok: true, preview, done: [...(w?.done ?? []), ...done], dryRun: w?.dryRun ?? false, calls: w?.calls, issue: (await issueMap()).get(i.key) ?? null });
});

/**
 * Agent als echter Chat auf einem Ticket — derselbe Weg für „Agent“ am Board, `agent_start` aus dem Chat
 * (Tagesabschluss) und „Agent ansetzen“ an einer Spec. Plan 81 (Schnitte 6/7): das Ticket bekommt sein Projekt
 * (zuordnen vor anlegen), der Agent den Bereich seines Workstreams im Vault für Plan und Notizen.
 */
async function startTicketAgent(u: User, i: Issue, note: string, place: { specPath?: string | null } = {}) {
  // Erst prüfen, ob schon ein Agent der Person auf der Karte arbeitet — sonst entstünde für einen abgelehnten Start
  // ein Projekt und ein Vault-Eintrag (Review).
  if (await wb().collection('agent_runs').findOne({ key: i.key, userId: u.id, mode: 'chat', status: { $in: ['läuft', 'wartet auf ja'] } })) {
    throw new HttpError(409, 'Auf diesem Ticket arbeitet schon ein Agent von dir — im Chat weitermachen.');
  }
  const im = await issueMap();
  const project = await assignProject(u, i).catch((e) => { log('projekt fehlgeschlagen', { key: i.key, error: String(e?.message ?? e).slice(0, 120) }); return null; });
  const ws = i.workstream ? im.get(i.workstream) : undefined;
  const areaDir = ws ? workstreamArea(ws)?.dir ?? null : null;
  if (ws) syncWorkstreamOverview(ws, im).catch((e) => log('workstream-übersicht fehlgeschlagen', { ws: ws.key, error: String(e?.message ?? e).slice(0, 120) }));
  return startChatAgent(u, i, note, 'work', { projectName: project?.name ?? null, areaDir, projectId: project?._id ?? null, personName: u.name, ...place });
}

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
  // Plan 81 (Schnitte 6/7): das Ticket bekommt sein Projekt (zuordnen vor anlegen), der Agent den Bereich seines
  // Workstreams im Vault für Plan und Notizen. Die Übersicht des Bereichs wird danach nachgezogen.
  if (b.mode !== 'draft') {
    const r = await startTicketAgent(u, i, String(b.note ?? '').slice(0, 2000));
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

/** Alle Specs der Roadmap (Thema/Zustand aus den Ordnern) mit Frontmatter, Tickets, PRs, Ziel (Frontmatter ziel:). */
function roadmapSpecs(local?: Map<string, { ziel: string | null }>) {
  const idx = vaultIdx();
  const rm = roadmap(idx, ROADMAP_BASE);
  const out: { name: string; title: string; path: string; topic: string; state: string; fm: Record<string, unknown>; tickets: string[]; prs: string[]; goals: string[]; goalVia: 'Werkbank' | 'ziel:' | null; text: string; overview?: string }[] = [];
  for (const t of rm.topics) for (const [state, specs] of Object.entries(t.states)) for (const sp of specs) {
    const n = idx.notes.get(sp.path);
    if (!n) continue;
    const text = readVault(sp.path);
    const z = n.fm.ziel;
    const goals = (Array.isArray(z) ? z : z != null ? String(z).split(/[,\s]+/) : []).map((x) => String(x).replace(/^ziel-/i, '').trim().toUpperCase()).filter((x) => GOAL_ID.test(x));
    const loc = local?.get(sp.path);
    const lg = loc && loc.ziel && GOAL_ID.test(loc.ziel) ? [loc.ziel] : null;   // lokal gewinnt; ohne lokale gilt ziel:
    out.push({ name: n.name, title: sp.title, path: sp.path, topic: t.name, state, fm: n.fm, tickets: n.tickets, prs: prRefs(text), goals: lg ?? goals, goalVia: lg ? 'Werkbank' : goals.length ? 'ziel:' : null, text, overview: t.overview });
  }
  return out;
}

// „Wartet auf dich“ (Heute): nur heute offene Vault-Fragen, jede einmal; überholte zum Aufräumen
// (docs/plan-heute-fragen-aktuell.md). Eigener Endpunkt, damit Heute nicht die ganze Roadmap samt GitHub lädt.
on('GET', /^\/api\/roadmap\/heute$/, async (req, res) => {
  await needUser(req);
  const idx = vaultIdx();
  const { decisions, texts } = collectDecisions(idx, readVault, ROADMAP_BASE);
  send(res, 200, todayPayload(todayQuestions(decisions, { texts, fm: (p) => idx.notes.get(p)?.fm, today: vienna().date })));
});

on('GET', /^\/api\/roadmap$/, async (req, res) => {
  const u = await needUser(req);
  const idx = vaultIdx();
  const im = await issueMap();
  const rm = roadmap(idx, ROADMAP_BASE);
  const byName = new Map<string, any>();
  const { decisions } = collectDecisions(idx, readVault, ROADMAP_BASE);
  const specPrs = new Map<string, string[]>();
  for (const t of rm.topics) {
    for (const [state, specs] of Object.entries(t.states)) {
      for (const sp of specs) {
        const text = readVault(sp.path);
        const ds = parseDecisions(text);
        const prs = prRefs(text);
        const n = idx.notes.get(sp.path)!;
        const tickets = n.tickets.map((k) => ({ key: k, status: im.get(k)?.status ?? null, summary: im.get(k)?.summary ?? null }));
        const info = { path: sp.path, name: n.name, title: sp.title, topic: t.name, state, status: sp.status ?? null, open: ds.filter((d) => d.open).length, prs, tickets, hash: hashText(text), verified: n.fm['last-verified'] ? String(n.fm['last-verified']).slice(0, 10) : null, jiraKey: n.fm.jira != null && String(n.fm.jira).trim() !== '' && String(n.fm.jira) !== '[]' };
        byName.set(n.name, info);
        for (const pr of prs) specPrs.set(pr, [...(specPrs.get(pr) ?? []), n.name]);
      }
    }
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
  const cur = currentCycle(cycles());
  const sprintTickets = new Set(cur ? [...im.values()].filter((i) => inSprint(i, cur.date)).map((i) => i.key) : []);
  const livePr = (pr: string) => { const l = gh.map.get(pr); return l ? { pr, conflict: l.mergeable === 'CONFLICTING', draft: l.isDraft, review: l.reviewDecision, turn: l.turn.who } : { pr, closed: ghOk }; };
  const specList = [...byName.values()].map((x) => ({ ...x, prLive: x.prs.map(livePr) }));
  const insights = roadmapInsights(specList, ranking, { sprintTickets });
  // Laufende Agenten je Ticket (Überblick: „In Arbeit“).
  const agents: Record<string, string> = {};
  for (const r of await wb().collection('agent_runs').find({ status: { $in: ['läuft', 'wartet auf ja'] } }, { projection: { key: 1, status: 1 } }).toArray() as any[]) if (r.key && agents[r.key] !== 'wartet auf ja') agents[r.key] = r.status;
  send(res, 200, {
    agents, admin: u.role === 'ADMIN',
    ...insights, kanbanStates: KANBAN_STATES, sprint: cur ? { id: cur.id, date: cur.date, tickets: sprintTickets.size } : null,
    base: ROADMAP_BASE, states: rm.states, overview: rm.overview,
    topics: rm.topics.map((t) => ({ name: t.name, overview: t.overview, states: Object.fromEntries(Object.entries(t.states).map(([st, specs]) => [st, specs.map((sp) => byName.get(idx.notes.get(sp.path)!.name))])) })),
    ranking, prs, decisions, github,
    hub: { path: `${OVERVIEW}/0-roadmap-produkt-olaf.md`, prio: `${OVERVIEW}/priorisierung-roadmap-produkt-olaf.md`, register: `${OVERVIEW}/pr-stand-produkt-olaf.md` },
    githubReadOnly: true,
  });
});

// --- Roadmap-Automatik (docs/plan-roadmap-automatik.md) ---

const VAULT_SYNC_SCRIPT = () => process.env.WERKBANK_VAULT_SYNC_SCRIPT || join(cfg.skillsTarget, 'olaf-produkt-roadmap', 'scripts', 'vault-sync.sh');
const SYNC_PROTOCOL = 'olaf/1-Projects/daily-debrief/vault-sync-protokoll.md';
const WORK_DRAFT = `${OVERVIEW}/entwurf-woran-wir-arbeiten.md`;
const HUB = `${OVERVIEW}/0-roadmap-produkt-olaf.md`;
const roadmapAutosync = () => process.env.WERKBANK_ROADMAP_AUTOSYNC !== '0';
const roadmapQueue = newQueue();
let roadmapPrimed = false;   // erster Durchlauf nach dem Start merkt sich nur den Stand (sonst alle alten Sitzungen auf einmal)
const firstName = (u: User) => u.name.trim().split(/\s+/)[0] ?? u.name;
const needAdmin = async (req: IncomingMessage) => {
  const u = await needUser(req);
  if (u.role !== 'ADMIN') throw new HttpError(403, 'Das dürfen nur Admins.');
  return u;
};

/** Werkbank-Stand für den Vault-Sync-Snapshot schreiben (Jira, Läufe, Projekte). */
async function writeRoadmapFeed() {
  const issues = (await wb().collection('jira_issues').find({}, { projection: { _id: 0, key: 1, summary: 1, status: 1, statusCategory: 1, assignee: 1, duedate: 1, updated: 1, type: 1, workstream: 1 } }).toArray()) as any[];
  const since = new Date(Date.now() - 3 * 86_400_000);
  const runsRaw = await wb().collection('agent_runs').find({ mode: 'chat', key: { $ne: null }, finishedAt: { $gte: since } }, { projection: { key: 1, projectId: 1, finishedAt: 1, startedAt: 1, written: 1, draft: 1 } }).toArray() as any[];
  const projects = await wb().collection('projects').find({}, { projection: { name: 1, workstream: 1, tickets: 1 } }).toArray() as any[];
  const pname = new Map(projects.map((p) => [String(p._id), p.name]));
  const vaultPrefix = cfg.vaultDir + '/';
  const runs = runsRaw.map((r) => ({
    key: r.key, projectName: r.projectId ? pname.get(String(r.projectId)) ?? null : null, finishedAt: r.finishedAt, startedAt: r.startedAt,
    vaultNotes: (r.written ?? []).filter((f: string) => f.startsWith(vaultPrefix) && f.endsWith('.md')).map((f: string) => f.slice(vaultPrefix.length)),
    // PR-Links aus den Notizen, die der Lauf geschrieben hat (Chat-Läufe haben keinen Antworttext in agent_runs).
    prs: [...new Set((r.written ?? []).filter((f: string) => f.startsWith(vaultPrefix) && f.endsWith('.md')).flatMap((f: string) => prLinks(readOr(f).slice(0, 200_000))))] as string[],
  }));
  writeAtomic(feedPath(), buildFeed({ now: new Date(), issues, runs, projects: projects.map((p) => ({ name: p.name, workstream: p.workstream ?? null, tickets: p.tickets ?? [] })) }));
}

/** Fertige Karten-Läufe dieser Person in die Warteschlange (einmal je neuer Aktivität der Sitzung). */
async function noteFinishedRuns(person: User, sessions: Array<{ conv: string; status: string; lastActivity?: number | null; written?: string[] }>) {
  for (const s of sessions) {
    if (s.status !== 'bereit' || !s.lastActivity) continue;
    const run: any = await wb().collection('agent_runs').findOne({ userId: person.id, conv: s.conv, mode: 'chat', key: { $ne: null } }, { sort: { startedAt: -1 } });
    if (!run || (run.roadmapSeenAt && run.roadmapSeenAt >= s.lastActivity)) continue;
    // lastActivity ist der Beginn der letzten Runde; „bereit“ heißt, sie ist vorbei.
    await wb().collection('agent_runs').updateOne({ _id: run._id }, { $set: { roadmapSeenAt: s.lastActivity, finishedAt: roadmapPrimed ? new Date() : new Date(s.lastActivity), written: s.written ?? run.written ?? [] } });
    // Nur Arbeitsläufe ziehen nach (ein „Besprechen“-Chat ändert nichts); nicht beim ersten Durchlauf nach dem Start.
    if (roadmapAutosync() && roadmapPrimed && run.kind !== 'discuss') roadmapQueue.pending.add(run.key);
  }
}

/** Offene Freigaben und verworfene Punkte neu in die Datei schreiben, die der Sync liest. */
async function writeApprovals() {
  const done = doneIds(readVault(SYNC_PROTOCOL));
  const col = wb().collection('roadmap_answers');
  if (done.size) await col.updateMany({ _id: { $in: [...done] as any[] }, done: { $ne: true } }, { $set: { done: true, doneAt: new Date() } });
  const open = (await col.find({ answer: 'ja', done: { $ne: true } }).sort({ at: 1 }).toArray()) as any[];
  const rejected = (await col.find({ answer: 'nein', at: { $gte: new Date(Date.now() - 30 * 86_400_000) } }).sort({ at: 1 }).toArray()) as any[];
  writeAtomic(approvalsPath(), renderApprovals(open.map((a): Approval => ({ id: String(a._id), text: a.text, at: new Date(a.at).toISOString(), by: a.by })), rejected.map((a) => a.text)));
  return open.length;
}

/** Startet, was fällig ist (Nachzug-Tickets oder voller Lauf nach „Ja“), wenn kein Sync läuft. */
async function tryStartSync(): Promise<boolean> {
  const due = takeDue(roadmapQueue, Date.now(), syncLocked());
  if (!due) return false;
  await writeRoadmapFeed().catch((e) => log('roadmap-feed', { error: String(e?.message ?? e).slice(0, 160) }));
  const ok = startVaultSync(VAULT_SYNC_SCRIPT(), due.scope, log);
  if (!ok) { if (due.scope) for (const k of due.scope) roadmapQueue.pending.add(k); else roadmapQueue.full = true; }
  roadmapChanged('nachzug');
  return ok;
}

/** „Wartet auf dich“ (früher „Für mich offen“ auf der Roadmap, jetzt auf „Heute“): PRs, Sync-Fragen, Entwurf, Tickets. */
async function mineFor(u: User, { write = true } = {}) {
  const me = firstName(u).toLowerCase();
  const prs = ((await wb().collection('github_prs').find({}, { projection: { _id: 0 } }).toArray()) as any[])
    .filter((p) => String(p.turn?.who ?? '').toLowerCase().split(/,\s*/).includes(me))
    .map((p) => ({ pr: p.pr, title: p.title, url: p.url, why: p.turn?.why, role: p.turn?.role }));
  const today = new Date().toISOString().slice(0, 10);
  const tickets = ((await wb().collection('jira_issues').find({ type: { $ne: 'Workstream' } }, { projection: { _id: 0, key: 1, summary: 1, status: 1, statusCategory: 1, assignee: 1, duedate: 1 } }).toArray()) as any[])
    .filter((i) => i.statusCategory !== 'Done' && i.status !== 'Done' && String(i.assignee ?? '').toLowerCase().split(/\s+/)[0] === me)
    .filter((i) => !i.duedate || i.duedate < today)
    .map((i) => ({ key: i.key, summary: i.summary, duedate: i.duedate, why: i.duedate ? 'überfällig' : 'ohne Datum' }))
    .sort((a, b) => String(a.duedate ?? '9').localeCompare(String(b.duedate ?? '9')));
  const admin = u.role === 'ADMIN';
  let questions: any[] = [], draft: any = null, section: string | null = null, pendingApprovals: any[] = [];
  if (admin) {
    if (write) writeApprovals().catch((e) => log('roadmap-freigaben', { error: String(e?.message ?? e).slice(0, 160) }));   // nicht warten: GET bleibt lesend schnell
    const protocol = readVault(SYNC_PROTOCOL);
    const qs = parseSyncQuestions(protocol);
    section = qs[0]?.section ?? null;
    const col = wb().collection('roadmap_answers');
    const answered = new Map(((await col.find({ _id: { $in: qs.map((q) => q.id) as any[] } }).toArray()) as any[]).map((a) => [String(a._id), a]));
    const rejectedKeys = new Set(((await col.find({ answer: 'nein' }, { projection: { key: 1 } }).toArray()) as any[]).map((a) => a.key).filter(Boolean));
    const done = doneIds(protocol);
    const failed = notDone(protocol);
    questions = qs.filter((q) => !done.has(q.id) && !rejectedKeys.has(q.key)).map((q) => ({ ...q, answer: answered.get(q.id)?.answer ?? null, failed: failed.get(q.id) ?? null }))
      .filter((q) => q.answer !== 'nein');
    // Freigaben, deren Frage nicht mehr im aktuellen Abschnitt steht und die noch nicht erledigt sind (Review 7).
    const shown = new Set(questions.map((q) => q.id));
    pendingApprovals = ((await col.find({ answer: 'ja', done: { $ne: true } }).sort({ at: 1 }).toArray()) as any[])
      .filter((a) => !shown.has(String(a._id)) && !done.has(String(a._id)))
      .map((a) => ({ id: String(a._id), text: a.text, at: a.at, by: a.by, failed: failed.get(String(a._id)) ?? null }));
    const text = readVault(WORK_DRAFT);
    if (text.trim()) {
      const hash = hashText(text);
      const st: any = await wb().collection('meta').findOne({ _id: 'roadmap_draft' as any });
      if (st?.hash !== hash) draft = { hash, body: draftBody(text), path: WORK_DRAFT, hubHasMarkers: replaceWorkBlock(readVault(HUB), 'x') !== null };
    }
  }
  return { me: firstName(u), admin, prs, tickets, questions, pendingApprovals, section, draft, autosync: roadmapAutosync(), queued: [...roadmapQueue.pending], syncRunning: syncLocked() };
}

on('GET', /^\/api\/roadmap\/mine$/, async (req, res) => send(res, 200, await mineFor(await needUser(req))));

// --- „Heute“ und Review-Schlange (docs/plan-heute-review-schlange.md) ---

// Brücke höchstens alle 30 s je Person fragen (K8): Zähler und Seite dürfen oft laden.
const runsRefreshedAt = new Map<string, number>();
async function refreshMine(u: User, force = false) {
  if (!force && Date.now() - (runsRefreshedAt.get(u.id) ?? 0) < 30_000) return;
  runsRefreshedAt.set(u.id, Date.now());
  await refreshChatRuns({ userId: u.id }).catch((e) => log('läufe nachziehen', { error: String(e?.message ?? e).slice(0, 120) }));
}

async function myQueue(u: User) {
  await refreshMine(u);
  const runs = await wb().collection('agent_runs').find({ userId: u.id, mode: 'chat', startedAt: { $gte: new Date(Date.now() - 30 * 864e5) } }).sort({ startedAt: -1 }).limit(200).toArray();
  const im = await issueMap();
  const vaultPrefix = cfg.vaultDir + '/';
  return reviewQueue(runs).map(({ r, bucket }) => ({
    id: String(r._id), key: r.key, summary: im.get(r.key)?.summary ?? null, bucket, url: r.url ?? null,
    review: markValid(r) ? r.review ?? null : null, reviewReadyAt: markValid(r) ? r.reviewReadyAt : null,
    question: r.status === 'wartet auf ja' ? r.question ?? null : null,
    end: r.endReason ?? null, endText: r.endReason ? END_TEXT[r.endReason] ?? r.endReason : null,
    startedAt: r.startedAt, endedAt: r.endedAt ?? null, rework: r.rework ?? null, commentedAt: r.commentedAt ?? null,
    // Geschriebene Dateien: Vault-Notizen als Pfad im Vault (Link ins Wissen), sonst nur der Dateiname.
    written: (r.written ?? []).slice(-8).map((f: string) => f.startsWith(vaultPrefix) ? { vault: f.slice(vaultPrefix.length) } : { name: f.split('/').pop() }),
  }));
}

/** Zähler für die Navigation: alles, was etwas von der Person will (laufende Agenten nicht). */
async function todayCount(u: User, queue?: any[], mine?: any, cards?: any[]) {
  const q = queue ?? await myQueue(u);
  const m = mine ?? await mineFor(u, { write: false });   // Zähler (alle 60 s): nur lesen, nie freigaben.md schreiben
  const h = await hygieneOf(u).catch(() => ({ items: [], snoozed: [] as string[] }));
  const hyg = h.items.filter((i: any) => !h.snoozed.includes(i.key)).length;
  const orch = (await listQuestions(u, { open: true }).catch(() => [])).length;   // Rückfragen des Orchestrators
  const strands = (cards ?? await strandCards(u).catch(() => [])).filter((c: any) => !c.running).length;   // fertige Stränge (nur Admins, nur Mongo — Teil B, F1)
  return strands + q.filter((x) => x.bucket !== 'laeuft').length + m.prs.length + m.questions.length + (m.pendingApprovals?.length ?? 0) + (m.draft ? 1 : 0) + hyg + orch;
}

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

on('GET', /^\/api\/today$/, async (req, res) => {
  const u = await needUser(req);
  const [queue, mine] = await Promise.all([myQueue(u), mineFor(u)]);
  const today = vienna().date;
  const im = await issueMap();
  const day = ((await tbCol().find({ userId: u.id, date: today }).sort({ start: 1 }).toArray()) as any[])
    .map((b) => ({ id: String(b._id), start: hhmm(b.start), end: hhmm(b.start + b.dur), title: b.title ?? null, key: b.key ?? null, summary: b.key ? im.get(b.key)?.summary ?? null : null, done: b.state === 'erledigt' }));
  const orchOpen = (await listQuestions(u, { open: true }).catch(() => [])).length;
  // Automatisch fortgesetzte Stränge (Plan auto-weiter, DoD 6): nur der Zähler aus Mongo, kein Abruf bei der Brücke.
  const cards = await strandCards(u, { detail: true }).catch(() => []);
  const carded = new Set(cards.map((c: any) => c.id));
  const orchAuto = (await wb().collection('orchestrator_runs').find({ userId: u.id, kind: { $ne: 'leitstand' }, reviewedAt: null, autoTotal: { $gt: 0 } }, { projection: { title: 1, url: 1, autoTotal: 1, autoStopped: 1 } }).sort({ autoLastAt: -1 }).limit(20).toArray().catch(() => []))
    .filter((r: any) => !carded.has(String(r._id)))   // keine Doppelung mit der Karte (F5)
    .map((r: any) => ({ id: String(r._id), title: r.title, url: r.url, n: r.autoTotal, stopped: !!r.autoStopped }));
  const g0 = await g0Blocked(u).catch(() => []);   // Nachtbau: von G0 gestoppte Stränge (blocked_g0)
  const memory = u.role === 'ADMIN' ? memoryWarning(log)?.warn ?? null : null;   // nur Admins (RAM-Plan 125)
  const leitstand = await leitstandLine(u).catch(() => null);   // nur Admins (Plan 132)
  send(res, 200, { queue, strands: cards, mine, day, today, orchOpen, orchAuto, g0, leitstand, memory, count: await todayCount(u, queue, mine, cards), dryRun: dryRun() });
});

on('GET', /^\/api\/today\/count$/, async (req, res) => send(res, 200, { count: await todayCount(await needUser(req)) }));

async function ownRun(u: User, id: string) {
  const run: any = await wb().collection('agent_runs').findOne({ _id: id as any });
  if (!run) throw new HttpError(404, 'Lauf nicht gefunden.');
  if (run.userId !== u.id) throw new HttpError(403, 'Das ist nicht dein Agentenlauf.');
  return run;
}

// „Passt“: als geprüft markieren; mit comment erst Vorschau, nach confirm genau ein Jira-Kommentar (E2: nie den Status).
on('POST', /^\/api\/runs\/([0-9a-f-]{36})\/passt$/, async (req, res, m) => {
  const u = await needUser(req);
  const b = await body(req);
  const run = await ownRun(u, m[1]);
  const runs = wb().collection('agent_runs');
  if (b.comment === true) {
    const text = reviewComment(firstName(u), run.review);
    if (b.confirm !== true) return send(res, 200, { needsConfirm: true, preview: `Kommentar auf ${run.key}: „${text}“`, text });
    // Idempotent (K6): ein zweiter Klick schreibt keinen zweiten Kommentar.
    const claim = await runs.updateOne({ _id: run._id, commentedAt: null }, { $set: { commentedAt: new Date() } });
    if (claim.modifiedCount) {
      try { await jiraWrite(u, () => writeJira(u, run.key, [{ type: 'comment', text }])); }
      catch (e) { await runs.updateOne({ _id: run._id }, { $set: { commentedAt: null } }); throw e; }
      log('review passt + kommentar', { user: u.id, key: run.key });
    }
  }
  await runs.updateOne({ _id: run._id }, { $set: { reviewedAt: new Date(), reviewedBy: u.email } });
  send(res, 200, { ok: true, commented: b.comment === true });
});

// Antwort in DENSELBEN Chat: Nacharbeit (Notiz, Lauf zurück), Antwort auf eine Rückfrage (ja/nein), „weiter“ nach „hängt“.
on('POST', /^\/api\/runs\/([0-9a-f-]{36})\/reply$/, async (req, res, m) => {
  const u = await needUser(req);
  if (dryRun()) throw new HttpError(409, 'Vorschau (Trockenlauf): Agenten und Chats sind hier aus.');
  const b = await body(req);
  await ownRun(u, m[1]);
  const kind = String(b.kind ?? '');
  if (!['nacharbeit', 'antwort', 'weiter'].includes(kind)) throw new HttpError(400, 'kind ist nacharbeit, antwort oder weiter.');
  const text = kind === 'weiter' ? 'weiter' : String(b.text ?? '').trim().slice(0, 4000);
  if (!text) throw new HttpError(400, kind === 'nacharbeit' ? 'Schreib kurz, was nachzuarbeiten ist.' : 'Leere Antwort.');
  await refreshChatRuns({ _id: m[1] });
  const run: any = await wb().collection('agent_runs').findOne({ _id: m[1] as any });
  if (run.status === 'läuft') throw new HttpError(409, 'Der Agent arbeitet gerade — warte, bis er fertig ist oder fragt.');
  if (kind === 'antwort' && run.status !== 'wartet auf ja') throw new HttpError(409, 'Die Rückfrage ist nicht mehr offen — Seite neu laden.');
  await replyInChat(u, run.conv, kind === 'nacharbeit' ? `Nacharbeit nach Review: ${text}` : text);
  await wb().collection('agent_runs').updateOne({ _id: run._id }, {
    $set: { status: 'läuft', question: null, endReason: null, ...(kind === 'nacharbeit' ? { reviewReadyAt: null, rework: { text: text.slice(0, 500), at: new Date() } } : {}) },
  });
  runsRefreshedAt.delete(u.id);
  log('review antwort', { user: u.id, key: run.key, kind });
  send(res, 200, { ok: true, url: run.url ?? null });
});

// review_ready (Werkbank-MCP): Fertig-Marke am neuesten Chat-Lauf der Person in DIESER Unterhaltung (Bedingung 5).
on('POST', /^\/internal\/review-ready$/, async (req, res) => {
  const b = await body(req);
  const u = await internalUser(req, b);
  const conv = String(b.conv ?? '');
  if (!conv) throw new HttpError(400, 'Keine Unterhaltung bekannt — review_ready gilt nur in einem Workspace-Chat.');
  const run: any = await wb().collection('agent_runs').findOne({ userId: u.id, conv, mode: 'chat' }, { sort: { startedAt: -1 } });
  // Orchestrator-Strang: Fertig-Marke am Strang — er wird danach nie mehr automatisch fortgesetzt (Plan auto-weiter, DoD 4).
  const strand: any = run ? null : await wb().collection('orchestrator_runs').findOne({ userId: u.id, conv });
  if (strand) {
    const p = parseReview(b);
    if (!p.review) throw new HttpError(400, p.error!);
    await wb().collection('orchestrator_runs').updateOne({ _id: strand._id }, { $set: { reviewReadyAt: new Date(), review: p.review } });
    log('review bereit (strang)', { user: u.id, id: strand._id, dod: p.review.dod.length });
    return send(res, 200, { ok: true, strand: strand._id });
  }
  if (!run) throw new HttpError(404, 'Kein Workspace-Agentenlauf zu diesem Chat — nichts gesetzt (die Review-Schlange kennt nur Läufe, die vom Board aus gestartet wurden).');
  const p = parseReview(b);
  if (!p.review) throw new HttpError(400, p.error!);
  await wb().collection('agent_runs').updateOne({ _id: run._id }, { $set: { reviewReadyAt: new Date(), review: p.review, reviewedAt: null } });
  runsRefreshedAt.delete(u.id);
  log('review bereit', { user: u.id, key: run.key, dod: p.review.dod.length });
  send(res, 200, { ok: true, key: run.key });
});


// Nachreichen während des Zugs (docs/plan-hauptchat-monitor.md, S1): aus dem LibreChat-Eingabefeld (gleicher Ursprung über
// /werkbank, CSRF-Header über needUser). Die Brücke nimmt nur Nachrichten an die eigenen Unterhaltungen der Person an.
on('POST', /^\/api\/chat\/nachreichen$/, async (req, res) => {
  const u = await needUser(req);
  const b = await body(req, 64 << 10);
  const conv = String(b.conv ?? '');
  if (!/^[0-9a-f-]{36}$/.test(conv)) throw new HttpError(400, 'Ungültige Unterhaltung.');
  const r = await injectBridge(u, conv, String(b.text ?? ''));
  if (!r.ok) throw new HttpError(r.status === 400 ? 400 : 409, r.error);
  log('nachgereicht', { user: u.id });
  send(res, 200, { id: r.id, state: 'zugestellt' });
});
on('GET', /^\/api\/chat\/nachreichen\/([0-9a-f-]{36})$/, async (req, res, m) => {
  const u = await needUser(req);
  const st = await injectStateBridge(u, m[1]);
  send(res, 200, { id: m[1], state: st?.state ?? 'unbekannt' });
});

// Leitstand-Übersicht, Berichte und Review der Stränge (docs/plan-leitstand.md, Teil B) — nur Admins (Feature leitstand, G7).
on('GET', /^\/api\/leitstand\/overview$/, async (req, res) => send(res, 200, await overview(await needAdmin(req))));

// Hauptchat starten aus der Oberfläche (Plan 144, S2): dieselbe Funktion wie der interne Kanal der CLI — Admin, CSRF-Header
// (needUser), 40 000 Zeichen, Brücke prüft LEITSTAND_EMAILS. Der Entwurf enthält keine Strang-Auszüge (Council B1).
on('GET', /^\/api\/leitstand\/handover$/, async (req, res) => send(res, 200, await handoverDraft(await needAdmin(req))));
on('POST', /^\/api\/leitstand\/start$/, async (req, res) => {
  const u = await needAdmin(req);
  const b = await body(req, 1 << 20);
  const r = await startLeitstand(u, { handoverText: typeof b?.handoverText === 'string' ? b.handoverText : null });
  log('hauptchat gestartet (Oberfläche)', { user: u.id, id: r.id, conv: r.conv, beendet: r.ended.length });
  return send(res, 200, r);
});

on('GET', /^\/api\/leitstand\/bericht$/, async (req, res, _m, url) => {
  const u = await needAdmin(req);
  const d: any = await orchRuns().findOne({ _id: String(url.searchParams.get('strand') ?? '') as any, userId: u.id, kind: { $ne: 'leitstand' } });
  if (!d) throw new HttpError(404, 'Strang nicht gefunden.');
  // Plan 144: auch den Auftrag (auftrag.md im selben review-pakete-Ordner) — gleiche Leseprüfung wie beim Bericht.
  const art = url.searchParams.get('art') === 'auftrag' ? 'auftrag' : 'bericht';
  const path = paketDatei(d, art);
  const text = readBericht(path);
  if (text === null) throw new HttpError(404, art === 'auftrag' ? 'Kein lesbarer Auftrag zu diesem Unter-Chat.' : 'Kein lesbarer Bericht zu diesem Unter-Chat.');
  send(res, 200, { strand: String(d._id), art, name: String(path).split('/').slice(-2).join('/'), text });
});

/** Strang zum Review prüfen (Einzel- und Sammel-„Passt“, Council Bedingung 7): eigen, gesehener Stand (F3), nicht laufend (G4). */
async function strandForReview(u: User, id: string, seenIn: unknown, states: Map<string, any> | null) {
  const d: any = await orchRuns().findOne({ _id: id as any, userId: u.id, kind: { $ne: 'leitstand' } });
  if (!d) throw new HttpError(404, 'Strang nicht gefunden.');
  const seen = String(new Date(d.reviewReadyAt ?? d.doneAt ?? 0).getTime()) + ':' + String(new Date(d.lastSentAt ?? d.startedAt).getTime());
  if (String(seenIn ?? '') !== seen) throw new HttpError(409, 'Der Strang hat sich inzwischen geändert — Seite neu laden.');
  if (!states) throw new HttpError(503, 'Brücke nicht erreichbar — gleich noch einmal.');
  if (states.get(d.conv)?.running) throw new HttpError(409, 'Der Strang arbeitet gerade — warte, bis er fertig ist.');
  return d;
}
const expectOf = (d: any) => ({ lastSentAt: d.lastSentAt ?? null, reviewReadyAt: d.reviewReadyAt ?? null, doneAt: d.doneAt ?? null });

// Alle live gegangenen Stränge abhaken (Paket 141, S2): der Stand wird hier frisch neu gerechnet — der Browser zählt nicht.
on('POST', /^\/api\/leitstand\/strands\/passt-live$/, async (req, res) => {
  const u = await needAdmin(req);
  const b = await body(req);
  const items: any[] = Array.isArray(b.items) ? b.items.slice(0, 30) : [];
  if (!items.length) throw new HttpError(400, 'Keine Stränge angegeben.');
  const states = await strandStates(u).catch(() => null);
  const cards = new Map((await strandCards(u, { detail: true, fresh: true })).map((c: any) => [c.id, c]));
  const done: string[] = [], skipped: { id: string; why: string }[] = [];
  for (const it of items) {
    const id = String(it?.id ?? '');
    const c: any = cards.get(id);
    if (!c) { skipped.push({ id, why: 'nicht mehr offen' }); continue; }
    if (c.stand?.kind !== 'live') { skipped.push({ id, why: 'nicht live' }); continue; }
    try {
      const d = await strandForReview(u, id, it?.seen, states);
      await reviewOrch(u, id, `live seit Release ${c.stand.release} (gesammelt abgehakt)`, 'knut', expectOf(d));
      done.push(id);
    } catch (e: any) { skipped.push({ id, why: e?.status === 503 ? 'Brücke nicht erreichbar' : /arbeitet/.test(e?.message) ? 'Agent arbeitet gerade' : 'hat sich geändert' }); }
  }
  log('stränge gesammelt geprüft', { user: u.id, done: done.length, skipped: skipped.length });
  send(res, 200, { done, skipped });
});

on('POST', /^\/api\/leitstand\/strands\/([0-9a-f]{8})\/(passt|reply)$/, async (req, res, m) => {
  const u = await needAdmin(req);
  const b = await body(req);
  const d = await strandForReview(u, m[1], b.seen, await strandStates(u).catch(() => null));
  if (m[2] === 'passt') {
    await reviewOrch(u, m[1], String(b.note ?? 'Passt (Heute)'), 'knut', expectOf(d));
    log('strang geprüft', { user: u.id, id: m[1] });
    return send(res, 200, { ok: true });
  }
  if (dryRun()) throw new HttpError(409, 'Vorschau (Trockenlauf): Agenten und Chats sind hier aus.');
  const text = String(b.text ?? '').trim().slice(0, 4000);
  if (b.kind !== 'nacharbeit' || !text) throw new HttpError(400, 'Schreib kurz, was nachzuarbeiten ist.');
  await sendOrch(u, m[1], `Nacharbeit nach Review: ${text}`);
  log('strang nacharbeit', { user: u.id, id: m[1] });
  send(res, 200, { ok: true, url: d.url });
});

// Rückfragen des Orchestrators (Knut antwortet hier; nur die eigenen).
on('GET', /^\/api\/orchestrator\/questions$/, async (req, res, _m, url) => {
  const u = await needUser(req);
  const open = await listQuestions(u, { open: true });
  send(res, 200, url.searchParams.get('count') ? { open: open.length } : { open, answered: (await listQuestions(u, { limit: 20 })).filter((q) => q.status !== 'offen').slice(0, 10) });
});

on('POST', /^\/api\/orchestrator\/questions\/([\w-]{1,20})\/answer$/, async (req, res, m) => {
  const u = await needUser(req);
  const b = await body(req);
  const q = await answerQuestion(u, m[1], { option: b.option ?? null, text: b.text ?? null });
  log('rückfrage beantwortet', { user: u.id, id: q.id });
  roadmapChanged('orchestrator-antwort');
  send(res, 200, q);
});

on('POST', /^\/api\/roadmap\/question$/, async (req, res) => {
  const u = await needAdmin(req);
  const b = await body(req);
  const id = String(b.id ?? ''); const answer = String(b.answer ?? '');
  if (!['ja', 'nein', 'widerruf'].includes(answer)) throw new HttpError(400, 'Antwort ist ja, nein oder widerruf.');
  const col = wb().collection('roadmap_answers');
  if (answer === 'widerruf') {
    // Eine Freigabe zurücknehmen, auch wenn ihre Frage nicht mehr im aktuellen Abschnitt steht.
    const r = await col.deleteOne({ _id: id as any, answer: 'ja', done: { $ne: true } });
    if (!r.deletedCount) throw new HttpError(409, 'Keine offene Freigabe mit dieser Kennung.');
  } else {
    const q = parseSyncQuestions(readVault(SYNC_PROTOCOL)).find((x) => x.id === id);
    if (!q) throw new HttpError(409, 'Diese Frage gibt es im letzten Sync-Protokoll nicht mehr — Seite neu laden.');
    await col.updateOne({ _id: id as any }, { $set: { answer, text: q.text, key: q.key, section: q.section, at: new Date(), by: u.email } }, { upsert: true });
  }
  const open = await writeApprovals();
  let started = false;
  if (answer === 'ja') { roadmapQueue.full = true; started = await tryStartSync(); }
  if (answer === 'widerruf' && open === 0) roadmapQueue.full = false;   // nichts mehr freigegeben → kein voller Lauf
  roadmapChanged('frage');
  send(res, 200, { ok: true, open, started, queued: !started && answer === 'ja' });
});

on('POST', /^\/api\/roadmap\/draft$/, async (req, res) => {
  const u = await needAdmin(req);
  const b = await body(req);
  const text = readVault(WORK_DRAFT);
  const hash = hashText(text);
  if (!text.trim() || String(b.hash ?? '') !== hash) throw new HttpError(409, 'Der Entwurf hat sich geändert — Seite neu laden.');
  if (b.action === 'übernehmen') {
    const next = replaceWorkBlock(readVault(HUB), draftBody(text));
    if (next === null) throw new HttpError(409, 'Im Hub fehlen die Marker <!-- werkbank:woran-wir-arbeiten --> … <!-- /werkbank:woran-wir-arbeiten --> (oder sie stehen doppelt). Nichts geschrieben.');
    writeAtomic(join(cfg.vaultDir, HUB), next);
    invalidateIndex();
  } else if (b.action !== 'verwerfen') throw new HttpError(400, 'Aktion ist übernehmen oder verwerfen.');
  await wb().collection('meta').updateOne({ _id: 'roadmap_draft' as any }, { $set: { hash, action: b.action, at: new Date(), by: u.email } }, { upsert: true });
  roadmapChanged('entwurf');
  send(res, 200, { ok: true });
});

on('POST', /^\/api\/roadmap\/github$/, async (req, res) => {
  await needUser(req);
  const r = await syncGithub(await githubReadToken()).catch((e: any) => { throw new HttpError(502, e.message); });
  send(res, 200, r ?? { count: 0, changed: 0, error: 'Kein GitHub-Lesetoken.' });
});

// --- Spec-Ordnung (Runde 6): Regel-Check je Spec, Zustandswechsel als Kopiertext, neue Spec aus Vorlage ---

on('GET', /^\/api\/roadmap\/order$/, async (req, res) => {
  await needUser(req);
  const im = await issueMap();
  const specs = roadmapSpecs(await assignments('spec'));
  const ranking = parseRankTable(readVault(`${OVERVIEW}/priorisierung-roadmap-produkt-olaf.md`));
  const rankOf = new Map(ranking.map((r) => [r.spec, r.rank]));
  const infos = specs.map((sp) => ({ ...sp, tickets: sp.tickets.map((k) => ({ key: k, status: im.get(k)?.status ?? null })), jiraKey: true, rank: null }));
  const cons = roadmapInsights(infos as any, ranking).consistency;
  const gh = await livePrs();
  const today = vienna().date;
  const ovCache = new Map<string, string>();
  const rows = specs.map((sp) => {
    const ticketGoals = [...new Set(sp.tickets.flatMap((k) => { const i = im.get(k); return i ? effectiveGoals(i, im).goals : []; }))];
    if (sp.overview && !ovCache.has(sp.overview)) ovCache.set(sp.overview, readVault(sp.overview));
    const checks = specChecks({ ...sp, goals: sp.goalVia === 'ziel:' ? sp.goals : [] }, { rank: rankOf.get(sp.name) ?? null, overviewText: sp.overview ? ovCache.get(sp.overview)! : '', consistency: cons.filter((c) => c.spec === sp.name), ticketGoals, today, localGoal: sp.goalVia === 'Werkbank' ? sp.goals[0] : undefined });
    return {
      name: sp.name, title: sp.title, path: sp.path, topic: sp.topic, state: sp.state, lastVerified: sp.fm['last-verified'] ?? null,
      tickets: sp.tickets.map((k) => ({ key: k, status: im.get(k)?.status ?? null })),
      prs: sp.prs.map((pr) => { const l = gh.map.get(pr); return { pr, conflict: l?.mergeable === 'CONFLICTING', open: !!l, turn: l?.turn.who ?? null }; }),
      checks,
    };
  });
  const n = (f: (r: typeof rows[number]) => boolean) => rows.filter(f).length;
  send(res, 200, {
    specs: rows, states: KANBAN_STATES, topics: [...new Set(rows.map((r) => r.topic))],
    summary: { total: rows.length, withJira: n((r) => r.checks.jira), noGoal: n((r) => !r.checks.goal.ok), noDod: n((r) => !r.checks.dod), fmBad: n((r) => !r.checks.fm.ok), unranked: n((r) => r.checks.rank == null), inconsistent: n((r) => !r.checks.consistent), notInOverview: n((r) => !r.checks.inOverview), openDecisions: rows.reduce((a, r) => a + r.checks.openDecisions, 0) },
    vaultDryRun: vaultDry(), specCreate: specCreate(),
  });
});

// Zustandswechsel: kein sauberer Schreibweg (Hub-Zahlen, Kreuztabelle, Prosa, rank.py) → nur Kopiertext, schreibt nie.
on('POST', /^\/api\/roadmap\/spec-move$/, async (req, res) => {
  await needUser(req);
  const b = await body(req);
  const sp = roadmapSpecs().find((x) => x.path === String(b.path ?? ''));
  if (!sp) throw new HttpError(404, 'Spec nicht gefunden.');
  const to = String(b.to ?? '');
  if (!KANBAN_STATES.includes(to) && to !== '6-Archive') throw new HttpError(400, 'Unbekannter Zustand.');
  const newPath = `${ROADMAP_BASE}/${sp.topic}/${to}/${sp.path.split('/').pop()}`;
  const today = vienna().date;
  const warn: string[] = [];
  const idx = KANBAN_STATES.indexOf(to);
  if (idx >= KANBAN_STATES.indexOf('3-Plan') && !/^##\s+Definition of Done/im.test(sp.text)) warn.push('Plan verlangt eine Definition of Done in prüfbaren Sätzen.');
  if (sp.state === '2-Pre-Plan' && parseDecisions(sp.text).some((d) => d.open)) warn.push('Offene „- Knut:“-Zeilen: Pre-Plan → Plan erst, wenn jede Entscheidung beantwortet ist, die ändert, was gebaut wird.');
  if (to === '4-Review' && !sp.prs.length) warn.push('Review verlangt einen PR-Link in der Spec.');
  const slug = (st: string) => st.replace(/^\d-/, '').toLowerCase();
  const page = (st: string) => `${OVERVIEW}/${st.toLowerCase()}-roadmap-produkt-olaf.md`;
  const copy = [
    `Zustandswechsel: [[${sp.name}]]  ${sp.state} → ${to}  (${today})`,
    '',
    '1. Datei verschieben:',
    `   mv "${cfg.vaultDir}/${sp.path}" "${cfg.vaultDir}/${newPath}"`,
    `2. Frontmatter: lifecycle: ${slug(to)} · last-verified: ${today}${idx >= 2 ? ' · ENTWURF-Marker entfernen' : ''}`,
    `3. Zustandsseiten: Zeile aus ${page(sp.state)} entfernen, in ${page(to)} ergänzen`,
    `4. Hub ${OVERVIEW}/0-roadmap-produkt-olaf.md: Zählzeile „Wo was liegt“, Kreuztabelle nach Thema und Prosa darunter; „Woran wir gerade arbeiten“ neu schreiben`,
    `5. Themen-Übersicht ${sp.overview ?? `${sp.topic}/0-…-uebersicht.md`}: „Aktueller Stand“ und „Wo die Arbeit steht“ (Zahlen + Link)`,
    '6. Priorisierung: Zeile in scripts/rank.py anpassen, Rangliste neu erzeugen',
    ...(to === '4-Review' ? ['7. PR-Register pr-stand-produkt-olaf.md nachziehen'] : []),
    `${to === '4-Review' ? 8 : 7}. Prüfen: python3 /vault/_meta/dist-skill/olaf-produkt-roadmap/scripts/roadmap_check.py`,
    ...(warn.length ? ['', 'Vorher klären:', ...warn.map((w) => `- ${w}`)] : []),
  ].join('\n');
  send(res, 200, { copy, newPath, warn, writes: false });
});

on('POST', /^\/api\/roadmap\/spec-new$/, async (req, res) => {
  const u = await needUser(req);
  const b = await body(req);
  const topic = String(b.topic ?? ''), state = String(b.state ?? ''), slugIn = String(b.slug ?? '').trim(), title = String(b.title ?? '').replace(/\s+/g, ' ').trim();
  const rm = roadmap(vaultIdx(), ROADMAP_BASE);
  const t = rm.topics.find((x) => x.name === topic);
  if (!t) throw new HttpError(400, 'Unbekanntes Thema.');
  if (!KANBAN_STATES.includes(state)) throw new HttpError(400, 'Unbekannter Zustand.');
  if (!/^[a-z0-9]+(-[a-z0-9]+){0,8}$/.test(slugIn) || slugIn.length > 60) throw new HttpError(400, 'Kurzname: klein, mit Bindestrichen (z. B. kundenakte-export).');
  if (title.length < 4) throw new HttpError(400, 'Titel angeben.');
  const goal = b.goal ? String(b.goal).toUpperCase() : undefined;
  if (goal && (!GOAL_ID.test(goal) || !goalsAll(await issueMap()).byId.has(goal))) throw new HttpError(400, `Ziel ${goal} gibt es nicht in ${GOALS_FILE()}.`);
  const jiraKey = b.jira ? String(b.jira).toUpperCase() : undefined;
  if (jiraKey && !/^[A-Z][A-Z0-9]+-\d+$/.test(jiraKey)) throw new HttpError(400, 'Ungültiger Jira-Schlüssel.');
  // Präfix wie die vorhandenen Specs des Themas (cockpit-spec-, service-spec- …)
  const prefixes = Object.values(t.states).flat().map((x) => x.path.split('/').pop()!.match(/^([a-z0-9]+)-spec-/)?.[1]).filter(Boolean) as string[];
  const prefix = prefixes.sort((a, c) => prefixes.filter((x) => x === c).length - prefixes.filter((x) => x === a).length)[0] ?? topic.toLowerCase().replace(/[^a-z0-9]/g, '');
  const rel = `${ROADMAP_BASE}/${topic}/${state}/${prefix}-spec-${slugIn}.md`;
  const abs = vaultPath(rel);
  if (existsSync(abs)) throw new HttpError(409, `${rel} gibt es schon.`);
  const content = specTemplate({ topic, state, title, goal, jira: jiraKey, today: vienna().date, overview: t.overview?.split('/').pop()?.replace(/\.md$/, '') });
  const follow = ['Zustandsseite ergänzen', 'Hub: Zählzeile + Kreuztabelle', 'Themen-Übersicht: Link + Zahlen', 'Priorisierung: rank.py-Zeile', 'roadmap_check.py'];
  if (b.confirm !== true) return send(res, 200, { needsConfirm: true, preview: { path: rel, content, follow }, dryRun: vaultDry(), copyOnly: !specCreate() });
  if (!specCreate()) throw new HttpError(403, '„Neue Spec“ ist abgeschaltet (WERKBANK_SPEC_CREATE=on schaltet ein) — bitte die Vorlage als Text kopieren.');
  if (vaultDry()) return send(res, 200, { ok: true, dryRun: true, wouldWrite: rel, follow });
  mkdirSync(join(cfg.vaultDir, ROADMAP_BASE, topic, state), { recursive: true });
  writeFileSync(abs, content, { flag: 'wx' });
  invalidateIndex(); checkCache = null;
  log('spec neu', { user: u.id, path: rel });
  send(res, 200, { ok: true, path: rel, follow });
});

// --- „Agent ansetzen“ an einer Spec (docs/plan-agent-ansetzen.md): Vorschau → ein Klick → Ticket, Spec-Link, Agent ---

/** `jira:` (bzw. `sim-jira:`) in die Spec — nur ohne laufenden Vault-Sync, mit Hash direkt vor dem Schreiben (Bedingung 7). */
async function linkSpec(sp: { path: string; text: string }, key: string, field: 'jira' | 'sim-jira'): Promise<string> {
  if (vaultDry()) return 'trocken';
  const abs = vaultPath(sp.path);
  const cur = readFileSync(abs, 'utf8');
  if (hashText(cur) !== hashText(sp.text)) return 'offen:Spec hat sich seit dem Lesen geändert — beim nächsten Klick';
  const next = field === 'jira' ? addJiraFrontmatter(cur, key) : addSimField(cur, key);
  if (next === null) return 'schon';
  if (syncLocked()) return 'offen:Vault-Sync läuft gerade — beim nächsten Klick';
  writeAtomic(abs, next);
  invalidateIndex(); suggestCache = null;
  return 'ok';
}

// G0 je Spec 3 Minuten zwischenspeichern: Vorschau und Klick sehen dieselben Belege, ohne zweimal zu holen.
const g0Cache = new Map<string, { at: number; r: VorbauErgebnis }>();
async function ansetzenG0(slug: string): Promise<VorbauErgebnis> {
  const c = g0Cache.get(slug);
  if (c && Date.now() - c.at < 180_000) return c.r;
  const r = await pruefe({ slug, repos: g0Repos(null), aufrufer: 'ansetzen' });
  g0Cache.set(slug, { at: Date.now(), r });
  return r;
}

on('GET', /^\/api\/roadmap\/ansetzen$/, async (req, res, _m, url) => {
  await needAdmin(req);
  const path = url.searchParams.get('path') ?? '';
  send(res, 200, { mode: ansetzenMode().mode, state: ansetzenView(await specTicketState(specSlug(path))) });
});

on('POST', /^\/api\/roadmap\/ansetzen$/, async (req, res) => {
  const u = await needAdmin(req);   // Bedingung 1: nur Admins (aus der Sitzung)
  const b = await body(req);
  const m = ansetzenMode();
  const sp = roadmapSpecs().find((x) => x.path === String(b.path ?? ''));
  if (!sp) throw new HttpError(404, 'Spec nicht gefunden.');
  const gate = specGate(sp);
  const im = await issueMap();
  const workstreams = [...im.values()].filter((i) => i.type === 'Workstream' && i.statusCategory !== 'done').map((i) => ({ key: i.key, summary: i.summary })).sort((a, c) => a.key.localeCompare(c.key, undefined, { numeric: true }));
  const mode = b.mode === 'plan' ? 'plan' as const : 'review' as const;
  const parent = String(b.parent || DEFAULT_WORKSTREAM);
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(parent) || (m.mode === 'live' && !workstreams.some((w) => w.key === parent))) throw new HttpError(400, `${parent.slice(0, 20)} ist kein Workstream in der Jira-Kopie.`);
  const state = ansetzenView(await specTicketState(specSlug(sp.path)));
  const base: any = { mode: m.mode, problem: m.problem, gate: { ok: gate.ok, why: gate.why, open: gate.open.map((d) => d.question).slice(0, 5) }, state, workstreams, hash: draftHashOf(sp.text), spec: { path: sp.path, title: sp.title, topic: sp.topic, state: sp.state }, dryRun: dryRun() };
  if (m.mode === 'aus') {
    if (b.confirm === true) throw new HttpError(403, m.problem ?? '„Agent ansetzen“ ist ausgeschaltet (WERKBANK_ANSETZEN).');
    return send(res, 200, base);
  }
  // G0 „Prüfung vor dem Bau“ (docs/plan-vorbau-check.md): Repos aus WERKBANK_VORBAU_REPOS; Treffer/Stopp → Knut wählt
  // im Dialog einen Knopf (protokolliert). Ohne Lesetoken oder ohne Repos: Stopp ohne Knopf, nur „trotzdem bauen“.
  if (gate.ok && !state?.key && !vorbauAus()) {   // WERKBANK_VORBAU_CHECK=off → kein G0 im Dialog
    const g0 = await ansetzenG0(specSlug(sp.path));
    base.g0 = { ergebnis: g0.ergebnis, text: g0Text(g0), belege: g0.belege.map((x) => ({ text: x.text, pr: x.pr ?? null, sha: x.sha ?? null, wirkung: x.wirkung })), hinweise: g0.hinweise, stopp: g0.stopp ?? null, options: g0.ergebnis === 'treffer' || g0.ergebnis === 'stopp' ? g0Optionen(g0) : [] };
    const stop = base.g0.options.length > 0;
    if (b.confirm === true && stop) {
      const choice = String(b.g0Choice ?? '');
      if (!base.g0.options.some((o: any) => o.label === choice)) throw new HttpError(409, `G0 ${g0.ergebnis === 'stopp' ? 'Stopp' : 'Treffer'} — erst im Dialog entscheiden: ${base.g0.options.map((o: any) => `„${o.label}“`).join(', ')}.`);
      protokolliere({ art: 'knopf', slug: specSlug(sp.path), knopf: choice, kriterien: g0.kriterien, ergebnis: g0.ergebnis, durch: u.email, aufrufer: 'ansetzen' });
      if (choice === 'Spec nachziehen/abräumen') { g0Cache.delete(specSlug(sp.path)); return send(res, 200, { ...base, g0Abgebrochen: true }); }
      b.note = `${String(b.note ?? '')}\n\nG0 vor dem Bau: Knut hat „${choice}“ gewählt.\n${base.g0.text}`.trim();
    }
  }
  let jira: AnsetzenJira | null = null;
  let me: { accountId: string; displayName: string } | null = null;
  try { jira = m.mode === 'sim' ? simJira(u) : await liveJira(u); me = await jira.me(); }
  catch (e: any) { if (b.confirm === true) throw e; base.jiraProblem = String(e?.message ?? e).slice(0, 300); }
  const due = sprintEnd(listCycles(sprintRoot()).map((c) => c.date), vienna().date);
  const draft = me ? ticketDraft(sp, { parent, summary: b.summary, mode, accountId: me.accountId, ownerName: me.displayName, due }) : null;
  if (b.confirm !== true) {
    // Vorschau: schreibt nichts (Bedingung 1). Dubletten lokal + live (Bedingung 3).
    let duplicates: Dup[] = m.mode === 'sim' ? [] : localDuplicates(sp, [...im.values()]);
    if (jira) {
      try { duplicates = [...new Map([...(await jira.search(dupJql(sp), sp)), ...duplicates].map((d) => [d.key, d])).values()]; }
      catch (e: any) { base.liveProblem = `Jira-Suche nicht möglich: ${String(e?.message ?? e).slice(0, 160)}`; }
    }
    return send(res, 200, { ...base, draft, duplicates, ready: gate.ok && !!draft && !base.liveProblem && !base.dryRun });
  }
  if (dryRun()) throw new HttpError(409, 'Vorschau (Trockenlauf): hier wird nichts angelegt.');
  if (!gate.ok) throw new HttpError(409, gate.why!);
  if (String(b.hash ?? '') !== base.hash) throw new HttpError(409, 'Die Spec hat sich seit der Vorschau geändert — bitte neu laden.');
  // Bedingung „nichts halb angelegt“: Claude-Token und Jira-Schreibweg vor dem ersten Schreiben.
  if (!(await getClaudeToken(u))) throw new HttpError(412, 'Noch kein Claude verbunden — unter „Einrichtung“ den Token aus `claude setup-token` eintragen. Nichts angelegt.');
  if (m.mode === 'live' && !(await canWriteJira(u))) throw new HttpError(412, 'Jira-Schreiben ist für dich nicht verbunden (Atlassian-MCP) — unter „Einrichtung“ anmelden. Nichts angelegt.');
  let useKey: string | undefined;
  if (b.useKey) {
    useKey = String(b.useKey).toUpperCase();
    const known = m.mode === 'sim' ? /^SIM-\d+$/.test(useKey) && !!(await jira!.get(useKey)) : /^[A-Z][A-Z0-9]+-\d+$/.test(useKey) && (im.has(useKey) || !!(await jira!.get(useKey)));
    if (!known) throw new HttpError(404, `${useKey.slice(0, 20)} ist nicht bekannt.`);
  }
  const r = await runAnsetzen(u, sp, { mode, note: String(b.note ?? '').slice(0, 2000), useKey, newTicket: b.newTicket === true, draft: draft! }, {
    jira: jira!, mirror: issueMap, linkSpec,
    startAgent: async (issue, note, specPath) => {
      const a = await startTicketAgent(u, issue, note, { specPath });
      await wb().collection('agent_runs').updateOne({ _id: a.id as any }, { $set: { specPath, origin: 'ansetzen' } });
      return a;
    },
  });
  log('agent ansetzen', { user: u.id, spec: sp.name, key: r?.key ?? null, choice: r?.needsChoice ?? null, mode: m.mode });
  send(res, 200, r);
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
// Sprint-Mitgliedschaft lokal (Runde 7): in Sprint nehmen / rausnehmen, mit Bestätigung, nichts nach Jira.
on('POST', /^\/api\/sprint\/(sprint-\d{4}-\d{2}-\d{2})\/member$/, async (req, res, m) => {
  const u = await needUser(req);
  const b = await body(req);
  const c = cycleById(m[1]);
  const key = String(b.key ?? '');
  if (!(await issueMap()).has(key)) throw new HttpError(404, 'Ticket nicht in der Kopie.');
  const member = !(b.in === false || b.in === 'false');
  const preview = member ? `${key} → Sprint ${c.date}` : `${key} aus Sprint ${c.date} nehmen`;
  if (b.confirm !== true) return send(res, 200, { needsConfirm: true, preview });
  await setSprint(u, key, c.date, member);
  jiraChanged([key], 'sprint');
  send(res, 200, { ok: true, preview });
});

// Alter Label-Weg nach Jira: nur mit WERKBANK_GOALS_TO_JIRA=labels.
on('POST', /^\/api\/sprint\/(sprint-\d{4}-\d{2}-\d{2})\/labels$/, async (req, res, m) => {
  const u = await needUser(req);
  if (!goalsToJira()) throw new HttpError(410, 'Sprint und Ziel werden im OLAF Workspace gespeichert, nicht als Jira-Label (WERKBANK_GOALS_TO_JIRA=labels schaltet den alten Weg ein).');
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
  let files;
  try { files = (await prepareCycle(date)).files; } catch (e: any) { throw new HttpError(400, e.message); }
  const dir = join(sprintRoot(), id);
  if (existsSync(dir) || cycles().some((x) => x.id === id)) throw new HttpError(409, `${id} gibt es schon.`);
  const rel = dir.slice(cfg.vaultDir.length + 1);
  if (b.confirm !== true) return send(res, 200, { needsConfirm: true, preview: { dir: rel, files: files.map((f) => ({ name: f.name, lines: f.content.split('\n').length, head: f.content.slice(0, 1200) })) } });
  if (vaultDry()) return send(res, 200, { ok: true, dryRun: true, wouldWrite: rel, id, dir: rel });
  mkdirSync(dir);
  for (const f of files) writeFileSync(join(dir, f.name), f.content, { flag: 'wx' });
  invalidateIndex();
  log('sprint neu', { user: u.id, cycle: id });
  send(res, 200, { ok: true, id, dir: rel });
});

// Schritt 1 „Review vorbereiten“: Entwurf aus Vorlage + Daten. Vorschau liefert den ganzen Review (Download);
// geschrieben werden nur nach Bestätigung und nur FEHLENDE Dateien (wx) — ein vorhandener Review bleibt unangetastet.
on('POST', /^\/api\/sprint\/draft$/, async (req, res) => {
  const u = await needUser(req);
  const b = await body(req);
  const date = String(b.date ?? '');
  let r;
  try { r = await prepareCycle(date); } catch (e: any) { throw new HttpError(400, e.message); }
  if (r.empty) throw new HttpError(409, 'Die Jira-Kopie ist leer — erst abgleichen (Board → Abgleich), sonst stünde jedes Ticket als „nicht in der Kopie“ da.');
  const id = `sprint-${date}`;
  const dir = join(sprintRoot(), id);
  const rel = dir.slice(cfg.vaultDir.length + 1);
  if (cycles().some((x) => x.id === id && x.archived)) throw new HttpError(409, `${id} liegt schon im Archiv — kein zweiter Ordner mit gleichem Namen.`);
  const files = r.files.map((f) => ({ ...f, exists: existsSync(join(dir, f.name)) }));
  const missing = files.filter((f) => !f.exists);
  const preview = {
    dir: rel, id, previous: r.prev?.id ?? null, stats: r.stats,
    files: files.map((f) => ({ name: f.name, exists: f.exists, lines: f.content.split('\n').length, content: f.name.endsWith('-review.md') ? f.content : f.content.slice(0, 1200) })),
  };
  if (b.confirm !== true) return send(res, 200, { needsConfirm: missing.length > 0, preview, dryRun: vaultDry() });
  if (!missing.length) throw new HttpError(409, `${id}: alle drei Notizen gibt es schon — der Entwurf ist nur als Download da.`);
  if (vaultDry()) return send(res, 200, { ok: true, dryRun: true, wouldWrite: missing.map((f) => `${rel}/${f.name}`), id });
  if (!existsSync(dir)) mkdirSync(dir);
  const written: string[] = [];
  for (const f of missing) {
    try { writeFileSync(join(dir, f.name), f.content, { flag: 'wx' }); written.push(f.name); }
    catch (e: any) { if (e.code !== 'EEXIST') throw e; }        // inzwischen angelegt (Obsidian, Agent) → nicht anfassen
  }
  invalidateIndex();
  log('sprint entwurf', { user: u.id, cycle: id, written });
  send(res, 200, { ok: true, id, dir: rel, written });
});

// Schritt 5 „Mitnahme“: aus der Jira-Kopie gerechnet (Gleichlauf mit jira-sprint-carry.sh), nur lesend, als Markdown.
// In die Notiz schreibt den Abschnitt weiterhin /sprint-sync im Chat.
on('GET', /^\/api\/sprint\/(sprint-\d{4}-\d{2}-\d{2})\/carry$/, async (req, res, m) => {
  await needUser(req);
  const c = cycleById(m[1]);
  if (!c.files.review) throw new HttpError(404, 'Keine Review-Notiz in diesem Zyklus.');
  const text = readFileSync(c.files.review, 'utf8');
  const im = await issueMap();
  const qs = [c.files.review, c.files.planning].filter(Boolean).flatMap((f) => parseQuestions(readFileSync(f!, 'utf8'), f));
  const openNotes = syncPlanRows(qs).filter((r) => r.kind !== 'carry' && !isNoop(r.payload)).length;
  const sync: any = await wb().collection('meta').findOne({ _id: 'jira_sync' as any });
  const r = carryList(text, basename(c.files.review), im, viennaToday(), cfg.jiraProject);
  send(res, 200, { ...r, openNotes, jiraSync: sync ? { at: sync.at } : null });
});

// --- Ziele (Runde 6) ---

on('GET', /^\/api\/goals$/, async (req, res) => {
  await needUser(req);
  const im = await withAutoGoals();
  const g = goalsAll(im);
  const noGoal = [...im.values()].filter((i) => needsGoal(i, im, knownGoals(g))).length;
  send(res, 200, { file: GOALS_FILE(), missing: g.missing, roots: g.roots.map(stripTree), noGoal, labels: { goalPrefix: labelCfg().goalPrefix, exempt: exemptLabel() } });
});

// ---------- Automatisch zuordnen (docs/plan-ziele-auto.md, Council Runde 2) ----------
const AUTO_RULE1 = 'auto: Regel 1';

/** Regel 1 anwenden: Ticket-Key steht im Beleg genau einer Zeile aus ziele-olaf.md → dieses Ziel, als „auto: Regel 1“.
 *  Läuft beim Laden der Ziele und nach jedem Jira-Abgleich; legt nur an, wo es noch keine Zuordnung und kein Label gibt. */
async function applyAutoGoals(im: Map<string, Issue>): Promise<string[]> {
  const text = readVault(GOALS_FILE());
  if (!text) return [];
  const known = knownGoals(goalsAll(im));
  const done: string[] = [];
  for (const [k, r] of rule1Goals(parseGoalsFile(text).goals)) {
    const i = im.get(k);
    if (i && autoEligible(i, im, known) && await autoSetGoal(k, r.ziel, `Steht im Beleg von ${r.ziel} (${GOALS_FILE().split('/').pop()}, Zeile ${r.line}).`, AUTO_RULE1)) done.push(k);
  }
  if (done.length) { log('ziele automatisch', { regel: 1, n: done.length }); jiraChanged(done, 'ziel'); }
  return done;
}
const withAutoGoals = async () => { const im = await issueMap(); return (await applyAutoGoals(im)).length ? issueMap() : im; };

/** Vorschlag je Ticket: Datei (bewusst entschieden) gewinnt; sonst Spec ziel: (nur Vorschlag, nur IDs aus ziele-olaf.md,
 *  mehrdeutig → keiner). Nur für Tickets, die die Werkbank anfassen darf (autoEligible). Anzeige und Übernahme nutzen beide das. */
async function proposals(im: Map<string, Issue>, known: Set<string>, p: ReturnType<typeof loadProposals>) {
  const usable = (x: any) => x && (x.ziel === 'KEINS' || (known.has(x.ziel) && goalLevel(x.ziel) !== 'Gate'));
  const text = readVault(GOALS_FILE());
  const ids = new Set((text ? parseGoalsFile(text).goals : []).map((r) => r.id));
  const spec = specProposals(roadmapSpecs(await assignments('spec')), ids);
  return (k: string) => {
    const f = p.map.get(k);
    if (usable(f)) return { ...f!, quelle: 'datei' as const };
    const i = im.get(k);
    return i && autoEligible(i, im, known) ? spec.get(k) ?? null : null;
  };
}

on('GET', /^\/api\/goals\/assign$/, async (req, res) => {
  await needUser(req);
  const im = await withAutoGoals();
  const g = goalsAll(im);
  const p = loadProposals();
  const known = knownGoals(g);
  const proposalOf = await proposals(im, known, p);
  const tickets = [...im.values()].filter((i) => needsGoal(i, im, known)).map((i) => ({ ...richIssue(im, i, known), proposal: proposalOf(i.key) }))
    .sort((a, b) => a.workstreamName.localeCompare(b.workstreamName, 'de') || a.key.localeCompare(b.key, 'de', { numeric: true }));
  send(res, 200, {
    tickets, proposalFile: p.file, proposalError: p.error, proposals: tickets.filter((t) => t.proposal?.quelle === 'datei').length, computed: tickets.filter((t) => t.proposal?.quelle === 'spec').length,
    auto: [...(await assignments('ticket')).values()].filter((a) => a.source === AUTO_RULE1 && a.ziel && im.has(a.key)).map((a) => ({ key: a.key, summary: im.get(a.key)!.summary, ziel: a.ziel, begruendung: a.begruendung, at: a.at })),
    goalIds: [...g.byId.values()].filter((n) => n.level !== 'Gate').map((n) => ({ id: n.id, level: n.level, result: valueOf(n.result) ?? n.id })),
    labels: { goalPrefix: labelCfg().goalPrefix, exempt: exemptLabel() }, dryRun: dryRun(),
  });
});

// Sammelaktion (Runde 7): Zuordnung lokal in der Werkbank (goal_assignments + Verlauf), NICHT in Jira.
// „KEINS“ = bewusst ohne Ziel, nur mit Begründung. goal '' = lokale Zuordnung entfernen (Jira-Labels zählen dann nicht).
// WERKBANK_GOALS_TO_JIRA=labels schreibt zusätzlich die Labels wie früher (Standard: aus).
async function assignGoals(u: User, items: any[], im: Map<string, Issue>, confirm: boolean, source = 'werkbank') {
  const g = goalsAll(im);
  const known = knownGoals(g);
  const plan: { key: string; goal: string | null; why: string; text: string; actions: JiraAction[] }[] = [];
  for (const it of items) {
    const key = String(it.key ?? ''), raw = String(it.goal ?? '').toUpperCase();
    const i = im.get(key);
    if (!i) throw new HttpError(404, `${key} nicht in der Kopie.`);
    const why = String(it.begruendung ?? '').replace(/\s+/g, ' ').trim();
    if (raw === 'KEINS') {
      if (why.length < 5) throw new HttpError(400, `${key}: „bewusst ohne Ziel“ braucht eine Begründung.`);
      if (effectiveGoals(i, im, known).goals.length && i.localGoal === undefined) throw new HttpError(400, `${key} hat schon ein Ziel — „ohne Ziel“ passt nicht.`);
      plan.push({ key, goal: 'KEINS', why, text: `${key} → bewusst ohne Ziel („${why.slice(0, 80)}“)`, actions: [{ type: 'comment', text: `Bewusst ohne Ziel (${exemptLabel()}): ${why}` }, { type: 'labels', add: [exemptLabel()], remove: [] }] });
      continue;
    }
    if (raw === '') { plan.push({ key, goal: null, why, text: `${key} → Workspace-Zuordnung zurücksetzen (Jira-Label gilt wieder)`, actions: [] }); continue; }
    if (!g.byId.has(raw) || goalLevel(raw) === 'Gate') throw new HttpError(400, `${key}: unbekanntes Ziel ${raw}.`);
    plan.push({ key, goal: raw, why, text: `${key} → ${raw}${why ? ` („${why.slice(0, 60)}“)` : ''}`, actions: [{ type: 'labels', add: [goalLabel(raw)], remove: sameLevelRemovals(i.labels ?? [], raw), replaceLevelOf: raw }] });
  }
  if (!confirm) return { needsConfirm: true, preview: plan.map((p) => p.text), toJira: goalsToJira(), dryRun: dryRun() };
  const results: any[] = [];
  for (const p of plan) {
    try {
      const r = p.goal === null ? await resetGoal(u, p.key, 'ticket') : await setGoal(u, p.key, 'ticket', p.goal, p.why, source);
      let jira: any = null;
      if (goalsToJira() && p.actions.length) jira = await jiraWrite(u, () => writeJira(u, p.key, p.actions));
      results.push({ key: p.key, ok: true, goal: p.goal, prev: r.prev ?? null, jira: jira ? { done: jira.done, dryRun: jira.dryRun ?? false } : null });
    } catch (e: any) { results.push({ key: p.key, ok: false, error: String(e.message).slice(0, 300) }); }
  }
  log('ziele zuordnen (lokal)', { user: u.id, n: results.length, ok: results.filter((r) => r.ok).length, source });
  jiraChanged(results.filter((r) => r.ok).map((r) => r.key), 'ziel');
  return { ok: true, results, toJira: goalsToJira() };
}

on('POST', /^\/api\/goals\/assign$/, async (req, res) => {
  const u = await needUser(req);
  const b = await body(req);
  const items = (Array.isArray(b.items) ? b.items : []).slice(0, 200);
  if (!items.length) throw new HttpError(400, 'Keine Tickets gewählt.');
  send(res, 200, await assignGoals(u, items, await issueMap(), b.confirm === true));
});

// Vorschlagsdatei übernehmen: mode 'hoch' = alle mit Sicherheit hoch (oder ≥ 0,8), mode 'keys' = die genannten.
on('POST', /^\/api\/goals\/import$/, async (req, res) => {
  const u = await needUser(req);
  const b = await body(req);
  const im = await issueMap();
  const g = goalsAll(im);
  const known = knownGoals(g);
  const p = loadProposals();
  const high = (x: any) => (typeof x === 'number' ? (x <= 1 ? x >= 0.8 : x >= 80) : /^(hoch|high|sicher)$/i.test(String(x ?? '')));
  const keys = b.mode === 'keys' ? new Set((Array.isArray(b.keys) ? b.keys : []).map(String)) : null;
  const items = [...p.map.entries()].filter(([k, x]) => im.has(k) && needsGoal(im.get(k)!, im, known) && (keys ? keys.has(k) : high(x.sicherheit)) && (x.ziel === 'KEINS' ? x.begruendung.replace(/\s+/g, ' ').trim().length >= 5 : known.has(x.ziel) && goalLevel(x.ziel) !== 'Gate'))
    .map(([k, x]) => ({ key: k, goal: x.ziel, begruendung: x.begruendung, quelle: 'datei' }));
  // Vorschläge aus Specs nur einzeln (mode keys), nie mit „alle mit Sicherheit hoch“ — und nur, wo die Datei nichts anzeigt.
  if (keys) { const prop = await proposals(im, known, p); for (const k of keys) { const x = prop(k); if (x?.quelle === 'spec') items.push({ key: k, goal: x.ziel, begruendung: x.begruendung, quelle: 'spec' }); } }
  if (b.confirm !== true) return send(res, 200, { needsConfirm: true, items, file: p.file });
  const fromFile = items.filter((x) => x.quelle === 'datei'), computed = items.filter((x) => x.quelle === 'spec');
  const r1: any = fromFile.length ? await assignGoals(u, fromFile, im, true, 'vorschlag') : { results: [] };
  const r2: any = computed.length ? await assignGoals(u, computed, im, true, 'vorschlag-spec') : { results: [] };
  const r = { ok: true, results: [...r1.results, ...r2.results], toJira: goalsToJira() };
  send(res, 200, { ...r, imported: (r as any).results.filter((x: any) => x.ok).length });
});

on('GET', /^\/api\/goals\/history\/(.+)$/, async (req, res, m) => {
  await needUser(req);
  let key = '';
  try { key = decodeURIComponent(m[1]); } catch { throw new HttpError(400, 'Ungültiger Schlüssel.'); }
  send(res, 200, { entries: await goalHistory(key) });
});

// Spec lokal einem Ziel zuordnen (key = Spec-Pfad) — niemand muss 115 Frontmatter pflegen.
on('POST', /^\/api\/goals\/assign-spec$/, async (req, res) => {
  const u = await needUser(req);
  const b = await body(req);
  const sp = roadmapSpecs().find((x) => x.path === String(b.path ?? ''));
  if (!sp) throw new HttpError(404, 'Spec nicht gefunden.');
  const goal = String(b.goal ?? '').toUpperCase();
  const g = goalsAll(await issueMap());
  if (goal && (!g.byId.has(goal) || goalLevel(goal) === 'Gate')) throw new HttpError(400, `Unbekanntes Ziel ${goal}.`);
  const preview = `${sp.name} → ${goal || 'Workspace-Zuordnung zurücksetzen (Frontmatter ziel: gilt wieder)'}`;
  if (b.confirm !== true) return send(res, 200, { needsConfirm: true, preview });
  if (goal) await setGoal(u, sp.path, 'spec', goal, String(b.begruendung ?? '')); else await resetGoal(u, sp.path, 'spec');
  send(res, 200, { ok: true, preview });
});

on('GET', /^\/api\/goals\/([A-Za-z0-9-]{2,20})$/, async (req, res, m) => {
  await needUser(req);
  const id = m[1].toUpperCase();
  const im = await issueMap();
  const g = goalsAll(im);
  const n = g.byId.get(id);
  if (!n) throw new HttpError(404, `Ziel ${id} nicht in ${GOALS_FILE()} bzw. im Planning.`);
  // Tickets: direkt (Label/in der Zeile, Sub-tasks erben) und über Kindziele.
  const desc: GoalNode[] = [];
  const walk = (x: GoalNode) => { for (const c of x.children) { if (!desc.includes(c)) { desc.push(c); walk(c); } } };
  walk(n);
  const via = new Map<string, string>();
  const claim = (goalNode: GoalNode) => {
    // Label (auch geerbt) zuerst; nur in der Zielzeile genannt = „Beleg“ (zählt, trägt aber kein Label → bleibt „ohne Ziel“).
    for (const i of im.values()) if (!via.has(i.key) && effectiveGoals(i, im, knownGoals(g)).goals.includes(goalNode.id)) via.set(i.key, goalNode.id);
    for (const k of goalNode.tickets) if (im.has(k) && !via.has(k)) via.set(k, `${goalNode.id} · Beleg`);
  };
  claim(n); for (const d of desc) claim(d);
  const tickets = [...via.entries()].map(([k, v]) => ({ ...richIssue(im, im.get(k)!, knownGoals(g)), via: v }));
  const open = tickets.filter((t) => t.status !== 'Done' && t.statusCategory !== 'done');
  const perWs = new Map<string, { name: string; done: number; total: number }>();
  for (const t of tickets) { const w = perWs.get(t.workstream ?? '—') ?? { name: t.workstreamName, done: 0, total: 0 }; w.total++; if (t.status === 'Done' || t.statusCategory === 'done') w.done++; perWs.set(t.workstream ?? '—', w); }
  // Specs: Frontmatter ziel: oder über Tickets; PRs mit Live-Zustand.
  const keys = new Set(tickets.map((t) => t.key));
  const gh = await livePrs();
  const specs = roadmapSpecs(await assignments('spec')).filter((sp) => sp.goals.includes(id) || sp.tickets.some((k) => keys.has(k)))
    .map((sp) => ({ name: sp.name, title: sp.title, path: sp.path, topic: sp.topic, state: sp.state, via: sp.goals.includes(id) ? (sp.goalVia ?? 'ziel:') : 'Ticket', prs: sp.prs.map((pr) => { const l = gh.map.get(pr); return { pr, url: l?.url ?? `https://github.com/WirStrom1/${pr.replace('#', '/pull/')}`, live: l ? { conflict: l.mergeable === 'CONFLICTING', draft: l.isDraft, review: l.reviewDecision, turn: l.turn.who } : null }; }) }));
  send(res, 200, {
    goal: stripTree(n), file: GOALS_FILE(),
    history: g.ratings.filter((r) => r.id === id).sort((a, b) => a.date.localeCompare(b.date)),
    children: n.children.map((c) => ({ id: c.id, level: c.level, result: c.result, subtree: c.subtree, rating: c.rating, gaps: c.gaps })),
    parent: n.parent ? { id: n.parent, result: g.byId.get(n.parent)?.result ?? null } : null,
    tickets, specs,
    progress: { done: tickets.length - open.length, total: tickets.length },
    perWorkstream: [...perWs.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.total - a.total),
    risks: {
      overdue: open.filter((t) => t.overdue).map((t) => t.key),
      blocked: open.filter((t) => t.blockedBy.length).map((t) => t.key),
      noOwner: open.filter((t) => !t.assignee).map((t) => t.key),
      noDate: open.filter((t) => !t.duedate && !t.recurring).map((t) => t.key),
    },
  });
});

// --- Mein Tag / Timebox (privat je Person, kein Jira-Schreiben) ---

const tbCol = () => wb().collection('timebox');
const tbOut = (b: any) => ({ ...b, id: String(b._id), _id: undefined, userId: undefined });

on('GET', /^\/api\/timebox$/, async (req, res, _m, url) => {
  const u = await needUser(req);
  const from = url.searchParams.get('from') ?? vienna().date;
  const days = Math.min(7, Math.max(1, Number(url.searchParams.get('days') ?? 1)));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new HttpError(400, 'Datum im Format JJJJ-MM-TT.');
  const dates: string[] = [from];
  while (dates.length < days) dates.push(nextDay(dates.at(-1)!));
  const blocks = (await tbCol().find({ userId: u.id, date: { $in: dates } }).sort({ date: 1, start: 1 }).toArray()) as any[];
  const im = await issueMap();
  const cur = currentCycle(cycles());
  const sl = cur ? sprintLabel(cur.date) : null;
  const who = resolveIdentity(await jiraIdentity(u), [...im.values()]);
  // Tagespriorität des ersten Tages: je Ticket gesetzt (timebox_prio) oder die höchste seiner Blöcke an diesem Tag.
  // Gesetzte Ticket-Priorität gewinnt (auch „keine“); sonst die höchste der Blöcke dieses Tages. Tag = gewählter Tag (?day=).
  const pday = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('day') ?? '') ? url.searchParams.get('day')! : from;
  const dayPrio = new Map<string, number>();
  const explicit = new Set<string>();
  for (const p of (await wb().collection('timebox_prio').find({ userId: u.id, date: pday }).toArray()) as any[]) { explicit.add(p.key); if (p.prio) dayPrio.set(p.key, p.prio); }
  const pblocks = pday === from || dates.includes(pday) ? blocks : (await tbCol().find({ userId: u.id, date: pday }).toArray()) as any[];
  for (const b of pblocks) if (b.date === pday && b.key && b.prio && !explicit.has(b.key)) dayPrio.set(b.key, Math.min(b.prio, dayPrio.get(b.key) ?? 9));
  const mine = sortMyTickets([...im.values()].filter((i) => i.type !== 'Workstream' && i.status !== 'Done' && i.statusCategory !== 'done' && isMine(i, who)), sl, dayPrio, cur ? (t) => inSprint(t, cur.date) : undefined);
  const tbKnown = knownGoals(goalsAll(im));
  const ticket = (k?: string | null) => { const i = k ? im.get(k) : undefined; return i ? { key: i.key, summary: i.summary, status: i.status, goals: ownGoals(i), inSprint: !!cur && inSprint(i, cur.date), noGoal: needsGoal(i, im, tbKnown), priority: i.priority } : null; };
  send(res, 200, {
    dates, prioDay: pday, sprint: cur ? { id: cur.id, label: sl } : null,
    blocks: blocks.map((b) => ({ ...tbOut(b), ticket: ticket(b.key) })),
    summary: Object.fromEntries(dates.map((d) => [d, daySummary(blocks.filter((b) => b.date === d), im)])),
    tickets: mine.slice(0, 80).map((i) => ({ ...ticket(i.key)!, duedate: i.duedate, overdue: isOverdue(i), dayPrio: dayPrio.get(i.key) ?? null })),
    grid: { start: 7 * 60, end: 20 * 60, step: 15 },
  });
});

on('POST', /^\/api\/timebox$/, async (req, res) => {
  const u = await needUser(req);
  const r = cleanBlock(await body(req));
  if ('error' in r) throw new HttpError(400, r.error);
  if (r.ok.key && !(await issueMap()).has(r.ok.key)) throw new HttpError(404, 'Ticket nicht in der Kopie.');
  const doc = { ...r.ok, userId: u.id, state: r.ok.state ?? 'geplant', createdAt: new Date() };
  const ins = await tbCol().insertOne(doc as any);
  send(res, 200, { ok: true, id: String(ins.insertedId) });
});

on('PATCH', /^\/api\/timebox\/([0-9a-f]{24})$/, async (req, res, m) => {
  const u = await needUser(req);
  const r = cleanBlock(await body(req), true);
  if ('error' in r) throw new HttpError(400, r.error);
  const cur: any = await tbCol().findOne({ _id: new ObjectId(m[1]), userId: u.id });
  if (!cur) throw new HttpError(404, 'Block nicht gefunden.');
  if (r.ok.key && !(await issueMap()).has(r.ok.key)) throw new HttpError(404, 'Ticket nicht in der Kopie.');
  if ((r.ok.start ?? cur.start) + (r.ok.dur ?? cur.dur) > 24 * 60) throw new HttpError(400, 'Block geht über Mitternacht.');
  await tbCol().updateOne({ _id: cur._id, userId: u.id }, { $set: { ...r.ok, updatedAt: new Date() } });
  send(res, 200, { ok: true });
});

on('DELETE', /^\/api\/timebox\/([0-9a-f]{24})$/, async (req, res, m) => {
  const u = await needUser(req);
  await tbCol().deleteOne({ _id: new ObjectId(m[1]), userId: u.id });
  send(res, 200, { ok: true });
});

// Tagespriorität je Ticket (privat, nur Mongo): 1 Muss · 2 Soll · 3 Kann · null = keine.
on('POST', /^\/api\/timebox\/prio$/, async (req, res) => {
  const u = await needUser(req);
  const b = await body(req);
  const date = String(b.date ?? ''), key = String(b.key ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^[A-Z][A-Z0-9]+-\d+$/.test(key)) throw new HttpError(400, 'Datum und Ticket angeben.');
  const prio = b.prio === null || b.prio === undefined || b.prio === '' ? null : Number(b.prio);
  if (prio !== null && ![1, 2, 3].includes(prio)) throw new HttpError(400, 'Tagespriorität 1 (Muss), 2 (Soll), 3 (Kann) oder leer.');
  await wb().collection('timebox_prio').updateOne({ userId: u.id, date, key }, { $set: { prio, at: new Date() } }, { upsert: true });
  send(res, 200, { ok: true });
});

on('POST', /^\/api\/timebox\/carry$/, async (req, res) => {
  const u = await needUser(req);
  const date = String((await body(req)).date ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Datum im Format JJJJ-MM-TT.');
  const blocks = (await tbCol().find({ userId: u.id, date }).toArray()) as any[];
  const { copies, mark } = carryOver(blocks, date);
  // Atomar je Block markieren; nur wer die Markierung gewinnt, bekommt eine Kopie (zwei Klicks → keine Doppel).
  const won: typeof copies = [];
  for (let k = 0; k < mark.length; k++) {
    const r = await tbCol().updateOne({ _id: new ObjectId(mark[k]), userId: u.id, carriedTo: { $exists: false } }, { $set: { state: 'verschoben', carriedTo: nextDay(date) } });
    if (r.modifiedCount) won.push(copies[k]);
  }
  if (won.length) await tbCol().insertMany(won.map((c) => ({ ...c, createdAt: new Date() })) as any[]);
  send(res, 200, { ok: true, carried: won.length, to: nextDay(date) });
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
  // Ablage-Abgleich (Plan dateien-vollständig, S1): lädt der Ablage-Besitzer den Reiter, zieht das Register vorher nach
  // (höchstens alle 30 s; sonst übernimmt der Takt im Hintergrund).
  const owner = await ablageOwner().catch(() => null);
  if (owner?.id === u.id && Date.now() - lastSyncAt() > Number(process.env.WERKBANK_ABLAGE_SYNC_THROTTLE_MS ?? 30_000)) {
    try { const r = await syncAblage(owner); if (r.neu || r.verschoben || r.geaendert || r.geloescht || r.doppelt || r.schutz || r.skipped) log('ablage-abgleich', r); }
    catch (e: any) { log('ablage-abgleich', { error: String(e?.message ?? e).slice(0, 200) }); }
  }
  const { mine, shared } = await listFiles(u);
  const people = await teammates();
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? '?';
  const pids = [...new Set([...mine, ...shared].map((f: any) => f.projectId).filter(Boolean))];
  const projectNames = new Map((await wb().collection('projects').find({ _id: { $in: pids as any[] } }, { projection: { name: 1 } }).toArray()).map((p: any) => [p._id, p.name]));
  // `path` geht nur an die Besitzerin (Ablageort in Knuts Ordner); geteilte sehen den Namen, nicht den Ort.
  const shape = (f: any) => ({ ...f, id: f._id, path: undefined, ablage: undefined, projectName: f.projectId ? projectNames.get(f.projectId) ?? null : null, source: f.source ? { conv: f.source.conv } : undefined });
  const known = folders();
  const mineOut = [];
  for (const f of mine as any[]) {
    const pi = placeInfo(f);
    // Vorschlag für „Noch einzusortieren“; für abgelegte Dateien die zuletzt gewählten Angaben bzw. die aus Pfad und
    // Schema-Namen (für „Verschieben“, ohne Mongo-Abfrage je Datei — die Ablage hat Hunderte).
    const v = f.kind === 'vault' ? null : f.ablage ?? (f.path && !isEingang(f.path) ? vorschlagAusPfad(f.path) : null) ?? await suggestFor(f, known);
    const ort = f.kind !== 'vault' && f.path ? ortAus(f.path) : null;
    mineOut.push({ ...shape(f), sharedWithNames: f.sharedWith.map(name), ...pi, ort, vorschlag: v ? { ...v, name: schemaName(v, extname(f.name)) } : null });
  }
  const notice: any = await wb().collection('scratch_notice').findOne({ _id: u.id as any });
  const admin = u.role === 'ADMIN';
  send(res, 200, {
    mine: mineOut,
    shared: shared.map((f: any) => ({ ...shape(f), sharedWith: undefined, fehlt: placeInfo(f).fehlt })),
    maxMb: Math.round(cfg.fileMaxBytes / 1048576),
    ablage: { teams: [...new Set(known.map((x) => x.team))], folders: known, arten: ARTEN, besitzer: owner?.id === u.id, unklar: admin && !owner },
    scratch: notice ? { count: notice.count, bytes: notice.bytes, deleteFrom: notice.deleteFrom, files: notice.files, days: cfg.scratchDays } : null,
    backup: admin ? { nightly: listBackups(), keep: cfg.backupKeep, key: !!keyOf(), running: backupRunning() } : null,
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
  // Eine verschobene Vault-Notiz (oder eine fehlende Kopie) ist ein 404, kein Absturz des Prozesses (Review B2).
  if (!existsSync(filePath(f))) throw new HttpError(404, f.kind === 'vault' ? 'Die Notiz liegt nicht mehr an dieser Stelle im Vault.' : 'Datei nicht mehr vorhanden.');
  res.writeHead(200, {
    'content-type': 'application/octet-stream', 'x-content-type-options': 'nosniff',
    'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'content-security-policy': "sandbox; default-src 'none'", 'cache-control': 'no-store',
  });
  createReadStream(filePath(f)).on('error', () => res.destroy()).pipe(res);
});

// Agenten-Ergebnisse (Plan dateien-vollständig, S3): Review-Pakete der Haupt-Sitzung und der Stränge — nur Admins, nur lesen.
on('GET', /^\/api\/files\/agenten$/, async (req, res) => {
  const u = await needAdmin(req);
  const runs = await wb().collection('orchestrator_runs').find({ userId: u.id }, { projection: { title: 1, url: 1, prompt: 1, startedAt: 1, 'review.artefakte': 1, 'review.gemacht': 1 } }).sort({ startedAt: -1 }).limit(500).toArray().catch(() => []);
  const pakete = listPakete(cfg.reviewDir).map((p) => ({ ...p, strand: strandFor(p, runs as any[]) }));
  send(res, 200, { pakete, ordner: !!pakete.length || existsSync(cfg.reviewDir) });
});

on('GET', /^\/api\/files\/agenten\/(\d{1,4}-[a-z0-9][a-z0-9-]*)\/(.+)$/, async (req, res, m, url) => {
  await needAdmin(req);
  let rel = '';
  try { rel = m[2].split('/').map(decodeURIComponent).join('/'); } catch { throw new HttpError(400, 'Ungültiger Pfad.'); }
  const abs = paketFile(cfg.reviewDir, m[1], rel);
  if (!abs) throw new HttpError(404, 'Datei nicht gefunden.');
  const ext = extname(abs).toLowerCase();
  const name = rel.split('/').pop()!;
  if (url.searchParams.get('vorschau') === '1') {
    if (ext !== '.md' && ext !== '.txt') throw new HttpError(400, 'Vorschau nur für Markdown und Text.');
    const text = readFileSync(abs, 'utf8').slice(0, 512 * 1024);
    return send(res, 200, { name, html: ext === '.md' ? renderPaketMd(text, m[1], rel) : null, text: ext === '.txt' ? text : null });
  }
  const inline = url.searchParams.get('inline') === '1' && BILD_MIME[ext];
  res.writeHead(200, {
    'content-type': inline ? BILD_MIME[ext] : 'application/octet-stream', 'x-content-type-options': 'nosniff',
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
    'content-security-policy': "sandbox; default-src 'none'", 'cache-control': 'private, max-age=60',
  });
  createReadStream(abs).on('error', () => res.destroy()).pipe(res);
});

// Plan 81, Schnitt 2: „Ablegen“ — Vorschlag bestätigen oder ändern; die Datei zieht in `<team>/<vorgang>/` der Ablage.
on('POST', /^\/api\/files\/([0-9a-f-]{36})\/ablegen$/, async (req, res, m) => {
  const u = await needUser(req);
  send(res, 200, { ok: true, ...(await ablegen(u, m[1], await body(req))) });
});

// Plan 81, Schnitt 4: eine angekündigte Datei im Arbeitsordner behalten (Frist beginnt neu).
on('POST', /^\/api\/scratch\/keep$/, async (req, res) => {
  const u = await needUser(req);
  const b = await body(req);
  const rels: string[] = Array.isArray(b.rels) ? b.rels.map(String).slice(0, 200) : [String(b.rel ?? '')];
  const kept = rels.filter((r) => keepScratch(scratchDir(u), r)).length;
  await runScratch(u);
  send(res, 200, { ok: true, kept });
});

// Plan 81, Schnitt 5: Backup als Download, nur Admins. Gestreamt, nichts bleibt liegen.
on('GET', /^\/api\/backup$/, async (req, res) => {
  const u = await needAdmin(req);
  if (backupRunning()) throw new HttpError(409, 'Es läuft schon ein Backup — gleich noch einmal versuchen.');
  const day = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  res.writeHead(200, {
    'content-type': 'application/gzip', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store',
    'content-disposition': `attachment; filename="werkbank-backup-${day}.tar.gz"`,
  });
  logShare({ actor: u.email, action: 'backup', kind: 'backup', resource: day });
  try { const mf = await writeBackup(res); log('backup', { by: u.email, files: mf.files, encrypted: mf.encrypted, skipped: mf.skipped.length }); }
  catch (e: any) { log('backup', { error: String(e?.message ?? e).slice(0, 200) }); res.destroy(); }
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
  if (!existsSync(filePath(f))) throw new HttpError(404, f.kind === 'vault' ? 'Die Notiz liegt nicht mehr an dieser Stelle im Vault.' : 'Datei nicht mehr vorhanden.');
  const rel = copyToScratch(u, f);
  send(res, 200, { chatUrl: chatUrl(`Ich habe dir die Datei \`${rel}\` abgelegt („${f.name}“). Lies sie und sag mir kurz, was drinsteht.`) });
});

on('GET', /^\/api\/chats\/shared$/, async (req, res) => {
  const u = await needUser(req);
  send(res, 200, { withMe: await chatsSharedWithMe(u), byMe: await chatsSharedByMe(u) });
});

on('POST', /^\/api\/chats\/([A-Za-z0-9_-]{6,64})\/copy$/, async (req, res, m) => {
  const u = await needUser(req);
  const c = await copySharedChat(u, m[1]);
  send(res, 200, { ...c, chatUrl: chatUrl(`${c.owner} hat den Chat „${c.title}“ mit mir geteilt. Der Verlauf liegt unter \`${c.file}\`. Lies ihn und mach mit mir dort weiter, wo er aufhört — als neue, eigene Unterhaltung.`) });
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

// Orchestrator-Stränge (docs/plan-orchestrator-agents.md): nur über den internen Kanal (scripts/orch), nie aus dem Browser.
// Person: userId oder email (Vorgabe WERKBANK_PILOT_EMAIL = Knut); die Freigabeliste gilt.
async function orchPerson(req: IncomingMessage, b: any): Promise<User> {
  if (b.userId) return internalUser(req, b);
  const email = String(b.email || cfg.pilotEmail).toLowerCase();
  const d: any = await lc().collection('users').findOne({ email }, { projection: { _id: 1 } });
  return internalUser(req, { userId: d ? String(d._id) : '' });
}

on('POST', /^\/internal\/orchestrator\/(start|list|show|send|review|nachtbau)$/, async (req, res, m) => {
  const b = await body(req, 1 << 20);
  const u = await orchPerson(req, b);
  const id = String(b.id ?? '');
  switch (m[1]) {
    case 'start': {
      const r = await startOrch(u, { title: b.title, prompt: b.prompt, cwd: b.cwd, plan: b.plan || null, shared: b.shared === true, code: b.code === true, slug: b.slug || null, lauf: b.lauf || null });
      log('strang gestartet', { user: u.id, id: r.id, conv: r.conv, g0: r.g0?.ergebnis ?? null });
      return send(res, 200, r);
    }
    case 'nachtbau': {
      // Nachtbau (docs/plan-vorbau-check.md): je Item G0; Treffer → blocked_g0, nicht prüfbar → ein Morgeneintrag.
      const items = Array.isArray(b.items) ? b.items.slice(0, 50) : [];
      const r = await nachtbau(u, items);
      log('nachtbau', { user: u.id, items: r.map((x) => `${x.slug}:${x.status}`) });
      if (r.some((x) => x.status !== 'gestartet')) roadmapChanged('orchestrator-frage');
      return send(res, 200, { items: r });
    }
    case 'list': return send(res, 200, { strands: await listOrch(u, { all: b.all === true }) });
    case 'show': return send(res, 200, await showOrch(u, id));
    case 'send': return send(res, 200, await sendOrch(u, id, b.text, b.via === 'leitstand' ? 'leitstand' : 'hand'));
    case 'review': return send(res, 200, await reviewOrch(u, id, b.note ?? '', b.via === 'leitstand' ? 'leitstand' : 'knut'));
  }
});

// Leitstand (docs/plan-leitstand.md): Start nur über den internen Kanal, nur für Admins (startLeitstand prüft die Rolle).
on('POST', /^\/internal\/orchestrator\/leitstand\/start$/, async (req, res) => {
  const b = await body(req, 1 << 20);
  const u = await orchPerson(req, b);
  const r = await startLeitstand(u, { handoverText: b.handoverText || null });
  log('leitstand gestartet', { user: u.id, id: r.id, conv: r.conv, beendet: r.ended.length });
  return send(res, 200, r);
});

// Rückfragen an Knut: der Orchestrator fragt (intern), Knut antwortet in der Werkbank (unten, /api/orchestrator/…).
on('POST', /^\/internal\/orchestrator\/questions\/(ask|list|get|withdraw)$/, async (req, res, m) => {
  const b = await body(req);
  const u = await orchPerson(req, b);
  switch (m[1]) {
    case 'ask': {
      const q = await askKnut(u, { title: b.title, context: b.context, options: b.options, recommendation: b.recommendation, strand: b.strand || null, link: b.link || null, plan: b.plan || null, key: b.key || null, quelle: b.quelle || null });
      log('rückfrage an knut', { user: u.id, id: q.id, key: q.key });
      roadmapChanged('orchestrator-frage');
      return send(res, 200, q);
    }
    case 'list': return send(res, 200, { questions: await listQuestions(u, { open: b.open === true }) });
    case 'get': return send(res, 200, await getQuestion(u, String(b.id ?? '')));
    case 'withdraw': { const r = await withdrawQuestion(u, String(b.id ?? '')); roadmapChanged('orchestrator-frage'); return send(res, 200, r); }
  }
});

on('POST', /^\/internal\/session-start$/, async (req, res) => {
  const b = await body(req);
  const u = await internalUser(req, b);
  const r = await sessionStart(u, String(b.conv ?? ''), { eod: b.eod === true, skills: b.skills });
  log('kontext', { user: u.id, tokens: r.tokens, cached: r.cached, slot: r.slot, questions: r.questions.length });
  send(res, 200, r);
});

// Claude-Konten der Person für die Brücke (Klartext nur über diesen Kanal; chat = Schlüssel aus der Anfrage).
on('POST', /^\/internal\/claude-accounts$/, async (req, res) => {
  const u = await internalUser(req, await body(req));
  send(res, 200, { accounts: await claudeAccountsForBridge(u) });
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

/**
 * Die Rückfrage im Chat zeigt den Ticket-Titel, den das Modell mitgibt (summary). Stimmt er nicht mit der Kopie überein,
 * hätte die Person etwas anderes bestätigt, als geschrieben würde → ablehnen, nichts schreiben (Council 09.10.2026).
 */
const normTitle = (t: unknown) => String(t ?? '').toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim();
function titleMismatch(shown: unknown, actual: string): boolean {
  if (shown === undefined || shown === null || String(shown).trim() === '') return false;
  const a = normTitle(shown).replace(/…$/, ''), b = normTitle(actual);
  return !(b === a || (a.length >= 12 && b.startsWith(a)));
}

on('POST', /^\/internal\/jira-update$/, async (req, res) => {
  const b = await body(req);
  const u = await internalUser(req, b);
  const key = String(b.key ?? '');
  if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key)) throw new HttpError(400, 'Ungültiger Schlüssel.');
  const cur = (await allIssues()).find((i) => i.key === key);
  if (!cur) throw new HttpError(404, 'Ticket nicht in der Jira-Kopie (nur bestehende Tickets, keine neuen).');
  if (titleMismatch(b.summary, cur.summary)) throw new HttpError(409, `${key} heißt „${cur.summary}“, nicht „${String(b.summary).slice(0, 80)}“ — nichts geschrieben. Bitte mit dem richtigen Titel neu fragen.`);
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

// Tagesabschluss: mehrere Tickets mit EINER Rückfrage (die Brücke hat schon gefragt). Erst alle Schlüssel prüfen —
// ein unbekannter → nichts geschrieben. Dann der Reihe nach; ein Fehler bricht nicht ab, er steht je Ticket im Ergebnis.
on('POST', /^\/internal\/jira-update-many$/, async (req, res) => {
  const b = await body(req);
  const u = await internalUser(req, b);
  const changes: any[] = Array.isArray(b.changes) ? b.changes : [];
  if (!changes.length) throw new HttpError(400, 'Nichts zu tun.');
  if (changes.length > 25) throw new HttpError(400, 'Höchstens 25 Tickets auf einmal.');
  const all = await allIssues();
  const byKey = new Map(all.map((i) => [i.key, i]));
  // Nur eigene Tickets (Tagesabschluss = Durchgang über die eigenen): ein fremdes im Stapel → nichts geschrieben.
  // Schutz gegen Anweisungen aus Ticket-Texten, die das Modell beim Lesen gesehen hat (Council 09.10.2026).
  const who = resolveIdentity(await jiraIdentity(u), all);
  const keys = changes.map((c) => String(c?.key ?? ''));
  const twice = keys.find((k, n) => keys.indexOf(k) !== n);
  if (twice) throw new HttpError(400, `${twice} steht zweimal im Stapel — je Ticket ein Eintrag; nichts geschrieben.`);
  const plans = changes.map((c) => {
    const key = String(c?.key ?? '');
    if (String(c?.comment ?? '').length > 1500) throw new HttpError(400, `${key}: Kommentar über 1500 Zeichen (die Rückfrage zeigt nur so viel) — nichts geschrieben.`);
    if (!/^[A-Z][A-Z0-9]+-\d+$/.test(key)) throw new HttpError(400, `Ungültiger Schlüssel „${key.slice(0, 20)}“ — nichts geschrieben.`);
    const cur = byKey.get(key);
    if (!cur) throw new HttpError(404, `${key} ist nicht in der Jira-Kopie (nur bestehende Tickets) — nichts geschrieben.`);
    if (!isMine(cur, who)) throw new HttpError(403, `${key} gehört nicht dir (Owner: ${cur.assignee ?? 'niemand'}) — gesammelt nur eigene Tickets; nichts geschrieben.`);
    if (titleMismatch(c.summary, cur.summary)) throw new HttpError(409, `${key} heißt „${cur.summary}“, nicht „${String(c.summary).slice(0, 80)}“ — nichts geschrieben.`);
    const actions: any[] = [];
    if (c.comment) actions.push({ type: 'comment', text: String(c.comment) });
    if (c.status) actions.push({ type: 'status', to: String(c.status) });
    if (c.due !== undefined && c.due !== null) actions.push({ type: 'due', date: String(c.due) || null });
    if (!actions.length) throw new HttpError(400, `${key}: nichts zu tun — nichts geschrieben.`);
    return { key, actions };
  });
  // Frist (Council 09.10.2026): das Werkzeug wartet budgetMs; danach kein neues Ticket mehr anfangen, sondern als
  // „nicht versucht“ melden — sonst schriebe der Server weiter, während das Modell einen Fehler sieht und wiederholt.
  const budget = Math.min(Math.max(Number(b.budgetMs) || 300_000, 20_000), 300_000);
  const t0 = Date.now();
  const results: { key: string; ok: boolean; done: string[]; error?: string; skipped?: boolean }[] = [];
  for (const p of plans) {
    if (Date.now() - t0 >= budget - 20_000) { results.push({ key: p.key, ok: false, done: [], skipped: true, error: 'nicht versucht (Zeit) — erst Stand lesen, dann einzeln' }); continue; }
    try { results.push({ key: p.key, ok: true, done: await jiraWrite(u, () => applyActions(u, p.key, p.actions)) }); }
    catch (e: any) { results.push({ key: p.key, ok: false, done: [], error: String(e?.message ?? e).slice(0, 200) }); }
  }
  log('jira write (chat, gesammelt)', { user: u.id, n: plans.length, failed: results.filter((r) => !r.ok).length });
  send(res, 200, { ok: results.every((r) => r.ok), results });
});

// „Agent vorlaufen lassen“ aus dem Chat: neuer eigener Chat mit Agent auf dem Ticket — wie „Agent“ am Board.
on('POST', /^\/internal\/agent-start$/, async (req, res) => {
  const b = await body(req);
  const u = await internalUser(req, b);
  if (dryRun()) throw new HttpError(409, 'Vorschau (Trockenlauf): Agenten und Chats sind hier aus.');
  const i = (await issueMap()).get(String(b.key ?? ''));
  if (!i) throw new HttpError(404, 'Ticket nicht in der Kopie.');
  if (!(await getClaudeToken(u))) throw new HttpError(412, 'Noch kein Claude verbunden — unter „Einrichtung“ den Token aus `claude setup-token` eintragen.');
  const r = await startTicketAgent(u, i, String(b.note ?? '').slice(0, 2000));
  log('agent chat (aus chat)', { user: u.id, key: i.key, conv: r.conv });
  send(res, 200, r);
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
    if (!res.headersSent) send(res, status, { error: status >= 500 && !known ? 'Interner Fehler.' : e.message, ...(e instanceof JiraWriteError ? { code: e.code } : {}), ...(e.g0 ? { g0: e.g0 } : {}), ...(e.existing ? { existing: e.existing } : {}) });
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
      await applyAutoGoals(await issueMap());
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

  // Plan 81, Schnitt 3: was ein Agent fertig geschrieben hat, landet von selbst in „Meine Dateien“ (Vault-Notizen als
  // Link, Dateien aus dem Arbeitsordner als Kopie); die Workstream-Übersichten der berührten Projekte ziehen nach.
  let filesTickRunning = false;
  const filesTick = async () => {
    if (filesTickRunning) return; // ein Lauf zur Zeit — zwei gleichzeitige legten doppelte Einträge an (Review S2)
    filesTickRunning = true;
    try {
      const touched = new Set<string>();
      for (const person of (await teammates()).filter((x) => allowed(x.email))) {
        try {
          const r = await fetch(`${cfg.bridgeUrl}/sessions?user=${encodeURIComponent(person.id)}`, { headers: { 'x-werkbank-internal': process.env.WERKBANK_INTERNAL_TOKEN ?? '' }, signal: AbortSignal.timeout(5000) });
          if (!r.ok) continue;
          const sessions = ((await r.json()) as any).sessions ?? [];
          const { changed, projects } = await ingestSessions(person, sessions);
          await noteFinishedRuns(person, sessions);
          if (changed) log('agenten-dateien', { user: person.id, changed });
          for (const id of projects) touched.add(id);
        } catch (e: any) { log('agenten-dateien', { user: person.id, error: String(e?.message ?? e).slice(0, 200) }); } // nur diese Person
      }
      if (touched.size) {
        const im = await issueMap();
        for (const id of touched) {
          const pr: any = await wb().collection('projects').findOne({ _id: id as any });
          const ws = pr?.workstream ? im.get(pr.workstream) : undefined;
          if (ws) await syncWorkstreamOverview(ws, im).catch((e) => log('workstream-übersicht fehlgeschlagen', { ws: ws.key, error: String(e?.message ?? e).slice(0, 160) }));
        }
      }
      // Gezielter Roadmap-Nachzug nach fertigen Karten-Läufen (höchstens alle 20 min, Plan Roadmap-Automatik S2).
      roadmapPrimed = true;
      await tryStartSync();
    } catch (e: any) { log('agenten-dateien', { error: String(e?.message ?? e).slice(0, 200) }); }
    finally { filesTickRunning = false; }
  };
  setTimeout(filesTick, 20_000);
  setInterval(filesTick, 2 * 60_000);

  // Ablage-Abgleich (Plan dateien-vollständig, S1): das Register folgt der Ablage — neu, verschoben, gelöscht.
  const ablageTick = async () => {
    try {
      const owner = await ablageOwner();
      if (!owner) return;
      const r = await syncAblage(owner);
      if (r.neu || r.verschoben || r.geaendert || r.geloescht || r.doppelt || r.schutz || r.skipped) log('ablage-abgleich', r);
    } catch (e: any) { log('ablage-abgleich', { error: String(e?.message ?? e).slice(0, 200) }); }
  };
  setTimeout(ablageTick, 30_000);
  setInterval(ablageTick, 5 * 60_000);

  // Plan 81, Schnitt 4 und 5: Arbeitsordner aufräumen (Ankündigung, dann löschen) und Nachtarchiv — stündlich geprüft.
  const houseTick = async () => {
    for (const person of (await teammates().catch(() => [])).filter((x) => allowed(x.email))) {
      try { const r = await runScratch(person); if (r.removed || r.skipped) log('arbeitsordner', { user: person.id, ...r }); }
      catch (e: any) { log('arbeitsordner', { user: person.id, error: String(e?.message ?? e).slice(0, 200) }); }
    }
    try { const p = await nightly(); if (p) log('backup nachts', { file: p }); } catch (e: any) { log('backup nachts', { error: String(e?.message ?? e).slice(0, 200) }); }
  };
  setTimeout(houseTick, 60_000);
  setInterval(houseTick, 60 * 60_000);

  // Werkbank-Feed für den Vault-Sync-Snapshot und Abgleich der Freigaben mit dem Protokoll (alle 5 min).
  const roadmapTick = async () => {
    try { await writeRoadmapFeed(); await writeApprovals(); } catch (e: any) { log('roadmap-feed', { error: String(e?.message ?? e).slice(0, 160) }); }
  };
  setTimeout(roadmapTick, 30_000);
  setInterval(roadmapTick, 5 * 60_000);
  // Neues Protokoll (Fragen, „erledigt“) oder neuer Entwurf → offene Roadmap-Seiten laden nach (Review 6); dazu
  // fällige Starts, die eine Sperre aufgehalten hat.
  let seen = '';
  setInterval(() => {
    const now = `${mtime(join(cfg.vaultDir, SYNC_PROTOCOL))}|${mtime(join(cfg.vaultDir, WORK_DRAFT))}`;
    if (seen && now !== seen) { roadmapChanged('protokoll'); writeApprovals().catch(() => {}); }
    seen = now;
    if (roadmapQueue.full || roadmapQueue.pending.size) tryStartSync().catch(() => {});
  }, 60_000);
}

await connect();
mkdirSync(cfg.dataDir, { recursive: true });
// Plan 81, Schnitt 1: alter Speicher → Ablage, einmalig und idempotent (nur Einträge ohne `path`).
migrateLegacy(log).catch((e) => log('ablage-umzug', { error: String(e?.message ?? e).slice(0, 200) }));
server.listen(cfg.port, cfg.host, () => log('listening', { host: cfg.host, port: cfg.port, demo: cfg.demo, vault: cfg.vaultDir }));
if (process.env.WERKBANK_NO_JOBS !== '1') backgroundJobs();
// Orchestrator-Stränge selbst fortsetzen (docs/plan-orchestrator-auto-weiter.md) — eigener Takt, auch ohne Hintergrundjobs.
// „Konto frei“ nur mit Antwort der Brücke und mindestens zwei Konten (sonst wartet `rate_limit` die 30 min ab).
const orchDeps = {
  userById: async (id: string) => { const u = await userById(id); return u && allowed(u.email) ? u : null; },
  accountFree: async (u: User) => {
    const list = await listClaudeAccounts(u);
    if (list.length < 2) return false;
    const r = await fetch(`${cfg.bridgeUrl}/internal/accounts-state?user=${encodeURIComponent(u.id)}`, { headers: bridgeInternal, signal: AbortSignal.timeout(1500) });
    if (!r.ok) return false;
    const ex: Record<string, number> = ((await r.json()) as any).exhausted ?? {};
    return list.some((a: any) => !(ex[a.id] > Date.now()));
  },
  log,
};
startAutoWeiter(orchDeps);
// Stand je Strang festschreiben (Teil B, G1) — unabhängig vom Auto-Fortsetzen; ORCH_STATUS=off schaltet ab.
startStatusTick(orchDeps);
// Leitstand wecken (Plan 132, S2): eigener Durchgang im selben Takt; LEITSTAND_WAKE=off schaltet ab.
startLeitstandTick(orchDeps);
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { server.close(); process.exit(0); });
