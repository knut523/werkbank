// Timebox: Eingaben/Raster, Übertrag auf morgen, Tagessumme (Ziele vs. ohne Ziel), Sortierung „Meine offenen Tickets“.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanBlock, carryOver, daySummary, sortMyTickets, nextDay } from '../server/timebox.ts';

test('Block: auf 15 Minuten gerundet, Grenzen, Titel oder Ticket Pflicht', () => {
  assert.deepEqual(cleanBlock({ date: '2026-09-30', start: 487, dur: 50, title: '  Mails  ' }), { ok: { date: '2026-09-30', start: 480, dur: 45, title: 'Mails' } });
  assert.ok('error' in cleanBlock({ date: '2026-09-30', start: 480, dur: 60 }));
  assert.ok('error' in cleanBlock({ date: '30.09.', start: 480, dur: 60, title: 'x' }));
  assert.ok('error' in cleanBlock({ date: '2026-09-30', start: 1410, dur: 60, title: 'x' }), 'über Mitternacht');
  assert.ok('error' in cleanBlock({ date: '2026-09-30', start: 480, dur: 60, key: 'pm-1' }));
  assert.deepEqual(cleanBlock({ start: 540 }, true), { ok: { start: 540 } });
  assert.ok('error' in cleanBlock({ state: 'weg' }, true));
});

test('Unerledigtes auf morgen: Kopien zur selben Zeit, Erledigtes bleibt', () => {
  const bs: any[] = [
    { _id: 'a', userId: 'u', date: '2026-09-30', start: 480, dur: 60, title: 'A', state: 'geplant' },
    { _id: 'b', userId: 'u', date: '2026-09-30', start: 600, dur: 30, key: 'PM-1', state: 'erledigt' },
    { _id: 'c', userId: 'u', date: '2026-09-30', start: 660, dur: 30, key: 'PM-2', state: 'verschoben' },
  ];
  const r = carryOver(bs, '2026-09-30');
  assert.deepEqual(r.mark, ['a', 'c']);
  assert.deepEqual(r.copies.map((c) => [c.date, c.start, c.title ?? c.key, c.state]), [['2026-10-01', 480, 'A', 'geplant'], ['2026-10-01', 660, 'PM-2', 'geplant']]);
  assert.equal(nextDay('2026-12-31'), '2027-01-01');
});

test('Tagessumme: geplant/erledigt, Zeit auf Ziele vs. ohne Ziel, verschoben zählt nicht', () => {
  const issues = new Map([['PM-1', { labels: ['ziel-s0928-1'] }], ['PM-2', { labels: [] }]]);
  const s = daySummary([
    { userId: 'u', date: 'd', start: 0, dur: 60, key: 'PM-1', state: 'erledigt' },
    { userId: 'u', date: 'd', start: 0, dur: 30, key: 'PM-2', state: 'geplant' },
    { userId: 'u', date: 'd', start: 0, dur: 30, title: 'frei', state: 'geplant' },
    { userId: 'u', date: 'd', start: 0, dur: 45, title: 'weg', state: 'verschoben' },
  ] as any, issues as any);
  assert.deepEqual(s, { planned: 120, done: 60, goal: 60, noGoal: 60, moved: 45, goalShare: 50, doneShare: 50 });
});

test('Meine offenen Tickets: Sprint zuerst, dann Fälligkeit, dann mit Ziel', () => {
  const t = (key: string, duedate: string | null, labels: string[] = []) => ({ key, duedate, labels });
  const r = sortMyTickets([t('PM-1', null), t('PM-2', '2026-10-01'), t('PM-3', '2026-12-01', ['sprint-2026-09-28']), t('PM-4', null, ['ziel-kr1'])], 'sprint-2026-09-28');
  assert.deepEqual(r.map((x) => x.key), ['PM-3', 'PM-2', 'PM-4', 'PM-1']);
});

test('Tagespriorität: 1–3 (Muss/Soll/Kann) je Block, steuert die Sortierung vor Sprint/Fälligkeit/Ziel', () => {
  assert.deepEqual(cleanBlock({ prio: 1 }, true), { ok: { prio: 1 } });
  assert.deepEqual(cleanBlock({ prio: null }, true), { ok: { prio: null } });
  assert.ok('error' in cleanBlock({ prio: 4 }, true));
  const t = (key: string, duedate: string | null, labels: string[] = []) => ({ key, duedate, labels });
  const r = sortMyTickets([t('PM-1', '2026-10-01', ['sprint-2026-09-28']), t('PM-2', null), t('PM-3', '2026-12-01')], 'sprint-2026-09-28', new Map([['PM-3', 1], ['PM-2', 3]]));
  assert.deepEqual(r.map((x) => x.key), ['PM-3', 'PM-2', 'PM-1']);
});

test('Runde 7: „im Sprint zuerst“ nach lokaler Mitgliedschaft', () => {
  const t = (key: string, labels: string[] = []) => ({ key, duedate: null, labels });
  const members = new Set(['PM-2']);
  const r = sortMyTickets([t('PM-1', ['sprint-2026-09-28']), t('PM-2')], 'sprint-2026-09-28', new Map(), (x) => members.has(x.key));
  assert.deepEqual(r.map((x) => x.key), ['PM-2', 'PM-1']);
});
