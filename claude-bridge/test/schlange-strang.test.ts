// Schlangen-Fehler in der Live-Brücke (06.11.2026: b65de461, 83021050, d71217f5, 518600a7): Ein Strang-Zug wartete in der
// Schlange; LibreChat räumt eine Antwort nach 20 min ohne Chunk ab (InMemoryJobStore, staleJobTimeout) — die geschlossene Senke
// beendete den Zug als „aborted“. Jetzt: Lebenszeichen in der Schlange; ein bewusstes Schließen (Stop) bricht weiterhin ab.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const STATE = mkdtempSync(join(tmpdir(), 'bridge-schlange-strang-'));
let mod: typeof import('../src/sessions.ts');
let mock: typeof import('../src/mock.ts');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  process.env.BRIDGE_STATE_DIR = STATE;
  process.env.BRIDGE_SKILLS = '';
  process.env.BRIDGE_MOCK = '1';   // kein echter Speicherstand: nur die Zahl-Grenze entscheidet
  process.env.BRIDGE_TURN_MAX_S = '2';   // Zug-Obergrenze klein: die Wartezeit darf nicht mitzählen (Pass B, 1)
  process.env.BRIDGE_TURN_IDLE_S = '2';   // Obergrenze = max(Obergrenze, Leerlauf)
  process.env.BRIDGE_QUEUE_LEBENSZEICHEN_S = '0.5';
  delete process.env.BRIDGE_PERMISSION_MODE;
  mod = await import('../src/sessions.ts');
  mock = await import('../src/mock.ts');
});

function sink() {
  let out = '';
  const closers: (() => void)[] = [];
  const s = {
    closed: false, done: false,
    write(t: string) { if (!s.closed) out += t; },
    finish() { if (s.closed) return; s.done = true; s.closed = true; closers.splice(0).forEach((f) => f()); },
    onClose(f: () => void) { if (s.closed) f(); else closers.push(f); },
    /** Client trennt (Stop in LibreChat). */
    trenne() { s.closed = true; closers.splice(0).forEach((f) => f()); },
    get out() { return out; },
  };
  return s;
}
const turn = (user: string, conv: string, prompt: string) => {
  const s = sink();
  const p = mod.handleTurn({ userId: user, convId: conv, token: 'tok-a', prompt, history: '', sink: s as any, query: mock.mockQuery, receivedAt: Date.now() } as any);
  return { s, p };
};
const until = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('Zeit abgelaufen'); await sleep(50); } };
const strang = (user: string) => { const c = randomUUID(); mod.registerOrchestration(user, c, STATE, 'strand'); return c; };
const zustand = (user: string, conv: string) => mod.orchStateOf(user).find((x) => x.conv === conv)!;
const mitGrenze = async (n: number, f: () => Promise<void>) => {
  process.env.BRIDGE_MAX_PARALLEL_CHATS = String(n);
  try { await f(); } finally { delete process.env.BRIDGE_MAX_PARALLEL_CHATS; }
};

test('Strang wartet: Lebenszeichen in die offene Senke (sonst räumt LibreChat ab), startet dann, Antwort in derselben Senke, ok', () => mitGrenze(1, async () => {
  const a = turn('u1', strang('u1'), 'mock-dauer 1500');
  await until(() => a.s.out.length > 0, 5000);
  const conv = strang('u1');
  const b = turn('u1', conv, 'hallo');
  await until(() => /In der Schlange: Platz 1/.test(b.s.out), 5000);
  await until(() => /Wartet weiter: Platz 1 \(seit \d+ min\)/.test(b.s.out), 1500);
  await until(() => !!zustand('u1', conv).turn?.end, 10_000);
  assert.equal(zustand('u1', conv).turn?.outcome, 'ok');
  assert.match(b.s.out, /Mock/, 'die Antwort kommt in derselben Senke an');
  await a.p;
}));

test('Normaler Chat: Senke schließt während der Wartezeit → verlässt die Schlange, startet nicht (unverändert)', () => mitGrenze(1, async () => {
  const a = turn('u2', randomUUID(), 'mock-dauer 600');
  await until(() => a.s.out.length > 0, 5000);
  const conv = randomUUID();
  const b = turn('u2', conv, 'hallo');
  await until(() => /In der Schlange/.test(b.s.out), 5000);
  b.s.trenne();
  await b.p;
  await a.p;
  await sleep(300);
  assert.equal((mod.sessionsOf('u2') as any[]).find((x) => x.conv === conv)?.status ?? 'bereit', 'bereit');
  assert.ok(!mod.sessionsOf('u2').some((x: any) => x.conv === conv && x.resumable), 'kein Zug gelaufen');
}));

test('Bewusstes Beenden (Stop in LibreChat schließt die Senke): ein wartender Strang-Zug wird abgebrochen und startet nicht', () => mitGrenze(1, async () => {
  const a = turn('u3', strang('u3'), 'mock-dauer 800');
  await until(() => a.s.out.length > 0, 5000);
  const conv = strang('u3');
  const b = turn('u3', conv, 'hallo');
  await until(() => /In der Schlange/.test(b.s.out), 5000);
  b.s.trenne();
  await b.p;
  assert.equal(zustand('u3', conv).turn?.outcome, 'aborted');
  assert.ok(!zustand('u3', conv).queued);
  await a.p;
  await sleep(200);
  assert.ok(!zustand('u3', conv).running, 'startet auch nach dem Freiwerden nicht');
}));

test('5 gleichzeitige Stränge bei Grenze 4: einer wartet, alle enden ok, keiner busy/aborted', () => mitGrenze(4, async () => {
  const convs = Array.from({ length: 5 }, () => strang('u4'));
  const zuege = convs.map((c) => turn('u4', c, 'mock-dauer 500'));
  await until(() => zuege.some((z) => /In der Schlange/.test(z.s.out)), 5000);
  assert.equal(zuege.filter((z) => /In der Schlange/.test(z.s.out)).length, 1);
  await until(() => convs.every((c) => zustand('u4', c).turn?.end), 15_000);
  assert.deepEqual(convs.map((c) => zustand('u4', c).turn?.outcome), ['ok', 'ok', 'ok', 'ok', 'ok']);
}));

test('Pass B: die Wartezeit zählt nicht gegen die Zug-Obergrenze (sonst endet ein lang wartender Zug sofort mit timeout)', () => mitGrenze(1, async () => {
  const a = turn('u5', strang('u5'), 'mock-dauer 1500');
  await until(() => a.s.out.length > 0, 5000);
  const conv = strang('u5');
  const b = turn('u5', conv, 'mock-dauer 1000');   // 1,5 s warten + 1 s laufen > 2 s Obergrenze ab Eingang
  await until(() => /In der Schlange/.test(b.s.out), 5000);
  await a.p;
  await until(() => !!zustand('u5', conv).turn?.end, 10_000);
  assert.equal(zustand('u5', conv).turn?.outcome, 'ok');
}));
