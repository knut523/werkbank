// Karten ziehen: Spalte → echter Jira-Übergang, Bahn → Parent (nur Tasks), optimistisch verschieben und zurückspringen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveActions, allowedStatuses, laneAllowed, moveCard, describeMove } from '../src/boardMove.ts';

const TS = [{ id: 't2', name: 'In Progress', to: 'In Progress' }, { id: 't4', name: 'Erledigt', to: 'Done' }];
const isWs = (k: string) => ['PM-70', 'PM-73'].includes(k);
const task = { key: 'PM-1', type: 'Task', status: 'To Do', parent: 'PM-70', workstream: 'PM-70' };
const sub = { key: 'PM-2', type: 'Sub-task', status: 'To Do', parent: 'PM-1', workstream: 'PM-70' };

test('Spalte → Übergang: nur was Jira anbietet (Name ≠ Ziel wird über „to“ gefunden)', () => {
  assert.deepEqual(moveActions(task, { status: 'Done' }, TS, isWs), { actions: [{ type: 'status', to: 'Done' }] });
  const bad = moveActions(task, { status: 'Backlog' }, TS, isWs);
  assert.ok('error' in bad && /keinen Übergang nach „Backlog“/.test(bad.error));
  assert.deepEqual([...allowedStatuses('To Do', TS)].sort(), ['Done', 'In Progress', 'To Do']);
  assert.deepEqual(moveActions(task, { status: 'To Do' }, TS, isWs), { actions: [] }, 'gleiche Spalte: nichts');
});

test('Bahn → Parent: nur Tasks, nur in Workstreams; Sub-tasks bleiben', () => {
  assert.deepEqual(moveActions(task, { lane: 'PM-73' }, TS, isWs), { actions: [{ type: 'parent', key: 'PM-73' }] });
  assert.deepEqual(moveActions(task, { lane: 'PM-73', status: 'In Progress' }, TS, isWs), { actions: [{ type: 'parent', key: 'PM-73' }, { type: 'status', to: 'In Progress' }] });
  const s = moveActions(sub, { lane: 'PM-73' }, TS, isWs);
  assert.ok('error' in s && /Sub-tasks bleiben/.test(s.error));
  assert.equal(laneAllowed(task, '—', isWs), false, 'nicht nach „Ohne Workstream“');
  assert.equal(laneAllowed(sub, 'PM-70', isWs), true, 'eigene Bahn ok');
  assert.equal(describeMove(task, [{ type: 'status', to: 'Done' }], (k) => k), 'PM-1: To Do → Done');
});

test('Optimistisch verschieben, bei Fehler zurück auf den alten Stand', () => {
  const board = { lanes: [
    { key: 'PM-70', count: 1, columns: { 'To Do': [{ ...task }], 'In Progress': [] } },
    { key: 'PM-73', count: 0, columns: { 'To Do': [], 'In Progress': [] } },
  ] };
  const before = structuredClone(board);
  const moved = moveCard(board, 'PM-1', 'PM-73', 'In Progress');
  assert.equal(moved.lanes[0].count, 0);
  assert.equal(moved.lanes[1].columns['In Progress'][0].key, 'PM-1');
  assert.equal(moved.lanes[1].columns['In Progress'][0].pending, true);
  assert.deepEqual(board, before, 'Original unverändert — „rückgängig“/Fehler = altes Board wieder setzen');
  assert.equal(moveCard(board, 'PM-999', 'PM-73', 'To Do'), board, 'unbekannte Karte: nichts');
});
