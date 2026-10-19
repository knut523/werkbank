// Profil „release“ (Plan 213, Knut 17.10.: „Release-Strang darf lokal mergen“): `git -C <Worktree> merge …` im zugewiesenen
// Release-Worktree der Werkbank; Push, Live-Schalten und alles außerhalb des Worktrees bleibt gesperrt.
// Einordnung direkt, dazu Ende-zu-Ende gegen die Brücke im Mock-Modus (Rechteweg des SDK nachgespielt).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { releaseMerge, releaseWorktreeProblem, RELEASE_BLOCK } from '../src/tools.ts';

const PORT = 3477;
const MAIL = 'rel@maxenergy.at';
const INTERNAL = 'test-intern-' + randomUUID();
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'rel-roots-')));
const HAUPT = join(ROOT, 'werkbank-gh'), WT = join(ROOT, 'release-wt'), FREMD = join(ROOT, 'fremd-wt');
const git = (cwd: string, ...a: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd, encoding: 'utf8' });
execFileSync('git', ['init', '-q', '-b', 'main', HAUPT]);
writeFileSync(join(HAUPT, 'a.txt'), '1\n'); git(HAUPT, 'add', '-A'); git(HAUPT, 'commit', '-qm', 'basis');
git(HAUPT, 'remote', 'add', 'origin', 'https://github.com/knut523/werkbank.git');
git(HAUPT, 'branch', 'feat/x');
git(HAUPT, 'worktree', 'add', '-q', WT, '-b', 'release/x');
// Worktree eines anderen Repos (nicht Werkbank)
const ANDERS = join(ROOT, 'anders');
execFileSync('git', ['init', '-q', '-b', 'main', ANDERS]);
writeFileSync(join(ANDERS, 'b.txt'), '1\n'); git(ANDERS, 'add', '-A'); git(ANDERS, 'commit', '-qm', 'b');
git(ANDERS, 'remote', 'add', 'origin', 'https://github.com/x/y.git');
git(ANDERS, 'worktree', 'add', '-q', FREMD, '-b', 'w');

test('Release-Worktree: nur eigener Worktree des Werkbank-Repos, nie Haupt-Checkout, fremdes Repo oder Live-Instanz', () => {
  assert.equal(releaseWorktreeProblem(WT), null);
  assert.match(releaseWorktreeProblem(HAUPT)!, /eigenen Git-Worktree/);
  assert.match(releaseWorktreeProblem(FREMD)!, /Werkbank-Repos/);
  assert.match(releaseWorktreeProblem(join(WT, '..'))!, /Worktree/);
  assert.match(releaseWorktreeProblem('/home/x/work/werkbank-dev')!, /Live-Instanz/);
});

test('Release-Merge: genau `git -C <Worktree> merge …` als einzelner Befehl', () => {
  for (const c of [`git -C ${WT} merge feat/x`, `git -C "${WT}" merge --no-ff -m "Release 17d" feat/x`, `git -C ${WT} merge --abort`, `git -C '${WT}' merge --continue`])
    assert.equal(releaseMerge(c, WT), true, c);
  for (const c of [`git merge feat/x`, `git -C ${HAUPT} merge feat/x`, `git -C ${WT}/.. merge feat/x`, `git -C ${WT} merge feat/x && git -C ${WT} push`,
    `git -C ${WT} merge feat/x; rm -rf /`, `git -C ${WT} merge $(cat x)`, `git -C ${WT} merge \`x\``, `cd ${HAUPT} && git -C ${WT} merge feat/x`,
    `git -C ${WT} merge --git-dir=/x feat/x`, `git -C ${WT} push`, `git -C ${WT} merge-base a b`, `git -C ${WT} merge x | tee y`])
    assert.equal(releaseMerge(c, WT), false, c);
  for (const c of ['scripts/werkbank.sh update', 'cd ~/work/werkbank-dev && git pull', 'bash release-live-213-entwurf.sh A', 'systemctl restart x'])
    assert.ok(RELEASE_BLOCK.some(([re]) => re.test(c)), c);
});

