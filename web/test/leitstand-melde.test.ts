// R30 (Plan 376, Punkt 3): meldeLeitstand verwirft Meldungen ohne aktiven Hauptchat nicht mehr still, sondern legt
// eine Rückfrage in die Inbox („Braucht dich“) — Muster capQuestion/askKnut. Höchstens eine offene je Quelle und Person,
// Fehler in der Inbox bleiben folgenlos (dann bleibt es beim Stillen wie vorher).
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MongoClient } from 'mongodb';

const tag = randomBytes(4).toString('hex');
process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_test_leitmelde_${tag}`;
mkdirSync(join(tmpdir(), `leitmelde-${tag}`), { recursive: true });
for (const k of ['WERKBANK_LEITSTAND', 'WERKBANK_LEITSTAND_DIR', 'WERKBANK_ORCH_ROOTS']) delete process.env[k];
const L = await import('../server/leitstand.ts');
const O = await import('../server/orchestrator.ts');
const db = await import('../server/db.ts');

let raw: MongoClient;
before(async () => { await db.connect(); raw = await MongoClient.connect(TEST_MONGO); });
after(async () => { await raw.db(process.env.WERKBANK_DB).dropDatabase(); await raw.close(); process.exit(0); });

const u = { id: 'u-leit1', email: 'knut@maxenergy.at', name: 'Knut', role: 'ADMIN' } as any;
const quelle = (_id: string, title = 'Strang X') => ({ _id, title });

test('Ohne aktiven Hauptchat: Meldung landet als Rückfrage in der Inbox (q-…, dedupliziert je Quelle)', async () => {
  const jetzt = Date.UTC(2026, 10, 2, 12, 0);
  const hinweis = 'Fix geprüft — freigeben? Paket 376-fix';
  // Kein Hauptchat aktiv (kein runs-Eintrag): früher kam still false zurück, jetzt mit Inbox-Eintrag.
  assert.equal(await L.meldeLeitstand(u, quelle('fix:abc1', '@fix olaf-admin#7'), hinweis, jetzt), false);
  const q: any = await O.questions().findOne({ userId: u.id, kind: 'leitstand-meldung', 'quelle.id': 'fix:abc1', status: 'offen' });
  assert.ok(q, 'Rückfrage angelegt');
  assert.match(String(q._id), /^q-/);
  assert.match(q.title, /freigeben\?/);
  assert.ok(Array.isArray(q.options) && q.options.length >= 1, 'Options vorhanden');
  // Zweite Meldung zu derselben Quelle: keine zweite offene Frage (dedupliziert).
  assert.equal(await L.meldeLeitstand(u, quelle('fix:abc1', '@fix olaf-admin#7'), `${hinweis} (nochmal)`, jetzt + 60_000), false);
  assert.equal(await O.questions().countDocuments({ userId: u.id, kind: 'leitstand-meldung', 'quelle.id': 'fix:abc1', status: 'offen' }), 1);
  // Andere Quelle: eigene Frage.
  assert.equal(await L.meldeLeitstand(u, quelle('fix:abc2', '@fix olaf-admin#9'), 'zweite Meldung', jetzt + 90_000), false);
  assert.equal(await O.questions().countDocuments({ userId: u.id, kind: 'leitstand-meldung', status: 'offen' }), 2);
  // Beantwortet („Gelesen“) → nächste Meldung derselben Quelle legt eine neue an.
  await O.questions().updateOne({ userId: u.id, kind: 'leitstand-meldung', 'quelle.id': 'fix:abc1', status: 'offen' } as any, { $set: { status: 'beantwortet', answer: { wahl: 'Gelesen', at: new Date(jetzt + 120_000) } } } as any);
  assert.equal(await L.meldeLeitstand(u, quelle('fix:abc1', '@fix olaf-admin#7'), 'erneut', jetzt + 180_000), false);
  assert.equal(await O.questions().countDocuments({ userId: u.id, kind: 'leitstand-meldung', 'quelle.id': 'fix:abc1', status: 'offen' }), 1);
});

test('Ohne Quelle-Dokument (d undefined/null) kein Absturz — Frage mit quelle „—“', async () => {
  const jetzt = Date.UTC(2026, 10, 2, 13, 0);
  assert.equal(await L.meldeLeitstand(u, undefined, 'Meldung ohne Dokument', jetzt), false);
  assert.ok(await O.questions().findOne({ userId: u.id, kind: 'leitstand-meldung', 'quelle.id': '—', status: 'offen' }), 'angelegt mit quelle —');
  // Null-Objekt zählt als dieselbe Quelle „—“: weiterhin nur eine offene.
  assert.equal(await L.meldeLeitstand(u, null, 'nochmal ohne', jetzt + 1_000), false);
  assert.equal(await O.questions().countDocuments({ userId: u.id, kind: 'leitstand-meldung', 'quelle.id': '—', status: 'offen' }), 1);
});

test('Mit aktivem Hauptchat: Meldung geht als Ereignis an den Hauptchat (kein Inbox-Eintrag)', async () => {
  // Hauptchat aktiv = runs-Eintrag kind leitstand ohne endedAt (activeLeitstand).
  await O.runs().insertOne({ _id: `leit-${tag}`, userId: u.id, kind: 'leitstand', title: 'Hauptchat', startedAt: new Date(Date.UTC(2026, 10, 2, 9)), endedAt: null } as any);
  const jetzt = Date.UTC(2026, 10, 2, 14, 0);
  assert.equal(await L.meldeLeitstand(u, quelle('fix:abc3', 'Y'), 'Meldung mit Hauptchat', jetzt), true);
  assert.equal(await O.questions().countDocuments({ userId: u.id, kind: 'leitstand-meldung', status: 'offen', createdAt: { $gt: new Date(jetzt - 1_000) } }), 0, 'kein neuer Inbox-Eintrag');
  // Das Ereignis liegt in leitstand_events (Meldung mit Schlüssel meldung:< quelle >:entscheidungen:<now>).
  const ev: any = await L.events().findOne({ userId: u.id, kind: 'meldung', text: 'Meldung mit Hauptchat' });
  assert.ok(ev, 'Ereignis im Hauptchat-Fluss');
  assert.equal(ev.status, 'offen');
});
