// Sprint-Zyklus aus dem Vault: olaf/1-Projects/sprint-YYYY-MM-DD/{summary,review,planning}.md
// Reine Parser (Fragen mit Antwortzeilen, Anker, Sprint-Ziel, Ergebnisse S1–S4, Bewertung) und das
// Einfügen von Antworten. Die Notation ist die des Daily Debriefs / der Review-Notiz:
//   <!--k:PM-321-->  unsichtbarer Anker auf der Frage-/Ticketzeile (auch in Callouts "> ")
//     - Knut: Text   Antwortzeile (jede Einrückung), leer "- Knut:" = Antwortfeld
//     - ✓ 2026-09-15 → Jira: …  bereits übertragen
//     - → mitnehmen: …           Mitnahme, nie ein Jira-Write
// Muss mit jira-sync-plan.sh übereinstimmen (Test: test/sprint.test.ts vergleicht beide).

import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { parseFrontmatter } from './vault.ts';
import { browseUrl } from './config.ts';
import type { Issue } from './jira.ts';

export const hashText = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

// ---------- Zyklen ----------

export interface Cycle { id: string; date: string; dir: string; files: { summary?: string; review?: string; planning?: string }; archived: boolean }

export function listCycles(projectsDir: string, archiveDir?: string): Cycle[] {
  const out: Cycle[] = [];
  const scan = (dir: string, archived: boolean) => {
    if (!existsSync(dir)) return;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const m = e.isDirectory() && e.name.match(/^sprint-(\d{4}-\d{2}-\d{2})$/);
      if (!m) continue;
      const d = join(dir, e.name);
      const f = (k: string) => (existsSync(join(d, `${e.name}-${k}.md`)) ? join(d, `${e.name}-${k}.md`) : undefined);
      out.push({ id: e.name, date: m[1], dir: d, archived, files: { summary: f('summary'), review: f('review'), planning: f('planning') } });
    }
  };
  scan(projectsDir, false);
  if (archiveDir) scan(archiveDir, true);
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

// ---------- Fragen und Antwortzeilen ----------

const LEAD_INS = /^(status|update|blocker|ziel|ziele|offen|neu|new|todo|to do|achtung|hinweis|frage|antwort|workshop|termin|entscheidung|risiko|note|info|wichtig|problem|fazit|ergebnis|forschungsprojekt|datum|owner|due|deadline)$/;

export interface AnswerLine {
  line: number;               // 1-basiert
  raw: string;
  speaker: string;            // "" = ohne Sprecher
  text: string;               // "" bei leerem Antwortfeld
  kind: 'note' | 'status' | 'carry' | 'synced' | 'empty';
}

export interface Question {
  line: number;               // Zeile mit dem Anker
  key: string;                // PM-321 | ZIEL:PM-70 | …
  ticket?: string;            // PM-321
  text: string;               // Frage-/Ticketzeile ohne Anker (Markdown)
  context: string[];          // vorangehende Zeilen desselben Listenpunkts (z. B. die nummerierte Frage)
  section: string;            // nächste Überschrift darüber
  inCallout: boolean;
  indent: string;             // Einrückung für neue Antwortzeilen (ohne Callout-Präfix)
  answers: AnswerLine[];
  inline?: string;            // Text direkt hinter dem Anker (zählt wie eine Antwortzeile)
  file?: string;
}

export function splitSpeaker(s: string): { speaker: string; text: string } {
  const m = s.match(/^([^:]+):(?: (.*)|$)/);
  if (m) {
    const cand = m[1].trim();
    const words = cand.split(/ +/);
    if (words.length <= 2 && !LEAD_INS.test(cand.toLowerCase()) && !/^(→|->)/.test(cand)) {
      return { speaker: cand, text: (m[2] ?? '').trim() };
    }
  }
  return { speaker: '', text: s.trim() };
}

export function classifyAnswer(content: string): Omit<AnswerLine, 'line' | 'raw'> {
  const c = content.replace(/^>> */, '');
  if (/^✓ /.test(c)) return { speaker: '', text: c, kind: 'synced' };
  const carry = c.match(/^(→|->) *mitnehmen: *(.*)$/);
  if (carry) return { speaker: '', text: carry[2].trim(), kind: 'carry' };
  const { speaker, text } = splitSpeaker(c);
  if (!text) return { speaker, text: '', kind: 'empty' };
  if (/^status: */i.test(text)) return { speaker, text: text.replace(/^status: */i, ''), kind: 'status' };
  return { speaker, text, kind: 'note' };
}

