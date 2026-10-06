// Ende-zu-Ende gegen die Brücke im Mock-Modus (kein Claude-Aufruf, kein Token nötig).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, existsSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, parseAnswer, jiraWriteKeys } from '../src/tools.ts';

const PORT = 3098;
let proc: ChildProcess;
const STATE = mkdtempSync(join(tmpdir(), 'bridge-'));
const SKILLS = mkdtempSync(join(tmpdir(), 'skills-'));
for (const n of ['olaf-jira', 'plan-to-pr', 'olaf-email-templates', 'amper-board']) { mkdirSync(join(SKILLS, n)); writeFileSync(join(SKILLS, n, 'SKILL.md'), `---\nname: ${n}\n---\n`); }
const HOMES = mkdtempSync(join(tmpdir(), 'claude-homes-'));
const jiraTouched: any[] = [];
const sessionStarts: any[] = [];
const skillUses: any[] = [];
let web: Server;

before(async () => {
  // Nachgebaute Werkbank-Web: liefert das Kontext-Paket und zählt die Aufrufe.
  web = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    if (req.url === '/internal/skill-used' && req.headers['x-werkbank-internal'] === 'geheim') { skillUses.push(JSON.parse(b)); res.end('{}'); return; }
    if (req.url === '/internal/jira-touched' && req.headers['x-werkbank-internal'] === 'geheim') { jiraTouched.push(JSON.parse(b)); res.end('{}'); return; }
    if (req.url === '/internal/session-start' && req.headers['x-werkbank-internal'] === 'geheim') {
      sessionStarts.push(JSON.parse(b));
      res.end(JSON.stringify({ text: '## Werkbank-Kontext (Test)\n- Deine PM-Tickets: 2 offen\n\n### Task-Hygiene\n1. PM-1 ist überfällig — Stand?', tokens: 30, cached: false, questions: [{ key: 'PM-1' }] }));
    } else { res.statusCode = 403; res.end('{}'); }
  });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', () => r()));
  proc = spawn(process.execPath, ['src/server.ts'], {
    env: { ...process.env, BRIDGE_MOCK: '1', BRIDGE_PORT: String(PORT), BRIDGE_STATE_DIR: STATE, BRIDGE_SKILLS_DIR: SKILLS,
      WERKBANK_URL: `http://127.0.0.1:${(web.address() as any).port}`, WERKBANK_INTERNAL_TOKEN: 'geheim', BRIDGE_SKILLS: '',
      BRIDGE_CLAUDE_HOMES: HOMES, WERKBANK_SKILLS_SOURCE: SKILLS, BRIDGE_CLAUDE_CONFIG_SHARED: 'pilot@maxenergy.at', BRIDGE_CLAUDE_CONFIG: '' },
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
  // GitHub (Knut, 06.10.2026): Merge, Force-Push und Push auf main/master/develop nie; Schreiben nur nach „ja“; Lesen frei.
  for (const command of ['gh pr merge 12', 'gh api -X PUT repos/a/b/pulls/1/merge', 'gh api repos/a/b/merges -f base=dev -f head=x', 'git merge origin/develop',
    'git push --force origin feat/x', 'git push -f origin feat/x', 'git push origin +feat/x', 'git push origin main', 'git push origin HEAD:develop', 'git push origin master']) {
    assert.equal(classify('Bash', { command }).cls, 'blocked', command);
  }
  for (const command of ['git push origin dev', 'git push -u origin feat/auto', 'gh pr create --fill', 'gh pr comment 3 --body x', 'gh pr review 3 --approve',
    'gh api -X POST repos/a/b/issues/1/comments -f body=x', 'gh api repos/a/b/issues/1/comments -f body=x', 'gh api graphql -f query="mutation { x }"',
    'curl -X POST https://api.github.com/repos/a/b/issues', 'gh issue create -t x']) {
    assert.equal(classify('Bash', { command }).cls, 'confirm', command);
  }
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
  assert.match(a, /Kontext-Paket: \d+ Zeichen, Werkzeuge: vault-search, werkbank, atlassian\. Erste Frage: PM-1 ist überfällig/);
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
  assert.deepEqual(st.j.home, { mode: 'person', dir: join(HOMES, 'u30') });
  const shared = await internal('/internal/mcp-status', { userId: 'u30', email: 'Pilot@maxenergy.at' });
  assert.deepEqual(shared.j.home, { mode: 'shared', dir: null });
});

test('Eigene Claude-Konfiguration je Person: Verzeichnis, Skills, CLAUDE.md, nur Werkbank-MCP', async () => {
  const a = await send('c70', 'konfig-test', { user: 'u70', headers: { 'x-librechat-user-email': 'lisa@maxenergy.at' } });
  assert.match(a, new RegExp(`Konfig: ${join(HOMES, 'u70')}; strict: true; Nutzer-Hooks aus: false; MCP: vault-search,werkbank,atlassian\\.`));
  const { lstatSync, readlinkSync, statSync: st } = await import('node:fs');
  assert.equal(st(join(HOMES, 'u70')).mode & 0o777, 0o700);
  assert.ok(lstatSync(join(HOMES, 'u70', 'CLAUDE.md')).isSymbolicLink(), 'CLAUDE.md aus templates/claude');
  assert.equal(readlinkSync(join(HOMES, 'u70', 'skills', 'olaf-jira')).replace(/\/$/, ''), join(SKILLS, 'olaf-jira'), 'Skills verlinkt');
  // Pilot-Konto (BRIDGE_CLAUDE_CONFIG_SHARED): echte Konfiguration, aber ebenfalls nur Werkbank-MCP und ohne Knuts Hooks.
  const b = await send('c71', 'konfig-test', { user: 'u71', headers: { 'x-librechat-user-email': 'pilot@maxenergy.at' } });
  assert.match(b, /Konfig: geteilt; strict: true; Nutzer-Hooks aus: true; MCP: vault-search,werkbank,atlassian\./);
  assert.equal(existsSync(join(HOMES, 'u71')), false);
});

