// F7 (Knut 19.10.): Schätzung vor dem Start — eigene Läufe statt Vorgabe, Hinweis bei voller Box und über dem Budget, keine Zahl-Grenze.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startSchaetzung, laufMediane } from '../server/startschaetzung.ts';

test('Vorgabe ohne eigene Läufe; eigene Mediane, sobald da; Hinweise für Box und Budget', () => {
  const v = startSchaetzung({ tiefe: 'quick', profil: 'bauer' });
  assert.equal(v.quelle, 'Vorgabe'); assert.match(v.text, /~10 min.*\(Vorgabe\)/); assert.deepEqual(v.hinweise, []);
  const e = startSchaetzung({ tiefe: 'regular', profil: 'bauer', dauerMs: 30 * 60_000, tokens: 800_000 });
  assert.equal(e.schaetzung.dauerMin, 30); assert.equal(e.schaetzung.tokens, 800_000); assert.match(e.text, /aus deinen letzten Läufen/);
  const voll = startSchaetzung({ tiefe: 'regular', profil: 'bauer', box: { echtGb: 8.5, hostFreiGb: 10 } });
  assert.match(voll.hinweise[0], /wartet in der Schlange/);
  const budget = startSchaetzung({ tiefe: 'deep', profil: 'bauer', budget: 500_000 });
  assert.match(budget.hinweise.join(' '), /über dem Budget/);
});

test('laufMediane: Dauer und Tokens je Tiefe ab drei erledigten Läufen (Worker zählen zum Strang)', async () => {
  const t0 = Date.parse('2026-10-10T08:00:00Z');
  const runs = [1, 2, 3].map((i) => ({ tiefe: 'quick', conv: `c${i}`, startedAt: new Date(t0), doneAt: new Date(t0 + i * 10 * 60_000) }));
  const zs = [
    { conv: 'c1', art: 'strang', input: 100_000, output: 10_000, cacheRead: 0 },
    { conv: 'c2', art: 'strang', input: 200_000, output: 0, cacheRead: 0 },
    { parent: 'u:c2', art: 'worker', input: 50_000, output: 0, cacheRead: 0 },
    { conv: 'c3', art: 'strang', input: 400_000, output: 0, cacheRead: 100_000 },
  ];
  const cursor = (xs: any[]) => ({ sort: () => cursor(xs), limit: () => cursor(xs), project: () => cursor(xs), toArray: async () => xs });
  const m = await laufMediane({ runs: () => ({ find: () => cursor(runs) }), zugLog: () => ({ find: () => cursor(zs) }) }, 'u', t0 + 86400_000);
  assert.equal(m.quick.dauerMs, 20 * 60_000);
  assert.equal(m.quick.tokens, 250_000, 'Median aus 110 Tsd., 250 Tsd. (inkl. Worker), 300 Tsd. (ohne Cache-Lesen)');
  assert.equal(m.regular.dauerMs, null, 'zu wenige Läufe → Vorgabe');
});
