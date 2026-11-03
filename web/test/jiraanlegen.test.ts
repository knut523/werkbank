// Jira beide Seiten (Release 31, Schnitt 2; Abnahme-Zeilen 5 und 6): Seite nach Projekt, Duplikatsuche Pflicht, Schalter.
// Rein (ohne Netz und Mongo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZWEI_SEITEN_AN, projektSeite, jqlDuplikate, aehnlichkeit, duplikatKandidaten, ungesehen, anlegenEingabe, schluesselAus } from '../server/jiraanlegen.ts';

const SITES = [
  { prefix: 'PM', site: 'https://maxenergy.example', cloudId: '11111111-1111-1111-1111-111111111111', main: true },
  { prefix: 'OLAF', site: 'https://max-energy.example', cloudId: '22222222-2222-2222-2222-222222222222', main: false },
];

test('Schalter: nur „on“', () => {
  assert.equal(ZWEI_SEITEN_AN({}), false);
  assert.equal(ZWEI_SEITEN_AN({ WERKBANK_JIRA_ZWEI_SEITEN: 'an' }), false);
  assert.equal(ZWEI_SEITEN_AN({ WERKBANK_JIRA_ZWEI_SEITEN: 'on' }), true);
});

test('Seite nach Projekt: PM → Hauptseite, OLAF → zweite Seite, Kleinschreibung egal, unbekannt → null (kein Rückfall auf die Hauptseite)', () => {
  assert.equal(projektSeite('PM', SITES)?.cloudId, SITES[0].cloudId);
  assert.equal(projektSeite('olaf', SITES)?.cloudId, SITES[1].cloudId);
  assert.equal(projektSeite('KON', SITES), null);
  assert.equal(projektSeite('', SITES), null);
});

test('JQL der Duplikatsuche: Projekt, je Wort ein summary ~ (ODER), höchstens 6 längste Wörter, keine Anführungszeichen-Ausbrüche', () => {
  const j = jqlDuplikate('OLAF', 'Bot: Telefon-Anbindung "testen" (v5) OR project = PM');
  assert.equal(j, 'project = "OLAF" AND (summary ~ "bot" OR summary ~ "telefon" OR summary ~ "anbindung" OR summary ~ "testen" OR summary ~ "v5" OR summary ~ "pm") ORDER BY updated DESC');
  const lang = jqlDuplikate('PM', 'Tarifrechner Rundung prüfen alle Netzbetreiber Sonderfälle Wochenende Test');
  assert.equal((lang.match(/summary ~/g) ?? []).length, 6);
  assert.match(lang, /tarifrechner/); assert.doesNotMatch(lang, /"test"/);
  assert.throws(() => jqlDuplikate('OLAF', 'a b'), /zu kurz/);
  assert.throws(() => jqlDuplikate('OLAF" OR 1=1', 'Bot v5 testen'), /Ungültiges Projekt/);
});

test('Ähnlichkeit: gleiche Wörter → hoch, anderes Thema → niedrig, Groß/Klein und Satzzeichen egal', () => {
  assert.ok(aehnlichkeit('Bot v5 Telefon-Anbindung testen', 'bot v5: telefon anbindung testen') >= 0.9);
  assert.ok(aehnlichkeit('Bot v5 Telefon-Anbindung testen', 'Tarifrechner Rundung prüfen') < 0.2);
});

test('Kandidaten: nach Ähnlichkeit sortiert, ab 0,4, höchstens 5, mit Status', () => {
  const issues = [
    { key: 'OLAF-1', fields: { summary: 'Bot v5 Telefon-Anbindung testen', status: { name: 'To Do' } } },
    { key: 'OLAF-2', fields: { summary: 'Tarifrechner Rundung', status: { name: 'Done' } } },
    { key: 'OLAF-3', fields: { summary: 'Telefon-Anbindung für Bot v5', status: { name: 'In Progress' } } },
  ];
  const k = duplikatKandidaten('Bot v5: Telefon-Anbindung testen', issues);
  assert.deepEqual(k.map((x) => x.key), ['OLAF-1', 'OLAF-3']);
  assert.equal(k[0].status, 'To Do');
});

test('ungesehen: Treffer, die nicht in duplikate_gesehen stehen, blockieren das Anlegen', () => {
  const k = [{ key: 'OLAF-1', summary: 'x', status: 'To Do', score: 1 }, { key: 'OLAF-3', summary: 'y', status: 'Done', score: 0.5 }];
  assert.deepEqual(ungesehen(k, ['OLAF-1']).map((x) => x.key), ['OLAF-3']);
  assert.deepEqual(ungesehen(k, ['olaf-1', ' OLAF-3 ']), []);
});

test('Eingabe prüfen: Titel 5–255 Zeichen, Typ aus der Liste, Datum JJJJ-MM-TT, Beschreibung höchstens 20 000', () => {
  assert.deepEqual(anlegenEingabe({ projekt: 'olaf', titel: '  Bot v5 testen ', typ: undefined, beschreibung: 'b', faellig: '2026-11-20', duplikate_gesehen: ['OLAF-1'] }),
    { projekt: 'OLAF', titel: 'Bot v5 testen', typ: 'Task', beschreibung: 'b', faellig: '2026-11-20', gesehen: ['OLAF-1'] });
  assert.throws(() => anlegenEingabe({ projekt: 'OLAF', titel: 'abc' }), /Titel/);
  assert.throws(() => anlegenEingabe({ projekt: 'OLAF', titel: 'Bot v5 testen', typ: 'Epic; DROP' }), /Typ/);
  assert.throws(() => anlegenEingabe({ projekt: 'OLAF', titel: 'Bot v5 testen', faellig: '20.11.2026' }), /JJJJ-MM-TT/);
  assert.throws(() => anlegenEingabe({ projekt: 'OLAF', titel: 'Bot v5 testen', beschreibung: 'x'.repeat(20_001) }), /Beschreibung/);
});

test('Schlüssel aus der MCP-Antwort: nur einer des richtigen Projekts', () => {
  assert.equal(schluesselAus('{"key":"OLAF-422","id":"10001"}', 'OLAF'), 'OLAF-422');
  assert.equal(schluesselAus('Created issue PM-77', 'PM'), 'PM-77');
  assert.equal(schluesselAus('nicht angelegt, Duplikat von PM-12 (siehe PM-13)', 'PM'), null, 'mehrere Schlüssel im Text → keiner');
  assert.equal(schluesselAus('PM-1', 'P.*'), null, 'kein Regex aus dem Projekt');
  assert.equal(schluesselAus('Fehler: kein Ticket', 'OLAF'), null);
  assert.equal(schluesselAus('PM-77', 'OLAF'), null);
});
