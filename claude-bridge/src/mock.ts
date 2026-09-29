// BRIDGE_MOCK=1: ein Ersatz für query() aus dem Agent SDK, der Claude nicht aufruft.
// Er liefert dieselben Nachrichtenformen, damit Streaming, Statuszeilen und die
// Bestätigungs-Rückfrage ohne echten Token durchgetestet werden können.
// Enthält die Nachricht "schreib", versucht der Mock eine Datei zu schreiben (→ Rückfrage).

import { randomUUID } from 'node:crypto';
import { VAULT_DIR } from './tools.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function mockQuery({ prompt, options }: { prompt: string; options: Record<string, any> }) {
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
    yield { type: 'system', subtype: 'init', session_id, mcp_servers: [{ name: 'atlassian', status: process.env.BRIDGE_MOCK_ATLASSIAN || 'connected' }] };
    if (prompt === 'status') { await sleep(5000); return; }
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
      // Mit BRIDGE_MOCK_JIRA_BASE spielt der Mock den Atlassian-MCP gegen einen Jira-Nachbau (REST) nach.
      const base = process.env.BRIDGE_MOCK_JIRA_BASE;
      if (base) {
        const k = encodeURIComponent(String(inp.issueIdOrKey));
        const [method, path, body] = tool.endsWith('addCommentToJiraIssue') ? ['POST', `/issue/${k}/comment`, { body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: inp.commentBody }] }] } }]
          : tool.endsWith('transitionJiraIssue') ? ['POST', `/issue/${k}/transitions`, { transition: inp.transition }]
          : tool.endsWith('editJiraIssue') ? ['PUT', `/issue/${k}`, { fields: inp.fields }] : ['GET', `/issue/${k}`, undefined];
        const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from('mcp:mock').toString('base64') }, body: body ? JSON.stringify(body) : undefined });
        if (!r.ok) { yield { type: 'user', session_id, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: `Jira ${r.status}: ${(await r.text()).slice(0, 200)}` }] } }; return; }
      }
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
    if (/skill-test/i.test(last)) yield toolUse('Skill', { skill: 'olaf-jira' });
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
