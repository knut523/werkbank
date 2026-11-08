// Drain beim SIGTERM: die Brücke hört weiter zu (laufende Stränge rufen per HTTP zurück), nimmt aber keine neuen Züge an.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freiePorts } from './port-hilfe.ts';

const chatKopf = (conv: string) => ({ authorization: 'Bearer mock-token', 'content-type': 'application/json', 'x-librechat-user-id': 'u1', 'x-librechat-conversation-id': conv });
const body = (t: string) => JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content: t }] });

test('SIGTERM: Drain hält den Listener offen — interne Route antwortet, neuer Zug wird mit 503 abgelehnt, danach Ende', async () => {
  const [port] = await freiePorts(1);
  const state = mkdtempSync(join(tmpdir(), 'bridge-drain-'));
  const proc = spawn(process.execPath, ['src/server.ts'], {
    env: { ...process.env, BRIDGE_MOCK: '1', BRIDGE_PORT: String(port), BRIDGE_STATE_DIR: state, BRIDGE_SKILLS: '', BRIDGE_DRAIN_SEK: '30', WERKBANK_INTERNAL_TOKEN: 'geheim', BRIDGE_CLAUDE_CONFIG: '' },
    stdio: 'ignore',
  });
  const ende = new Promise<number | null>((r) => proc.on('exit', (c) => r(c)));
  const base = `http://127.0.0.1:${port}`;
  try {
    for (let i = 0; i < 50; i++) { try { if ((await fetch(`${base}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
    // laufender Zug (Mock „zeitmessung“, ~6 s)
    const lang = fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: chatKopf('lang-1'), body: body('zeitmessung') }).then((r) => r.text());
    for (let i = 0; i < 50; i++) { const h: any = await (await fetch(`${base}/health`)).json(); if (h.drainLaufend > 0) break; await new Promise((r) => setTimeout(r, 100)); }
    proc.kill('SIGTERM');
    await new Promise((r) => setTimeout(r, 400));
    // interne Werkzeug-Route antwortet weiter (ohne Token: 403 der Route, nicht ECONNREFUSED)
    const intern = await fetch(`${base}/internal/auslastung-stand`, { headers: { 'x-werkbank-internal': 'geheim' } });
    assert.equal(intern.status, 200, 'interne Route erreichbar');
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    // neuer Zug in neuer Unterhaltung: abgelehnt
    const neu = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers: chatKopf('neu-2'), body: body('hallo') });
    assert.equal(neu.status, 503, 'neuer Zug wird während des Drain abgelehnt');
    // der laufende Zug darf zu Ende laufen, danach beendet sich die Brücke
    const text = await lang;
    assert.match(text, /Wort40/, 'laufender Zug lief zu Ende');
    assert.equal(await ende, 0);
  } finally { proc.kill('SIGKILL'); }
});
