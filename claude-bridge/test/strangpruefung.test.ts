import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ergebnisLesen, pruefSchleife, BAUER_REGELN, LINSEN, type SchleifenDeps } from '../src/strangpruefung.ts';

const KEINE = 'Alles geprüft.\nERGEBNIS: keine Befunde';
type Skript = (linse: string, runde: number) => { text: string; tests: string[] };
const mk = (skript: Skript, rot: (t: string[]) => string[], extra: Partial<SchleifenDeps> = {}) => {
  const fix: { log: string; runde: number }[] = [];
  const deps: SchleifenDeps = {
    pruefen: async (l, r) => skript(l, r),
    rotAufHead: async (t) => { const r = rot(t); return { rot: r, log: r.map((x) => `FAIL ${x}`).join('\n') }; },
    fixen: async (log, runde) => { fix.push({ log, runde }); },
    ...extra,
  };
  return { deps, fix };
};

test('(a) ergebnisLesen', () => {
  assert.deepEqual(ergebnisLesen('…\nERGEBNIS: keine Befunde'), { art: 'keine' });
  assert.deepEqual(ergebnisLesen('ERGEBNIS: 2 rote Tests'), { art: 'rot', n: 2 });
  assert.deepEqual(ergebnisLesen('ERGEBNIS: 1 roter Test'), { art: 'ohne' });
  assert.deepEqual(ergebnisLesen('ERGEBNIS: 1 rote Test'), { art: 'rot', n: 1 });
  assert.deepEqual(ergebnisLesen('nichts hier\nERGEBNIS: viele'), { art: 'ohne' });
  assert.deepEqual(ergebnisLesen('kein Ergebnis'), { art: 'ohne' });
  assert.deepEqual(ergebnisLesen('ERGEBNIS: 3 rote Tests\nspäter\nERGEBNIS: keine Befunde'), { art: 'keine' });
});

test('Konstanten: Linsen und Bauer-Regeln', () => {
  assert.equal(LINSEN.length, 2);
  for (const l of LINSEN) { assert.match(l, /ERGEBNIS: keine Befunde/); assert.match(l, /ERGEBNIS: <n> rote Tests/); }
  assert.match(BAUER_REGELN, /STREIT: <test>: <grund>/);
});

test('(b) beide Linsen starten in derselben Runde parallel', async () => {
  const log: string[] = [];
  let frei!: () => void;
  const tor = new Promise<void>((r) => { frei = r; });
  const { deps } = mk(() => ({ text: KEINE, tests: [] }), () => [], {
    pruefen: async (l) => { log.push('start ' + l); if (log.length === 2) frei(); await tor; log.push('ende ' + l); return { text: KEINE, tests: [] }; },
  });
  await pruefSchleife(deps);
  assert.deepEqual(log.slice(0, 2).map((x) => x.split(' ')[0]), ['start', 'start']);
  assert.deepEqual(log.slice(0, 2).map((x) => x.slice(6)).sort(), [...LINSEN].sort());
});

test('(c) grüner Test auf HEAD zählt nicht', async () => {
  const { deps, fix } = mk(() => ({ text: 'ERGEBNIS: 1 rote Tests', tests: ['t/a.test.ts'] }), () => []);
  const r = await pruefSchleife(deps);
  assert.equal(r.ende, 'konvergiert');
  assert.equal(r.runden, 1);
  assert.deepEqual(r.roteTests, []);
  assert.equal(fix.length, 0);
});

test('(d) zwei rote → ein Fix mit Log → Runde 2 keine → konvergiert', async () => {
  const { deps, fix } = mk(
    (l, r) => r === 1 ? { text: 'ERGEBNIS: 1 rote Tests', tests: [LINSEN[0] === l ? 'a' : 'b'] } : { text: KEINE, tests: [] },
    (t) => t,
  );
  let n = 0;
  deps.rotAufHead = async (t) => (n++ === 0 ? { rot: t, log: t.map((x) => `FAIL ${x}`).join('\n') } : { rot: [], log: '' });
  const r = await pruefSchleife(deps);
  assert.equal(r.ende, 'konvergiert');
  assert.equal(r.runden, 2);
  assert.deepEqual([...r.roteTests].sort(), ['a', 'b']);
  assert.equal(fix.length, 1);
  assert.equal(fix[0].runde, 1);
  assert.match(fix[0].log, /FAIL a/);
  assert.match(fix[0].log, /FAIL b/);
});

