// „Braucht dich“-Bündelung (R30b Teil A, S2): aus den Karten der Übersicht und den Fakten (beantwortet, Paket live,
// PR zu, neuerer Strang) wird die Sicht für den Hauptchat gebaut — je Strang ein Punkt, klassifiziert nach
// braucht.ts, (c) wird sofort geschlossen, (b) ist eine Aufgabe des Hauptchats (ohne Knöpfe), (a) eine echte Frage
// an Knut. Rein: alle Fakten kommen als Kontext herein (wie der Server sie sammelt), kein Netz, kein Git, keine Mongo.
// Die drei Beispiele der Hauptsitzung 02.11. sind die Fixtures (Berichte 269 und 272, Admin-UAT-Karte).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { braucheBraucht, kartEingabe, type BrauchtFakten } from '../server/brauchtab.ts';

// Beispiel 1 (Admin-UAT, e3ea4584): Knut hatte schon geantwortet — Karte stand trotzdem offen.
const uatKarte = kartEingabe({ strand: 'e3ea4584', titel: 'Admin-UAT', zeile: 'Liste mit Skill-Kopierpfad abarbeiten und D1–D3 entscheiden', lauf: 'admin-uat' });
// Beispiel 2 (Ticker-Fix, Paket 269, Commit 5899146): längst in Release 29 live.
const tickerKarte = kartEingabe({ strand: 'bb1', titel: 'Ticker-Fix', zeile: 'Push-Ok für den Zweig, D1 entscheiden, nach dem Deploy die CLI laufen lassen', paket: 269 });
// Beispiel 3 (tariff-app#193): Merge — technische Aktion, die der Hauptchat ausführen kann.
const mergeKarte = kartEingabe({ strand: 'cc1', titel: 'tariff-app 193', zeile: 'Merge muss in diesem Strang erlaubt werden oder der Hauptchat führt ihn aus', pr: 'WirStrom1/olaf-tariff-app#193' });

const ALLE_AKTIONEN = ['merge-im-worktree', 'push-nach-gate', 'skill-installieren', 'strang-neustarten', 'cli-lesen'];
const KEINE: BrauchtFakten = { beantwortet: [], paketeLive: [], prsZu: [], laeufeNeuer: [], aktionen: [] };
const fakten = (o: Partial<BrauchtFakten> = {}): BrauchtFakten => ({ ...KEINE, ...o });

test('Schalter aus (Vorgabe): nichts wird klassifiziert oder geschlossen — alles bleibt eine Frage an Knut', () => {
  const r = braucheBraucht([uatKarte, tickerKarte, mergeKarte], fakten(), { an: false });
  assert.deepEqual(r.punkte.map((p) => p.art), ['entscheidung', 'entscheidung', 'entscheidung']);
  assert.deepEqual(r.geschlossen, []);
  assert.equal(r.aktionen.length, 0);
  assert.ok(r.punkte.every((p) => p.antworten.length > 0), 'ohne Schalter bleiben die Knöpfe');
});

test('Beispiel 1 (Admin-UAT): Antwort steht im Log → (c) automatisch geschlossen, Frage verschwindet', () => {
  const r = braucheBraucht([uatKarte], fakten({ beantwortet: ['b-e3ea4584-1', 'D1', 'D2', 'D3'] }), { an: true });
  assert.equal(r.punkte.length, 0, 'keine offene Frage mehr');
  assert.equal(r.geschlossen.length, 1);
  assert.equal(r.geschlossen[0].strand, 'e3ea4584');
  assert.match(r.geschlossen[0].grund, /beantwortet/i);
  assert.equal(r.geschlossen[0].kennung.startsWith('b-e3ea4584-'), true);
});

test('Beispiel 2 (Ticker-Fix Paket 269): Paket im Live-Stand → (c) geschlossen, auch mit Push-Ok-Text', () => {
  const r = braucheBraucht([tickerKarte], fakten({ paketeLive: [269] }), { an: true });
  assert.equal(r.punkte.length, 0);
  const g = r.geschlossen[0];
  assert.match(g.grund, /Paket 269.*live/i);
  assert.ok(!/push/i.test(g.grund), 'der Push-Wunsch taucht nicht als Aufgabe auf — er ist mit live erledigt');
});

test('Beispiel 3 (tariff-app#193): Merge → (b) Aufgabe des Hauptchats, keine Knöpfe für Knut', () => {
  const r = braucheBraucht([mergeKarte], fakten({ aktionen: ALLE_AKTIONEN }), { an: true });
  assert.equal(r.punkte.length, 1);
  assert.equal(r.punkte[0].art, 'aktion');
  assert.equal(r.punkte[0].aktion, 'merge-im-worktree');
  assert.match(r.punkte[0].wasTun, /Hauptchat/i);
  assert.deepEqual(r.punkte[0].antworten, [], '(b): kein Knopf — nichts für Knut zu entscheiden (D2)');
  assert.deepEqual(r.geschlossen, [], '(b) wird nicht still geschlossen — der Strang erfährt die Aktion');
  assert.equal(r.aktionen.length, 1);
  assert.equal(r.aktionen[0].strand, 'cc1');
  // Ohne freigegebene Aktion bleibt es Knuts Entscheidung (D2: Freigabe-Weg).
  const r2 = braucheBraucht([mergeKarte], fakten(), { an: true });
  assert.equal(r2.punkte[0].art, 'entscheidung');
});

