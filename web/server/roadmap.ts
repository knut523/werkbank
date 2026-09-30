// Roadmap-Sektion (Knut, 29.09.: „Produkt-Roadmap in einer eigenen Sektion besser aufbereiten —
// Priorisierung und PR-Review …“). Quellen nur im Vault (lesend), Regeln aus dem Skill olaf-produkt-roadmap:
//   0-Overview/priorisierung-roadmap-produkt-olaf.md   Rangliste (WSJF-leicht, erzeugt von scripts/rank.py)
//   0-Overview/pr-stand-produkt-olaf.md                PR-Register
//   <Thema>/<n-Zustand>/*.md                           Specs, darin offene Entscheidungen „- Knut:“
//   scripts/roadmap_check.py                           Konsistenz (nur lesend)
// Geschrieben wird nur nach Bestätigung: eine Antwort in eine leere „- Knut:“-Zeile oder ein Rang-Vorschlag
// als Zeile auf der Priorisierungsseite (die Rangliste selbst rechnet rank.py in der Hauptsitzung neu).

import { hashText } from './sprint.ts';

// ---------- offene Entscheidungen ----------

export interface Decision { line: number; question: string; section: string; open: boolean; answer: string }

const KNUT = /^((?:> ?)*)(\s*)[-*]\s+Knut:\s*(.*)$/;

