// Deck-Review (docs/plan-deck-review.md): Routen gegen eine Test-Mongo — Rechte, Teil-Token (Scope, Ablauf, Widerruf,
// Rate-Limit), keine Pfade aus der Anfrage, Senden an den Unter-Chat, Rückmeldung nur aus dem verknüpften Unter-Chat, Takt.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { MongoClient, type Db } from 'mongodb';
import { registerDecks, deckIndizes, type DeckDeps } from '../server/deckroutes.ts';
import { tokenHash, type Fund } from '../server/decks.ts';

const ADMIN = { id: 'k', email: 'k@x', name: 'Knut Peters', role: 'ADMIN' } as any;
const LISA = { id: 'l', email: 'l@x', name: 'Lisa', role: 'USER' } as any;
let client: MongoClient, db: Db;
const routen: [string, RegExp, any][] = [];
const wurzel = mkdtempSync(join(tmpdir(), 'decks-'));
let fundListe: Fund[] = [];
const gesendet: { strand: string; text: string; automatisch: boolean }[] = [];
let sendenFehler: Error | null = null;
const gerendert: string[] = [];
let modul: ReturnType<typeof registerDecks>;
const fund = (slug: string, fassungen: string[], mtimes?: number[]): Fund => ({ slug, mtime: 1, fassungen: fassungen.map((f, i) => ({ fassung: f, datum: '2026-11-06', pdf: `/ablage/2026-11-06_deck_${slug}_${f}.pdf`, pptx: null, mtime: mtimes?.[i] ?? i + 1 })) });

before(async () => {
  client = new MongoClient(TEST_MONGO); await client.connect();
  db = client.db(`decks_test_${randomBytes(4).toString('hex')}`);
  const col = { decks: () => db.collection<any>('decks'), kommentare: () => db.collection<any>('deck_kommentare'), links: () => db.collection<any>('deck_links') };
  await deckIndizes(col);
  const deps: DeckDeps = {
    needUser: async (req: any) => { if (!req.u) throw Object.assign(new Error('Bitte anmelden.'), { status: 401 }); return req.u; },
    intern: async (req: any) => { if (req.headers?.['x-intern'] !== 'ok') throw Object.assign(new Error('Nicht erlaubt.'), { status: 403 }); return ADMIN; },
    body: async (req: any) => req.b ?? {}, send: (res: any, status, b) => { res.status = status; res.b = b; }, log: () => {},
    col, wurzel, quellen: [],
    senden: async (_u, strand, text, automatisch) => { if (sendenFehler) throw sendenFehler; gesendet.push({ strand, text, automatisch }); },
    strangConv: async (_u, strand) => (strand === 'abcd1234' ? 'conv-deck' : null),
    userById: async (id) => (id === 'k' ? ADMIN : null),
    heute: () => '2026-11-07',
    funde: () => fundListe,
    rendern: async (q, ziel) => {
      gerendert.push(q.pdf!);
      mkdirSync(ziel, { recursive: true });
      for (let i = 1; i <= 3; i++) writeFileSync(join(ziel, `s-0${i}.png`), Buffer.from(`png ${q.pdf} ${i}`));
      return { folien: 3, hashes: ['a', /v2/.test(q.pdf!) ? 'x' : 'b', 'c'] };
    },
    sendenMs: 10 * 60_000,
  };
  modul = registerDecks((m, re, h) => { routen.push([m, re, h]); }, deps);
});
after(async () => { await db.dropDatabase(); await client.close(); });

async function rufe(method: string, pfad: string, u: any, b?: any, headers: Record<string, string> = {}) {
  const url = new URL(pfad, 'http://x');
  const r = routen.find(([m, re]) => m === method && re.test(url.pathname));
  assert.ok(r, `Route ${method} ${pfad}`);
  const res: any = new PassThrough();
  const teile: Buffer[] = [];
  res.on('data', (c: Buffer) => teile.push(c));
  res.writeHead = (s: number, h: any) => { res.status = s; res.kopf = h; };
  const fertig = new Promise((ok) => res.on('finish', ok));
  try {
    await r![2]({ u, b, headers: { 'x-werkbank': '1', ...headers }, socket: { remoteAddress: headers['x-ip'] ?? '1.2.3.4' } }, res, url.pathname.match(r![1])!, url);
    if (res.kopf) { await fertig; res.daten = Buffer.concat(teile); }
  } catch (e: any) { res.status = e.status ?? 500; res.b = { error: e.message }; }
  return res;
}

