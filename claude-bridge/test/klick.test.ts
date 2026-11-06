// J3 (Hauptsitzung 06.11.): Klickwerkzeug nur gegen Test-Instanz und Vorschau-Ports, Allowlist im Code, nur Testkonten,
// nur über den jcode-Wächter mit klick=true. Der echte Lauf gegen :3436 läuft nur, wenn die Test-Instanz da ist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zielErlaubt, anfrageErlaubt, wsErlaubt, aktionen, ausgabeOrdner, klick, KLICK_ZIELE } from '../src/klick.ts';
import { jcodeEntscheid } from '../src/jcode-pre-tool.ts';

test('Allowlist im Code: nur 127.0.0.1/localhost auf 3436, 8110, 8111 — keine Live-Ports, nichts außerhalb', () => {
  for (const u of ['http://127.0.0.1:3436/v2/', 'http://localhost:3436/', 'http://127.0.0.1:8110/x', 'http://localhost:8111']) assert.ok(zielErlaubt(u), u);
  for (const u of ['http://127.0.0.1:3070/', 'http://127.0.0.1:3080/', 'http://127.0.0.1:3090/', 'http://127.0.0.1/', 'https://127.0.0.1:3436/', 'http://127.0.0.2:3436/',
    'http://admin.olaf.example:3436/', 'http://a:b@127.0.0.1:3436/', 'http://127.0.0.1:3436.evil.example/', 'file:///etc/passwd', 'kein url']) assert.ok(!zielErlaubt(u), u);
  assert.ok(Object.isFrozen(KLICK_ZIELE), 'zur Laufzeit nicht erweiterbar');
  // Hauptsitzung 06.11.: Test-Admin und Test-Bot, nur https, nur lesend
  for (const u of ['https://olaf-bot-admin.konekto.energy/', 'https://olaf-bot-test.konekto.energy/x?y=1']) assert.ok(zielErlaubt(u), u);
  for (const u of ['http://olaf-bot-admin.konekto.energy/', 'https://olaf-bot-admin.konekto.energy:8443/', 'https://olaf-admin.konekto.energy/', 'https://x.olaf-bot-test.konekto.energy/']) assert.ok(!zielErlaubt(u), u);
  assert.ok(anfrageErlaubt('https://olaf-bot-admin.konekto.energy/api', 'GET')); assert.ok(!anfrageErlaubt('https://olaf-bot-admin.konekto.energy/api', 'POST'), 'nur lesend');
  assert.ok(anfrageErlaubt('http://127.0.0.1:3436/api/x', 'POST'), 'Test-Instanz darf schreiben (Testdaten)');
  assert.ok(Object.isFrozen(KLICK_ZIELE[0]));
  assert.ok(wsErlaubt('ws://127.0.0.1:3436/x')); assert.ok(!wsErlaubt('ws://127.0.0.1:3070/')); assert.ok(!wsErlaubt('wss://127.0.0.1:3436/')); assert.ok(!wsErlaubt('ws://1.2.3.4:3436/'));
  assert.match(String(aktionen(['warte:30000', 'warte:30000', 'warte:1'])), /Wartezeiten zusammen/);
});

test('Aktionen werden geprüft; ohne Ausgabeordner und für fremde Ziele startet kein Browser', async () => {
  assert.deepEqual(aktionen(['warte:100', 'klick:Neu', 'voll', 'bild:start']), [{ art: 'warte', wert: '100' }, { art: 'klick', wert: 'Neu' }, { art: 'voll', wert: '' }, { art: 'bild', wert: 'start' }]);
  assert.match(String(aktionen(['eval:fetch("x")'])), /unbekannte Aktion/);
  assert.match(String(aktionen(['bild:../../x'])), /bild:<name>/);
  assert.equal(ausgabeOrdner(undefined), null);
  assert.equal((await klick(['Lisa', 'd', 'http://127.0.0.1:3070/'], mkdtempSync(join(tmpdir(), 'k-')))).code, 3);
  assert.equal((await klick(['Lisa', 'd', 'http://127.0.0.1:3436/'], undefined)).code, 4);
  assert.equal((await klick(['Unbekannt', 'd', 'http://127.0.0.1:3436/'], mkdtempSync(join(tmpdir(), 'k-')))).code, 5, 'nur Testkonten');
  assert.equal((await klick(['Lisa', 'd', 'http://127.0.0.1:8110/'], mkdtempSync(join(tmpdir(), 'k-')))).code, 5, 'Anmeldung nur an der Test-Instanz');
  assert.equal((await klick(['Lisa', 'd', 'https://olaf-bot-admin.konekto.energy/'], mkdtempSync(join(tmpdir(), 'k-')))).code, 5, 'keine Werkbank-Anmeldung an der Test-Admin');
});

const SHIM = join(import.meta.dirname, '..', 'shim');
const shell = (cmd: string, extra: Record<string, string> = {}) => spawnSync('bash', ['-c', cmd], { env: { PATH: `${SHIM}:${process.env.PATH}`, HOME: String(process.env.HOME), ...extra }, encoding: 'utf8', timeout: 60_000 });

test('jcode-Wächter: klick nur mit WERKBANK_KLICK=1, ohne Shell-Zeichen; Ziele prüft das Werkzeug', () => {
  const aus = mkdtempSync(join(tmpdir(), 'k-'));
  assert.equal(shell('klick - d http://127.0.0.1:3070/').status, 126, 'ohne klick=true gilt die Leseliste');
  const r = shell('klick - d http://127.0.0.1:3070/', { WERKBANK_KLICK: '1', WERKBANK_KLICK_AUS: aus });
  assert.equal(r.status, 3); assert.match(r.stderr, /Ziel nicht erlaubt/);
  for (const c of ['klick - d http://127.0.0.1:3436/ ; touch /tmp/x', 'klick - d $(echo http://x)', 'klick - d http://127.0.0.1:3436/ > /tmp/x']) {
    const s = shell(c, { WERKBANK_KLICK: '1', WERKBANK_KLICK_AUS: aus });
    assert.equal(s.status, 126, c); assert.match(s.stderr, /Werkbank-Wächter/);
  }
  assert.match(String(jcodeEntscheid('read', { file_path: '/home/x/.cache/p436/testkonten.txt' }, '/tmp')), /gesperrt/, 'Passwörter der Testkonten sieht jcode nicht');
});

const testInstanz = await fetch('http://127.0.0.1:3436/v2/', { signal: AbortSignal.timeout(2000) }).then((r) => r.ok, () => false);
test('echter Klicklauf gegen die Test-Instanz als Lisa (Handy): Anmeldung mit Testkonto, Bild im Ausgabeordner', { skip: !testInstanz && 'Test-Instanz :3436 läuft nicht' }, async () => {
  const aus = mkdtempSync(join(tmpdir(), 'k-'));
  const r = shell(`klick Lisa m http://127.0.0.1:3436/v2/ warte:500 "text:main" bild:start`, { WERKBANK_KLICK: '1', WERKBANK_KLICK_AUS: aus });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /geladen in \d+ ms/);
  assert.ok(existsSync(join(aus, 'klick', 'start.png')));
  assert.equal(readdirSync(join(aus, 'klick')).filter((f) => f.endsWith('.png')).length, 2);
  assert.ok(!/@|passwort/i.test(r.stdout.split('\n').filter((l) => !l.startsWith('text ')).join('\n')), 'keine Zugangsdaten in der Ausgabe');
});
