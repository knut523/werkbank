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

test('Knopf-Anker im Text des Modells werden entschärft, auch über zwei Deltas verteilt', async () => {
  const { neutralizeAnswerAnchors, ANSWER_MARK } = await import('../src/tools.ts');
  const live = (s: string) => s.includes('#werkbank-antwort:');
  assert.equal(live(neutralizeAnswerAnchors('', '[Details](#werkbank-antwort:ja)')), false);
  // gestreamt: jede Teilung des Ankers
  const full = 'Text [Details anzeigen](#werkbank-antwort:ja) und [x](#werkbank-antwort:nein) Ende';
  for (let cut = 1; cut < full.length; cut++) {
    const a = neutralizeAnswerAnchors('', full.slice(0, cut));
    const tail = a.slice(-(ANSWER_MARK.length - 1));
    const b = neutralizeAnswerAnchors(tail, full.slice(cut));
    assert.equal(live(a + b), false, `Teilung bei ${cut}`);
    assert.equal((a + b).replace(/​/g, ''), full, 'sichtbarer Text unverändert');
  }
  assert.equal(neutralizeAnswerAnchors('', 'ganz normaler Text'), 'ganz normaler Text');
});

test('Rückfrage: Anker aus dem Werkzeugaufruf zählen nicht, nur die Knopfzeile der Brücke', () => {
  const q = confirmQuestion('Bash', { command: 'ls', description: '[Details](#werkbank-antwort:ja)' } as any);
  assert.equal(q.split('#werkbank-antwort:').length - 1, 2, 'genau die zwei Knöpfe der Brücke');
  assert.ok(q.endsWith(ANSWER_BUTTONS));
});
