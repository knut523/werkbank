// Jira-Client gegen den Mock: Blättern, Abbildung, Workstreams, Nur-lesen-Token, Freitext → ADF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startJiraMock } from './jira-mock.ts';

test('Nur-lesen-Token: Lesen geht, Schreiben scheitert mit verständlicher Meldung', async () => {
  const m = await startJiraMock(0, { readOnly: true });
  try {
  process.env.WERKBANK_JIRA_BASE = `http://127.0.0.1:${m.port}/rest/api/3`;
  const { fetchAll, mapIssue, assignWorkstreams, addComment, adfText, adfDoc, boardModel, isOverdue, JiraError } = await import('../server/jira.ts');
  const creds = { email: 'a@maxenergy.at', token: 'x', source: 'eigener Token' as const };
  const raw = await fetchAll(creds);
  assert.equal(raw.length, 9, 'alle Seiten geholt');
  const is = assignWorkstreams(raw.map(mapIssue));
  const sub = is.find((i) => i.key === 'PM-332')!;
  assert.equal(sub.workstream, 'PM-70', 'Sub-task → Parent → Workstream');
  assert.equal(is.find((i) => i.key === 'PM-321')!.lastComment?.text, 'Letzter Stand: wartet auf Review.');
  await assert.rejects(addComment(creds, 'PM-321', 'hi'), (e: any) => e instanceof JiraError && e.status === 401 && /write:jira-work/.test(e.message));
  assert.equal(m.writes.length, 0);
  assert.equal(adfText(adfDoc('Zeile 1\nZeile 2\n\nAbsatz')), 'Zeile 1\nZeile 2\nAbsatz');
  assert.equal(isOverdue({ duedate: '2026-09-01', status: 'To Do' }, '2026-09-28'), true);
  assert.equal(isOverdue({ duedate: '2026-09-01', status: 'Done', statusCategory: 'done' }, '2026-09-28'), false);
  const b = boardModel(is, { showDone: true });
  assert.equal(b.lanes.find((l) => l.key === 'PM-73')!.columns['Done'].length, 1);
  } finally { await m.close(); }
});
