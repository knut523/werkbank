// Roadmap-Automatik (docs/plan-roadmap-automatik.md; Knut, 08.10.2026: „nach jedem agenten lauf gezielt nachziehen,
// offene entscheidungen surfacen … und die anderen punkte auch“).
//
//   Feed       Werkbank-Stand (Jira, Agentenläufe, Projekte) als Markdown für den Vault-Sync-Snapshot.
//   Nachzug    fertiger Karten-Agent mit Ticket → Warteschlange → höchstens alle 20 min `vault-sync.sh --scope`.
//   Fragen     „Offen/unklar“ aus dem letzten Abschnitt des Sync-Protokolls → Ja/Nein unter „Für mich offen“;
//              Ja schreibt eine Freigabe, die der nächste Sync ausführt und als „erledigt: <Kennung>“ meldet.
//   Entwurf    „Woran wir gerade arbeiten“ als Datei vom 07:30-Lauf → „Übernehmen“ ersetzt den Markerblock im Hub.
//
// Alles Reine steht oben (testbar), Dateien/Prozesse unten.

import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

// ---------- Feed ----------

export interface FeedIssue { key: string; summary: string; status: string; assignee: string | null; duedate: string | null; updated: string; type: string; workstream?: string | null; statusCategory?: string }
export interface FeedRun { key: string | null; projectName?: string | null; finishedAt?: Date | string | null; startedAt?: Date | string | null; vaultNotes: string[]; prs: string[] }
export interface FeedProject { name: string; workstream: string | null; tickets: string[] }

const PR_URL = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/g;
/** PR-Links aus beliebigem Text (Chat-Antwort, Notiz), ohne Doppel. */
export const prLinks = (text: string) => [...new Set(text.match(PR_URL) ?? [])];

