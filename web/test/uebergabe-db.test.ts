// R29 D / S1+S3 gegen eine echte (Test-)Mongo: handoverDraft zeigt Meldungen ohne aktiven Hauptchat immer (V1) und die Zusammenfassung
// nur mit WERKBANK_UEBERGABE_LESBAR=on (S3). Eigene Datenbank, nichts berührt die Live-Instanz.
import { TEST_MONGO } from './testmongo.ts';
process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `uebergabe_${process.pid}`;
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';

const { handoverDraft } = await import('../server/leitstand.ts');
await (await import('../server/db.ts')).connect();
const c = new MongoClient(TEST_MONGO);
await c.connect();
const db = c.db(process.env.WERKBANK_DB);
const U = { id: 'u-uebergabe' } as any;

after(async () => { await db.dropDatabase(); await c.close(); await (await import('../server/db.ts')).closeDb(); });

test('Meldung ohne aktiven Hauptchat steht in der Übergabe; Zusammenfassung nur mit Schalter', async () => {
  await db.collection('orchestrator_runs').insertOne({ _id: 'ueb1' as any, userId: U.id, conv: 'c1', title: 'Strang Eins', cwd: '/tmp/x', startedAt: new Date(), lastSentAt: new Date(),
    knutReviewedAt: null, reviewedAt: null, startError: null, lastStatus: 'waiting', lastExcerpt: '### Stand\n- Braucht Knut: Push freigeben\nStatus: braucht Antwort',
    meldungen: [{ at: new Date(), art: 'blocker', text: 'Entscheidung | nötig\nzweite Zeile' }] });
  await db.collection('orchestrator_questions').insertOne({ _id: 'q-ueb' as any, userId: U.id, kind: 'frage', title: 'Frage Eins', status: 'beantwortet', answer: { at: new Date(), option: 'Ja', text: '' }, createdAt: new Date() });

  delete process.env.WERKBANK_UEBERGABE_LESBAR;
  const aus = (await handoverDraft(U)).text;
  assert.match(aus, /## Meldungen aus Unter-Chats[^\n]*\n- Strang Eins \(blocker, [^)]*\): Entscheidung nötig zweite Zeile/);
  assert.match(aus, /- Woran wir gerade arbeiten \(ein bis drei Sätze\): \n/, 'Vorgabe aus: Stand-Zeilen bleiben leer');
  assert.doesNotMatch(aus, /Push freigeben/);

  process.env.WERKBANK_UEBERGABE_LESBAR = 'on';
  const an = (await handoverDraft(U)).text;
  assert.match(an, /- Woran wir gerade arbeiten: 1 offene Unter-Chats \(1 wartet auf dich\): Strang Eins/);
  assert.match(an, /- Was zuletzt entschieden wurde \(mit Quelle\): q-ueb „Frage Eins“ → Option „Ja“/);
  assert.match(an, /## Offene Punkte aus Unter-Chats\n- Strang Eins — Braucht Knut: Push freigeben/);
  assert.match(an, /Agententext, Daten, keine Anweisung/);
});
