// Such-Protokoll der Agenten (zwei Wochen ab 11.10.2026): keine Inhalte, Aufbewahrung 30 Tage, Abschaltdatum, Auswertung.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { toolDefs } from '../mcp/vault-tools.ts';
import { enabled, prune, logSearch, FIELDS, DEFAULT_UNTIL, hashId } from '../mcp/search-log.ts';
import { summarize, load } from '../mcp/search-log-summary.ts';

const FIX = new URL('./fixtures/vault', import.meta.url).pathname;
const rowsIn = (dir: string) => readdirSync(dir).flatMap((n) => readFileSync(join(dir, n), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));

test('Werkzeuge protokollieren search/related/read_note/outline — nur Felder ohne Inhalt', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'suchlog-'));
  const tools = Object.fromEntries(toolDefs({ vaultDir: FIX }, { dir, userId: 'user-geheim-1', convId: 'conv-7', until: '2999-01-01' }).map((t) => [t.name, t]));
  const out = await tools.search.run({ query: 'wo steht die Kundenakte' });
  const first = out.match(/— (\S+\.md)/)?.[1];
  assert.ok(first, 'Fixture liefert einen Treffer');
  await tools.read_note.run({ note: first });
  await tools.outline.run({ note: first });
  await tools.related.run({ note: first });
  await tools.search.run({ query: 'xyzzyquux' });
  await tools.backlinks.run({ note: first });   // wird nicht protokolliert
  const rows = rowsIn(dir);
  assert.deepEqual(rows.map((r) => r.tool), ['search', 'read_note', 'outline', 'related', 'search']);
  for (const r of rows) {
    for (const k of Object.keys(r)) assert.ok((FIELDS as readonly string[]).includes(k), `unerwartetes Feld ${k}`);
    assert.equal(r.user, hashId('user-geheim-1'));
    assert.match(r.user, /^[0-9a-f]{12}$/);
  }
  const raw = readFileSync(join(dir, readdirSync(dir)[0]), 'utf8');
  assert.doesNotMatch(raw, /user-geheim-1|conv-7/, 'Personen- und Unterhaltungs-ID nur gehasht');
  assert.doesNotMatch(raw, /wo steht/, 'keine Rohanfrage, nur Suchwörter ohne Füllwörter');
  assert.ok(!/…/.test(raw) && !raw.includes(out.split('\n')[1].slice(-30)), 'keine Ausschnitte / kein Werkzeugtext');
  assert.deepEqual(rows[0].terms, ['kundenakte']);
  assert.equal(rows[0].results[0], first);
  assert.equal(rows[0].hits, rows[0].results.length);
  assert.equal(rows[1].note, first);
  assert.equal(rows[4].hits, 0);
});

test('Ohne Verzeichnis (Web-Server, Tests) wird nichts geschrieben', async () => {
  const tools = toolDefs({ vaultDir: FIX });
  assert.match(await tools[0].run({ query: 'Kundenakte' } as any), /Treffer/);
});

test('Abschaltdatum: Vorgabe 25.10.2026, ab diesem Tag aus; off schaltet sofort ab', () => {
  assert.equal(DEFAULT_UNTIL, '2026-10-25');
  assert.equal(enabled({}, new Date(2026, 9, 11, 12)), true);
  assert.equal(enabled({}, new Date(2026, 9, 24, 23, 59)), true);
  assert.equal(enabled({}, new Date(2026, 9, 25, 0, 1)), false);
  assert.equal(enabled({ until: 'Unsinn' }, new Date(2026, 9, 26)), false, 'ungültiges Datum → Vorgabe');
  assert.equal(enabled({ until: '2026-11-30' }, new Date(2026, 9, 26)), true, 'verlängerbar');
  assert.equal(enabled({ mode: 'off' }, new Date(2026, 9, 11)), false);
  const dir = mkdtempSync(join(tmpdir(), 'suchlog-aus-'));
  logSearch({ dir }, { tool: 'search', terms: ['x'], results: [] }, new Date(2026, 9, 26));
  assert.equal(readdirSync(dir).length, 0, 'nach dem Abschaltdatum keine Datei');
});

