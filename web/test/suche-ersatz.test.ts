// Walkthrough 19.10.: Suchdienst aus → statt „Interner Fehler.“ eine Ersatzsuche in Titeln und Dateinamen (mit Hinweis).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titelSuche } from '../server/vault.ts';

const n = (path: string, title: string, mtime: number, team = 'olaf') => [path, { path, title, team, fm: { type: 'reference', status: 'current' }, mtime }] as const;
const idx = { notes: new Map([n('olaf/a/zaehler-limit.md', 'Zählerpunkt-Limit', 1), n('olaf/b/limit-neu.md', 'Neues Limit Zählerpunkt', 3), n('konekto/x.md', 'Limit', 2, 'konekto')]) };

test('Ersatzsuche: alle Wörter in Titel oder Pfad, neueste zuerst, Team-Filter', () => {
  assert.deepEqual(titelSuche(idx, 'limit zählerpunkt').map((h) => h.path), ['olaf/b/limit-neu.md', 'olaf/a/zaehler-limit.md']);
  assert.deepEqual(titelSuche(idx, 'limit', 'konekto').map((h) => h.path), ['konekto/x.md']);
  assert.equal(titelSuche(idx, 'gibtsnicht').length, 0);
  assert.equal(titelSuche(idx, 'limit')[0].type, 'reference');
});
