// Schneller Schreibweg: Atlassian-MCP direkt (Streamable HTTP), Zugang nur gelesen, Rückfall wenn nicht nutzbar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { directCall, storedAccess } from '../src/mcpdirect.ts';

function home(expiresAt: number, url: string) {
  const dir = mkdtempSync(join(tmpdir(), 'cc-'));
  writeFileSync(join(dir, '.credentials.json'), JSON.stringify({ mcpOAuth: { 'atlassian|x': { serverName: 'atlassian', serverUrl: url, accessToken: 'tok-abc', refreshToken: 'r', expiresAt } } }));
  return { mode: 'person' as const, dir };
}

test('direkt: initialize → initialized → tools/call (SSE-Antwort), genau die Argumente, Bearer aus Claude Codes Speicher', async () => {
  const seen: any[] = [];
  const srv = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    if (req.method === 'DELETE') { res.end(); return; }
    const j = JSON.parse(b);
    seen.push({ auth: req.headers.authorization, session: req.headers['mcp-session-id'], method: j.method, params: j.params });
    if (j.method === 'initialize') { res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 's1' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: {} } })); return; }
    if (!j.id) { res.writeHead(202); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: j.id, result: { content: [{ type: 'text', text: 'Kommentar angelegt' }] } })}\n\n`);
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(srv.address() as any).port}/v1/mcp`;
  try {
    const input = { cloudId: 'c', issueIdOrKey: 'PM-1', commentBody: 'hi' };
    const r = await directCall({ home: home(Date.now() + 3600_000, url), tool: 'mcp__atlassian__addCommentToJiraIssue', input, url });
    assert.deepEqual(r, { ok: true, result: 'Kommentar angelegt' });
    assert.deepEqual(seen.map((s) => s.method), ['initialize', 'notifications/initialized', 'tools/call']);
    assert.ok(seen.every((s) => s.auth === 'Bearer tok-abc'));
    assert.equal(seen[2].session, 's1');
    assert.deepEqual(seen[2].params, { name: 'addCommentToJiraIssue', arguments: input });
    // abgelaufen → null (Claude-Weg erneuert den Zugang; hier wird nie erneuert)
    assert.equal(await directCall({ home: home(Date.now() + 10_000, url), tool: 'mcp__atlassian__addCommentToJiraIssue', input, url }), null);
    // nicht freigegebenes Werkzeug → null
    assert.equal(await directCall({ home: home(Date.now() + 3600_000, url), tool: 'mcp__atlassian__createJiraIssue', input, url }), null);
    assert.equal(storedAccess({ mode: 'person', dir: mkdtempSync(join(tmpdir(), 'cc-')) }, url), null, 'ohne Anmeldung → null');
  } finally { srv.close(); }
});

test('direkt: 401 beim initialize → Rückfall (null); Werkzeugfehler → tool_error, kein Rückfall', async () => {
  let mode = 'deny';
  const srv = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    if (mode === 'deny') { res.writeHead(401); res.end('{}'); return; }
    const j = JSON.parse(b || '{}');
    if (j.method === 'initialize') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })); return; }
    if (!j.id) { res.writeHead(202); res.end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: j.id, result: { isError: true, content: [{ type: 'text', text: 'Transition invalid' }] } }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(srv.address() as any).port}/v1/mcp`;
  try {
    const h = home(Date.now() + 3600_000, url);
    assert.equal(await directCall({ home: h, tool: 'mcp__atlassian__transitionJiraIssue', input: { issueIdOrKey: 'PM-1' }, url }), null);
    mode = 'ok';
    assert.deepEqual(await directCall({ home: h, tool: 'mcp__atlassian__transitionJiraIssue', input: { issueIdOrKey: 'PM-1' }, url }), { ok: false, error: 'tool_error', message: 'Transition invalid' });
  } finally { srv.close(); }
});
