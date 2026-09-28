// MCP-Server vault-search über stdio gegen den Fixture-Vault (Dateisystem-Weg, ohne Meilisearch).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';

const FIX = new URL('./fixtures/vault', import.meta.url).pathname;
let proc: ChildProcess;
let id = 0;
const waiting = new Map<number, (m: any) => void>();

before(() => {
  proc = spawn(process.execPath, [new URL('../mcp/vault-search.ts', import.meta.url).pathname], {
    env: { ...process.env, WERKBANK_VAULT_DIR: FIX, MEILI_MASTER_KEY: '', MEILI_HOST: 'http://127.0.0.1:1' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  createInterface({ input: proc.stdout! }).on('line', (l) => { const m = JSON.parse(l); waiting.get(m.id)?.(m); });
});
after(() => proc.kill());

function rpc(method: string, params?: unknown): Promise<any> {
  const n = ++id;
  return new Promise((resolve) => { waiting.set(n, resolve); proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n'); });
}
const call = async (name: string, args: unknown) => { const r = await rpc('tools/call', { name, arguments: args }); return r.result.content[0].text as string; };

test('Protokoll: initialize, tools/list, unbekanntes Werkzeug', async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {} });
  assert.equal(init.result.serverInfo.name, 'vault-search');
  proc.stdin!.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const list = await rpc('tools/list');
  assert.deepEqual(list.result.tools.map((t: any) => t.name), ['search', 'outline', 'read_note', 'backlinks', 'links', 'list_folder', 'recent']);
  assert.ok(list.result.tools.every((t: any) => t.annotations.readOnlyHint));
  const bad = await rpc('tools/call', { name: 'write_note', arguments: {} });
  assert.equal(bad.error.code, -32602);
});

test('search: Volltext mit Tippfehler, Filter', async () => {
  const r = await call('search', { query: 'Zauberwrt' });
  assert.match(r, /Treffer \(Dateisystem\)/);
  assert.match(r, /Service View: Mailprotokoll — olaf\/2-Areas\/Product\/Produkt-OLAF\/1-Roadmap\/Service-View\/1-Backlog\/service-view-mailprotokoll\.md/);
  assert.match(await call('search', { query: 'Kundenakte', topic: 'Service-View', state: 'Plan' }), /service-view-kundenakte\.md/);
  assert.doesNotMatch(await call('search', { query: 'Kundenakte', state: 'Backlog' }), /service-view-kundenakte\.md/);
  assert.match(await call('search', { query: 'Start', team: 'konekto' }), /konekto-Home\.md/);
  assert.doesNotMatch(await call('search', { query: 'Start', team: 'konekto' }), /olaf-Home/);
  assert.match(await call('search', { query: 'Sprint', folder: 'olaf/1-Projects', fields: { status: 'draft' } }), /sprint-2026-09-28-planning\.md/);
  assert.match(await call('search', { query: 'Sprint', type: 'moc' }), /Olaf-Sprint-MOC/);
  assert.match(await call('search', { query: 'Sprint', modified_since: '2999-01-01' }), /Keine Treffer/);
});

test('read_note: Frontmatter geparst, Wikilinks aufgelöst', async () => {
  const r = await call('read_note', { note: 'olaf-Home' });
  assert.match(r, /^# olaf — Start\nPfad: olaf\/olaf-Home\.md\nFrontmatter: \{"title":"olaf — Start","type":"moc"/);
  assert.match(r, /\[\[Olaf-Sprint-MOC\]\] → olaf\/MOCs\/Olaf-Sprint-MOC\.md/);
  assert.match(r, /\[\[gibt-es-nicht\]\] → nicht gefunden/);
  const e = await rpc('tools/call', { name: 'read_note', arguments: { note: 'weg' } });
  assert.equal(e.result.isError, true);
});

test('backlinks, links, list_folder, recent', async () => {
  assert.match(await call('backlinks', { note: 'Olaf-Sprint-MOC' }), /olaf\/olaf-Home\.md/);
  assert.match(await call('links', { note: 'olaf/olaf-Home.md' }), /Nicht aufgelöst: gibt-es-nicht/);
  const f = await call('list_folder', { folder: 'olaf' });
  assert.match(f, /📁 1-Projects\/ \(3 Notizen\)/);
  assert.match(f, /📄 olaf-Home\.md — olaf — Start/);
  assert.match(await call('recent', { days: 36500, folder: 'olaf/MOCs' }), /Olaf Sprint MOC/);
});

test('outline und read_note mit section (nur lesen, was gebraucht wird)', async () => {
  const o = await call('outline', { note: 'sprint-2026-09-28-review' });
  assert.match(o, /Gliederung/);
  assert.match(o, /Unklar geblieben \(\d+ Zeilen\)/);
  const r = await call('read_note', { note: 'sprint-2026-09-28-review', section: 'Unklar geblieben' });
  assert.match(r, /## Unklar geblieben/);
  assert.doesNotMatch(r, /## Die Updates/);
  const e = await rpc('tools/call', { name: 'read_note', arguments: { note: 'sprint-2026-09-28-review', section: 'gibt es nicht' } });
  assert.equal(e.result.isError, true);
});
