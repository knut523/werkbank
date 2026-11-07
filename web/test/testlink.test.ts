// Test-Links (docs/plan-testlinks.md): Profile, harte Prüfungen (nur lokale Test-DB, keine Prod/UAT-Adressen), Ports, Cookie-Signatur,
// Proxy (Sitzung, Host, Ablauf, Streaming, statisch), Lebenszyklus mit echtem Proxy und Attrappen-Profilen, Routen ohne Geheimnisse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import * as tl from '../server/testlink.ts';
import { cookieZeile, hostErlaubt, statischeDatei, proxyServer } from '../server/testlink-proxy.ts';
import { registerTestlinks, testlinkIntern, zielOrdner, type TestlinkDeps } from '../server/testlinkroutes.ts';

process.env.WERKBANK_TESTLINK_PORTE = '38600-38699';
const tmp = (p = 'tl-') => mkdtempSync(join(tmpdir(), p));
const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));
const get = (port: number, pfad: string, headers: Record<string, string> = {}) => new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((ok, nein) => {
  http.get({ host: '127.0.0.1', port, path: pfad, headers }, (r) => { let b = ''; r.on('data', (c) => (b += c)); r.on('end', () => ok({ status: r.statusCode ?? 0, body: b, headers: r.headers })); }).on('error', nein);
});

test('Profil: olaf-admin, Tarif-App, Werkbank-Checkout, statische Seite (dist vor Ordner), sonst keins; Unterordner zählt mit der Git-Wurzel', () => {
  const a = tmp(); writeFileSync(join(a, 'package.json'), JSON.stringify({ name: 'olaf-admin' }));
  assert.deepEqual(tl.profilVon(a, () => null), { profil: 'olaf-admin', wurzel: a });
  const t = tmp(); writeFileSync(join(t, 'package.json'), JSON.stringify({ name: 'olaf-tariff-app' }));
  assert.equal(tl.profilVon(t, () => null)?.profil, 'olaf-tariff-app');
  const w = tmp(); mkdirSync(join(w, 'scripts')); mkdirSync(join(w, 'web', 'server'), { recursive: true });
  writeFileSync(join(w, 'scripts', 'isoliert.sh'), ''); writeFileSync(join(w, 'web', 'server', 'main.ts'), ''); writeFileSync(join(w, 'web', 'index.html'), '');
  assert.equal(tl.profilVon(w, () => null)?.profil, 'werkbank');
  assert.equal(tl.profilVon(join(w, 'web'), () => w)?.profil, 'werkbank', 'Unterordner eines Werkbank-Checkouts');
  const s = tmp(); mkdirSync(join(s, 'dist')); writeFileSync(join(s, 'dist', 'index.html'), '<h1>x</h1>'); writeFileSync(join(s, 'index.html'), 'roh');
  assert.deepEqual(tl.profilVon(s, () => null), { profil: 'statisch', wurzel: join(s, 'dist') });
  const leer = tmp(); writeFileSync(join(leer, 'package.json'), JSON.stringify({ name: 'irgendwas' }));
  assert.equal(tl.profilVon(leer, () => null), null);
});

test('Kennung und DB-Name: lesbar, stabil je Pfad, verschieden je Pfad; DB-Name besteht die harte Prüfung', () => {
  const a = tl.umgebungsId('/home/k/work/knut/olaf-admin-bot-vorschau');
  assert.match(a, /^olaf-admin-bot-vorschau-[0-9a-f]{6}$/);
  assert.equal(a, tl.umgebungsId('/home/k/work/knut/olaf-admin-bot-vorschau'));
  assert.notEqual(a, tl.umgebungsId('/home/k/work/olaf-admin-bot-vorschau'));
  assert.doesNotThrow(() => tl.testDbPruefen({ host: '127.0.0.1', port: 55433, name: tl.dbName(a) }));
  assert.doesNotThrow(() => tl.testDbPruefen({ host: '127.0.0.1', port: 55433, name: tl.dbName(a, '/home/k/work/werkbank-dev/.runtime/testlinks') }));
  assert.notEqual(tl.dbName(a, '/live/testlinks'), tl.dbName(a, '/iso/testlinks'), 'Live und Testkopie teilen keine Test-DB');
});

