#!/usr/bin/env node
// MCP-Server "werkbank" (stdio) — nur für Sitzungen der Werkbank-Brücke, je Person gestartet.
// Werkzeuge:
//   hygiene_list    eigene Task-Hygiene-Punkte (lesend)
//   hygiene_snooze  einen Punkt für heute auf "später" setzen (ändert nur Werkbank-Zustand)
//   jira_update     Kommentar / Status / Fälligkeit auf einem eigenen PM-Ticket — die Brücke fragt vorher
//                   im Chat nach ("ja"); geschrieben wird mit dem Jira-Zugang der Person (Werkbank-Einrichtung).
// Umgebung (von der Brücke gesetzt): WERKBANK_URL, WERKBANK_INTERNAL_TOKEN, WERKBANK_USER_ID.

import { serve } from './stdio.ts';

const URL_ = process.env.WERKBANK_URL || 'http://127.0.0.1:3070';
const TOKEN = process.env.WERKBANK_INTERNAL_TOKEN || '';
const USER = process.env.WERKBANK_USER_ID || '';

async function call(path: string, body: unknown): Promise<any> {
  const r = await fetch(URL_ + path, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': TOKEN },
    body: JSON.stringify({ userId: USER, ...(body as object) }), signal: AbortSignal.timeout(30_000),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Werkbank antwortet mit ${r.status}`);
  return j;
}

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
    name: 'jira_update',
    description: 'Eigenes PM-Ticket nachziehen: comment (Text), status (Zielstatus, z. B. Done), due (JJJJ-MM-TT oder "" für ohne Datum). Keine neuen Tickets. Die Person bestätigt vorher im Chat.',
    inputSchema: { type: 'object', properties: { key: { type: 'string' }, comment: { type: 'string' }, status: { type: 'string' }, due: { type: 'string' } }, required: ['key'] },
    run: async (a: any) => {
      const j = await call('/internal/jira-update', { key: a.key, comment: a.comment, status: a.status, due: a.due });
      return `In Jira geschrieben: ${a.key} — ${j.done.join(', ')}.`;
    },
  },
]);