export function parseDecisions(text: string): Decision[] {
  const lines = text.split('\n');
  const out: Decision[] = [];
  let section = '';
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^(```|~~~)/.test(l)) { inCode = !inCode; continue; }
    if (inCode) continue;
    const h = l.match(/^#{2,4}\s+(.+)$/);
    if (h) { section = h[1].trim(); continue; }
    const m = l.match(KNUT);
    if (!m) continue;
    const prefix = m[1];
    const indent = m[2].length;
    // Frage = der übergeordnete Listenpunkt (weniger eingerückt) samt Folgezeilen bis zur Knut-Zeile.
    const q: string[] = [];
    for (let j = i - 1; j >= 0; j--) {
      const raw = lines[j].replace(/^(?:> ?)*/, '');
      if (!raw.trim() || /^#{1,6}\s/.test(raw) || /^\[!/.test(raw.trim())) break;
      if (KNUT.test(lines[j]) || /^\s*[-*]\s+[A-ZÄÖÜ][\wäöüß]+:\s/.test(raw) && raw.search(/\S/) >= indent) { if (q.length) break; continue; }
      q.unshift(raw.trim());
      const ind = raw.search(/\S/);
      if (/^\s*([-*]|\d+\.)\s/.test(raw) && ind < indent) break;
      if (!/^\s/.test(raw) && !/^\s*([-*]|\d+\.)\s/.test(raw)) break;   // Absatzanfang
    }
    const question = q.join(' ').replace(/^([-*]|\d+\.)\s+/, '').replace(/\s+/g, ' ').trim();
    out.push({ line: i + 1, question, section, open: !m[3].trim(), answer: m[3].trim() });
    void prefix;
  }
  return out;
}

export function fillDecision(text: string, line: number, answer: string, expectHash: string) {
  if (hashText(text) !== expectHash) throw new Error('Die Notiz hat sich inzwischen geändert — bitte neu laden.');
  const clean = answer.replace(/\s*\n\s*/g, ' ').replace(/<!--/g, '').trim();
  if (!clean) throw new Error('Leere Antwort.');
  const lines = text.split('\n');
  const m = lines[line - 1]?.match(KNUT);
  if (!m) throw new Error('Zeile nicht gefunden — die Notiz hat sich geändert.');
  if (m[3].trim()) throw new Error('Diese Entscheidung ist schon beantwortet.');
  const before = lines[line - 1];
  const after = `${m[1]}${m[2]}- Knut: ${clean}`;
  lines[line - 1] = after;
  return { text: lines.join('\n'), before, after, line };
}

// ---------- Rangliste ----------

export interface RankRow { rank: number; spec: string; topic: string; state: string; gw: number; zk: number; rr: number; cod: number; size: number; wsjf: number; cat: string; blocked: string; next: string; line?: number }

const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());

export function parseRankTable(text: string): RankRow[] {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^\|\s*Rang\s*\|\s*Spec\s*\|/.test(l));
  if (start < 0) return [];
  const out: RankRow[] = [];
  for (let i = start + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const c = cells(lines[i]);
    if (c.length < 13) continue;
    const n = (s: string) => Number(s.replace(',', '.')) || 0;
    out.push({ rank: n(c[0]), spec: c[1].replace(/^\[\[|\]\]$/g, '').split('|')[0], topic: c[2], state: c[3], gw: n(c[4]), zk: n(c[5]), rr: n(c[6]), cod: n(c[7]), size: n(c[8]), wsjf: n(c[9]), cat: c[10], blocked: c[11], next: c[12], line: i + 1 });
  }
  return out;
}

/** „N. **kurzname** — Begründung“ (auch mehrzeilig) → kurzname → Text. */
export function parseReasons(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^\d+\.\s+\*\*([^*]+)\*\*\s+—\s+([\s\S]*?)(?=\n\d+\.\s+\*\*|\n#{2,4}\s|\n\n|$)/gm;
  for (const m of text.matchAll(re)) out.set(m[1].trim(), m[2].replace(/\s+/g, ' ').trim());
  return out;
}

export function addRankProposal(text: string, p: { spec: string; from: number; to: number; why: string; who: string; date: string }): string {
  const line = `- ${p.who} (${p.date}): [[${p.spec}]] Rang ${p.from} → ${p.to}${p.why.trim() ? ` — ${p.why.replace(/\s+/g, ' ').trim()}` : ''}`;
  const head = '## Vorschläge aus der Werkbank';
  if (!text.includes(`\n${head}\n`)) return `${text.replace(/\n*$/, '')}\n\n${head}\n\n${line}\n`;
  return `${text.replace(/\n*$/, '')}\n${line}\n`;
}

// ---------- PRs ----------

const REPO: Record<string, string> = { admin: 'olaf-admin', 'tariff-app': 'olaf-tariff-app', 'calc-api': 'olaf-calc-api', 'durable-func': 'olaf-durable-func', umbrella: 'olaf-umbrella', docs: 'olaf-docs' };

export function prRefs(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/github\.com\/[\w.-]+\/([\w.-]+)\/pull\/(\d+)/g)) out.add(`${m[1]}#${m[2]}`);
  for (const m of text.matchAll(/\b(admin|tariff-app|calc-api|durable-func|umbrella|docs)\s?#(\d+)/g)) out.add(`${REPO[m[1]]}#${m[2]}`);
  return [...out];
}

/** Zeilen des PR-Registers, deren erste Spalte einen PR nennt (Tabellen), mit den Spaltenköpfen. */
export function parsePrRegister(text: string): { pr: string; section: string; cols: Record<string, string> }[] {
  const lines = text.split('\n');
  const out: { pr: string; section: string; cols: Record<string, string> }[] = [];
  let section = '';
  let head: string[] | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const h = l.match(/^#{2,4}\s+(.+)$/);
    if (h) { section = h[1].trim(); head = null; continue; }
    if (!l.startsWith('|')) { head = null; continue; }
    if (!head) { head = cells(l); i++; continue; }
    const c = cells(l);
    const refs = prRefs(c[0].replace(/\*\*/g, '')) ;
    const bare = c[0].match(/^\*{0,2}#(\d+)/);
    const repoFromSection = Object.values(REPO).find((r) => section.includes(r));
    const pr = refs[0] ?? (bare && repoFromSection ? `${repoFromSection}#${bare[1]}` : null);
    if (!pr) continue;
    out.push({ pr, section, cols: Object.fromEntries(head.map((k, j) => [k, c[j] ?? ''])) });
  }
  return out;
}

// ---------- Konsistenz ----------

export function parseCheck(out: string) {
  const findings: { check: string; level: 'ERROR' | 'WARN'; text: string }[] = [];
  let check = '';
  for (const l of out.split('\n')) {
    const h = l.match(/^\[(\w+)\]\s+\d+ finding/);
    if (h) { check = h[1]; continue; }
    const f = l.match(/^\s+(ERROR|WARN)\s+(.*)$/);
    if (f && check) findings.push({ check, level: f[1] as 'ERROR' | 'WARN', text: f[2].trim() });
  }
  const sum = out.match(/(\d+) error\(s\), (\d+) warning\(s\)/);
  return { findings, errors: sum ? Number(sum[1]) : findings.filter((f) => f.level === 'ERROR').length, warnings: sum ? Number(sum[2]) : findings.filter((f) => f.level === 'WARN').length };
}

// ---------- Thema → Rang, Swimlanes, „Als Nächstes“, Konsistenz (Knut, 30.09.) ----------

export const KANBAN_STATES = ['1-Backlog', '2-Pre-Plan', '3-Plan', '4-Review', '5-Live'];
const IN_WORK = new Set(['4-Review', '5-Live', '6-Archive']);

export interface SpecInfo {
  name: string; topic: string; state: string; title: string; path: string;
  tickets: { key: string; status: string | null; summary?: string | null }[];
  prs: string[]; jiraKey: boolean; rank?: number | null; [k: string]: unknown;
}

const ticketDone = (t: { status: string | null }) => t.status === 'Done';
const ticketActive = (t: { status: string | null }) => t.status === 'In Progress' || t.status === 'Ongoing';

/**
 * Aus Specs (Ordner = Thema/Zustand) und Rangtabelle: Priorisierung je Thema (nach Rang, unpriorisierte unten),
 * Swimlanes Thema × Zustand (nach Rang sortiert), „Als Nächstes“ (Top 5, Sprint-Zuordnung zuerst) und Widersprüche.
 */
export function roadmapInsights(specs: SpecInfo[], ranking: (Pick<RankRow, 'rank' | 'spec' | 'topic'> & Record<string, any>)[], opts: { sprintTickets?: Set<string>; top?: number } = {}) {
  const byName = new Map(specs.map((s) => [s.name, s]));
  const rankOf = new Map(ranking.map((r) => [r.spec, r.rank]));
  for (const s of specs) s.rank = rankOf.get(s.name) ?? null;
  const byRank = (a: SpecInfo, b: SpecInfo) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.title.localeCompare(b.title, 'de');

  // Priorisierung: Thema aus dem Ordner (die Tabelle schreibt z. B. „Service“ statt „Service-View“), sonst aus der Tabelle.
  const topics = new Map<string, { topic: string; ranked: any[]; unranked: SpecInfo[] }>();
  const topicOf = (t: string) => { if (!topics.has(t)) topics.set(t, { topic: t, ranked: [], unranked: [] }); return topics.get(t)!; };
  for (const r of [...ranking].sort((a, b) => a.rank - b.rank)) {
    const sp = byName.get(r.spec);
    topicOf(sp?.topic ?? r.topic).ranked.push({ ...r, path: sp?.path ?? null, folderState: sp?.state ?? null });
  }
  for (const s of specs) if (s.rank == null && !IN_WORK.has(s.state) && KANBAN_STATES.includes(s.state)) topicOf(s.topic).unranked.push(s);
  for (const t of topics.values()) t.unranked.sort(byRank);
  const prioTopics = [...topics.values()].sort((a, b) => (a.ranked[0]?.rank ?? 1e9) - (b.ranked[0]?.rank ?? 1e9) || a.topic.localeCompare(b.topic, 'de'));

  // Swimlanes Thema × Zustand
  const laneMap = new Map<string, Record<string, SpecInfo[]>>();
  for (const s of specs) {
    if (!KANBAN_STATES.includes(s.state)) continue;
    const l = laneMap.get(s.topic) ?? Object.fromEntries(KANBAN_STATES.map((k) => [k, [] as SpecInfo[]]));
    l[s.state].push(s);
    laneMap.set(s.topic, l);
  }
  const lanes = [...laneMap.entries()].map(([topic, states]) => {
    for (const k of KANBAN_STATES) states[k].sort(byRank);
    const best = Math.min(...Object.values(states).flat().map((s) => s.rank ?? 1e9));
    return { topic, states, best };
  }).sort((a, b) => a.best - b.best || a.topic.localeCompare(b.topic, 'de'));

  // Als Nächstes: höchster Rang, noch nicht in Arbeit; zum aktuellen Sprint gehörig (Ticket mit Sprint-Label) zuerst.
  const sprint = opts.sprintTickets ?? new Set<string>();
  const cands = ranking.map((r) => ({ r, s: byName.get(r.spec) })).filter(({ s }) => s && !IN_WORK.has(s.state) && !s.tickets.some((t) => ticketDone(t) || ticketActive(t)))
    .map(({ r, s }) => ({ ...r, path: s!.path, folderState: s!.state, topic: s!.topic, title: s!.title, tickets: s!.tickets, inSprint: s!.tickets.some((t) => sprint.has(t.key)) }));
  const nextUp = [...cands].sort((a, b) => Number(b.inSprint) - Number(a.inSprint) || a.rank - b.rank).slice(0, opts.top ?? 5);

  // Konsistenz: Zustandsordner gegen Jira-Status
  const consistency: { spec: string; path: string; topic: string; state: string; ticket: string; status: string | null; kind: string; level: 'Widerspruch' | 'Hinweis' }[] = [];
  for (const s of specs) {
    for (const t of s.tickets) {
      if (!t.status) continue;
      const base = { spec: s.name, path: s.path, topic: s.topic, state: s.state, ticket: t.key, status: t.status };
      if (s.state === '5-Live' && !ticketDone(t)) consistency.push({ ...base, kind: 'Spec live, Ticket offen', level: 'Widerspruch' });
      else if (s.state === '4-Review' && !ticketDone(t)) consistency.push({ ...base, kind: 'Spec in Review, Ticket offen', level: 'Hinweis' });
      else if (['1-Backlog', '2-Pre-Plan', '3-Plan'].includes(s.state) && ticketDone(t)) consistency.push({ ...base, kind: 'Ticket erledigt, Spec nicht in Review/Live', level: 'Widerspruch' });
    }
  }
  const withoutJira = specs.filter((s) => !s.jiraKey && KANBAN_STATES.includes(s.state)).sort(byRank);
  return { prioTopics, lanes, nextUp, consistency, withoutJira };
}

// ---------- Spec-Ordnung (Knut, 30.09., Runde 6) — Regeln aus dem Skill olaf-produkt-roadmap ----------

export const domainOf = (topic: string) => (topic === 'Service-View' ? 'Service' : topic);
export const stateSlug = (state: string) => state.replace(/^\d-/, '').toLowerCase();
const STATUS = ['current', 'proposed', 'accepted', 'superseded', 'deprecated', 'archived', 'draft'];
const FM_REQUIRED = ['title', 'type', 'team', 'status', 'created', 'last-verified', 'tags', 'sources', 'domain', 'lifecycle'];

export interface SpecCheck {
  fm: { ok: boolean; missing: string[]; problems: string[] };
  jira: boolean; goal: { ok: boolean; via: 'ziel:' | 'Werkbank' | 'Ticket' | null; ids: string[] }; dod: boolean;
  openDecisions: number; rank: number | null; consistent: boolean; consistency: string[]; inOverview: boolean; age: number | null;
}

export function specChecks(
  sp: { name: string; topic: string; state: string; fm: Record<string, unknown>; text: string; goals: string[] },
  ctx: { rank: number | null; overviewText: string; consistency: { kind: string }[]; ticketGoals: string[]; today: string; localGoal?: string },
): SpecCheck {
  const fm = sp.fm ?? {};
  const has = (k: string) => fm[k] !== undefined && fm[k] !== null && String(fm[k]).trim() !== '';
  const missing = FM_REQUIRED.filter((k) => !(k === 'tags' || k === 'sources' ? Array.isArray(fm[k]) || has(k) : has(k)));
  if ((fm.type === 'reference' || fm.type === 'project') && !has('area')) missing.push('area');
  const problems: string[] = [];
  if (has('status') && !STATUS.includes(String(fm.status))) problems.push(`status „${fm.status}“ nicht im Schema`);
  if (has('team') && fm.team !== 'olaf') problems.push('team ≠ olaf');
  if (has('lifecycle') && String(fm.lifecycle) !== stateSlug(sp.state)) problems.push(`lifecycle „${fm.lifecycle}“ ≠ Ordner ${stateSlug(sp.state)}`);
  if (has('domain') && String(fm.domain) !== domainOf(sp.topic)) problems.push(`domain „${fm.domain}“ ≠ Thema ${domainOf(sp.topic)}`);
  const jira = Array.isArray(fm.jira) ? fm.jira.length > 0 : has('jira') && String(fm.jira) !== '[]';
  // Ziel: Werkbank-Zuordnung (goal_assignments) → Frontmatter ziel: → über Tickets. jira: ist nur Anzeige (Runde 7).
  const goal = ctx.localGoal ? { ok: true, via: 'Werkbank' as const, ids: [ctx.localGoal] } : sp.goals.length ? { ok: true, via: 'ziel:' as const, ids: sp.goals } : ctx.ticketGoals.length ? { ok: true, via: 'Ticket' as const, ids: ctx.ticketGoals } : { ok: false, via: null, ids: [] };
  const lv = has('last-verified') ? String(fm['last-verified']).slice(0, 10) : null;
  const age = lv && /^\d{4}-\d{2}-\d{2}$/.test(lv) ? Math.round((Date.parse(ctx.today + 'T12:00:00Z') - Date.parse(lv + 'T12:00:00Z')) / 864e5) : null;
  return {
    fm: { ok: !missing.length && !problems.length, missing, problems },
    jira, goal,
    dod: /^##\s+Definition of Done/im.test(sp.text),
    openDecisions: parseDecisions(sp.text).filter((d) => d.open).length,
    rank: ctx.rank, consistent: !ctx.consistency.length, consistency: ctx.consistency.map((c) => c.kind),
    inOverview: new RegExp(`\\[\\[${sp.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\||\\]|#)`).test(ctx.overviewText),
    age,
  };
}

/** Neue Spec nach Skill-Vorlage: Frontmatter nach Vault-Schema + domain/lifecycle, Pflichtabschnitte, Knut-Zeile. */
export function specTemplate(p: { topic: string; state: string; title: string; goal?: string; jira?: string; today: string; overview?: string }): string {
  const q = (s: string) => JSON.stringify(s);   // gültiger YAML-String (Backslash, Anführungszeichen)
  const fm = [
    '---', `title: ${q(`olaf — Spec: ${p.title}`)}`, 'type: reference', 'team: olaf', 'area: product',
    `domain: ${domainOf(p.topic)}`, `lifecycle: ${stateSlug(p.state)}`, 'status: draft', `created: ${p.today}`, `last-verified: ${p.today}`,
    'tags: [roadmap]', 'sources: []', `related: ["[[0-roadmap-produkt-olaf]]"${p.overview ? `, "[[${p.overview}]]"` : ''}]`,
    ...(p.jira ? [`jira: [${p.jira}]`] : []), ...(p.goal ? [`ziel: ${p.goal}`] : []), '---', '',
  ];
  const body = [
    `# ${p.title}`, '', '**Ziel:** ‹ein Satz, aus Nutzersicht›', '',
    '## Befund', '', '‹Fundstellen (`datei.ts:zeile`) und Fehlerszenario; Unbestätigtes als solches markieren›', '',
    '## Umsetzung', '', '‹kleinster tragfähiger Schnitt, ein PR›', '',
    ...(p.topic === 'Anmeldestrecke' ? ['## Messung', '', '‹Hypothese, Primärmetrik, Leitplanken, Ereignisse, Fallzahl, Laufzeit — oder „Messung: entfällt, weil …“›', ''] : []),
    '## Definition of Done', '', '- ‹prüfbarer Satz›', '',
    '## Offene Punkte', '', '- ‹Frage› Empfehlung: ‹…›', '  - Knut:', '',
  ];
  return [...fm, ...body].join('\n');
}
