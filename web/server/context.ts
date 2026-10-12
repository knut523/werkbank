// Kontext-Paket für neue Werkbank-Sitzungen: kurz, je Person, Zeiger statt Kopien.
// Quellen: Roadmap-Hub, PR-Register, offene Fragen, aktueller Sprint (Ziel + S-Zeilen), Daily Debrief
// von heute, eigene Jira-Tickets (aus der Kopie). Keine Kundendaten — nur Überschriften, Zahlen, Pfade.
// Obergrenze ~1500 Tokens (geschätzt: Zeichen/3,5); jenseits der Top 3 nur Zahlen.
// Zwischengespeichert, solange sich die Eingaben nicht ändern (Hash über mtime/Größe + Jira-Stand).

import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseFrontmatter, getIndex, extractWikilinks, resolveLink, type VaultIndex } from './vault.ts';
import { parseGoal, parseOutcomes, listCycles, currentCycle } from './sprint.ts';
import { isMine, resolveIdentity, vienna, REVIEW_GROUPS, type HygieneItem, type Identity, type ReviewItem } from './hygiene.ts';
import { isOverdue, type Issue } from './jira.ts';

export const TOKEN_CAP = 1500;
export const approxTokens = (s: string) => Math.ceil(s.length / 3.5);

const ROADMAP = 'olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap/0-Overview';
export const sourcesOf = (vault: string, today: string) => ({
  roadmap: join(vault, ROADMAP, '0-roadmap-produkt-olaf.md'),
  pr: join(vault, ROADMAP, 'pr-stand-produkt-olaf.md'),
  questions: join(vault, ROADMAP, 'offene-fragen-roadmap-produkt-olaf.md'),
  debrief: join(vault, 'olaf/1-Projects/daily-debrief', `${today}-olaf-debrief.md`),
});

