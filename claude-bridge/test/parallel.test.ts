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

test('Sperre (F7, Knut 19.10.): keine Zahl-Grenze — die Schätzung entscheidet gegen die Box; Board-Läufe wie bisher', async () => {
  delete process.env.BRIDGE_MAX_PARALLEL_CHATS;
  const { schaetze } = await import('../src/schaetzung.ts');
  const strang = schaetze({ kind: 'strand', profil: 'bauer', tiefe: 'regular' });
  const viele = Array.from({ length: 6 }, () => chat());
  assert.equal(mod.lockFor(viele, chat()), 'ok', 'ohne Box-Abgleich keine Zahl-Grenze');
  const luft = { echtGb: 3, hostFreiGb: 15 }, eng = { echtGb: 11.5, hostFreiGb: 10 };
  assert.equal(mod.lockFor(viele, chat(), { neu: strang, stand: luft }), 'ok', 'passt in die Box');
  assert.equal(mod.lockFor([chat()], chat(), { neu: strang, stand: eng }), 'chat-busy', '11,5 + 0,8 GB > 12 GB');
  assert.match(mod.lockGrund, /passt gerade nicht in die Box/);
  assert.equal(mod.lockFor([chat(true)], chat(), { neu: strang, stand: eng }), 'ok', 'erster laufender Zug startet, wartende zählen nicht');
  // Eben gestartete Züge zählen mit ihrer Schätzung, bis der Speicherstand sie zeigt.
  const jetzt = Date.now();
  const mittel = { echtGb: 9, hostFreiGb: 15 };
  const frisch = [1, 2, 3].map(() => ({ ...chat(), schaetzung: strang, t0: jetzt - 30_000 }));
  assert.equal(mod.lockFor(frisch, chat(), { neu: strang, stand: mittel, now: jetzt }), 'chat-busy', '9 + 3×0,8 + 0,8 GB > 12 GB');
  assert.equal(mod.lockFor(frisch, chat(), { neu: strang, stand: mittel, now: jetzt + 5 * 60_000 }), 'ok', 'nach 3 min zählt der echte Stand');
  assert.equal(mod.lockFor([board(), board()], board()), 'board-full');
});

test('Audit 05.11. (3): jcode-Stränge (0,15 GB) haben einen eigenen Topf — volle Box hält sie nicht auf, voller Topf schon; die Zahl-Grenze gilt nur für Claude', async () => {
  const { schaetze, jcodeTopfGb } = await import('../src/schaetzung.ts');
  const strang = schaetze({ kind: 'strand', profil: 'bauer' }), jc = schaetze({ kind: 'strand', jcode: true });
  assert.equal(jc.speicherGb, 0.15); assert.equal(jc.topf, 'jcode');
  const voll = { echtGb: 11.9, hostFreiGb: 10 };
  const claude = [chat(), chat()];
  assert.equal(mod.lockFor(claude, chat(), { neu: strang, stand: voll }), 'chat-busy', 'Claude wartet');
  assert.equal(mod.lockFor(claude, chat(), { neu: jc, stand: voll }), 'ok', 'jcode startet trotzdem');
  const n = Math.floor(jcodeTopfGb() / 0.15);
  const jcs = Array.from({ length: n }, () => ({ ...chat(), schaetzung: jc }));
  assert.equal(mod.lockFor(jcs, chat(), { neu: jc, stand: voll }), 'chat-busy', 'Topf voll');
  assert.match(mod.lockGrund, /jcode-Topf voll/);
  assert.equal(mod.lockFor(jcs, chat(), { neu: strang, stand: { echtGb: 11, hostFreiGb: 12 } }), 'ok', 'jcode-Stränge zählen nicht als laufende Claude-Züge (erster Claude-Zug startet)');
  assert.equal(mod.lockFor([...claude], chat(), { neu: jc, stand: { echtGb: 4, hostFreiGb: 3.1 } }), 'chat-busy', 'Host-Boden gilt auch für jcode');
  process.env.BRIDGE_MAX_PARALLEL_CHATS = '2';
  try {
    assert.equal(mod.lockFor(claude, chat(), { neu: jc, stand: voll }), 'ok', 'Zahl-Grenze nur für Claude');
    assert.equal(mod.lockFor(claude, chat(), { neu: strang, stand: null }), 'chat-busy');
  } finally { delete process.env.BRIDGE_MAX_PARALLEL_CHATS; }
});

test('Audit 05.11. (3): Live-Start setzt keine Zahl-Grenze mehr (scripts/start.sh)', () => {
  const sh = readFileSync(join(import.meta.dirname, '..', '..', 'scripts', 'start.sh'), 'utf8');
  assert.doesNotMatch(sh, /BRIDGE_MAX_PARALLEL_CHATS="\$\{BRIDGE_MAX_PARALLEL_CHATS-\d/);
});

test('Reibung #3: Drain zählt mit `seit` nur Züge, die vorher begonnen haben; Wartende auf „ja“ nie', () => {
  const ls = [{ pending: null, t0: 100 }, { pending: null, t0: 300, leit: true }, { pending: {}, t0: 50 }, { pending: null, t0: 500 }];
  assert.deepEqual(mod.drainZahlen(ls), { drainLaufend: 3, drainOhneLeit: 2 });
  assert.deepEqual(mod.drainZahlen(ls, 400), { drainLaufend: 2, drainOhneLeit: 1 }, 'der Zug ab 500 startete während des Wartens');
  assert.equal(mod.stats(1).drainLaufend, 0);
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

test('Leerlauf: wartende Sitzungen nach BRIDGE_IDLE_REAP_S (Vorgabe 15 min) beenden, laufende nie; 0 = aus', () => {
  delete process.env.BRIDGE_IDLE_REAP_S;
  assert.equal(mod.idleReapMs(), 900_000);
  const now = 10_000_000;
  const a = { pending: { since: now - 900_000 } }, b = { pending: { since: now - 60_000 } }, c = { pending: null }, d = { pending: {} };
  assert.deepEqual(mod.idleToReap([a, b, c, d], now), [a], 'nur die seit ≥ 15 min wartende; laufende und ohne Zeitstempel nicht');
  process.env.BRIDGE_IDLE_REAP_S = '0';
  try { assert.deepEqual(mod.idleToReap([a, b], now), [], '0 = aus'); } finally { delete process.env.BRIDGE_IDLE_REAP_S; }
  process.env.BRIDGE_IDLE_REAP_S = '30';
  try { assert.deepEqual(mod.idleToReap([a, b], now), [a, b]); } finally { delete process.env.BRIDGE_IDLE_REAP_S; }
  assert.equal(mod.reapIdle(now), 0, 'ohne Sitzungen nichts zu tun');
});

test('S0: guardFor — Pilot (geteilte Konfiguration) nicht strict, eigene Konfiguration strict; BRIDGE_PATH_GUARD=off', () => {
  const g = mod.guardFor('u1', '/tmp/x', null)!;
  assert.equal(g.strict, false);
  assert.ok(g.ownScratch.endsWith('/scratch/u1'));
  assert.equal(mod.guardFor('u2', '/tmp/x', '/h/u2')!.strict, true);
  process.env.BRIDGE_PATH_GUARD = 'off';
  try { assert.equal(mod.guardFor('u1', '/tmp/x', null), undefined); } finally { delete process.env.BRIDGE_PATH_GUARD; }
});
