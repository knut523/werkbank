// Brücke als Besitzerin der opencode-2-Server (Hauptsitzung 06.11.): Prüfung vor dem Start, Umgebung nur mit dem Nötigen,
// ein Schlüssel je Brückenlauf, Neustart nach Absturz mit Obergrenze.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { oc2Pruefen, oc2Umgebung, oc2Ports, opencode2Server , OC2_SHIM } from '../src/oc2server.ts';

const installation = (konfig = '{ "providers": { "melious": {} }, "update": "disable", "share": "disabled" }') => {
  const h = mkdtempSync(join(tmpdir(), 'oc2s-'));
  mkdirSync(join(h, 'bin')); mkdirSync(join(h, 'xdg/config/opencode'), { recursive: true });
  writeFileSync(join(h, 'bin/opencode2'), ''); writeFileSync(join(h, 'xdg/config/opencode/opencode.jsonc'), konfig);
  return h;
};

test('Prüfung vor dem ersten Start: feste Version, nur Melious, keine Updates, kein Teilen', () => {
  const h = installation();
  assert.equal(oc2Pruefen(h, '2.2.5', () => 'opencode v2.2.5'), '');
  assert.match(oc2Pruefen(h, '2.2.5', () => 'opencode v2.3.0'), /Version „2\.3\.0“, erwartet 2\.2\.5/);
  assert.match(oc2Pruefen(installation('{ "providers": { "melious": {} }, "update": "auto", "share": "disabled" }'), '2.2.5', () => '2.2.5'), /update/);
  assert.match(oc2Pruefen(join(h, 'fehlt'), '2.2.5', () => '2.2.5'), /fehlt/);
  assert.deepEqual(oc2Ports({}), [47811, 47812]);
  assert.deepEqual(oc2Ports({ BRIDGE_OPENCODE2_PORTS: '47900,80 x 47901' }), [47900, 47901]);
});

test('Umgebung der Server: Schlüssel und Passwort, sonst nichts aus der Umgebung der Brücke', () => {
  const u = oc2Umgebung('/h', 'sk-k', 'pw', { PATH: '/bin', WERKBANK_INTERNAL_TOKEN: 'geheim', ANTHROPIC_API_KEY: 'x' });
  assert.equal(u.MELIOUS_API_KEY, 'sk-k'); assert.equal(u.OPENCODE_SERVER_PASSWORD, 'pw');
  // 07.11.: der Shell-Wächter vorn (schreibende Stränge), Projekt-Konfiguration aus
  assert.equal(u.PATH, `${OC2_SHIM}:/bin`); assert.ok(OC2_SHIM.endsWith('/shim')); assert.equal(u.OPENCODE_DISABLE_PROJECT_CONFIG, '1');
  assert.ok(!('WERKBANK_INTERNAL_TOKEN' in u) && !('ANTHROPIC_API_KEY' in u));
  assert.equal(u.XDG_CONFIG_HOME, '/h/xdg/config');
});

function falscherStart() {
  const kinder: any[] = [];
  const spawnFn: any = (_bin: string, args: string[], o: any) => {
    const c: any = new EventEmitter(); c.pid = 90000 + kinder.length; c.args = args; c.env = o.env;
    c.kill = () => { setImmediate(() => c.emit('exit', null, 'SIGTERM')); return true; };
    kinder.push(c); return c;
  };
  return { kinder, spawnFn, fetchFn: (async () => new Response('{}', { status: 200 })) as any };
}