const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');
const clean = (s: string) => s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\*\*|~~|`/g, '').replace(/\s+/g, ' ').trim();
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const verified = (text: string) => { const v = parseFrontmatter(text).fm['last-verified']; return v ? String(v).slice(5).split('-').reverse().join('.') : '?'; };

export function section(text: string, heading: RegExp): string {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => /^## /.test(l) && heading.test(l));
  if (i < 0) return '';
  const j = lines.findIndex((l, k) => k > i && /^## /.test(l));
  return lines.slice(i + 1, j < 0 ? undefined : j).join('\n');
}

/** "**In Arbeit** — **Review und Merge durchbringen.**" → "In Arbeit: Review und Merge durchbringen" */
export function roadmapLine(text: string): string {
  if (!text) return '';
  const work = section(text, /Woran wir gerade arbeiten/);
  const leads = [...work.matchAll(/^\*\*([^*]+)\*\*\s*—\s*\*\*([^*]+)\*\*/gm)].map((m) => `${m[1].trim()}: ${m[2].trim().replace(/[.:]$/, '')}`);
  const themes = text.match(/^## Die (\w+) Themen/m)?.[1];
  return `Roadmap Produkt OLAF (geprüft ${verified(text)}): ${leads.slice(0, 2).join(' · ') || 'siehe Hub'}${themes ? ` · ${themes} Themen` : ''} → [[0-roadmap-produkt-olaf]]`;
}

export function prLine(text: string): string {
  if (!text) return '';
  const heads = [...text.matchAll(/^## (.+)$/gm)].map((m) => clean(m[1])).filter((h) => !/Verlauf|Kadenz|auffällt|Offener Punkt/.test(h));
  const open = section(text, /Offen auf GitHub/);
  const openCount = (open.match(/^\s*(\||- ).*#\d+/gm) ?? []).length;
  return `PR-Stand (geprüft ${verified(text)}): ${heads.slice(0, 3).map((h) => cut(h, 70)).join(' · ')}${openCount ? ` · ${openCount} Einträge „Offen auf GitHub“` : ''} → [[pr-stand-produkt-olaf]]`;
}

export function questionsLine(text: string): string {
  if (!text) return '';
  const top = section(text, /am meisten freischalten/);
  const items = [...top.matchAll(/^\d+\.\s+(.+)$/gm)].map((m) => m[1]).filter((t) => !t.startsWith('~~'));
  const total = (text.match(/^(?:\d+\.|-|###?#?)\s+\*\*[A-E]\d+\b/gm) ?? []).length;
  const first = items.slice(0, 3).map((t) => cut(clean(t).split(' — ')[0], 80));
  return `Offene Fragen Roadmap: ${items.length} in der Top-Liste${total ? ` (${total} nummerierte insgesamt)` : ''}; zuerst: ${first.join(' · ') || '—'} → [[offene-fragen-roadmap-produkt-olaf]]`;
}

export function sprintLines(projectsDir: string, who: Identity): string[] {
  const c = currentCycle(listCycles(projectsDir));
  if (!c) return [];
  const planning = c.files.planning ? read(c.files.planning) : '';
  const goal = parseGoal(planning).goal ?? (c.files.summary ? parseGoal(read(c.files.summary)).goal : undefined);
  const outcomes = parseOutcomes(planning);
  const first = (who.name ?? who.displayName ?? '').split(' ')[0].toLowerCase();
  const own = outcomes.filter((o) => first && (o.owner ?? '').toLowerCase().includes(first));
  const shown = (own.length ? own : outcomes).slice(0, 3);
  const out = [`Sprint ${c.date} → [[${c.id}-summary]]: Ziel „${cut(goal ?? '—', 160)}“`];
  if (outcomes.length) {
    out.push(`${own.length ? 'Deine Ergebnisse' : 'Ergebnisse'}: ${shown.map((o) => `${o.id} ${cut(o.title, 50)}${o.date ? ` (bis ${o.date})` : ''}`).join(' · ')}${outcomes.length > shown.length ? ` · +${outcomes.length - shown.length} weitere` : ''}`);
  } else out.push('Ergebnisse S1–S4: noch keine in der Planning-Notiz.');
  return out;
}

export function debriefLine(text: string, path: string): string {
  if (!text) return 'Daily Debrief heute: noch keiner.';
  const h1 = text.match(/^# (.+)$/m)?.[1] ?? 'Daily Debrief';
  const rel = path.slice(path.indexOf('olaf/'));
  return `Daily Debrief heute: „${cut(clean(h1), 70)}“ → ${rel}`;
}

export function jiraLine(issues: Issue[], who: Identity, now = new Date()): string {
  who = resolveIdentity(who, issues);
  const today = now.toISOString().slice(0, 10);
  const mine = issues.filter((i) => i.type !== 'Workstream' && i.status !== 'Done' && isMine(i, who));
  if (!issues.length) return 'Jira-Kopie: noch nicht synchronisiert.';
  const over = mine.filter((i) => isOverdue(i, today));
  const undated = mine.filter((i) => !i.duedate);
  const next = mine.filter((i) => i.duedate).sort((a, b) => a.duedate!.localeCompare(b.duedate!)).slice(0, 3);
  return `Deine PM-Tickets: ${mine.length} offen, ${over.length} überfällig, ${undated.length} ohne Datum; als nächstes fällig: ${next.map((i) => `${i.key} (${i.duedate!.slice(5).split('-').reverse().join('.')})`).join(', ') || '—'}`;
}

export function hygieneBlock(picked: HygieneItem[], total: number, slot: 'morgen' | 'abend' | null = 'morgen'): string {
  if (!picked.length) return '';
  return [
    slot === 'abend'
      ? `### Tagesabschluss (${total} offene Pflegepunkte, jetzt höchstens ${picked.length} fragen)`
      : `### Task-Hygiene zum Tagesbeginn (${total} offene Punkte, heute höchstens ${picked.length} fragen)`,
    'Frag kurz danach — eine Frage nach der anderen, neben der eigentlichen Anfrage, die immer Vorrang hat. Nach drei Fragen oder bei „später“ nicht weiter nachhaken. Lies vor jeder Frage Beschreibung und Kommentare des Tickets — steht der Stand schon dort, frag nicht danach. Aus der Antwort schlägst du genau eine Jira-Aktion vor (Kommentar, Status, Fälligkeit) und schreibst sie mit dem Werkzeug `jira_update` (mit summary, was und reason für die Rückfrage; die Person bestätigt mit „ja“); bei „später“ rufst du `hygiene_snooze` auf. Keine neuen Tickets.',
    ...picked.map((i, n) => `${n + 1}. ${i.question}`),
    ...(slot === 'abend' ? ['Erwähne am Ende in einem Satz: Den vollen Durchgang über alle Tickets mit Empfehlungen gibt es mit der Vorlage „Tagesabschluss“.'] : []),
  ].join('\n');
}

