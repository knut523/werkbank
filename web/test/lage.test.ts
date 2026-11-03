// Lage-Ansicht (Release 31, Zusatz zur Abnahme: „Was ist offen?“ auf einen Blick) — rein: aus Fragen der Entscheidungsseite,
// Übersichts-Karten, Braucht-dich-Aktionen, PR-Lage und Vault-Notizen wird EINE Antwort. Ohne Netz und Mongo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAGE_AN, standSatz, baueLage, THEMEN_LAGE } from '../server/lage.ts';

const SEIT = '2026-11-01T23:00:00.000Z';

test('Schalter: nur „on“', () => {
  assert.equal(LAGE_AN({}), false);
  assert.equal(LAGE_AN({ WERKBANK_LAGE: 'on' }), true);
});

test('standSatz: erster Satz unter „Aktueller Stand“/„Stand, …“, ohne Markdown und Wikilinks; Tabellen als „Spalte: Wert“', () => {
  const a = '---\nlast-verified: 2026-11-02\n---\n# T\n## Ziel\nX.\n## Aktueller Stand\n\n**Auf Produktion ist vom [[service-spec|Service View]] nichts.** Auf `develop` steht seit dem 28.09. der Stapel.\n## Weiter\n';
  assert.deepEqual(standSatz(a), { satz: 'Auf Produktion ist vom Service View nichts.', geprueft: '2026-11-02', abschnitt: 'Aktueller Stand' });
  const b = '---\nlast-verified: 2026-10-19\n---\n## Stand, 05.10.2026\n\n| Dimension | Stand |\n|---|---|\n| Machbarkeit | gut beforscht ([[flex-hw]]); offen |\n| X | Y |\n';
  assert.deepEqual(standSatz(b), { satz: 'Machbarkeit: gut beforscht (flex-hw); offen', geprueft: '2026-10-19', abschnitt: 'Stand, 05.10.2026' });
  const c = '## Aktueller Stand (01.10.2026)\n\n> Hinweis\n\n- `olaf-bot` @ `ddc396d`: Website-Bot als eigener Dienst. Mehr.\n';
  assert.equal(standSatz(c)?.satz, 'olaf-bot @ ddc396d: Website-Bot als eigener Dienst.');
  assert.equal(standSatz('# ohne Stand\n## Ziel\nnichts'), null);
  const lang = `## Aktueller Stand\n\n${'Wort '.repeat(80)}ohne Punkt\n`;
  assert.ok(standSatz(lang)!.satz.length <= 240);
});

const frage = (o: Record<string, unknown> = {}) => ({ id: 'q-1', art: 'rueckfrage', gruppe: 'Hauptchat', titel: 'Soll der Bot auf Coolify?', empfehlung: 'Coolify', stufe: 'wichtig', wartetSeit: '2026-11-02T08:00:00Z', quelle: { text: 'Hauptchat', url: null }, klasse: null, blockiert: 0, ...o });
const karte = (o: Record<string, unknown> = {}) => ({ id: 'o-1', titel: 'Ergebnis-Satz', strangTitel: 'Bot v5', thema: 'Bot', ampel: 'laeuft', running: true, wartet: false, eta: { text: 'ETA 19:30', ueberfaellig: false }, statusAt: '2026-11-02T10:00:00Z', chat: 'https://chat/c/1', links: [{ art: 'bericht', label: 'Bericht', url: '/#/bericht/o-1' }], ...o });

