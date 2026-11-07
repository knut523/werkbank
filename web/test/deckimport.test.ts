// Deck-Review: Import der alten Nebenserver — Lesen (Status-Abbildung, Unter-Chat, Fassungen), Trockenlauf-Text, Übernehmen
// (Bilder als s-NN.png, Hash aus der Ablage), Wiederholbarkeit (nichts doppelt, geänderte Status bleiben).
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { MongoClient, type Db } from 'mongodb';
import { altLesen, planText, schreiben, type AltDeck } from '../server/deck-import.ts';
import type { Fund } from '../server/decks.ts';

let client: MongoClient, db: Db;
const tmp = mkdtempSync(join(tmpdir(), 'deckimport-test-'));
const alt = join(tmp, 'deck-review-flex');
const wurzel = join(tmp, 'decks');
const funde: Fund[] = [{ slug: 'flex-vortrag', mtime: 1, fassungen: [
  { fassung: 'v7', datum: '2026-11-05', pdf: '/ablage/2026-11-05_deck_flex-vortrag_v7.pdf', pptx: null, mtime: 1 },
  { fassung: 'v7-1', datum: '2026-11-06', pdf: '/ablage/2026-11-06_deck_flex-vortrag_v7-1.pdf', pptx: null, mtime: 1 },
] }];

before(async () => {
  client = new MongoClient(TEST_MONGO); await client.connect();
  db = client.db(`deckimport_test_${randomBytes(4).toString('hex')}`);
  for (const [f, n] of [['v7', 2], ['v7-1', 3], ['kaputt name', 1]] as [string, number][]) {
    mkdirSync(join(alt, 'slides', f), { recursive: true });
    for (let i = 1; i <= n; i++) writeFileSync(join(alt, 'slides', f, `s-${i}.png`), `bild ${f} ${i}`);
  }
  writeFileSync(join(alt, 'stand.json'), JSON.stringify({ fassung: 'v7-1', datei: '2026-11-06_deck_flex-vortrag_v7-1.pdf' }));
  writeFileSync(join(alt, 'weiterleiter.sh'), "r=subprocess.run(['/x/scripts/orch','send','ba58c60a'],input=msg)");
  writeFileSync(join(alt, 'kommentare.json'), JSON.stringify([
    { id: 1, folie: 2, text: 'Titel kürzer', fassung: 'v7', zeit: '09:21', status: 'erledigt', umgesetzt_in: 'v7-1' },
    { id: 2, folie: null, text: 'Storyline', fassung: 'v7', zeit: '09:30', status: 'gesendet' },
    { id: 3, folie: 1, text: 'nur für mich', fassung: 'v7-1', zeit: '14:24', status: 'notiz', autor: 'Knut' },
    { id: 4, folie: 3, text: 'neu', fassung: 'v7-1', zeit: '15:00', status: 'neu', autor: 'Peter' },
  ]));
});
after(async () => { await db.dropDatabase(); await client.close(); });

test('Lesen: Slug aus stand.json, Unter-Chat aus weiterleiter.sh, Fassungen sortiert, Status abgebildet', () => {
  const a = altLesen(alt, funde) as AltDeck;
  assert.equal(a.slug, 'flex-vortrag'); assert.equal(a.strand, 'ba58c60a');
  assert.deepEqual(a.fassungen.map((f) => [f.fassung, f.bilder.length]), [['v7', 2], ['v7-1', 3]]);
  assert.ok(a.warnungen.some((w) => /kaputt name/.test(w)));
  assert.deepEqual(a.kommentare.map((k) => k.status), ['umgesetzt', 'gesendet', 'notiz', 'offen']);
  assert.equal(a.kommentare[0].erledigtIn, 'v7-1');
  assert.equal(a.kommentare[1].folie, 0, 'ohne Folie = ganzes Deck');
  assert.equal(a.kommentare[0].at.toISOString(), '2026-11-05T08:21:00.000Z', 'Datum der Fassung + Uhrzeit, Wiener Zeit');
  assert.equal(a.kommentare[3].autor, 'Peter'); assert.equal(a.kommentare[3].extern, true);
  assert.equal(a.kommentare[0].autor, 'Knut'); assert.equal(a.kommentare[0].extern, false);
  assert.match(a.kommentare[0]._id, /^k-alt-[0-9a-f]{6}-1$/);
  assert.match(String((altLesen(join(tmp, 'gibtsnicht')) as any).fehler), /stand.json/);
});

test('Trockenlauf: zeigt Neues und schon Vorhandenes, schreibt nichts', () => {
  const a = altLesen(alt, funde) as AltDeck;
  const t = planText([a, { ordner: '/x', fehler: 'kaputt' }], new Map());
  assert.match(t, /\+ flex-vortrag/); assert.match(t, /Unter-Chat: ba58c60a · neu/); assert.match(t, /Fassungen: 2 neu \(v7:2, v7-1:3\)/);
  assert.match(t, /Kommentare: 4 neu \(1 umgesetzt, 1 gesendet, 1 notiz, 1 offen\)/); assert.match(t, /✗ \/x: kaputt/);
  const t2 = planText([a], new Map([['flex-vortrag', { fassungen: ['v7'], kommentare: new Set([a.kommentare[0]._id]) }]]));
  assert.match(t2, /↻ flex-vortrag/); assert.match(t2, /Fassungen: 1 neu \(v7-1:3\), 1 schon da/); assert.match(t2, /Kommentare: 3 neu .*1 schon da/);
  assert.equal(existsSync(wurzel), false, 'nichts kopiert');
});

test('Übernehmen: Bilder als s-NN.png, Hash nur wenn Folienzahl passt, Deck mit Unter-Chat; zweiter Lauf ändert nichts', async () => {
  const a = altLesen(alt, funde) as AltDeck;
  const col = { decks: () => db.collection<any>('decks'), kommentare: () => db.collection<any>('deck_kommentare') };
  const hashes = async (pdf: string) => (/v7-1/.test(pdf) ? ['a', 'b', 'c'] : ['x']);   // v7: 1 Hash für 2 Folien → verworfen
  const r = await schreiben(a, { col, wurzel, owner: 'k', funde, hashes });
  assert.deepEqual(r, { slug: 'flex-vortrag', angelegt: true, fassungen: 2, kommentare: 4 });
  assert.equal(readFileSync(join(wurzel, 'flex-vortrag', 'v7-1', 's-03.png'), 'utf8'), 'bild v7-1 3');
  const d = await db.collection<any>('decks').findOne({ _id: 'flex-vortrag' });
  assert.equal(d.strand, 'ba58c60a'); assert.equal(d.auto, true); assert.equal(d.owner, 'k'); assert.equal(d.ordner, '/ablage');
  assert.deepEqual(d.fassungen.map((f: any) => [f.fassung, f.folien, f.hashes.length]), [['v7', 2, 0], ['v7-1', 3, 3]]);
  // in der Werkbank geändert, dann zweiter Import: bleibt
  await db.collection<any>('deck_kommentare').updateOne({ _id: a.kommentare[3]._id }, { $set: { status: 'abgelehnt', grund: 'nein' } });
  const r2 = await schreiben(altLesen(alt, funde) as AltDeck, { col, wurzel, owner: 'k', funde, hashes });
  assert.deepEqual(r2, { slug: 'flex-vortrag', angelegt: false, fassungen: 0, kommentare: 0 });
  assert.equal((await db.collection<any>('deck_kommentare').findOne({ _id: a.kommentare[3]._id })).status, 'abgelehnt');
  assert.equal(await db.collection('deck_kommentare').countDocuments({ deck: 'flex-vortrag' }), 4);
});