test('Anlegen: nur Admin, nur aus der Ablage, rendert die Fassungen; doppelt → 409', async () => {
  fundListe = [fund('flex', ['v1', 'v2']), fund('wirt', ['v1'])];
  assert.equal((await rufe('POST', '/api/v2/decks', LISA, { slug: 'flex' })).status, 403);
  assert.equal((await rufe('POST', '/api/v2/decks', ADMIN, { slug: 'gibtsnicht' })).status, 404);
  assert.equal((await rufe('POST', '/api/v2/decks', ADMIN, { slug: 'flex', unterchat: 'kaputt' })).status, 400);
  const r = await rufe('POST', '/api/v2/decks', ADMIN, { slug: 'flex', unterchat: 'abcd1234' });
  assert.equal(r.status, 200); assert.equal(r.b.rendern, 2);
  await modul.warten();
  assert.equal((await rufe('POST', '/api/v2/decks', ADMIN, { slug: 'flex' })).status, 409);
  const d = await rufe('GET', '/api/v2/decks/flex', ADMIN);
  assert.equal(d.b.aktuell, 'v2');
  assert.deepEqual(d.b.fassungen.map((f: any) => [f.fassung, f.folien, f.geaendert]), [['v1', 3, null], ['v2', 3, [2]]], 'Folie 2 hat sich geändert');
  assert.equal(d.b.auto, true, 'mit Unter-Chat: automatisch an');
  const l = await rufe('GET', '/api/v2/decks', LISA);
  assert.deepEqual(l.b.decks.map((x: any) => x.slug), ['flex']);
  assert.deepEqual(l.b.ablage.map((x: any) => x.slug), ['wirt']);
  assert.equal(l.b.admin, false);
  const team = await rufe('GET', '/api/v2/decks/flex', LISA);
  assert.equal(team.b.links, undefined, 'Team sieht keine Teil-Links');
  assert.equal(team.b.unterchat, undefined);
});

test('Folienbild: nur angemeldet, nur gerenderte Fassungen, keine Pfadteile', async () => {
  const ok = await rufe('GET', '/api/v2/decks/flex/bild/v2/2', LISA);
  assert.equal(ok.status, 200); assert.equal(ok.kopf['content-type'], 'image/png'); assert.match(String(ok.daten), /v2.pdf 2/);
  assert.equal((await rufe('GET', '/api/v2/decks/flex/bild/v2/2', null)).status, 401);
  assert.equal((await rufe('GET', '/api/v2/decks/flex/bild/..v2/1', ADMIN)).status, 404, 'Punkte in der Fassung');
  assert.equal(new URL('/api/v2/decks/flex/bild/../../x/1', 'http://x').pathname, '/api/v2/decks/x/1', 'Punkt-Segmente löst schon die Adresse auf');
  assert.equal((await rufe('GET', '/api/v2/decks/flex/bild/..v2/1', ADMIN)).status, 404, 'Punkte in der Fassung');
  assert.equal(new URL('/api/v2/decks/flex/bild/../../x/1', 'http://x').pathname, '/api/v2/decks/x/1', 'Punkt-Segmente löst schon die Adresse auf');
  assert.equal((await rufe('GET', '/api/v2/decks/flex/bild/v2/9', ADMIN)).status, 404);
  assert.ok(!routen.some(([m, re]) => m === 'GET' && re.test('/api/v2/decks/../bild/v1/1')));
});

