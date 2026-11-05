// Nutzungs-Audit 437: der stdio-MCP-Server meldet jeden Werkzeug-Aufruf (nur den Namen) und lässt sich vom Zählen nie stören.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { serve } from '../mcp/stdio.ts';

const rufe = async (onCall: (n: string) => void) => {
  const input = new PassThrough(), output = new PassThrough();
  const rl = serve('t', '0', [{ name: 'inbox', description: '', inputSchema: { type: 'object' }, run: () => 'ok' }], { input, output, onCall });
  input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'inbox', arguments: { geheim: 'x' } } }) + '\n');
  const antwort: any = await new Promise((r) => output.once('data', (b) => r(JSON.parse(String(b)))));
  rl.close();
  return antwort;
};

test('onCall bekommt nur den Namen', async () => {
  const gesehen: string[] = [];
  const a = await rufe((n) => gesehen.push(n));
  assert.deepEqual(gesehen, ['inbox']);
  assert.equal(a.result.content[0].text, 'ok');
});

test('ein Fehler beim Zählen stört den Aufruf nicht', async () => {
  const a = await rufe(() => { throw new Error('kaputt'); });
  assert.equal(a.result.content[0].text, 'ok');
});
