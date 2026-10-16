import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { entwurf, quelleWeg, kandidaten, entwurfFuer, senden } from '../server/cosnachfassen.ts';
import { parseRegister, teamSet } from '../server/cosregister.ts';
import { vorbereitung, gleichePerson, type NotizLite } from '../server/cosvorbereitung.ts';
import { olafJql, olafJira, mapOlaf, olafBase, _leereCache } from '../server/cos-olafjira.ts';

const REG = `## Offen

- **Z-001** · Christoph Bitzner → Knut · Belieferungsstatus in den Report · bis 2026-10-10 · Thema: Cockpit · Quelle: [[2026-09-18-olaf-review]] · Notiz: GEHEIMER-NOTIZTEXT
- **Z-002** · Daniela → Knut · PR prüfen · bis 2026-10-12 · Quelle: admin#123
- **Z-003** · Peter → Knut · Ticket klären · bis 2026-10-11 · Quelle: PM-456
- **Z-004** · Wer: offen → Knut · Unterlage nachziehen · bis 2026-10-01
- **Z-005** · Knut → Rogue GmbH · Vertrag schicken · bis 2026-10-09
- **Z-006** · Anna → Knut · Zukunft · bis 2026-12-01

## Termine

- Termin 2026-10-17 10:00 Rogue Vertrag · mit: Rogue GmbH, Knut
- Termin 2026-10-16 Cockpit-Sync · mit: Christoph Bitzner

## Personen

- Knut · Knut · auch: Knut Peters
- Christoph Bitzner · Team · auch: Christoph, martenc
- Rogue GmbH · Partner · auch: Rogue
`;
const HEUTE = '2026-10-16';

test('Quelle bestimmt den Weg: PR → GitHub, PM-… → Jira, sonst Mail; Senden nur bei PR/Ticket (K6)', () => {
  assert.deepEqual(quelleWeg('admin#123'), { weg: 'github', ref: 'admin#123', senden: true });
  assert.deepEqual(quelleWeg('https://github.com/WirStrom1/admin/pull/77'), { weg: 'github', ref: 'WirStrom1/admin#77', senden: true });
  assert.deepEqual(quelleWeg('PM-456'), { weg: 'jira', ref: 'PM-456', senden: true });
  assert.deepEqual(quelleWeg('[[2026-09-18-olaf-review]]'), { weg: 'mail', ref: null, senden: false });
  assert.deepEqual(quelleWeg(undefined), { weg: 'mail', ref: null, senden: false });
});

test('Entwurf enthält nur Was, Frist und Bezug — nie Notiztext (K6); ohne Namen kein Entwurf', () => {
  const z = parseRegister(REG).zusagen;
  const mail = entwurf(z[0])!;
  assert.match(mail.text, /^Hallo Christoph,\n\nkurze Erinnerung \(Meeting vom 18\.09\.\): Belieferungsstatus in den Report — vereinbart war bis 10\.10\.2026\. Wie ist der Stand\?/);
  assert.ok(!mail.text.includes('GEHEIMER-NOTIZTEXT'), 'kein Notiztext');
  assert.ok(!mail.text.includes('Cockpit'), 'kein Thema/Notizinhalt');
  assert.equal(mail.weg, 'mail'); assert.equal(mail.senden, false);
  assert.match(entwurf(z[1])!.text, /^Kurze Erinnerung \(vereinbart bis 12\.10\.2026\): PR prüfen\. Wie ist der Stand\?$/);
  assert.equal(entwurf(z[3]), null, 'Wer: offen');
});

test('Kandidaten: überfällig, mit Namen, nicht Knut selbst', () => {
  const r = parseRegister(REG);
  const k = kandidaten(r.zusagen, r.personen, teamSet([]), HEUTE).map((z) => z.id);
  assert.deepEqual(k, ['Z-001', 'Z-002', 'Z-003']);
});

