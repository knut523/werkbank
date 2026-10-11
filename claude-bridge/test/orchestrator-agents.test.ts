// Orchestrator-Stränge (docs/plan-orchestrator-agents.md, Knut 09.10.2026): Anmeldung über den internen Kanal mit
// Arbeitsordner, Sperren vor allen Klassen (auch nach „ja“), keine Rückfragen, ausdrücklicher Zustand je Zug.
// Ende-zu-Ende gegen die Brücke im Mock-Modus (src/mock.ts spielt den Rechteweg des SDK nach).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { orchestratorBlock, orchDirProblem, classify } from '../src/tools.ts';

const PORT = 3194, OFF_PORT = 3197;
const MAIL = 'orch@maxenergy.at';
const INTERNAL = 'test-intern-' + randomUUID();
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'orch-roots-')));
const WT = join(ROOT, 'worktree-a');
mkdirSync(WT);
const VAULT = realpathSync(mkdtempSync(join(tmpdir(), 'vault-orch-')));
const procs: ChildProcess[] = [];
let STATE = '';
const PRE_CONV = randomUUID();

function startBridge(port: number, extra: Record<string, string>, pre?: (state: string) => void) {
  const state = mkdtempSync(join(tmpdir(), 'bridge-orch-'));
  pre?.(state);
  const p = spawn(process.execPath, ['src/server.ts'], {
    env: { ...process.env, BRIDGE_MOCK: '1', BRIDGE_PORT: String(port), BRIDGE_STATE_DIR: state, BRIDGE_SKILLS: '',
      BRIDGE_CLAUDE_HOMES: mkdtempSync(join(tmpdir(), 'homes-orch-')), BRIDGE_CLAUDE_CONFIG_SHARED: '', BRIDGE_CLAUDE_CONFIG: '',
      WERKBANK_SKILLS_SOURCE: mkdtempSync(join(tmpdir(), 'skills-orch-')), WERKBANK_INTERNAL_TOKEN: INTERNAL, WERKBANK_URL: 'http://127.0.0.1:9',
      BRIDGE_VAULT_DIR: VAULT, BRIDGE_AUTO_EMAILS: MAIL, BRIDGE_ALLOWED_EMAILS: '', WERKBANK_ORCH_ROOTS: ROOT, ...extra },
    stdio: 'ignore',
  });
  procs.push(p);
  return state;
}

before(async () => {
  // Ein Strang, dessen Zug beim Neustart der Brücke mittendrin war (Start ohne Ende).
  STATE = startBridge(PORT, { BRIDGE_PERMISSION_MODE: 'auto', BRIDGE_AUTO_SCOPE: 'voll' }, (state) => {
    writeFileSync(join(state, 'orch.json'), JSON.stringify({ [`uo:${PRE_CONV}`]: { dir: WT, since: 1, turn: { start: 2, end: null, outcome: null } } }));
  });
  startBridge(OFF_PORT, { BRIDGE_PERMISSION_MODE: 'default' });
  for (const port of [PORT, OFF_PORT]) {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch { await new Promise((r) => setTimeout(r, 100)); } }
    if (!up) throw new Error('Brücke startet nicht: ' + port);
  }
});
after(() => { for (const p of procs) p.kill(); });

const register = (port: number, body: Record<string, unknown>, token = INTERNAL) => fetch(`http://127.0.0.1:${port}/internal/orchestrate`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': token }, body: JSON.stringify(body),
});
const state = async (port: number, user = 'uo') => (await (await fetch(`http://127.0.0.1:${port}/internal/orch-state?user=${user}`, { headers: { 'x-werkbank-internal': INTERNAL } })).json()).strands as any[];

async function send(port: number, conv: string, content: string, user = 'uo') {
  const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json', 'x-librechat-user-id': user, 'x-librechat-conversation-id': conv, 'x-librechat-user-email': MAIL },
    body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content }] }),
  });
  const raw = await res.text();
  return raw.split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)).choices[0]?.delta?.content ?? '').join('');
}
const tool = (name: string, input: Record<string, unknown>) => `mock-tool ${name} ${JSON.stringify(input)}`;

// ---------- Einordnung ----------

