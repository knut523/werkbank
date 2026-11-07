// Werkbank-Werkzeuge der OC2-Stränge (Auftrag 07.11., Punkt 4): MCP-Server der Brücke, je Arbeitsordner in opencode 2 eingetragen.
// Rein (Token, JSON-RPC) und am echten opencode 2.2.5 mit Schein-Modell (ohne Melious). Ohne opencode 2: der echte Teil wird übersprungen.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, writeFileSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { oc2McpToken, oc2McpStrang, oc2McpAntwort, oc2McpVergessen } from '../src/oc2mcp.ts';
import { opencode2Laeufer, oc2Schreibrechte } from '../src/laeufer.ts';
import { mockModell, oc2MitMock, oc2Da } from './oc2-mockmodell.ts';

test('Token: stabil je Strang, verschieden zwischen Strängen; falsches oder fehlendes Token → kein Strang', () => {
  const a = oc2McpToken('u1', 'c1');
  assert.equal(oc2McpToken('u1', 'c1'), a); assert.notEqual(oc2McpToken('u1', 'c2'), a);
  assert.deepEqual(oc2McpStrang(`Bearer ${a}`), { userId: 'u1', conv: 'c1' });
  assert.equal(oc2McpStrang(`Bearer ${a.slice(0, -1)}x`), null); assert.equal(oc2McpStrang(undefined), null); assert.equal(oc2McpStrang(a), null);
  oc2McpVergessen('u1', 'c1'); assert.equal(oc2McpStrang(`Bearer ${a}`), null);
});

test('JSON-RPC: initialize, tools/list (drei Werkzeuge), tools/call nur mit bekannten Feldern und dem Strang aus dem Token', async () => {
  const strang = { userId: 'u1', conv: 'c-echt' };
  const rufe: any[] = [];
  const wb = async (pfad: string, d: object) => { rufe.push({ pfad, d }); return { hauptchat: true, id: 'b1', key: 'k1' }; };
  assert.equal(await oc2McpAntwort({ jsonrpc: '2.0', method: 'notifications/initialized' }, strang, wb), null);
  const init: any = await oc2McpAntwort({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, strang, wb);
  assert.equal(init.result.protocolVersion, '2025-06-18');
  const list: any = await oc2McpAntwort({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, strang, wb);
  assert.deepEqual(list.result.tools.map((t: any) => t.name), ['hauptchat_melden', 'bedarf_melden', 'review_ready']);
  const r: any = await oc2McpAntwort({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'bedarf_melden', arguments: { art: 'github', text: 'Push', conv: 'fremd', userId: 'fremd', extra: 1 } } }, strang, wb);
  assert.match(r.result.content[0].text, /Gemeldet \(b1\)/);
  assert.deepEqual(rufe[0], { pfad: '/internal/bedarf', d: { conv: 'c-echt', art: 'github', text: 'Push' } });
  const x: any = await oc2McpAntwort({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'delegieren', arguments: {} } }, strang, wb);
  assert.equal(x.error.code, -32602);
});

const da = oc2Da();
let mcpSrv: Server | null = null;
after(() => mcpSrv?.close());

test('opencode 2.2.5: Werkzeug werkbank_hauptchat_melden kommt mit dem Strang des Tokens an; ein anderer Ordner sieht es nicht; keine Datei im Ordner', { skip: !da && 'opencode 2 nicht installiert' }, async () => {
  const rufe: any[] = [];
  mcpSrv = createServer((q, s) => {
    let b = ''; q.on('data', (c) => (b += c)); q.on('end', async () => {
      const strang = oc2McpStrang(q.headers.authorization);
      if (!strang) { s.writeHead(403); s.end(); return; }
      const a = await oc2McpAntwort(JSON.parse(b || '{}'), strang, async (pfad, d) => { rufe.push({ pfad, ...strang, d }); return { hauptchat: true }; });
      if (!a) { s.writeHead(202); s.end(); return; }
      s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify(a));
    });
  });
  await new Promise<void>((r) => mcpSrv!.listen(0, '127.0.0.1', () => r()));
  const port = (mcpSrv.address() as any).port;
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'oc2-mcp-a-'))), anderer = realpathSync(mkdtempSync(join(tmpdir(), 'oc2-mcp-b-')));
  writeFileSync(join(cwd, 'a.txt'), 'x'); writeFileSync(join(anderer, 'a.txt'), 'x');
  const m = await mockModell([{ tool: 'werkbank_hauptchat_melden', args: { art: 'risiko', text: 'Probe' } }, { text: 'FERTIG' }]);
  const srv = await oc2MitMock({ tmp: mkdtempSync(join(tmpdir(), 'oc2-mcp-h-')), mockPort: m.port, passwort: 'pw-mcp' });
  try {
    const l = opencode2Laeufer({ base: srv.base, passwort: 'pw-mcp', taktMs: 100 });
    const mcp = { name: 'werkbank', config: { type: 'remote', url: `http://127.0.0.1:${port}/oc2-mcp`, headers: { authorization: `Bearer ${oc2McpToken('u-oc2', 'conv-oc2')}` } } };
    const r = await l.zug({ cwd, prompt: 'los', model: 'glm-5.3', timeoutS: 60, abbruch: () => false, rechte: oc2Schreibrechte([], ['werkbank_*']), mcp });
    assert.equal(r.code, 0, r.grund);
    assert.deepEqual(rufe, [{ pfad: '/internal/hauptchat-meldung', userId: 'u-oc2', conv: 'conv-oc2', d: { conv: 'conv-oc2', art: 'risiko', text: 'Probe' } }]);
    assert.ok(m.anfragen[0].tools.includes('werkbank_hauptchat_melden'));
    assert.deepEqual(readdirSync(cwd), ['a.txt'], 'keine Konfigurationsdatei im Arbeitsordner');
    // Anderer Ordner (anderer Strang) ohne Eintrag: Werkzeug nicht angeboten
    m.neu(); m.schritte.splice(0, m.schritte.length, { text: 'FERTIG' });
    const vorher = m.anfragen.length;
    const r2 = await l.zug({ cwd: anderer, prompt: 'los', model: 'glm-5.3', timeoutS: 60, abbruch: () => false, rechte: oc2Schreibrechte([], ['werkbank_*']) });
    assert.equal(r2.code, 0, r2.grund);
    assert.ok(!m.anfragen[vorher].tools.some((t) => t.startsWith('werkbank_')), JSON.stringify(m.anfragen[vorher].tools));
  } finally { srv.stop(); await m.stop(); }
});