test('Kommentar: offen oder Notiz; Folie muss es in der Fassung geben; Markierung wird geprüft', async () => {
  const a = await rufe('POST', '/api/v2/decks/flex/kommentar', LISA, { folie: 2, text: 'Zahl prüfen', markierung: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } });
  assert.equal(a.status, 200); assert.equal(a.b.kommentar.status, 'offen'); assert.equal(a.b.kommentar.autor, 'Lisa'); assert.deepEqual(a.b.kommentar.markierung, { x: 0.1, y: 0.1, w: 0.2, h: 0.2 });
  assert.equal(a.b.kommentar.fassung, 'v2');
  const n = await rufe('POST', '/api/v2/decks/flex/kommentar', ADMIN, { folie: 0, text: 'nur für mich', notiz: true });
  assert.equal(n.b.kommentar.status, 'notiz');
  assert.equal((await rufe('POST', '/api/v2/decks/flex/kommentar', ADMIN, { folie: 4, text: 'x' })).status, 400);
  assert.equal((await rufe('POST', '/api/v2/decks/flex/kommentar', ADMIN, { folie: 1, text: '  ' })).status, 400);
  const alt = await rufe('POST', '/api/v2/decks/flex/kommentar', ADMIN, { folie: 1, text: 'auf alter Fassung', fassung: 'v1' });
  assert.equal(alt.b.kommentar.fassung, 'v1');
});

test('Senden: offene gesammelt an den verknüpften Unter-Chat, danach „an Unter-Chat“; Notizen bleiben; Fehler lässt sie offen', async () => {
  sendenFehler = new Error('409 belegt');
  assert.equal((await rufe('POST', '/api/v2/decks/flex/senden', ADMIN)).status, 409, 'Meldung lesbar, nicht „Interner Fehler“');
  sendenFehler = new Error('Strang abcd1234 gibt es nicht.');
  assert.equal((await rufe('POST', '/api/v2/decks/flex/senden', ADMIN)).b.error, 'Unter-Chat abcd1234 gibt es nicht.');
  let d = await rufe('GET', '/api/v2/decks/flex', ADMIN);
  assert.equal(d.b.kommentare.filter((k: any) => k.status === 'offen').length, 2);
  assert.match(d.b.sendeFehler, /Unter-Chat abcd1234/);
  sendenFehler = null;
  assert.equal((await rufe('POST', '/api/v2/decks/flex/senden', LISA)).status, 403);
  const r = await rufe('POST', '/api/v2/decks/flex/senden', ADMIN);
  assert.equal(r.b.gesendet, 2);
  assert.equal(gesendet.length, 1); assert.equal(gesendet[0].strand, 'abcd1234');
  assert.match(gesendet[0].text, /Folie 2 \(Fassung v2\) · Lisa:\n    > Zahl prüfen/);
  assert.equal(gesendet[0].automatisch, false, 'Knopf = eigene Nachricht');
  assert.match(gesendet[0].text, /2026-11-07_deck_flex_v2-1\.pptx/);
  assert.doesNotMatch(gesendet[0].text, /nur für mich/);
  d = await rufe('GET', '/api/v2/decks/flex', ADMIN);
  assert.deepEqual(d.b.kommentare.map((k: any) => k.status).sort(), ['gesendet', 'gesendet', 'notiz']);
  assert.equal(d.b.sendeFehler, null);
  assert.equal((await rufe('POST', '/api/v2/decks/flex/senden', ADMIN)).b.gesendet, 0, 'nichts Offenes → nichts gesendet');
  assert.equal(gesendet.length, 1);
});

