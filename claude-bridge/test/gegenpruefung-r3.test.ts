// Gegenprüfung Runde 3 (Paket 436, Claude statt GLM): Umgehungen und Rückschritte der Wächter aus Fix-Runde 3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readOnlyBash, classify, ohneCommitText, strangLokal, envGlob } from '../src/tools.ts';
import { jcodeEntscheid, schreibzielProblem } from '../src/jcode-pre-tool.ts';
import { zugangsdateiIn } from '../src/sessions.ts';

const wt = realpathSync(mkdtempSync(join(tmpdir(), 'gp-r3-')));
mkdirSync(join(wt, 'src'));
const voll = (command: string) => classify('Bash', { command }, { workDir: wt, scope: 'voll' }).cls;
const guard = (c: string) => spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', join(import.meta.dirname, '../src/jcode-bash-guard.ts'), '-c', c], { cwd: wt, encoding: 'utf8' }).status;

test('B1: Geheimnis-Orte auch mit // und /./ im Pfad', () => {
  assert.ok(jcodeEntscheid('read', { file_path: '/nirgends/.config//gh/hosts.yml' }, wt));
  assert.ok(jcodeEntscheid('read', { file_path: '/nirgends/.config/./gh/hosts.yml' }, wt));
  assert.ok(jcodeEntscheid('read', { file_path: '/nirgends/.config/x/../gh/hosts.yml' }, wt));
  assert.equal(guard('cat /nirgends/.config//gh/hosts.yml'), 126, 'Shell-Wächter');
});

test('B2: ANSI-C-Quoting $\'…\' baut Pfade aus Escapes — nicht lesend, im Auto-Modus Rückfrage', () => {
  assert.equal(readOnlyBash("cat ~/$'\\x2e'config/gh/hosts.yml"), false);
  assert.equal(guard("cat /nirgends/$'\\x2e'config/gh/hosts.yml"), 126);
  assert.equal(voll("cat $'\\056'env.local"), 'confirm');
  assert.equal(strangLokal("git -C $'x' status", { dirs: [wt] }), null);
});

test('B3: Commit-Text-Neutralisierung verdeckt keinen Befehl hinter $\'…\' oder einem Kommentar', () => {
  assert.match(ohneCommitText("echo $'a\\'; git commit -m '; git push origin HEAD; echo 'b'"), /git push origin HEAD/);
  assert.match(ohneCommitText("echo a #'\necho '; git commit -m '; git push origin HEAD; echo 'z'"), /git push origin HEAD/);
  assert.equal(ohneCommitText('git commit -m "gh api erwähnt"'), 'git commit -m "…"', 'normaler Commit-Text bleibt Inhalt');
  assert.equal(ohneCommitText('git commit -m "fix #12: push-Text"'), 'git commit -m "…"', '# im Zitat ist kein Kommentar');
});

test('B5: hängender Symlink im Arbeitsordner führt nicht nach draußen', () => {
  symlinkSync(join(tmpdir(), `gp-r3-fehlt-${process.pid}`, 'ziel.md'), join(wt, 'notiz.md'));
  assert.ok(schreibzielProblem('notiz.md', wt));
  assert.equal(schreibzielProblem('src/neu.ts', wt), null);
});

test('B6: cd -, cd ~- und cd $OLDPWD gelten nicht als Ordnerwechsel im Arbeitsordner', () => {
  const docs = realpathSync(mkdtempSync(join(tmpdir(), 'gp-r3-docs-')));
  for (const c of [`cd ${docs} && cd ${wt} && cd - && git restore .`, `cd ${wt} && cd ~- && git restore .`, `cd $OLDPWD && git restore .`])
    assert.equal(strangLokal(c, { dirs: [wt], docs: [docs] }), null, c);
  assert.notEqual(strangLokal(`cd ${wt}/src && git status`, { dirs: [wt], docs: [docs] }), null, 'schlichter Pfad geht weiter');
});

test('B7: Inhalte von write/edit sind kein Zugriff; Verlauf nur als Punktdatei', () => {
  assert.equal(jcodeEntscheid('edit', { file_path: 'src/a.ts', old_string: 'x', new_string: 'const chat_history = []' }, wt), null);
  assert.equal(jcodeEntscheid('write', { file_path: 'Dockerfile', content: 'COPY .npmrc ./\n' }, wt), null);
  assert.ok(jcodeEntscheid('read', { file_path: '/nirgends/.bash_history' }, wt));
  assert.ok(jcodeEntscheid('write', { file_path: '/nirgends/.npmrc', content: 'x' }, wt), 'der Pfad selbst zählt weiter');
});