test('Harte Prüfung Test-DB: nur lokal, nur 55433, nur olaf_tl_…, nichts mit prod/uat', () => {
  assert.doesNotThrow(() => tl.testDbPruefen({ host: 'localhost', port: 55433, name: 'olaf_tl_x_1' }));
  assert.throws(() => tl.testDbPruefen({ host: 'olaf-uat-pg.postgres.database.azure.com', port: 55433, name: 'olaf_tl_x' }), /nur lokal/);
  assert.throws(() => tl.testDbPruefen({ host: '10.0.0.5', port: 55433, name: 'olaf_tl_x' }), /nur lokal/);
  assert.throws(() => tl.testDbPruefen({ host: '127.0.0.1', port: 5432, name: 'olaf_tl_x' }), /55433/);
  assert.throws(() => tl.testDbPruefen({ host: '127.0.0.1', port: 55433, name: 'olaf' }), /olaf_tl_/);
  assert.throws(() => tl.testDbPruefen({ host: '127.0.0.1', port: 55433, name: 'olaf_akte' }), /olaf_tl_/);
  assert.throws(() => tl.testDbPruefen({ host: '127.0.0.1', port: 55433, name: 'olaf_tl_prod_kopie' }), /Prod\/UAT/);
});

test('Umgebung: Prod/UAT/Azure und fremde Adressen werden geleert (Schlüssel ohne Werte gemeldet), Lokales und Vorschau bleiben', () => {
  const env = tl.dotenvLesen([
    'DB_HOST=olaf-prod-pg.postgres.database.azure.com', 'export DATABASE_URL="postgresql://u:p@olaf-uat.postgres.database.azure.com:5432/olaf"',
    'HUB_URL=https://olaf-hub.azurewebsites.net/api', 'PII_DATA_KEYS=@Microsoft.KeyVault(SecretUri=https://kv.vault.azure.net/secrets/x)',
    'LOCAL_API_URL=http://127.0.0.1:8078', 'BETTER_AUTH_URL=https://3601--main--dev--knut.ws.konekto.energy', 'APP_NAME=olaf-uat-admin',
    "BOT_OTP_PEPPER='geheim wert' # Kommentar", 'MAX_ITEMS=50 # Kommentar', 'NEXT_PUBLIC_VERSION=1.2.3', 'CALC_API_URL=https://calc.example.com',
  ].join('\n'));
  assert.equal(env.BOT_OTP_PEPPER, 'geheim wert');
  assert.equal(env.MAX_ITEMS, '50');
  const r = tl.envPruefen(env);
  assert.deepEqual(r.geleert, ['APP_NAME', 'CALC_API_URL', 'DATABASE_URL', 'DB_HOST', 'HUB_URL', 'PII_DATA_KEYS']);
  for (const k of r.geleert) assert.equal(r.env[k], '', k);
  assert.equal(r.env.LOCAL_API_URL, 'http://127.0.0.1:8078');
  assert.equal(r.env.BETTER_AUTH_URL, 'https://3601--main--dev--knut.ws.konekto.energy');
  assert.equal(r.env.NEXT_PUBLIC_VERSION, '1.2.3', 'Versionsnummern sind keine Adressen');
  assert.equal(tl.envPruefen(env, ['calc.example.com']).env.CALC_API_URL, 'https://calc.example.com', 'ausdrücklich erlaubter Host bleibt');
});

test('Sitzungs-Cookie: dieselbe Signatur wie test-login.py (better-auth, HMAC-SHA256, base64, URL-kodiert)', () => {
  assert.equal(tl.betterAuthCookie('knut-test-session-token', 'better-auth-secret-12345678901234567890'), 'knut-test-session-token.omf94GPHiKT79ZC8OnuEweIb92y5quAF9%2F4IpQcfEO0%3D');
});

test('Vorschau-Link aus der Coder-Umgebung (Muster coder-preview-links)', () => {
  assert.equal(tl.vorschauUrl(3601, { CODER_WORKSPACE_NAME: 'dev', CODER_WORKSPACE_OWNER_NAME: 'knut' } as any), 'https://3601--main--dev--knut.ws.konekto.energy');
  assert.equal(tl.vorschauUrl(3601, { CODER_WORKSPACE_NAME: 'pilot', CODER_WORKSPACE_OWNER_NAME: 'luka', CODER_WORKSPACE_AGENT_NAME: 'a' } as any), 'https://3601--a--pilot--luka.ws.konekto.energy');
});

