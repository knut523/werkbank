// R31 S3: Geheimnis-Vermittler — Zweck-Positivliste, Host-/Methodenprüfung, Wert nie in der Antwort, keine Weiterleitung.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { pruefeAufruf, zweckeAus, schwaerze, feldAus, fuehreAus, geheimnisAn, ZWECKE } from '../server/geheimnis.ts';

const GEHEIM = 'tok_ABCdef123456';

test('Schalter aus: nur mit WERKBANK_GEHEIMNIS=on', () => {
  assert.equal(geheimnisAn({}), false);
  assert.equal(geheimnisAn({ WERKBANK_GEHEIMNIS: 'on' }), true);
});

test('Aufruf prüfen: Zweck, https, Host exakt, kein Port/Nutzer, Methode, Body', () => {
  const z = zweckeAus({});
  assert.ok('aufruf' in pruefeAufruf({ zweck: 'coolify', methode: 'GET', url: 'https://coolify.konekto.energy/api/v1/applications' }, z));
  const f = (a: any) => (pruefeAufruf(a, z) as any).fehler as string;
  assert.match(f({ zweck: 'unbekannt', url: 'https://coolify.konekto.energy/' }), /zweck: unbekannt/);
  assert.match(f({ zweck: 'coolify', url: 'http://coolify.konekto.energy/' }), /nur https/);
  assert.match(f({ zweck: 'coolify', url: 'https://coolify.konekto.energy.evil.com/' }), /nicht freigegeben/);
  assert.match(f({ zweck: 'coolify', url: 'https://evil.com/?x=coolify.konekto.energy' }), /nicht freigegeben/);
  assert.match(f({ zweck: 'coolify', url: 'https://coolify.konekto.energy:8443/' }), /ohne Port/);
  assert.match(f({ zweck: 'coolify', url: 'https://a:b@coolify.konekto.energy/' }), /ohne Port und ohne Zugangsdaten/);
  assert.match(f({ zweck: 'github-lesen', methode: 'POST', url: 'https://api.github.com/user' }), /nur GET/);
  assert.match(f({ zweck: 'coolify', methode: 'GET', url: 'https://coolify.konekto.energy/', body: '{}' }), /nicht bei GET/);
  const p: any = pruefeAufruf({ zweck: 'coolify', methode: 'patch', url: 'https://coolify.konekto.energy/api/v1/x', body: { a: 1 } }, z);
  assert.deepEqual(p.aufruf, { zweck: 'coolify', methode: 'PATCH', url: 'https://coolify.konekto.energy/api/v1/x', body: '{"a":1}', contentType: 'application/json' });
});

test('Zusätzliche Zwecke aus .env.local: streng geprüft, ab Werk nicht überschreibbar', () => {
  const env = { WERKBANK_GEHEIMNIS_ZWECKE: JSON.stringify([
    { name: 'bot-test', eintrag: 'Bot API key', feld: 'key', hosts: ['bot.konekto.energy'], methoden: ['GET'], header: 'X-Api-Key', format: '{}' },
    { name: 'kaputt', eintrag: 'x', feld: 'k', hosts: ['*'], methoden: ['GET'] },
    { name: 'coolify', eintrag: 'anderer', feld: 'f', hosts: ['evil.com'], methoden: ['GET'] },
    { name: 'zeile', eintrag: 'x', feld: 'k', hosts: ['a.b.de'], methoden: ['GET'], format: 'Bearer {}\r\nX: y' },
  ]) };
  const z = zweckeAus(env);
  assert.deepEqual(z.map((x) => x.name), [...ZWECKE.map((x) => x.name), 'bot-test']);
  assert.equal(z.find((x) => x.name === 'coolify')!.eintrag, 'Coolify API token (coder-workspaces)');
  assert.deepEqual(zweckeAus({ WERKBANK_GEHEIMNIS_ZWECKE: 'kein json' }).length, ZWECKE.length);
});

test('Schwärzen: roh, URL-kodiert, Base64; Feld aus bw-Eintrag', () => {
  const t = `a ${GEHEIM} b ${encodeURIComponent(GEHEIM)} c ${Buffer.from(GEHEIM).toString('base64')}`;
  assert.doesNotMatch(schwaerze(t, GEHEIM), /ABCdef|VEFC|dG9rX0FCQ2RlZjEyMzQ1Ng/);
  const item = { login: { password: 'pw-1' }, notes: 'n', fields: [{ name: 'token', value: 'feld-1' }] };
  assert.equal(feldAus(item, 'token'), 'feld-1');
  assert.equal(feldAus(item, 'password'), 'pw-1');
  assert.equal(feldAus(item, 'fehlt'), null);
});

test('Ausführen: Header mit Wert, Antwort geschwärzt, keine Weiterleitung, ohne Wert klarer Fehler', async () => {
  const gesehen: any[] = [];
  const srv = createServer((rq, res) => {
    gesehen.push({ auth: rq.headers.authorization, method: rq.method, url: rq.url });
    if (rq.url === '/weiter') { res.statusCode = 302; res.setHeader('location', 'https://evil.com/'); res.end(); return; }
    res.end(JSON.stringify({ echo: rq.headers.authorization }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as any).port;
  const zweck = { ...ZWECKE[0] };
  // Der Test-Server spricht http; pruefeAufruf (https-Pflicht) ist oben geprüft — hier zählt die Ausführung.
  const a = await fuehreAus({ zweck, aufruf: { zweck: 'coolify', methode: 'GET', url: `http://127.0.0.1:${port}/x` } }, { wert: async () => GEHEIM });
  assert.equal(a.status, 200);
  assert.equal(gesehen[0].auth, `Bearer ${GEHEIM}`);
  assert.doesNotMatch(a.text, /ABCdef/);
  assert.match(a.text, /«geschwärzt»/);
  const w = await fuehreAus({ zweck, aufruf: { zweck: 'coolify', methode: 'GET', url: `http://127.0.0.1:${port}/weiter` } }, { wert: async () => GEHEIM });
  assert.equal(w.status, 302);
  assert.equal(gesehen.length, 2, 'der Weiterleitung wurde nicht gefolgt');
  await assert.rejects(fuehreAus({ zweck, aufruf: { zweck: 'coolify', methode: 'GET', url: `http://127.0.0.1:${port}/x` } }, { wert: async () => null }), /Kein Wert für „coolify“/);
  srv.close();
});
