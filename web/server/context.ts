// Kontext-Paket für neue Werkbank-Sitzungen: kurz, je Person, Zeiger statt Kopien.
// Quellen: Roadmap-Hub, PR-Register, offene Fragen, aktueller Sprint (Ziel + S-Zeilen), Daily Debrief
// von heute, eigene Jira-Tickets (aus der Kopie). Keine Kundendaten — nur Überschriften, Zahlen, Pfade.
// Obergrenze ~1500 Tokens (geschätzt: Zeichen/3,5); jenseits der Top 3 nur Zahlen.
// Zwischengespeichert, solange sich die Eingaben nicht ändern (Hash über mtime/Größe + Jira-Stand).

import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseFrontmatter, getIndex, extractWikilinks, resolveLink, type VaultIndex } from './vault.ts';
import { parseGoal, parseOutcomes, listCycles } from './sprint.ts';
import { isMine, resolveIdentity, vienna, type HygieneItem, type Identity } from './hygiene.ts';
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
  const c = listCycles(projectsDir).find((x) => !x.archived);
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
    'Frag kurz danach — eine Frage nach der anderen, neben der eigentlichen Anfrage, die immer Vorrang hat. Nach drei Fragen oder bei „später“ nicht weiter nachhaken. Aus der Antwort schlägst du genau eine Jira-Aktion vor (Kommentar, Status, Fälligkeit) und schreibst sie mit dem Werkzeug `jira_update` (die Person bestätigt es mit „ja“); bei „später“ rufst du `hygiene_snooze` auf. Keine neuen Tickets.',
    ...picked.map((i, n) => `${n + 1}. ${i.question}`),
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
  const cycle = listCycles(inp.projectsDir).find((x) => !x.archived);
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
    [0, 'Details holst du bei Bedarf selbst, statt zu raten: Werkzeug `vault-search` (search → Treffer mit Ausschnitt, outline → Gliederung, read_note mit section → nur ein Abschnitt, backlinks, recent) für den Vault unter /vault, Jira über die Jira-Werkzeuge. Pfade als [[Basename]] sind Vault-Notizen.'],
  ];
  let lines = parts.filter(([, t]) => t);
  const text = () => lines.map(([, t]) => '- ' + t).join('\n').replace(/^- ## /, '## ');
  for (let p = 3; approxTokens(text()) > TOKEN_CAP && p >= 1; p--) lines = lines.filter(([q]) => q < p);
  let out = text();
  if (approxTokens(out) > TOKEN_CAP) out = out.slice(0, Math.floor(TOKEN_CAP * 3.5) - 1) + '…';
  return out;
}

export function inputsHash(inp: PackInput, jiraSyncAt: string | null): string {
  const today = vienna(inp.now ?? new Date()).date;
  const h = createHash('sha256').update(`${inp.who.accountId ?? ''}|${inp.who.name ?? ''}|${today}|${jiraSyncAt ?? ''}`);
  const cycle = listCycles(inp.projectsDir).find((x) => !x.archived);
  for (const f of [...Object.values(sourcesOf(inp.vaultDir, today)), cycle?.files.planning, cycle?.files.summary]) {
    if (!f) continue;
    try { const s = statSync(f); h.update(`${f}:${s.mtimeMs}:${s.size}`); } catch { h.update(`${f}:-`); }
  }
  return h.digest('hex').slice(0, 16);
}