test('Sperre im Strang: GitHub- und Jira-Schreiben in allen naheliegenden Formen, Lesen und Arbeiten frei', () => {
  const blocked = [
    'git push', 'git push origin feat/x', 'git -C /w/x push', 'git -c http.extraHeader=x push origin', 'cd /w && git push -u origin HEAD',
    'git send-pack origin', 'git config alias.ship push', 'git -c alias.p=push p', 'git config --global credential.helper store',
    'git config user.email a@b', 'echo x > .git/hooks/pre-commit', 'git config core.hooksPath /tmp/h',
    'gh pr create --fill', 'gh api repos/x/y/pulls', 'gh issue comment 1 -b hi', 'curl -d \'{"a":1}\' https://api.github.com/repos/x/y/issues',
    'curl -X POST https://maxenergy.atlassian.net/rest/api/3/issue', 'git push --force',
  ];
  for (const c of blocked) assert.ok(orchestratorBlock('Bash', { command: c }), `gesperrt: ${c}`);
  const free = ['git status', 'git commit -m "fix config handling"', 'git -C /w/x log --oneline', 'git config --get user.name', 'git config --list',
    'npm test', 'gh pr view 12', 'gh pr list', 'gh pr diff 3', 'echo "push it" > notes.txt', 'grep -r jira src/'];
  for (const c of free) assert.equal(orchestratorBlock('Bash', { command: c }), null, `frei: ${c}`);
  assert.ok(orchestratorBlock('mcp__atlassian__createJiraIssue', {}));
  assert.ok(orchestratorBlock('mcp__atlassian__addCommentToJiraIssue', {}));
  assert.ok(orchestratorBlock('mcp__atlassian__editJiraIssue', {}));
  assert.equal(orchestratorBlock('mcp__atlassian__getJiraIssue', {}), null);
  assert.equal(orchestratorBlock('mcp__atlassian__searchJiraIssuesUsingJql', {}), null);
  assert.ok(orchestratorBlock('mcp__werkbank__jira_update', {}));
  assert.ok(orchestratorBlock('mcp__werkbank__jira_update_many', {}));
  assert.ok(orchestratorBlock('mcp__github__create_pull_request', {}));
  for (const f of ['/w/x/.git/hooks/pre-push', '/w/x/.git/config', '/w/x/.claude/settings.json', '/w/x/.env', '/w/x/.env.local'])
    assert.ok(orchestratorBlock('Write', { file_path: f }), `gesperrt: ${f}`);
  assert.equal(orchestratorBlock('Write', { file_path: '/w/x/src/a.ts' }), null);
  assert.equal(orchestratorBlock('Read', { file_path: '/w/x/.git/config' }), null, 'Lesen bleibt frei');
  // Normale Chats: Einordnung unverändert (git push fragt weiter nach, wird nicht gesperrt).
  assert.equal(classify('Bash', { command: 'git push' }).cls, 'confirm');
});

test('Arbeitsordner: nur unterhalb der Wurzeln, existierend, Verzeichnis, nicht Wurzel/Vault/.runtime', () => {
  const prev = process.env.WERKBANK_ORCH_ROOTS;
  process.env.WERKBANK_ORCH_ROOTS = ROOT;
  try {
    assert.equal(orchDirProblem(WT).problem, null);
    assert.equal(orchDirProblem(WT).real, WT);
    assert.match(orchDirProblem('relativ/pfad').problem!, /absolut/);
    assert.match(orchDirProblem(join(ROOT, 'gibts-nicht')).problem!, /gibt es nicht/);
    writeFileSync(join(ROOT, 'datei.txt'), 'x');
    assert.match(orchDirProblem(join(ROOT, 'datei.txt')).problem!, /kein Verzeichnis/);
    assert.match(orchDirProblem(ROOT).problem!, /unterhalb/, 'die Wurzel selbst nicht');
    assert.match(orchDirProblem(tmpdir()).problem!, /unterhalb/);
    assert.match(orchDirProblem(join(WT, '..', 'worktree-a', '..', '..')).problem!, /unterhalb/, 'Pfad mit .. wird aufgelöst');
    mkdirSync(join(ROOT, '.runtime-iso', 'x'), { recursive: true });
    assert.match(orchDirProblem(join(ROOT, '.runtime-iso', 'x')).problem!, /\.runtime/);
  } finally { if (prev === undefined) delete process.env.WERKBANK_ORCH_ROOTS; else process.env.WERKBANK_ORCH_ROOTS = prev; }
});

// ---------- Anmeldung ----------

test('Anmeldung: ohne/mit falschem internen Schlüssel 403, Ordner geprüft, eine Unterhaltung nur einmal', async () => {
  const conv = randomUUID();
  assert.equal((await register(PORT, { userId: 'uo', email: MAIL, conv, dir: WT }, '')).status, 403);
  assert.equal((await register(PORT, { userId: 'uo', email: MAIL, conv, dir: WT }, 'falsch')).status, 403);
  assert.equal((await register(PORT, { userId: 'uo', email: MAIL, conv, dir: '/etc' })).status, 400, 'außerhalb der Wurzeln');
  assert.equal((await register(PORT, { userId: 'uo', email: MAIL, conv: 'keine-uuid', dir: WT })).status, 400);
  const ok = await register(PORT, { userId: 'uo', email: MAIL, conv, dir: WT });
  assert.equal(ok.status, 200);
  const j: any = await ok.json();
  assert.equal(j.dir, WT);
  assert.equal(j.mode, 'auto', 'Rechte-Modus der Person wird gemeldet');
  assert.equal((await register(PORT, { userId: 'uo', email: MAIL, conv, dir: WT })).status, 409, 'nicht zweimal');
  // Eine bestehende Unterhaltung mit Sitzung lässt sich nicht nachträglich zum Strang machen.
  const old = randomUUID();
  await send(PORT, old, 'hallo');
  assert.equal((await register(PORT, { userId: 'uo', email: MAIL, conv: old, dir: WT })).status, 409);
});

