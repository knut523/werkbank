// Jira schreiben (Kommentar, Status, Fälligkeit) — Knut, 29.09.: „Schreiben erstmal über MCP“.
//
// Lesen bleibt beim Lesetoken (Jira-Kopie, Übergänge). Geschrieben wird über den Atlassian-MCP in der
// Claude-Code-Sitzung der Person (claude-bridge /internal/mcp-call, mit ihrem Claude-Token und ihrer
// MCP-Anmeldung). Bestätigt ist die Aktion zu diesem Zeitpunkt schon (Dialog in der Oberfläche).
// WERKBANK_JIRA_WRITE=rest schreibt wie bisher per REST mit dem eigenen Token (nur mit write:jira-work).

import { cfg } from './config.ts';
import { wb } from './db.ts';
import { jiraCreds, getClaudeToken } from './creds.ts';
import { addComment, transitionTo, transitions, setDueDate, refreshIssue } from './jira.ts';
import { log } from './log.ts';
import type { User } from './auth.ts';

export type JiraAction = { type: 'comment'; text: string } | { type: 'status'; to: string } | { type: 'due'; date: string | null };

export class JiraWriteError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

export const writeMode = () => (process.env.WERKBANK_JIRA_WRITE === 'rest' ? 'rest' : 'mcp');

export const MCP_HELP = 'Einmalig im Terminal: `claude` starten → `/mcp` → „atlassian“ → „Authenticate“ und im Browser mit deinem Atlassian-Konto anmelden. Danach unter „Einrichtung“ → „Jira-MCP prüfen“.';

const MESSAGES: Record<string, string> = {
  mcp_auth: `Jira-Schreiben über den Atlassian-MCP ist nicht angemeldet (401 / Anmeldung abgelaufen). ${MCP_HELP}`,
  mcp_missing: `Der Atlassian-MCP ist in deiner Claude-Konfiguration nicht eingerichtet. Einmalig: \`claude mcp add --transport http --scope user atlassian https://mcp.atlassian.com/v1/mcp\`, dann ${MCP_HELP}`,
  claude_auth: 'Dein Claude-Token wurde abgelehnt — unter „Einrichtung“ einen neuen aus `claude setup-token` eintragen.',
  not_called: 'Claude hat den Jira-Aufruf nicht ausgeführt. Bitte noch einmal versuchen.',
};

