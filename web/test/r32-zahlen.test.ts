// Release 32, Befunde 8 + 9: PR-Zahl zählt offene, Roadmap-Zeilen ohne Präfix und ohne doppelte Spec.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { titelKurz, prKopf, prIstOffen, topicBuckets } from '../src/buckets.ts';

test('PR-Reiter: offene PRs zählen (27), nicht alle Einträge (249); Konflikte und „wartet auf dich“ in der Kopfzeile', () => {
  const live = (o: any = {}) => ({ live: { mergeable: 'MERGEABLE', turn: { who: 'Christoph Bauer' }, ...o }, review: 'offen' });
  const prs = [...Array.from({ length: 5 }, () => live()), live({ mergeable: 'CONFLICTING' }), live({ turn: { who: 'Knut Peters' } }), ...Array.from({ length: 20 }, () => ({ review: 'nicht mehr offen' })), { review: 'gemergt' }];
  const k = prKopf(prs, ['knut']);
  assert.deepEqual(k, { offen: 7, erledigt: 21, konflikt: 1, wartenAufDich: 1 });
  assert.equal(prIstOffen({ review: 'nur Vault' }), true);
  assert.equal(prIstOffen({ review: 'gemergt' }), false);
});

test('Roadmap: „olaf — Spec: …“ wird gekürzt, andere Titel bleiben', () => {
  assert.equal(titelKurz('olaf — Spec: B2B-Strecke und Gewerbe-Grenze'), 'B2B-Strecke und Gewerbe-Grenze');
  assert.equal(titelKurz('olaf — Roadmap: offene Fragen'), 'offene Fragen');
  assert.equal(titelKurz('Tarifrechner Rundung'), 'Tarifrechner Rundung');
  assert.equal(titelKurz(null), '');
});

test('Roadmap-Überblick: dieselbe Spec nur einmal („2 Fragen“), Zähler nennt Fragen und Specs getrennt', () => {
  const d = (path: string, n: number) => Array.from({ length: n }, (_, i) => ({ path, topic: 'Bot', title: `T ${path}`, question: `F${i}` }));
  const rows = topicBuckets([{ name: 'Bot', states: {} }], [...d('a.md', 2), ...d('b.md', 1), ...d('c.md', 1)]);
  assert.equal(rows[0].waiting.count, 4); assert.equal(rows[0].waiting.specs, 3);
  assert.deepEqual(rows[0].waiting.items.map((x) => [x.path, x.n]), [['a.md', 2], ['b.md', 1]]);
});