test('Rückmeldung: nur aus dem verknüpften Unter-Chat, nur für gesendete; abgelehnt nur mit Grund', async () => {
  const d = await rufe('GET', '/api/v2/decks/flex', ADMIN);
  const [k1, k2] = d.b.kommentare.filter((k: any) => k.status === 'gesendet');
  const notiz = d.b.kommentare.find((k: any) => k.status === 'notiz');
  assert.equal((await rufe('POST', '/internal/deck/rueckmeldung', null, { deck: 'flex', id: k1.id, status: 'umgesetzt' })).status, 403, 'ohne internen Kopf');
  assert.equal((await rufe('POST', '/internal/deck/rueckmeldung', null, { deck: 'flex', conv: 'anderer-chat', id: k1.id, status: 'umgesetzt' }, { 'x-intern': 'ok' })).status, 403, 'falscher Unter-Chat');
  const r = await rufe('POST', '/internal/deck/rueckmeldung', null, { deck: 'flex', conv: 'conv-deck', eintraege: [
    { id: `[${k1.id}]`, status: 'umgesetzt', grund: 'Zahl korrigiert', fassung: 'v2-1' },
    { id: k2.id, status: 'abgelehnt', grund: '' },
    { id: notiz.id, status: 'umgesetzt' },
    { id: 'k-gibtsnicht', status: 'umgesetzt' },
  ] }, { 'x-intern': 'ok' });
  assert.equal(r.status, 200); assert.equal(r.b.ok, false);
  assert.deepEqual(r.b.ergebnis.map((e: any) => e.ok), [true, false, false, false]);
  assert.match(r.b.ergebnis[1].fehler, /Grund/);
  const r2 = await rufe('POST', '/internal/deck/rueckmeldung', null, { deck: 'flex', conv: 'conv-deck', id: k2.id, status: 'abgelehnt', grund: 'widerspricht der Storyline' }, { 'x-intern': 'ok' });
  assert.equal(r2.b.ok, true);
  const n = await rufe('GET', '/api/v2/decks/flex', ADMIN);
  const a = n.b.kommentare.find((k: any) => k.id === k1.id), b = n.b.kommentare.find((k: any) => k.id === k2.id);
  assert.equal(a.status, 'umgesetzt'); assert.equal(a.erledigtIn, 'v2-1');
  assert.equal(b.status, 'abgelehnt'); assert.equal(b.grund, 'widerspricht der Storyline');
});

test('Status von Hand: nur Admin, Regeln aus decks.ts; wieder öffnen', async () => {
  const d = await rufe('GET', '/api/v2/decks/flex', ADMIN);
  const k = d.b.kommentare.find((x: any) => x.status === 'abgelehnt');
  assert.equal((await rufe('POST', `/api/v2/decks/flex/kommentar/${k.id}`, LISA, { status: 'offen' })).status, 403);
  assert.equal((await rufe('POST', `/api/v2/decks/flex/kommentar/${k.id}`, ADMIN, { status: 'gesendet' })).status, 400);
  assert.equal((await rufe('POST', `/api/v2/decks/flex/kommentar/${k.id}`, ADMIN, { status: 'offen' })).status, 200);
  assert.equal((await rufe('POST', '/api/v2/decks/flex/kommentar/k-nix', ADMIN, { status: 'offen' })).status, 404);
});

