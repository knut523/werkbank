// Entscheidungen nach Wichtigkeit (Knut 17.10.2026): feste Einstufung, „wichtig“ oben und offen, „normal“ nach 24 h angenommen,
// nie automatisch nach außen; Entscheidungs-Log und Widerruf. Rein (ohne Server); Ende-zu-Ende steht in orchestrator.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stufeVon, nachAussen, autoAb, autoFaehig, autoAnnahmeAn, annahmeMs, ANNAHME_MS } from '../server/stufe.ts';
import { baueInbox } from '../server/inbox.ts';
import { faellig, logZeile, widerrufbar, widerrufText } from '../server/annahme.ts';

test('Einstufung: jede Regel-Klasse wird wichtig, mit Grund; Umlaute am Wortanfang zählen', () => {
  const fall: [string, RegExp][] = [
    ['Release 17d heute live schalten?', /Push\/Release/], ['Zweig mergen und pushen?', /Push\/Release/],
    ['Melious-Budget auf 120 € erhöhen?', /Geld/], ['Lizenz für Tool X kaufen?', /Geld/],
    ['AVV mit Anbieter Y unterschreiben?', /Recht/], ['Personenbezogene Daten im Log behalten?', /Recht/],
    ['Kundin per Brief informieren?', /Außenwirkung/], ['Seite öffentlich zeigen?', /Außenwirkung/],
    ['Datenbank-Schema migrieren?', /Architektur/], ['Knut muss entscheiden: Variante A oder B?', /Knut muss/],
  ];
  for (const [text, grund] of fall) { const s = stufeVon({ text }); assert.equal(s.stufe, 'wichtig', text); assert.match(s.grund, grund, text); }
  for (const text of ['Knopffarbe grün oder blau?', 'Tabellen-Spalte „ETA“ rechtsbündig?', 'Testdatei umbenennen?', 'Rechtschreibung im Hinweis korrigieren?'])
    assert.equal(stufeVon({ text }).stufe, 'normal', text);
});

test('Markierung: „wichtig“ stuft hoch, „normal“ stuft eine Regel nie herunter; Push ist immer wichtig', () => {
  assert.equal(stufeVon({ text: 'Knopffarbe?', markiert: 'wichtig' }).stufe, 'wichtig');
  assert.equal(stufeVon({ text: 'Budget erhöhen?', markiert: 'normal' }).stufe, 'wichtig');
  assert.equal(stufeVon({ text: 'egal', art: 'push' }).stufe, 'wichtig');
});

test('Nach außen nie automatisch; ohne Empfehlung nie automatisch; Frist 24 h, Schalter aus = nichts', () => {
  for (const t of ['Kommentar auf GitHub?', 'PR aufmachen?', 'Jira-Ticket schließen?', 'Mail an das Team?', 'In Confluence ablegen?']) assert.ok(nachAussen(t), t);
  assert.ok(!nachAussen('Knopffarbe?'));
  assert.equal(autoFaehig({ stufe: 'normal', empfehlung: 'Grün', text: 'Knopffarbe?' }), true);
  assert.equal(autoFaehig({ stufe: 'normal', empfehlung: '', text: 'Knopffarbe?' }), false);
  assert.equal(autoFaehig({ stufe: 'normal', empfehlung: 'per Mail schicken', text: 'Wie informieren?' }), false, 'Empfehlung geht nach außen');
  assert.equal(autoFaehig({ stufe: 'wichtig', empfehlung: 'ja', text: 'x' }), false);
  assert.equal(autoAb({ stufe: 'normal', empfehlung: 'Grün', text: 'Knopffarbe?', seit: '2026-10-17T08:00:00.000Z' }), '2026-10-18T08:00:00.000Z');
  assert.equal(autoAnnahmeAn({}), true); assert.equal(autoAnnahmeAn({ WERKBANK_AUTO_ANNAHME: '0' }), false);
  assert.equal(annahmeMs({}), ANNAHME_MS); assert.equal(annahmeMs({ WERKBANK_AUTO_ANNAHME_H: '0' }), 0); assert.equal(annahmeMs({ WERKBANK_AUTO_ANNAHME_H: 'x' }), ANNAHME_MS);
});

const leer = { karten: [], lose: [], vault: [], pflege: 0, schlange: [], kopfFehler: [] };
const T0 = Date.parse('2026-10-17T08:00:00Z');
const frage = (id: string, title: string, o: any = {}) => ({ id, title, recommendation: o.rec ?? 'ja', options: o.options ?? [], createdAt: new Date(T0 - (o.alt ?? 0)), context: o.context ?? null, key: o.key ?? null, kind: o.kind ?? null, stufe: o.stufe ?? null, strand: null });

