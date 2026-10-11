// Vault-Suche ohne Modell: Index-Dokument (Felder, Gewicht), Synonyme, Füllwörter, Ausschnitte.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { docOf, boostOf, SETTINGS } from '../server/search.ts';
import { synonymGroups, alternativesOf, STOP_WORDS, glossaryPairs, expandText } from '../server/search-lexicon.ts';
import { queryTerms, lineSnippet } from '../mcp/vault-tools.ts';

const note = (path: string, fm: Record<string, unknown> = {}) => ({ path, name: path.split('/').pop()!.replace(/\.md$/, ''), title: 'T', team: path.split('/')[0], fm, mtime: 1, size: 1, links: [], unresolved: [], tickets: [] });

test('docOf: Synonyme aus Titel/Überschriften als eigenes Feld, Gewicht, ganze ms', () => {
  const d = docOf({ ...note('olaf/x/spec-opt-out.md', { lifecycle: 'plan', aliases: ['Abmeldung'], tags: 'brevo' }), mtime: 1.75 },
    '# Opt-out\n<!-- weg -->\n## Erinnerung vor Ablauf\nText ohne Synonym: Rechnung');
  assert.ok(d.synonyms.includes('unsubscribe'));   // aus Titel/Alias „Opt-out“/„Abmeldung“
  assert.ok(d.synonyms.includes('reminder'));      // aus der Überschrift
  assert.ok(!d.synonyms.includes('invoice'));      // Fließtext erweitert nicht
  assert.ok(!d.synonyms.includes('opt-out'));      // was schon dasteht, nicht doppelt
  assert.deepEqual(d.aliases, ['Abmeldung']);
  assert.deepEqual(d.tags, ['brevo']);
  assert.doesNotMatch(d.body, /weg/);
  assert.equal(d.boost, 2);
  assert.equal(d.mtime, 1);
  assert.deepEqual(SETTINGS.searchableAttributes.slice(0, 4), ['title', 'aliases', 'name', 'synonyms']);
  assert.ok(SETTINGS.rankingRules.indexOf('attribute') < SETTINGS.rankingRules.indexOf('proximity'));
});

test('glossaryPairs: Glossar-Tabellen als Synonymgruppen, Aufzählungen und „vs“ nicht', () => {
  const body = ['## Glossar', '| Begriff | Bedeutung |', '|---|---|',
    '| **Zählpunkt (ZP), Zählpunktnummer** | Messpunkt |', '| **EEG** (Erneuerbare-Energie-Gemeinschaft) | lokal |',
    '| **Retrigger / Resubmit** | erneut ausführen |', '| **Plan / Spec / Council** | Ablauf |', '| **Arbeitspreis / Grundpreis** | je kWh / fix |',
    '| **Storno** vs **Widerruf** | x |', '| **PM-123 / OLAF-123** | Ticket |', '## Anderes', '| **A (B)** | außerhalb |'].join('\n');
  assert.deepEqual(glossaryPairs(body), [['zp', 'zählpunkt', 'zählpunktnummer'], ['erneuerbare-energie-gemeinschaft', 'eeg'], ['retrigger', 'resubmit']]);
});

test('expandText: ganze Wörter und Mehrwortbegriffe', () => {
  assert.ok(expandText('Ein Opt-out-Link').includes('abmeldung'));
  assert.ok(expandText('Virtual Power Plants im Überblick').includes('vpp'));
  assert.deepEqual(expandText('Bottich'), []);   // „bot“ steckt drin, ist aber kein ganzes Wort
});

test('boostOf: Archiv und Rohmitschriften unten, Gültiges oben', () => {
  assert.equal(boostOf(note('olaf/4-Archive/alt.md', { status: 'current' })), 0);
  assert.equal(boostOf(note('olaf/Meetings/raw/x-transcript.md')), 0);
  assert.equal(boostOf(note('olaf/a.md', { status: 'superseded' })), 0);
  assert.equal(boostOf(note('olaf/a.md', { status: 'draft' })), 1);
  assert.equal(boostOf(note('olaf/a.md', { status: 'current' })), 2);
});

test('Synonyme: gepflegte Datei geladen, Dateisystem-Weg faltet', () => {
  assert.ok(synonymGroups().length > 20);
  assert.ok(synonymGroups().every((g) => g.length > 1 && g.every((w) => w === w.toLowerCase())));
  assert.ok(alternativesOf('Abmeldung').includes('opt-out'));
  assert.ok(alternativesOf('Übersicht').includes('overview'));
});

test('Füllwörter fallen aus der Anfrage, Sachwörter bleiben', () => {
  assert.ok(STOP_WORDS.includes('wo'));
  assert.deepEqual(queryTerms('Wo steht der Bot?'), ['bot']);
  assert.deepEqual(queryTerms('wer'), ['wer']);   // nur Füllwörter: dann doch suchen
});

test('lineSnippet: Überschriftenpfad und Fundzeile, Code übersprungen', () => {
  const body = '# Haupt\n## Ablauf\n```\nopt-out im Code\n```\n- Kunde klickt **Opt-out** im Mail\n## Sonst\nnichts';
  assert.equal(lineSnippet(body, ['abmeldung']), '§ Haupt › Ablauf: Kunde klickt **Opt-out** im Mail');
  assert.equal(lineSnippet(body, ['gibtsnicht']), '');
});

test('Synonyme nur als ganzes Wort: „eg“ trifft nicht „Strategie“, Getipptes bleibt Teilwort', async () => {
  const { hasTerm, wordsOf } = await import('../server/search-lexicon.ts');
  assert.equal(hasTerm('strategie', wordsOf('Strategie'), 'eg', false), false);
  assert.equal(hasTerm('eine eg gründen', wordsOf('eine EG gründen'), 'eg', false), true);
  assert.equal(hasTerm('zauberwort-kundenakte', wordsOf('Zauberwort-Kundenakte'), 'zauberwort', true), true);
  assert.equal(lineSnippet('Der Roboter\nDer Bot antwortet', ['chatbot']), 'Der Bot antwortet');   // nicht „Roboter“
});
