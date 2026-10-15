// Orchestrator-Lesezeichen (Release 4, Offen 4): zwei Stränge desselben Laufs legen „Orch · <Lauf>“ gleichzeitig an.
// Der nachgebaute LibreChat macht es wie v0.8.7 (packages/data-schemas/src/methods/conversationTag.ts):
// POST /api/tags = findOne, dann findOneAndUpdate mit upsert und `$set count: 0`; PUT /api/tags/convo/:id = `$inc count`
// je neuem Lesezeichen; eindeutiger Index (tag, user, tenantId). Das Zeitfenster zwischen findOne und Upsert ist hier
// für die zweite gleichzeitige Anlage gedehnt, damit der Wettlauf jedes Mal greift statt nur unter Volllast.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';
import { TEST_MONGO } from './testmongo.ts';

const tag = randomBytes(4).toString('hex');
const LCDB = `lc_lesezeichen_${tag}`, JWT_SECRET = randomBytes(16).toString('hex');
const knut = { _id: new ObjectId(), email: 'knut@example.test', username: 'knut' };
const uid = String(knut._id);
let mongo: MongoClient, lcFake: Server, o: typeof import('../server/orchestrator.ts'), db: typeof import('../server/db.ts');

before(async () => {
  mongo = await MongoClient.connect(TEST_MONGO);
  const L = mongo.db(LCDB);
  await L.collection('users').insertOne(knut);
  await L.collection('conversationtags').createIndex({ tag: 1, user: 1, tenantId: 1 }, { unique: true });
  const inFlight = new Map<string, number>(), second = new Map<string, () => void>();
  lcFake = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    const { verifyJwt } = await import('../server/auth.ts');
    const p = verifyJwt(String(req.headers.authorization ?? '').replace(/^Bearer /, ''), JWT_SECRET);
    const json = (status: number, j: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
    if (!p?.id) return json(401, {});
    const T = L.collection('conversationtags');
    try {
      if (req.url === '/api/convos/update') { await L.collection('conversations').updateOne({ conversationId: body.arg.conversationId, user: p.id }, { $set: { title: body.arg.title } }); return json(201, {}); }
      if (req.url === '/api/tags' && req.method === 'GET') return json(200, await T.find({ user: p.id }).sort({ position: 1 }).toArray());
      if (req.url === '/api/tags' && req.method === 'POST') {
        const existing = await T.findOne({ user: p.id, tag: body.tag });
        if (existing) return json(201, existing);
        // Erste Anlage wartet (≤ 1,5 s), bis eine zweite gleichzeitige eintrifft; die zweite schreibt erst, wenn die erste
        // samt PUT durch ist — genau die Reihenfolge, die unter Volllast zufällig entsteht.
        const n = inFlight.get(body.tag) ?? 0; inFlight.set(body.tag, n + 1);
        if (n === 0) await new Promise<void>((r) => { second.set(body.tag, r); setTimeout(r, 1500); });
        else { second.get(body.tag)?.(); await new Promise((r) => setTimeout(r, 800)); }
        const max: any = await T.find({ user: p.id }).sort({ position: -1 }).limit(1).next();
        const t = await T.findOneAndUpdate({ tag: body.tag, user: p.id },
          { $set: { tag: body.tag, user: p.id, count: 0, position: (max?.position || 0) + 1, description: body.description }, $setOnInsert: { createdAt: new Date() } },
          { upsert: true, returnDocument: 'after' });
        return json(201, t);
      }
      const m = req.url!.match(/^\/api\/tags\/convo\/(.+)$/);
      if (m && req.method === 'PUT') {
        const conversationId = decodeURIComponent(m[1]);
        const c: any = await L.collection('conversations').findOne({ user: p.id, conversationId });
        if (!c) return json(500, 'Error updating conversation tags');
        const old = new Set<string>(c.tags ?? []), neu = new Set<string>(body.tags);
        for (const t of neu) if (!old.has(t)) await T.updateOne({ user: p.id, tag: t }, { $inc: { count: 1 } }, { upsert: true });
        for (const t of old) if (!neu.has(t)) await T.updateOne({ user: p.id, tag: t }, { $inc: { count: -1 } });
        await L.collection('conversations').updateOne({ user: p.id, conversationId }, { $set: { tags: [...neu] } });
        return json(200, [...neu]);
      }
      json(404, {});
    } catch { json(500, 'Error'); } // wie LibreChat: E11000 u. a. → 500
  });
  await new Promise<void>((r) => lcFake.listen(0, '127.0.0.1', () => r()));
  Object.assign(process.env, { MONGO_URI_WERKBANK: TEST_MONGO, WERKBANK_DB: `wb_lesezeichen_${tag}`, LIBRECHAT_DB: LCDB, JWT_SECRET,
    LIBRECHAT_URL: `http://127.0.0.1:${(lcFake.address() as any).port}` });
  db = await import('../server/db.ts');
  await db.connect();
  o = await import('../server/orchestrator.ts');
});