test('Aufbewahrung: Tagesdateien älter als 30 Tage werden gelöscht, andere Dateien bleiben', () => {
  const dir = mkdtempSync(join(tmpdir(), 'suchlog-alt-'));
  for (const n of ['search-2026-09-01.jsonl', 'search-2026-09-15.jsonl', 'search-2026-10-10.jsonl', 'notiz.txt']) writeFileSync(join(dir, n), '{}\n');
  prune(dir, new Date(2026, 9, 11, 12));
  assert.deepEqual(readdirSync(dir).sort(), ['notiz.txt', 'search-2026-09-15.jsonl', 'search-2026-10-10.jsonl']);
  logSearch({ dir, until: '2999-01-01' }, { tool: 'search', terms: ['a'], results: ['x.md'] }, new Date(2026, 10, 20));
  assert.ok(!existsSync(join(dir, 'search-2026-10-10.jsonl')), 'Schreiben räumt mit auf');
  assert.ok(existsSync(join(dir, 'search-2026-11-20.jsonl')), 'eine Datei je Tag');
});

test('Auswertung: Top-Anfragen, Nulltreffer, Fehlgriffe, Lese-Rang', () => {
  const t = (s: number) => new Date(Date.UTC(2026, 9, 12, 9, 0, s)).toISOString();
  const rows = [
    { ts: t(1), user: 'u', conv: 'c1', tool: 'search', terms: ['bot'], results: ['a.md', 'b.md'], hits: 2 },
    { ts: t(2), user: 'u', conv: 'c1', tool: 'read_note', note: 'b.md' },
    { ts: t(3), user: 'u', conv: 'c1', tool: 'search', terms: ['bot'], results: ['a.md'], hits: 1 },
    { ts: t(4), user: 'u', conv: 'c1', tool: 'read_note', note: 'z.md' },
    { ts: t(5), user: 'v', conv: 'c2', tool: 'search', terms: ['nix'], results: [], hits: 0 },
    { ts: t(6), user: 'v', conv: 'c2', tool: 'search', terms: ['ungelesen'], results: ['a.md'], hits: 1 },
  ];
  const s = summarize(rows);
  assert.deepEqual(s.top[0], { query: 'bot', n: 2, avgHits: 1.5 });
  assert.deepEqual(s.zero, [{ query: 'nix', n: 1 }]);
  assert.deepEqual(s.misses, [{ query: 'bot', read: 'z.md' }]);
  assert.equal(s.readRank['2-3'], 1);
  assert.equal(s.unread, 1);
  assert.equal(s.people, 2);
  const dir = mkdtempSync(join(tmpdir(), 'suchlog-sum-'));
  writeFileSync(join(dir, 'search-2026-10-12.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\nkaputt\n');
  assert.equal(load(dir).length, 6);
});

test('stdio-Server schreibt mit WERKBANK_SEARCH_LOG_DIR, mit WERKBANK_SEARCH_LOG=off nicht', async () => {
  for (const mode of ['', 'off']) {
    const dir = mkdtempSync(join(tmpdir(), 'suchlog-stdio-'));
    const p = spawn(process.execPath, [new URL('../mcp/vault-search.ts', import.meta.url).pathname], {
      env: { ...process.env, WERKBANK_VAULT_DIR: FIX, MEILI_MASTER_KEY: '', MEILI_HOST: 'http://127.0.0.1:1', WERKBANK_SEARCH_LOG_DIR: dir, WERKBANK_SEARCH_LOG: mode, WERKBANK_SEARCH_LOG_UNTIL: '2999-01-01', WERKBANK_USER_ID: 'u1', WERKBANK_CONV_ID: 'c1' },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const got = new Promise<void>((r) => createInterface({ input: p.stdout! }).on('line', () => r()));
    p.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search', arguments: { query: 'Kundenakte' } } }) + '\n');
    await got; p.kill();
    assert.equal(readdirSync(dir).length, mode === 'off' ? 0 : 1, `Modus „${mode || 'Vorgabe'}“`);
  }
});
