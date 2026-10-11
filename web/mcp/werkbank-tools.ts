#!/usr/bin/env node
// MCP-Server "werkbank" (stdio) — nur für Sitzungen der Werkbank-Brücke, je Person gestartet.
// Werkzeuge:
//   hygiene_list    eigene Task-Hygiene-Punkte (lesend)
//   hygiene_snooze  einen Punkt für heute auf "später" setzen (ändert nur Werkbank-Zustand)
//   review_ready    Fertig-Marke am eigenen Agentenlauf dieser Unterhaltung (ändert nur Werkbank-Zustand)
//   jira_update     Kommentar / Status / Fälligkeit auf einem eigenen PM-Ticket — die Brücke fragt vorher
//                   im Chat nach ("ja"); geschrieben wird über den Atlassian-MCP der Person (eigene kurze Claude-Sitzung, nur dieser Aufruf).
//   jira_update_many  dasselbe für mehrere Tickets mit einer Rückfrage (Tagesabschluss), der Reihe nach geschrieben
//   agent_start     neuen Chat mit Agent auf einem Ticket starten (wie „Agent“ am Board) — Rückfrage vorher
// Umgebung (von der Brücke gesetzt): WERKBANK_URL, WERKBANK_INTERNAL_TOKEN, WERKBANK_USER_ID.

import { serve } from './stdio.ts';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const SKILLS_DIR = process.env.BRIDGE_SKILLS_DIR || join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'skills');

const URL_ = process.env.WERKBANK_URL || 'http://127.0.0.1:3070';
const TOKEN = process.env.WERKBANK_INTERNAL_TOKEN || '';
const USER = process.env.WERKBANK_USER_ID || '';

