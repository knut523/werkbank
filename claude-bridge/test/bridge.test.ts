// Ende-zu-Ende gegen die Brücke im Mock-Modus (kein Claude-Aufruf, kein Token nötig).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, parseAnswer } from '../src/tools.ts';

const PORT = 3098;
let proc: ChildProcess;
const STATE = mkdtempSync(join(tmpdir(), 'bridge-'));
const SKILLS = mkdtempSync(join(tmpdir(), 'skills-'));
for (const n of ['olaf-jira', 'plan-to-pr', 'olaf-email-templates', 'amper-board']) { mkdirSync(join(SKILLS, n)); writeFileSync(join(SKILLS, n, 'SKILL.md'), `---\nname: ${n}\n---\n`); }
const sessionStarts: any[] = [];
let web: Server;

before(async () => {
  // Nachgebaute Werkbank-Web: liefert das Kontext-Paket und zählt die Aufrufe.
  web = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    if (req.url === '/internal/session-start' && req.headers['x-werkbank-internal'] === 'geheim') {
      sessionStarts.push(JSON.parse(b));
      res.end(JSON.stringify({ text: '## Werkbank-Kontext (Test)\n- Deine PM-Tickets: 2 offen\n\n### Task-Hygiene\n1. PM-1 ist überfällig — Stand?', tokens: 30, cached: false, questions: [{ key: 'PM-1' }] }));
    } else { res.statusCode = 403; res.end('{}'); }
  });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', () => r()));
  proc = spawn(process.execPath, ['src/server.ts'], {
    env: { ...process.env, BRIDGE_MOCK: '1', BRIDGE_PORT: String(PORT), BRIDGE_STATE_DIR: STATE, BRIDGE_SKILLS_DIR: SKILLS,
      WERKBANK_URL: `http://127.0.0.1:${(web.address() as any).port}`, WERKBANK_INTERNAL_TOKEN: 'geheim', BRIDGE_SKILLS: '' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Brücke startet nicht');
});
after(() => { proc.kill(); web.close(); });

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

test('Neue Sitzung bekommt das Kontext-Paket und die Werkbank-Werkzeuge — fortgesetzte nicht', async () => {
  const n0 = sessionStarts.length;
  const a = await send('c9', 'Guten Morgen', { user: 'u9' });
  assert.match(a, /Kontext-Paket: \d+ Zeichen, Werkzeuge: vault-search, werkbank\. Erste Frage: PM-1 ist überfällig/);
  assert.equal(sessionStarts.length, n0 + 1);
  assert.deepEqual(sessionStarts.at(-1).skills.sort(), ['olaf-jira', 'plan-to-pr']);
  const b = await send('c9', 'Weiter', { user: 'u9' });
  assert.doesNotMatch(b, /Kontext-Paket/);
  assert.equal(sessionStarts.length, n0 + 1, 'kein zweiter Abruf bei resume');
  const t = await send('c10', 'Tagesabschluss bitte', { user: 'u9' });
  assert.match(t, /Kontext-Paket/);
  assert.equal(sessionStarts.at(-1).eod, true);
});

test('Skills: Kern statt aller, Zuschaltung per Nennung bleibt in der Unterhaltung', async () => {
  const a = await send('c11', 'Hallo', { user: 'u11' });
  assert.match(a, /Skills: 2 \[/);
  const b = await send('c11', 'nimm Skill olaf-email-templates dafür', { user: 'u11' });
  assert.match(b, /Skills: 3 \[.*olaf-email-templates/);
  const c = await send('c11', 'und weiter', { user: 'u11' });
  assert.match(c, /olaf-email-templates/, 'bleibt zugeschaltet');
  const d = await send('c12', 'Los', { user: 'u11', system: 'Nutze den Skill `amper-board`.' });
  assert.match(d, /amper-board/, 'aus der Vorlage');
});

test('Einordnung der Werkbank-Werkzeuge', () => {
  assert.equal(classify('mcp__vault-search__read_note', {}).cls, 'read');
  assert.equal(classify('mcp__werkbank__hygiene_snooze', {}).cls, 'read');
  assert.equal(classify('mcp__werkbank__jira_update', {}).cls, 'confirm');
  assert.equal(classify('mcp__forge-review__review_pr', {}).cls, 'read');
  assert.equal(classify('mcp__forge-review__post_review', {}).cls, 'blocked');
});

test('Sitzungsstatus je Person nur mit internem Token', async () => {
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/sessions?user=u9`)).status, 403);
  const j: any = await (await fetch(`http://127.0.0.1:${PORT}/sessions?user=u9`, { headers: { 'x-werkbank-internal': 'geheim' } })).json();
  const c9 = j.sessions.find((s: any) => s.conv === 'c9');
  assert.equal(c9.status, 'bereit');
  assert.equal(c9.turns, 2);
  assert.equal(c9.resumable, true);
  assert.equal(c9.title, 'Guten Morgen');
});

test('Streaming: „arbeitet …“ sofort, Denken als Fortschrittszeile, Text tokenweise', async () => {
  const t0 = Date.now();
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json', 'x-librechat-user-id': 'u20', 'x-librechat-conversation-id': 'c20' },
    body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content: 'Zeitmessung' }] }),
  });
  const seen: { t: number; c: string }[] = [];
  const dec = new TextDecoder();
  for await (const part of res.body as any) {
    for (const line of dec.decode(part, { stream: true }).split('\n')) {
      if (!line.startsWith('data: {')) continue;
      const c = JSON.parse(line.slice(6)).choices[0]?.delta?.content;
      if (c) seen.push({ t: Date.now() - t0, c });
    }
  }
  assert.match(seen[0].c, /Claude arbeitet/, 'erste sichtbare Zeile ist die Arbeitsanzeige');
  assert.ok(seen[0].t < 1000, `Arbeitsanzeige nach ${seen[0].t} ms`);
  const all = seen.map((s) => s.c).join('');
  assert.match(all, /denkt nach/);
  assert.match(all, /📚 Vault-Suche: search – Zeitmessung/);
  const words = seen.filter((s) => /^\n?Wort\d+ $/.test(s.c));
  assert.equal(words.length, 40, 'jedes Wort ein eigenes Stück');
  assert.ok(words[39].t - words[0].t > 1500, 'Wörter kommen verteilt, nicht auf einmal');
});

