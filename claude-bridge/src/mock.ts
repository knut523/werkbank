// BRIDGE_MOCK=1: ein Ersatz für query() aus dem Agent SDK, der Claude nicht aufruft.
// Er liefert dieselben Nachrichtenformen, damit Streaming, Statuszeilen und die
// Bestätigungs-Rückfrage ohne echten Token durchgetestet werden können.
// Enthält die Nachricht "schreib", versucht der Mock eine Datei zu schreiben (→ Rückfrage).
// „mock-tool <Werkzeug> <JSON>“ ruft ein beliebiges Werkzeug auf und spielt dabei den Rechteweg des SDK nach:
// PreToolUse-Hook → (ohne Entscheidung) Modus → im Auto-Modus ein Nachbau des Klassifikators (RISKANT → nachfragen,
// VERBOTEN → ablehnen, sonst erlauben) → bei „nachfragen“ canUseTool. $CWD steht für den Arbeitsordner.

import { randomUUID } from 'node:crypto';
import { VAULT_DIR } from './tools.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mockQuery({ prompt, options }: { prompt: string; options: Record<string, any> }) {
  if (typeof prompt !== 'string') {
    // Streaming-Eingabe ohne Nachricht (MCP-Status): nur Steuerabfragen, keine Modellantwort.
    const signal: AbortSignal = options.abortController?.signal;
    return {
      async *[Symbol.asyncIterator]() { await new Promise<void>((r) => signal?.addEventListener('abort', () => r())); },
      mcpServerStatus: async () => mcpList(options),
    } as any;
  }
  const session_id: string = options.resume ?? randomUUID();
  const signal: AbortSignal = options.abortController?.signal;
  const guard = options.hooks?.PreToolUse?.[0]?.hooks?.[0];

  const text = (t: string) => ({
    type: 'stream_event', parent_tool_use_id: null, session_id,
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } },
  });
  const toolUse = (name: string, input: Record<string, unknown>) => ({
    type: 'assistant', parent_tool_use_id: null, session_id,
    message: { content: [{ type: 'tool_use', id: randomUUID(), name, input }] },
  });

  async function* run() {
    yield { type: 'system', subtype: 'init', session_id, mcp_servers: mcpList(options) };
    // Mehrere Claude-Konten: Tokens mit „limit“ sind ausgeschöpft (rate_limit, Reset in 2 h), „midlimit“ erst nach einem
    // Werkzeug mitten im Zug; „bad-auth“ wird abgelehnt. Tokens mit „acct“ nennen ihre letzten 4 Zeichen.
    const tok = String(options.env?.CLAUDE_CODE_OAUTH_TOKEN ?? '');
    const limited = function* () {
      yield { type: 'rate_limit_event', session_id, rate_limit_info: { status: 'rejected', resetsAt: Math.floor(Date.now() / 1000) + 7200, rateLimitType: 'five_hour' } };
      yield { type: 'assistant', parent_tool_use_id: null, session_id, error: 'rate_limit', message: { content: [{ type: 'text', text: 'API Error: Rate limit reached' }] } };
      yield { type: 'result', subtype: 'success', session_id, is_error: true, result: 'Rate limit reached', usage: { input_tokens: 0, output_tokens: 0 } };
    };
    if (/bad-auth/.test(tok)) {
      yield { type: 'assistant', parent_tool_use_id: null, session_id, error: 'authentication_failed', message: { content: [{ type: 'text', text: 'Invalid token' }] } };
      yield { type: 'result', subtype: 'success', session_id, is_error: true, result: 'auth', usage: { input_tokens: 0, output_tokens: 0 } };
      return;
    }
    if (/midlimit/.test(tok)) {
      yield toolUse('Grep', { pattern: 'Vorarbeit', path: VAULT_DIR });
      yield text('(Mock) Erste Schritte erledigt. ');
      yield* limited();
      return;
    }
    if (/limit/.test(tok)) { yield* limited(); return; }
    if (/acct/.test(tok)) yield text(`(Mock) Konto: …${tok.slice(-4)}. `);
    if (prompt === 'Antworte nur mit: ok') { yield text('ok'); yield { type: 'result', subtype: 'success', session_id, is_error: false, usage: { input_tokens: 5, output_tokens: 1 } }; return; }
    if (prompt.startsWith('WERKBANK-MCP-AUFRUF')) {
      // Ein bestätigter MCP-Aufruf: Werkzeug + Argumente aus dem Prompt, Ergebnis ins Protokoll (für Tests).
      const tool = prompt.match(/`(mcp__[^`]+)`/)?.[1] ?? '';
      const input = JSON.parse(prompt.match(/```json\n(.+)\n```/)?.[1] ?? '{}');
      const id = randomUUID();
      yield { type: 'assistant', parent_tool_use_id: null, session_id, message: { content: [{ type: 'tool_use', id, name: tool, input }] } };
      const ok = await options.canUseTool?.(tool, input);
      if (ok?.behavior !== 'allow') { yield { type: 'user', session_id, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: 'abgelehnt' }] } }; return; }
      if (JSON.stringify(input).includes('401-TEST')) { yield { type: 'user', session_id, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: 'Error: 401 Unauthorized — please re-authenticate' }] } }; return; }
      const { appendFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const inp: any = ok.updatedInput;
      appendFileSync(join(process.env.BRIDGE_STATE_DIR ?? '.', 'mock-mcp-calls.jsonl'), JSON.stringify({ tool, input: inp }) + '\n');
      const err = await replayJira(tool, inp);
      if (err) { yield { type: 'user', session_id, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: err }] } }; return; }
      yield { type: 'user', session_id, message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: 'OK (Mock)' }] }] } };
      return;
    }
    const lines = prompt.split('\n');
    const anh = lines.filter((l) => /^- anhaenge\//.test(l)).map((l) => l.slice(2).split(' (')[0]);
    const last = [...lines].reverse().find((l) => l.trim() && !/^- anhaenge\//.test(l) && !/^(---|Angehängte Dateien)/.test(l)) ?? '';
    if (/^Vorgabe für diesen Chat/.test(prompt)) yield text('(Mock) Vorlage erkannt. ');
    const append = String(options.systemPrompt?.append ?? '');
    if (append.includes('Werkbank-Kontext')) {
      const q = append.match(/^1\. (.+)$/m)?.[1];
      yield text(`(Mock) Kontext-Paket: ${append.length} Zeichen, Werkzeuge: ${Object.keys(options.mcpServers ?? {}).join(', ') || '—'}.${q ? ` Erste Frage: ${q}` : ''} `);
    }
    if (Array.isArray(options.skills)) yield text(`(Mock) Skills: ${options.skills.length} [${options.skills.join(',')}]. `);
    if (anh.length) {
      const { existsSync } = await import('node:fs');
      const { join } = await import('node:path');
      yield text(`(Mock) Anhänge im Arbeitsverzeichnis: ${anh.map((a) => a + (existsSync(join(options.cwd ?? '.', a)) ? ' ✓' : ' ✗')).join(', ')}. `);
    }
    if (/zeitmessung/i.test(last)) {
      // Nachbau eines echten Zuges mit Zeiten wie gemessen: Start des CLI + erster Token (~2 s),
      // ein Satz, ein Werkzeug (~1,2 s), dann die eigentliche Antwort Wort für Wort (~60 ms je Wort).
      await sleep(600);
      yield { type: 'stream_event', parent_tool_use_id: null, session_id, event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } } };
      await sleep(1400);
      for (const w of 'Ich schaue kurz im Vault nach. '.split(/(?<= )/)) { yield text(w); await sleep(60); }
      yield { type: 'assistant', parent_tool_use_id: null, session_id, message: { content: [{ type: 'text', text: 'Ich schaue kurz im Vault nach. ' }] } };
      yield toolUse('mcp__vault-search__search', { query: 'Zeitmessung' });
      await sleep(1200);
      const answer = Array.from({ length: 40 }, (_, i) => `Wort${i + 1} `);
      for (const w of answer) { if (signal?.aborted) throw new Error('aborted'); yield text(w); await sleep(60); }
      yield { type: 'assistant', parent_tool_use_id: null, session_id, message: { content: [{ type: 'text', text: answer.join('') }] } };
      yield { type: 'result', subtype: 'success', session_id, is_error: false, usage: { input_tokens: 100, output_tokens: 60 } };
      return;
    }
    if (/live-test/i.test(last)) {
      // Live-Anzeige (07.10.2026): Gedanken als Deltas, Werkzeugbeginn vor fertiger Eingabe, Lebenszeichen nach 5 s.
      // Ereignisformen wie die Anthropic-Streaming-API (content_block_start/-delta), die das SDK als stream_event durchreicht.
      const ev = (event: Record<string, unknown>) => ({ type: 'stream_event', parent_tool_use_id: null, session_id, event });
      yield text(`(Mock) thinking-display: ${options.extraArgs?.['thinking-display'] ?? '—'}. `);
      yield ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });
      for (const t of ['Ich überlege, ', 'wo das steht.']) { yield ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: t } }); await sleep(30); }
      const id = randomUUID();
      yield ev({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id, name: 'Task', input: {} } });
      for (const part of ['{"description":', '"Recherche",', '"prompt":"…"}']) { yield ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: part } }); await sleep(300); }
      yield { type: 'assistant', parent_tool_use_id: null, session_id, message: { content: [{ type: 'tool_use', id, name: 'Task', input: { description: 'Recherche', prompt: '…' } }] } };
      yield { type: 'tool_progress', parent_tool_use_id: null, session_id, tool_use_id: id, tool_name: 'Task', elapsed_time_seconds: 6 };
      yield { type: 'user', session_id, message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: 'ok' }] }] } };
      yield text('(Mock) Fertig.');
      yield { type: 'result', subtype: 'success', session_id, is_error: false, usage: { input_tokens: 10, output_tokens: 5 } };
      return;
    }
    const slow = last.match(/^langsam (\d+)$/);
    if (slow) {
      // Ein langer Zug (Sperre je Person, E5): wartet N ms, dann eine Zeile.
      await sleep(Math.min(Number(slow[1]), 10000));
      yield text('(Mock) Langsamer Zug fertig.');
      yield { type: 'result', subtype: 'success', session_id, is_error: false, usage: { input_tokens: 5, output_tokens: 5 } };
      return;
    }
    if (/skill-test/i.test(last)) yield toolUse('Skill', { skill: 'olaf-jira' });
    if (/konfig-test/i.test(last)) {
      yield text(`(Mock) Konfig: ${options.env?.CLAUDE_CONFIG_DIR ?? 'geteilt'}; strict: ${options.strictMcpConfig === true}; Nutzer-Hooks aus: ${options.settings?.disableAllHooks === true}; MCP: ${Object.keys(options.mcpServers ?? {}).join(',')}. `);
      yield text(`(Mock) Modus: ${options.permissionMode}; Deny-Regeln: ${options.settings?.permissions?.deny?.length ?? 0}; bypass aus: ${options.settings?.permissions?.disableBypassPermissionsMode === 'disable'}. `);
    }
    const mt = last.match(/^mock-tool (\S+) (\{.*\})\s*$/);
    if (mt) {
      const name = mt[1];
      const input = JSON.parse(mt[2].replaceAll('$CWD', String(options.cwd ?? '.')));
      const denials: any[] = [];
      yield text(`(Mock) Modus: ${options.permissionMode}. `);
      const id = randomUUID();
      yield { type: 'assistant', parent_tool_use_id: null, session_id, message: { content: [{ type: 'tool_use', id, name, input }] } };
      const r = guard ? await guard({ hook_event_name: 'PreToolUse', tool_name: name, tool_input: input }, id, { signal }) : {};
      let d: string | undefined = r?.hookSpecificOutput?.permissionDecision;
      if (!d) {
        const mode = options.permissionMode ?? 'default';
        const what = JSON.stringify(input);
        const v = mode === 'auto' ? (/VERBOTEN/.test(what) ? 'deny' : /RISKANT/.test(what) ? 'ask' : 'allow') : mode === 'dontAsk' ? 'deny' : 'ask';
        if (v === 'ask') {
          const c = await options.canUseTool?.(name, input, { signal, toolUseID: id, decisionReason: mode === 'auto' ? '\u001b[1mKlassifikator\u001b[0m: Löschen außerhalb von Build-Artefakten' : undefined });
          d = c?.behavior === 'allow' ? 'allow' : 'deny';
        } else if (v === 'deny') {
          d = 'deny';
          denials.push({ tool_name: name, tool_use_id: id, tool_input: input });
          yield { type: 'system', subtype: 'permission_denied', tool_name: name, tool_use_id: id, decision_reason_type: mode === 'auto' ? 'classifier' : 'mode', message: 'abgelehnt', session_id };
        } else d = 'allow';
      }
      yield { type: 'user', session_id, message: { content: [{ type: 'tool_result', tool_use_id: id, ...(d === 'allow' ? { content: [{ type: 'text', text: 'ok' }] } : { is_error: true, content: 'abgelehnt' }) }] } };
      yield text(d === 'allow' ? `(Mock) ${name} ausgeführt.` : `(Mock) ${name} nicht ausgeführt.`);
      yield { type: 'result', subtype: 'success', session_id, is_error: false, usage: { input_tokens: 10, output_tokens: 5 }, permission_denials: denials };
      return;
    }
    // „jira-kommentar PM-123“: Claude kommentiert im Chat über den Atlassian-MCP (Rückfrage → ja → Ergebnis).
    const jk = last.match(/jira-kommentar ([A-Z][A-Z0-9]+-\d+)/);
    if (jk && guard) {
      const tool = 'mcp__atlassian__addCommentToJiraIssue';
      const input = { cloudId: 'x', issueIdOrKey: jk[1], commentBody: '(Mock) Kommentar aus dem Chat', contentFormat: 'markdown' };
      const id = randomUUID();
      yield { type: 'assistant', parent_tool_use_id: null, session_id, message: { content: [{ type: 'tool_use', id, name: tool, input }] } };
      const r = await guard({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input }, id, { signal });
      if (r?.hookSpecificOutput?.permissionDecision === 'allow') {
        const err = await replayJira(tool, input);
        yield { type: 'user', session_id, message: { content: [{ type: 'tool_result', tool_use_id: id, ...(err ? { is_error: true, content: err } : { content: [{ type: 'text', text: 'Kommentar angelegt' }] }) }] } };
        yield text(err ? '(Mock) Jira hat abgelehnt.' : `(Mock) Kommentar auf ${jk[1]} geschrieben.`);
      } else yield text('(Mock) Kein Jira-Kommentar.');
      yield { type: 'result', subtype: 'success', session_id, is_error: false, usage: { input_tokens: 10, output_tokens: 5 } };
      return;
    }
    yield toolUse('Grep', { pattern: last.slice(0, 40), path: VAULT_DIR });
    await sleep(50);
    const words = `(Mock, kein Claude-Aufruf${options.resume ? ', Sitzung fortgesetzt' : ''}) Du hast geschrieben: ${last}`.split(/(?<= )/);
    for (const w of words) {
      if (signal?.aborted) throw new Error('aborted');
      yield text(w);
      await sleep(15);
    }
    if (/schreib/i.test(last) && guard) {
      const input = { file_path: `${VAULT_DIR}/_werkbank-mock/notiz.md`, content: `# Mock\n\n${last}\n` };
      yield toolUse('Write', input);
      const r = await guard({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: input }, undefined, { signal });
      const ok = r?.hookSpecificOutput?.permissionDecision === 'allow';
      yield text(ok ? '(Mock) Ich hätte die Datei jetzt geschrieben — im Mock wird nichts angefasst.' : '(Mock) Gut, ich schreibe nichts.');
    }
    yield { type: 'result', subtype: 'success', session_id, is_error: false, usage: { input_tokens: prompt.length >> 2, output_tokens: 20 } };
  }
  return run();
}