async function call(path: string, body: unknown, timeoutMs = 30_000): Promise<any> {
  const r = await fetch(URL_ + path, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': TOKEN },
    body: JSON.stringify({ userId: USER, ...(body as object) }), signal: AbortSignal.timeout(timeoutMs),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Werkbank antwortet mit ${r.status}`);
  return j;
}

const MAX_MANY = 25;
// Nur für die Rückfrage im Chat (die Brücke zeigt sie an); geschrieben wird nur comment/status/due.
const SHOW = { summary: { type: 'string', description: 'Ticket-Titel genau wie in Jira (Anzeige; die Werkbank prüft ihn gegen das Ticket)' }, was: { type: 'string', description: 'bisheriger Stand, z. B. „To Do, fällig 02.10.“ (Anzeige)' }, reason: { type: 'string', description: 'Grund der Änderung (Anzeige)' } };
const CHANGE = { comment: { type: 'string' }, status: { type: 'string', description: 'Zielstatus, z. B. Done' }, due: { type: 'string', description: 'JJJJ-MM-TT oder "" für ohne Datum' } };

serve('werkbank', '0.1.0', [
  {
    name: 'hygiene_list',
    description: 'Eigene Task-Hygiene-Punkte (überfällig, ohne Datum, still, Widerspruch, ohne Workstream, Sub-task ohne Owner).',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const j = await call('/internal/hygiene', {});
      return j.items.length ? j.items.map((i: any) => `- ${i.key} [${i.rule}] ${i.detail}${j.snoozed.includes(i.key) ? ' (heute später)' : ''}`).join('\n') : 'Keine offenen Hygiene-Punkte.';
    },
  },
  {
    name: 'hygiene_snooze',
    description: 'Hygiene-Punkt für heute auf „später“ setzen (wird heute nicht mehr gefragt).',
    inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    run: async (a: any) => { await call('/internal/hygiene-snooze', { key: a.key }); return `${a.key}: heute nicht mehr nachfragen.`; },
  },
  {
    name: 'skills_list',
    description: 'Alle verfügbaren Skills (Name + eine Zeile). In dieser Sitzung ist nur ein Kern aktiv; nennt die Person einen Skill („Skill <name>“), ist er ab der nächsten Nachricht zugeschaltet. SKILL.md liegt unter dem angegebenen Pfad.',
    inputSchema: { type: 'object', properties: { filter: { type: 'string' } } },
    run: async (a: any) => {
      const rows: string[] = [];
      for (const n of readdirSync(SKILLS_DIR).sort()) {
        const f = join(SKILLS_DIR, n, 'SKILL.md');
        if (!existsSync(f)) continue;
        const d = (readFileSync(f, 'utf8').match(/^description:\s*(.+)$/m)?.[1] ?? '').replace(/^["']|["']$/g, '');
        const line = `- ${n}: ${d.length > 140 ? d.slice(0, 139) + '…' : d}`;
        if (!a.filter || line.toLowerCase().includes(String(a.filter).toLowerCase())) rows.push(line);
      }
      return `${rows.length} Skills (Pfad: ${SKILLS_DIR}/<name>/SKILL.md):\n${rows.join('\n')}`;
    },
  },
  {
    name: 'review_ready',
    description: 'Am Ende eines Werkbank-Agentenlaufs: meldet „bereit zum Review“. Pflicht: gemacht, nicht_gemacht, risiko (je kurzer Text, „nichts“ statt leer) und dod (je Punkt der Definition of Done: punkt, stand ja|teilweise|nein, beleg). artefakte: Plan-Notiz, Dateien, Branch, PR-Link. Gilt nur für diese Unterhaltung; die Person sieht es in ihrer Review-Schlange.',
    inputSchema: {
      type: 'object',
      properties: {
        gemacht: { type: 'string' }, nicht_gemacht: { type: 'string' }, risiko: { type: 'string' },
        dod: { type: 'array', items: { type: 'object', properties: { punkt: { type: 'string' }, stand: { type: 'string', enum: ['ja', 'teilweise', 'nein'] }, beleg: { type: 'string' } }, required: ['punkt', 'stand'] } },
        artefakte: { type: 'array', items: { type: 'string' } },
      },
      required: ['gemacht', 'nicht_gemacht', 'risiko', 'dod'],
    },
    run: async (a: any) => {
      // Nur die bekannten Felder; Person und Unterhaltung kommen aus der Umgebung, nie aus den Argumenten.
      const j = await call('/internal/review-ready', { gemacht: a.gemacht, nicht_gemacht: a.nicht_gemacht, risiko: a.risiko, dod: a.dod, artefakte: a.artefakte, conv: process.env.WERKBANK_CONV_ID || '' });
      return `Bereit zum Review gemeldet (${j.key}). Die Person prüft jetzt — nicht weiterarbeiten, außer am Push-Schritt.`;
    },
  },
  {
    name: 'jira_update',
    description: 'Eigenes PM-Ticket nachziehen: comment (Text), status (Zielstatus, z. B. Done), due (JJJJ-MM-TT oder "" für ohne Datum). Gib summary (Titel), was (bisheriger Stand) und reason (Grund) mit — die Person sieht sie in der Rückfrage. Keine neuen Tickets.',
    inputSchema: { type: 'object', properties: { key: { type: 'string' }, ...SHOW, ...CHANGE }, required: ['key'] },
    run: async (a: any) => {
      const j = await call('/internal/jira-update', { key: a.key, summary: a.summary, comment: a.comment, status: a.status, due: a.due });
      return `In Jira geschrieben: ${a.key} — ${j.done.join(', ')}.`;
    },
  },
  {
    name: 'jira_update_many',
    description: `Mehrere eigene PM-Tickets mit EINER Rückfrage nachziehen (Tagesabschluss), höchstens ${MAX_MANY}. Je Eintrag key plus comment/status/due wie bei jira_update, und summary/was/reason für die Rückfrage. Geschrieben wird der Reihe nach; das Ergebnis nennt je Ticket ok oder den Fehler.`,
    inputSchema: {
      type: 'object',
      properties: { changes: { type: 'array', maxItems: MAX_MANY, items: { type: 'object', properties: { key: { type: 'string' }, ...SHOW, ...CHANGE }, required: ['key'] } } },
      required: ['changes'],
    },
    run: async (a: any) => {
      // summary geht mit: die Werkbank prüft, dass der in der Rückfrage gezeigte Titel zum Ticket passt.
      const changes = (Array.isArray(a.changes) ? a.changes : []).map((c: any) => ({ key: c.key, summary: c.summary, comment: c.comment, status: c.status, due: c.due }));
      // Je Ticket bis zu drei MCP-Aufrufe à ~1 s (gemessen 07.10.) — Zeitlimit wächst mit, statt nach 30 s abzubrechen.
      // Die Werkbank bekommt dieselbe Frist und fängt danach kein Ticket mehr an („nicht versucht“).
      const ms = Math.min(300_000, 30_000 + 10_000 * changes.length);
      let j: any;
      try { j = await call('/internal/jira-update-many', { changes, budgetMs: ms - 5_000 }, ms); }
      catch (e: any) {
        if (e?.name === 'TimeoutError' || /abort|timeout/i.test(String(e?.message))) throw new Error('Zeitüberschreitung — ein Teil kann geschrieben sein. NICHT wiederholen: erst den Stand der Tickets lesen (Jira), dann nur Fehlendes einzeln mit jira_update.');
        throw e;
      }
      return j.results.map((r: any) => `- ${r.key}: ${r.ok ? `ok (${r.done.join(', ')})` : r.skipped ? `NICHT VERSUCHT – ${r.error}` : `FEHLER – ${r.error}`}`).join('\n');
    },
  },
  {
    name: 'agent_start',
    description: 'Neuen eigenen Chat mit einem Agenten auf einem PM-Ticket starten (wie „Agent“ am Board): er arbeitet das Ticket vor und fragt vor jedem Schreiben nach. note = Auftrag/Hinweis für den Agenten. Liefert den Link zum Chat. Die Person bestätigt vorher.',
    inputSchema: { type: 'object', properties: { key: { type: 'string' }, note: { type: 'string' } }, required: ['key'] },
    run: async (a: any) => {
      const j = await call('/internal/agent-start', { key: a.key, note: a.note ?? '' });
      return `Chat für ${a.key} gestartet: ${j.url}`;
    },
  },
]);