export const REVIEW_GROUP_MAX = 15;
const dayOf = (s: string) => { const d = new Date(s); return Number.isNaN(+d) ? null : vienna(d).date; };
const ddmm = (d: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.` : '—');

/** Tagesabschluss als Durchgang (Knut, 07.10.2026): alle Tickets nach `reviewSet`, Empfehlung je Ticket, gesammelt schreiben. */
export function reviewBlock(items: ReviewItem[], today: string, batch = true): string {
  if (!items.length) return '### Tagesabschluss\nKeine eigenen Tickets, die heute zählen (überfällig, ≤ 7 Tage fällig, ohne Datum, heute bearbeitet). Sag das kurz.';
  const groups = REVIEW_GROUPS.map((g) => [g, items.filter((i) => i.group === g)] as const).filter(([, l]) => l.length);
  return [
    `### Tagesabschluss — Durchgang über ${items.length} Tickets (${ddmm(today)})`,
    'Ablauf (die Person hat den Tagesabschluss ausdrücklich gestartet; das hat Vorrang):',
    `1. Lies jedes Ticket unten: Beschreibung, Kommentare, Sub-tasks, Parent. Verteil das auf bis zu 4 Teilagenten \`ticket-pruefer\` (je ein Block Tickets); sie liefern je Ticket eine Zeile: Stand laut Jira, Widersprüche, Empfehlung + Grund. Frag nie nach einem Stand, der schon in einem Kommentar steht.`,
    '2. Zeig je Gruppe eine Tabelle: Ticket · Titel · Stand (Status, fällig, letzte Bewegung) · **Empfehlung** · Grund. Empfehlungen: *bleibt* · *verschieben auf TT.MM.* (realistisch, nicht +1 Tag) · *Done* · *Backlog ohne Datum* · *anschauen* (Frage dazu) · *Agent vorlaufen lassen* (wenn das Ticket bald dran ist und sich vorbereiten lässt — sag, was der Agent tun soll). Darunter oben die 3–5 Punkte, die zuerst Aufmerksamkeit brauchen (z. B. Sprintziel, Blocker, offensichtlich erledigt).',
    '3. Die Person antwortet gesammelt („alles ok außer …“). Erst wenn alles beantwortet ist, schreibst du nach Jira:',
    batch
      ? '   alle Änderungen mit `jira_update_many` (höchstens 25 je Aufruf, sonst in mehreren Aufrufen) (je Eintrag key, summary = Titel genau wie in Jira, was = bisheriger Stand, reason = Grund, dazu status/due/comment). Die Person bestätigt einmal. Meldet das Ergebnis Fehler, nenn sie und biete für diese Tickets `jira_update` einzeln an.'
      : '   Ticket für Ticket mit `jira_update` (je Aufruf summary, was = bisheriger Stand, reason = Grund); die Person bestätigt jedes.',
    '4. Danach: für jedes Ticket mit „Agent vorlaufen lassen“, das die Person bestätigt hat, `agent_start` (key, note = konkreter Auftrag) — je Ticket ein neuer eigener Chat; nenn die Links.',
    '5. Neue Tasks nur, wenn die Person es ausdrücklich verlangt — nach Skill `olaf-jira` (Dublettenprüfung, Workstream, Ziel/Ergebnis, Owner, Datum), über den Atlassian-MCP mit Rückfrage.',
    // „ohne Datum“ kann ein ganzer Backlog sein: höchstens 15 Zeilen je Gruppe, Rest als Zahl (Council 09.10.2026).
    ...groups.flatMap(([g, l]) => [`**${g}** (${l.length})`, ...l.slice(0, REVIEW_GROUP_MAX).map((i) => `- ${i.key} „${cut(i.summary, 70)}“ · ${i.status} · fällig ${ddmm(i.duedate)} · zuletzt ${ddmm(dayOf(i.updated))}`), ...(l.length > REVIEW_GROUP_MAX ? [`- … und ${l.length - REVIEW_GROUP_MAX} weitere (heute nicht; auf Wunsch mit \`hygiene_list\` zeigen)`] : [])]),
  ].join('\n');
}

// ---------- Vault-Karte: wichtigste Notizen unter festem Budget (Idee: aider repo map) ----------

/**
 * Rangfolge: Verlinkungsgrad (Backlinks, gedämpft) + Nähe zur Person (verlinkt aus ihrem Sprint und dem
 * Roadmap-Hub, Team olaf, Register unter 0-Overview). Gefüllt bis `budget` Tokens, nur Basenamen + Titel.
 */
