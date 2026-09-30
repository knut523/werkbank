// Schneller Schreibweg ohne Modell (30.09.): Die Brücke spricht den Atlassian-MCP direkt als MCP-Client an
// (Streamable HTTP, JSON-RPC: initialize → notifications/initialized → tools/call) — mit dem OAuth-Zugang, den
// Claude Code für genau diese Person schon gespeichert hat (<Konfiguration>/.credentials.json, mcpOAuth „atlassian“).
// Keine neuen Rechte, kein Modellaufruf: statt ~12 s eine Sitzung nur der HTTP-Weg.
//
// Sicherheitsregeln:
// - nur die freigegebenen Werkzeuge (WRITE_TOOLS) und nur für das bestätigte Ticket (der Aufrufer prüft das wie bisher);
// - der Zugang wird NUR gelesen, nie erneuert oder zurückgeschrieben. Ist er abgelaufen (oder fehlt), gibt es
//   `null` → die Brücke nimmt den bisherigen Weg über die Claude-Sitzung, die ihn selbst erneuert und speichert
//   (rotierende Refresh-Tokens würden sonst Claude Codes Anmeldung zerstören);
// - Token nie ins Log.

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { log } from './log.ts';
import { ATLASSIAN_URL, type ClaudeHome } from './claudehome.ts';
import type { McpCallResult } from './mcpcall.ts';

export const DIRECT_TOOLS = new Set(['addCommentToJiraIssue', 'transitionJiraIssue', 'editJiraIssue', 'getJiraIssue', 'getTransitionsForJiraIssue', 'atlassianUserInfo', 'getAccessibleAtlassianResources']);

const AUTH_RE = /\b401\b|unauthori[sz]ed|invalid[_ ]token|expired/i;

/** Gespeicherter OAuth-Zugang von Claude Code für den Atlassian-MCP dieser Konfiguration — nur wenn noch gültig. */
export function storedAccess(home: ClaudeHome, url = ATLASSIAN_URL, now = Date.now()): string | null {
  const file = join(home.dir ?? join(homedir(), '.claude'), '.credentials.json');
  if (!existsSync(file)) return null;
  try {
    const d = JSON.parse(readFileSync(file, 'utf8'));
    const e: any = Object.values(d.mcpOAuth ?? {}).find((x: any) => x?.serverName === 'atlassian' && (x.serverUrl === url || !x.serverUrl));
    if (!e?.accessToken) return null;
    if (e.expiresAt && e.expiresAt < now + 90_000) return null;   // gleich abgelaufen → Claude-Weg erneuert
    return String(e.accessToken);
  } catch { return null; }
}

/** Antwort einer Streamable-HTTP-Anfrage: JSON oder SSE („data: {…}“) — die Nachricht mit passender id. */
async function rpcResult(r: Response, id: number): Promise<any> {
  const ct = r.headers.get('content-type') ?? '';
  const text = await r.text();
  const msgs: any[] = [];
  if (ct.includes('text/event-stream')) {
    for (const block of text.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
      if (data) { try { msgs.push(JSON.parse(data)); } catch { /* keine JSON-Zeile */ } }
    }
  } else if (text) { const j = JSON.parse(text); msgs.push(...(Array.isArray(j) ? j : [j])); }
  return msgs.find((m) => m.id === id);
}

export async function directCall(p: { home: ClaudeHome; tool: string; input: Record<string, unknown>; url?: string; fetchImpl?: typeof fetch }): Promise<McpCallResult | null> {
  const name = p.tool.replace(/^mcp__atlassian__/, '');
  if (!DIRECT_TOOLS.has(name)) return null;
  const url = p.url ?? ATLASSIAN_URL;
  if (!url || url === 'off') return null;
  const token = storedAccess(p.home, url);
  if (!token) return null;
  const f = p.fetchImpl ?? fetch;
  const base: Record<string, string> = { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' };
  const post = (body: unknown, session?: string) => f(url, { method: 'POST', headers: { ...base, ...(session ? { 'mcp-session-id': session } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  let sent = false;
  try {
    const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'olaf-werkbank-bridge', version: '0.1' } } });
    if (init.status === 401 || init.status === 403) return null;   // Zugang nicht (mehr) gültig → Claude-Weg
    if (!init.ok) return null;
    const session = init.headers.get('mcp-session-id') ?? undefined;
    const ir = await rpcResult(init, 1);
    if (!ir?.result) return null;
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, session).then((r) => r.text()).catch(() => {});
    sent = true;   // ab hier kann Jira schon geschrieben haben → kein Rückfall mehr (sonst doppelt)
    const call = await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: p.input } }, session);
    if (call.status === 401 || call.status === 403) return { ok: false, error: 'mcp_auth', message: `Atlassian-MCP lehnt ab (${call.status}).` };
    const cr = await rpcResult(call, 2);
    if (session) f(url, { method: 'DELETE', headers: { ...base, 'mcp-session-id': session } }).catch(() => {});
    if (!cr) return { ok: false, error: 'failed', message: `Atlassian-MCP antwortet mit ${call.status}.` };
    if (cr.error) return { ok: false, error: AUTH_RE.test(String(cr.error.message)) ? 'mcp_auth' : 'tool_error', message: String(cr.error.message ?? 'Fehler').slice(0, 400) };
    const text = (cr.result?.content ?? []).map((c: any) => c?.text ?? '').join('\n').slice(0, 2000);
    if (cr.result?.isError) return { ok: false, error: AUTH_RE.test(text) ? 'mcp_auth' : 'tool_error', message: text.slice(0, 400) };
    return { ok: true, result: text };
  } catch (e: any) {
    log('mcp direkt fehler', { tool: name, error: String(e?.message ?? e).replaceAll(token, '***').slice(0, 200) });
    // Vor dem Werkzeugaufruf: lieber der bewährte Weg. Danach: Ergebnis unklar → melden, nicht wiederholen.
    return sent ? { ok: false, error: 'failed', message: 'Verbindung zum Atlassian-MCP während des Aufrufs abgebrochen — bitte in Jira prüfen, ob es geschrieben wurde.' } : null;
  }
}