test('Teil-Link: Token nur einmal, gespeichert nur der Hash; nur dieses Deck; Ablauf und Widerruf; Name Pflicht; Kopf Pflicht', async () => {
  fundListe = [fund('flex', ['v1', 'v2']), fund('wirt', ['v1'])];
  await rufe('POST', '/api/v2/decks', ADMIN, { slug: 'wirt' }); await modul.warten();
  assert.equal((await rufe('POST', '/api/v2/decks/flex/links', LISA, { tage: 7 })).status, 403);
  const l = await rufe('POST', '/api/v2/decks/flex/links', ADMIN, { name: 'Peter', tage: 7 });
  assert.equal(l.status, 200);
  const token = l.b.token as string;
  const doc = await db.collection('deck_links').findOne({ _id: l.b.id as any });
  assert.equal(doc!.hash, tokenHash(token));
  assert.ok(!JSON.stringify(doc).includes(token), 'Token nicht in der Datenbank');
  assert.equal(JSON.stringify((await rufe('GET', '/api/v2/decks/flex', ADMIN)).b.links).includes(token), false, 'Token nie wieder ausgeliefert');

  const t = { 'x-deck-token': token };
  const g = await rufe('GET', '/api/deck-teilen', null, undefined, t);
  assert.equal(g.status, 200); assert.equal(g.b.slug, 'flex'); assert.equal(g.b.name, 'Peter');
  assert.equal(g.b.unterchat, undefined); assert.equal(g.b.links, undefined); assert.equal(g.b.fassungen[0].hashes, undefined);
  assert.ok(g.b.kommentare.every((k: any) => k.userId === undefined && k.linkId === undefined));
  assert.equal(g.b.kommentare.length, 0, 'extern zuerst nichts: keine internen Kommentare, keine Notizen');
  assert.equal((await rufe('GET', '/api/deck-teilen', null, undefined, { 'x-deck-token': 'x'.repeat(43) })).status, 404);
  assert.equal((await rufe('GET', '/api/deck-teilen', null)).status, 404);
  // Bild: nur Fassungen dieses Decks
  const bild = await rufe('GET', '/api/deck-teilen/bild/v2/1', null, undefined, t);
  assert.equal(bild.kopf['cache-control'], 'no-store', 'extern kein Cache');
  assert.equal(bild.status, 200); assert.match(String(bild.daten), /flex_v2.pdf 1/);
  assert.equal((await rufe('GET', `/api/deck-teilen/bild/v2/1?t=${token}`, null)).status, 404, 'Token in der Adresse gilt nicht');
  // Kommentar: Kopf, Name
  assert.equal((await rufe('POST', '/api/deck-teilen/kommentar', null, { name: 'Peter', folie: 1, text: 'Hallo' }, { ...t, 'x-werkbank': '0' })).status, 403);
  assert.equal((await rufe('POST', '/api/deck-teilen/kommentar', null, { name: '', folie: 1, text: 'Hallo' }, t)).status, 400);
  const k = await rufe('POST', '/api/deck-teilen/kommentar', null, { name: 'Peter M.', folie: 1, text: 'Hallo', notiz: true }, t);
  assert.equal(k.status, 200); assert.equal(k.b.kommentar.extern, true); assert.equal(k.b.kommentar.status, 'offen', 'extern nie Notiz');
  assert.equal((await db.collection('deck_kommentare').findOne({ _id: k.b.kommentar.id }))!.deck, 'flex', 'landet im Deck des Links');
  await db.collection('deck_kommentare').updateOne({ _id: k.b.kommentar.id }, { $set: { status: 'abgelehnt', grund: 'intern: Peter liegt falsch' } });
  const g2 = await rufe('GET', '/api/deck-teilen', null, undefined, t);
  assert.deepEqual(g2.b.kommentare.map((x: any) => [x.text, x.status, x.grund]), [['Hallo', 'abgelehnt', null]], 'nur eigene, mit Stand, ohne Grund');
  const fremd = await rufe('POST', '/api/v2/decks/flex/links', ADMIN, { name: 'Andere Firma' });
  assert.equal((await rufe('GET', '/api/deck-teilen', null, undefined, { 'x-deck-token': fremd.b.token })).b.kommentare.length, 0, 'Kommentare eines anderen Links unsichtbar');
  // Widerruf
  assert.equal((await rufe('POST', `/api/v2/decks/flex/links/${l.b.id}/widerrufen`, ADMIN)).b.widerrufen, 1);
  assert.equal((await rufe('GET', '/api/deck-teilen', null, undefined, t)).status, 404);
  assert.equal((await rufe('GET', '/api/deck-teilen/bild/v2/1', null, undefined, t)).status, 404);
  // Ablauf
  const l2 = await rufe('POST', '/api/v2/decks/wirt/links', ADMIN, { tage: 3 });
  await db.collection('deck_links').updateOne({ _id: l2.b.id }, { $set: { ablauf: new Date(Date.now() - 1000) } });
  assert.equal((await rufe('GET', '/api/deck-teilen', null, undefined, { 'x-deck-token': l2.b.token })).status, 404);
});

test('Rate-Limit: 30 Kommentare je Link in 10 min; Fehlversuche je Adresse gedeckelt', async () => {
  const l = await rufe('POST', '/api/v2/decks/wirt/links', ADMIN, { name: 'Last' });
  const t = { 'x-deck-token': l.b.token };
  let letzte = 0;
  for (let i = 0; i < 31; i++) letzte = (await rufe('POST', '/api/deck-teilen/kommentar', null, { name: 'Last', folie: 1, text: `n${i}` }, t)).status;
  assert.equal(letzte, 429);
  const stati: number[] = [];
  for (let i = 0; i < 62; i++) stati.push((await rufe('GET', '/api/deck-teilen', null, undefined, { 'x-deck-token': 'y'.repeat(43), 'x-ip': '9.9.9.9' })).status);
  assert.equal(stati[0], 404); assert.equal(stati.at(-1), 429);
  assert.equal((await rufe('GET', '/api/deck-teilen', null, undefined, { 'x-deck-token': 'y'.repeat(43), 'x-ip': '8.8.8.8' })).status, 404, 'andere Adresse nicht betroffen');
  // X-Forwarded-For: der erste Eintrag ist frei wählbar — gezählt wird der letzte (vom eigenen Proxy)
  const xff: number[] = [];
  for (let i = 0; i < 62; i++) xff.push((await rufe('GET', '/api/deck-teilen', null, undefined, { 'x-deck-token': 'z'.repeat(43), 'x-forwarded-for': `10.0.0.${i}, 7.7.7.7` })).status);
  assert.equal(xff.at(-1), 429, 'gefälschter erster Eintrag umgeht das Limit nicht');
});