test('Ports: Bereich aus der Einstellung, belegte und vergebene übersprungen; Werkbank bekommt einen ganzen Block', async () => {
  assert.deepEqual(tl.portBereich('3700-3799'), [3700, 3799]);
  assert.deepEqual(tl.portBereich('quatsch'), [3600, 3699]);
  const besetzt = new Set([3600, 3602]);
  const frei = async (p: number) => !besetzt.has(p);
  assert.deepEqual(await tl.portsWaehlen('olaf-admin', [3600, 3699], new Set([3601]), frei), { proxy: 3604, app: 3603, basis: null });
  assert.deepEqual(await tl.portsWaehlen('statisch', [3600, 3699], new Set(), frei), { proxy: 3601, app: null, basis: null });
  const w = await tl.portsWaehlen('werkbank', [3600, 3699], new Set(), frei);
  assert.equal(w.basis, 3601); assert.equal(w.app, 3601);
  assert.ok(!tl.isoPorts(3601).includes(w.proxy), 'Proxy nicht im Block');
  await assert.rejects(tl.portsWaehlen('olaf-admin', [3600, 3601], new Set(), async () => false), /Kein freier Port/);
});

test('Logauszug: Geheimnisse und Schlüssel=Wert-Muster geschwärzt', () => {
  const t = tl.schwaerzen('start secret=abc123def token: xyz987654 ok\nBETTER_AUTH_SECRET=s3cr3t-wert-lang\ncookie=foo\nnormal 200', ['s3cr3t-wert-lang']);
  assert.doesNotMatch(t, /abc123def|xyz987654|s3cr3t-wert-lang|cookie=foo/);
  assert.match(t, /normal 200/);
});

test('Prozesse: nur eigene (PID + Startzeit) werden beendet, samt Gruppe; fremde Startzeit → nichts', async () => {
  const d = tmp();
  const p = tl.dauerprozess('test', 'sh', ['-c', 'sleep 30 & sleep 30'], { cwd: d, env: tl.grundEnv(), log: join(d, 'l.log') });
  assert.ok(tl.lebt(p));
  assert.equal(await tl.beenden({ ...p, start: 'falsch' }), false, 'fremde Startzeit: nicht angefasst');
  assert.ok(tl.lebt(p));
  assert.equal(await tl.beenden(p), true);
  await warte(200);
  assert.equal(tl.lebt(p), false);
});

test('Kindprozesse bekommen keine Werkbank-Geheimnisse', () => {
  const e = tl.grundEnv({ PATH: '/usr/bin', HOME: '/h', WERKBANK_INTERNAL_TOKEN: 'x', WERKBANK_CREDS_KEY: 'y', MELIOUS_API_KEY: 'z', CODER_WORKSPACE_NAME: 'dev' } as any);
  assert.equal(e.HOME, '/h'); assert.equal(e.CODER_WORKSPACE_NAME, 'dev');
  for (const k of ['WERKBANK_INTERNAL_TOKEN', 'WERKBANK_CREDS_KEY', 'MELIOUS_API_KEY']) assert.equal(e[k], undefined, k);
});

test('Wurzeln: nur unter den Arbeitswurzeln, nie in versteckten Zugangsordnern', () => {
  assert.equal(tl.wurzelErlaubt('/w/knut/olaf-admin', '/w'), true);
  assert.equal(tl.wurzelErlaubt('/w2/x', '/w'), false);
  assert.equal(tl.wurzelErlaubt('/etc', '/w'), false);
  assert.equal(tl.wurzelErlaubt('/w/.ssh/x', '/w'), false);
});

