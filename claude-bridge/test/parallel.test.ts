// Parallele Chats (docs/plan-parallele-chats.md, Knut 07.10.2026): bis BRIDGE_MAX_PARALLEL_CHATS Züge je Person,
// jeder neue Chat in seinem eigenen Ordner, ein Chat mit vorhandener Sitzung bleibt im Personenordner.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const STATE = mkdtempSync(join(tmpdir(), 'bridge-parallel-'));
let mod: typeof import('../src/sessions.ts');

before(async () => {
  process.env.BRIDGE_STATE_DIR = STATE;
  // Eine Unterhaltung, die schon vor den parallelen Chats eine Sitzung hatte.
  writeFileSync(join(STATE, 'sessions.json'), JSON.stringify({ 'u1:alt': 'sess-123' }));
  mod = await import('../src/sessions.ts');
});

const chat = (pending = false) => ({ readonly: false, mode: 'default' as const, pending: pending ? {} : null });
const board = () => ({ readonly: true, mode: 'dontAsk' as const, pending: null });

test('Sperre: Vorgabe 3 laufende Chats je Person; wartende und Board-Läufe zählen nicht', () => {
  delete process.env.BRIDGE_MAX_PARALLEL_CHATS;
  assert.equal(mod.lockFor([], chat()), 'ok');
  assert.equal(mod.lockFor([chat(), chat()], chat()), 'ok');
  assert.equal(mod.lockFor([chat(), chat(), chat()], chat()), 'chat-busy');
  assert.equal(mod.lockFor([chat(), chat(), chat(true), board(), board()], chat()), 'ok', 'auf „ja“ wartend und Board zählen nicht');
  assert.equal(mod.lockFor([board(), board()], board()), 'board-full');
});

test('Sperre: BRIDGE_MAX_PARALLEL_CHATS=1 ist das alte Verhalten', () => {
  process.env.BRIDGE_MAX_PARALLEL_CHATS = '1';
  try {
    assert.equal(mod.lockFor([chat()], chat()), 'chat-busy');
    assert.equal(mod.lockFor([chat(true)], chat()), 'ok');
  } finally { delete process.env.BRIDGE_MAX_PARALLEL_CHATS; }
});

test('Ordner: neuer Chat eigener Ordner, alter Chat mit Sitzung im Personenordner, Zuordnung bleibt', () => {
  const person = mod.scratchFor('u1');
  const a = mod.workDirFor('u1', 'neu-a');
  const b = mod.workDirFor('u1', 'neu-b');
  assert.equal(a, join(person, 'chats', 'neu-a'));
  assert.equal(b, join(person, 'chats', 'neu-b'));
  assert.notEqual(a, b, 'zwei Chats, zwei Ordner');
  assert.ok(existsSync(a) && existsSync(b));
  assert.equal(mod.workDirFor('u1', 'alt'), person, 'mit Sitzung: bleibt, sonst ginge der Verlauf verloren');
  assert.equal(mod.workDirFor('u1', 'neu-a'), a, 'gleicher Chat, gleicher Ordner');
  const saved = JSON.parse(readFileSync(join(STATE, 'cwd.json'), 'utf8'));
  assert.equal(saved['u1:neu-a'], a, 'Zuordnung ist gespeichert (übersteht einen Neustart)');
  assert.equal(saved['u1:alt'], person);
});

test('Ordner: Chat-Kennung aus fremden Zeichen bleibt im Personenordner', () => {
  const person = mod.scratchFor('u2');
  const d = mod.workDirFor('u2', '../../etc');
  assert.ok(d.startsWith(join(person, 'chats') + '/'), d);
});
