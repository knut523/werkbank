// Voller Auto-Modus (Knut, 07.10.2026): Vault, Repos, Gedächtnis → Klassifikator; Jira/GitHub-Schreiben und
// Geheimnisse fragen weiter; Sperren bleiben; ohne scope exakt wie im Arbeitsordner-Modus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, VAULT_DIR } from '../src/tools.ts';

const work = realpathSync(mkdtempSync(join(tmpdir(), 'work-voll-')));
const voll = { workDir: work, scope: 'voll' as const };
const eng = { workDir: work };

test('voll: Vault, Repos, Gedächtnis gehen an den Klassifikator', () => {
  assert.equal(classify('Edit', { file_path: join(VAULT_DIR, 'olaf', 'x.md') }, voll).cls, 'auto');
  assert.equal(classify('Write', { file_path: '/home/knut/work/knut/repo/src/a.ts' }, voll).cls, 'auto');
  assert.equal(classify('Bash', { command: `grep -rn PM-321 ${VAULT_DIR}/olaf` }, voll).cls, 'auto');
  assert.equal(classify('Bash', { command: '~/.claude/skills/maxenergy-jira/scripts/jira-read.sh search "project = PM"' }, voll).cls, 'auto');
  assert.equal(classify('mcp__compartment__memory_store', { text: 'x' }, voll).cls, 'auto');
  assert.equal(classify('mcp__plugin_posthog_posthog__exec', {}, voll).cls, 'auto');
});

test('voll: Jira/GitHub-Schreiben und Geheimnisse fragen weiter, Sperren bleiben', () => {
  assert.equal(classify('mcp__atlassian__addCommentToJiraIssue', {}, voll).cls, 'confirm');
  assert.equal(classify('mcp__atlassian__transitionJiraIssue', {}, voll).cls, 'confirm');
  assert.equal(classify('mcp__werkbank__jira_update', {}, voll).cls, 'confirm');
  assert.equal(classify('mcp__atlassian__getJiraIssue', {}, voll).cls, 'read');
  for (const command of ['curl -X POST https://maxenergy.atlassian.net/rest/api/3/issue', 'git push origin dev', 'gh pr create --fill',
    'cat ~/.config/vw/session', 'cat ~/.ssh/id_ed25519', 'bw get item x', 'sudo apt install x', 'cat .env', 'ls .runtime/claude']) {
    assert.equal(classify('Bash', { command }, voll).cls, 'confirm', command);
  }
  for (const command of ['curl -s -d @c.json https://x.atlassian.net/rest/api/3/issue/PM-1/comment', 'cat .runtime/bridge/claude-accounts.json',
    'ls .runtime/werkbank/creds']) {
    assert.equal(classify('Bash', { command }, voll).cls, 'confirm', command);
  }
  for (const f of ['/home/knut/work/werkbank-dev/.runtime/x', '/home/knut/.claude/settings.json', '/home/knut/.ssh/config', '/home/knut/work/app/.env.local']) {
    assert.equal(classify('Write', { file_path: f }, voll).cls, 'confirm', f);
  }
  assert.equal(classify('Bash', { command: 'git push origin main' }, voll).cls, 'blocked');
  assert.equal(classify('Bash', { command: 'gh pr merge 1' }, voll).cls, 'blocked');
});

test('ohne scope: unverändert (Arbeitsordner-Modus), ohne Arbeitsordner: alles fragt', () => {
  assert.equal(classify('Edit', { file_path: join(VAULT_DIR, 'olaf', 'x.md') }, eng).cls, 'confirm');
  assert.equal(classify('mcp__compartment__memory_store', {}, eng).cls, 'confirm');
  assert.equal(classify('Bash', { command: `ls ${VAULT_DIR}` }, eng).cls, 'confirm');
  assert.equal(classify('Bash', { command: 'ls' }, { scope: 'voll' }).cls, 'confirm', 'scope ohne Auto-Modus wirkt nicht');
  assert.equal(classify('mcp__compartment__memory_store', {}, { scope: 'voll' }).cls, 'confirm');
});

test('voll Runde 2: Lesebefehle mit „jira“, „atlassian“ oder „.runtime“ im Text fragen nicht mehr', () => {
  for (const command of [
    'cd /home/knut/work/werkbank-dev && grep -n "jira_update" -A20 web/mcp/werkbank-tools.ts | head -30',
    "grep -rln Tagesabschluss . | grep -v node_modules | grep -v '.runtime' | head -20",
    'grep -rln hygiene --exclude-dir=node_modules --exclude-dir=.runtime --exclude-dir=.git .',
    "jq -r '.issues.nodes[].key' /home/knut/.claude/projects/x/tool-results/mcp-atlassian-searchJiraIssuesUsingJql-1.txt",
    'curl -s https://maxenergy.atlassian.net/rest/api/3/issue/PM-1',
  ]) {
    assert.equal(classify('Bash', { command }, voll).cls, 'auto', command);
  }
});