test('Für dich: nur echte Entscheidungen (keine „aktion“-Karten), wichtige zuerst; Approve-Bitten aus der PR-Lage; Jira-Zeile', () => {
  const l = baueLage({
    seit: SEIT, now: '2026-11-02T16:00:00Z',
    fragen: [frage({ id: 'q-2', stufe: 'normal', titel: 'Normal?' }), frage(), frage({ id: 'b-1', art: 'braucht', klasse: 'aktion', titel: 'Push nach Gate' })],
    karten: [], aktionen: [], prLage: { zeilen: [{ pr: 'WirStrom1/olaf-admin#5', title: 'Akte', url: 'https://gh/5', author: 'bizarrochris', knutAngefragt: true, entscheidung: 'Review nötig', mergeState: 'blocked', mergeHinweis: 'blockiert', reviews: [], tags: [], chris: [], gepusht: null, updatedAt: '2026-11-02T09:00:00Z' }] as any, quelle: 'live', ticker: { an: true, letzterLauf: null, fehler: null }, at: '', seit: SEIT, orgs: ['WirStrom1'] },
    themen: [], jira: { ueberfaellig: 3, ohneDatum: 2 },
  });
  assert.deepEqual(l.fuerDich.map((x) => x.id), ['q-1', 'q-2', 'pr:WirStrom1/olaf-admin#5', 'jira']);
  assert.equal(l.fuerDich[2].art, 'approve');
  assert.match(l.fuerDich[2].titel, /Review von dir angefragt: olaf-admin#5 „Akte“/);
  assert.match(l.fuerDich[3].titel, /3 überfällig, 2 ohne Datum/);
  assert.equal(l.zahlen.fuerDich, 4);
});

test('Läuft (mit ETA) · Fertig seit heute früh (Ergebnis-Satz + Bericht-Link) · Erledigt der Hauptchat', () => {
  const l = baueLage({
    seit: SEIT, now: '2026-11-02T16:00:00Z', fragen: [], themen: [], jira: null, prLage: null,
    karten: [
      karte(),
      karte({ id: 'o-2', running: false, ampel: 'review', titel: 'Lückenliste steht', strangTitel: 'Umzug', thema: 'Workspace', statusAt: '2026-11-02T12:00:00Z', eta: null }),
      karte({ id: 'o-3', running: false, ampel: 'push', titel: 'Alt fertig', statusAt: '2026-11-01T12:00:00Z', eta: null }),
      karte({ id: 'o-4', running: false, wartet: true, ampel: 'blockiert', titel: 'wartet', strangTitel: 'Flex', thema: 'Flex', eta: { text: 'ETA überfällig', ueberfaellig: true } }),
    ],
    aktionen: [{ kennung: 'b-9', strand: 'o-5', titel: 'Skill', aktion: 'skill-installieren', wasTun: 'Nichts für dich' }],
    erledigtHeute: [{ id: 'o-6', titel: 'Release 30 live', at: '2026-11-02T09:00:00Z', chat: null }],
  });
  assert.deepEqual(l.laeuft.map((x) => [x.id, x.eta]), [['o-1', 'ETA 19:30'], ['o-4', 'ETA überfällig']]);
  assert.equal(l.laeuft[1].blockiert, true);
  assert.deepEqual(l.fertig.map((x) => [x.id, x.satz, x.link]), [['o-2', 'Lückenliste steht', '/#/bericht/o-1'], ['o-6', 'Release 30 live', null]]);
  assert.deepEqual(l.hauptchat.map((x) => x.aktion), ['skill-installieren']);
});

test('Themen: je Thema ein Satz (Register vor Vault-Notiz), Stränge je Thema gezählt; Werkbank ohne Notiz aus den Strängen', () => {
  const l = baueLage({
    seit: SEIT, now: '2026-11-02T16:00:00Z', fragen: [], aktionen: [], prLage: null, jira: null,
    karten: [karte({ thema: 'Workspace', strangTitel: 'Werkbank R31' }), karte({ id: 'o-2', thema: 'Bot', running: false, ampel: 'review', statusAt: '2026-11-02T12:00:00Z' })],
    themen: [
      { thema: 'Flex', register: 'Interviews laufen', notiz: { satz: 'Machbarkeit: gut', geprueft: '2026-10-19', abschnitt: 'Stand' }, link: 'flex' },
      { thema: 'Bot', register: null, notiz: { satz: 'Lokal zwei Zweige.', geprueft: '2026-11-02', abschnitt: 'Aktueller Stand' }, link: 'bot' },
      { thema: 'Werkbank', register: null, notiz: null, link: null },
    ],
  });
  const t = Object.fromEntries(l.themen.map((x) => [x.thema, x]));
  assert.equal(t.Flex.satz, 'Interviews laufen'); assert.equal(t.Flex.quelle, 'Themen-Register');
  assert.equal(t.Bot.satz, 'Lokal zwei Zweige.'); assert.match(t.Bot.quelle, /Vault, geprüft 2026-11-02/);
  assert.deepEqual([t.Bot.laufen, t.Bot.fertigHeute], [0, 1]);
  assert.match(t.Werkbank.satz, /1 Unter-Chat läuft/);
  assert.equal(t.Werkbank.laufen, 1);
});

test('PR-Lage: Kurzfassung mit Zahlen je Gruppe und „heute gepusht“; ohne Schalter null', () => {
  const z = (o: any) => ({ pr: 'WirStrom1/r#1', title: 't', url: 'u', author: 'a', knutAngefragt: false, entscheidung: 'Review nötig', mergeState: null, mergeHinweis: '—', reviews: [], tags: [], chris: [], gepusht: null, updatedAt: '', ...o });
  const l = baueLage({ seit: SEIT, now: '2026-11-02T16:00:00Z', fragen: [], karten: [], aktionen: [], themen: [], jira: null,
    prLage: { zeilen: [z({ entscheidung: 'Änderungen verlangt', chris: [{ wann: '2026-11-02T10:00:00Z', text: 'bitte X', art: 'kommentar', ort: null, url: null }] }), z({ pr: 'WirStrom1/r#2', entscheidung: 'freigegeben', gepusht: { sha: 'abc1234', wann: '2026-11-02T11:00:00Z', quelle: 'Commit' } })] as any,
      quelle: 'live', ticker: { an: false, letzterLauf: null, fehler: null }, at: '2026-11-02T16:00:00Z', seit: SEIT, orgs: ['WirStrom1'] } });
  assert.equal(l.prs!.offen, 2);
  assert.deepEqual(l.prs!.gruppen.map((g) => [g.titel, g.zeilen.length]), [['Änderungen verlangt', 1], ['Freigegeben', 1]]);
  assert.deepEqual(l.prs!.gepusht.map((g) => g.pr), ['WirStrom1/r#2']);
  assert.equal(baueLage({ seit: SEIT, now: '', fragen: [], karten: [], aktionen: [], themen: [], jira: null, prLage: null }).prs, null);
});

test('THEMEN_LAGE: fünf Themen in fester Reihenfolge', () => {
  assert.deepEqual(THEMEN_LAGE.map((t) => t.thema), ['Flex', 'Bot', 'Werkbank', 'Service', 'Anmeldestrecke']);
});