function vault() { const v = mkdtempSync(join(tmpdir(), 'cos-nf-')); mkdirSync(join(v, 'olaf/1-Projects/chief-of-staff'), { recursive: true }); writeFileSync(join(v, 'olaf/1-Projects/chief-of-staff/zusagen-register.md'), REG); return v; }

test('Senden: Mail nie, ohne confirm nur Vorschau, mit Hash; danach Notiz „nachgefasst“; Mock statt echter Wege', async () => {
  const v = vault();
  const calls: any[] = [];
  const sender = { github: async (repo: string, n: number, text: string) => { calls.push(['gh', repo, n, text]); return { url: 'https://github.com/x/y/pull/1#c' }; }, jira: async (key: string, text: string) => { calls.push(['jira', key, text]); } };
  const o = { vaultDir: v, heute: HEUTE, locked: () => false, sender };
  await assert.rejects(senden(v, 'Z-001', o), (e: any) => e.status === 400 && /nie gesendet/.test(e.message));
  await assert.rejects(senden(v, 'Z-004', o), (e: any) => e.status === 400);
  await assert.rejects(senden(v, 'Z-404', o), (e: any) => e.status === 404);
  const vor = await senden(v, 'Z-002', o);
  assert.equal(vor.needsConfirm, true); assert.match(vor.ziel, /GitHub-Kommentar am PR admin#123/);
  assert.equal(calls.length, 0, 'Vorschau sendet nichts');
  await assert.rejects(senden(v, 'Z-002', { ...o, confirm: true, hash: 'falsch' }), (e: any) => e.status === 409);
  const ok = await senden(v, 'Z-002', { ...o, confirm: true, hash: vor.hash });
  assert.equal(ok.ok, true);
  assert.deepEqual(calls, [['gh', 'WirStrom1/admin', 123, 'Kurze Erinnerung (vereinbart bis 12.10.2026): PR prüfen. Wie ist der Stand?']]);
  assert.match(readFileSync(join(v, 'olaf/1-Projects/chief-of-staff/zusagen-register.md'), 'utf8'), /Z-002\*\* · Daniela → Knut · PR prüfen · bis 2026-10-12 · Quelle: admin#123 · Notiz: nachgefasst 16\.10\./);
  const vj = await senden(v, 'Z-003', o);
  await senden(v, 'Z-003', { ...o, confirm: true, hash: vj.hash });
  assert.deepEqual(calls[1], ['jira', 'PM-456', 'Kurze Erinnerung (vereinbart bis 11.10.2026): Ticket klären. Wie ist der Stand?']);
  // Trockenlauf sendet nicht
  const d = await senden(v, 'Z-002', { ...o, confirm: true, hash: vor.hash, dry: true });
  assert.equal(d.dry, true); assert.equal(calls.length, 2);
  assert.equal(entwurfFuer(v, 'Z-001', HEUTE).weg, 'mail');
});

const notiz = (o: Partial<NotizLite>): NotizLite => ({ pfad: 'olaf/Meetings/x.md', name: 'x', titel: 'x', datum: null, serie: null, teilnehmer: [], offeneAktionen: 0, offeneFragen: [], status: 'draft', ...o });

test('Vorbereitung: Termine heute/morgen aus Register und Notizen, Zusagen in beide Richtungen, letzte Notiz der Serie, Notetaker-Hinweis', () => {
  const r = parseRegister(REG);
  const k = vorbereitung({ heute: HEUTE, register: r, notizen: [
    notiz({ name: '2026-10-17-sync', titel: 'Flex Sync', datum: '2026-10-17', serie: 'flex', teilnehmer: ['Knut Peters', 'Christoph'] }),
    notiz({ name: '2026-10-10-sync', titel: 'Flex Sync', datum: '2026-10-10', serie: 'flex', offeneFragen: ['Wer testet?'], offeneAktionen: 2 }),
    notiz({ name: '2026-10-03-sync', titel: 'Flex Sync', datum: '2026-10-03', serie: 'flex' }),
    notiz({ name: '2026-10-30-spaeter', titel: 'Später', datum: '2026-10-30' }),
  ] });
  assert.deepEqual(k.map((t) => [t.wann, t.titel]), [['heute', 'Cockpit-Sync'], ['morgen', 'Flex Sync'], ['morgen', 'Rogue Vertrag']]);
  const rogue = k.find((t) => /Rogue/.test(t.titel))!;
  assert.deepEqual(rogue.knutSchuldet.map((z) => z.id), ['Z-005'], 'Knut → Rogue');
  assert.deepEqual(rogue.schuldenAnKnut, []);
  const sync = k.find((t) => t.titel === 'Cockpit-Sync')!;
  assert.deepEqual(sync.schuldenAnKnut.map((z) => z.id), ['Z-001'], 'Christoph Bitzner → Knut');
  assert.equal(sync.letzteNotiz, null);
  const flex = k.find((t) => t.titel === 'Flex Sync')!;
  assert.deepEqual(flex.schuldenAnKnut.map((z) => z.id), ['Z-001'], 'Teilnehmer „Christoph“ = Christoph Bitzner');
  assert.equal(flex.letzteNotiz!.name, '2026-10-10-sync'); assert.deepEqual(flex.letzteNotiz!.offeneFragen, ['Wer testet?']);
  assert.equal(flex.notetaker, 'notetaker@konekto.energy');
  assert.equal(gleichePerson('martenc', 'Christoph Bitzner', r.personen), true);
  assert.equal(gleichePerson('Christoph', 'Daniela', r.personen), false);
  assert.deepEqual(vorbereitung({ heute: '2026-10-20', register: r, notizen: [] }), [], 'nichts anstehend');
});

test('OLAF-Jira: eigene JQL, lesend (GET), 10 Minuten Cache, Not-Aus, Fehler werden Text', async () => {
  _leereCache();
  const st = new Date('2026-10-15T16:00:00Z');
  assert.equal(olafJql(st), 'project = OLAF AND updated >= "2026-10-15 18:00" ORDER BY updated DESC');
  const urls: string[] = []; const methods: string[] = [];
  const f = (async (url: string, init: any) => { urls.push(String(url)); methods.push(init.method); return new Response(JSON.stringify({ issues: [{ key: 'OLAF-7', fields: { summary: 'Neu', status: { name: 'To Do', statusCategory: { key: 'new' } }, assignee: { displayName: 'Anna' }, updated: '2026-10-16T01:00:00.000+0200', created: '2026-10-16T01:00:00.000+0200' } }] }), { status: 200 }); }) as any;
  const d = { creds: async () => ({ email: 'k@x', token: 't' }), fetch: f, jetzt: () => 1000 };
  const a = await olafJira(st, d);
  assert.equal(a!.issues[0].key, 'OLAF-7'); assert.equal(a!.issues[0].url, 'https://max-energy.atlassian.net/browse/OLAF-7');
  assert.match(urls[0], /^https:\/\/api\.atlassian\.com\/ex\/jira\/7aec26a2-2eca-46bb-a608-9be55c1dd167\/rest\/api\/3\/search\/jql\?/);
  assert.deepEqual(methods, ['GET']);
  await olafJira(st, { ...d, jetzt: () => 100_000 });
  assert.equal(urls.length, 1, 'Cache');
  await olafJira(st, { ...d, jetzt: () => 700_000 });
  assert.equal(urls.length, 2, 'nach 10 min neu');
  assert.equal(await olafJira(st, { ...d, env: { COS_OLAF_JIRA: 'off' } as any }), null);
  _leereCache();
  const bad = await olafJira(st, { ...d, fetch: (async () => new Response('', { status: 403 })) as any });
  assert.match(bad!.fehler ?? '', /403.*Token/);
  assert.equal((await olafJira(new Date('2026-01-01T00:00:00Z'), { ...d, creds: async () => null }))!.fehler, 'kein Jira-Zugang (Pilot-Token)');
  assert.equal(mapOlaf({ key: 'OLAF-1', fields: {} }).status, '?');
  assert.ok(olafBase().includes('7aec26a2'));
});