async function bridge(path: string, token: string, body: unknown): Promise<any> {
  const r = await fetch(cfg.bridgeUrl + path, {
    method: 'POST', signal: AbortSignal.timeout(150_000),
    headers: { 'content-type': 'application/json', 'x-werkbank-internal': process.env.WERKBANK_INTERNAL_TOKEN ?? '', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (r.status === 403) throw new JiraWriteError(500, 'failed', 'Brücke lehnt ab (interner Token fehlt).');
  return r.json();
}

async function claudeToken(u: User): Promise<string> {
  const t = await getClaudeToken(u);
  if (!t) throw new JiraWriteError(412, 'claude_missing', 'Für Jira-Schreiben über den MCP brauchst du dein Claude — unter „Einrichtung“ den Token aus `claude setup-token` eintragen.');
  return t;
}

/** Ein MCP-Aufruf; Fehler werden zu klaren Meldungen. */
export async function mcpWrite(u: User, tool: string, input: Record<string, unknown>): Promise<string> {
  const r = await bridge('/internal/mcp-call', await claudeToken(u), { userId: u.id, tool, input });
  if (r.ok) return String(r.result ?? '');
  await setMcpState(u, r.error === 'mcp_auth' || r.error === 'mcp_missing' ? r.error : null);
  throw new JiraWriteError(r.error === 'tool_error' ? 502 : 412, r.error, MESSAGES[r.error] ?? `Jira (MCP): ${r.message ?? 'Fehler'}`);
}

async function setMcpState(u: User, problem: string | null) {
  await wb().collection('mcp_status').updateOne({ _id: u.id as any }, { $set: problem ? { problem, problemAt: new Date() } : { problem: null, status: 'connected', checkedAt: new Date() } }, { upsert: true });
}

/** Atlassian-MCP der Person prüfen (nur Init der Sitzung, kein Modellaufruf). */
export async function checkMcp(u: User) {
  const r = await bridge('/internal/mcp-status', await claudeToken(u), { userId: u.id });
  const s = (r.servers ?? []).find((x: any) => x.name === 'atlassian');
  const status = s?.status ?? 'fehlt';
  const doc = { status, checkedAt: new Date(), problem: status === 'connected' ? null : status === 'fehlt' ? 'mcp_missing' : 'mcp_auth' };
  await wb().collection('mcp_status').updateOne({ _id: u.id as any }, { $set: doc }, { upsert: true });
  return { ...doc, help: status === 'connected' ? null : MESSAGES[doc.problem!] };
}

export async function mcpState(u: User) {
  const d: any = await wb().collection('mcp_status').findOne({ _id: u.id as any });
  return d ? { status: d.status ?? null, checkedAt: d.checkedAt ?? null, problem: d.problem ?? null } : { status: null, checkedAt: null, problem: null };
}

/** Ist Jira-Schreiben für diese Person möglich? (für Pflegefragen: nur fragen, wenn ja) */
export async function canWriteJira(u: User): Promise<boolean> {
  if (writeMode() === 'rest') return !!(await jiraCreds(u));
  const s = await mcpState(u);
  return s.status === 'connected' && !s.problem;
}

/** Führt bestätigte Aktionen auf einem Ticket aus. Lesen (Übergänge, Kopie) mit dem Lesezugang. */
export async function writeJira(u: User, key: string, actions: JiraAction[]): Promise<{ done: string[]; via: 'mcp' | 'rest' }> {
  const read = await jiraCreds(u);
  const done: string[] = [];
  const via = writeMode();
  for (const a of actions) {
    if (a.type === 'comment' && !a.text?.trim()) continue;
    if (via === 'rest') {
      if (!read) throw new JiraWriteError(412, 'jira_missing', 'Kein Jira-Zugang hinterlegt — unter „Einrichtung“ verbinden.');
      if (a.type === 'comment') await addComment(read, key, a.text.trim());
      if (a.type === 'status') await transitionTo(read, key, a.to);
      if (a.type === 'due') await setDueDate(read, key, a.date || null);
    } else {
      const base = { cloudId: cfg.jiraCloudId, issueIdOrKey: key };
      if (a.type === 'comment') await mcpWrite(u, 'mcp__atlassian__addCommentToJiraIssue', { ...base, commentBody: a.text.trim(), contentFormat: 'markdown' });
      if (a.type === 'status') {
        if (!read) throw new JiraWriteError(412, 'jira_missing', 'Für die Übergänge braucht die Werkbank den Jira-Lesezugang (Einrichtung).');
        const ts = await transitions(read, key);
        const t = ts.find((x) => x.to.toLowerCase() === a.to.toLowerCase()) ?? ts.find((x) => x.name.toLowerCase() === a.to.toLowerCase());
        if (!t) throw new JiraWriteError(400, 'no_transition', `Von hier aus gibt es keinen Übergang nach „${a.to}“ (möglich: ${ts.map((x) => x.to).join(', ') || '—'}).`);
        await mcpWrite(u, 'mcp__atlassian__transitionJiraIssue', { ...base, transition: { id: t.id } });
      }
      if (a.type === 'due') {
        if (a.date && !/^\d{4}-\d{2}-\d{2}$/.test(a.date)) throw new JiraWriteError(400, 'bad_date', 'Datum im Format JJJJ-MM-TT.');
        await mcpWrite(u, 'mcp__atlassian__editJiraIssue', { ...base, fields: { duedate: a.date || null } });
      }
    }
    done.push(a.type === 'comment' ? 'Kommentar' : a.type === 'status' ? `Status → ${a.to}` : `Fällig → ${a.date || 'ohne'}`);
  }
  if (via === 'mcp') await setMcpState(u, null);
  log('jira write', { user: u.id, key, via, n: done.length });
  if (read) { try { await refreshIssue(read, key); } catch { /* nächster Sync */ } }
  return { done, via };
}

/** Einmaliger Hinweis im Chat, wenn Pflegefragen wegen fehlendem Jira-MCP ausfallen (true = jetzt zeigen). */
export async function takeMcpHint(u: User): Promise<boolean> {
  const r = await wb().collection('mcp_status').updateOne({ _id: u.id as any, hintShownAt: { $exists: false } }, { $set: { hintShownAt: new Date() } });
  if (r.matchedCount) return true;
  const d = await wb().collection('mcp_status').findOne({ _id: u.id as any });
  if (d) return false;
  await wb().collection('mcp_status').insertOne({ _id: u.id as any, hintShownAt: new Date() } as any);
  return true;
}
