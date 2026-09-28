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
    yield { type: 'system', subtype: 'init', session_id };
    const last = prompt.split('\n').pop() ?? '';
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