test('Inbox: wichtige oben, normale mit Annahmezeit; G0- und Deckel-Fragen sind immer wichtig', () => {
  const { eintraege } = baueInbox({ ...leer, lose: [
    frage('q-a', 'Knopffarbe?', { alt: 3600_000 }), frage('q-b', 'Budget erhöhen?'), frage('q-c', 'Bauen?', { key: 'x#G0' }),
    frage('q-d', 'Fortsetzen?', { kind: 'auto-weiter' }), frage('q-e', 'Spalte?', { rec: '' }),
  ] }, { now: T0 + 60_000 });
  assert.deepEqual(eintraege.map((e) => e.stufe), ['wichtig', 'wichtig', 'wichtig', 'normal', 'normal']);
  const a = eintraege.find((e) => e.id === 'q-a')!;
  assert.equal(a.autoAb, new Date(T0 - 3600_000 + ANNAHME_MS).toISOString());
  assert.equal(eintraege.find((e) => e.id === 'q-e')!.autoAb, null, 'ohne Empfehlung nie');
  for (const id of ['q-b', 'q-c', 'q-d']) assert.equal(eintraege.find((e) => e.id === id)!.autoAb, null, id);
});

test('Bericht-Entscheidungen: Stufe je D, nur normale mit Empfehlung werden angenommen, Kopf-Markierung zählt', () => {
  const karte = { id: 's1', titel: 'Paket 300', running: false, berichtHash: 'h1', rueckfragen: [], braucht: null, kannFreigeben: false, freigabe: null, github: [], statusAt: new Date(T0), chat: null, paket: '300-x',
    entscheidungen: [{ id: 'D1', frage: 'Spaltenreihenfolge?', empfehlung: 'wie im Mockup' }, { id: 'D2', frage: 'Release am Montag?', empfehlung: 'ja' },
      { id: 'D3', frage: 'Hinweistext?', empfehlung: 'kurz', stufe: 'wichtig' }, { id: 'D4', frage: 'Icon?', empfehlung: null }] };
  const [e] = baueInbox({ ...leer, karten: [karte] }, { now: T0 }).eintraege;
  assert.equal(e.stufe, 'wichtig'); assert.match(e.stufeGrund!, /^D2: Push\/Release/);
  assert.deepEqual(e.daten.autoIds, ['D1']);
  assert.equal(e.autoAb, new Date(T0 + ANNAHME_MS).toISOString());
  assert.deepEqual(faellig([e], T0 + ANNAHME_MS - 1), []);
  assert.deepEqual(faellig([e], T0 + ANNAHME_MS).map((f) => f.ids), [['D1']]);
});

test('fällig: Rückfragen nach Frist, Altbestand aufgeklappt, Später-Zurückgestelltes nicht', () => {
  const now = T0 + 20 * 86400_000;
  const { eintraege } = baueInbox({ ...leer, lose: [frage('q-alt', 'Knopffarbe?', { alt: 0 }), frage('q-neu', 'Spalte?', { alt: -(now - T0) + 3600_000 })] },
    { now, spaeter: new Map([['q-neu', now + 1000]]) });
  assert.equal(eintraege[0].art, 'altbestand');
  assert.deepEqual(faellig(eintraege, now).map((f) => f.ids[0]), ['q-alt']);
});

test('Log und Widerruf: nur automatische Annahmen, einmal, nicht nach einem Commit', () => {
  const [e] = baueInbox({ ...leer, lose: [frage('q-a', 'Knopffarbe?')] }, { now: T0 }).eintraege;
  const z = logZeile('u1', e, { antwort: 'angenommen wie empfohlen', durch: 'auto', auto: true, ids: ['q-a'], now: T0 });
  assert.equal(z.stufe, 'normal'); assert.equal(z.zugestelltAt?.getTime(), T0); assert.equal(z.widerruf, null); assert.ok(z._id.startsWith('u1-q-a-'));
  assert.deepEqual(widerrufbar(z, { gebaut: false }), { ok: true, grund: null });
  assert.equal(widerrufbar(z, { gebaut: true }).ok, false);
  assert.equal(widerrufbar({ ...z, widerruf: { at: new Date(), text: 'x' } }, { gebaut: false }).ok, false);
  assert.equal(widerrufbar({ ...z, auto: false }, { gebaut: false }).ok, false);
  assert.match(widerrufText(z, 'Blau'), /Korrektur von Knut: .*q-a.*Stattdessen: Blau/s);
});
