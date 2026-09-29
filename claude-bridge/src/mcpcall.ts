// Ein einzelner MCP-Aufruf in der Claude-Code-Sitzung der Person (Knut, 29.09.: „Schreiben erstmal über MCP“).
//
// Die Werkbank-Web-App hat die Aktion schon im Bestätigungsdialog freigegeben. Hier läuft eine kurze,
// eigene SDK-Sitzung mit dem Claude-Token der Person und ihrer MCP-Konfiguration (Atlassian-MCP, OAuth).
// Der Wächter erlaubt genau EIN Werkzeug mit genau diesem Ticket (plus Nachladen von Werkzeugschemas);
// alles andere wird abgelehnt. Ergebnis: der Text der Werkzeugantwort — oder eine klare Fehlerart.
//
// mcpStatus(): liest nur die Init-Nachricht (Status der MCP-Server) und bricht dann ab — kein Modellaufruf.

import { log } from './log.ts';

type QueryFn = (p: { prompt: string; options: Record<string, any> }) => AsyncIterable<any>;

export interface McpCallResult {
  ok: boolean;
  error?: 'mcp_auth' | 'mcp_missing' | 'tool_error' | 'not_called' | 'claude_auth' | 'failed';
  message?: string;
  result?: string;
}

const AUTH_RE = /\b401\b|unauthori[sz]ed|needs[- ]auth|authenticat|re-?auth|oauth|not (logged|signed) in|token (expired|invalid)/i;

function cleanEnv(token: string): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of Object.keys(env)) if (/KEY|SECRET|TOKEN|PASSWORD|CREDS|_IV$|MONGO_URI/i.test(k)) delete env[k];
  for (const k of ['ANTHROPIC_BASE_URL', 'BW_SESSION']) delete env[k];
  env.CLAUDE_CODE_OAUTH_TOKEN = token;
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'olaf-werkbank-bridge/0.1';
  env.ENABLE_TOOL_SEARCH = process.env.BRIDGE_TOOL_SEARCH || 'true';
  return env;
}

function textOfResult(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c: any) => (typeof c === 'string' ? c : c?.text ?? '')).join('\n');
  return '';
}

/**
 * Status der MCP-Server (z. B. atlassian: connected / needs-auth / failed), ohne Modellaufruf: die Sitzung
 * startet im Streaming-Eingabemodus ohne Nachricht, fragt `mcpServerStatus()` ab (wartet, solange ein Server
 * noch „pending“ ist, höchstens 25 s) und wird dann beendet.
 */
