// Release 32, Nachtrag C + D: alte Deckel-Fragen stehen als EIN Eintrag (ein Knopf), Fragen erledigter Stränge schließen sich selbst — mit Grund.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baueInbox, inboxZahl, type InboxQuellen } from '../server/inbox.ts';
import { brauchtSumme } from '../server/entscheidungsseite.ts';
import { schliessGrund } from '../server/fragenaufraeumen.ts';

const leer: InboxQuellen = { karten: [], lose: [], vault: [], pflege: 0, schlange: [], kopfFehler: [] };
const now = Date.parse('2026-11-03T10:00:00Z');
const tage = (n: number) => new Date(now - n * 86400_000);
const deckel = (id: string, alt: number, o: Record<string, unknown> = {}) => ({ id, title: `Strang x: 30× automatisch fortgesetzt (${id})`, recommendation: 'Anhalten', options: [{ label: 'Fortsetzen' }, { label: 'Anhalten' }], createdAt: tage(alt), kind: 'auto-weiter', strand: { id: 's-old', title: 'Alter Strang' }, ...o });

test('Alte Deckel-Fragen (> 7 Tage, Strang läuft nicht mehr) sind EIN Sammel-Eintrag mit einem Knopf — die Zahl zählt ihn einmal', () => {
  const lose = [...Array.from({ length: 20 }, (_, i) => deckel(`q${i}`, 14 + (i % 6))), deckel('neu', 1),
    { id: 'echt', title: 'Welche Frist?', recommendation: null, options: [], createdAt: tage(1) }];
  const ib = baueInbox({ ...leer, lose: lose as any, karten: [{ id: 's-run', titel: 'Läuft', running: true, entscheidungen: [], rueckfragen: [deckel('lauf', 12, { strand: { id: 's-run', title: 'Läuft' } })], braucht: null, kannFreigeben: false, freigabe: null, github: [], statusAt: tage(0), chat: null, paket: null }] }, { now });
  const sammel = ib.eintraege.find((e) => e.id === 'altbestand-deckel')!;
  assert.ok(sammel, 'Sammel-Eintrag da');
  assert.equal((sammel.daten.eintraege as any[]).length, 20, 'genau die 20 alten; neue und die eines laufenden Strangs bleiben einzeln');
  assert.match(sammel.frage, /20 alte Deckel-Fragen/);
  assert.ok(ib.eintraege.some((e) => e.id === 'q-neu' || e.daten.qid === 'neu'), 'die neue bleibt');
  assert.ok(ib.eintraege.some((e) => e.daten.qid === 'lauf'), 'Deckel eines laufenden Strangs bleibt');
  assert.ok(!ib.eintraege.some((e) => e.daten.qid === 'q3'), 'die alten stehen nicht noch einzeln da');
  const eintrage = ib.eintraege.filter((e) => e.art === 'rueckfrage').length;
  assert.equal(inboxZahl(ib.eintraege), eintrage + 1, '20 Fragen zählen als 1');
  assert.equal(brauchtSumme(ib.eintraege, now).gesamt, inboxZahl(ib.eintraege));
});

test('Hauptchat-Deckel ohne Strang (Weckdeckel/„30× fortgesetzt“) gilt nach 7 Tagen auch als alt', () => {
  const ib = baueInbox({ ...leer, lose: [{ id: 'h1', title: 'Hauptchat hält an: 30× automatisch fortgesetzt', createdAt: tage(10), kind: 'leitstand-weiter', recommendation: 'Fortsetzen', options: [{ label: 'Fortsetzen' }] } as any] }, { now });
  assert.equal((ib.eintraege.find((e) => e.id === 'altbestand-deckel')?.daten.eintraege as any[])?.length, 1);
});

test('Fragen erledigter Stränge schließen sich selbst — mit Grund; laufende und Deckel/Pakete nie', () => {
  const q = (o: Record<string, unknown> = {}) => ({ kind: 'frage', createdAt: tage(2), strand: { id: 's1' }, paket: null, ...o }) as any;
  assert.match(schliessGrund(q(), { zustand: 'erledigt' }, now)!, /abgeschlossen|archiviert/);
  assert.match(schliessGrund(q(), { knutReviewedAt: tage(1) }, now)!, /geprüft/);
  assert.match(schliessGrund(q(), null, now)!, /gibt es nicht mehr/);
  assert.match(schliessGrund(q(), { startError: 'x' }, now)!, /nie gestartet/);
  assert.equal(schliessGrund(q(), { zustand: 'laeuft' }, now), null, 'läuft → bleibt');
  assert.equal(schliessGrund(q(), { zustand: 'wartet' }, now), null, 'wartet auf dich → bleibt');
  assert.equal(schliessGrund(q({ kind: 'auto-weiter' }), { zustand: 'erledigt' }, now), null, 'Deckel-Fragen entscheidet nur Knut (Sammel-Knopf)');
  assert.equal(schliessGrund(q({ paket: { id: 'p1' } }), { zustand: 'erledigt' }, now), null, 'Fragenpaket schließt über sein Paket');
  assert.equal(schliessGrund(q({ strand: null }), null, now), null, 'ohne Strang: nichts zu prüfen');
});
