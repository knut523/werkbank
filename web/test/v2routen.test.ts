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
  { id: 'altbestand-deckel', art: 'altbestand', frage: '3 alte Deckel-Fragen', empfehlung: 'alle schließen', quelle: { text: 'Deckel-Fragen', strand: null, url: null }, wartetSeit: null, blockiert: 0, antworten: ['nein', 'spaeter'], daten: { eintraege: [{}, {}, {}], deckel: true } },
] as any[];
const antworten: any[] = [];
let gesperrt = false;
const geoeffnet: string[] = [];
const sammel: string[] = [];
const tage: string[] = [];
const sammelZu: string[] = [];
const deps: V2Deps = {
  needUser: async (req: any) => req.u, body: async (req: any) => req.b, send: (res: any, status, b) => { res.status = status; res.b = b; },
  inboxFuer: async () => ({ eintraege }), unterchatListe: async () => ({ zeilen: [] }), erledigtDaten: async (_u, tag) => { tage.push(tag); return { straenge: tag === '2026-11-02' ? [{ id: 'abcd1234', titel: 'Netzentgelte', at: '2026-11-02T15:00:00Z', link: null, dokumente: [] }] : [] }; },
  fragenAntwort: async (_u, b) => { antworten.push(b); return { ok: true, ziel: 'den Unter-Chat „Rechner“' }; },
  strang: async (u: any, id: string) => (u.id === 'k' && id === 'abcd1234' ? { _id: id, title: 'Rechner', lastExcerpt: 'Stand: D1 bis D3 entschieden, D4 offen — Empfehlung: regional rechnen, weil die Netzbetreiber …', paket: null } : null), hauptchat: async () => null, laeuftChat: async () => false,
  livePrs: async () => ({ map: new Map([['a#1', { pr: 'a#1', repo: 'a', number: 1, title: 'Eins', url: 'https://github.com/o/a/pull/1', turn: { who: 'Lisa', role: 'reviewer', why: 'Review angefragt' }, requested: [] }]]) }),
  githubNames: () => ({ bizarrochris: 'Christoph', knut523: 'Knut' }), letzteReviews: async () => [], reviewKommentar: () => null,
  pakete: () => [{ name: '435-x', titel: 'Bericht X', status: 'wartet', at: Date.now() }],
  vaultSuche: async () => [{ path: 'olaf/datenschutz.md', title: 'Datenschutz' }], vaultNeu: () => [{ path: 'olaf/a.md', title: 'A', mtime: Date.now() }],
  wienDatum: () => '2026-11-03', claudeToken: async () => null, bridgeUrl: 'http://b', altUrl: 'http://alt/wb', log: () => {},
  gesperrt: () => gesperrt,
  geschlossen: async (u) => (u.id === 'k' ? [{ id: 'q-zu1', titel: 'Kohorte laufender Monat?', grund: 'im Bericht als entschieden vermerkt (D1): angenommen', at: new Date() }] : []),
  alleEmpfohlen: async (_u, ids, nur) => { assert.equal(nur({ art: 'push', klasse: 'freigabe' } as any), false, 'innen: Freigabe nie'); sammel.push(...ids); return { ok: ids.length, fehler: [] }; },
  vorlagen: () => [{ name: 'vorlage-spec', label: 'Spec schreiben', beschreibung: 'x', prefix: 'Nutze plan-to-pr.' }],
  sammelSchliessen: async (_u, id) => { sammelZu.push(id); return { ok: true }; },
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
  assert.equal(r.b.zahl, 4);
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

test('Audit 05.11. (4): Hauptchat arbeitet → Text wird eingereiht statt 409; GET zeigt, was wartet', async () => {
  const rein: string[] = [];
  const alt = { hauptchat: deps.hauptchat, laeuftChat: deps.laeuftChat };
  deps.hauptchat = async () => ({ conv: 'h1', url: null }); deps.laeuftChat = async () => true;
  deps.hauptchatEinreihen = async (_u, t) => { rein.push(t); return rein.length; };
  deps.hauptchatEingereiht = async () => rein.map((t) => ({ text: t, at: new Date(0) }));
  try {
    const r = await rufe('POST', '/api/v2/chat', ADMIN, { ziel: 'hauptchat', text: 'Bitte PR 393 ansehen' });
    assert.equal(r.status, 200, JSON.stringify(r.b));
    assert.equal(r.b.eingereiht, true); assert.equal(r.b.wartend, 1);
    assert.deepEqual(rein, ['Bitte PR 393 ansehen']);
    const g = await rufe('GET', '/api/v2/chat?ziel=hauptchat', ADMIN);
    assert.equal(g.b.eingereiht.length, 1); assert.match(g.b.eingereiht[0].text, /PR 393/);
    delete deps.hauptchatEinreihen;
    assert.equal((await rufe('POST', '/api/v2/chat', ADMIN, { ziel: 'hauptchat', text: 'x' })).status, 409, 'ohne Schlange wie bisher');
  } finally { deps.hauptchat = alt.hauptchat; deps.laeuftChat = alt.laeuftChat; delete deps.hauptchatEinreihen; delete deps.hauptchatEingereiht; }
});

test('Audit 05.11. (4): Takt stellt Eingereihtes zu, sobald der Hauptchat frei ist — gebündelt, bei Fehler zurück', async () => {
  const { hauptchatZustellen } = await import('../server/v2.ts');
  let laeuft = true, fehler = false;
  const liegt: any[] = [{ id: 'a', text: 'Erste', at: new Date(1) }, { id: 'b', text: 'Zweite', at: new Date(2) }];
  const gesendet: string[] = [];
  const z = {
    hauptchat: async () => ({ conv: 'h1', url: null }), laeuftChat: async () => laeuft,
    nehmen: async () => liegt.splice(0), zuruecklegen: async (_u: any, l: any[]) => { liegt.unshift(...l); },
    senden: async (_u: any, _c: string, t: string) => { if (fehler) throw new Error('LibreChat weg'); gesendet.push(t); return new Date(); }, log: () => {},
  };
  assert.equal(await hauptchatZustellen(z, ADMIN), 0, 'arbeitet noch');
  assert.equal(liegt.length, 2);
  laeuft = false; fehler = true;
  assert.equal(await hauptchatZustellen(z, ADMIN), 0); assert.equal(liegt.length, 2, 'zurückgelegt');
  fehler = false;
  assert.equal(await hauptchatZustellen(z, ADMIN), 2);
  assert.equal(gesendet.length, 1); assert.match(gesendet[0], /2 Nachrichten[\s\S]*Erste[\s\S]*Zweite/);
  assert.equal(liegt.length, 0);
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

test('S21: alte Deckel-Fragen lassen sich in 2.0 gesammelt schließen (bestehender Weg) — andere Sammelposten nicht', async () => {
  const e = await rufe('GET', '/api/v2/entscheidungen', ADMIN);
  const deckel = e.b.aufraeumen.find((a: any) => a.id === 'altbestand-deckel');
  assert.equal(deckel.schliessbar, 3, 'Anzahl am Sammelposten');
  assert.equal(e.b.aufraeumen.find((a: any) => a.id === 'pflege').schliessbar, undefined);
  assert.equal((await rufe('POST', '/api/v2/sammel-schliessen', ADMIN, { id: 'altbestand-deckel' })).status, 200);
  assert.equal((await rufe('POST', '/api/v2/sammel-schliessen', ADMIN, { id: 'pflege' })).status, 400);
  assert.equal((await rufe('POST', '/api/v2/sammel-schliessen', ADMIN, { id: 'altbestand' })).status, 400, 'Altbestand bleibt Knuts Entscheidung');
  assert.deepEqual(sammelZu, ['altbestand-deckel']);
});

test('S11: Themen — Übersicht und Seite je Thema; ohne „Wissen“ keine Notizen, ohne „Roadmap“ keine PRs', async () => {
  const t = await rufe('GET', '/api/v2/themen', ADMIN);
  assert.equal(t.status, 200);
  assert.ok(t.b.themen.some((x: any) => x.thema === 'Tarife' && x.unterchats === 1), 'von Hand gesetztes Thema gilt: ' + JSON.stringify(t.b.themen));
  const r = await rufe('GET', '/api/v2/thema?name=Tarife', ADMIN);
  assert.deepEqual(r.b.unterchats.map((x: any) => x.id), ['abcd1234']);
  gesperrt = true;
  const g = await rufe('GET', '/api/v2/thema?name=Tarife', LISA);
  assert.deepEqual([g.b.dokumente, g.b.prs, g.b.notizenFrei, g.b.prFrei], [[], [], false, false]);
  gesperrt = false;
  assert.equal((await rufe('GET', '/api/v2/thema', ADMIN)).status, 400);
});

test('S22 (Knut B1): „Was ist das?“ lädt den letzten Stand des Unter-Chats nach — nur eigene, nur Admin', async () => {
  const r = await rufe('GET', '/api/v2/stand/abcd1234', ADMIN);
  assert.equal(r.status, 200); assert.match(r.b.stand, /D4 offen/); assert.equal(r.b.titel, 'Rechner');
  assert.equal((await rufe('GET', '/api/v2/stand/abcd1234', LISA)).status, 403);
  assert.equal((await rufe('GET', '/api/v2/stand/ffffffff', ADMIN)).status, 404);
});

test('S22: Vorlagen — nur bekannte Namen, der Text kommt vom Server; Liste ohne Vorgabetext an die Oberfläche', async () => {
  assert.equal((await rufe('POST', '/api/v2/chat', LISA, { ziel: 'eigen', text: 'hi', vorlage: 'erfunden' })).status, 400);
});

test('Runde 4 (Knut B2): Unter-Chat-Seite sagt, was gilt — Abgleich nur bei Widerspruch, voller Stand statt Auszug', async () => {
  const a = { zeilen: [{ qid: 'q-x', d: 'D4', bericht: null, wiederOffen: false }], offenListe: ['D4', 'D11'], offenBericht: ['D4', 'D11'], agentNennt: ['D4'], widerspruch: true };
  let gefragt = '';
  deps.abgleich = async (_u, id, stand) => { gefragt = `${id}|${stand}`; return a; };
  const r = await rufe('GET', '/api/v2/arbeit/abcd1234', ADMIN);
  assert.equal(r.status, 200);
  assert.deepEqual(r.b.abgleich.offenListe, ['D4', 'D11']);
  assert.match(gefragt, /^abcd1234\|Stand: D1 bis D3/, 'ohne Verlauf: der gespeicherte Auszug geht in den Abgleich');
  deps.abgleich = async () => ({ ...a, widerspruch: false });
  assert.equal((await rufe('GET', '/api/v2/arbeit/abcd1234', ADMIN)).b.abgleich, null, 'stimmen alle überein: kein Kasten');
  deps.abgleich = async () => { throw new Error('kaputt'); };
  assert.equal((await rufe('GET', '/api/v2/arbeit/abcd1234', ADMIN)).status, 200, 'Abgleich kaputt: Seite lädt trotzdem');
  delete deps.abgleich;
});

test('Paket 436 (Knut 04.11.): PR-Karte und PR-Seite zeigen, was nach dem letzten Fix offen geblieben ist (jeder Reviewer)', async () => {
  deps.fixPunkte = async () => [
    { repo: 'o/a', number: 1, status: 'fertig', punkte: { at: '2026-11-04T09:00:00Z', gesamt: 2, offen: 1, liste: [
      { wer: 'bizarrochris', art: 'thread', wo: 'a.ts:3', text: 'Null-Fall fehlt', stand: 'offen', grund: 'nicht-behandelt', notiz: null },
      { wer: 'fazlomar9', art: 'review', wo: null, text: 'Name', stand: 'erledigt', grund: null, notiz: null }] } },
    { repo: 'o/a', number: 1, status: 'fertig', punkte: { at: '2026-11-01T09:00:00Z', gesamt: 5, offen: 5, liste: [] } },
  ];
  const l = await rufe('GET', '/api/v2/prs?wer=alle', ADMIN);
  assert.deepEqual(l.b.zeilen.find((z: any) => z.pr === 'a#1').fix, { offen: 1, gesamt: 2, at: '2026-11-04T09:00:00Z', lesbar: true }, 'der neueste Fix-Lauf zählt');
  const p = await rufe('GET', '/api/v2/prs/a/1', ADMIN);
  assert.deepEqual(p.b.fix.offen.map((x: any) => [x.wer, x.wo, x.grund]), [['Christoph', 'a.ts:3', 'nicht-behandelt']]);
  delete deps.fixPunkte;
  assert.equal((await rufe('GET', '/api/v2/prs/a/1', ADMIN)).b.fix, null);
});

test('Runde 4 (Christoph B1): Reviewer-Start zeigt veröffentlichte Agenten-Reviews offener PRs; PR-Zeilen auf „Jetzt“ tragen das Review', async () => {
  const CHRISTOPH = { id: 'c', email: 'c@x', name: 'Christoph Muster', role: 'USER' } as any;
  const vorher = deps.letzteReviews;
  deps.letzteReviews = async () => [{ repo: 'o/a', number: 1, status: 'fertig', empfehlung: 'comment', posted: { url: 'https://github.com/o/a/pull/1#r' }, doneAt: '2026-11-03T10:00:00Z' }];
  const c = await rufe('GET', '/api/v2/start', CHRISTOPH);
  assert.deepEqual(c.b.reviews.map((p: any) => [p.pr, p.review.empfehlung]), [['a#1', 'comment']]);
  deps.letzteReviews = async () => [{ repo: 'o/a', number: 1, status: 'fertig', empfehlung: 'approve', posted: null }];
  assert.deepEqual((await rufe('GET', '/api/v2/start', CHRISTOPH)).b.reviews, [], 'Entwurf (nicht veröffentlicht): nicht auf dem Reviewer-Start');
  deps.rolleEinstellung = 'leitung';
  const k = await rufe('GET', '/api/v2/start', ADMIN);
  assert.deepEqual(k.b.reviews, [], 'nur für Reviewer');
  deps.rolleEinstellung = null;
  deps.letzteReviews = vorher;
});

test('Runde 5 (Knut B1): Sammelkarte („D1–D2 …“) trägt die gemeinten Entscheidungen aus dem Bericht und den Bericht-Link', async () => {
  const q = eintraege.find((e) => e.id === 'q-aaaaaa');
  const alt = q.frage;
  q.frage = 'D1–D2 aus dem Bericht wie empfohlen?';
  deps.berichtVon = async (_u, id) => (id === 'abcd1234' ? { paket: '416-netz', fragen: [{ id: 'D1', frage: 'Ab wann rechnen?', empfehlung: 'Ab 2027', antwort: '' }, { id: 'D2', frage: 'Welcher Rabatt?', empfehlung: 'Je Gemeinschaft', antwort: 'nach 24 h angenommen' }, { id: 'D3', frage: 'x' }] } : null);
  try {
    const r = await rufe('GET', '/api/v2/entscheidungen', ADMIN);
    const k = [...r.b.oben, ...r.b.rest].find((x: any) => x.id === 'q-aaaaaa');
    assert.deepEqual(k.bezug.map((b: any) => [b.id, b.empfehlung, b.antwort]), [['D1', 'Ab 2027', null], ['D2', 'Je Gemeinschaft', 'nach 24 h angenommen']]);
    assert.equal(k.bericht, '/v2/dokument?paket=416-netz&datei=bericht.md');
    assert.equal(k.links[0].label, 'Bericht');
    deps.berichtVon = async () => ({ paket: '416-netz', fragen: [{ id: 'D1', frage: 'Ab wann?' }] });
    const halb = [...(await rufe('GET', '/api/v2/entscheidungen', ADMIN)).b.oben, ...(await rufe('GET', '/api/v2/entscheidungen', ADMIN)).b.rest].find((x: any) => x.id === 'q-aaaaaa');
    assert.equal(halb.bezug, undefined, 'unvollständig (D2 fehlt im Bericht): keine halbe Liste, nur Hinweis + Bericht');
    assert.equal(halb.bericht, '/v2/dokument?paket=416-netz&datei=bericht.md');
    deps.berichtVon = async () => { throw new Error('kaputt'); };
    assert.equal((await rufe('GET', '/api/v2/entscheidungen', ADMIN)).status, 200, 'Bericht nicht lesbar: Seite lädt trotzdem');
  } finally { q.frage = alt; delete deps.berichtVon; }
});

test('Runde 7 (Knut: Themen als tragende Ordnung): Thema-Seite mit Roadmap-Items, Zustand je Unter-Chat, PRs mit „wartet auf“; PR-Zeilen tragen ihr Thema', async () => {
  deps.roadmap = () => [{ thema: 'Tarife', titel: 'Netzentgelte 2027', path: 'olaf/x/3-Plan/a.md', stand: 'geplant', standNr: 3, mtime: 1 }, { thema: 'Bot', titel: 'Übergabe', path: 'olaf/y.md', stand: 'Backlog', standNr: 1, mtime: 1 }];
  try {
    const r = await rufe('GET', '/api/v2/thema?name=Tarife', ADMIN);
    assert.deepEqual(r.b.roadmap.map((x: any) => [x.titel, x.stand]), [['Netzentgelte 2027', 'geplant']]);
    assert.ok(r.b.unterchats.every((u: any) => typeof u.gruppe === 'string' && typeof u.satz === 'string'), 'jeder Unter-Chat mit Zustand');
    const t = await rufe('GET', '/api/v2/themen', ADMIN);
    assert.equal(t.b.themen.find((x: any) => x.thema === 'Bot')?.roadmap, 1);
    const p = await rufe('GET', '/api/v2/prs?wer=alle', ADMIN);
    assert.ok(p.b.zeilen.every((z: any) => typeof z.thema === 'string' && z.thema.length > 0));
    gesperrt = true;
    assert.deepEqual((await rufe('GET', '/api/v2/thema?name=Tarife', LISA)).b.roadmap, [], 'ohne Freigabe „wissen“ keine Roadmap-Items');
    gesperrt = false;
  } finally { delete deps.roadmap; }
});

test('Runde 7 (Knut: Unter-Chats transparent): Steckbrief mit Wofür, Jetzt gerade, Schritten, Wartet auf; Liste zeigt „Jetzt: …“', async () => {
  const altStrang = deps.strang;
  deps.strang = async (u: any, id: string) => (u.id === 'k' && id === 'abcd1234' ? { _id: id, conv: null, title: 'Rechner', prompt: '# Auftrag\nBaue die PDF-Vorschau für den Rechner neu.', startedAt: new Date(Date.now() - 30 * 60000), lastActivity: new Date(Date.now() - 12 * 60000), lastModell: 'opus', paket: null,
    lastExcerpt: '### Stand\n- Erledigt: Plan\n- Offen: Vorschau bauen\n- Braucht Knut: D4 entscheiden\n- Berührt: tariff-app, feat/pdf', berichtKopf: { github: [{ repo: 'WirStrom1/olaf-tariff-app', zweig: 'feat/pdf', commit: 'abc1234def' }] } } : null);
  try {
    const r = await rufe('GET', '/api/v2/arbeit/abcd1234', ADMIN);
    const s = r.b.steckbrief;
    assert.equal(s.wofuer, 'Baue die PDF-Vorschau für den Rechner neu.');
    assert.deepEqual(s.schritte.map((x: any) => [x.text, x.stand]), [['Plan', 'fertig'], ['Vorschau bauen', 'offen']]);
    assert.deepEqual(s.wartetAuf, [{ wer: 'dich', was: 'D4 entscheiden' }]);
    assert.deepEqual(s.beruehrt.repos, ['olaf-tariff-app · feat/pdf']);
    assert.equal(s.beruehrt.text, 'tariff-app, feat/pdf');
    assert.equal(s.modell, 'opus'); assert.ok(s.laufzeitMin >= 29);
    assert.equal(s.laeuft, false); assert.ok(s.ruhtMin >= 11 && s.ruhtMin <= 13, 'Persona R7: ruht seit dem letzten Zug (nicht „läuft seit 24 h“)');
    assert.ok(s.ergebnisse.some((x: any) => /Commit abc1234/.test(x.label)));
  } finally { deps.strang = altStrang; }
});

test('Runde 7 (Abgleich): Nachricht an einen Unter-Chat — nur Admin, nur eigene, nicht leer', async () => {
  const gesendet: string[] = [];
  deps.nachreichen = async (_u, id, text) => { gesendet.push(`${id}:${text}`); };
  try {
    assert.equal((await rufe('POST', '/api/v2/arbeit/abcd1234/nachricht', ADMIN, { text: 'Erst die Tests.' })).status, 200);
    assert.deepEqual(gesendet, ['abcd1234:Erst die Tests.']);
    assert.equal((await rufe('POST', '/api/v2/arbeit/abcd1234/nachricht', LISA, { text: 'x' })).status, 403);
    assert.equal((await rufe('POST', '/api/v2/arbeit/abcd1234/nachricht', ADMIN, { text: '  ' })).status, 400);
    assert.equal((await rufe('POST', '/api/v2/arbeit/ffffffff/nachricht', ADMIN, { text: 'x' })).status, 404);
  } finally { delete deps.nachreichen; }
});

test('Runde 7 (Knut: DoD): fertig ohne Beleg je Zeile heißt „fast fertig“ — in Arbeit, im Steckbrief und als liegen gebliebene Enden', async () => {
  const altListe = deps.unterchatListe, altStrang = deps.strang;
  const stand = '### Stand\n- DoD: [x] Tests grün — 12/0 · [ ] Push/PR (Besitzer: Knut)\n- Folge: Vault nachziehen (Besitzer: Hauptchat)\nStatus: fertig';
  deps.unterchatListe = async () => ({ zeilen: [{ id: 'abcd1234', titel: 'Rechner', zustand: 'fertig', bericht: true, paket: 'p' }] });
  deps.strang = async (u: any, id: string) => (u.id === 'k' && id === 'abcd1234' ? { _id: id, title: 'Rechner', lastExcerpt: stand, paket: null } : null);
  try {
    const a = await rufe('GET', '/api/v2/arbeit', ADMIN);
    assert.match(a.b.gruppen.fertig[0].satz, /^Fast fertig — fehlt: Push\/PR; Vault nachziehen; wartet auf: Knut, Hauptchat\./);
    const e = await rufe('GET', '/api/v2/enden', ADMIN);
    assert.deepEqual(e.b.enden.map((x: any) => [x.text, x.besitzer]), [['Push/PR', 'Knut'], ['Vault nachziehen', 'Hauptchat']]);
    const det = await rufe('GET', '/api/v2/arbeit/abcd1234', ADMIN);
    assert.match(det.b.satz, /^Fast fertig/);
    assert.equal(det.b.steckbrief.dod.zeilen.length, 2);
    assert.deepEqual((await rufe('GET', '/api/v2/enden', LISA)).b.enden, [], 'nur Admin');
  } finally { deps.unterchatListe = altListe; deps.strang = altStrang; }
});

test('Abgleich (h): Volltextsuche über die eigenen Chat-Nachrichten — Auszug um den Treffer, mindestens 3 Zeichen, eigene Chats', async () => {
  const gefragt: string[] = [];
  deps.lcVolltext = async (u: any, q: string) => { gefragt.push(`${u.id}:${q}`); return [{ conv: 'c1', text: 'Vorher langer Text über Netzentgelte 2027 und danach noch mehr', at: new Date('2026-11-04T10:00:00Z') }]; };
  try {
    const r = await rufe('GET', '/api/v2/chats/suche?q=netzentgelte', LISA);
    assert.equal(r.status, 200);
    assert.deepEqual(r.b.treffer.map((t: any) => t.conv), ['c1']);
    assert.match(r.b.treffer[0].auszug, /Netzentgelte 2027/);
    assert.deepEqual(gefragt, ['l:netzentgelte'], 'sucht nur in den Chats der angemeldeten Person');
    assert.deepEqual((await rufe('GET', '/api/v2/chats/suche?q=ab', LISA)).b.treffer, [], 'unter 3 Zeichen: nichts');
  } finally { delete deps.lcVolltext; }
});

test('Plan §23 T6 (Schalter WERKBANK_TRIAGE): ein Unter-Chat mit nur technischen Fragen steht unter „Läuft“, mit Knut-Frage unter „Wartet“', async () => {
  const altListe = deps.unterchatListe, altInbox = deps.inboxFuer;
  deps.unterchatListe = async () => ({ zeilen: [{ id: 'tech1', titel: 'Nur Technik', zustand: 'wartet', cs: { status: 'braucht' } }, { id: 'knut1', titel: 'Mit Geldfrage', zustand: 'wartet', cs: { status: 'braucht' } }] }) as any;
  const karte = (id: string, frage: string) => ({ id: `d-${id}-x`, art: 'entscheidung', frage: '', empfehlung: null, quelle: { text: `Unter-Chat „${id}“`, strand: id, url: null }, wartetSeit: null, blockiert: 1, antworten: ['ja'], daten: { strand: id, entscheidungen: [{ id: 'D1', frage, empfehlung: 'Ja' }] } });
  deps.inboxFuer = async () => ({ eintraege: [karte('tech1', 'Liste nach Datum sortieren?'), karte('knut1', 'Budget für Anzeigen freigeben?')] }) as any;
  try {
    process.env.WERKBANK_TRIAGE = '1';
    const an = (await rufe('GET', '/api/v2/arbeit', ADMIN)).b.gruppen;
    assert.deepEqual(an.laeuft.map((z: any) => z.id), ['tech1']);
    assert.deepEqual(an.wartet.map((z: any) => z.id), ['knut1']);
    assert.match(an.wartet[0].satz, /eine Entscheidung/);
    delete process.env.WERKBANK_TRIAGE;
    const aus = (await rufe('GET', '/api/v2/arbeit', ADMIN)).b.gruppen;
    assert.deepEqual(aus.wartet.map((z: any) => z.id).sort(), ['knut1', 'tech1'], 'Schalter aus: wie bisher');
  } finally { deps.unterchatListe = altListe; deps.inboxFuer = altInbox; delete process.env.WERKBANK_TRIAGE; }
});

test('Plan §23 T4: „Für dich“ — Entscheidungen, Jetzt und die Zahl zeigen mit Triage nur Knut-Fragen; was Claude/Council entscheidet, steht als Zeile', async () => {
  const altInbox = deps.inboxFuer;
  const karte = (id: string, ents: any[]) => ({ id: `d-${id}-x`, art: 'entscheidung', frage: '', empfehlung: null, quelle: { text: `Unter-Chat „${id}“`, strand: id, url: null }, wartetSeit: '2026-11-05T08:00:00Z', blockiert: 1, antworten: ['ja'], daten: { strand: id, entscheidungen: ents } });
  deps.inboxFuer = async () => ({ eintraege: [karte('s1', [{ id: 'D1', frage: 'Liste nach Datum sortieren?', empfehlung: 'Ja' }, { id: 'D2', frage: 'Anzeigen-Budget erhöhen?', empfehlung: 'Ja, auf 500 €' }, { id: 'D3', frage: 'Datenmodell migrieren?', empfehlung: 'Ja' }])] }) as any;
  try {
    process.env.WERKBANK_TRIAGE = '1';
    const e = (await rufe('GET', '/api/v2/entscheidungen', ADMIN)).b;
    const titel = [...e.oben, ...e.rest].map((k: any) => k.titel);
    assert.equal(titel.length, 1); assert.match(titel[0], /Budget/);
    assert.equal(e.zahl, 1);
    assert.deepEqual(e.beiClaude, { technisch: 1, gewichtig: 1 });
    assert.equal((await rufe('GET', '/api/v2/zahl', ADMIN)).b.zahl, 1);
    const s = (await rufe('GET', '/api/v2/start?teil=oben', ADMIN)).b;
    assert.equal(s.jetzt.length, 1); assert.equal(s.zahl, 1);
    delete process.env.WERKBANK_TRIAGE;
    const aus = (await rufe('GET', '/api/v2/entscheidungen', ADMIN)).b;
    assert.equal([...aus.oben, ...aus.rest].length, 3, 'Schalter aus: alle wie bisher');
  } finally { deps.inboxFuer = altInbox; delete process.env.WERKBANK_TRIAGE; }
});

test('Plan §23 T5: Protokoll „Von Claude entschieden“ — gesamt und je Unter-Chat, Umkehren mit einem Klick geht an den Unter-Chat', async () => {
  const zeilen = [
    { id: 'l1', frage: 'Liste nach Datum sortieren?', antwort: 'von Claude entschieden (technisch) (D1)', durch: 'auto', at: '2026-11-05T09:00:00Z', strand: { id: 's1', titel: 'Rechner' }, widerruf: null, widerrufbar: true, widerrufGrund: null, council: null },
    { id: 'l2', frage: 'Datenmodell migrieren?', antwort: 'ja', durch: 'auto', at: '2026-11-05T09:05:00Z', strand: { id: 's2', titel: 'Bot' }, widerruf: null, widerrufbar: true, widerrufGrund: null, council: { urteil: 'HALTEN', satz: 'Migration mit Rückweg' } },
    { id: 'l3', frage: 'Budget?', antwort: 'Ja', durch: 'knut', at: '2026-11-05T08:00:00Z', strand: null, widerruf: null, widerrufbar: false, widerrufGrund: 'Von Knut selbst beantwortet', council: null },
  ];
  const umgekehrt: string[] = [];
  deps.entschiedenLog = async () => zeilen as any;
  deps.umkehren = async (_u: any, id: string, text: string) => { umgekehrt.push(`${id}:${text}`); };
  try {
    const g = (await rufe('GET', '/api/v2/entschieden', ADMIN)).b;
    assert.deepEqual(g.zeilen.map((z: any) => z.id), ['l2', 'l1'], 'nur von Claude entschiedene, neueste zuerst');
    assert.equal(g.zeilen[0].council.urteil, 'HALTEN');
    assert.deepEqual((await rufe('GET', '/api/v2/entschieden?strand=s1', ADMIN)).b.zeilen.map((z: any) => z.id), ['l1']);
    const r = await rufe('POST', '/api/v2/entschieden/l1/umkehren', ADMIN, {});
    assert.equal(r.status, 200);
    assert.match(umgekehrt[0], /^l1:Umkehren/);
    assert.equal((await rufe('POST', '/api/v2/entschieden/l1/umkehren', LISA, {})).status, 403, 'nur Admin');
    assert.match((await rufe('POST', '/api/v2/entschieden/l1/umkehren', ADMIN, { text: 'Lieber nach Name' })).b.ok ? umgekehrt[1] : '', /Lieber nach Name/);
  } finally { delete deps.entschiedenLog; delete deps.umkehren; }
});

test('Plan §23 T3: POST /api/v2/council — nur gewichtige Fragen, Urteil geprüft, nur Admin; Wirkung über councilAnwenden', async () => {
  const altInbox = deps.inboxFuer;
  const angewandt: any[] = [];
  const karte = { id: 'd-g1-x', art: 'entscheidung', frage: '', empfehlung: null, quelle: { text: 'Unter-Chat „g1“', strand: 'g1', url: null }, wartetSeit: '2026-11-05T08:00:00Z', blockiert: 1, antworten: ['ja'], daten: { strand: 'g1', entscheidungen: [{ id: 'D1', frage: 'Datenmodell migrieren?', empfehlung: 'Ja' }, { id: 'D2', frage: 'Liste sortieren?', empfehlung: 'Ja' }] } };
  deps.inboxFuer = async () => ({ eintraege: [karte] }) as any;
  deps.councilAnwenden = async (_u: any, f: any, c: any, w: any) => { angewandt.push([f.id, c.urteil, w.schliessen]); };
  try {
    const ok = await rufe('POST', '/api/v2/council', ADMIN, { frage: 'd-g1-x~D1', urteil: 'HALTEN', grund: 'Migration mit Rückweg' });
    assert.equal(ok.status, 200);
    assert.deepEqual(angewandt, [['d-g1-x~D1', 'HALTEN', true]]);
    assert.equal((await rufe('POST', '/api/v2/council', ADMIN, { frage: 'd-g1-x~D2', urteil: 'HALTEN', grund: 'x' })).status, 409, 'technische Frage: kein Council');
    assert.equal((await rufe('POST', '/api/v2/council', ADMIN, { frage: 'd-g1-x~D1', urteil: 'AENDERN', grund: 'x' })).status, 400, 'ÄNDERN ohne Bedingung');
    assert.equal((await rufe('POST', '/api/v2/council', ADMIN, { frage: 'gibt-es-nicht', urteil: 'HALTEN', grund: 'x' })).status, 404);
    assert.equal((await rufe('POST', '/api/v2/council', LISA, { frage: 'd-g1-x~D1', urteil: 'HALTEN', grund: 'x' })).status, 403);
  } finally { deps.inboxFuer = altInbox; delete deps.councilAnwenden; }
});

test('Plan §24 A4: Aufgabenliste „Braucht Hauptsitzung“ — offen/erledigt, abhaken bleibt, nur Admin', async () => {
  const altListe = deps.unterchatListe, altStrang = deps.strang;
  const haken = new Set<string>();
  deps.unterchatListe = async () => ({ zeilen: [{ id: 'h1', titel: 'Werkbank-Fix', zustand: 'fertig' }] }) as any;
  deps.strang = async (_u: any, id: string) => (id === 'h1' ? { _id: 'h1', title: 'Werkbank-Fix', standVoll: '### Stand\n- Braucht Hauptsitzung: Live-Gang nach Commit abc1234\nStatus: fertig' } : null) as any;
  deps.hauptsitzungHaken = { lesen: async () => haken, setzen: async (_u: any, key: string, an: boolean) => { if (an) haken.add(key); else haken.delete(key); } };
  try {
    const a = (await rufe('GET', '/api/v2/hauptsitzung', ADMIN)).b;
    assert.deepEqual(a.punkte.map((p: any) => [p.text, p.erledigt]), [['Live-Gang nach Commit abc1234', false]]);
    assert.equal((await rufe('POST', `/api/v2/hauptsitzung/${encodeURIComponent(a.punkte[0].key)}`, ADMIN, { erledigt: true })).status, 200);
    assert.equal((await rufe('GET', '/api/v2/hauptsitzung', ADMIN)).b.punkte[0].erledigt, true);
    assert.deepEqual((await rufe('GET', '/api/v2/hauptsitzung', LISA)).b.punkte, []);
    assert.equal((await rufe('POST', `/api/v2/hauptsitzung/${encodeURIComponent(a.punkte[0].key)}`, LISA, { erledigt: true })).status, 403);
    assert.equal((await rufe('POST', '/api/v2/hauptsitzung/a%zz', ADMIN, {})).status, 400, 'Gegenprüfung: kaputte Kodierung → 400');
    assert.equal((await rufe('POST', '/api/v2/hauptsitzung/irgendwas', ADMIN, {})).status, 400, 'nur Kennungen der Form strang:hash');
  } finally { deps.unterchatListe = altListe; deps.strang = altStrang; delete deps.hauptsitzungHaken; }
});

test('Knut 05.11. 19:00 „Zum Ansehen“: Karte je fertigem Strang mit Stand und Links; Passt/Ändern/Später + Notiz gehen an den Strang', async () => {
  const altListe = deps.unterchatListe, altStrang = deps.strang;
  const antworten: any[] = [];
  deps.unterchatListe = async () => ({ zeilen: [{ id: 'f1', titel: 'Netzentgelte-Deck', zustand: 'fertig', paket: '480-deck', bericht: true }, { id: 'l1', titel: 'Läuft noch', zustand: 'laeuft' }, { id: 'f2', titel: 'Später', zustand: 'fertig' }] }) as any;
  deps.strang = async (_u: any, id: string) => ({ _id: id, title: id, standVoll: '### Stand\n- Erledigt: x\nStatus: fertig', berichtKopf: { github: [{ repo: 'WirStrom1/olaf-admin', pr: 'WirStrom1/olaf-admin#393', url: 'https://github.com/WirStrom1/olaf-admin/pull/393' }], review: [{ titel: 'Deck', url: 'https://example.org/deck' }] } }) as any;
  deps.ansehenSpaeter = async () => new Set(['f2']);
  deps.ansehenAntwort = async (_u: any, id: string, art: string, notiz: string, titel: string) => { antworten.push([id, art, notiz, titel]); };
  try {
    const g = (await rufe('GET', '/api/v2/ansehen', ADMIN)).b;
    assert.deepEqual(g.karten.map((k: any) => k.id), ['f1'], 'nur fertige, „Später“ ausgeblendet');
    const labels = g.karten[0].links.map((l: any) => l.label);
    assert.ok(labels.includes('Bericht') && labels.includes('PR olaf-admin#393') && labels.includes('Deck'), labels.join(','));
    assert.equal((await rufe('POST', '/api/v2/ansehen/f1', ADMIN, { art: 'aendern', notiz: 'Folie 3 kürzen' })).status, 200);
    assert.deepEqual(antworten[0], ['f1', 'aendern', 'Folie 3 kürzen', 'Netzentgelte-Deck']);
    assert.equal((await rufe('POST', '/api/v2/ansehen/f1', ADMIN, { art: 'aendern', notiz: ' ' })).status, 400, 'Ändern braucht eine Notiz');
    assert.equal((await rufe('POST', '/api/v2/ansehen/f1', ADMIN, { art: 'egal' })).status, 400);
    assert.equal((await rufe('POST', '/api/v2/ansehen/f1', LISA, { art: 'passt' })).status, 403);
    assert.deepEqual((await rufe('GET', '/api/v2/ansehen', LISA)).b.karten, []);
  } finally { deps.unterchatListe = altListe; deps.strang = altStrang; delete deps.ansehenSpaeter; delete deps.ansehenAntwort; }
});

test('Knut 05.11. abends (1)+(2): PR-Zeile zeigt „Strang arbeitet daran“; Aktionen Review/Tief/Fixen/Auftrag nur für Admin, geprüft', async () => {
  const aktionen: any[] = [];
  deps.prStraenge = async () => [{ _id: 's9', title: 'PR-Review a#1', zustand: 'laeuft', prReview: { repo: 'a', number: 1 } }] as any;
  deps.prAktion = async (_u: any, pr: string, art: string, text: string) => { aktionen.push([pr, art, text]); return { hinweis: 'eingereiht' }; };
  try {
    const z = (await rufe('GET', '/api/v2/prs?wer=alle', ADMIN)).b.zeilen[0];
    assert.deepEqual(z.straenge, [{ id: 's9', titel: 'PR-Review a#1', zustand: 'läuft' }]);
    for (const art of ['review', 'tief', 'fixen']) assert.equal((await rufe('POST', '/api/v2/pr-aktion', ADMIN, { pr: 'a#1', art })).status, 200, art);
    assert.equal((await rufe('POST', '/api/v2/pr-aktion', ADMIN, { pr: 'a#1', art: 'auftrag', text: 'Tests für den Rechner ergänzen' })).status, 200);
    assert.deepEqual(aktionen.map((a) => a[1]), ['review', 'tief', 'fixen', 'auftrag']);
    assert.equal(aktionen[3][2], 'Tests für den Rechner ergänzen');
    assert.equal((await rufe('POST', '/api/v2/pr-aktion', ADMIN, { pr: 'a#1', art: 'auftrag', text: ' ' })).status, 400, 'Auftrag braucht Text');
    assert.equal((await rufe('POST', '/api/v2/pr-aktion', ADMIN, { pr: 'a#1', art: 'mergen' })).status, 400, 'nie mergen');
    assert.equal((await rufe('POST', '/api/v2/pr-aktion', ADMIN, { pr: 'a#99', art: 'review' })).status, 404, 'nur offene PRs');
    assert.equal((await rufe('POST', '/api/v2/pr-aktion', LISA, { pr: 'a#1', art: 'review' })).status, 403);
    assert.equal((await rufe('GET', '/api/v2/prs?wer=alle', LISA)).b.zeilen[0]?.straenge, undefined, 'Nicht-Admin sieht keine Stränge');
  } finally { delete deps.prStraenge; delete deps.prAktion; }
});
