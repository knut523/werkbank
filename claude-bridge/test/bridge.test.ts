// Ende-zu-Ende gegen die Brücke im Mock-Modus (kein Claude-Aufruf, kein Token nötig).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, parseAnswer } from '../src/tools.ts';

const PORT = 3098;
let proc: ChildProcess;
const STATE = mkdtempSync(join(tmpdir(), 'bridge-'));

before(async () => {
  proc = spawn(process.execPath, ['src/server.ts'], {
    env: { ...process.env, BRIDGE_MOCK: '1', BRIDGE_PORT: String(PORT), BRIDGE_STATE_DIR: STATE },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Brücke startet nicht');
});
after(() => proc.kill());

async function send(conv: string, content: unknown, opts: { user?: string; model?: string; token?: string; headers?: Record<string, string>; system?: string } = {}) {
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${opts.token ?? 'mock-token'}`, 'content-type': 'application/json',
      'x-librechat-user-id': opts.user ?? 'u1', 'x-librechat-conversation-id': conv, ...(opts.headers ?? {}),
    },
    body: JSON.stringify({ model: opts.model ?? 'claude-code', stream: true, messages: [...(opts.system ? [{ role: 'system', content: opts.system }] : []), { role: 'user', content }] }),
  });
  assert.equal(res.status, 200);
  const raw = await res.text();
  assert.ok(raw.trimEnd().endsWith('data: [DONE]'), 'Stream endet mit [DONE]');
  return raw.split('\n').filter((l) => l.startsWith('data: {'))
    .map((l) => JSON.parse(l.slice(6)).choices[0]?.delta?.content ?? '').join('');
}

test('/v1/models listet die Claude-Code-Modelle', async () => {
  const j: any = await (await fetch(`http://127.0.0.1:${PORT}/v1/models`)).json();
  assert.deepEqual(j.data.map((m: any) => m.id), ['claude-code', 'claude-code-sonnet', 'claude-code-opus']);
});

test('Streaming mit Statuszeile, danach Fortsetzung derselben Sitzung', async () => {
  const a = await send('c1', 'Hallo Welt');
  assert.match(a, /\*🔎 Suche im Vault: „Hallo Welt“\*/);
  assert.match(a, /Du hast geschrieben: Hallo Welt/);
  const b = await send('c1', 'Noch was');
  assert.match(b, /Sitzung fortgesetzt/);
});

test('Schreiben braucht Bestätigung: ja', async () => {
  const q = await send('c2', 'schreib eine Notiz');
  assert.match(q, /Soll ich die Datei \*\*Vault: _werkbank-mock\/notiz.md\*\* schreiben\?/);
  assert.doesNotMatch(q, /hätte die Datei/);
  const a = await send('c2', 'ja');
  assert.match(a, /✅ 📝 Datei geschrieben/);
  assert.match(a, /hätte die Datei jetzt geschrieben/);
});

test('Schreiben braucht Bestätigung: nein', async () => {
  await send('c3', 'schreib was', { user: 'u2' });
  const a = await send('c3', 'nein', { user: 'u2' });
  assert.match(a, /Nicht ausgeführt/);
  assert.match(a, /schreibe nichts/);
});

test('API-Schlüssel werden abgelehnt', async () => {
  const a = await send('c4', 'hi', { token: 'sk-ant-api03-xyz' });
  assert.match(a, /API-Schlüssel/);
});

test('Titel ohne Claude', async () => {
  const a = await send('c5', 'OLAF-TITEL\nUser: Wie ist der Stand beim Service View im Vault?\nAI: …', { model: 'olaf-titel' });
  assert.equal(a, 'Wie ist der Stand beim Service');
});

test('Einordnung der Werkzeuge', () => {
  assert.equal(classify('Read', {}).cls, 'read');
  assert.equal(classify('Write', {}).cls, 'confirm');
  assert.equal(classify('Bash', { command: 'ls /vault' }).cls, 'confirm');
  assert.equal(classify('Bash', { command: 'git push origin dev' }).cls, 'blocked');
  assert.equal(classify('Bash', { command: 'gh pr merge 12' }).cls, 'blocked');
  assert.equal(classify('Bash', { command: 'gh api -X PUT repos/a/b/pulls/1/merge' }).cls, 'blocked');
  assert.equal(classify('mcp__atlassian__getJiraIssue', {}).cls, 'read');
  assert.equal(classify('mcp__atlassian__searchJiraIssuesUsingJql', {}).cls, 'read');
  assert.equal(classify('mcp__atlassian__createJiraIssue', {}).cls, 'confirm');
  assert.equal(classify('mcp__atlassian__transitionJiraIssue', {}).cls, 'confirm');
  assert.equal(classify('mcp__github__merge_pull_request', {}).cls, 'blocked');
  assert.equal(parseAnswer('Ja.'), 'yes');
  assert.equal(parseAnswer('nein'), 'no');
  assert.equal(parseAnswer('lieber in einen anderen Ordner'), 'other');
});

test('Anhänge landen im Arbeitsverzeichnis der Sitzung', async () => {
  const pdf = Buffer.from('%PDF-1.4 Mock').toString('base64');
  const a = await send('c6', [
    { type: 'text', text: 'Was steht in der Datei?' },
    { type: 'file', file: { filename: '../../Rechnung Mai.pdf', file_data: `data:application/pdf;base64,${pdf}` } },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from('png').toString('base64')}` } },
    { type: 'file', file: { filename: 'boese.sh', file_data: `data:text/x-sh;base64,${Buffer.from('rm -rf /').toString('base64')}` } },
  ], { user: 'u6' });
  assert.match(a, /anhaenge\/c6\/Rechnung Mai\.pdf ✓/);
  assert.match(a, /anhaenge\/c6\/anhang-2\.png ✓/);
  assert.ok(existsSync(join(STATE, 'scratch', 'u6', 'anhaenge', 'c6', 'Rechnung Mai.pdf')));
  assert.ok(!existsSync(join(STATE, 'scratch', 'u6', 'anhaenge', 'c6', 'boese.sh')), 'nicht erlaubter Typ wird nicht abgelegt');
  assert.equal(statSync(join(STATE, 'scratch', 'u6', 'anhaenge', 'c6', 'Rechnung Mai.pdf')).mode & 0o777, 0o600);
});

test('Nur-lesen-Modus (Board-Agent) lehnt Schreiben ohne Rückfrage ab', async () => {
  const a = await send('c7', 'schreib eine Notiz', { user: 'u7', headers: { 'x-werkbank-mode': 'readonly' } });
  assert.match(a, /Nur lesen/);
  assert.match(a, /schreibe nichts/);
  assert.doesNotMatch(a, /Soll ich/);
});

test('Vorgabe der Vorlage (System-Nachricht) erreicht die neue Sitzung', async () => {
  const a = await send('c8', 'Los geht es', { user: 'u8', system: 'Nutze den Skill `plan-to-pr`.' });
  assert.match(a, /Vorlage erkannt/);
});