test('Proxy-Regeln: Test-Cookie vorn, gleichnamige Browser-Cookies raus; Host nur Vorschau oder lokal; statisch nie außerhalb der Wurzel', () => {
  const ck = [{ name: 'wb_session', value: 'T' }];
  assert.equal(cookieZeile('a=1; wb_session=alt; b=2', ck), 'wb_session=T; a=1; b=2');
  assert.equal(cookieZeile(undefined, ck), 'wb_session=T');
  const cfg = { host: '3601--main--dev--knut.ws.konekto.energy', listen: 3601 };
  assert.ok(hostErlaubt(cfg.host, undefined, cfg));
  assert.ok(hostErlaubt('127.0.0.1:3601', undefined, cfg));
  assert.ok(hostErlaubt('127.0.0.1:3601', cfg.host, cfg), 'Coder-Vorschau mit X-Forwarded-Host');
  assert.ok(!hostErlaubt('evil.example', undefined, cfg));
  assert.ok(!hostErlaubt('127.0.0.1:3601', 'evil.example', cfg));
  assert.ok(!hostErlaubt('127.0.0.1:9999', undefined, cfg));
  const w = tmp(); writeFileSync(join(w, 'index.html'), 'hallo'); mkdirSync(join(w, 'a')); writeFileSync(join(w, 'a', 'x.css'), 'x');
  const aussen = tmp(); writeFileSync(join(aussen, 'geheim.txt'), 'nein'); symlinkSync(join(aussen, 'geheim.txt'), join(w, 'link.txt'));
  assert.equal(statischeDatei(w, '/'), join(w, 'index.html'));
  assert.equal(statischeDatei(w, '/a/x.css?v=1'), join(w, 'a', 'x.css'));
  assert.equal(statischeDatei(w, '/../' + aussen.split('/').pop() + '/geheim.txt'), null);
  assert.equal(statischeDatei(w, '/%2e%2e/etc/passwd'), null);
  assert.equal(statischeDatei(w, '/link.txt'), null, 'Symlink nach draußen');
  assert.equal(statischeDatei(w, '/fehlt.html'), null);
});

