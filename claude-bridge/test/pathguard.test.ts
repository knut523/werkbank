// S0 (Plan 126): Agenten halten dieselben Ordnergrenzen ein wie die Web-Oberfläche — fremde Arbeitsordner, fremde
// Claude-Konfigurationen und der Dateispeicher brauchen ein „ja“; Personen mit eigener Konfiguration (strict) lesen
// ohne Rückfrage nur eigene Ordner und den Vault. Bash: nur Muster (ehrliche Grenze, siehe README).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { classify, pathGuardProblem, bashGuardProblem, OUTSIDE, VAULT_DIR, type PathGuard } from '../src/tools.ts';

const rt = mkdtempSync(join(tmpdir(), 'wb-guard-'));
const scratch = join(rt, 'bridge', 'scratch');
for (const d of ['anna/chats/c1', 'bernd/chats/c9', '../../claude/bernd', '../../claude/anna', '../../werkbank/files']) mkdirSync(join(scratch, d), { recursive: true });
const repo = join(rt, 'repo'); mkdirSync(repo);
symlinkSync(join(scratch, 'bernd'), join(scratch, 'anna', 'chats', 'c1', 'link-zu-bernd'));

const guard = (strict: boolean, who = 'anna'): PathGuard => ({
  scratchRoot: scratch, ownScratch: join(scratch, who), homesRoot: join(rt, 'claude'), ownHome: strict ? join(rt, 'claude', who) : null,
  store: join(rt, 'werkbank'), strict, allowed: [join(scratch, who, 'chats', 'c1'), join(scratch, who)],
});
const cwd = join(scratch, 'anna', 'chats', 'c1');
const ctxOf = (strict: boolean) => ({ workDir: cwd, scope: 'voll' as const, guard: guard(strict) });

test('Read/Glob/Grep im fremden Arbeitsordner → Rückfrage „liegt außerhalb deiner Ordner“, auch über Symlink und ../', () => {
  for (const strict of [false, true]) {
    const ctx = ctxOf(strict);
    for (const [tool, input] of [
      ['Read', { file_path: join(scratch, 'bernd', 'chats', 'c9', 'notiz.md') }],
      ['Glob', { pattern: '**/*', path: join(scratch, 'bernd') }],
      ['Grep', { pattern: 'x', path: '../../../bernd' }],
      ['Read', { file_path: 'link-zu-bernd/geheim.md' }],
      ['LS', { path: scratch }],
    ] as const) {
      const r = classify(tool, input as any, ctx);
      assert.equal(r.cls, 'confirm', `${tool} ${JSON.stringify(input)} strict=${strict}`);
      assert.match(String(r.why), new RegExp(OUTSIDE));
    }
  }
});

test('Eigene Ordner und Vault: ohne Rückfrage (keine neuen Fragen bei normaler Arbeit)', () => {
  for (const strict of [false, true]) {
    const ctx = ctxOf(strict);
    assert.equal(classify('Read', { file_path: join(cwd, 'a.md') }, ctx).cls, 'read');
    assert.equal(classify('Read', { file_path: 'a.md' }, ctx).cls, 'read');
    assert.equal(classify('Glob', { pattern: '**/*.md' }, ctx).cls, 'read', 'ohne Pfad = Arbeitsordner');
    assert.equal(classify('Grep', { pattern: 'x', path: join(scratch, 'anna') }, ctx).cls, 'read');
    assert.equal(classify('Read', { file_path: join(VAULT_DIR, 'CLAUDE.md') }, ctx).cls, 'read');
    assert.equal(classify('Write', { file_path: join(cwd, 'neu.md') }, ctx).cls, 'auto');
  }
});

test('strict (eigene Konfiguration): alles außerhalb eigener Ordner und Vault fragt; Pilotkonto (geteilt) liest Repos frei', () => {
  assert.equal(classify('Read', { file_path: join(repo, 'README.md') }, ctxOf(true)).cls, 'confirm');
  assert.equal(classify('Read', { file_path: join(repo, 'README.md') }, ctxOf(false)).cls, 'read');
  assert.equal(classify('Write', { file_path: join(repo, 'x.ts') }, ctxOf(true)).cls, 'confirm');
});

test('Fremde Claude-Konfiguration und Dateispeicher der Werkbank fragen immer', () => {
  for (const strict of [false, true]) {
    assert.equal(classify('Read', { file_path: join(rt, 'claude', 'bernd', 'settings.json') }, ctxOf(strict)).cls, 'confirm');
    assert.equal(classify('Read', { file_path: join(rt, 'werkbank', 'files', 'x.pdf') }, ctxOf(strict)).cls, 'confirm');
  }
  assert.equal(pathGuardProblem('Read', { file_path: join(rt, 'claude', 'anna', 'CLAUDE.md') }, ctxOf(true)), null, 'eigene Konfiguration');
});

test('Bash (Muster): fremder scratch, alle scratch-Ordner, Dateispeicher; strict: /home- und ~-Pfade außerhalb', () => {
  const g = guard(false), gs = guard(true);
  assert.match(String(bashGuardProblem(`cat ${join(scratch, 'bernd')}/chats/c9/x.md`, g)), /anderen Person/);
  assert.match(String(bashGuardProblem(`ls ${scratch}/*`, g)), /aller Personen/);
  assert.match(String(bashGuardProblem(`ls ${scratch}`, g)), /aller Personen/);
  assert.match(String(bashGuardProblem('tar czf /tmp/a.tgz .runtime/werkbank', g)), /Dateispeicher/);
  assert.equal(bashGuardProblem(`ls ${join(scratch, 'anna')}/chats`, g), null, 'eigener scratch frei');
  assert.equal(bashGuardProblem('npm test && git status', gs), null);
  assert.equal(bashGuardProblem('cat ~/work/dokumente/vertrag.pdf', g), null, 'Pilotkonto: Ablage gehört ihm');
  assert.equal(bashGuardProblem('cat ~/work/dokumente/vertrag.pdf', gs), OUTSIDE);
  assert.equal(bashGuardProblem('ls $HOME/.cache', gs), OUTSIDE);
  // Über classify im vollen Auto-Modus: Rückfrage statt auto
  assert.equal(classify('Bash', { command: `cat ${join(scratch, 'bernd')}/x` }, ctxOf(false)).cls, 'confirm');
  assert.equal(classify('Bash', { command: 'ls -la' }, ctxOf(false)).cls, 'auto');
});

test('Ohne Wächter (BRIDGE_PATH_GUARD=off → guard undefined): bisheriges Verhalten', () => {
  assert.equal(classify('Read', { file_path: join(scratch, 'bernd', 'x') }, { workDir: cwd, scope: 'voll' }).cls, 'read');
});