export function vaultMap(idx: VaultIndex, focusPaths: string[], budget = 260): string {
  const boost = new Map<string, number>();
  for (const f of focusPaths) {
    const n = idx.notes.get(f);
    if (!n) continue;
    boost.set(f, (boost.get(f) ?? 0) + 3);
    for (const l of n.links) boost.set(l, (boost.get(l) ?? 0) + 2);
  }
  const scored = [...idx.notes.values()]
    .filter((n) => !n.path.startsWith('_meta/') && !/\/(4-Archive|Meetings|daily-debrief)\//.test(n.path))
    .map((n) => ({
      n,
      score: Math.log2(1 + (idx.backlinks.get(n.path)?.size ?? 0)) + (boost.get(n.path) ?? 0) + (n.team === 'olaf' ? 0.5 : 0) + (/\/0-Overview\/|\/MOCs\//.test(n.path) ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score);
  const out: string[] = [];
  let used = approxTokens('Vault-Karte (wichtigste Notizen): ');
  for (const { n } of scored) {
    const item = `[[${n.name}]]${n.title && n.title !== n.name ? ` (${cut(n.title, 40)})` : ''}`;
    const t = approxTokens(item + ' · ');
    if (used + t > budget) break;
    out.push(item); used += t;
  }
  return out.length ? `Vault-Karte (wichtigste Notizen, Details per read_note/outline): ${out.join(' · ')}` : '';
}

// ---------- Zusammenbau mit Obergrenze ----------

export interface PackInput {
  vaultDir: string; projectsDir: string; issues: Issue[]; who: Identity; userName: string; now?: Date;
}

export function buildPack(inp: PackInput): string {
  const now = inp.now ?? new Date();
  const today = vienna(now).date;
  const src = sourcesOf(inp.vaultDir, today);
  const cycle = currentCycle(listCycles(inp.projectsDir), today);
  let map = '';
  try {
    const idx = getIndex(inp.vaultDir);
    const rel = (p?: string) => (p ? p.slice(inp.vaultDir.length + 1) : '');
    map = vaultMap(idx, [rel(src.roadmap), rel(cycle?.files.planning), rel(cycle?.files.summary)].filter(Boolean));
  } catch { /* ohne Karte */ }
  const parts: [number, string][] = [   // [Priorität, Text] — kleinere Zahl bleibt eher drin
    [0, `## Werkbank-Kontext (${today.split('-').reverse().join('.')}, für ${inp.userName})`],
    [1, jiraLine(inp.issues, inp.who, now)],
    ...sprintLines(inp.projectsDir, inp.who).map((l) => [1, l] as [number, string]),
    [2, roadmapLine(read(src.roadmap))],
    [2, questionsLine(read(src.questions))],
    [3, prLine(read(src.pr))],
    [3, debriefLine(read(src.debrief), src.debrief)],
    [3, map],
    [0, 'Details holst du bei Bedarf selbst, statt zu raten: Werkzeug `vault-search` (search → Treffer mit Überschrift und Fundzeile, bei wenig Treffern andere Formulierung probieren; outline → Gliederung, read_note mit section → nur ein Abschnitt, related/backlinks → Nachbarn im Link-Graphen, recent) für den Vault unter /vault, Jira über die Jira-Werkzeuge. Pfade als [[Basename]] sind Vault-Notizen.'],
  ];
  let lines = parts.filter(([, t]) => t);
  const text = () => lines.map(([, t]) => '- ' + t).join('\n').replace(/^- ## /, '## ');
  for (let p = 3; approxTokens(text()) > TOKEN_CAP && p >= 1; p--) lines = lines.filter(([q]) => q < p);
  let out = text();
  if (approxTokens(out) > TOKEN_CAP) out = out.slice(0, Math.floor(TOKEN_CAP * 3.5) - 1) + '…';
  return out;
}

/** Cache-Schlüssel: Person, Tag, Inhalt der Ticket-Kopie (Schlüssel/updated/Status/Fälligkeit/Owner/Labels) und
 *  Vault-Quellen. Nicht der Abgleichszeitpunkt — sonst wäre er nach jedem 15-min-Abgleich ungültig (~1,4 s je Sitzung). */
export function inputsHash(inp: PackInput): string {
  const today = vienna(inp.now ?? new Date()).date;
  const h = createHash('sha256').update(`${inp.who.accountId ?? ''}|${inp.who.name ?? ''}|${today}`);
  for (const i of [...inp.issues].sort((a, b) => a.key.localeCompare(b.key))) h.update(`|${i.key}:${i.updated}:${i.status}:${i.duedate ?? ''}:${i.assigneeId ?? i.assignee ?? ''}:${(i.labels ?? []).join(',')}`);
  const cycle = currentCycle(listCycles(inp.projectsDir), today);
  for (const f of [...Object.values(sourcesOf(inp.vaultDir, today)), cycle?.files.planning, cycle?.files.summary]) {
    if (!f) continue;
    try { const s = statSync(f); h.update(`${f}:${s.mtimeMs}:${s.size}`); } catch { h.update(`${f}:-`); }
  }
  return h.digest('hex').slice(0, 16);
}
