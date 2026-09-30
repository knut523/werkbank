// Kontext-Paket + Task-Hygiene je Person: gemeinsam genutzt von der Oberfläche (Board, Sprint,
// Einrichtung) und der Brücke (Sitzungsstart, Werkzeuge jira_update / hygiene_snooze).

import { writeJira, canWriteJira, takeMcpHint, MCP_HELP, type JiraAction } from './jirawrite.ts';
import { cfg, sprintRoot, WB_ROOT } from './config.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { wb } from './db.ts';
import { jiraIdentity, jiraCreds } from './creds.ts';
import { buildPack, inputsHash, approxTokens, hygieneBlock } from './context.ts';
import { hygieneFor, freshState, pickQuestions, snooze, slotFor, touchedToday, vienna, type HygieneItem, type HygieneState } from './hygiene.ts';
import { actionsFromText } from './syncplan.ts';
import { addComment, transitionTo, setDueDate, refreshIssue, type Issue } from './jira.ts';
import type { User } from './auth.ts';
import { listSkills } from './skills.ts';
import { toolDefs } from '../mcp/vault-tools.ts';

// ---------- Schätzungen: was kostet der feste Teil einer Sitzung? ----------

let skillCache: { at: number; rows: { name: string; tokens: number }[] } = { at: 0, rows: [] };
function skillRows() {
  if (Date.now() - skillCache.at > 600_000) {
    // Die Skill-Liste im Prompt enthält je Skill Name + Beschreibung.
    skillCache = { at: Date.now(), rows: listSkills(cfg.skillsSource, cfg.skillsTarget).filter((x) => x.state !== 'fehlt' && x.state !== 'kaputter Link').map((x) => ({ name: x.name, tokens: approxTokens(`- ${x.name}: ${x.description}\n`) })) };
  }
  return skillCache.rows;
}
export function skillEstimate(allow: unknown): { skillsTokens: number; allSkillsTokens: number; skillsCount: number } {
  const rows = skillRows();
  const all = rows.reduce((a, r) => a + r.tokens, 0);
  if (!Array.isArray(allow)) return { skillsTokens: all, allSkillsTokens: all, skillsCount: rows.length };
  const sel = rows.filter((r) => allow.includes(r.name));
  return { skillsTokens: sel.reduce((a, r) => a + r.tokens, 0), allSkillsTokens: all, skillsCount: sel.length };
}
const WERKBANK_TOOL_SCHEMAS = 3 * 90;   // hygiene_list, hygiene_snooze, jira_update (klein)
export const toolsEstimate = () => approxTokens(JSON.stringify(toolDefs({ vaultDir: cfg.vaultDir }).map(({ run, ...d }) => d))) + WERKBANK_TOOL_SCHEMAS;

const today = () => vienna().date;   // Tagesgrenze in Wien

export async function allIssues(): Promise<Issue[]> {
  return (await wb().collection('jira_issues').find({}, { projection: { _id: 0 } }).toArray()) as unknown as Issue[];
}

export async function hygieneOf(u: User): Promise<{ items: HygieneItem[]; snoozed: string[] }> {
  const [issues, who] = await Promise.all([allIssues(), jiraIdentity(u)]);
  const st = await loadState(u);
  return { items: hygieneFor(issues, who, { staleDays: Number(process.env.WERKBANK_STALE_DAYS || 7) }), snoozed: st.snoozed };
}

async function loadState(u: User): Promise<HygieneState> {
  const d: any = await wb().collection('hygiene_state').findOne({ _id: u.id as any });
  return freshState(d?.state, today());
}
async function saveState(u: User, state: HygieneState) {
  await wb().collection('hygiene_state').updateOne({ _id: u.id as any }, { $set: { state } }, { upsert: true });
}

export async function snoozeItem(u: User, key: string) {
  await saveState(u, snooze(await loadState(u), key));
}

// ---------- Kontext-Paket (zwischengespeichert) ----------

const cache = new Map<string, { hash: string; pack: string }>();

export async function packFor(u: User): Promise<{ pack: string; cached: boolean }> {
  const [issues, who] = await Promise.all([allIssues(), jiraIdentity(u)]);
  const inp = { vaultDir: cfg.vaultDir, projectsDir: sprintRoot(), issues, who, userName: u.name.split(' ')[0] };
  const hash = inputsHash(inp);
  const c = cache.get(u.id);
  if (c && c.hash === hash) return { pack: c.pack, cached: true };
  const pack = buildPack(inp);
  cache.set(u.id, { hash, pack });
  return { pack, cached: false };
}

/**
 * Sitzungsstart (Brücke, nur neue Sitzungen): Paket, und — nur zu Tagesbeginn und Tagesabschluss —
 * höchstens 3 Pflegefragen. Gemessen (Tokens, ohne Inhalt) in werkbank.context_log.
 */
