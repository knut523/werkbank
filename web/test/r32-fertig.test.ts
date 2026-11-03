// Release 32, Befund 6: „Heute fertig“ mit Ergebnis-Satz und Link; ein Strang nur einmal; was gestern fertig wurde, steht nicht dabei.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fertigHeute } from '../server/lage.ts';

const seit = '2026-11-03T05:00:00.000Z';
const k = (id: string, o: Record<string, unknown> = {}) => ({ id, titel: `Ergebnis ${id}`, strangTitel: `Strang ${id}`, thema: 'Bot', ampel: 'review', running: false, wartet: false, eta: null, statusAt: '2026-11-03T08:00:00.000Z', chat: `https://chat/${id}`, links: [{ art: 'bericht', label: 'Bericht', url: `#/leitstand?bericht=${id}` }], ...o }) as any;

test('Heute fertig: Karten seit heute früh mit Ergebnis-Satz und Bericht-Link, neueste zuerst', () => {
  const f = fertigHeute([k('a'), k('b', { statusAt: '2026-11-03T09:00:00.000Z', ampel: 'push' }), k('alt', { statusAt: '2026-11-02T20:00:00.000Z' }), k('lauf', { running: true, ampel: 'laeuft' }), k('blk', { ampel: 'blockiert' })], [], seit);
  assert.deepEqual(f.map((x) => x.id), ['b', 'a']);
  assert.equal(f[0].satz, 'Ergebnis b'); assert.equal(f[0].link, '#/leitstand?bericht=b');
});

test('Heute fertig: heute von dir Geprüftes kommt dazu, aber nicht doppelt zu seiner Karte', () => {
  const f = fertigHeute([k('a')], [{ id: 'a', titel: 'Strang a', at: '2026-11-03T10:00:00.000Z', chat: null }, { id: 'c', titel: 'Strang c', at: '2026-11-03T07:00:00.000Z', chat: 'https://chat/c' }, { id: 'x', titel: 'gestern', at: '2026-11-02T10:00:00.000Z', chat: null }], seit);
  assert.deepEqual(f.map((x) => `${x.id}:${x.ampel}`).sort(), ['a:review', 'c:geprüft']);
});
