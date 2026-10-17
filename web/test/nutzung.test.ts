// Nutzung messen (Plan 213 S0, Council K5/K4/P8): Seite aus der Adresse ohne freie Texte, Rolle/Zugang, Antwortwege,
// Auswertung über 14 Tage mit „genug Daten“. Eigene Test-Mongo.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_nutzung_test_${randomBytes(4).toString('hex')}`;
const N = await import('../server/nutzung.ts');
const { connect, wb } = await import('../server/db.ts');
let client: any;
before(async () => { client = await connect(); });
after(async () => { await client.db(process.env.WERKBANK_DB).dropDatabase(); await client.close(); });

test('Seite aus der Adresse: nur bekannte Bereiche, nie Notiz- oder Ticketnamen', () => {
  assert.equal(N.seiteAus('#/'), 'heute');
  assert.equal(N.seiteAus(''), 'heute');
  assert.equal(N.seiteAus('#/roadmap/prs'), 'roadmap');
  assert.equal(N.seiteAus('#/wissen/olaf/2-Areas/geheim.md'), 'wissen');
  assert.equal(N.seiteAus('#/wissen~roadmap'), 'wissen');
  assert.equal(N.seiteAus('#/arbeit/reviews'), 'arbeit/reviews');
  assert.equal(N.seiteAus('#/board?key=PM-123'), 'board');
  assert.equal(N.seiteAus('#/irgendwas-mit-PM-123'), 'andere');
  assert.equal(N.seiteAus(undefined), 'heute');
});

test('Rolle und Zugang: Admin/Team, Chat nur mit dem Präfix des LibreChat-Proxys', () => {
  assert.equal(N.rolleVon({ role: 'ADMIN' }), 'admin');
  assert.equal(N.rolleVon({ role: 'USER' }), 'team');
  assert.equal(N.rolleVon({}), 'team');
  assert.equal(N.zugangVon({ 'x-forwarded-prefix': '/werkbank' }), 'chat');
  assert.equal(N.zugangVon({}), 'direkt');
  assert.equal(N.zugangVon({ 'x-forwarded-prefix': '/anders' }), 'direkt');
});

test('Zählen und auswerten: Summen je Seite, Rolle, Zugang und je Antwortweg; „genug“ erst ab 14 Tagen', async () => {
  N.seiteGesehen('#/', 'admin', 'chat');
  N.seiteGesehen('#/', 'admin', 'chat');
  N.seiteGesehen('#/timebox', 'team', 'direkt');
  N.antwortGezaehlt('rueckfrage', 'ui');
  N.antwortGezaehlt('rueckfrage', 'chat-knopf');
  N.antwortGezaehlt('Push!!', 'ui');
  const a = await N.auswertung(14);
  assert.deepEqual(a.seiten.heute, { admin: 2, team: 0, chat: 2, direkt: 0 });
  assert.deepEqual(a.seiten.timebox, { admin: 0, team: 1, chat: 0, direkt: 1 });
  assert.deepEqual(a.antworten.rueckfrage, { ui: 1, 'chat-knopf': 1 });
  assert.deepEqual(a.antworten.push, { ui: 1 }, 'Art wird bereinigt');
  assert.equal(a.tageMitDaten, 1);
  assert.equal(a.genug, false);
  // Gespeichert wird nur Zählbares — keine Freitexte, keine Personen.
  const roh = await wb().collection('nutzung').find({}, { projection: { _id: 0 } }).toArray();
  for (const z of roh) assert.deepEqual(Object.keys(z).filter((k) => !['tag', 'art', 'seite', 'rolle', 'zugang', 'frage', 'weg', 'n'].includes(k)), []);
  // 14 Tage mit Daten → genug
  const tage = Array.from({ length: 14 }, (_, i) => new Date(Date.now() - i * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' }));
  await wb().collection('nutzung').insertMany(tage.map((tag) => ({ tag, art: 'seite', seite: 'board', rolle: 'team', zugang: 'direkt', n: 1 })));
  const b = await N.auswertung(14);
  assert.equal(b.genug, true);
  assert.equal(b.seiten.board.team, 14);
  // Ältere Tage zählen nicht mit
  await wb().collection('nutzung').insertOne({ tag: '2020-01-01', art: 'seite', seite: 'board', rolle: 'team', zugang: 'direkt', n: 99 });
  assert.equal((await N.auswertung(14)).seiten.board.team, 14);
});
