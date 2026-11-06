// Aktiver Test auf einer Testbrücke (Schlangen-Fehler 06.11.2026): echter Server-Prozess, 5 gleichzeitige Stränge bei Grenze 4.
// Der Client spielt LibreChats Aufräumer nach (InMemoryJobStore: Antwort ohne Inhalts-Chunk länger als staleJobTimeout → Strom zu;
// SSE-Kommentare „: ping“ zählen nicht). Erwartet: der Wartende bekommt Lebenszeichen, bleibt verbunden, keiner endet
// „aborted“/„busy“; ein Stop (Client schließt) nimmt einen wartenden Zug weiterhin heraus.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';

/** Freier Port zur Laufzeit (Pass B: ein fester Port kollidiert mit parallelen Läufen in anderen Worktrees). */
const freierPort = () => new Promise<number>((r) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => r(p)); }); });
let PORT = 0;
const INTERNAL = 'geheim-schlange';
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'orch-schlange-')));
const STALE_MS = 2500;   // „staleJobTimeout“ des nachgespielten LibreChat (echt: 20 min; Lebenszeichen echt: 10 min)
let bridge: ChildProcess;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  PORT = await freierPort();
  bridge = spawn(process.execPath, ['src/server.ts'], {
    env: { ...process.env, BRIDGE_MOCK: '1', BRIDGE_PORT: String(PORT), BRIDGE_STATE_DIR: mkdtempSync(join(tmpdir(), 'bridge-schlange-')), BRIDGE_SKILLS: '',
      BRIDGE_CLAUDE_HOMES: mkdtempSync(join(tmpdir(), 'homes-schlange-')), BRIDGE_CLAUDE_CONFIG_SHARED: '', BRIDGE_CLAUDE_CONFIG: '',
      WERKBANK_SKILLS_SOURCE: mkdtempSync(join(tmpdir(), 'skills-schlange-')), WERKBANK_INTERNAL_TOKEN: INTERNAL, WERKBANK_URL: 'http://127.0.0.1:9',
      BRIDGE_VAULT_DIR: mkdtempSync(join(tmpdir(), 'vault-schlange-')), BRIDGE_ALLOWED_EMAILS: '', WERKBANK_ORCH_ROOTS: ROOT,
      BRIDGE_PERMISSION_MODE: '', BRIDGE_MAX_PARALLEL_CHATS: '4', BRIDGE_QUEUE_LEBENSZEICHEN_S: '1' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 150; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return; } catch { /* startet */ } await sleep(100); }
  throw new Error('Brücke startet nicht');
});
after(() => bridge?.kill());

const internal = (path: string, body: unknown) => fetch(`http://127.0.0.1:${PORT}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify(body) });
const state = async (user: string) => (await (await fetch(`http://127.0.0.1:${PORT}/internal/orch-state?user=${user}`, { headers: { 'x-werkbank-internal': INTERNAL } })).json()).strands as any[];
async function strang(user: string, vorrang = false) {
  const conv = randomUUID();
  const dir = join(ROOT, conv.slice(0, 8)); mkdirSync(dir);
  assert.equal((await internal('/internal/orchestrate', { userId: user, conv, dir, vorrang })).status, 200);
  return conv;
}
/** Wie LibreChat: liest den Strom; kommt STALE_MS lang kein Daten-Chunk (Kommentare zählen nicht), wird abgeräumt.
 *  `stopBeiSchlange`: wie der Stop-Knopf, sobald der Zug in der Schlange steht. */
async function librechat(user: string, conv: string, content: string, o: { stopBeiSchlange?: boolean } = {}): Promise<{ ende: 'durch' | 'abgeraeumt' | 'gestoppt'; text: string }> {
  const ac = new AbortController();
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: 'POST', signal: ac.signal,
    headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json', 'x-librechat-user-id': user, 'x-librechat-conversation-id': conv },
    body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content }] }),
  });
  const reader = res.body!.getReader();
  let roh = '', text = '', aktiv = Date.now();
  for (;;) {
    const r = await Promise.race([reader.read(), sleep(Math.max(1, aktiv + STALE_MS - Date.now())).then(() => null)]);
    if (!r) { ac.abort(); return { ende: 'abgeraeumt', text }; }
    if (r.done) return { ende: 'durch', text };
    roh += new TextDecoder().decode(r.value);
    const zeilen = roh.split('\n'); roh = zeilen.pop()!;
    for (const z of zeilen) {
      if (!z.startsWith('data: {')) continue;
      aktiv = Date.now();   // recordActivity je Daten-Chunk
      text += JSON.parse(z.slice(6)).choices[0]?.delta?.content ?? '';
    }
    if (o.stopBeiSchlange && /In der Schlange/.test(text)) { ac.abort(); return { ende: 'gestoppt', text }; }
  }
}
const until = async (f: () => Promise<boolean>, ms: number) => { const t0 = Date.now(); while (!(await f())) { if (Date.now() - t0 > ms) throw new Error('Zeit abgelaufen'); await sleep(100); } };

test('5 gleichzeitige Stränge bei Grenze 4, Wartezeit länger als LibreChats Aufräum-Grenze: keiner abgeräumt/aborted/busy', async () => {
  const user = 'us5';
  const convs = [await strang(user), await strang(user), await strang(user), await strang(user), await strang(user, true)];
  const laeufe = convs.map((c) => librechat(user, c, 'mock-dauer 4000'));   // der Wartende steht > STALE_MS in der Schlange
  const ende = await Promise.all(laeufe);
  assert.deepEqual(ende.map((e) => e.ende), ['durch', 'durch', 'durch', 'durch', 'durch'], 'nichts abgeräumt');
  assert.equal(ende.filter((e) => /Wartet weiter: Platz/.test(e.text)).length, 1, 'der Wartende hat Lebenszeichen bekommen');
  assert.ok(ende.every((e) => /fertig nach 4000 ms/.test(e.text)), 'jede Antwort kommt in LibreChat an');
  const st = await state(user);
  assert.deepEqual(convs.map((c) => st.find((s) => s.conv === c).turn.outcome), ['ok', 'ok', 'ok', 'ok', 'ok']);
});

test('Stop (Client schließt) nimmt einen wartenden Strang-Zug heraus (aborted), die anderen laufen weiter', async () => {
  const user = 'usx';
  const convs = [await strang(user), await strang(user), await strang(user), await strang(user), await strang(user)];
  const ende = await Promise.all(convs.map((c) => librechat(user, c, 'mock-dauer 1500', { stopBeiSchlange: true })));
  assert.deepEqual(ende.map((e) => e.ende).sort(), ['durch', 'durch', 'durch', 'durch', 'gestoppt']);
  await until(async () => (await state(user)).every((s) => s.turn?.end), 20_000);
  await sleep(300);
  const st = await state(user);
  const gestoppt = convs[ende.findIndex((e) => e.ende === 'gestoppt')];
  assert.equal(st.find((s) => s.conv === gestoppt).turn.outcome, 'aborted');
  assert.ok(!st.find((s) => s.conv === gestoppt).running, 'startet auch nach dem Freiwerden nicht');
  assert.equal(st.filter((s) => s.turn.outcome === 'ok').length, 4);
});
