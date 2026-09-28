// "Sprint-Sync vorbereiten": dieselbe Logik wie /sprint-sync, Schritt 1–3.
// 1. jira-sync-plan.sh --sprint <Ordner> (read-only) liefert die Notizen als TSV.
// 2. Jede Notiz wird in einen Vorschlag übersetzt (Status / Fälligkeit / Kommentar); Mehrdeutiges
//    wird nicht geraten, sondern als offene Frage markiert; Widersprüche zum Board werden benannt.
// 3. Die Tabelle geht zur Freigabe in die Oberfläche. Geschrieben wird erst nach Klick (main.ts).
// Tickets anlegen gehört ausdrücklich NICHT dazu.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { cfg } from './config.ts';
import type { Issue } from './jira.ts';

export interface PlanRow { kind: string; key: string; speaker: string; payload: string; line: number; file: string }
export interface Proposal {
  id: string;
  row: PlanRow;
  ticket: string | null;
  actions: ({ type: 'comment'; text: string } | { type: 'status'; to: string; from?: string } | { type: 'due'; date: string | null; from?: string | null })[];
  question?: string;       // offen, nicht raten
  conflict?: string;       // Widerspruch zum heutigen Stand
  carry?: boolean;         // → mitnehmen: nie nach Jira
}

export function parseTsv(tsv: string): PlanRow[] {
  return tsv.split('\n').filter((l) => l.trim()).map((l) => {
    const [kind, key, speaker, payload, line, file] = l.split('\t');
    return { kind, key, speaker, payload, line: Number(line), file };
  });
}

export function runSyncPlan(sprintDir: string): Promise<PlanRow[]> {
  const script = join(cfg.jiraScripts, 'jira-sync-plan.sh');
  if (!existsSync(script)) return Promise.reject(new Error(`jira-sync-plan.sh nicht gefunden (${script}) — Skills abgleichen: scripts/werkbank.sh skills`));
  return new Promise((resolve, reject) => {
    execFile(script, ['--sprint', sprintDir], { timeout: 30_000, maxBuffer: 8 << 20 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message).trim().slice(0, 300)));
      resolve(parseTsv(stdout));
    });
  });
}

const STATUS_WORDS: [RegExp, string][] = [
  [/\b(auf|nach) (done|erledigt)\b|\bschlie(ß|ss)en\b|\bdone setzen\b|\bclose\b|\bist (durch|erledigt)\b.*\bdone\b/i, 'Done'],
  [/\b(in progress|in arbeit)\b/i, 'In Progress'],
  [/\bauf to ?do\b|\bzurück auf to ?do\b/i, 'To Do'],
  [/\b(in den |auf )?backlog\b/i, 'Backlog'],
  [/\bongoing\b/i, 'Ongoing'],
];

/** "neues Datum 25.09." / "bis 02.10.2026" / "Datum 2026-10-02" / "ohne Datum" → ISO oder null. */
export function parseDue(text: string, today = new Date()): { date: string | null } | undefined {
  if (/\bohne (datum|date|due)\b/i.test(text)) return { date: null };
  if (!/(datum|date|due|fällig|verschieb|neu setzen|bis)\b/i.test(text)) return undefined;
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return { date: iso[0] };
  const m = text.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/);
  if (!m) return undefined;
  let y = m[3] ? Number(m[3].length === 2 ? '20' + m[3] : m[3]) : today.getFullYear();
  const mo = Number(m[2]), d = Number(m[1]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  const cand = new Date(Date.UTC(y, mo - 1, d));
  if (!m[3] && cand.getTime() < today.getTime() - 60 * 864e5) y += 1;   // "05.01." im Dezember → nächstes Jahr
  return { date: `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
}

export function proposalsFor(rows: PlanRow[], issues: Map<string, Issue>, sprintDate: string): Proposal[] {
  const dateDe = sprintDate.split('-').reverse().join('.');
  return rows.map((row, n) => {
    const ticket = row.key.match(/PM-\d+/)?.[0] ?? null;          // ZIEL:PM-70 → PM-70
    const p: Proposal = { id: `${n}-${row.line}`, row, ticket, actions: [] };
    if (row.kind === 'carry') { p.carry = true; return p; }
    if (!ticket) { p.question = `Kein Ticket zum Anker „${row.key}“ — nicht nach Jira.`; return p; }
    const cur = issues.get(ticket);
    const text = row.payload;
    if (row.kind === 'status') {
      p.actions.push({ type: 'status', to: text.trim(), from: cur?.status });
    } else {
      const st = STATUS_WORDS.find(([re]) => re.test(text))?.[1];
      if (st) p.actions.push({ type: 'status', to: st, from: cur?.status });
      const due = parseDue(text);
      if (due) p.actions.push({ type: 'due', date: due.date, from: cur?.duedate ?? null });
      else if (/(neues? datum|neu setzen|verschieben)/i.test(text)) p.question = 'Neues Datum fehlt — bitte angeben.';
      // Alles, was Information trägt, wird Kommentar; reine Statusanweisung braucht keinen.
      const pureInstruction = (st || due) && text.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').length <= 5;
      if (!pureInstruction) {
        const speaker = row.speaker && row.speaker !== '-' ? `${row.speaker} (Sprint Review, ${dateDe})` : `Sprint Review, ${dateDe}`;
        p.actions.push({ type: 'comment', text: `${speaker}: ${text}` });
      }
    }
    if (cur) {
      const st = p.actions.find((a) => a.type === 'status') as any;
      if (st && cur.status.toLowerCase() === st.to.toLowerCase()) p.conflict = `Ticket steht schon auf „${cur.status}“.`;
      const due = p.actions.find((a) => a.type === 'due') as any;
      if (due && cur.duedate === due.date) p.conflict = `Fälligkeit ist schon ${cur.duedate}.`;
    } else p.conflict = 'Ticket ist nicht in der Jira-Kopie — erst synchronisieren.';
    return p;
  });
}