export async function mcpStatus(query: QueryFn, token: string, cwd: string): Promise<{ servers: { name: string; status: string }[] }> {
  const abort = new AbortController();
  const idle = (async function* () { await new Promise<void>((r) => abort.signal.addEventListener('abort', () => r())); })();
  const q: any = query({ prompt: idle as any, options: { cwd, settingSources: ['user', 'project'], abortController: abort, env: cleanEnv(token), maxTurns: 1, permissionMode: 'default', canUseTool: async () => ({ behavior: 'deny', message: 'nur Status' }) } });
  // Nachrichten abholen, damit die Sitzung nicht stockt (es kommen keine Modellantworten).
  (async () => { try { for await (const _ of q) { /* nichts */ } } catch { /* beendet */ } })();
  const deadline = Date.now() + 25_000;
  let servers: { name: string; status: string }[] = [];
  try {
    while (Date.now() < deadline) {
      const st = await Promise.race([q.mcpServerStatus(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10_000))]) as any[];
      servers = (st ?? []).map((x: any) => ({ name: String(x.name), status: String(x.status) }));
      if (!servers.some((x) => x.status === 'pending')) break;
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch (e: any) { log('mcp status error', { error: String(e?.message ?? e).replaceAll(token, '***').slice(0, 200) }); }
  finally { abort.abort(); }
  return { servers };
}

/** Führt genau einen (schon bestätigten) MCP-Aufruf aus. */
export async function mcpCall(query: QueryFn, p: { token: string; cwd: string; tool: string; input: Record<string, unknown>; server?: string }): Promise<McpCallResult> {
  const server = p.server ?? p.tool.split('__')[1];
  const key = String(p.input.issueIdOrKey ?? '');
  const abort = new AbortController();
  let targetId = '';
  let called = false;
  let serverStatus = '';
  const guard = async (tool: string, input: Record<string, unknown>) => {
    if (tool === 'ToolSearch') return { behavior: 'allow', updatedInput: input };
    if (tool === p.tool && !called && (!key || String(input.issueIdOrKey ?? '') === key)) {
      called = true;
      // Genau die bestätigten Argumente — was das Modell daraus gemacht hat, zählt nicht.
      return { behavior: 'allow', updatedInput: { ...p.input } };
    }
    return { behavior: 'deny', message: 'Nicht Teil der bestätigten Aktion. Nichts anderes ausführen.' };
  };
  const hook = async (i: any) => {
    const r: any = await guard(i.tool_name, i.tool_input ?? {});
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: r.behavior, permissionDecisionReason: r.message ?? 'bestätigt', ...(r.behavior === 'allow' ? { updatedInput: r.updatedInput } : {}) } };
  };
  const prompt = [
    'WERKBANK-MCP-AUFRUF (von der Person im Werkbank-Board bereits bestätigt).',
    `Rufe genau einmal das Werkzeug \`${p.tool}\` mit genau diesen Argumenten auf (falls nötig, lade es zuerst mit ToolSearch):`,
    '```json', JSON.stringify(p.input), '```',
    'Rufe kein anderes Werkzeug auf. Antworte danach nur mit „OK“ oder der Fehlermeldung.',
  ].join('\n');
  const timer = setTimeout(() => abort.abort(), 120_000);
  try {
    const q = query({ prompt, options: {
      cwd: p.cwd, settingSources: ['user', 'project'], skills: [], maxTurns: 6, permissionMode: 'default', abortController: abort,
      canUseTool: guard, hooks: { PreToolUse: [{ hooks: [hook] }] }, disallowedTools: ['AskUserQuestion', 'Bash', 'Write', 'Edit', 'Task', 'Agent'],
      env: cleanEnv(p.token),
    } });
    for await (const msg of q) {
      if (msg.type === 'system' && msg.subtype === 'init') {
        serverStatus = String((msg.mcp_servers ?? []).find((s: any) => s.name === server)?.status ?? 'fehlt');
        // „pending“ = verbindet noch — weiterlaufen lassen; kommt der Aufruf nicht zustande, meldet es not_called.
        if (serverStatus !== 'connected' && serverStatus !== 'pending') {
          abort.abort();
          return serverStatus === 'fehlt'
            ? { ok: false, error: 'mcp_missing', message: `Der MCP-Server „${server}“ ist in deiner Claude-Konfiguration nicht eingerichtet.` }
            : { ok: false, error: 'mcp_auth', message: `Der MCP-Server „${server}“ ist nicht verbunden (Status: ${serverStatus}).` };
        }
      }
      if (msg.type === 'assistant') {
        if (msg.error === 'authentication_failed') return { ok: false, error: 'claude_auth', message: 'Dein Claude-Token wurde abgelehnt.' };
        for (const b of msg.message?.content ?? []) if (b.type === 'tool_use' && b.name === p.tool) targetId = b.id;
      }
      if (msg.type === 'user' && targetId) {
        for (const b of msg.message?.content ?? []) {
          if (b.type !== 'tool_result' || b.tool_use_id !== targetId) continue;
          const text = textOfResult(b.content).slice(0, 2000);
          abort.abort();
          if (b.is_error) return { ok: false, error: AUTH_RE.test(text) ? 'mcp_auth' : 'tool_error', message: text.slice(0, 400) };
          return { ok: true, result: text };
        }
      }
    }
    return { ok: false, error: 'not_called', message: 'Claude hat den Aufruf nicht ausgeführt.' };
  } catch (e: any) {
    const text = String(e?.message ?? e).replaceAll(p.token, '***');
    log('mcp call error', { tool: p.tool, error: text.slice(0, 200) });
    return { ok: false, error: AUTH_RE.test(text) ? 'claude_auth' : 'failed', message: text.slice(0, 300) };
  } finally { clearTimeout(timer); }
}
