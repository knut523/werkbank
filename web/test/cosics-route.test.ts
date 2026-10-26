// ICS-Feed (Paket 374, Strang E): Route /api/cos/ics?token=… — Schalter COS_ICS (Vorgabe aus), persönlicher Token statt
// Session (Kalender-Clients können nicht loginn), nur Admin legt den Token an. Eigener Server wie api.test.ts, aber
// klein: ohne Jira/Brücke — der Feed braucht Register und Mongo, nichts anderes.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, cpSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { MongoClient, ObjectId } from 'mongodb';

const WEB = new URL('..', import.meta.url).pathname;
const PORT = Number(process.env.WERKBANK_TEST_PORT_ICS || 3671);
const B = `http://127.0.0.1:${PORT}`;
const tag = randomBytes(4).toString('hex');
const DB = `werkbank_ics_test_${tag}`, LCDB = `librechat_ics_test_${tag}`;
const tmp = mkdtempSync(join(tmpdir(), 'werkbank-ics-'));
const VAULT = join(tmp, 'vault');
const INTERNAL = randomBytes(16).toString('hex'), REFRESH_SECRET = randomBytes(16).toString('hex'), JWT_SECRET = randomBytes(16).toString('hex');
const users = {
  a: { _id: new ObjectId(), email: 'anna@maxenergy.at', name: 'Anna Test', pw: 'pw-anna' },
  b: { _id: new ObjectId(), email: 'bernd@maxenergy.at', name: 'Bernd Test', pw: 'pw-bernd' },
};
let web: ChildProcess, lcFake: Server, mongo: MongoClient;

async function waitFor(url: string) {
  for (let i = 0; i < 80; i++) { try { if ((await fetch(url)).status < 500) return; } catch { /* startet */ } await new Promise((r) => setTimeout(r, 150)); }
  throw new Error('startet nicht: ' + url);
}

const envBase = () => ({
  ...process.env, WERKBANK_PORT: String(PORT), WERKBANK_DEMO: '1', WERKBANK_NO_JOBS: '1', WERKBANK_INSECURE_COOKIES: '1',
  WERKBANK_VAULT_DIR: VAULT, WERKBANK_DB: DB, LIBRECHAT_DB: LCDB, LIBRECHAT_URL: `http://127.0.0.1:${(lcFake.address() as any).port}`,
  LIBRECHAT_PUBLIC_URL: 'https://chat.example', WERKBANK_ALLOWED_EMAILS: `${users.a.email},${users.b.email}`,
  WERKBANK_INTERNAL_TOKEN: INTERNAL, JWT_SECRET, JWT_REFRESH_SECRET: REFRESH_SECRET,
  CREDS_KEY: randomBytes(32).toString('hex'), CREDS_IV: randomBytes(16).toString('hex'), WERKBANK_CREDS_KEY: randomBytes(32).toString('hex'),
  WERKBANK_DATA_DIR: join(tmp, 'data'), WERKBANK_DOCS_DIR: join(tmp, 'dokumente'), WERKBANK_REVIEW_DIR: join(tmp, 'pakete'),
  WERKBANK_VAULT_SYNC_DIR: join(tmp, 'vault-sync'), WERKBANK_VAULT_SYNC_SCRIPT: join(tmp, 'fake-vault-sync.sh'),
  WERKBANK_PUBLIC_URL: 'http://127.0.0.1:3670',
});

before(async () => {
  cpSync(new URL('./fixtures/vault', import.meta.url).pathname, VAULT, { recursive: true });
  writeFileSync(join(tmp, 'fake-vault-sync.sh'), '#!/bin/bash\nexit 0\n');
  mongo = await MongoClient.connect(TEST_MONGO);
  await mongo.db(LCDB).collection('users').insertMany(Object.values(users).map(({ pw, ...u }) => u));
  lcFake = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    const { email, password } = JSON.parse(b || '{}');
    const u = Object.values(users).find((x) => x.email === email && x.pw === password);
    res.writeHead(u ? 200 : 401, { 'content-type': 'application/json' });
    res.end(JSON.stringify(u ? { token: 'jwt', user: { _id: String(u._id), email: u.email, name: u.name, role: 'USER' } } : { message: 'nope' }));
  });
  await new Promise<void>((r) => lcFake.listen(0, '127.0.0.1', () => r()));
  web = spawn(process.execPath, ['server/main.ts'], { cwd: WEB, env: envBase(), stdio: ['ignore', 'ignore', 'inherit'] });
  await waitFor(`${B}/api/health`);
});

after(async () => {
  web?.kill();
  lcFake?.close();
  await mongo.db(DB).dropDatabase(); await mongo.db(LCDB).dropDatabase(); await mongo.close();
});