const stripCallout = (l: string) => l.replace(/^(> ?)+/, '');

export function parseQuestions(text: string, file?: string): Question[] {
  const lines = text.split('\n');
  const out: Question[] = [];
  let section = '';
  let cur: Question | null = null;
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*(```|~~~)/.test(raw)) { inFence = !inFence; cur = null; continue; }
    if (inFence) continue;
    const h = raw.match(/^(#{1,6}) (.+)$/);
    if (h) { section = h[2].trim(); cur = null; continue; }
    const inCallout = /^>/.test(raw);
    const l = stripCallout(raw);
    const a = l.match(/<!--k:([^>]+)-->/);
    if (a) {
      const before = l.slice(0, a.index);
      if ((before.match(/`/g)?.length ?? 0) % 2 === 1) { cur = null; continue; }  // Anker im Code-Span = Doku
      const key = a[1].trim();
      const lineText = (before + l.slice(a.index! + a[0].length)).trim();
      const leading = l.match(/^(\s*)/)![1];
      // Kontext: bei eingerückter Fortsetzungszeile die Zeilen seit dem Listenpunkt-Anfang.
      const context: string[] = [];
      if (leading.length > 0) {
        for (let j = i - 1; j >= 0 && i - j <= 6; j--) {
          const pl = stripCallout(lines[j]);
          if (!pl.trim()) break;
          context.unshift(pl.trim());
          if (/^\s*(\d+\.|[-*]) /.test(pl) && pl.match(/^(\s*)/)![1].length < leading.length) break;
        }
      }
      const listIndent = (l.match(/^(\s*)(?:\d+\.|[-*])\s/)?.[1] ?? leading);
      const tk = key.match(/PM-\d+|[A-Z][A-Z0-9]+-\d+/)?.[0];
      cur = {
        line: i + 1, key, ticket: tk, text: lineText, context, section, inCallout,
        indent: /^\s*(\d+\.|[-*]) /.test(l) ? listIndent + '  ' : (leading || '  '),
        answers: [], file, inline: l.slice(a.index! + a[0].length).trim() || undefined,
      };
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    if (/^[^ \t]/.test(l) && l.trim() !== '') { cur = null; continue; }
    const m = l.match(/^([ \t]+)- (.*)$/);
    if (m) {
      const cls = classifyAnswer(m[2]);
      cur.answers.push({ line: i + 1, raw, ...cls });
      cur.indent = m[1];
    }
  }
  return out;
}

/** Wie jira-sync-plan.sh: die Einträge, die in den Sync-Plan gehen (TSV-äquivalent). */
export function syncPlanRows(qs: Question[]) {
  const rows: { kind: string; key: string; speaker: string; payload: string; line: number; file?: string }[] = [];
  for (const q of qs) {
    if (q.inline) {
      const a = classifyAnswer(q.inline);
      if (a.kind !== 'synced' && a.kind !== 'empty') rows.push({ kind: a.kind, key: q.key, speaker: a.speaker || '-', payload: a.text, line: q.line, file: q.file });
    }
    for (const a of q.answers) {
      if (a.kind === 'synced' || a.kind === 'empty') continue;
      rows.push({ kind: a.kind, key: q.key, speaker: a.speaker || '-', payload: a.text, line: a.line, file: q.file });
    }
  }
  return rows;
}

// ---------- Antwort einfügen ----------

export interface AnswerEdit { text: string; line: number; before: string | null; after: string; mode: 'filled' | 'inserted' }

/**
 * Setzt die Antwort von `speaker` unter die Frage an Zeile `anchorLine`.
 * Gibt es ein leeres Antwortfeld "- <speaker>:", wird es gefüllt, sonst eine neue Zeile nach der
 * letzten Antwortzeile eingefügt (mit demselben Callout-Präfix). `expectHash` schützt vor
 * gleichzeitigen Änderungen (Obsidian, Sync, andere Person).
 */