async function internal(path: string, body: unknown, token = 'mock-token') {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': 'geheim', authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: r.status, j: await r.json() as any };
}

test('MCP-Aufruf: nur mit internem Token, genau die bestätigten Argumente, 401 → klare Fehlerart', async () => {
  const no = await fetch(`http://127.0.0.1:${PORT}/internal/mcp-call`, { method: 'POST', body: '{}' });
  assert.equal(no.status, 403);
  const input = { cloudId: 'c', issueIdOrKey: 'PM-5', commentBody: 'Hallo', contentFormat: 'markdown' };
  const ok = await internal('/internal/mcp-call', { userId: 'u30', tool: 'mcp__atlassian__addCommentToJiraIssue', input });
  assert.equal(ok.j.ok, true, JSON.stringify(ok.j));
  const { readFileSync } = await import('node:fs');
  const calls = readFileSync(join(STATE, 'mock-mcp-calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(calls.at(-1), { tool: 'mcp__atlassian__addCommentToJiraIssue', input });
  const bad = await internal('/internal/mcp-call', { userId: 'u30', tool: 'mcp__atlassian__addCommentToJiraIssue', input: { ...input, commentBody: '401-TEST' } });
  assert.equal(bad.j.ok, false);
  assert.equal(bad.j.error, 'mcp_auth');
  const st = await internal('/internal/mcp-status', { userId: 'u30' });
  assert.deepEqual(st.j.servers, [{ name: 'atlassian', status: 'connected' }]);
});
