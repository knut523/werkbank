// Bedarfskanal (Knut 06.11.: „Gib den Strängen, was sie brauchen — oder sie danach fragen können.“): Prüfung der Meldung und
// Text der Antwort an den Strang. Ende-zu-Ende (Meldung → Hauptchat → 2.0 → Antwort an den Strang) in leitstand.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bedarfPruefen, bedarfAntwortText, bedarfAntworten, BEDARF_ARTEN, zugangBis } from '../server/bedarf.ts';

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

// Ersatz für die Mongo-Sammlung (nur, was bedarfAntworten braucht).
function sammlung(docs: any[]) {
  const passt = (d: any, q: any) => Object.entries(q).every(([k, v]) => d[k] === v);
  return {
    docs,
    findOne: async (q: any) => docs.find((d) => passt(d, q)) ?? null,
    updateOne: async (q: any, u: any) => { const d = docs.find((x) => passt(x, q)); if (!d) return { modifiedCount: 0 }; Object.assign(d, u.$set ?? {}); for (const k of Object.keys(u.$unset ?? {})) delete d[k]; return { modifiedCount: 1 }; },
  };
}
const U = { id: 'k' } as any;

test('Gegenprüfung 06.11.: Brücke weg beim Erteilen → Bedarf bleibt offen (Wiederholen geht); Nachricht scheitert → wieder offen', async () => {
  const col = sammlung([{ _id: 'b-00000001', userId: 'k', art: 'zugang', text: 'x', pfad: '/w/a', strand: { id: 's1' }, status: 'offen' }]);
  const nein = { senden: async () => {}, freigabe: async () => { throw Object.assign(new Error('Brücke: weg'), { status: 502 }); }, col: () => col as any };
  await assert.rejects(bedarfAntworten(U, 'b-00000001', { antwort: 'erteilt', notiz: '' }, nein), /Brücke/);
  assert.equal(col.docs[0].status, 'offen', 'nicht „erteilt“ ohne Freigabe');
  const gesendet: string[] = [];
  const ja = { senden: async (_u: any, _s: string, t: string) => { gesendet.push(t); }, freigabe: async () => '/real/a', col: () => col as any };
  const r = await bedarfAntworten(U, 'b-00000001', { antwort: 'erteilt', notiz: '', dauerMin: 60 }, ja);
  assert.equal(r.status, 'erteilt'); assert.match(gesendet[0], /Zugang zu \/real\/a/, 'echter Pfad aus der Brücke');
  // Nachricht scheitert → zurück auf offen
  const col2 = sammlung([{ _id: 'b-00000002', userId: 'k', art: 'github', text: 'x', pfad: null, strand: { id: 's1' }, status: 'offen' }]);
  await assert.rejects(bedarfAntworten(U, 'b-00000002', { antwort: 'erledigt', notiz: 'ok' }, { senden: async () => { throw new Error('LibreChat weg'); }, freigabe: async () => '', col: () => col2 as any }), /LibreChat/);
  assert.equal(col2.docs[0].status, 'offen');
});

test('Gegenprüfung 06.11.: „Erteilen“ nur für Zugang und Entscheidung — sonst Erledigt (selbst getan) oder Ablehnen', async () => {
  const col = sammlung([{ _id: 'b-00000003', userId: 'k', art: 'recht', text: 'npm install', pfad: null, strand: { id: 's1' }, status: 'offen' }]);
  await assert.rejects(bedarfAntworten(U, 'b-00000003', { antwort: 'erteilt', notiz: '' }, { senden: async () => {}, freigabe: async () => '', col: () => col as any }), /Erteilen gibt es nur/);
  assert.equal(col.docs[0].status, 'offen');
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
