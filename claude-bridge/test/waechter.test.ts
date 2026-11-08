import { test } from 'node:test';
import assert from 'node:assert/strict';
import { waechterSchritt, starteWaechter, waechterZustand, type WaechterZustand } from '../src/waechter.ts';
import { starte, liste } from '../src/prozesse.ts';

const cfg = { gnadeMs: 60_000, leerlaufMs: 600_000 };
const e = (o: any = {}) => ({ id: 'p1', pid: 1, start: '1', besitzer: 'u:s1', art: 'bauer', cmd: 'x', startedAt: 0, fristAt: 1000, zuletztAktiv: 0, ...o });
const tot = (pid: number) => { try { process.kill(pid, 0); return false; } catch (x: any) { return x.code === 'ESRCH'; } };
const warte = async (f: () => boolean, ms = 8000) => { for (let t = 0; t < ms && !f(); t += 50) await new Promise((r) => setTimeout(r, 50)); return f(); };

test('Frist überschritten: Check-in genau einmal; + Gnade: beenden genau einmal', () => {
  const z: WaechterZustand = new Map();
  const en = [e({ zuletztAktiv: 5000 })];
  assert.deepEqual(waechterSchritt(en, 900, cfg, z), []);
  const a = waechterSchritt(en, 6000, cfg, z);
  assert.equal(a.length, 1); assert.equal(a[0].art, 'checkin'); assert.match(a[0].text, /überfällig seit \d+ min/);
  assert.deepEqual(waechterSchritt(en, 7000, cfg, z), []);
  const b = waechterSchritt(en, 1000 + 60_000 + 1, cfg, z);
  assert.deepEqual(b.map((x) => x.art), ['beenden']);
  assert.deepEqual(waechterSchritt(en, 200_000, cfg, z), []);
});

test('Leerlauf: Check-in "still seit", einmal, wieder scharf nach Aktivität; ohne Frist nur diese Regel', () => {
  const z: WaechterZustand = new Map();
  const en = [e({ fristAt: null, zuletztAktiv: 0 })];
  assert.deepEqual(waechterSchritt(en, 599_000, cfg, z), []);
  const a = waechterSchritt(en, 601_000, cfg, z);
  assert.equal(a.length, 1); assert.match(a[0].text, /still seit 10 min/);
  assert.deepEqual(waechterSchritt(en, 700_000, cfg, z), []);
  en[0].zuletztAktiv = 710_000;
  assert.deepEqual(waechterSchritt(en, 720_000, cfg, z), []);
  assert.equal(waechterSchritt(en, 1_311_000, cfg, z).length, 1);
});

test('Zustand von verschwundenen Einträgen wird verworfen', () => {
  const z: WaechterZustand = new Map();
  waechterSchritt([e()], 6000, cfg, z);
  assert.equal(z.size, 1);
  waechterSchritt([], 7000, cfg, z);
  assert.equal(z.size, 0);
});

test('echter Prozess: Frist 100 ms, kleiner Takt/Gnade → Gruppe tot, Eintrag weg', async () => {
  const { id, kind } = starte('sh', ['-c', 'sleep 600 & wait'], { besitzer: 'wtest:s', art: 'test', fristMs: 100 });
  const pid = kind.pid!;
  const meldungen: string[] = [];
  const stop = starteWaechter({ takt: 50, gnadeMs: 150, leerlaufMs: 600_000, melde: (_b, t) => { meldungen.push(t); } });
  try {
    assert.ok(await warte(() => tot(pid) && !liste().some((x) => x.id === id)), 'Gruppe tot und Eintrag weg');
    assert.equal(meldungen.filter((t) => /überfällig/.test(t)).length, 1);
    assert.ok(Array.isArray(waechterZustand()));
  } finally { stop(); }
});