export async function sessionStart(u: User, conv: string, opts: { eod?: boolean; skills?: unknown } = {}) {
  const { pack, cached } = await packFor(u);
  const { items } = await hygieneOf(u);
  const st = await loadState(u);
  const slot = st.sessions[conv] ? null : slotFor(st, vienna().hour, !!opts.eod);
  let pool = items;
  if (slot === 'abend' || (st.sessions[conv] && st.slots?.abend === conv)) {
    const [issues, who] = await Promise.all([allIssues(), jiraIdentity(u)]);
    pool = [...touchedToday(issues, who, today()), ...items];
  }
  // Knut, 29.09. (Entscheidung 12): Pflegefragen nur mit verbundenem Jira-MCP — sonst nur Badges und
  // ein einmaliger Hinweis, dass die Fragen ausfallen und wie man den MCP verbindet.
  const writable = await canWriteJira(u);
  const r = pickQuestions(pool, st, conv, writable ? slot : null);
  await saveState(u, r.state);
  const hint = !writable && slot && items.length && await takeMcpHint(u)
    ? `### Hinweis an die Person (einmalig, kurz am Ende deiner ersten Antwort)\nDu hast ${items.length} offene Pflegepunkte an deinen Tickets (Board: 🧹). Ich frage dazu nicht nach, solange dein Jira-MCP nicht verbunden ist — ${MCP_HELP}`
    : '';
  const text = [pack, hygieneBlock(r.picked, items.length, r.slot), hint].filter(Boolean).join('\n\n');
  const tokens = approxTokens(text);
  await wb().collection('context_log').insertOne({
    userId: u.id, conv: conv.slice(0, 64), at: new Date(), tokens, packTokens: approxTokens(pack), questions: r.picked.length, slot: r.slot, cached,
    ...skillEstimate(opts.skills), ownToolsTokens: toolsEstimate(),
  });
  return { text, tokens, cached, slot: r.slot, questions: r.picked.map((i) => ({ key: i.key, rule: i.rule })) };
}

export async function contextStats(u: User) {
  const rows = await wb().collection('context_log').find({ userId: u.id }, { projection: { _id: 0, userId: 0 } }).sort({ at: -1 }).limit(20).toArray();
  const { pack, cached } = await packFor(u);
  let core: string[] = [];
  try { core = JSON.parse(readFileSync(join(WB_ROOT, 'claude-bridge', 'skills-core.json'), 'utf8')).core; } catch { /* egal */ }
  const est = skillEstimate(core);
  return {
    recent: rows,
    current: { tokens: approxTokens(pack), cached, pack },
    fixed: { skillsCore: est.skillsTokens, skillsCoreCount: est.skillsCount, skillsAll: est.allSkillsTokens, skillsAllCount: skillRows().length, ownTools: toolsEstimate() },
  };
}

export async function recordMeasure(u: User, conv: string, measured: Record<string, number>) {
  const clean = Object.fromEntries(Object.entries(measured ?? {}).filter(([, v]) => typeof v === 'number').slice(0, 10));
  await wb().collection('context_log').updateOne({ userId: u.id, conv: conv.slice(0, 64) }, { $set: { measured: clean } });
}

// ---------- Antwort → Jira-Aktion ----------

export async function proposeFromAnswer(u: User, key: string, answer: string) {
  const issues = await allIssues();
  const cur = issues.find((i) => i.key === key);
  if (!cur) throw Object.assign(new Error('Ticket nicht in der Kopie.'), { status: 404 });
  if (/^\s*(später|spaeter|morgen|nicht jetzt)\b/i.test(answer)) return { snooze: true, actions: [] };
  const d = today().split('-').reverse().join('.');
  const r = actionsFromText(answer.trim(), cur, `${u.name.split(' ')[0]} (Task-Pflege, ${d})`);
  return { snooze: false, ...r };
}

export async function applyActions(u: User, key: string, actions: { type: string; text?: string; to?: string; date?: string | null }[]) {
  // Geschrieben wird über den Atlassian-MCP der Person (jirawrite.ts), gelesen mit dem Lesezugang.
  return (await writeJira(u, key, actions as JiraAction[])).done;
}

/** Board: welche Karten brauchen Pflege (für alle Owner, je Owner-Identität gerechnet). */
export function hygieneAll(issues: Issue[]): Map<string, string[]> {
  const owners = new Map<string, string | null | undefined>();
  for (const i of issues) if (i.assignee) owners.set(i.assignee, i.assigneeId);
  const out = new Map<string, string[]>();
  for (const [name, id] of owners) {
    for (const h of hygieneFor(issues, { displayName: name, accountId: id ?? null, name }, { staleDays: Number(process.env.WERKBANK_STALE_DAYS || 7) })) {
      out.set(h.key, [...(out.get(h.key) ?? []), h.rule]);
    }
  }
  return out;
}
