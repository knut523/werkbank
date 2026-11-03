// Werkbank 2.0 (Paket 436): die Routen von v2.ts mit gefälschten Abhängigkeiten — Freigaben nach außen gehen nie (B4),
// Team-Freigaben werden nicht umgangen, die Antwort geht nur über die bestehende Antwortlogik.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerV2, type V2Deps } from '../server/v2.ts';

const routen: [string, RegExp, any][] = [];
const on = (m: string, re: RegExp, h: any) => { routen.push([m, re, h]); };
const ADMIN = { id: 'k', email: 'k@x', name: 'Knut Peters', role: 'ADMIN' } as any;
const LISA = { id: 'l', email: 'l@x', name: 'Lisa', role: 'USER' } as any;
const eintraege = [
  { id: 'p-abcd1234-1234567', art: 'push', frage: 'Push freigeben: Kundenakte', empfehlung: null, quelle: { text: 'olaf-admin', strand: 'abcd1234', url: null }, wartetSeit: '2026-11-01T10:00:00Z', blockiert: 1, antworten: ['ja', 'spaeter'], daten: { strand: 'abcd1234', commit: '1234567' } },
  { id: 'q-aaaaaa', art: 'rueckfrage', frage: 'Welche Variante?', empfehlung: 'A', quelle: { text: 'Unter-Chat „Rechner“', strand: 'abcd1234', url: null }, wartetSeit: '2026-11-02T10:00:00Z', blockiert: 1, antworten: ['ja', 'nein', 'anders', 'spaeter'], daten: { qid: 'q-aaaaaa', optionen: ['A', 'B'], kontext: 'Worum es geht.' } },
  { id: 'pflege', art: 'pflege', frage: '8 Tickets brauchen Pflege', empfehlung: null, quelle: { text: 'Pflege', strand: null, url: '#/board' }, wartetSeit: null, blockiert: 0, antworten: ['spaeter'], daten: {} },
] as any[];
const antworten: any[] = [];
let gesperrt = false;
const geoeffnet: string[] = [];
const sammel: string[] = [];
const tage: string[] = [];
const deps: V2Deps = {
  needUser: async (req: any) => req.u, body: async (req: any) => req.b, send: (res: any, status, b) => { res.status = status; res.b = b; },
  inboxFuer: async () => ({ eintraege }), unterchatListe: async () => ({ zeilen: [] }), erledigtDaten: async (_u, tag) => { tage.push(tag); return { straenge: tag === '2026-11-02' ? [{ id: 'abcd1234', titel: 'Netzentgelte', at: '2026-11-02T15:00:00Z', link: null, dokumente: [] }] : [] }; },
  fragenAntwort: async (_u, b) => { antworten.push(b); return { ok: true, ziel: 'den Unter-Chat „Rechner“' }; },
  strang: async () => null, hauptchat: async () => null, laeuftChat: async () => false,
  livePrs: async () => ({ map: new Map([['a#1', { pr: 'a#1', repo: 'a', number: 1, title: 'Eins', url: 'https://github.com/o/a/pull/1', turn: { who: 'Lisa', role: 'reviewer', why: 'Review angefragt' }, requested: [] }]]) }),
  githubNames: () => ({ bizarrochris: 'Christoph', knut523: 'Knut' }), letzteReviews: async () => [], reviewKommentar: () => null,
  pakete: () => [{ name: '435-x', titel: 'Bericht X', status: 'wartet', at: Date.now() }],
  vaultSuche: async () => [{ path: 'olaf/datenschutz.md', title: 'Datenschutz' }], vaultNeu: () => [{ path: 'olaf/a.md', title: 'A', mtime: Date.now() }],
  wienDatum: () => '2026-11-03', claudeToken: async () => null, bridgeUrl: 'http://b', altUrl: 'http://alt/wb', log: () => {},
  gesperrt: () => gesperrt,
  geschlossen: async (u) => (u.id === 'k' ? [{ id: 'q-zu1', titel: 'Kohorte laufender Monat?', grund: 'im Bericht als entschieden vermerkt (D1): angenommen', at: new Date() }] : []),
  alleEmpfohlen: async (_u, ids, nur) => { assert.equal(nur({ art: 'push', klasse: 'freigabe' } as any), false, 'innen: Freigabe nie'); sammel.push(...ids); return { ok: ids.length, fehler: [] }; },
  alleRuns: async () => [{ _id: 'abcd1234', conv: 'c1', title: 'Rechner', zustand: 'laeuft', lastActivity: '2026-11-03T08:00:00Z', thema: 'Tarife' }],
  lcChats: async () => [{ conversationId: 'c1', title: 'x' }, { conversationId: 'c2', title: 'Alt', isArchived: true, updatedAt: '2026-01-01' }], lcUrl: 'https://lc',
  wiederOeffnen: async (u, id) => { geoeffnet.push(`${u.id}:${id}`); return u.id === 'k' && id === 'q-zu1'; },
};
registerV2(on, deps);
async function rufe(method: string, pfad: string, u: any, b?: any) {
  const url = new URL(pfad, 'http://x');
  const r = routen.find(([m, re]) => m === method && re.test(url.pathname));
  assert.ok(r, `Route ${method} ${pfad}`);
  const res: any = {};
  try { await r![2]({ u, b }, res, url.pathname.match(r![1])!, url); } catch (e: any) { res.status = e.status ?? 500; res.b = { error: e.message }; }
  return res;
}

