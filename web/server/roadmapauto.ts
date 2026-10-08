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
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
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

// ---------- Nachzug: Warteschlange mit Drossel ----------

export interface SyncQueue { pending: Set<string>; lastRunAt: number }
export const newQueue = (): SyncQueue => ({ pending: new Set(), lastRunAt: 0 });

/** Welche Tickets jetzt laufen dürfen: null = warten (Drossel) oder nichts da. Leert die Warteschlange. */
export function takeDue(q: SyncQueue, now: number, minGapMs = 20 * 60_000): string[] | null {
  if (!q.pending.size || now - q.lastRunAt < minGapMs) return null;
  const keys = [...q.pending].sort();
  q.pending.clear();
  q.lastRunAt = now;
  return keys;
}

// ---------- Fragen aus dem Sync-Protokoll ----------

export interface SyncQuestion { id: string; n: string; text: string; section: string }

/**
 * „Offen/unklar“-Punkte des letzten `## <Datum Uhrzeit>`-Abschnitts, der welche hat. Ein Punkt ist eine Zeile `- (n) …` samt
 * eingerückter Fortsetzung. Die Kennung hängt am Abschnitt und am Text, nicht an der Nummer allein — derselbe
 * Text in einem späteren Lauf ist eine neue Frage (der Stand kann sich geändert haben).
 */
export function parseSyncQuestions(protocol: string): SyncQuestion[] {
  const heads = [...protocol.matchAll(/^## (\d{4}-\d{2}-\d{2} \d{2}:\d{2}).*$/gm)];
  // Rückwärts: der letzte Abschnitt, der überhaupt „Offen/unklar“ hat (ein gezielter Nachzug ohne offene Punkte
  // soll die Fragen des Morgenlaufs nicht verschwinden lassen).
  let section = '', body = '', m: RegExpMatchArray | null = null;
  for (let i = heads.length - 1; i >= 0 && !m; i--) {
    const end = i + 1 < heads.length ? heads[i + 1].index! : protocol.length;
    body = protocol.slice(heads[i].index! + heads[i][0].length, end);
    m = body.match(/^\*\*Offen\/unklar:?\*\*:?\s*$|^Offen\/unklar:.*$/m);
    section = heads[i][1];
  }
  if (!m) return [];
  const lines = body.slice(m.index! + m[0].length).split('\n');
  const items: { n: string; lines: string[] }[] = [];
  for (const l of lines) {
    if (/^(## |\*\*[^*]+:\*\*\s*$)/.test(l)) break;              // nächster Abschnitt oder nächste fette Überschrift
    const it = l.match(/^- \((\d+)\)\s+(.*)$/) ?? l.match(/^- ()(.*)$/);
    if (it) { items.push({ n: it[1] || String(items.length + 1), lines: [it[2]] }); continue; }
    if (items.length && /^\s+\S/.test(l)) items[items.length - 1].lines.push(l.trim());
  }
  return items.map((it) => {
    const text = it.lines.join(' ').replace(/\s+/g, ' ').trim();
    return { id: 'S' + createHash('sha256').update(section + '|' + text).digest('hex').slice(0, 10), n: it.n, text, section };
  });
}

/** Kennungen, die der Sync im Protokoll als erledigt gemeldet hat (`erledigt: S…`). */
export function doneIds(protocol: string): Set<string> {
  // „nicht erledigt: S…“ zählt nicht — die Frage bleibt dann offen und taucht wieder auf.
  return new Set([...protocol.matchAll(/(?<!nicht )erledigt:\s*(S[0-9a-f]{10})/gi)].map((m) => m[1]));
}

export interface Approval { id: string; text: string; at: string; by: string }

/** Inhalt der Freigabe-Datei, die der Sync liest. Nur offene (noch nicht erledigte) Freigaben. */
export function renderApprovals(list: Approval[]): string {
  const out = ['# Freigaben aus der Werkbank', '',
    'Diese Punkte hat ein Admin in der Werkbank mit „Ja“ freigegeben. Führe jeden genau im beschriebenen Umfang aus —',
    'auch Zeilen löschen, Specs verschieben (alte Datei entfernen, neue anlegen) oder überholten Text ersetzen — und',
    'melde jeden im Protokoll mit „erledigt: <Kennung>“ und den geänderten Dateien. Geht ein Punkt nicht, melde',
    '„nicht erledigt: <Kennung> — <Grund>“.', '', '## Freigegeben', ''];
  if (!list.length) out.push('- keine');
  for (const a of list) out.push(`- ${a.id} (${a.at.slice(0, 10)}, ${a.by}): ${a.text}`);
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
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

export const readOr = (path: string, fallback = '') => { try { return readFileSync(path, 'utf8'); } catch { return fallback; } };
export const mtime = (path: string) => { try { return statSync(path).mtimeMs; } catch { return 0; } };

/** Startet den Vault-Sync losgelöst (der flock im Skript verhindert Doppelläufe). false, wenn das Skript fehlt. */
export function startVaultSync(script: string, scope: string[] | null, log: (m: string, d?: any) => void): boolean {
  if (!existsSync(script)) { log('roadmap-sync: Skript fehlt', { script }); return false; }
  const args = scope?.length ? ['--scope', scope.join(',')] : [];
  const child = spawn('bash', [script, ...args], { detached: true, stdio: 'ignore' });
  child.on('error', (e) => log('roadmap-sync: Start fehlgeschlagen', { error: String(e.message).slice(0, 160) }));
  child.unref();
  log('roadmap-sync gestartet', { scope });
  return true;
}
