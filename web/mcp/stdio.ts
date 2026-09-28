// Minimaler MCP-Server über stdio (JSON-RPC 2.0, eine Nachricht je Zeile) — ohne Abhängigkeiten.
// Unterstützt initialize, tools/list, tools/call, ping. Logs gehen nach stderr, nie nach stdout.

import { createInterface } from 'node:readline';

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: any) => Promise<string> | string;
}

export function serve(name: string, version: string, tools: Tool[], opts: { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream } = {}) {
  const out = opts.output ?? process.stdout;
  const send = (msg: unknown) => out.write(JSON.stringify(msg) + '\n');
  const rl = createInterface({ input: opts.input ?? process.stdin });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let m: any;
    try { m = JSON.parse(line); } catch { send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); return; }
    if (m.id === undefined || m.id === null) return; // Notification
    const reply = (result: unknown) => send({ jsonrpc: '2.0', id: m.id, result });
    const fail = (code: number, message: string) => send({ jsonrpc: '2.0', id: m.id, error: { code, message } });
    try {
      switch (m.method) {
        case 'initialize':
          return reply({ protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: { name, version } });
        case 'ping': return reply({});
        case 'tools/list': return reply({ tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema, annotations: { readOnlyHint: !/update|write/.test(name) } })) });
        case 'tools/call': {
          const t = tools.find((x) => x.name === m.params?.name);
          if (!t) return fail(-32602, `Unbekanntes Werkzeug: ${m.params?.name}`);
          try { return reply({ content: [{ type: 'text', text: await t.run(m.params?.arguments ?? {}) }] }); }
          catch (e: any) { return reply({ content: [{ type: 'text', text: `Fehler: ${e.message ?? e}` }], isError: true }); }
        }
        default: return fail(-32601, `Methode nicht unterstützt: ${m.method}`);
      }
    } catch (e: any) { fail(-32603, String(e.message ?? e)); }
  });
  return rl;
}