export function applyAnswer(text: string, anchorLine: number, speaker: string, answer: string, expectHash?: string): AnswerEdit {
  if (expectHash && hashText(text) !== expectHash) throw new Error('Die Notiz hat sich inzwischen geändert — bitte neu laden.');
  const clean = answer.replace(/\s*\n\s*/g, ' ').replace(/<!--/g, '').trim();
  const who = speaker.replace(/[:\n]/g, '').trim();
  if (!clean) throw new Error('Leere Antwort.');
  if (!who) throw new Error('Name fehlt.');
  const qs = parseQuestions(text);
  const q = qs.find((x) => x.line === anchorLine);
  if (!q) throw new Error('Frage nicht gefunden — die Notiz hat sich geändert.');
  const lines = text.split('\n');
  const prefix = q.inCallout ? (lines[anchorLine - 1].match(/^((?:> ?)+)/)?.[1] ?? '> ') : '';
  const empty = q.answers.find((a) => a.kind === 'empty' && a.speaker.toLowerCase() === who.toLowerCase())
    ?? q.answers.find((a) => a.kind === 'empty' && !a.speaker);
  if (empty) {
    const before = lines[empty.line - 1];
    const after = before.replace(/-\s.*$/, `- ${who}: ${clean}`);
    lines[empty.line - 1] = after;
    return { text: lines.join('\n'), line: empty.line, before, after, mode: 'filled' };
  }
  const last = q.answers.length ? q.answers[q.answers.length - 1].line : anchorLine;
  const after = `${prefix}${q.indent}- ${who}: ${clean}`;
  lines.splice(last, 0, after);
  return { text: lines.join('\n'), line: last + 1, before: null, after, mode: 'inserted' };
}

// ---------- Sprint-Ziel und Ergebnisse S1–S4 ----------

export interface Outcome {
  id: string;                 // S1 …
  title: string;
  dod?: string; owner?: string; date?: string;
  rating?: '✅' | '🟡' | '❌'; evidence?: string; why?: string;
  line: number;
  anchor?: string;            // Schlüssel aus <!--k:…--> (bleibt erhalten, z. B. PM-321 oder ZIEL:PM-70)
  tickets?: string[];         // Ticket-Keys aus Anker und Zeile
  parent?: string | null;     // Eltern-ID (neues Format S<MMTT>-<n>)
}

const ANCHOR = /<!--k:([^>]+)-->/;
const ticketsIn = (s: string) => [...new Set((s.match(/\b[A-Z][A-Z0-9]+-\d+\b/g) ?? []).filter((k) => !/^(GATE|KR|Z|M|S)\d*-/.test(k)))];

function cells(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());
}