test('(a) echte Entscheidung: ein Satz „Was du tun musst“ + Knöpfe, kein Rohbericht', () => {
  const k = kartEingabe({ strand: 'dd1', titel: 'Verträge', zeile: 'Vertrag mit Rogue soll bis Freitag unterschrieben sein — zustimmen?' });
  const r = braucheBraucht([k], fakten(), { an: true });
  assert.equal(r.punkte.length, 1);
  const p = r.punkte[0];
  assert.equal(p.art, 'entscheidung');
  assert.ok(/Vertrag mit Rogue soll bis Freitag unterschrieben/.test(p.wasTun.replace(/\s+/g, ' ')), 'wasTun ist die Zeile, verständlich und ohne Rohbericht');
  assert.deepEqual(p.antworten, ['ja', 'nein', 'anders', 'spaeter']);
  assert.equal(p.strand, 'dd1');
  assert.match(p.frage, /Vertrag mit Rogue/);
});

test('Mehrere Stränge: gebündelt je Strang, (c) weg, dann (b), dann (a)', () => {
  const entschiedene = kartEingabe({ strand: 'ee1', titel: 'E', zeile: 'Paket 302 veröffentlichen — freigeben?' });
  const r = braucheBraucht([entschiedene, tickerKarte, mergeKarte, uatKarte], fakten({ paketeLive: [269], beantwortet: ['b-e3ea4584-1', 'D1', 'D2', 'D3'], aktionen: ['merge-im-worktree'] }), { an: true });
  assert.deepEqual(r.punkte.map((p) => [p.strand, p.art]), [['ee1', 'entscheidung'], ['cc1', 'aktion']]);
  assert.deepEqual(r.geschlossen.map((g) => g.strand).sort(), ['bb1', 'e3ea4584']);
  assert.equal(r.aktionen.length, 1);
  assert.equal(r.aktionen[0].strand, 'cc1');
});

test('Veraltet-Prüfungen einzeln: PR zu, neuerer Strang', () => {
  const r = braucheBraucht([mergeKarte], fakten({ aktionen: ALLE_AKTIONEN, prsZu: ['WirStrom1/olaf-tariff-app#193'] }), { an: true });
  assert.equal(r.geschlossen.length, 1, 'PR zu schlägt die Aktion');
  assert.match(r.geschlossen[0].grund, /gemergt|geschlossen/i);
  const r2 = braucheBraucht([uatKarte], fakten({ laeufeNeuer: ['admin-uat'] }), { an: true });
  assert.equal(r2.geschlossen.length, 1);
  assert.match(r2.geschlossen[0].grund, /neuerer/i);
});

test('Absturz-Sicherheit: kaputte Karte (leere Zeile) wird übersprungen, wirft nicht', () => {
  const leer = kartEingabe({ strand: 'ff1', titel: 'leer', zeile: '' });
  const r = braucheBraucht([leer], fakten(), { an: true });
  assert.deepEqual(r.punkte, []);
  assert.deepEqual(r.geschlossen, []);
});

// S5: die Klassifikation wirkt auf die Inbox-Einträge der Art „braucht“ (Zuordnung je Strang; Kennungen bleiben).
test('S5 wendeAufInbox: (c) verschwindet, (b) ohne Knöpfe mit „erledigt der Hauptchat“, (a) mit „Was du tun musst“', async () => {
  const { wendeAufInbox } = await import('../server/brauchtab.ts');
  const ein = (strand: string, frage: string) => ({ id: `b-${strand}-x`, art: 'braucht', frage, empfehlung: null, quelle: { text: 'Unter-Chat', strand, url: null, paket: null }, wartetSeit: null, blockiert: 1, antworten: ['ja', 'nein', 'anders', 'spaeter'], daten: { strand, seen: null } }) as any;
  const andere = { id: 'q-1', art: 'rueckfrage', frage: 'Q', antworten: ['ja'], daten: {} } as any;
  const k = kartEingabe({ strand: 'ee1', titel: 'E', zeile: 'Paket 302 veröffentlichen — freigeben?' });
  const r = braucheBraucht([k, tickerKarte, mergeKarte], fakten({ paketeLive: [269], aktionen: ['merge-im-worktree'] }), { an: true });
  const out = wendeAufInbox([ein('ee1', k.zeile), ein('bb1', tickerKarte.zeile), ein('cc1', mergeKarte.zeile), andere], r);
  assert.deepEqual(out.map((e: any) => e.id), ['b-ee1-x', 'b-cc1-x', 'q-1'], '(c) Ticker weg, andere Arten unberührt');
  const a = out[0], b = out[1];
  assert.equal(a.daten.klasse, 'entscheidung'); assert.match(a.frage, /Paket 302 veröffentlichen/); assert.deepEqual(a.antworten, ['ja', 'nein', 'anders', 'spaeter']);
  assert.equal(b.daten.klasse, 'aktion'); assert.equal(b.daten.aktion, 'merge-im-worktree'); assert.deepEqual(b.antworten, []);
  assert.match(b.frage, /Hauptchat/); assert.equal(b.blockiert, 0, '(b) blockiert Knut nicht');
  assert.equal(out[2], andere);
  // Schalter aus (Ergebnis ohne Klassifikation): nichts ändert sich.
  const aus = braucheBraucht([k], fakten(), { an: false });
  const e0 = ein('ee1', k.zeile);
  assert.deepEqual(wendeAufInbox([e0], aus, { an: false }), [e0]);
});

test('S5 Zähler: (b)-Einträge zählen nicht als Entscheidung für Knut', async () => {
  const { inboxZahl } = await import('../server/inbox.ts');
  const e = (klasse?: string) => ({ id: 'b-x', art: 'braucht', frage: 'f', empfehlung: null, quelle: { text: '', strand: 'x', url: null, paket: null }, wartetSeit: null, blockiert: 0, antworten: [], daten: { strand: 'x', klasse } }) as any;
  assert.equal(inboxZahl([e(), e('entscheidung'), e('aktion')]), 2);
});