test('Start: eine Zahl = Summe aus Karten und Aufräumen; Freigabe unter den Entscheidungen; Pflege als Aufräum-Zeile mit Link in die alte Werkbank', async () => {
  const r = await rufe('GET', '/api/v2/start', ADMIN);
  assert.equal(r.status, 200);
  assert.equal(r.b.zahl, 3);
  assert.deepEqual(r.b.jetzt.map((k: any) => k.art), ['entscheidung', 'freigabe']);
  assert.equal(r.b.jetzt.length + r.b.aufraeumen.length, r.b.zahl);
  assert.equal(r.b.aufraeumen[0].url, 'http://alt/wb/board');
  assert.equal(r.b.jetzt[1].alt, 'http://alt/wb/entscheidungen');
  assert.deepEqual(r.b.jetzt[1].antworten, []);
});

test('Start ?teil=oben: nur Zahl und Karten, dieselben wie im vollen Abruf', async () => {
  const o = await rufe('GET', '/api/v2/start?teil=oben', ADMIN), v = await rufe('GET', '/api/v2/start', ADMIN);
  assert.equal(o.b.teil, 'oben'); assert.equal(o.b.zahl, v.b.zahl);
  assert.deepEqual(o.b.jetzt.map((k: any) => k.id), v.b.jetzt.map((k: any) => k.id));
  assert.equal(o.b.prs, undefined, 'PRs erst im vollen Abruf');
});

test('B4: eine Freigabe lässt sich über die 2.0-API nicht beantworten — auch nicht mit „ja“ per Hand; Entscheidungen gehen über die bestehende Logik', async () => {
  const n = antworten.length;
  const f = await rufe('POST', '/api/v2/antwort', ADMIN, { id: 'p-abcd1234-1234567', antwort: 'ja' });
  assert.equal(f.status, 403);
  assert.equal(antworten.length, n, 'nichts weitergereicht');
  const ok = await rufe('POST', '/api/v2/antwort', ADMIN, { id: 'q-aaaaaa', antwort: 'anders', text: 'B, aber später' });
  assert.equal(ok.status, 200);
  assert.deepEqual(antworten.at(-1), { id: 'q-aaaaaa', antwort: 'anders', text: 'B, aber später' });
  assert.equal(ok.b.ziel, 'den Unter-Chat „Rechner“');
  assert.equal((await rufe('POST', '/api/v2/antwort', ADMIN, { id: 'pflege', antwort: 'ja' })).status, 409, 'Aufräumen ist keine Frage');
  assert.equal((await rufe('POST', '/api/v2/antwort', ADMIN, { id: 'q-aaaaaa', antwort: 'freigeben' })).status, 400);
});

