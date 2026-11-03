import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/tools.ts';

// Knut, 03.11.2026: Strang mit frischem Worktree (code: true) unter ~/work startet ohne Rückfrage.
const HOME = process.env.HOME ?? '/home/knut';
const leit = { leit: true, workDir: `${HOME}/work/knut`, scope: 'voll' } as any;

test('orch_start mit code:true in einem Repo unter ~/work: ohne Rückfrage', () => {
  assert.equal(classify('mcp__werkbank__orch_start', { cwd: `${HOME}/work/olaf-admin`, code: true, title: 't' }, leit).cls, 'auto');
});
test('orch_start ohne code in einem Ordner außerhalb des Hauptchats: weiter mit Rückfrage', () => {
  assert.equal(classify('mcp__werkbank__orch_start', { cwd: `${HOME}/work/olaf-admin`, title: 't' }, leit).cls, 'confirm');
});
test('orch_start mit code:true außerhalb von ~/work: weiter mit Rückfrage', () => {
  assert.equal(classify('mcp__werkbank__orch_start', { cwd: '/etc', code: true, title: 't' }, leit).cls, 'confirm');
});
test('orch_start im Hauptchat-Ordner: wie bisher ohne Rückfrage', () => {
  assert.equal(classify('mcp__werkbank__orch_start', { cwd: `${HOME}/work/knut/review-pakete/x`, title: 't' }, leit).cls, 'auto');
});
