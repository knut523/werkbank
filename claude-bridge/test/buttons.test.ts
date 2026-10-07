// Ja/Nein-Knöpfe (docs/plan-ja-nein-knoepfe.md): jede Rückfrage endet mit genau den zwei Ankern, die der
// LibreChat-Patch als Knöpfe rendert, und dem getippten Rückfall darunter.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmQuestion, ANSWER_BUTTONS } from '../src/tools.ts';

test('jede Rückfrage endet mit den Ja/Nein-Knöpfen', () => {
  for (const [tool, input] of [
    ['Bash', { command: 'ls', description: 'Ordner ansehen' }],
    ['Write', { file_path: '/tmp/x.md', content: 'x' }],
    ['Edit', { file_path: '/tmp/x.md', old_string: 'a', new_string: 'b' }],
    ['mcp__werkbank__jira_update', { key: 'PM-1', status: 'Done' }],
    ['mcp__atlassian__addCommentToJiraIssue', { issueIdOrKey: 'PM-1', commentBody: 'x' }],
    ['mcp__compartment__memory_store', { text: 'x' }],
  ] as const) {
    const q = confirmQuestion(tool, input as any);
    assert.ok(q.endsWith(ANSWER_BUTTONS), tool);
  }
  assert.match(ANSWER_BUTTONS, /^\[✅ Ja\]\(#werkbank-antwort:ja\) \[✖️ Nein\]\(#werkbank-antwort:nein\)/);
});