/** MCP-Server, wie Claude Code sie in der Init-Nachricht meldet — nur die übergebenen (strictMcpConfig). */
function mcpList(options: Record<string, any>) {
  return Object.keys(options.mcpServers ?? {}).map((name) => ({ name, status: name === 'atlassian' ? process.env.BRIDGE_MOCK_ATLASSIAN || 'connected' : 'connected' }));
}

/** Mit BRIDGE_MOCK_JIRA_BASE spielt der Mock den Atlassian-MCP gegen einen Jira-Nachbau (REST) nach. Fehlertext oder ''. */
async function replayJira(tool: string, inp: any): Promise<string> {
  const base = process.env.BRIDGE_MOCK_JIRA_BASE;
  if (!base) return '';
  const k = encodeURIComponent(String(inp.issueIdOrKey));
  const [method, path, body] = tool.endsWith('addCommentToJiraIssue') ? ['POST', `/issue/${k}/comment`, { body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: inp.commentBody }] }] } }]
    : tool.endsWith('transitionJiraIssue') ? ['POST', `/issue/${k}/transitions`, { transition: inp.transition }]
    : tool.endsWith('editJiraIssue') ? ['PUT', `/issue/${k}`, { fields: inp.fields }] : ['GET', `/issue/${k}`, undefined];
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from('mcp:mock').toString('base64') }, body: body ? JSON.stringify(body) : undefined });
  return r.ok ? '' : `Jira ${r.status}: ${(await r.text()).slice(0, 200)}`;
}