test('Proxy: hängt die Sitzung an, setzt Vorschau-Host, streamt (SSE), schreibt Weiterleitungen um, 403 fremder Host, 410 nach Ablauf, WebSocket-Upgrade', async () => {
  const gesehen: { cookie?: string; host?: string; proto?: string }[] = [];
  const up = http.createServer((req, res) => {
    gesehen.push({ cookie: req.headers.cookie, host: req.headers.host, proto: req.headers['x-forwarded-proto'] as string });
    if (req.url === '/sse') { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: eins\n\n'); setTimeout(() => res.end('data: zwei\n\n'), 400); return; }
    if (req.url === '/weiter') { res.writeHead(307, { location: `http://127.0.0.1:${(up.address() as any).port}/ziel` }); res.end(); return; }
    res.writeHead(200); res.end('ok');
  });
  up.on('upgrade', (req, sock, head) => { sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Cookie: ${req.headers.cookie}\r\n\r\n`); if (head.length) sock.write(head); sock.on('data', (d) => sock.write(d)); });
  const offen = new Set<net.Socket>();
  up.on('connection', (c) => offen.add(c));
  await new Promise<void>((r) => up.listen(0, '127.0.0.1', r));
  const upPort = (up.address() as any).port;
  const host = 'p--main--dev--knut.ws.konekto.energy';
  const px = proxyServer({ listen: 0, upstream: upPort, statisch: null, cookies: [{ name: 'wb_session', value: 'TOK' }], ablauf: new Date(Date.now() + 864e5).toISOString(), host });
  px.on('connection', (c) => offen.add(c));
  await new Promise<void>((r) => px.listen(0, '127.0.0.1', r));
  const pp = (px.address() as any).port;
  const r = await get(pp, '/x', { host, cookie: 'wb_session=alt; a=1' });
  assert.equal(r.status, 200); assert.equal(r.body, 'ok');
  assert.equal(gesehen[0].cookie, 'wb_session=TOK; a=1'); assert.equal(gesehen[0].host, host); assert.equal(gesehen[0].proto, 'https');
  assert.equal((await get(pp, '/x', { host: 'evil.example' })).status, 403);
  const w = await get(pp, '/weiter', { host });
  assert.equal(w.status, 307); assert.equal(w.headers.location, '/ziel');
  // SSE: das erste Ereignis kommt vor dem Ende der Antwort an (kein Puffern)
  const erst = await new Promise<number>((ok) => { const t0 = Date.now(); http.get({ host: '127.0.0.1', port: pp, path: '/sse', headers: { host } }, (res) => res.once('data', () => { ok(Date.now() - t0); res.resume(); })); });
  assert.ok(erst < 350, `erstes SSE-Ereignis nach ${erst} ms`);
  // WebSocket-Upgrade mit Sitzung
  const ws = await new Promise<string>((ok) => { const s = net.connect(pp, '127.0.0.1', () => s.write(`GET /ws HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nping`)); let b = ''; s.on('data', (d) => { b += d; if (b.includes('ping')) { s.destroy(); ok(b); } }); });
  assert.match(ws, /101 Switching/); assert.match(ws, /X-Cookie: wb_session=TOK/); assert.match(ws, /ping/);
  px.close();
  const alt = proxyServer({ listen: 0, upstream: upPort, statisch: null, cookies: [], ablauf: new Date(Date.now() - 1000).toISOString(), host });
  await new Promise<void>((r2) => alt.listen(0, '127.0.0.1', r2));
  const a = await get((alt.address() as any).port, '/x', { host });
  assert.equal(a.status, 410); assert.match(a.body, /abgelaufen/);
  alt.close(); up.close();
  for (const c of offen) c.destroy();   // Keep-Alive- und WebSocket-Verbindungen, sonst bleibt der Testlauf offen
});

// ---------- Lebenszyklus mit echtem Proxy-Prozess ----------

const U = { id: 'k', email: 'knut@example.test', name: 'Knut', role: 'ADMIN' } as any;
function deps(ablage = tmp('tl-ablage-'), extra: Partial<tl.Deps> = {}): tl.Deps { return { ablage, warteMs: 15_000, abstandMs: 200, ...extra }; }

test('Statische Seite: Start → Proxy läuft, Gesundheit 200, Link + lokal; zweiter Start desselben Stands → dieselbe; Stoppen beendet den Proxy', async () => {
  const s = tmp(); writeFileSync(join(s, 'index.html'), '<h1>Bericht</h1>');
  const d = deps();
  const r = await tl.starten({ ordner: s, von: 'knut@example.test' }, d);
  assert.equal(r.u.status, 'startet');
  const u = await r.fertig;
  assert.equal(u.status, 'laeuft', u.fehler ?? '');
  assert.deepEqual(u.gesund, { mit: 200, ohne: null });
  assert.match(u.link, /^https:\/\/386\d\d--main--.+\.ws\.konekto\.energy\/$/);
  assert.equal((await get(u.ports.proxy, '/', { host: new URL(u.link).host })).body, '<h1>Bericht</h1>');
  assert.equal((await get(u.ports.proxy, '/', { host: 'evil.example' })).status, 403, 'fremder Host');
  assert.equal((await get(u.ports.proxy, '/', { host: `127.0.0.1:${u.ports.proxy}` })).status, 200, 'lokal (Screenshots)');
  const zwei = await tl.starten({ ordner: s, von: 'knut@example.test', strang: 'abcdef12', titel: 'Aus dem Unter-Chat' }, d);
  assert.equal(zwei.schon, true); assert.equal(zwei.u.ports.proxy, u.ports.proxy);
  assert.equal(tl.alle(d)[0].strang, 'abcdef12', 'Zuordnung zum Unter-Chat nachgetragen');
  const st = await tl.stoppen(u.id, d);
  assert.equal(st?.status, 'gestoppt');
  assert.equal(u.prozesse.some(tl.lebt), false);
  assert.ok(!existsSync(join(d.ablage, u.id, 'geheim.json')), 'Geheimnis weg');
});

/** Attrappe „olaf-admin“: eine kleine App, die ohne Sitzungs-Cookie auf /login umleitet. */
function attrappeAdmin(ohneSchutz = false): tl.ProfilImpl {
  return {
    pruef: '/', schutz: '/', startPfad: '/',
    async vorbereiten(c) { c.schritt('vorbereitet'); writeFileSync(c.log, 'bau ok\nBETTER_AUTH_SECRET=' + c.geheim.secret + '\n', { flag: 'a' }); },
    async starten(c) {
      const code = `require('http').createServer((q,s)=>{const ok=${ohneSchutz}||/better-auth.session_token=/.test(q.headers.cookie||'');if(!ok){s.writeHead(307,{location:'/login'});return s.end()}s.writeHead(200);s.end('drin')}).listen(${c.u.ports.app},'127.0.0.1')`;
      return [tl.dauerprozess('app', process.execPath, ['-e', code], { cwd: c.dir, env: tl.grundEnv(), log: c.log })];
    },
    async sitzung(c) { return [{ name: 'better-auth.session_token', value: tl.betterAuthCookie(c.geheim.token, c.geheim.secret) }]; },
    async aufraeumen() { /* keine DB */ },
  };
}

test('Profil mit Anmeldung: mit Sitzung 200, ohne 307 → läuft; Geheimnisse nie in umgebung.json, der Sicht oder dem Logauszug', async () => {
  const a = tmp(); writeFileSync(join(a, 'package.json'), JSON.stringify({ name: 'olaf-admin' }));
  const d = deps(undefined, { profile: { 'olaf-admin': attrappeAdmin() } });
  const u = await (await tl.starten({ ordner: a, von: 'k' }, d)).fertig;
  assert.equal(u.status, 'laeuft', u.fehler ?? '');
  assert.deepEqual(u.gesund, { mit: 200, ohne: 307 });
  assert.match(u.db ?? '', /^olaf_tl_/);
  const g = JSON.parse(readFileSync(join(d.ablage, u.id, 'geheim.json'), 'utf8'));
  const oeffentlich = readFileSync(join(d.ablage, u.id, 'umgebung.json'), 'utf8') + JSON.stringify(tl.sicht(u));
  for (const w of [g.secret, g.token]) assert.ok(!oeffentlich.includes(w), 'Geheimnis in öffentlicher Sicht');
  assert.equal((await import('node:fs')).statSync(join(d.ablage, u.id, 'geheim.json')).mode & 0o777, 0o600);
  // nach Ablauf (Uhr + 8 Tage) räumt der Takt auf
  const spaeter = { ...d, jetzt: () => new Date(Date.now() + 8 * 864e5) };
  assert.deepEqual((await tl.aufraeumen(spaeter)).abgelaufen, [u.id]);
  assert.equal(u.prozesse.some(tl.lebt), false);
  assert.equal(tl.alle(d)[0].status, 'abgelaufen');
});

test('Gesundheitscheck: App ohne Schutz (ohne Sitzung 200) → Fehler, kein Link; Logauszug geschwärzt; Prozesse beendet', async () => {
  const a = tmp(); writeFileSync(join(a, 'package.json'), JSON.stringify({ name: 'olaf-admin' }));
  const d = deps(undefined, { profile: { 'olaf-admin': attrappeAdmin(true) } });
  const u = await (await tl.starten({ ordner: a, von: 'k' }, d)).fertig;
  assert.equal(u.status, 'fehler');
  assert.match(u.fehler ?? '', /nicht geschützt/);
  assert.match(u.logAuszug ?? '', /bau ok/);
  assert.doesNotMatch(u.logAuszug ?? '', /BETTER_AUTH_SECRET=[A-Za-z0-9_-]{20,}/);
  assert.equal(u.prozesse.some(tl.lebt), false);
});

test('Gesundheitscheck: Seite fehlt (404) → Fehler mit Grund nach der Wartezeit', async () => {
  const s = tmp(); writeFileSync(join(s, 'index.html'), 'x');
  const d = deps(undefined, { warteMs: 800, profile: { statisch: { ...tl.PROFILE.statisch, pruef: '/fehlt.html' } } });
  const u = await (await tl.starten({ ordner: s, von: 'k' }, d)).fertig;
  assert.equal(u.status, 'fehler');
  assert.match(u.fehler ?? '', /Gesundheitscheck fehlgeschlagen: mit Sitzung 404/);
});

test('Aufräumen: Umgebung mit totem Prozess → beendet; Höchstzahl gleichzeitiger Umgebungen', async () => {
  const s = tmp(); writeFileSync(join(s, 'index.html'), 'x');
  const d = deps(undefined, { max: 1 });
  const u = await (await tl.starten({ ordner: s, von: 'k' }, d)).fertig;
  const s2 = tmp(); writeFileSync(join(s2, 'index.html'), 'y');
  await assert.rejects(tl.starten({ ordner: s2, von: 'k' }, d), /Schon 1 Test-Umgebungen/);
  process.kill(u.prozesse[0].pid, 'SIGKILL');
  await warte(300);
  assert.deepEqual((await tl.aufraeumen(d)).beendet, [u.id]);
  assert.equal(tl.alle(d)[0].status, 'beendet');
});

// ---------- Routen ----------

function routen(rolle: 'ADMIN' | 'USER', d0 = deps()) {
  const r: [string, RegExp, any][] = [];
  const gesendet: any[] = [];
  const dd: TestlinkDeps = {
    tl: d0, needUser: async () => ({ ...U, role: rolle }), body: async (req: any) => req.body, send: (_res, status, body) => { gesendet.push({ status, body }); },
    strang: async (_u, id) => (id === 'abcdef12' ? { _id: id, title: 'Bot-Übergabe', cwd: (d0 as any).strangOrdner ?? '/nicht/da', written: [] } : null),
    strangVonConv: async () => null, log: () => {},
  };
  registerTestlinks((m, re, h) => r.push([m, re, h]), dd);
  const rufe = async (m: string, pfad: string, body: any = {}) => {
    const url = new URL(`http://x${pfad}`);
    const e = r.find(([mm, re]) => mm === m && re.test(url.pathname));
    if (!e) throw new Error(`keine Route ${m} ${pfad}`);
    await e[2]({ body }, {}, url.pathname.match(e[1]), url);
    return gesendet.at(-1);
  };
  return { rufe, dd };
}

test('Routen: nur Admins; Start über den Unter-Chat (Arbeitsordner) und über einen Ordner unter den Wurzeln; Antwort ohne Geheimnisse', async () => {
  const user = routen('USER');
  assert.deepEqual((await user.rufe('GET', '/api/v2/testlinks')).body, { nurAdmin: true, umgebungen: [] });
  await assert.rejects(user.rufe('POST', '/api/v2/testlinks', { ordner: '/x' }), /startet nur/);
  const s = tmp(); writeFileSync(join(s, 'index.html'), 'x');
  process.env.WERKBANK_TESTLINK_WURZELN = tmpdir();
  const d0: any = deps(); d0.strangOrdner = s;
  const adm = routen('ADMIN', d0);
  const r = await adm.rufe('POST', '/api/v2/testlinks', { strang: 'abcdef12' });
  assert.equal(r.body.umgebung.strang, 'abcdef12'); assert.equal(r.body.umgebung.titel, 'Bot-Übergabe');
  await assert.rejects(adm.rufe('POST', '/api/v2/testlinks', { ordner: '/etc' }), /Arbeitswurzeln/);
  await assert.rejects(adm.rufe('POST', '/api/v2/testlinks', { ordner: 'relativ' }), /absoluten/);
  await assert.rejects(adm.rufe('POST', '/api/v2/testlinks', { strang: '00000000' }), /gibt es nicht/);
  // intern (CLI): wartet bis zum Link
  const i = await testlinkIntern(adm.dd, { ...U }, { ziel: s });
  assert.equal(i.umgebung.status, 'laeuft');
  assert.match(i.text, /Test-Link \(angemeldet als knut-test@example\.test/);
  assert.match(i.text, /review:/);
  const g = JSON.parse(readFileSync(join(d0.ablage, i.umgebung.id, 'geheim.json'), 'utf8'));
  const liste = await adm.rufe('GET', '/api/v2/testlinks?strang=abcdef12');
  assert.ok(!JSON.stringify(liste.body).includes(g.token), 'kein Token in der Liste');
  assert.equal(typeof liste.body.umgebungen[0].prozesse, 'number', 'keine PIDs nach außen');
  const st = await adm.rufe('POST', `/api/v2/testlinks/${i.umgebung.id}/stoppen`);
  assert.equal(st.body.umgebung.status, 'gestoppt');
  assert.match((await testlinkIntern(adm.dd, { ...U }, { liste: true })).text, /Keine Test-Umgebung läuft/);
  delete process.env.WERKBANK_TESTLINK_WURZELN;
});

test('Ziel: Unter-Chat ohne erkennbare App → klare Meldung mit Hinweis auf den Ordner', async () => {
  const adm = routen('ADMIN');
  await assert.rejects(zielOrdner(adm.dd, U, { strang: 'abcdef12' }), /keine App zu erkennen/);
});

test('Strang-Auftrag verlangt den angemeldeten Link (Werkzeug testlink) im Bericht', async () => {
  const { BERICHT_PFLICHT, orchBrief } = await import('../server/orchestrator.ts') as any;
  const text = String(BERICHT_PFLICHT ?? orchBrief({ title: 't', prompt: 'p', cwd: '/w' }));
  assert.match(text, /Werkzeug \*\*testlink\*\*/);
  assert.match(text, /Test-Link \(angemeldet\)/);
  assert.doesNotMatch(text, /login\?next=/);
});