// ---------- Ende-zu-Ende ----------
const procs: ChildProcess[] = [];
before(async () => {
  const state = mkdtempSync(join(tmpdir(), 'bridge-rel-'));
  procs.push(spawn(process.execPath, ['src/server.ts'], {
    env: { ...process.env, BRIDGE_MOCK: '1', BRIDGE_PORT: String(PORT), BRIDGE_STATE_DIR: state, BRIDGE_SKILLS: '',
      BRIDGE_CLAUDE_HOMES: mkdtempSync(join(tmpdir(), 'homes-rel-')), BRIDGE_CLAUDE_CONFIG_SHARED: '', BRIDGE_CLAUDE_CONFIG: '',
      WERKBANK_SKILLS_SOURCE: mkdtempSync(join(tmpdir(), 'skills-rel-')), WERKBANK_INTERNAL_TOKEN: INTERNAL, WERKBANK_URL: 'http://127.0.0.1:9',
      BRIDGE_VAULT_DIR: mkdtempSync(join(tmpdir(), 'vault-rel-')), BRIDGE_AUTO_EMAILS: MAIL, BRIDGE_ALLOWED_EMAILS: '', WERKBANK_ORCH_ROOTS: ROOT,
      BRIDGE_PERMISSION_MODE: 'auto', BRIDGE_AUTO_SCOPE: 'voll' },
    stdio: 'ignore',
  }));
  let up = false;
  for (let i = 0; i < 50 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${PORT}/health`)).ok; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  if (!up) throw new Error('Brücke startet nicht');
});
after(() => { for (const p of procs) p.kill(); });

const register = (body: Record<string, unknown>) => fetch(`http://127.0.0.1:${PORT}/internal/orchestrate`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify({ userId: 'ur', email: MAIL, ...body }),
});
async function send(conv: string, content: string) {
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json', 'x-librechat-user-id': 'ur', 'x-librechat-conversation-id': conv, 'x-librechat-user-email': MAIL },
    body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content }] }),
  });
  return (await res.text()).split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)).choices[0]?.delta?.content ?? '').join('');
}
const bash = (command: string) => `mock-tool Bash ${JSON.stringify({ command })}`;

test('Anmeldung: Profil release nur in einem Release-Worktree', async () => {
  assert.equal((await register({ conv: randomUUID(), dir: HAUPT, profil: 'release' })).status, 400, 'Haupt-Checkout');
  assert.equal((await register({ conv: randomUUID(), dir: FREMD, profil: 'release' })).status, 400, 'fremdes Repo');
  assert.equal((await register({ conv: randomUUID(), dir: WT, profil: 'release' })).status, 200);
});

test('Release-Strang: Merge im Worktree läuft; ohne -C, Push und Live-Schalten gesperrt; normaler Strang mergt nie', async () => {
  const conv = randomUUID();
  assert.equal((await register({ conv, dir: WT, profil: 'release' })).status, 200);
  const ok = await send(conv, bash('git -C $CWD merge --no-ff feat/x'));
  assert.match(ok, /Release-Merge im Worktree/); assert.match(ok, /Bash ausgeführt/);
  for (const c of ['git merge feat/x', 'git -C $CWD push origin release/x', 'scripts/werkbank.sh update', `git -C ${HAUPT} merge feat/x`])
    assert.match(await send(conv, bash(c)), /Bash nicht ausgeführt/, c);
  const voll = randomUUID();
  assert.equal((await register({ conv: voll, dir: WT })).status, 200);
  assert.match(await send(voll, bash('git -C $CWD merge feat/x')), /Bash nicht ausgeführt/, 'Profil voll: Merge bleibt gesperrt');
});

test('Lead-Werkzeuge (Paket 217): github_lesen frei, pr_review_starten wie orch_start (nur im Hauptchat)', async () => {
  const { classify } = await import('../src/tools.ts');
  assert.equal(classify('mcp__werkbank__github_lesen', {}).cls, 'read');
  assert.equal(classify('mcp__werkbank__pr_review_starten', { pr: 'o/r#1' }).cls, 'blocked', 'außerhalb des Hauptchats gesperrt');
  assert.equal(classify('mcp__werkbank__pr_review_starten', { pr: 'o/r#1' }, { leit: true }).cls, 'confirm', 'ohne Auto-Modus: Rückfrage');
});