class Client {
  cookie = '';
  async req(path: string, opts: { method?: string; body?: unknown } = {}) {
    const method = opts.method ?? (opts.body !== undefined ? 'POST' : 'GET');
    const r = await fetch(B + path, {
      method,
      headers: { cookie: this.cookie, ...(method === 'GET' ? {} : { 'x-werkbank': '1' }), ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const text = await r.text();
    let j: any; try { j = JSON.parse(text); } catch { j = text; }
    return { status: r.status, j, text };
  }
  async login(u: { email: string; pw: string }) { return this.req('/api/login', { body: { email: u.email, password: u.pw } }); }
}

const anna = new Client(), bernd = new Client();
const COS_DIR = () => join(VAULT, 'olaf/1-Projects/chief-of-staff');
const REG = () => join(COS_DIR(), 'zusagen-register.md');

/** Zweiter Server mit COS_ICS=an — derselbe Vault, dieselbe DB (Token liegt in user_prefs). */
test('ICS-Feed: Schalter aus → 404; an → Token-Link nur Admin, Feed mit Terminen und Fristen (RFC 5545), falscher Token 403', async () => {
  // Register mit einem Termin und zwei Zusagen (eine offen mit Frist, eine erledigt) direkt in den Vault schreiben.
  mkdirSync(COS_DIR(), { recursive: true });
  writeFileSync(REG(), [
    '---', 'title: "Zusagen-Register"', 'type: project', 'team: olaf', 'area: product', 'status: current', 'created: 2026-10-26', 'tags: [register]', '---', '',
    '# Zusagen-Register', '',
    '## Offen', '',
    '- **Z-001** · Christoph Bitzner → Knut · Belieferungsstatus in den Report · bis 2026-10-23 · Thema: Cockpit',
    '- **Z-002** · Knut → Team · Blueprint zeigen · bis 2026-11-06 · Thema: Cockpit',
    '', '## Erledigt', '',
    '- **Z-003** · Team → Knut · alte Sache · bis 2026-10-01 · erledigt 2026-10-02',
    '', '## Termine', '',
    '- Termin Fr 23.10. 10:00 Rogue: Vertrag · mit: Christoph, Knut',
    '- 2026-11-03 Flex-Validierung · mit: Anna',
    '', '## Personen', '',
    '- Christoph Bitzner: Partner', '- Knut: Intern', '',
  ].join('\n'));
  await anna.login(users.a); await bernd.login(users.b);
  await mongo.db(DB).collection('sessions').updateMany({ email: users.a.email }, { $set: { role: 'ADMIN' } });
  await mongo.db(LCDB).collection('users').updateOne({ _id: users.a._id }, { $set: { role: 'ADMIN' } });

  // Schalter aus (Vorgabe): Route „an“ und Feed antworten mit aus — 404, ohne das Token zu prüfen.
  assert.equal((await anna.req('/api/cos/ics/link')).j.an, false);
  assert.equal((await fetch(`${B}/api/cos/ics?token=egal`)).status, 404);
  // Kein Token liegt an: nur der Link-Weg legt eines an (auch mit Schalter aus nichts in user_prefs).
  assert.equal(await mongo.db(DB).collection('user_prefs').countDocuments({ _id: 'cos.ics' as any }), 0);

  // Zweiter Server mit COS_ICS=an (dieselbe Vault-Kopie und DB).
  const PORT2 = PORT + 1;
  const web2 = spawn(process.execPath, ['server/main.ts'], { cwd: WEB, env: { ...envBase(), WERKBANK_PORT: String(PORT2), COS_ICS: 'an' }, stdio: ['ignore', 'ignore', 'inherit'] });
  try {
    await waitFor(`http://127.0.0.1:${PORT2}/api/health`);
    const get = (p: string, cookie = '') => fetch(`http://127.0.0.1:${PORT2}${p}`, { headers: cookie ? { cookie } : {} }).then(async (r) => ({ status: r.status, ct: r.headers.get('content-type'), t: await r.text() }));
    // Feed ohne Token → 403; falscher Token → 403; ohne Login geht der Feed-Link nicht (401).
    assert.equal((await get('/api/cos/ics')).status, 403);
    assert.equal((await get('/api/cos/ics?token=falsch')).status, 403);
    const link = await fetch(`http://127.0.0.1:${PORT2}/api/cos/ics/link`, { headers: { cookie: bernd.cookie } });
    assert.equal(link.status, 403, 'Link nur Admin');
    const annaLink = await (await fetch(`http://127.0.0.1:${PORT2}/api/cos/ics/link`, { headers: { cookie: anna.cookie } })).json();
    assert.equal(annaLink.an, true);
    assert.match(annaLink.url, /^http:\/\/127\.0\.0\.1:3670\/api\/cos\/ics\?token=cos-[0-9a-f]{16}$/, 'persönlicher Feed-Link aus publicUrl + Token');
    // Gleicher Aufruf liefert denselben Token (kein Neuanlegen).
    const nochmal = await (await fetch(`http://127.0.0.1:${PORT2}/api/cos/ics/link`, { headers: { cookie: anna.cookie } })).json();
    assert.equal(nochmal.url, annaLink.url);
    // Feed: gültiges ICS mit Termin (mit Uhrzeit, TZID) und Frist (All-Day); Erledigtes fehlt.
    const feed = await get(`/api/cos/ics?token=${new URL(annaLink.url).searchParams.get('token')}`);
    assert.equal(feed.status, 200);
    assert.match(feed.ct!, /^text\/calendar/);
    const ics = feed.t;
    assert.match(ics, /BEGIN:VCALENDAR\r\n/);
    assert.match(ics, /BEGIN:VTIMEZONE\r\n/);
    assert.ok(ics.includes('DTSTART;TZID=Europe/Vienna:20261023T100000'), 'Termin mit Uhrzeit');
    assert.ok(ics.includes('DTSTART;VALUE=DATE:20261023'), 'Frist Z-001 als All-Day');
    assert.ok(ics.includes('DTSTART;VALUE=DATE:20261106'), 'Frist Z-002 als All-Day');
    assert.ok(!ics.includes('Z-003'), 'erledigte Zusage kein Event');
    assert.match(ics, /END:VCALENDAR\r\n$/);
    for (const z of ics.split('\r\n')) assert.ok(Buffer.byteLength(z, 'utf8') <= 75, 'Zeilenlänge RFC 5545');
  } finally { web2.kill(); }
  await mongo.db(DB).collection('sessions').updateMany({ email: users.a.email }, { $set: { role: 'USER' } });
  await mongo.db(LCDB).collection('users').updateOne({ _id: users.a._id }, { $unset: { role: '' } });
});