const day = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : '?');
const cell = (s: string | null | undefined) => String(s ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

/**
 * Markdown für den Snapshot. Nur Ticket-Metadaten, Läufe und Projekte — keine Beschreibungen, Kommentare,
 * Chat-Inhalte, Zugangsdaten (die Datei landet im Prompt eines Laufs, der in den Vault schreibt).
 */
export function buildFeed(p: { now: Date; issues: FeedIssue[]; runs: FeedRun[]; projects: FeedProject[]; days?: number }): string {
  const days = p.days ?? 3;
  const since = new Date(p.now.getTime() - days * 86_400_000).toISOString();
  const open = p.issues.filter((i) => i.type !== 'Workstream' && i.statusCategory !== 'Done' && i.status !== 'Done');
  const changed = open.filter((i) => i.updated >= since).sort((a, b) => b.updated.localeCompare(a.updated));
  const doneRecent = p.issues.filter((i) => (i.statusCategory === 'Done' || i.status === 'Done') && i.updated >= since);
  const out = [`## Werkbank — Stand ${p.now.toISOString().slice(0, 16).replace('T', ' ')} UTC`, ''];
  out.push(`### Jira PM: in den letzten ${days} Tagen geändert (${changed.length} offen, ${doneRecent.length} erledigt)`, '');
  out.push('| Ticket | Status | Owner | Fällig | Workstream | Titel |', '|---|---|---|---|---|---|');
  for (const i of [...changed, ...doneRecent]) out.push(`| ${i.key} | ${cell(i.status)} | ${cell(i.assignee) || '—'} | ${i.duedate ?? '—'} | ${i.workstream ?? '—'} | ${cell(i.summary).slice(0, 90)} |`);
  out.push('');
  const runs = p.runs.filter((r) => r.key && day(r.finishedAt ?? r.startedAt) >= since.slice(0, 10));
  out.push(`### Agentenläufe an Karten (letzte ${days} Tage, fertig)`, '');
  if (!runs.length) out.push('- keine');
  for (const r of runs) {
    const bits = [r.projectName ? `Projekt „${cell(r.projectName)}“` : null, r.vaultNotes.length ? `Vault: ${r.vaultNotes.map((n) => '`' + n + '`').join(', ')}` : null, r.prs.length ? `PRs: ${r.prs.join(' ')}` : null].filter(Boolean);
    out.push(`- ${r.key} · ${day(r.finishedAt ?? r.startedAt)}${bits.length ? ' · ' + bits.join(' · ') : ''}`);
  }
  out.push('', '### Projekte je Workstream', '');
  const byWs = new Map<string, FeedProject[]>();
  for (const pr of p.projects) byWs.set(pr.workstream ?? '—', [...(byWs.get(pr.workstream ?? '—') ?? []), pr]);
  if (!byWs.size) out.push('- keine');
  for (const [ws, list] of [...byWs].sort()) out.push(`- ${ws}: ${list.map((x) => `${cell(x.name)} (${x.tickets.join(', ')})`).join('; ')}`);
  return out.join('\n') + '\n';
}

// ---------- Nachzug: ein Planer für alle Sync-Starts ----------

/**
 * Ein einziger Zustand für alle Starts (Review 4): Tickets aus Agentenläufen (gedrosselt, Standard 20 min) und ein
 * voller Lauf nach einem „Ja“ (frühestens 5 min nach dem letzten Start). Nichts geht verloren: was nicht starten
 * kann (Drossel, Sperre belegt), bleibt liegen und wird beim nächsten Takt erneut versucht.
 */
export interface SyncQueue { pending: Set<string>; full: boolean; lastRunAt: number }
export const newQueue = (): SyncQueue => ({ pending: new Set(), full: false, lastRunAt: 0 });

export type Due = { scope: string[] | null } | null;

/** Was jetzt starten darf. `locked` = ein Sync läuft gerade (flock belegt). Leert nur, was tatsächlich startet. */
export function takeDue(q: SyncQueue, now: number, locked: boolean, gaps = { tickets: 20 * 60_000, full: 5 * 60_000 }): Due {
  if (locked) return null;
  const since = now - q.lastRunAt;
  if (q.full && since >= gaps.full) {
    q.full = false; q.pending.clear(); q.lastRunAt = now;   // ein voller Lauf deckt die Tickets mit ab
    return { scope: null };
  }
  if (q.pending.size && since >= gaps.tickets) {
    const keys = [...q.pending].sort();
    q.pending.clear(); q.lastRunAt = now;
    return { scope: keys };
  }
  return null;
}

// ---------- Fragen aus dem Sync-Protokoll ----------

export interface SyncQuestion { id: string; n: string; text: string; section: string; key: string }

const NONE = /^(keine?|nichts)\b.*$|^(—|-|n\/a)\.?$/i;
/** Schlüssel nur aus dem Text (für „Nein — nicht wieder vorschlagen“, Review 2). */
export const textKey = (text: string) => createHash('sha256').update(text.toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim()).digest('hex').slice(0, 12);

function offenItems(body: string): { n: string; text: string }[] {
  const m = body.match(/^(\*\*)?Offen\/unklar:?(\*\*)?:?.*$/m);
  if (!m) return [];
  const rest = m[0].match(/^(?:\*\*)?Offen\/unklar:?(?:\*\*)?:?\s*(.+)$/);   // Punkt in derselben Zeile („Offen/unklar: keine“)
  const inline = rest ? rest[1].replace(/^\*+|\*+$/g, '').trim() : '';   // nur „**“ übrig → kein Punkt
  const items: { n: string; lines: string[] }[] = inline && !NONE.test(inline) ? [{ n: '1', lines: [inline] }] : [];
  for (const l of body.slice(m.index! + m[0].length).split('\n')) {
    if (/^(## |\*\*[^*]+:\*\*\s*$)/.test(l)) break;
    const it = l.match(/^- \((\d+)\)\s+(.*)$/) ?? l.match(/^- ()(.*)$/);
    if (it) { items.push({ n: it[1] || String(items.length + 1), lines: [it[2]] }); continue; }
    if (items.length && /^\s+\S/.test(l)) items[items.length - 1].lines.push(l.trim());
  }
  return items.map((it) => ({ n: it.n, text: it.lines.join(' ').replace(/\s+/g, ' ').trim() })).filter((x) => x.text && !NONE.test(x.text.replace(/\*/g, '')));
}

/**
 * Fragen = „Offen/unklar“ des letzten regulären Laufs (Überschrift ohne „· Nachzug“), dazu die offenen Punkte der
 * gezielten Nachzüge DANACH (Review 3: ein Nachzug verdrängt die Morgenfragen nicht). Ein Punkt ist `- (n) …` samt
 * eingerückter Fortsetzung; „keine“ ist keine Frage. Kennung = Abschnitt + Text.
 */
export function parseSyncQuestions(protocol: string): SyncQuestion[] {
  const heads = [...protocol.matchAll(/^## (\d{4}-\d{2}-\d{2} \d{2}:\d{2})(.*)$/gm)];
  const sec = heads.map((h, i) => ({ when: h[1], nachzug: /Nachzug/i.test(h[2]), body: protocol.slice(h.index! + h[0].length, i + 1 < heads.length ? heads[i + 1].index! : protocol.length) }));
  // Der letzte reguläre Lauf gilt, auch wenn er nichts Offenes meldet (dann sind die alten Fragen überholt, Review 2/M1).
  let start = -1;
  for (let i = sec.length - 1; i >= 0; i--) if (!sec[i].nachzug) { start = i; break; }
  if (start < 0) start = sec.findIndex((x) => x.nachzug);       // nur Nachzüge im Protokoll
  if (start < 0) return [];
  const out: SyncQuestion[] = [];
  for (const x of sec.slice(start)) {
    if (x !== sec[start] && !x.nachzug) continue;
    for (const it of offenItems(x.body)) out.push({ id: 'S' + createHash('sha256').update(x.when + '|' + it.text).digest('hex').slice(0, 10), n: it.n, text: it.text, section: x.when, key: textKey(it.text) });
  }
  return out;
}

// „erledigt“ in den Schreibweisen, die ein Modell wählt: `erledigt: S…`, **erledigt:** `S…`, Erledigt – S…, auch
// mehrere Kennungen („S…, S…“) und mehrere Meldungen in einer Zeile (Review 1, Review 2/M2).
const MARK_RE = /(nicht[ \t]*\**[ \t]*)?\berledigt\**[ \t]*[:–-]/gi;
const ID_RE = /S[0-9a-f]{10}/g;

function doneMarks(protocol: string): { not: boolean; ids: string[]; reason: string }[] {
  const out: { not: boolean; ids: string[]; reason: string }[] = [];
  for (const line of protocol.split('\n')) {
    const marks = [...line.matchAll(MARK_RE)];
    marks.forEach((m, i) => {
      const seg = line.slice(m.index! + m[0].length, i + 1 < marks.length ? marks[i + 1].index! : line.length);
      const ids = seg.match(ID_RE) ?? [];
      if (!ids.length) return;
      const after = seg.slice(seg.lastIndexOf(ids[ids.length - 1]) + 11);
      const reason = (after.match(/^[`*\s]*[—–-]\s*(.*)$/)?.[1] ?? '').replace(/[;,]\s*$/, '').trim();
      out.push({ not: !!m[1], ids, reason });
    });
  }
  return out;
}

/** Kennungen, die der Sync als erledigt gemeldet hat. „nicht erledigt“ zählt nicht. */
export function doneIds(protocol: string): Set<string> {
  return new Set(doneMarks(protocol).filter((x) => !x.not).flatMap((x) => x.ids));
}

/** „nicht erledigt: S… — Grund“ → Grund (letzte Meldung gewinnt). */
export function notDone(protocol: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const x of doneMarks(protocol)) if (x.not) for (const id of x.ids) out.set(id, x.reason);
  return out;
}

export interface Approval { id: string; text: string; at: string; by: string }

/** Inhalt der Freigabe-Datei, die der Sync liest: offene Freigaben und verworfene Punkte (nicht wieder vorschlagen). */
export function renderApprovals(list: Approval[], rejected: string[] = []): string {
  const out = ['# Freigaben aus der Werkbank', '',
    'Diese Punkte hat ein Admin in der Werkbank mit „Ja“ freigegeben. Führe jeden genau im beschriebenen Umfang aus —',
    'auch Zeilen löschen, Specs verschieben (alte Datei entfernen, neue anlegen) oder überholten Text ersetzen — und',
    'melde jeden im Protokoll mit einer eigenen Zeile „erledigt: <Kennung>“ und den geänderten Dateien. Geht ein Punkt',
    'nicht, melde „nicht erledigt: <Kennung> — <Grund>“.', '', '## Freigegeben', ''];
  if (!list.length) out.push('- keine');
  for (const a of list) out.push(`- ${a.id} (${a.at.slice(0, 10)}, ${a.by}): ${a.text}`);
  out.push('', '## Verworfen — nicht wieder unter „Offen/unklar“ vorschlagen', '');
  if (!rejected.length) out.push('- keine');
  for (const t of rejected) out.push(`- ${t}`);
  return out.join('\n') + '\n';
}

// ---------- Entwurf „Woran wir gerade arbeiten“ ----------

export const WORK_START = '<!-- werkbank:woran-wir-arbeiten -->';
export const WORK_END = '<!-- /werkbank:woran-wir-arbeiten -->';

const count = (s: string, sub: string) => s.split(sub).length - 1;

/** Ersetzt den Markerblock. Kein Block, doppelt oder vertauscht → null (dann wird NICHT geschrieben). */
export function replaceWorkBlock(note: string, block: string): string | null {
  if (count(note, WORK_START) !== 1 || count(note, WORK_END) !== 1) return null;
  const a = note.indexOf(WORK_START), b = note.indexOf(WORK_END);
  if (b < a) return null;
  return note.slice(0, a) + `${WORK_START}\n${block.trim()}\n${WORK_END}` + note.slice(b + WORK_END.length);
}

/** Der Entwurf ohne Frontmatter. */
export function draftBody(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
}

// ---------- Dateien und Prozesse ----------

export const syncDir = () => process.env.WERKBANK_VAULT_SYNC_DIR || join(homedir(), '.cache', 'vault-sync');
export const feedPath = () => process.env.WERKBANK_ROADMAP_FEED || join(syncDir(), 'werkbank-feed.md');
export const approvalsPath = () => join(syncDir(), 'freigaben.md');

export function writeAtomic(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  try { writeFileSync(tmp, text); renameSync(tmp, path); }
  catch (e) { try { unlinkSync(tmp); } catch { /* schon weg */ } throw e; }
}

/** Läuft gerade ein Vault-Sync? (dieselbe Sperre wie im Skript: flock auf <sync-dir>/.lock) */
export function syncLocked(dir = syncDir()): boolean {
  const lock = join(dir, '.lock');
  if (!existsSync(lock)) return false;
  const r = spawnSync('flock', ['-n', lock, 'true'], { timeout: 3000 });
  return r.status !== 0;
}

export const readOr = (path: string, fallback = '') => { try { return readFileSync(path, 'utf8'); } catch { return fallback; } };
export const mtime = (path: string) => { try { return statSync(path).mtimeMs; } catch { return 0; } };

/** Startet den Vault-Sync losgelöst (der flock im Skript verhindert Doppelläufe). false, wenn das Skript fehlt. */
export function startVaultSync(script: string, scope: string[] | null, log: (m: string, d?: any) => void): boolean {
  if (!existsSync(script)) { log('roadmap-sync: Skript fehlt', { script }); return false; }
  const args = scope?.length ? ['--scope', scope.join(',')] : [];
  // Von der Werkbank gestartete Läufe schreiben nie den Morgen-Entwurf neu (sonst kommt ein verworfener wieder).
  const child = spawn('bash', [script, ...args], { detached: true, stdio: 'ignore', env: { ...process.env, VAULT_SYNC_NO_DRAFT: '1' } });
  child.on('error', (e) => log('roadmap-sync: Start fehlgeschlagen', { error: String(e.message).slice(0, 160) }));
  child.unref();
  log('roadmap-sync gestartet', { scope });
  return true;
}
