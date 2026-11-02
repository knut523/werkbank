// R31 S4: datei_teilen / screenshot — Ziele, Links, Dateinamen (rein); die Aufnahme selbst prüft der E2E-Lauf.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { screenshotZiel, paketLink, dateiname, dateienChatAn, GERAETE } from '../server/chatdateien.ts';

test('Schalter aus: nur mit WERKBANK_DATEIEN_CHAT=on', () => {
  assert.equal(dateienChatAn({}), false);
  assert.equal(dateienChatAn({ WERKBANK_DATEIEN_CHAT: 'on' }), true);
});

test('Screenshot-Ziel: Werkbank-Pfad, eigene Origin, fremde Seiten, Sperren', () => {
  const P = 'http://127.0.0.1:3070';
  assert.deepEqual(screenshotZiel('/heute', P), { url: 'http://127.0.0.1:3070/heute', werkbank: true });
  assert.deepEqual(screenshotZiel('http://127.0.0.1:3070/arbeit', P), { url: 'http://127.0.0.1:3070/arbeit', werkbank: true });
  assert.deepEqual(screenshotZiel('https://olaf.konekto.energy/', P), { url: 'https://olaf.konekto.energy/', werkbank: false });
  assert.match((screenshotZiel('//evil.com/x', P) as any).fehler, /url/);
  assert.match((screenshotZiel('file:///etc/passwd', P) as any).fehler, /nur http/);
  assert.match((screenshotZiel('http://169.254.169.254/latest/meta-data', P) as any).fehler, /gesperrt/);
  assert.match((screenshotZiel('https://a:b@x.de/', P) as any).fehler, /Zugangsdaten/);
});

test('Paket-Link: nur Dateien in einem Paket-Ordner, Pfad kodiert', () => {
  const r = mkdtempSync(join(tmpdir(), 'pakete-'));
  mkdirSync(join(r, '412-umzug', 'screenshots'), { recursive: true });
  writeFileSync(join(r, '412-umzug', 'screenshots', 'a b.png'), 'x');
  assert.match(paketLink(join(r, '412-umzug', 'screenshots', 'a b.png'), r)!, /\/api\/files\/agenten\/412-umzug\/screenshots\/a%20b\.png$/);
  assert.equal(paketLink(join(r, 'lose.png'), r), null);
  assert.equal(paketLink('/etc/hosts', r), null);
});

test('Dateiname und Größen', () => {
  assert.equal(dateiname('http://127.0.0.1:3070/heute?x=1', 'handy', Date.parse('2026-11-02T15:04:00Z')), '20261102150400_127-0-0-1-3070-heute-x-1_handy.png');
  assert.deepEqual([GERAETE.desktop.width, GERAETE.handy.width, GERAETE.handy.dpr], [1440, 390, 2]);
});