test('Strang: arbeitet im angemeldeten Ordner (Auto-Modus), Zustand läuft → ok, normaler Chat bleibt im Chat-Ordner', async () => {
  const conv = randomUUID();
  assert.equal((await register(PORT, { userId: 'uo', email: MAIL, conv, dir: WT })).status, 200);
  const out = await send(PORT, conv, tool('Write', { file_path: '$CWD/hallo.txt', content: 'hallo' }));
  assert.match(out, /Write ausgeführt/, out);
  const s = (await state(PORT)).find((x) => x.conv === conv);
  assert.ok(s, 'Strang im Zustand');
  assert.equal(s.dir, WT);
  assert.deepEqual(s.written, [join(WT, 'hallo.txt')], 'cwd = angemeldeter Ordner');
  assert.equal(s.running, false);
  assert.equal(s.turn.outcome, 'ok');
  assert.ok(s.turn.end >= s.turn.start);
  const cwd = JSON.parse(readFileSync(join(STATE, 'cwd.json'), 'utf8'));
  assert.equal(cwd[`uo:${conv}`], WT, 'Zuordnung dauerhaft');
  const normal = randomUUID();
  await send(PORT, normal, 'hallo');
  assert.notEqual(cwd[`uo:${normal}`], WT);
  assert.ok(!(await state(PORT)).some((x) => x.conv === normal), 'normaler Chat ist kein Strang');
});

test('Strang: git push (auch git -C … push) gesperrt, auch im Auto-Modus — normaler Chat fragt wie bisher', async () => {
  const conv = randomUUID();
  await register(PORT, { userId: 'uo', email: MAIL, conv, dir: WT });
  const out = await send(PORT, conv, tool('Bash', { command: 'git -C $CWD push origin feat/x' }));
  assert.match(out, /Orchestrator-Strang: git push gesperrt/, out);
  assert.match(out, /Bash nicht ausgeführt/);
  const jira = await send(PORT, conv, tool('mcp__atlassian__addCommentToJiraIssue', { issueIdOrKey: 'PM-1', commentBody: 'x' }));
  assert.match(jira, /Orchestrator-Strang: Jira\/Confluence schreiben gesperrt/, jira);
  // Normaler Chat im Auto-Modus: git push fragt nach (Rückfrage), statt gesperrt zu sein.
  const normal = await send(PORT, randomUUID(), tool('Bash', { command: 'git push origin feat/x' }));
  assert.doesNotMatch(normal, /Orchestrator-Strang/);
  assert.match(normal, /ja/i);
});

test('Strang ohne Auto-Modus: keine Rückfrage — Schreiben wird abgelehnt, die Sitzung wartet nicht auf „ja“', async () => {
  const conv = randomUUID();
  assert.equal((await register(OFF_PORT, { userId: 'uo', email: MAIL, conv, dir: WT })).status, 200);
  const out = await send(OFF_PORT, conv, tool('Write', { file_path: '$CWD/b.txt', content: 'x' }));
  assert.match(out, /Orchestrator-Strang ohne Rückfragen/, out);
  assert.match(out, /Write nicht ausgeführt/);
  const s = (await state(OFF_PORT)).find((x) => x.conv === conv);
  assert.equal(s.running, false, 'keine wartende Sitzung');
  assert.equal(s.turn.outcome, 'ok');
});

test('Zustand: Zug ohne Ende nach Neustart der Brücke = interrupted', async () => {
  const s = (await state(PORT)).find((x) => x.conv === PRE_CONV);
  assert.ok(s);
  assert.equal(s.interrupted, true);
  assert.equal(s.running, false);
  assert.equal((await state(PORT, 'jemand-anderes')).length, 0, 'nur die eigenen Stränge');
});

test('Git-Umgebung für Stränge: eigene globale Konfiguration ohne Credential-Helfer, Push umgeleitet', async () => {
  process.env.BRIDGE_STATE_DIR = mkdtempSync(join(tmpdir(), 'bridge-orch-git-'));
  const { orchGitEnv } = await import('../src/sessions.ts');
  const env: Record<string, string | undefined> = {};
  orchGitEnv(env);
  const cfg = readFileSync(env.GIT_CONFIG_GLOBAL!, 'utf8');
  assert.match(cfg, /\[credential\]\n\thelper =\n/);
  assert.match(cfg, /pushInsteadOf = https:\/\/github\.com\//);
  assert.match(cfg, /pushInsteadOf = git@github\.com:/);
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(env.GIT_ASKPASS, '/bin/false');
});
