// Übersicht mit direktem Handeln (docs/plan-uebersicht-handeln.md, Paket 184): Ampel, Entscheidungen aus zwei Quellen,
// „Von dir“, Links (nur http(s)), Basis des Paketdienstes, Gruppen nach Thema.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ampel, offeneEntscheidungen, vonDir, kennungen, brauchtKnut, kartenLinks, paketBasis, freigabeZusatz, gruppieren, replyText } from '../server/uebersicht.ts';
import { berichtHash } from '../server/freigabe.ts';

const kopf = (status: string, fragen: any[] = []) => ({ status, titel: 'T', worum: 'W', anders: [], offen: [], review: [], fragen, github: [] }) as any;

test('DoD 2: Ampel läuft > blockiert > bereit zum Push > dein Review', () => {
  assert.equal(ampel({ running: true, wort: 'gestoppt', kopf: kopf('blockiert'), offen: 0 }), 'laeuft');
  assert.equal(ampel({ running: false, wort: 'fertig', kopf: kopf('blockiert'), offen: 0 }), 'blockiert');
  assert.equal(ampel({ running: false, wort: 'gestoppt', kopf: kopf('bereit_fuer_github'), offen: 0 }), 'blockiert');
  assert.equal(ampel({ running: false, wort: 'fertig', kopf: kopf('bereit_fuer_github'), offen: 0 }), 'push');
  assert.equal(ampel({ running: false, wort: 'fertig', kopf: kopf('bereit_fuer_github'), offen: 1 }), 'review', 'offene Frage → erst Review');
  assert.equal(ampel({ running: false, wort: 'fertig', kopf: kopf('wartet_auf_knut'), offen: 0 }), 'review');
  assert.equal(ampel({ running: false, wort: 'wartet', kopf: null, offen: 0, excerpt: '### Stand\nStatus: blockiert' }), 'blockiert');
  assert.equal(ampel({ running: false, wort: 'wartet', kopf: null, offen: 0, excerpt: 'Status: fertig' }), 'review');
});

const BERICHT = `---
status: wartet_auf_knut
titel: Titel
worum: Worum
fragen:
  - id: D1
    frage: Kopf-Frage eins
    empfehlung: Kopf-Empfehlung
    antwort: ""
  - id: D2
    frage: Kopf-Frage zwei
    empfehlung: B
    antwort: "erledigt"
  - id: D3
    frage: Nur im Kopf
    empfehlung: C
    antwort: ""
---
# Bericht

**D1 — Text-Frage eins**
- Optionen: a, b
- Empfehlung: a

**D2 — Text-Frage zwei**
- Empfehlung: b

**D4 — beantwortet**
- Empfehlung: x
- Knut: akzeptiert (15.10.)
`;

test('Council 2: Entscheidungen aus Text und Kopf, eine Zeile je Kennung, beantwortet aus beiden Quellen', () => {
  const o = offeneEntscheidungen(BERICHT, null);
  assert.deepEqual(o.map((e) => e.id), ['D1', 'D3']);
  assert.equal(o[0].quelle, 'bericht');
  assert.equal(o[0].empfehlung, 'a');
  assert.equal(o[1].quelle, 'kopf');
  // Über die Werkbank für genau diesen Stand beantwortet → weg; für einen anderen Stand → bleibt.
  assert.deepEqual(offeneEntscheidungen(BERICHT, { berichtHash: berichtHash(BERICHT), ids: ['D1'] }).map((e) => e.id), ['D3']);
  assert.deepEqual(offeneEntscheidungen(BERICHT, { berichtHash: 'alt', ids: ['D1'] }).map((e) => e.id), ['D1', 'D3']);
  assert.deepEqual(offeneEntscheidungen(null, null), []);
});

test('Von dir: Push-Go, Kennungen, Rückfragen, Antwort; läuft → nichts', () => {
  const base = { ampel: 'push' as const, freigabeOffen: false, kannFreigeben: true, entscheidungen: [], rueckfragen: 0, braucht: null };
  assert.equal(vonDir(base), 'Push-Go');
  assert.equal(vonDir({ ...base, freigabeOffen: true }), 'nichts — freigegeben, der Hauptchat pusht');
  assert.equal(vonDir({ ...base, ampel: 'review', entscheidungen: ['D1', 'D2', 'D3'], rueckfragen: 1 }), 'Entscheidungen D1–D3 und eine Rückfrage');
  assert.equal(vonDir({ ...base, ampel: 'review', braucht: 'Freigabe für X' }), 'Antwort: Freigabe für X');
  assert.equal(vonDir({ ...base, ampel: 'review' }), 'Review');
  assert.equal(vonDir({ ...base, kannFreigeben: false, gepusht: true }), 'nichts — gepusht, PR-Review auf GitHub');
  assert.equal(vonDir({ ...base, kannFreigeben: false }), 'Review', 'bereit, aber nichts freizugeben (kein Repo im Kopf) → ansehen');
  assert.equal(vonDir({ ...base, ampel: 'laeuft', entscheidungen: ['D1'] }), 'nichts — läuft noch');
  assert.equal(kennungen(['D1', 'D3']), 'D1, D3');
  assert.equal(kennungen(['E-147-1', 'E-147-2', 'E-147-3']), 'E-147-1, E-147-2, E-147-3');
});