test('Takt: neue Fassung in der Ablage wird gerendert (ältere nicht); offene gehen automatisch, aber höchstens alle 10 min', async () => {
  gerendert.length = 0;
  fundListe = [fund('flex', ['v0', 'v1', 'v2', 'v3'], [1, 2, 3, Date.now() + 1000]), fund('wirt', ['v1'])];
  await db.collection('deck_kommentare').insertOne({ _id: 'k-takt' as any, deck: 'flex', folie: 1, fassung: 'v2', text: 'auto', markierung: null, autor: 'Knut', extern: false, userId: 'k', linkId: null, status: 'offen', grund: null, at: new Date(), verlauf: [] });
  const vorher = gesendet.length;
  await modul.takt(); await modul.warten();
  assert.deepEqual(gerendert, ['/ablage/2026-11-06_deck_flex_v3.pdf'], 'nur die neuere Fassung, v0 nicht');
  assert.equal(gesendet.length, vorher, 'letzter Versand < 10 min → noch nicht');
  await db.collection('decks').updateOne({ _id: 'flex' as any }, { $set: { letzterVersand: new Date(Date.now() - 11 * 60_000), letzterVersuch: new Date(Date.now() - 11 * 60_000) } });
  await modul.takt();
  assert.equal(gesendet.length, vorher + 1);
  assert.match(gesendet.at(-1)!.text, /\[k-takt\]/);
  assert.equal(gesendet.at(-1)!.automatisch, true, 'Takt sendet wie der Hauptchat (Deckel/Abnahme gelten)');
  // Fehlschlag zählt als Versuch: nicht jede Minute erneut
  await db.collection('deck_kommentare').updateOne({ _id: 'k-takt' as any }, { $set: { status: 'offen' } });
  await db.collection('decks').updateOne({ _id: 'flex' as any }, { $set: { letzterVersand: null, letzterVersuch: null } });
  sendenFehler = new Error('Strang abcd1234 hat seinen Deckel erreicht');
  await modul.takt(); await modul.takt();
  sendenFehler = null;
  assert.equal(gesendet.length, vorher + 1, 'nach Fehlschlag kein zweiter Versuch im selben Fenster');
  assert.ok((await db.collection<any>('decks').findOne({ _id: 'flex' as any })).letzterVersuch);
  await db.collection('decks').updateOne({ _id: 'flex' as any }, { $set: { auto: false, letzterVersand: null, letzterVersuch: null } });
  await db.collection('deck_kommentare').updateOne({ _id: 'k-takt' as any }, { $set: { status: 'offen' } });
  await modul.takt();
  assert.equal(gesendet.length, vorher + 1, 'abgeschaltet → nichts');
  // von Hand: eine ältere Fassung nachrendern
  const r = await rufe('POST', '/api/v2/decks/flex/rendern', ADMIN, { fassung: 'v0' });
  assert.equal(r.b.rendern, 1); await modul.warten();
  assert.ok(existsSync(join(wurzel, 'flex', 'v0', 's-01.png')));
  assert.equal((await rufe('POST', '/api/v2/decks/flex/rendern', ADMIN, { fassung: 'v9' })).status, 404);
});

test('Einstellungen: automatisch aus/an, Unter-Chat ändern (nur 8-stellige Kennung)', async () => {
  assert.equal((await rufe('POST', '/api/v2/decks/flex/einstellungen', ADMIN, { unterchat: '../x' })).status, 400);
  assert.equal((await rufe('POST', '/api/v2/decks/flex/einstellungen', LISA, { auto: true })).status, 403);
  await rufe('POST', '/api/v2/decks/flex/einstellungen', ADMIN, { auto: true, unterchat: 'abcd1234' });
  const d = await rufe('GET', '/api/v2/decks/flex', ADMIN);
  assert.equal(d.b.auto, true); assert.equal(d.b.unterchat, 'abcd1234'); assert.ok(d.b.naechsterVersand);
});

