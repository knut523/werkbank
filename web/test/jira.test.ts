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
  assert.equal(raw.length, 12, 'alle Seiten geholt');
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

test('Board: Sub-tasks hängen unter ihrer Karte (x/y erledigt), kaputte Sub-tasks ohne Parent sind markiert', async () => {
  const { boardModel } = await import('../server/jira.ts');
  const base = { statusCategory: 'new', priority: 'Medium', updated: new Date().toISOString(), description: '', comments: 0, lastComment: null };
  const is: any[] = [
    { ...base, key: 'PM-70', summary: 'Produkt OLAF', status: 'In Progress', type: 'Workstream', assignee: 'Knut', parent: null, duedate: null, workstream: 'PM-70' },
    { ...base, key: 'PM-331', summary: 'Prod-Push', status: 'In Progress', type: 'Task', assignee: 'Christoph', parent: 'PM-70', duedate: '2026-10-02', workstream: 'PM-70' },
    { ...base, key: 'PM-332', summary: 'Leak-Check', status: 'To Do', type: 'Sub-task', assignee: null, parent: 'PM-331', duedate: '2020-01-01', workstream: 'PM-70' },
    { ...base, key: 'PM-333', summary: 'Nachprüfen', status: 'Done', statusCategory: 'done', type: 'Sub-task', assignee: 'Lisa', parent: 'PM-331', duedate: null, workstream: 'PM-70' },
    { ...base, key: 'PM-259', summary: 'Feedback umfragen holen', status: 'To Do', type: 'Sub-task', assignee: 'Daniela', parent: null, duedate: null, workstream: null },
  ];
  const b = boardModel(is, { showDone: true });
  const all = b.lanes.flatMap((l: any) => Object.values(l.columns).flat()) as any[];
  assert.deepEqual(all.map((c) => c.key).sort(), ['PM-259', 'PM-331'], 'Sub-tasks mit Parent sind keine eigenen Karten');
  const p = all.find((c) => c.key === 'PM-331');
  assert.deepEqual(p.subtasks.map((s: any) => s.key), ['PM-332', 'PM-333']);
  assert.deepEqual(p.subtaskDone, 1);
  assert.equal(p.subtasks[0].overdue, true);
  assert.equal(all.find((c) => c.key === 'PM-259').broken, 'Sub-task ohne Parent');
  // Filter „überfällig“: die Karte bleibt sichtbar, weil ein Sub-task überfällig ist
  const od = boardModel(is, { filter: 'overdue', showDone: true });
  const odc = od.lanes.flatMap((l: any) => Object.values(l.columns).flat()) as any[];
  assert.deepEqual(odc.map((c) => c.key), ['PM-331']);
  assert.deepEqual(odc[0].subtasks.filter((s: any) => s.match).map((s: any) => s.key), ['PM-332']);
});
