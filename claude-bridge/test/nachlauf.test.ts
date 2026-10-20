// Nachlauf (Strang 9563d9ec, 19.10.: stundenlang „Zug läuft / Der Zug endet gerade“, orch send 409, obwohl das Ergebnis längst
// da war): nach dem Ergebnis ist die Eingabe zu; arbeitet die CLI weiter (Hintergrund-Aufgaben) oder endet ihr Strom nie (Prozess
// weg), beendet die Brücke den Zug nach BRIDGE_NACHLAUF_S — und eine neue Nachricht beendet den Nachlauf sofort statt 409.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const STATE = mkdtempSync(join(tmpdir(), 'bridge-nachlauf-'));
let mod: typeof import('../src/sessions.ts');
let mock: typeof import('../src/mock.ts');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  process.env.BRIDGE_STATE_DIR = STATE;
  process.env.BRIDGE_SKILLS = '';
  process.env.BRIDGE_NACHLAUF_S = '1';
  delete process.env.BRIDGE_PERMISSION_MODE;
  mod = await import('../src/sessions.ts');
  mock = await import('../src/mock.ts');
});

function sink() {
  let out = '';
  const closers: (() => void)[] = [];
  const s = {
    closed: false, done: false,
    write(t: string) { out += t; },
    finish() { s.done = true; s.closed = true; closers.splice(0).forEach((f) => f()); },
    onClose(f: () => void) { closers.push(f); },
    get out() { return out; },
  };
  return s;
}
const turn = (conv: string, prompt: string) => {
  const s = sink();
  const p = mod.handleTurn({ userId: 'u1', convId: conv, token: 'tok-a', prompt, history: '', sink: s as any, query: mock.mockQuery } as any);
  return { s, p };
};
const until = async (f: () => boolean, ms: number) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('Zeit abgelaufen'); await sleep(50); } };
const laeuft = (conv: string) => (mod.sessionsOf('u1') as any[]).find((x) => String(x.conv).endsWith(conv))?.running;

test('Nachlauf nach dem Ergebnis (Hintergrund-Aufgaben) endet nach der Grenze; danach nimmt der Chat wieder an', async () => {
  const conv = randomUUID();
  const t = turn(conv, 'mock-nachlauf 60000');
  await until(() => t.s.done, 15_000);
  assert.match(t.s.out, /arbeitet aber noch nach/, 'die Person erfährt, warum der Zug endet');
  const t2 = turn(conv, 'hallo');
  await until(() => t2.s.done, 10_000);
  assert.doesNotMatch(t2.s.out, /arbeitet noch an der vorigen Nachricht/);
});

test('Strom endet nie und überhört den Abbruch (Prozess weg): hartes Ende nach Grenze + 5 s, kein Dauer-„läuft“', async () => {
  const conv = randomUUID();
  const t = turn(conv, 'mock-zombie');
  await until(() => t.s.done, 20_000);
  assert.ok(!laeuft(conv), 'nicht mehr als laufend geführt');
  const t2 = turn(conv, 'hallo');
  await until(() => t2.s.done, 10_000);
  assert.doesNotMatch(t2.s.out, /arbeitet noch an der vorigen Nachricht/);
});

test('Neue Nachricht im Nachlauf beendet ihn sofort und läuft — statt „arbeitet noch“ (orch send 409)', async () => {
  process.env.BRIDGE_NACHLAUF_S = '60';
  try {
    const conv = randomUUID();
    const t = turn(conv, 'mock-nachlauf 60000');
    await until(() => /\(Mock\)|Mock/.test(t.s.out) || t.s.out.length > 0, 10_000);
    await sleep(1500);   // Ergebnis ist da, Nachlauf läuft
    const t0 = Date.now();
    const t2 = turn(conv, 'hallo');
    await until(() => t2.s.done, 15_000);
    assert.doesNotMatch(t2.s.out, /arbeitet noch an der vorigen Nachricht/);
    assert.ok(Date.now() - t0 < 12_000, 'kein Warten bis zur Grenze');
  } finally { process.env.BRIDGE_NACHLAUF_S = '1'; }
});