test('Team-Freigaben: ohne „Roadmap“ keine PRs, ohne „Wissen“ keine Notizen — nie umgangen; Berichte nur für Admins', async () => {
  gesperrt = true;
  try {
    const s = await rufe('GET', '/api/v2/start', LISA);
    assert.equal(s.b.prFrei, false); assert.equal(s.b.prs, null); assert.equal(s.b.notizenFrei, false);
    assert.deepEqual(s.b.dokumente, [], 'keine Notizen, keine Berichte');
    assert.equal((await rufe('GET', '/api/v2/prs', LISA)).b.gesperrt, true);
    assert.equal((await rufe('GET', '/api/v2/prs/a/1', LISA)).status, 403);
    assert.deepEqual((await rufe('GET', '/api/v2/dokumente?q=daten', LISA)).b.treffer, []);
  } finally { gesperrt = false; }
  const s2 = await rufe('GET', '/api/v2/start', LISA);
  assert.equal(s2.b.prs[0].pr, 'a#1', 'wartet auf Lisa');
  const d = await rufe('GET', '/api/v2/dokumente?q=daten', LISA);
  assert.deepEqual(d.b.treffer.map((x: any) => x.art), ['notiz'], 'Berichte nur für Admins');
  assert.deepEqual((await rufe('GET', '/api/v2/dokumente?q=bericht', ADMIN)).b.treffer.map((x: any) => x.art), ['bericht', 'notiz']);
});

test('Unter-Chats und Hauptchat nur für Admin; Chat ohne Zugang: Klartext', async () => {
  assert.equal((await rufe('GET', '/api/v2/arbeit', LISA)).b.nurAdmin, true);
  assert.equal((await rufe('GET', '/api/v2/arbeit/abcd1234', LISA)).status, 403);
  assert.equal((await rufe('POST', '/api/v2/chat', LISA, { ziel: 'hauptchat', text: 'x' })).status, 403);
  const c = await rufe('POST', '/api/v2/chat', LISA, { ziel: 'eigen', text: 'Was ist OLAF?' });
  assert.equal(c.status, 412); assert.match(c.b.error, /alles andere geht ohne/);
});

test('C2: automatisch Geschlossenes steht sichtbar auf der Entscheidungsseite (zählt nicht mit) und lässt sich wieder öffnen', async () => {
  const r = await rufe('GET', '/api/v2/entscheidungen', ADMIN);
  assert.equal(r.b.geschlossen.length, 1); assert.match(r.b.geschlossen[0].grund, /D1/);
  assert.equal(r.b.oben.length + r.b.rest.length + r.b.aufraeumen.length, r.b.zahl, 'die Zahl bleibt die Summe des Offenen');
  assert.equal((await rufe('POST', '/api/v2/wieder-oeffnen', ADMIN, { id: 'q-zu1' })).status, 200);
  assert.equal((await rufe('POST', '/api/v2/wieder-oeffnen', LISA, { id: 'q-zu1' })).status, 409, 'nur eigene');
  assert.equal((await rufe('POST', '/api/v2/wieder-oeffnen', ADMIN, { id: '../x' })).status, 400);
  assert.deepEqual(geoeffnet, ['k:q-zu1', 'l:q-zu1']);
});

