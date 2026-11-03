import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/tools.ts';

const leit = { leit: true, workDir: '/tmp/x', scope: 'voll' } as any;
const strang = { workDir: '/tmp/x', scope: 'voll' } as any;
const run = (on: boolean, f: () => void) => { const v = process.env.WERKBANK_JIRA_OHNE_KLICK; if (on) process.env.WERKBANK_JIRA_OHNE_KLICK = 'on'; else delete process.env.WERKBANK_JIRA_OHNE_KLICK; try { f(); } finally { if (v === undefined) delete process.env.WERKBANK_JIRA_OHNE_KLICK; else process.env.WERKBANK_JIRA_OHNE_KLICK = v; } };

test('Schalter aus: Jira braucht im Hauptchat weiter den Klick', () => run(false, () => {
  assert.equal(classify('mcp__werkbank__jira_anlegen', {}, leit).cls, 'confirm');
  assert.equal(classify('mcp__atlassian__editJiraIssue', { issueIdOrKey: 'OLAF-1' }, leit).cls, 'confirm');
}));
test('Schalter an: Jira schreibt im Hauptchat ohne Klick', () => run(true, () => {
  for (const t of ['mcp__werkbank__jira_anlegen', 'mcp__werkbank__jira_update', 'mcp__werkbank__jira_update_many']) assert.equal(classify(t, {}, leit).cls, 'auto', t);
  for (const t of ['mcp__atlassian__editJiraIssue', 'mcp__atlassian__createJiraIssue', 'mcp__atlassian__transitionJiraIssue', 'mcp__atlassian__addCommentToJiraIssue']) assert.equal(classify(t, { issueIdOrKey: 'OLAF-1' }, leit).cls, 'auto', t);
}));
test('Schalter an: Löschen in Jira, GitHub und Stränge bleiben mit Klick', () => run(true, () => {
  assert.equal(classify('mcp__atlassian__deleteJiraIssue', { issueIdOrKey: 'OLAF-1' }, leit).cls, 'confirm');
  assert.equal(classify('mcp__werkbank__github_schreiben', {}, leit).cls, 'confirm');
  assert.notEqual(classify('mcp__werkbank__jira_anlegen', {}, strang).cls, 'auto');
  assert.notEqual(classify('mcp__atlassian__editJiraIssue', { issueIdOrKey: 'OLAF-1' }, strang).cls, 'auto');
}));