test('(d2) Fix wirkt nicht: roter Test bleibt offen, kein konvergiert', async () => {
  const { deps, fix } = mk((_l, r) => ({ text: r === 1 ? 'ERGEBNIS: 1 rote Tests' : KEINE, tests: r === 1 && _l === LINSEN[0] ? ['A'] : [] }), (t) => t);
  const aufrufe: string[][] = [];
  const r0 = deps.rotAufHead;
  deps.rotAufHead = async (t) => { aufrufe.push(t); return r0(t); };
  const r = await pruefSchleife(deps);
  assert.notEqual(r.ende, 'konvergiert');
  assert.equal(r.ende, 'deckel');
  assert.deepEqual(r.offen, ['A']);
  assert.deepEqual(r.roteTests, ['A']);
  assert.deepEqual(aufrufe[1], ['A']);
  assert.equal(fix.length, 3);
});

test('(d3) Fix wirkt: A in Runde 2 grün → konvergiert, offen leer', async () => {
  let n = 0;
  const { deps } = mk((l, r) => ({ text: r === 1 ? 'ERGEBNIS: 1 rote Tests' : KEINE, tests: r === 1 && l === LINSEN[0] ? ['A'] : [] }), () => []);
  const aufrufe: string[][] = [];
  deps.rotAufHead = async (t) => { aufrufe.push(t); return n++ === 0 ? { rot: t, log: 'FAIL A' } : { rot: [], log: '' }; };
  const r = await pruefSchleife(deps);
  assert.equal(r.ende, 'konvergiert');
  assert.equal(r.runden, 2);
  assert.deepEqual(r.offen, []);
  assert.deepEqual(r.roteTests, ['A']);
  assert.deepEqual(aufrufe[1], ['A']);
});

test('(e) jede Runde neuer roter Test → Deckel nach 4 Runden', async () => {
  const { deps } = mk((_l, r) => ({ text: 'ERGEBNIS: 1 rote Tests', tests: [`t${r}`] }), (t) => t);
  const r = await pruefSchleife(deps);
  assert.equal(r.ende, 'deckel');
  assert.equal(r.runden, 4);
  assert.equal(r.roteTests.length, 4);
  const k = mk((_l, rr) => ({ text: 'ERGEBNIS: 1 rote Tests', tests: [`t${rr}`] }), (t) => t);
  assert.equal((await pruefSchleife(k.deps, 2)).runden, 2);
});

test('(f) Linse ohne ERGEBNIS ist nie sauber', async () => {
  const a = mk((l) => l === LINSEN[0] ? { text: 'plaudert nur', tests: [] } : { text: KEINE, tests: [] }, () => []);
  const r = await pruefSchleife(a.deps);
  assert.equal(r.ende, 'pruefer-ohne-ergebnis');
  assert.equal(r.runden, 1);
  // andere Linse liefert rot → weiter fixen
  const b = mk((l, rd) => l === LINSEN[0] ? { text: 'plaudert', tests: [] } : rd === 1 ? { text: 'ERGEBNIS: 1 rote Tests', tests: ['x'] } : { text: KEINE, tests: [] }, (t) => t, {});
  let nr = 0;
  b.deps.rotAufHead = async (t) => ({ rot: nr++ === 0 ? t : [], log: 'FAIL' });
  const r2 = await pruefSchleife(b.deps);
  assert.equal(b.fix.length, 1);
  assert.equal(r2.ende, 'pruefer-ohne-ergebnis');
  assert.equal(r2.runden, 2);
  assert.deepEqual(r2.roteTests, ['x']);
});

test('(g) Phasenzeiten mit injizierter Uhr', async () => {
  let t = 0;
  const jetzt = () => t;
  const { deps } = mk((_l, r) => ({ text: r === 1 ? 'ERGEBNIS: 1 rote Tests' : KEINE, tests: r === 1 ? ['a'] : [] }), (x) => x, {
    jetzt,
    pruefen: async (_l, r) => { t += 10; return { text: r === 1 ? 'ERGEBNIS: 1 rote Tests' : KEINE, tests: r === 1 ? ['a'] : [] }; },
    rotAufHead: async (x) => { t += 3; return { rot: t === 23 ? x : [], log: 'FAIL' }; },
    fixen: async () => { t += 7; },
  });
  const r = await pruefSchleife(deps);
  assert.deepEqual(r.phasen, [
    { runde: 1, testMs: 3, pruefMs: 20, fixMs: 7 },
    { runde: 2, testMs: 3, pruefMs: 20, fixMs: 0 },
  ]);
});