test('S13: Startansicht je Rolle — Knut leitet, Christoph prüft (mehr PRs), Lisa ist Team (mehr Dokumente)', async () => {
  const CHRISTOPH = { id: 'c', email: 'c@x', name: 'Christoph Muster', role: 'USER' } as any;
  assert.equal((await rufe('GET', '/api/v2/start', ADMIN)).b.rolle, 'reviewer', 'D8: Besitzer ohne Claude-Zugang, mit GitHub-Namen = Reviewer');
  deps.rolleEinstellung = 'leitung';
  assert.equal((await rufe('GET', '/api/v2/start', ADMIN)).b.rolle, 'leitung', 'Einrichtung (WERKBANK_ROLLE) gilt für die Besitzerin');
  assert.equal((await rufe('GET', '/api/v2/start?teil=oben', LISA)).b.rolle, 'team', '… nie für Gäste');
  deps.rolleEinstellung = null;
  assert.equal((await rufe('GET', '/api/v2/start?teil=oben', LISA)).b.rolle, 'team');
  const c = await rufe('GET', '/api/v2/start', CHRISTOPH);
  assert.equal(c.b.rolle, 'reviewer'); assert.equal(c.b.admin, false);
});

test('S15: „Alle wie empfohlen“ nimmt nur gesehene Entscheidungen mit Empfehlung, die hier beantwortet werden — nie Freigaben, nie Unbekanntes', async () => {
  const r = await rufe('POST', '/api/v2/alle-empfohlen', ADMIN, { ids: ['q-aaaaaa', 'p-abcd1234-1234567', 'gibtsnicht'] });
  assert.equal(r.status, 200);
  assert.deepEqual(sammel, ['q-aaaaaa'], 'nur die Entscheidung mit Empfehlung');
  assert.equal(r.b.ok, 1); assert.equal(r.b.uebersprungen, 2);
  assert.equal((await rufe('POST', '/api/v2/alle-empfohlen', ADMIN, { ids: [] })).status, 400);
  assert.equal((await rufe('POST', '/api/v2/alle-empfohlen', ADMIN, { ids: ['p-abcd1234-1234567'] })).status, 400, 'nur Freigaben: nichts zu tun');
});

test('S15: „Ja, so“ mit Notiz — der Text geht mit der Ja-Antwort an die bestehende Antwortlogik', async () => {
  const n = antworten.length;
  const r = await rufe('POST', '/api/v2/antwort', ADMIN, { id: 'q-aaaaaa', antwort: 'ja', text: 'aber erst nach dem Release' });
  assert.equal(r.status, 200);
  assert.deepEqual(antworten.slice(n), [{ id: 'q-aaaaaa', antwort: 'ja', text: 'aber erst nach dem Release' }]);
});

test('S14: Erledigt an einem gewählten Tag (nur Admin, Datum geprüft); ohne Angabe heute', async () => {
  const r = await rufe('GET', '/api/v2/erledigt?tag=2026-11-02', ADMIN);
  assert.equal(r.status, 200); assert.equal(r.b.tag, '2026-11-02');
  assert.deepEqual(r.b.erledigt.map((e: any) => e.titel), ['Netzentgelte']);
  assert.equal((await rufe('GET', '/api/v2/erledigt', ADMIN)).b.tag, '2026-11-03', 'Vorgabe heute (Wien)');
  assert.equal((await rufe('GET', '/api/v2/erledigt?tag=2026-13-40x', ADMIN)).status, 400);
  for (const t of ['2026-02-31', '2026-04-31', '2026-11-04']) assert.equal((await rufe('GET', `/api/v2/erledigt?tag=${t}`, ADMIN)).status, 400, t);
  assert.equal((await rufe('GET', '/api/v2/erledigt?tag=2026-11-02', LISA)).b.nurAdmin, true);
  assert.ok(tage.includes('2026-11-02'));
});

test('S12: Alle Chats — Admin sieht Unter-Chats und eigene LibreChat-Chats je einmal, Lisa nur ihre Chats', async () => {
  const k = await rufe('GET', '/api/v2/chats', ADMIN);
  assert.deepEqual(k.b.zeilen.map((z: any) => z.art), ['unterchat', 'chat']);
  assert.deepEqual(k.b.themen, ['Tarife']);
  const l = await rufe('GET', '/api/v2/chats', LISA);
  assert.ok(l.b.zeilen.every((z: any) => z.art !== 'unterchat'));
});
