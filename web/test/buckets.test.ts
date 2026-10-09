import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topicBuckets } from '../src/buckets.ts';

const sp = (name: string, state: string, x: any = {}) => ({ path: `t/${name}.md`, name, title: name, topic: 'A', state, open: 0, tickets: [], ...x });

test('Überblick: vier Felder je Thema, Themen mit Entscheidungen zuerst', () => {
  const rows = topicBuckets([
    { name: 'A', states: {
      '1-Backlog': [sp('backlog', '1-Backlog')],
      '2-Pre-Plan': [sp('vorplan', '2-Pre-Plan', { rank: 1 })],
      '3-Plan': [sp('plan2', '3-Plan', { rank: 5 }), sp('plan1', '3-Plan', { rank: 3 }), sp('aktiv', '3-Plan', { rank: 2, tickets: [{ key: 'PM-1', status: 'In Progress' }] }), sp('agent', '3-Plan', { rank: 4, tickets: [{ key: 'PM-2', status: 'To Do' }] })],
      '4-Review': [sp('review', '4-Review', { rank: 9 })],
      '5-Live': [sp('alt', '5-Live', { verified: '2026-09-01' }), sp('neu', '5-Live', { verified: '2026-10-08' })],
    } },
    { name: 'B', states: { '3-Plan': [sp('b1', '3-Plan', { topic: 'B', rank: 7 })] } },
  ], [{ path: 'x', topic: 'B', title: 'Frage B' }], { 'PM-2': 'wartet auf ja' });
  assert.deepEqual(rows.map((r) => r.topic), ['B', 'A'], 'B wartet auf dich → zuerst');
  const a = rows[1];
  assert.deepEqual(a.next.items.map((s) => s.name), ['plan1', 'plan2', 'vorplan'], 'Plan vor Pre-Plan, nach Rang; aktive Tickets und Agenten raus');
  assert.deepEqual(a.inWork.items.map((s) => [s.name, s.agent]), [['agent', 'wartet auf ja'], ['review', null]]);
  assert.deepEqual(a.done.items.map((s) => s.name), ['neu', 'alt'], 'zuletzt geprüft zuerst');
  assert.equal(a.waiting.count, 0);
  assert.equal(rows[0].waiting.count, 1);
});