test('Braucht Knut aus dem Stand-Abschnitt, „nichts“ zählt nicht', () => {
  assert.equal(brauchtKnut('### Stand\n- Erledigt: x\n- Braucht Knut: Freigabe D1\nStatus: braucht Antwort'), 'Freigabe D1');
  assert.equal(brauchtKnut('- Braucht Knut: nichts'), null);
  assert.equal(brauchtKnut('- Braucht Knut: „nichts“'), null);
  assert.equal(brauchtKnut(null), null);
  for (const leer of ['-', '—', 'keine', 'Keine.', 'n/a', 'nichts (alles erledigt)']) assert.equal(brauchtKnut(`- Braucht Knut: ${leer}`), null, leer);
  assert.equal(brauchtKnut('- Braucht Knut: keine Ahnung, ob D1 passt — bitte entscheiden'), 'keine Ahnung, ob D1 passt — bitte entscheiden');
});

test('Council 1/6: Links nur http(s); Folien und Bilder nur mit Paketdienst', () => {
  const dateien = [{ rel: 'bericht.md', size: 1, mtimeMs: 1 }, { rel: '2026-10-15_bericht_x.html', size: 1, mtimeMs: 2 }, { rel: 'index.html', size: 1, mtimeMs: 3 },
    { rel: 'vorbild-morgen.html', size: 1, mtimeMs: 4 }, { rel: 'screenshots/a 1.png', size: 1, mtimeMs: 1 }, { rel: 'screenshots/b.png', size: 1, mtimeMs: 1 }];
  const k = kopf('wartet_auf_knut');
  k.review = [{ titel: 'Admin-Vorschau', url: 'https://3064--x/', login: 'https://3064--x/login' }, { titel: 'böse', url: 'javascript:alert(1)' }, { titel: 'Bot', url: 'http://bot' }];
  const l = kartenLinks({ id: 'abc', bericht: true, paket: '184-x', dateien, basis: 'https://8098--h', kopf: k, chat: 'javascript:x' });
  assert.deepEqual(l.map((x) => [x.art, x.label, x.url]), [
    ['bericht', 'Bericht', '#/leitstand?bericht=abc'],
    ['folien', 'Folien', 'https://8098--h/184-x/2026-10-15_bericht_x.html'],
    ['bilder', 'Bilder (2)', 'https://8098--h/184-x/screenshots/'],
    ['vorschau', 'Admin-Vorschau', 'https://3064--x/login'],
    ['vorschau', 'Bot', 'http://bot'],
  ]);
  const gemischt = kartenLinks({ id: 'abc', bericht: false, paket: '184-x', dateien: [{ rel: 'a/1.png', size: 1, mtimeMs: 1 }, { rel: 'b/2.png', size: 1, mtimeMs: 1 }], basis: 'https://8098--h', kopf: null });
  assert.equal(gemischt[0].url, 'https://8098--h/184-x/a/1.png', 'verschiedene Ordner → erstes Bild statt eines Ordners');
  const ohne = kartenLinks({ id: 'abc', bericht: false, paket: '184-x', dateien, basis: null, kopf: null, chat: 'https://chat/c/1' });
  assert.deepEqual(ohne.map((x) => x.art), ['chat']);
});

test('Basis des Paketdienstes: Umgebung, sonst Dienste-Register; nur http(s)', () => {
  assert.equal(paketBasis({ WERKBANK_PAKETE_URL: 'https://p/' }, () => null), 'https://p');
  assert.equal(paketBasis({ WERKBANK_PAKETE_URL: 'javascript:x' }, () => null), null);
  const y = '- port: 8098\n  was: Review-Pakete (http.server über ~/work/knut/review-pakete)\n  link: https://8098--main--dev--knut.ws.konekto.energy\n';
  assert.equal(paketBasis({}, () => y), 'https://8098--main--dev--knut.ws.konekto.energy');
  assert.equal(paketBasis({}, () => '- was: anderes\n  link: https://x'), null);
  assert.equal(paketBasis({}, () => null), null);
});

test('Freigabe-Zusatz nur aus der Werkbank-Freigabe', () => {
  assert.equal(freigabeZusatz(null), null);
  assert.equal(freigabeZusatz({ head: 'abcdef123456' }), 'freigegeben abcdef1 · wartet auf Push');
  assert.equal(freigabeZusatz({ head: 'abcdef123456', veraltet: true }), 'Freigabe veraltet (abcdef1)');
  assert.equal(freigabeZusatz({ head: 'abcdef123456', pushedAt: new Date(), prNr: 7 }), 'gepusht · PR #7');
});

test('Gruppen nach Thema: Review/blockiert zuerst, Zähler je Ampel, lose Rückfragen zählen in „Von dir“', () => {
  const k = (id: string, thema: string, a: any, von = 'Review') => ({ id, thema, ampel: a, vonDir: von, statusAt: new Date(0) }) as any;
  const g = gruppieren([k('1', 'Workspace', 'laeuft', 'nichts — läuft noch'), k('2', 'Flex', 'push', 'Push-Go'), k('3', 'Bot', 'review'), k('4', 'Flex', 'review')], [{ id: 'q-1' }]);
  assert.deepEqual(g.themen.map((t) => t.thema), ['Bot', 'Flex', 'Workspace']);
  assert.deepEqual(g.themen[1].karten.map((x: any) => x.id), ['4', '2']);
  assert.deepEqual(g.themen[1].zahlen, { push: 1, review: 1, laeuft: 0, blockiert: 0 });
  assert.equal(g.vonDir, 4);
});

test('S2: Antwort und Nacharbeit gehen mit eigenem Vorspann in denselben Strang', () => {
  assert.equal(replyText('antwort', 'ja, D1 wie empfohlen'), 'Antwort von Knut auf deine Rückfrage: ja, D1 wie empfohlen');
  assert.equal(replyText('nacharbeit', 'Test ergänzen'), 'Nacharbeit nach Review: Test ergänzen');
});