test('B8: Glob-Formen nur, wenn sie eine Umgebungsdatei treffen können, und nur außerhalb von Zitaten', () => {
  for (const c of ["gh pr list --jq '.[].number'", 'jq .[0] x.json', "sed -n 's/ .*//p' f"]) assert.equal(voll(c), 'auto', c);
  for (const c of ['cat .e*', 'cat .en?', 'cat .[e]nv', 'ls -d .*']) assert.equal(voll(c), 'confirm', c);
  assert.equal(envGlob('cat .[0-9]x'), false);
});

test('B9: Merge-Sperre auch, wenn ein Zitat mit | den Befehl zerteilt', () => {
  assert.equal(voll("gh api --jq '.|.' -X PUT repos/o/r/pulls/1/merge"), 'blocked');
});

test('B10: Ordnerzugang kennt dieselben Punktdateien wie GEHEIM', () => {
  const d = realpathSync(mkdtempSync(join(tmpdir(), 'gp-r3-npmrc-'))); mkdirSync(join(d, 'web')); writeFileSync(join(d, 'web', '.npmrc'), 'x');
  assert.equal(zugangsdateiIn(d), 'web/.npmrc');
});

test('Pass B (Runde 5, A6): ein Patch, der eine Datei nach draußen verschiebt, wird abgelehnt', () => {
  const patch = '*** Begin Patch\n*** Update File: src/a.ts\n*** Move to: ../../anderes-repo/x.ts\n@@\n-a\n+b\n*** End Patch';
  assert.ok(jcodeEntscheid('apply_patch', { patch }, wt));
});

test('Pass B (Runde 5, A2): GraphQL mit Text aus der Shell gilt als Schreiben; wörtliche Abfrage bleibt lesend', async () => {
  const { githubSchreibGrund } = await import('../src/tools.ts');
  for (const c of ['gh api graphql -f query="$(cat q.graphql)"', 'gh api graphql -f query=$Q', 'gh api graphql --raw-field query=`cat q`'])
    assert.ok(githubSchreibGrund(c), c);
  assert.equal(githubSchreibGrund("gh api graphql -f query='{ viewer { login } }'"), null);
  assert.equal(githubSchreibGrund("gh api graphql -f query='{ repository(owner:\"o\", name:\"r\") { id } }' -F n=3"), null);
});

test('Pass B2 (A1): ein Symlink im Arbeitsordner auf einen Geheimnis-Ort wird beim Lesen erkannt (Hook und Shell-Wächter)', () => {
  const heim = realpathSync(mkdtempSync(join(tmpdir(), 'gp-heim-')));
  mkdirSync(join(heim, '.config', 'gh'), { recursive: true }); writeFileSync(join(heim, '.config', 'gh', 'hosts.yml'), 'oauth_token: x');
  mkdirSync(join(wt, 'docs'), { recursive: true }); symlinkSync(join(heim, '.config', 'gh', 'hosts.yml'), join(wt, 'docs', 'ctx.yml'));
  writeFileSync(join(wt, 'docs', 'echt.md'), '# x');
  assert.ok(jcodeEntscheid('read', { file_path: 'docs/ctx.yml' }, wt), 'Hook');
  assert.equal(guard('cat docs/ctx.yml'), 126, 'Shell-Wächter');
  assert.equal(jcodeEntscheid('read', { file_path: 'docs/echt.md' }, wt), null, 'normale Datei frei');
  assert.equal(guard('cat docs/echt.md'), 0);
});

test('Pass B2 (A3): die Live-Instanz ist kein Arbeitsordner für Stränge', async () => {
  const { orchDirProblem, LIVE_ORDNER } = await import('../src/tools.ts');
  assert.ok(LIVE_ORDNER.test('/home/knut/work/werkbank-dev/claude-bridge'));
  assert.ok(!LIVE_ORDNER.test('/home/knut/work/werkbank-dev2'), 'nur genau dieser Ordner');
  const live = join(realpathSync(mkdtempSync(join(tmpdir(), 'live-'))), 'werkbank-dev'); mkdirSync(live, { recursive: true });
  const alt = process.env.WERKBANK_ORCH_ROOTS; process.env.WERKBANK_ORCH_ROOTS = realpathSync(tmpdir());
  try { assert.match(String(orchDirProblem(live).problem), /Live-Instanz/); } finally { if (alt === undefined) delete process.env.WERKBANK_ORCH_ROOTS; else process.env.WERKBANK_ORCH_ROOTS = alt; }
});