test('Fortsetzen nur in derselben Claude-Konfiguration (dort liegt der Verlauf)', async () => {
  await send('c72', 'Hallo', { user: 'u72', headers: { 'x-librechat-user-email': 'pilot@maxenergy.at' } });
  const same = await send('c72', 'weiter', { user: 'u72', headers: { 'x-librechat-user-email': 'pilot@maxenergy.at' } });
  assert.match(same, /Sitzung fortgesetzt/);
  const other = await send('c72', 'und jetzt', { user: 'u72', headers: { 'x-librechat-user-email': 'jemand@maxenergy.at' } });
  assert.doesNotMatch(other, /Sitzung fortgesetzt/);
});

test('Jira im Chat geschrieben → Schlüssel an die Werkbank (sofortiges Nachziehen am Board)', async () => {
  const q = await send('c73', 'bitte jira-kommentar PM-321', { user: 'u73' });
  assert.match(q, /Soll ich in Jira \*\*addCommentToJiraIssue\*\* ausführen\?/);
  assert.equal(jiraTouched.length, 0, 'vor dem ja nichts');
  const a = await send('c73', 'ja', { user: 'u73' });
  assert.match(a, /Kommentar auf PM-321 geschrieben/);
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(jiraTouched.at(-1), { userId: 'u73', keys: ['PM-321'], tool: 'mcp__atlassian__addCommentToJiraIssue' });
  const n = jiraTouched.length;
  await send('c74', 'bitte jira-kommentar PM-322', { user: 'u73' });
  await send('c74', 'nein', { user: 'u73' });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(jiraTouched.length, n, 'abgelehnt → nichts nachzuziehen');
});

test('Welche Aufrufe Jira ändern (und welche Schlüssel)', () => {
  assert.deepEqual(jiraWriteKeys('mcp__atlassian__addCommentToJiraIssue', { issueIdOrKey: 'PM-1', commentBody: 'x' }), ['PM-1']);
  assert.deepEqual(jiraWriteKeys('mcp__atlassian__transitionJiraIssue', { issueIdOrKey: 'PM-2', transition: { id: '31' } }), ['PM-2']);
  assert.deepEqual(jiraWriteKeys('mcp__atlassian__editJiraIssue', { issueIdOrKey: 'PM-3', fields: { duedate: '2026-10-01' } }), ['PM-3']);
  assert.deepEqual(jiraWriteKeys('mcp__atlassian__createJiraIssue', { projectKey: 'PM', parent: 'PM-10', summary: 'Neu' }, '{"key":"PM-400","id":"1"}').sort(), ['PM-10', 'PM-400']);
  assert.deepEqual(jiraWriteKeys('mcp__atlassian__createIssueLink', { inwardIssue: { key: 'PM-5' }, outwardIssue: { key: 'PM-6' }, type: { name: 'Blocks' } }).sort(), ['PM-5', 'PM-6']);
  assert.equal(jiraWriteKeys('mcp__atlassian__getJiraIssue', { issueIdOrKey: 'PM-1' }), null, 'lesend');
  assert.equal(jiraWriteKeys('mcp__atlassian__createConfluencePage', { spaceId: '1' }), null, 'Confluence');
  assert.equal(jiraWriteKeys('mcp__vault-search__search', {}), null);
  // Anmelden beim MCP (Claude Codes Pseudo-Werkzeuge) ohne Rückfrage, Schreiben weiter mit.
  assert.equal(classify('mcp__atlassian__authenticate', {}).cls, 'read');
  assert.equal(classify('mcp__atlassian__complete_authentication', { callback_url: 'http://localhost:1/callback?code=x' }).cls, 'read');
  assert.equal(classify('mcp__atlassian__createJiraIssue', {}).cls, 'confirm');
});

test('Titel: Board-Chats „PM-123 · Titel“ bleiben ganz; geschriebene Dateien in der Sitzungsliste', async () => {
  const t = await send('c40', 'OLAF-TITEL\nUser: PM-321 · Hardware Admin Flow mit langer Überschrift\nAI: …', { model: 'olaf-titel' });
  assert.equal(t, 'PM-321 · Hardware Admin Flow mit langer Überschrift');
  await send('c41', 'schreib bitte', { user: 'u41' });
  await send('c41', 'ja', { user: 'u41' });
  const j: any = await (await fetch(`http://127.0.0.1:${PORT}/sessions?user=u41`, { headers: { 'x-werkbank-internal': 'geheim' } })).json();
  assert.deepEqual(j.sessions.find((s: any) => s.conv === 'c41').written, ['/vault/_werkbank-mock/notiz.md']);
});

test('Offene Rückfrage bleibt stehen, während die Person in einem anderen Chat weiterarbeitet', async () => {
  const q = await send('c50', 'schreib die Notiz', { user: 'u50' });
  assert.match(q, /Soll ich die Datei/);
  const other = await send('c51', 'Hallo nebenbei', { user: 'u50' });
  assert.match(other, /Du hast geschrieben: Hallo nebenbei/);
  const a = await send('c50', 'ja', { user: 'u50' });
  assert.match(a, /hätte die Datei jetzt geschrieben/);
});

test('Skill-Aufrufe werden gezählt (nur Name, an die Werkbank)', async () => {
  await send('c60', 'bitte Skill-Test', { user: 'u60' });
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(skillUses.at(-1), { userId: 'u60', skill: 'olaf-jira' });
});
