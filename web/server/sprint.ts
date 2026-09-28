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
}

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
      const first = plain(c[0] ?? '');
      const idm = first.match(/^(S\d{1,2})\b\.?\s*(.*)$/);
      if (!idm) { header = c.map((h) => plain(h).toLowerCase()); continue; }
      const col = (re: RegExp) => { const k = header?.findIndex((h) => re.test(h)) ?? -1; return k >= 0 ? c[k] : undefined; };
      const title = col(/ergebnis|ziel|was/) ?? (idm[2] || c[1] || '');
      const ratingCell = col(/bewertung|stand|erreicht/) ?? c.find((x) => RATING.test(x));
      out.push({
        id: idm[1], title: plain(idm[2] && !col(/ergebnis|ziel|was/) ? idm[2] : title),
        dod: col(/dod|definition|fertig/) && plain(col(/dod|definition|fertig/)!),
        owner: col(/owner|wer/) && plain(col(/owner|wer/)!),
        date: col(/datum|bis|fällig|termin/) && plain(col(/datum|bis|fällig|termin/)!),
        rating: ratingCell?.match(RATING)?.[1] as Outcome['rating'],
        evidence: col(/beleg|nachweis/) && plain(col(/beleg|nachweis/)!),
        why: col(/warum|ändern/) && plain(col(/warum|ändern/)!),
        line: i + 1,
      });
      continue;
    }
    header = null;
    const li = l.match(/^\s*[-*] \*\*(S\d{1,2})\*\*:?\s*(.*)$/);
    if (li) {
      const rest = li[2].replace(/<!--k:[^>]+-->/, '').trim();
      const part = (re: RegExp) => rest.match(re)?.[1]?.trim();
      out.push({
        id: li[1],
        title: plain(rest.split(' · ')[0].replace(RATING, '')),
        dod: part(/DoD:\s*([^·]+)/i), owner: part(/Owner:\s*([^·]+)/i), date: part(/(?:bis|Datum:)\s*([0-9.]+)/i),
        rating: rest.match(RATING)?.[1] as Outcome['rating'],
        evidence: part(/Beleg:\s*([^·]+)/i), why: part(/Warum[^:]*:\s*([^·]+)/i),
        line: i + 1,
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

export function newCycleFiles(templateDir: string, date: string, previous?: string): { name: string; content: string }[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Datum im Format JJJJ-MM-TT angeben.');
  const end = new Date(date + 'T12:00:00Z');
  end.setUTCDate(end.getUTCDate() + 14);
  const endIso = end.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const vars = {
    DATUM: date, DATUM_DE: de(date), ENDE: endIso, ENDE_DE: de(endIso), HEUTE: today,
    VORZYKLUS: previous ?? '', VORZYKLUS_DATUM: previous ? de(previous.replace('sprint-', '')) : '—',
  };
  return ['summary', 'review', 'planning'].map((k) => ({
    name: `sprint-${date}-${k}.md`,
    content: fillTemplate(readFileSync(join(templateDir, `${k}.md`), 'utf8'), vars),
  }));
}

export const cycleIdOf = (file: string) => basename(file).replace(/-(summary|review|planning)\.md$/, '');