test('ein Schlüssel je Brückenlauf: ein anderes Konto bekommt jcode statt fremder Server; Neustart nach Absturz, höchstens maxNeustarts', async () => {
  const h = installation(), f = falscherStart(), logs: string[] = [];
  const s = opencode2Server({ home: h, ports: [47900, 47901], version: '2.2.5', versionVon: () => '2.2.5', spawnFn: f.spawnFn, fetchFn: f.fetchFn, log: (m) => logs.push(m), maxNeustarts: 1 });
  const z = await s.sichern('sk-eins');
  assert.deepEqual(z?.urls, ['http://127.0.0.1:47900', 'http://127.0.0.1:47901']);
  assert.equal(f.kinder.length, 2);
  assert.equal(f.kinder[0].env.MELIOUS_API_KEY, 'sk-eins');
  assert.equal(f.kinder[0].env.OPENCODE_SERVER_PASSWORD, z!.passwort);
  assert.equal(await s.sichern('sk-zwei'), null, 'anderer Schlüssel → kein opencode 2');
  assert.deepEqual((await s.sichern('sk-eins'))?.urls, z!.urls, 'gleicher Schlüssel → dieselben Server, kein neuer Start');
  assert.equal(f.kinder.length, 2);
  f.kinder[0].emit('exit', 1, null);   // Absturz
  await new Promise((r) => setTimeout(r, 1300));
  assert.equal(f.kinder.length, 3, 'neu gestartet'); assert.equal(f.kinder[2].env.MELIOUS_API_KEY, 'sk-eins');
  f.kinder[2].emit('exit', 1, null);   // zweiter Absturz: Obergrenze 1 erreicht
  await new Promise((r) => setTimeout(r, 1300));
  assert.equal(f.kinder.length, 3, 'aufgegeben'); assert.ok(logs.includes('opencode2 server aufgegeben'));
  // Pass B D4: ein aufgegebener Port wird beim nächsten Bedarf nicht wieder gestartet; der andere Server bleibt im Zugang
  assert.deepEqual((await s.sichern('sk-eins'))?.urls, ['http://127.0.0.1:47900', 'http://127.0.0.1:47901']);
  assert.equal(f.kinder.length, 3, 'kein neuer Start des aufgegebenen Ports');
  s.stop();
  assert.equal(await s.sichern('sk-eins'), null, 'nach stop nichts mehr');
});

test('falsche Version → kein Start, Grund bleibt sichtbar', async () => {
  const f = falscherStart();
  const s = opencode2Server({ home: installation(), ports: [47902], version: '2.2.5', versionVon: () => '2.3.0', spawnFn: f.spawnFn, fetchFn: f.fetchFn });
  assert.equal(await s.sichern('sk-eins'), null);
  assert.equal(f.kinder.length, 0); assert.match(String(s.grund()), /2\.3\.0/);
});

test('Gegenprüfung 06.11.: besitzt eine andere, lebende Brücke die Server, startet diese keine (jcode); eine tote Sperre wird übernommen', async () => {
  const h = installation(), f = falscherStart();
  mkdirSync(join(h, 'waechter'));
  const fremd = spawn('sleep', ['30'], { stdio: 'ignore' });
  try {
    writeFileSync(join(h, 'waechter/bruecke.pid'), String(fremd.pid));
    const s = opencode2Server({ home: h, ports: [47903], version: '2.2.5', versionVon: () => '2.2.5', spawnFn: f.spawnFn, fetchFn: f.fetchFn });
    assert.equal(await s.sichern('sk-eins'), null);
    assert.equal(f.kinder.length, 0); assert.match(String(s.grund()), /andere Brücke/);
  } finally { fremd.kill('SIGKILL'); }
  writeFileSync(join(h, 'waechter/bruecke.pid'), '999999999');   // tote Brücke
  const s2 = opencode2Server({ home: h, ports: [47904], version: '2.2.5', versionVon: () => '2.2.5', spawnFn: f.spawnFn, fetchFn: f.fetchFn });
  assert.ok(await s2.sichern('sk-eins'));
  assert.equal(readFileSync(join(h, 'waechter/bruecke.pid'), 'utf8'), String(process.pid));
  s2.stop();
  assert.ok(!existsSync(join(h, 'waechter/bruecke.pid')), 'Sperre mit stop freigegeben');
});

test('Pass B (Runde 5, A3): antwortet ein Server erst nach der Startfrist, ist er beim nächsten Bedarf bereit (nicht für den ganzen Lauf aus)', async () => {
  const h = installation(), f = falscherStart();
  let wach = false;
  const fetchFn: any = async () => (wach ? new Response('{}', { status: 200 }) : Promise.reject(new Error('noch nicht')));
  const s = opencode2Server({ home: h, ports: [47910], version: '2.2.5', versionVon: () => '2.2.5', spawnFn: f.spawnFn, fetchFn, log: () => {}, startMs: 300 });
  assert.equal(await s.sichern('sk-eins'), null, 'Start dauert länger als die Frist');
  wach = true;
  assert.deepEqual((await s.sichern('sk-eins'))?.urls, ['http://127.0.0.1:47910']);
  assert.equal(f.kinder.length, 1, 'kein zweiter Prozess');
  s.stop();
});