const plain = (s: string) => s.replace(/\*\*/g, '').replace(/`/g, '').trim();

/** Sprint-Ziel: erster Blockquote- oder Absatztext unter einer Überschrift mit "Sprint-Ziel". */
export function parseGoal(text: string): { goal?: string; line?: number } {
  const lines = parseFrontmatter(text).body.split('\n');
  const offset = text.split('\n').length - lines.length;
  let inGoal = false;
  const buf: string[] = [];
  let start = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,4} /.test(l)) {
      if (inGoal && buf.length) break;
      inGoal = /Sprint-Ziel/i.test(l);
      continue;
    }
    if (!inGoal) continue;
    if (!l.trim()) { if (buf.length) break; continue; }
    if (/^\s*[|]/.test(l) || /^\s*[-*] /.test(l) && !buf.length) continue;
    if (!buf.length) start = i + 1 + offset;
    buf.push(l.replace(/^(> ?)+/, '').trim());
  }
  const goal = plain(buf.join(' ')).replace(/^Sprint-Ziel:?\s*/i, '');
  return goal ? { goal, line: start } : {};
}

const RATING = /(✅|🟡|❌)/;

/** Ergebnisse S1…Sn aus Tabellen (Kopfzeile bestimmt die Spalten) oder Listenzeilen "- **S1** …". */
export function parseOutcomes(text: string): Outcome[] {
  const lines = text.split('\n');
  const out: Outcome[] = [];
  let header: string[] | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].replace(/^(> ?)+/, '');
    if (/^\s*\|/.test(l)) {
      const c = cells(l);
      if (c.every((x) => /^:?-{2,}:?$/.test(x))) continue;
      const first = plain((c[0] ?? '').replace(ANCHOR, ''));
      const idm = first.match(/^(S\d{4}-\d{1,2}|S\d{1,2})\b\.?\s*(.*)$/);
      if (!idm) { header = c.map((h) => plain(h).toLowerCase()); continue; }
      const col = (re: RegExp) => { const k = header?.findIndex((h) => re.test(h)) ?? -1; return k >= 0 ? c[k] : undefined; };
      const anchor = l.match(ANCHOR)?.[1]?.trim();
      const rowPlain = l.replace(/<!--k:[^>]+-->/g, '');
      const parentCell = col(/eltern/);
      const title = (col(/ergebnis|^ziel$|was/) ?? (idm[2] || c[1] || '')).replace(/<!--k:[^>]+-->/g, '');
      const ratingCell = col(/bewertung|stand|erreicht/) ?? c.find((x) => RATING.test(x));
      out.push({
        id: idm[1], title: plain(idm[2] && !col(/ergebnis|^ziel$|was/) ? idm[2] : title),
        dod: col(/dod|definition|fertig/) && plain(col(/dod|definition|fertig/)!),
        owner: col(/owner|wer/) && plain(col(/owner|wer/)!),
        date: col(/datum|bis|fällig|termin|stichtag/) && plain(col(/datum|bis|fällig|termin|stichtag/)!),
        rating: ratingCell?.match(RATING)?.[1] as Outcome['rating'],
        evidence: col(/beleg|nachweis/) && plain(col(/beleg|nachweis/)!),
        why: col(/warum|ändern/) && plain(col(/warum|ändern/)!),
        line: i + 1,
        anchor, tickets: ticketsIn(`${anchor ?? ''} ${rowPlain}`), parent: parentCell ? (plain(parentCell).toUpperCase() || null) : null,
      });
      continue;
    }
    header = null;
    const li = l.match(/^\s*[-*] \*\*(S\d{4}-\d{1,2}|S\d{1,2})\*\*:?\s*(.*)$/);
    if (li) {
      const anchor = li[2].match(ANCHOR)?.[1]?.trim();
      const rest = li[2].replace(/<!--k:[^>]+-->/g, '').trim();
      const part = (re: RegExp) => rest.match(re)?.[1]?.trim();
      out.push({
        id: li[1],
        title: plain(rest.split(' · ')[0].replace(RATING, '')),
        dod: part(/DoD:\s*([^·]+)/i), owner: part(/Owner:\s*([^·]+)/i), date: part(/(?:bis|Datum:)\s*([0-9.]+)/i),
        rating: rest.match(RATING)?.[1] as Outcome['rating'],
        evidence: part(/Beleg:\s*([^·]+)/i), why: part(/Warum[^:]*:\s*([^·]+)/i),
        line: i + 1,
        anchor, tickets: ticketsIn(`${anchor ?? ''} ${rest}`), parent: part(/Eltern(?:-ID)?:\s*([^·\s]+)/i)?.toUpperCase() ?? null,
      });
    }
  }
  return out;
}

// ---------- Neuer Zyklus ----------

export function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? vars[k] : m));
}

const de = (iso: string) => { const [y, m, d] = iso.split('-'); return `${d}.${m}.${y}`; };

export function newCycleFiles(templateDir: string, date: string, previous?: string, extra: Record<string, string> = {}): { name: string; content: string }[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Datum im Format JJJJ-MM-TT angeben.');
  const end = new Date(date + 'T12:00:00Z');
  end.setUTCDate(end.getUTCDate() + 14);
  const endIso = end.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const vars = {
    DATUM: date, DATUM_DE: de(date), ENDE: endIso, ENDE_DE: de(endIso), HEUTE: today,
    VORZYKLUS: previous ?? '', VORZYKLUS_DATUM: previous ? de(previous.replace('sprint-', '')) : '—',
    ...reviewDefaults(previous), ...extra,
  };
  return ['summary', 'review', 'planning'].map((k) => ({
    name: `sprint-${date}-${k}.md`,
    content: fillTemplate(readFileSync(join(templateDir, `${k}.md`), 'utf8'), vars),
  }));
}

export const cycleIdOf = (file: string) => basename(file).replace(/-(summary|review|planning)\.md$/, '');

// ---------- Arbeitspakete des Reviews (Domäne → #### Paket → Tickets) ----------

export const DOMAINS = ['Product', 'Operations', 'Governance & Verträge', 'Marketing'] as const;

export interface Pkg {
  domain: string;             // ### unter „## Die Updates“
  name: string;               // #### Paketname
  line: number;
  end: number;                // letzte Zeile des Pakets (vor der nächsten Überschrift ##–####)
  tickets: string[];          // Anker-Tickets in Reihenfolge, je Ticket einmal (ZIEL:… zählt nicht)
  freeText: string[];         // Text unter dem Paket ohne Antwortzeile (erreicht den Sync nicht)
}

/** Pakete aus „## Die Updates“: jedes #### unter einer ### Domäne, mit den Ticket-Ankern darunter. */
export function parsePackages(text: string): Pkg[] {
  const lines = text.split('\n');
  const out: Pkg[] = [];
  let inUpdates = false, domain = '', cur: Pkg | null = null, inFence = false, afterCallout = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(```|~~~)/.test(l)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const h = l.match(/^(#{2,4}) (.+?)\s*$/);
    if (h) {
      const lvl = h[1].length;
      if (cur) cur.end = i;
      if (lvl === 2) { inUpdates = /^Die Updates/i.test(h[2]); cur = null; continue; }
      if (!inUpdates) continue;
      if (lvl === 3) { domain = h[2]; cur = null; continue; }
      cur = { domain, name: h[2], line: i + 1, end: lines.length, tickets: [], freeText: [] };
      afterCallout = false;
      out.push(cur);
      continue;
    }
    if (!cur) continue;
    const a = stripCallout(l).match(/<!--k:([^>]+)-->/);
    if (a) {
      const before = stripCallout(l).slice(0, a.index);
      const k = a[1].trim();
      if ((before.match(/`/g)?.length ?? 0) % 2 === 0 && /^[A-Z][A-Z0-9]+-\d+$/.test(k) && !cur.tickets.includes(k)) cur.tickets.push(k);
    }
    if (/^>/.test(l)) { afterCallout = true; continue; }
    // Freier Text nach dem Ticket-Callout: wurde in der Runde dazugeschrieben, hat aber keinen Anker.
    if (afterCallout && l.trim() && !/^\s*- /.test(l)) cur.freeText.push(l.trim());
  }
  return out;
}

// ---------- Review-Entwurf (Schritt 1, docs/plan-sprint-werkbank.md) ----------
// Gerüst, keine Prosa und keine Bewertung: S-Zeilen des Vorzyklus wörtlich, Pakete des Vorzyklus-Reviews mit
// frischen Ticketzeilen aus der Jira-Kopie, ohne alte Antworten. Alles Automatische ist Board-Stand.

const link = (k: string) => `[${k}](${browseUrl(k)})`;
const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
export const isDone = (i: Pick<Issue, 'status' | 'statusCategory'>) => i.statusCategory === 'done' || i.status === 'Done';
const firstName = (n?: string | null) => (n ?? '').trim().split(/\s+/)[0] ?? '';
const safe = (s: string) => s.replace(/<!--/g, '').replace(/\s+/g, ' ').trim();
const cell = (s: string) => s.replace(/\|/g, '\\|');
const SOLL_HEAD = '| # | Ergebnis | Bewertung | Beleg | Warum / was ändern wir |\n|---|---|---|---|---|';

/** Platzhalter der Review-Vorlage, wenn es keine Daten gibt (neuer Zyklus ohne Entwurf). */
export function reviewDefaults(previous?: string): Record<string, string> {
  return {
    QUELLENLAGE: '…',
    SOLL_IST: `Bewertet werden die Ergebnisse S1–S4 aus dem Planning des Vorzyklus — wörtlich übernommen.\n\n${SOLL_HEAD}\n| S1 | … | … | … | … |`,
    MITNAHME_ALT: previous ? `Die Mitnahme steht in [[${previous}-review]] (Abschnitt „Mitnahme in den nächsten Sprint“); ihre Tickets stehen unten in ihren Paketen.` : '…',
    UPDATES: DOMAINS.map((d) => `### ${d}`).join('\n\n'),
    AUFFAELLIG: '…',
  };
}

function ticketLine(k: string, i: Issue | undefined, today: string, since: string): string | null {
  if (!i) return `- ${link(k)} · nicht in der Jira-Kopie <!--k:${k}-->`;
  const who = firstName(i.assignee) || '—';
  let tail: string;
  if (isDone(i)) {
    const at = (i.statusSince ?? '').slice(0, 10);
    if (!at || at < since) return null;                       // vor dem Zyklus erledigt → fällt raus
    tail = `Board: Done seit ${ddmm(at)}`;
  } else if (i.duedate && i.duedate < today) {
    tail = `**${Math.round((Date.parse(today) - Date.parse(i.duedate)) / 864e5)} Tage über**`;
  } else tail = i.duedate ? `fällig ${ddmm(i.duedate)}` : 'kein Datum';
  return `- ${link(k)} ${safe(i.summary)} · **${who}** · \`${i.status}\` · ${tail} <!--k:${k}-->`;
}

export interface DraftInput {
  date: string;                        // neuer Zyklus JJJJ-MM-TT
  prevId?: string;                     // sprint-JJJJ-MM-TT
  prevReview?: string;                 // Text der Vorzyklus-Review (Paketquelle)
  prevPlanning?: string;               // Text des Vorzyklus-Plannings (S-Zeilen, Ziel)
  issues: Map<string, Issue>;
  today: string;
  syncedAt?: string | null;            // Stand der Jira-Kopie
}

export interface DraftStats { packages: number; tickets: number; orphans: number; outcomes: number; fallback: boolean }

export function reviewDraftVars(inp: DraftInput): { vars: Record<string, string>; stats: DraftStats } {
  const prevDate = inp.prevId?.replace('sprint-', '') ?? '';
  const since = prevDate || inp.date;
  const prevDe = prevDate ? ddmm(prevDate) : '—';
  // Soll-Ist: S-Zeilen wörtlich, sonst der Ziel-Satz (Vorzyklus ohne S1–S4, z. B. 28.09.).
  const outs = inp.prevPlanning ? parseOutcomes(inp.prevPlanning) : [];
  let soll: string;
  if (outs.length) {
    soll = `Bewertet werden die Ergebnisse aus dem Planning vom ${prevDe} — wörtlich übernommen. Bewertung, Beleg und Warum setzt die Runde (kein ✅ ohne Beleg; Board-Stand belegt nicht „fachlich fertig“).\n\n${SOLL_HEAD}\n`
      + outs.map((o) => `| ${o.id} | ${cell(o.title)} | … | … | … |`).join('\n');
  } else {
    const goal = inp.prevPlanning ? parseGoal(inp.prevPlanning).goal : undefined;
    soll = goal
      ? `Das Planning vom ${prevDe} hat keine Ergebniszeilen S1–S4. Bewertet wird der Ziel-Satz; S-Zeilen beginnen mit diesem Planning (nicht rückwirkend erfunden).\n\n${SOLL_HEAD}\n| Ziel | ${cell(goal)} | … | … | … |`
      : 'Kein Planning mit Sprint-Ziel oder S-Zeilen im Vorzyklus gefunden — nichts zu bewerten. S-Zeilen beginnen mit diesem Planning.';
  }
  // Pakete des Vorzyklus, nur die Ankerzeilen neu aufgebaut.
  const pkgs = inp.prevReview ? parsePackages(inp.prevReview) : [];
  const inPkg = new Set<string>();
  const byDomain = new Map<string, string[]>(DOMAINS.map((d) => [d, []]));
  let nTickets = 0;
  for (const p of pkgs) {
    const rows: string[] = [];
    const owners = new Set<string>();
    let open = 0, over = 0, done = 0;
    for (const k of p.tickets) {
      if (inPkg.has(k)) continue;                              // genau einmal in „Die Updates“
      inPkg.add(k);
      const i = inp.issues.get(k);
      const line = ticketLine(k, i, inp.today, since);
      if (!line) continue;
      rows.push(`> ${line}`);
      nTickets++;
      if (i && isDone(i)) { done++; continue; }
      open++;
      if (i?.duedate && i.duedate < inp.today) over++;
      // Je Owner eine leere Antwortzeile unter seinem ersten offenen Ticket (Vorname: splitSpeaker nimmt ≤ 2 Wörter).
      const who = firstName(i?.assignee);
      if (who && !owners.has(who)) { owners.add(who); rows.push(`>   - ${who}:`); }
    }
    let body: string;
    if (!p.tickets.length) body = '… (Stand, offen, nächster Schritt — zwei, drei Sätze)\n\nKein Ticket.';
    else if (!rows.length) body = '…\n\nBoard: keine offenen und keine im Zyklus erledigten Tickets mehr — Paket abschließen oder neu schneiden?';
    else {
      const n = rows.filter((r) => r.includes('<!--k:')).length;
      const meta = [`${n} Ticket${n === 1 ? '' : 's'}`, owners.size ? [...owners].join(', ') : (open ? 'ohne Owner' : ''), over ? `${over} überfällig` : ''].filter(Boolean).join(' · ');
      body = `… (Stand, offen, nächster Schritt — zwei, drei Sätze)${!open && done ? '\n\nBoard: alle Tickets Done — stimmt das fachlich?' : ''}\n\n> [!note]- ${meta} — hier kommentieren\n${rows.join('\n')}`;
    }
    if (!byDomain.has(p.domain)) byDomain.set(p.domain, []);
    byDomain.get(p.domain)!.push(`#### ${p.name}\n\n${body}`);
  }
  const updates = [...byDomain].map(([d, b]) => [`### ${d}`, ...b].join('\n\n')).join('\n\n');
  // Auffälligkeiten: im Zyklus angelegt oder Status gewechselt, in keinem Paket (created/statusSince, nicht updated).
  const day = (s?: string | null) => (s ?? '').slice(0, 10);
  const orphans = [...inp.issues.values()].filter((i) => i.type !== 'Workstream' && !inPkg.has(i.key)
    && (day(i.created) >= since || day(i.statusSince) >= since)
    && (!isDone(i) || day(i.statusSince) >= since))
    .sort((a, b) => Number(a.key.split('-')[1]) - Number(b.key.split('-')[1]));
  const auff = orphans.length
    ? `- **Keinem Paket zugeordnet** — im Zyklus angelegt oder Status gewechselt (${orphans.length}, Board-Stand). In der Runde einsortieren oder als neues Paket aufnehmen:\n`
      + orphans.map((i) => `  - ${link(i.key)} ${safe(i.summary)} · ${firstName(i.assignee) || '—'} · \`${i.status}\``).join('\n')
    : '- Keine Tickets außerhalb der Pakete (im Zyklus angelegt oder bewegt).';
  const quellen = `Entwurf aus der Werkbank vom ${ddmm(inp.today)}: Pakete aus ${inp.prevId ? `[[${inp.prevId}-review]]` : '— (kein Vorzyklus)'}, Ticketzeilen aus der Jira-Kopie${inp.syncedAt ? ` (Stand ${inp.syncedAt.slice(0, 16).replace('T', ' ')})` : ''}. **Das ist Board-Stand, nicht Arbeitsstand**, und noch nicht in der Runde korrigiert: wo das Board „offen“ oder „Done“ sagt, ist das eine Frage an die Runde, kein Befund. Prosa und Bewertung fehlen bewusst (\`…\`). Quellen für die Prosa: [[pr-stand-produkt-olaf]], [[0-roadmap-produkt-olaf]], die Daily Debriefs unter \`olaf/1-Projects/daily-debrief/\`.`;
  return {
    vars: { QUELLENLAGE: quellen, SOLL_IST: soll, UPDATES: updates, AUFFAELLIG: auff },
    stats: { packages: pkgs.length, tickets: nTickets, orphans: orphans.length, outcomes: outs.length, fallback: !outs.length },
  };
}

// ---------- Mitnahme (Schritt 5) — Gleichlauf mit jira-sprint-carry.sh, aber aus der Jira-Kopie, nur lesend ----------

export function carryList(review: string, reviewName: string, issues: Map<string, Issue>, today: string, project = 'PM') {
  // Den eigenen Mitnahme-Abschnitt abschneiden (bis zur nächsten ##-Überschrift, die nicht mit M beginnt) — wie das Skript.
  const scope: string[] = [];
  let cut = false;
  for (const l of review.split('\n')) {
    if (/^## Mitnahme in den nächsten Sprint/.test(l)) { cut = true; continue; }
    if (cut && /^## [^M]/.test(l)) cut = false;
    if (!cut) scope.push(l);
  }
  const re = new RegExp(`\\b${project}-\\d+\\b`, 'g');
  const keys = [...new Set(scope.join('\n').match(re) ?? [])].sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1]));
  const missing = keys.filter((k) => !issues.has(k));
  const open = keys.map((k) => issues.get(k)).filter((i): i is Issue => !!i && !isDone(i) && i.type !== 'Workstream');
  const groups = {
    overdue: open.filter((i) => i.duedate && i.duedate < today),
    dated: open.filter((i) => i.duedate && i.duedate >= today),
    undated: open.filter((i) => !i.duedate),
  };
  type G = keyof typeof groups;
  const row = (i: Issue, g: G) => {
    const base = `- ${link(i.key)} **${safe(i.summary)}** · ${i.assignee ?? '—'} · \`${i.status}\``;
    if (g === 'overdue') return `${base} · **${Math.round((Date.parse(today) - Date.parse(i.duedate!)) / 864e5)} Tage über** (${i.duedate})`;
    return g === 'dated' ? `${base} · fällig ${i.duedate}` : `${base} · **kein Datum**`;
  };
  // Gestempelte Mitnahme-Zeilen („✓ … → Planning:“) bleiben drin — der Abschnitt wird jedes Mal ganz neu erzeugt.
  const carry = syncPlanRows(parseQuestions(review.replace(/- ✓ [0-9-]+ → Planning: /g, '- '))).filter((r) => r.kind === 'carry');
  const boardOpen = [...issues.values()].filter((i) => !isDone(i)).length;
  const out: string[] = ['## Mitnahme in den nächsten Sprint', '',
    `_Erzeugt ${today} aus ${reviewName} — alles, was der Review berührt und was nach dem Write-back`,
    `noch offen ist. ${keys.length} Tickets im Review erwähnt, ${open.length} davon offen._`];
  const titles: [G, string][] = [['overdue', 'Überfällig'], ['dated', 'Offen mit Datum'], ['undated', 'Offen ohne Fälligkeitsdatum']];
  for (const [g, t] of titles) if (groups[g].length) out.push('', `### ${t} (${groups[g].length})`, '', ...groups[g].map((i) => row(i, g)));
  if (carry.length) out.push('', '### Entscheidungen und neue Ziele (aus dem Review getaggt)', '',
    ...carry.map((c) => `- ${c.payload} — ${link(c.key.replace(/^ZIEL:/, ''))}${c.speaker !== '-' ? ` (${c.speaker})` : ''}`));
  if (missing.length) out.push('', `_Nicht in der Jira-Kopie (${missing.length}): ${missing.join(', ')} — erst abgleichen._`);
  if (boardOpen > 0) out.push('', `_Board: ${boardOpen} Tickets offen, davon ${open.length} in dieser Liste — ${boardOpen - open.length} offene Tickets kommen im Review nicht vor._`);
  return {
    markdown: out.join('\n') + '\n', keys: keys.length, open: open.length, carry: carry.length, missing,
    groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.map((i) => i.key)])) as Record<G, string[]>,
  };
}

// ---------- Aktueller Zyklus ----------

/** Neuester nicht archivierter Zyklus mit Startdatum ≤ heute (ein vorab angelegter Ordner zählt noch nicht). */
export function currentCycle<T extends Pick<Cycle, 'date' | 'archived'>>(cs: T[], today = new Date().toISOString().slice(0, 10)): T | undefined {
  const live = cs.filter((c) => !c.archived);
  return live.find((c) => c.date <= today) ?? live[live.length - 1];
}
