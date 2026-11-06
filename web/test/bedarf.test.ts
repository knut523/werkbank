// Bedarfskanal (Knut 06.11.: „Gib den Strängen, was sie brauchen — oder sie danach fragen können.“): Prüfung der Meldung und
// Text der Antwort an den Strang. Ende-zu-Ende (Meldung → Hauptchat → 2.0 → Antwort an den Strang) in leitstand.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bedarfPruefen, bedarfAntwortText, BEDARF_ARTEN, zugangBis } from '../server/bedarf.ts';

test('Bedarf: feste Arten, Text Pflicht und begrenzt, Pfad nur bei zugang (absolut)', () => {
  assert.ok(BEDARF_ARTEN.includes('github') && BEDARF_ARTEN.includes('merge') && BEDARF_ARTEN.includes('zugang'));
  assert.deepEqual(bedarfPruefen({ art: 'github', text: 'Push von feat/x, Gate grün auf abc1234' }), { art: 'github', text: 'Push von feat/x, Gate grün auf abc1234', pfad: null });
  assert.match((bedarfPruefen({ art: 'push', text: 'x' }) as any).fehler, /art/);
  assert.match((bedarfPruefen({ art: 'datei', text: ' ' }) as any).fehler, /Text/);
  assert.match((bedarfPruefen({ art: 'datei', text: 'x'.repeat(1001) }) as any).fehler, /1000/);
  assert.match((bedarfPruefen({ art: 'zugang', text: 'olaf-admin committen' }) as any).fehler, /Ordner/);
  assert.match((bedarfPruefen({ art: 'zugang', text: 'x', pfad: 'relativ/x' }) as any).fehler, /absolut/);
  assert.equal((bedarfPruefen({ art: 'zugang', text: 'x', pfad: '/home/knut/work/olaf-admin' }) as any).pfad, '/home/knut/work/olaf-admin');
  assert.equal((bedarfPruefen({ art: 'datei', text: 'x', pfad: '/etc' }) as any).pfad, null, 'Pfad nur bei zugang');
});

test('Bedarf: Antworttext an den Strang — erteilt (mit Frist bei zugang), erledigt, abgelehnt; Notiz mit', () => {
  const b = { id: 'b-1', art: 'zugang', text: 'olaf-admin committen', pfad: '/w/olaf-admin' };
  const bis = zugangBis(240, Date.parse('2026-11-06T08:00:00Z'));
  assert.equal(bis.toISOString(), '2026-11-06T12:00:00.000Z');
  assert.match(bedarfAntwortText(b, 'erteilt', 'nur lokal', bis), /erteilt: Zugang zu \/w\/olaf-admin bis 13:00 .*nur lokal/);
  assert.match(bedarfAntwortText({ ...b, art: 'github', pfad: null }, 'erledigt', 'Kommentar steht: https://github.com/x', null), /erledigt.*Kommentar steht/);
  assert.match(bedarfAntwortText({ ...b, art: 'merge', pfad: null }, 'abgelehnt', 'erst Gate', null), /abgelehnt.*erst Gate/);
  assert.equal(zugangBis(99999, 0).getTime(), 24 * 3600_000, 'höchstens 24 h');
});