/** Kleines PDF mit zwei Seiten (Text oben verschieden, Fußzeile gleich) — für das echte Rendern. */
function pdf(texte: string[]): Buffer {
  const obj: string[] = [];
  const seiten = texte.map((_, i) => 3 + i * 2);
  obj.push('<< /Type /Catalog /Pages 2 0 R >>');
  obj.push(`<< /Type /Pages /Kids [${seiten.map((n) => `${n} 0 R`).join(' ')}] /Count ${texte.length} >>`);
  texte.forEach((t, i) => {
    const inhalt = `BT /F1 40 Tf 60 300 Td (${t}) Tj ET BT /F1 10 Tf 60 10 Td (Fassung) Tj ET`;
    obj.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 640 360] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 ${3 + texte.length * 2} 0 R >> >> >>`);
    obj.push(`<< /Length ${inhalt.length} >>\nstream\n${inhalt}\nendstream`);
  });
  obj.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let s = '%PDF-1.4\n'; const off: number[] = [];
  obj.forEach((o, i) => { off.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = s.length;
  s += `xref\n0 ${obj.length + 1}\n0000000000 65535 f \n${off.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${obj.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(s, 'latin1');
}

test('Rendern echt (pdftoppm): Folien s-01…, Hash je Folie; gleiche Folie → gleicher Hash', async (t) => {
  const { rendernEcht, werkzeug } = await import('../server/deckroutes.ts');
  if (!existsSync(werkzeug('pdftoppm')) && werkzeug('pdftoppm') === 'pdftoppm') return t.skip('pdftoppm fehlt');
  const d = mkdtempSync(join(tmpdir(), 'deckpdf-'));
  writeFileSync(join(d, 'a.pdf'), pdf(['Eins', 'Zwei']));
  writeFileSync(join(d, 'b.pdf'), pdf(['Eins', 'Drei']));
  const a = await rendernEcht({ pdf: join(d, 'a.pdf'), pptx: null }, join(d, 'out', 'v1'));
  const b = await rendernEcht({ pdf: join(d, 'b.pdf'), pptx: null }, join(d, 'out', 'v2'));
  assert.equal(a.folien, 2);
  assert.ok(existsSync(join(d, 'out', 'v1', 's-01.png')) && existsSync(join(d, 'out', 'v1', 's-02.png')));
  assert.equal(a.hashes[0], b.hashes[0], 'Folie 1 gleich');
  assert.notEqual(a.hashes[1], b.hashes[1], 'Folie 2 geändert');
  const nochmal = await rendernEcht({ pdf: join(d, 'b.pdf'), pptx: null }, join(d, 'out', 'v1'));
  assert.equal(nochmal.folien, 2, 'Überschreiben einer Fassung geht');
  await assert.rejects(rendernEcht({ pdf: null, pptx: null }, join(d, 'out', 'v3')), /Keine Quelle/);
});

test('Download: Quelldatei der Fassung aus der Ablage (angemeldet und mit Teil-Link), sonst 404', async () => {
  const d0 = mkdtempSync(join(tmpdir(), 'deckdl-'));
  writeFileSync(join(d0, '2026-11-06_deck_flex_v2.pdf'), '%PDF-test');
  fundListe = [{ slug: 'flex', mtime: 1, fassungen: [{ fassung: 'v2', datum: '2026-11-06', pdf: join(d0, '2026-11-06_deck_flex_v2.pdf'), pptx: null, mtime: 1 }] }, fund('wirt', ['v1'])];
  const r = await rufe('GET', '/api/v2/decks/flex/datei/v2/pdf', LISA);
  assert.equal(r.status, 200); assert.equal(String(r.daten), '%PDF-test'); assert.match(r.kopf['content-disposition'], /attachment; filename="2026-11-06_deck_flex_v2.pdf"/);
  assert.equal((await rufe('GET', '/api/v2/decks/flex/datei/v2/pptx', LISA)).status, 404);
  assert.equal((await rufe('GET', '/api/v2/decks/flex/datei/v2/pdf', null)).status, 401);
  const d = await rufe('GET', '/api/v2/decks/flex', LISA);
  assert.deepEqual(d.b.fassungen.find((f: any) => f.fassung === 'v2'), { ...d.b.fassungen.find((f: any) => f.fassung === 'v2'), pdf: true, pptx: false });
  const l = await rufe('POST', '/api/v2/decks/flex/links', ADMIN, {});
  assert.equal((await rufe('GET', '/api/deck-teilen/datei/v2/pdf', null, undefined, { 'x-deck-token': l.b.token })).status, 200);
  const w = await rufe('POST', '/api/v2/decks/wirt/links', ADMIN, {});
  assert.equal((await rufe('GET', '/api/deck-teilen/datei/v2/pdf', null, undefined, { 'x-deck-token': w.b.token })).status, 404, 'Link eines anderen Decks');
});

test('Fassungsfolge nach Dateizeit: v7-skizze, dann v7-1 — v7-1 wird neu und aktuell (Altdeck Zwischengate)', async () => {
  const seit = Date.now();
  fundListe = [fund('zg', ['v6-2', 'v7-skizze'], [seit - 2000, seit - 1000])];
  await rufe('POST', '/api/v2/decks', ADMIN, { slug: 'zg', unterchat: 'abcd1234' }); await modul.warten();
  assert.equal((await rufe('GET', '/api/v2/decks/zg', ADMIN)).b.aktuell, 'v7-skizze');
  // der Unter-Chat legt v7-1 ab (Name sortiert vor v7-skizze, Datei ist neuer)
  fundListe = [fund('zg', ['v6-2', 'v7-skizze', 'v7-1'], [seit - 2000, seit - 1000, Date.now() + 5000])];
  await modul.takt(); await modul.warten();
  const d = await rufe('GET', '/api/v2/decks/zg', ADMIN);
  assert.equal(d.b.aktuell, 'v7-1');
  assert.deepEqual(d.b.fassungen.map((f: any) => f.fassung), ['v6-2', 'v7-skizze', 'v7-1']);
  // Zielname der nächsten Fassung: frei und nach der neuesten Datei
  await rufe('POST', '/api/v2/decks/zg/kommentar', ADMIN, { folie: 1, text: 'weiter' });
  await rufe('POST', '/api/v2/decks/zg/senden', ADMIN);
  assert.match(gesendet.at(-1)!.text, /_deck_zg_v7-2\.pptx/);
  // unveränderte Fassung nicht neu erzeugen (Kommentare und Markierungen gehören zu ihr)
  assert.equal((await rufe('POST', '/api/v2/decks/zg/rendern', ADMIN, { fassung: 'v7-1' })).status, 409);
});

test('Rückmeldung dreht keine Entscheidung, die Knut danach selbst getroffen hat', async () => {
  const d = await rufe('GET', '/api/v2/decks/zg', ADMIN);
  const k = d.b.kommentare.find((x: any) => x.status === 'gesendet');
  await rufe('POST', `/api/v2/decks/zg/kommentar/${k.id}`, ADMIN, { status: 'abgelehnt', grund: 'Knut: bleibt so' });
  const r = await rufe('POST', '/internal/deck/rueckmeldung', null, { deck: 'zg', conv: 'conv-deck', id: k.id, status: 'umgesetzt' }, { 'x-intern': 'ok' });
  assert.equal(r.b.ok, false);
  assert.equal((await rufe('GET', '/api/v2/decks/zg', ADMIN)).b.kommentare.find((x: any) => x.id === k.id).status, 'abgelehnt');
});

test('Teil-Link: Download nur PDF (keine bearbeitbare PowerPoint)', async () => {
  const l = await rufe('POST', '/api/v2/decks/zg/links', ADMIN, {});
  assert.ok(!routen.some(([m, re]) => m === 'GET' && re.test('/api/deck-teilen/datei/v7-1/pptx')));
  const g = await rufe('GET', '/api/deck-teilen', null, undefined, { 'x-deck-token': l.b.token });
  assert.ok(g.b.fassungen.every((f: any) => f.pptx === undefined));
});