after(async () => {
  lcFake?.close();
  await mongo?.db(LCDB).dropDatabase(); await mongo?.db(`wb_lesezeichen_${tag}`).dropDatabase();
  await mongo?.close(); await db?.closeDb();
});

test('Lauf-Lesezeichen: zwei Stränge gleichzeitig → genau ein Lesezeichen, Zählung 2', async () => {
  const L = mongo.db(LCDB);
  const convs = ['conv-a', 'conv-b'];
  await L.collection('conversations').insertMany(convs.map((conversationId) => ({ conversationId, user: uid, title: 'New Chat', tags: [] })));
  const u = { id: uid, email: knut.email, name: 'Knut' } as any;
  const lt = o.laufTag('Wettlauf');
  const r = await Promise.all(convs.map((c, i) => o.decorate(u, c, `Teil ${i}`, lt)));
  assert.deepEqual(r.map((x) => x.ok), [true, true], JSON.stringify(r));
  const docs = await L.collection('conversationtags').find({ user: uid, tag: lt }).toArray();
  assert.equal(docs.length, 1, 'genau ein Lesezeichen');
  assert.equal(docs[0].count, 2, 'Zählung: zwei Unterhaltungen');
  for (const c of convs) assert.deepEqual((await L.collection('conversations').findOne({ conversationId: c }))!.tags, [lt]);
  // Beschreibung und Platz in der Liste wie bei LibreChats eigener Anlage.
  assert.equal(docs[0].description, lt);
  assert.equal(docs[0].position, 1);
  // Nochmal: idempotent, nichts doppelt gezählt.
  await Promise.all(convs.map((c, i) => o.decorate(u, c, `Teil ${i}`, lt)));
  assert.equal((await L.collection('conversationtags').findOne({ user: uid, tag: lt }))!.count, 2);
  // Ein zweites Lesezeichen bekommt den nächsten Platz und die Beschreibung aus TAG_TEXT.
  await o.decorate(u, 'conv-a', 'Teil 0', o.ORCH_TAG);
  const orchTag: any = await L.collection('conversationtags').findOne({ user: uid, tag: o.ORCH_TAG });
  assert.equal(orchTag.position, 2); assert.equal(orchTag.count, 1); assert.match(orchTag.description, /Unter-Chats, die der Hauptchat/);
});

test('Lauf-Lesezeichen unter Last: acht Stränge gleichzeitig → ein Lesezeichen, Zählung 8', async () => {
  const L = mongo.db(LCDB);
  const convs = Array.from({ length: 8 }, (_, i) => `last-${i}`);
  await L.collection('conversations').insertMany(convs.map((conversationId) => ({ conversationId, user: uid, title: 'New Chat', tags: [] })));
  const u = { id: uid, email: knut.email, name: 'Knut' } as any;
  const lt = o.laufTag('Volllast');
  const r = await Promise.all(convs.map((c) => o.decorate(u, c, c, lt)));
  assert.ok(r.every((x) => x.ok), JSON.stringify(r));
  const docs = await L.collection('conversationtags').find({ user: uid, tag: lt }).toArray();
  assert.equal(docs.length, 1);
  assert.equal(docs[0].count, 8);
});
