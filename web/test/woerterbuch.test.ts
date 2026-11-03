// S13 (Paket 436): Karten in Klartext — Code-Namen ersetzt, Abkürzungen einmal erklärt; Wörterbuch deckt die heute offenen Fragen (C7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ohneFachwort as klartext, unbekannt } from '../server/woerterbuch.ts';
import { karteAusFrage } from '../server/v2kern.ts';

test('Code-Namen werden Wörter, Abkürzungen einmal erklärt, schon erklärte nicht doppelt', () => {
  assert.equal(klartext('Reicht `consentMarketing` ohne Opt-in?'), 'Reicht Marketing-Einwilligung ohne Opt-in?');
  const g = new Set<string>();
  assert.equal(klartext('Frage an die DSB', g), 'Frage an die DSB (Datenschutzbeauftragte)');
  assert.equal(klartext('Die DSB sagt ja', g), 'Die DSB sagt ja', 'pro Karte nur einmal');
  assert.equal(klartext('BEG (Bürgerenergiegemeinschaft) oder EEG'), 'BEG (Bürgerenergiegemeinschaft) oder EEG (Erneuerbare-Energie-Gemeinschaft)', 'schon erklärt: nicht nochmal');
  assert.equal(klartext('PR #268 und OLAF-433'), 'PR #268 und OLAF-433', 'PR und Ticket-Kennungen bleiben');
  assert.equal(klartext('unbekannterName bleibt'), 'unbekannterName bleibt');
  assert.equal(klartext('siehe https://x.at/api/consentMarketing?flowVersionId=4&r=EG'), 'siehe https://x.at/api/consentMarketing?flowVersionId=4&r=EG', 'Links bleiben ganz (Pass C)');
  assert.equal(klartext('Feld consentMarketing, dann EG.'), 'Feld Marketing-Einwilligung, dann EG (Energiegemeinschaft).');
});

test('C7: Wörterbuch deckt die Code-Namen der offenen Fragen vom 03.11. (Datenkopie)', () => {
  assert.deepEqual(unbekannt(['DSB: Reicht der Haken für Kunden ohne consentMarketing?', 'Die flowVersionId bleibt gleich']), []);
  assert.deepEqual(unbekannt(['neuesFeld kommt']), ['neuesFeld']);
});

test('Karte: Titel, Worum, Empfehlung und Möglichkeiten in Klartext; die Antwort selbst bleibt unberührt (Server nimmt die Empfehlung aus der Frage)', () => {
  const f: any = { id: 'q-1', klasse: 'entscheidung', titel: 'DSB: consentMarketing nötig?', worum: 'Die DSB fragt nach consentMarketing.', empfehlung: 'Ja, consentMarketing setzen', optionen: ['consentMarketing', 'nichts'], alternativen: [], antworten: ['ja', 'anders', 'spaeter'], gruppe: 'Datenschutz', quelle: { text: 'x' }, blockiert: 0, wartetSeit: null };
  const k = karteAusFrage(f, { grund: '', strand: null, strandTitel: null, altUrl: 'http://alt' });
  assert.equal(k.titel, 'DSB (Datenschutzbeauftragte): Marketing-Einwilligung nötig?');
  assert.equal(k.worum, 'Die DSB fragt nach Marketing-Einwilligung.');
  assert.equal(k.empfehlung, 'Ja, Marketing-Einwilligung setzen');
  assert.deepEqual(k.optionen, ['Marketing-Einwilligung', 'nichts']);
  assert.equal(f.empfehlung, 'Ja, consentMarketing setzen', 'Frage-Objekt unverändert');
});
