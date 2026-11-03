// Werkbank 2.0 (Paket 436, S3/S4): reine Regeln der Startseite — Rang, Karten, Zustandssatz, Heute erledigt, „wartet auf“.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jetztAuswahl, karteAusFrage, antwortWeg, zustandSatz, arbeitGruppe, erledigtSicht, wartetAuf, prSicht, personen, uhrzeit, kurz } from '../server/v2kern.ts';

const NOW = Date.parse('2026-11-03T18:00:00Z');
const frage = (id: string, o: Record<string, any> = {}) => ({
  id, eintrag: id, teil: null, art: 'rueckfrage', gruppe: 'Thema', kennung: null, titel: `Frage ${id}`, worum: 'Worum es geht. Zweiter Satz. Dritter Satz.',
  optionen: ['A', 'B'], alternativen: ['B'], empfehlung: 'A', form: 'wahl', stufe: 'normal', stufeGrund: null, autoAb: null,
  quelle: { text: 'Hauptchat', url: null }, wartetSeit: '2026-11-03T10:00:00Z', antworten: ['ja', 'anders', 'spaeter'], blockiert: 0, ref: null, ...o,
}) as any;

test('Rang: wichtige Frage, die einen Unter-Chat anhält, steht vor jeder Freigabe; höchstens 2 Freigaben, höchstens 5 Karten', () => {
  const fragen = [
    frage('p1', { art: 'push', blockiert: 1, stufe: 'wichtig', empfehlung: null }), frage('p2', { art: 'push', blockiert: 1, empfehlung: null }),
    frage('p3', { art: 'push', blockiert: 1, empfehlung: null }), frage('p4', { art: 'push', blockiert: 1, empfehlung: null }),
    frage('q1', { blockiert: 1, stufe: 'wichtig' }), frage('q2'), frage('q3'), frage('q4'), frage('q5'),
  ];
  const j = jetztAuswahl(fragen, NOW);
  assert.ok(j.length <= 5);
  assert.equal(j[0].f.id, 'q1');
  assert.ok(j.filter((x) => x.f.art === 'push').length <= 2);
  const ersteFreigabe = j.findIndex((x) => x.f.art === 'push');
  assert.ok(j.slice(ersteFreigabe).every((x) => x.f.art === 'push'), 'Freigaben stehen unter den Entscheidungen');
  assert.ok(j.every((x) => x.grund));
});

test('Rang: Aufgaben des Hauptchats (klasse aktion) erscheinen nie oben', () => {
  const j = jetztAuswahl([frage('a', { klasse: 'aktion', blockiert: 3 }), frage('b')], NOW);
  assert.deepEqual(j.map((x) => x.f.id), ['b']);
});

test('Rang: ohne Fragen leer, mit weniger als 5 alle', () => {
  assert.deepEqual(jetztAuswahl([], NOW), []);
  assert.equal(jetztAuswahl([frage('a'), frage('b', { art: 'push' })], NOW).length, 2);
});

test('Antwortweg: Push und Vault-Sync nur in der alten Werkbank, Rückfragen und Entscheidungen hier', () => {
  assert.equal(antwortWeg(frage('p', { art: 'push' })), 'alt');
  assert.equal(antwortWeg(frage('v', { art: 'vault' })), 'alt');
  assert.equal(antwortWeg(frage('k', { klasse: 'aktion' })), 'alt');
  assert.equal(antwortWeg(frage('q')), 'hier');
  assert.equal(antwortWeg(frage('b', { art: 'braucht', klasse: 'entscheidung' })), 'hier');
  assert.equal(antwortWeg(frage('e', { art: 'entscheidung', teil: 'D1' })), 'hier');
  assert.equal(antwortWeg(frage('k', { art: 'vaultfrage' })), 'hier');
});

test('Karte: Freigabe hat keine Antwortknöpfe, sondern den Link in die alte Werkbank', () => {
  const k = karteAusFrage(frage('p', { art: 'push', antworten: ['ja', 'spaeter'], empfehlung: null }), { grund: 'Freigabe wartet', strand: 'abcd1234', strandTitel: 'X', altUrl: 'http://alt/wb/entscheidungen' });
  assert.equal(k.art, 'freigabe');
  assert.deepEqual(k.antworten, []);
  assert.equal(k.alt, 'http://alt/wb/entscheidungen');
  assert.ok(k.links.some((l) => l.url === '/v2/arbeit/abcd1234'));
});

test('Karte: Entscheidung mit Empfehlung bietet „Ja, so“ und „Anders“, nie „Später“ als einzigen Weg', () => {
  const k = karteAusFrage(frage('q'), { grund: 'wartet auf dich', strand: null, strandTitel: null, altUrl: 'x' });
  assert.equal(k.art, 'entscheidung');
  assert.ok(k.antworten.includes('ja') && k.antworten.includes('anders'));
  assert.equal(k.empfehlung, 'A');
  assert.ok(k.erklaerung.length >= 3, '„Was ist das?“ hat Inhalt aus den Daten');
  assert.ok(k.erklaerung.some((z) => /Empfehlung/.test(z[0])));
});

test('Karte: ohne Empfehlung kein „Ja, so“ (außer Ja/Nein-Fragen)', () => {
  const k = karteAusFrage(frage('q', { empfehlung: null, form: 'frei', antworten: ['anders', 'spaeter'] }), { grund: '', strand: null, strandTitel: null, altUrl: 'x' });
  assert.ok(!k.antworten.includes('ja'));
  assert.ok(k.antworten.includes('anders'));
});

test('Karte: „worum“ ist kurz (Handy), der volle Text steht in der Erklärung', () => {
  const lang = 'Satz eins ist da. '.repeat(40);
  const k = karteAusFrage(frage('q', { worum: lang }), { grund: '', strand: null, strandTitel: null, altUrl: 'x' });
  assert.ok(k.worum.length <= 240);
  assert.ok(k.erklaerung.some((z) => z[1].length > 240));
});

test('kurz: schneidet am Satzende, nie mitten im Wort ohne Auslassung', () => {
  assert.equal(kurz('Eins. Zwei. Drei.', 8), 'Eins.');
  assert.ok(kurz('a'.repeat(300), 50).endsWith('…'));
  assert.equal(kurz('', 10), '');
});

test('Zustandssatz in Klartext, ohne Jargon', () => {
  assert.match(zustandSatz({ zustand: 'laeuft', eta: { text: 'fertig ca. 18:21', ueberfaellig: false } } as any), /^Läuft — fertig ca\. 18:21/);
  assert.match(zustandSatz({ zustand: 'wartet', cs: { status: 'braucht', grund: '1 offene Frage an dich' } } as any), /^Wartet auf dich/);
  assert.match(zustandSatz({ zustand: 'fertig', cs: { status: 'review' } } as any), /Bericht/);
  assert.match(zustandSatz({ zustand: 'haengt', grund: 'keine Antwort seit 2 h' } as any), /^Hängt/);
  for (const z of ['laeuft', 'wartet', 'fertig', 'haengt', 'blockiert', 'stand-fehlt', 'schlange']) assert.doesNotMatch(zustandSatz({ zustand: z } as any), /Strang|Leitstand|Orchestrator|Inbox/);
  // ETA in der Vergangenheit wird nicht als Zukunft gezeigt (428 W12)
  assert.match(zustandSatz({ zustand: 'laeuft', eta: { text: 'fertig ca. 14:00', ueberfaellig: true } } as any), /länger als geschätzt/);
});

test('Arbeit-Gruppe: wartet auf dich · läuft · fertig', () => {
  assert.equal(arbeitGruppe({ zustand: 'wartet', cs: { status: 'braucht' } } as any), 'wartet');
  assert.equal(arbeitGruppe({ zustand: 'blockiert' } as any), 'wartet');
  assert.equal(arbeitGruppe({ zustand: 'laeuft' } as any), 'laeuft');
  assert.equal(arbeitGruppe({ zustand: 'schlange' } as any), 'laeuft');
  assert.equal(arbeitGruppe({ zustand: 'fertig', cs: { status: 'review' } } as any), 'fertig');
  assert.equal(arbeitGruppe({ zustand: 'fertig', cs: { status: 'braucht' } } as any), 'wartet');
  // wartet auf den Hauptchat: nicht „wartet auf dich“ (Pass C)
  assert.equal(arbeitGruppe({ zustand: 'wartet', cs: { status: 'hauptchat' } } as any), 'laeuft');
  assert.match(zustandSatz({ zustand: 'wartet', cs: { status: 'hauptchat' } } as any), /du musst nichts tun/);
});

test('Heute erledigt: nur Fertiges — was noch auf eine Antwort wartet, fehlt; „zum Lesen“ ist als solches markiert; echte Uhrzeit', () => {
  const straenge = [
    { id: 'a', titel: 'A fertig', at: '2026-11-03T16:47:38Z', link: null, dokumente: [] },
    { id: 'b', titel: 'B wartet', at: '2026-11-03T15:00:00Z', link: null, dokumente: [] },
    { id: 'c', titel: 'C abgenommen', at: '2026-11-03T09:00:00Z', link: null, dokumente: [] },
  ] as any[];
  const zeilen = new Map<string, any>([['a', { zustand: 'fertig', cs: { status: 'review' }, paket: '1-x', bericht: true }], ['b', { zustand: 'wartet', cs: { status: 'braucht' } }]]);
  const e = erledigtSicht(straenge, zeilen, new Set(['c']));
  assert.deepEqual(e.map((x) => x.id), ['a', 'c']);
  assert.equal(e[0].uhr, '17:47');
  assert.equal(e[0].stand, 'zum-lesen');
  assert.equal(e[1].stand, 'abgenommen');
  assert.ok(e[0].links.some((l) => /bericht/.test(l.url)));
});

test('wartet auf: Person aus turn und angefragten Reviewern; Merge/niemand sind keine Personen', () => {
  assert.deepEqual(wartetAuf({ turn: { who: 'Knut', role: 'reviewer', why: 'Review angefragt' }, requested: ['bizarrochris'] } as any, { bizarrochris: 'Christoph' }), ['Knut', 'Christoph']);
  assert.deepEqual(wartetAuf({ turn: { who: 'Merge (Mensch)', role: 'merge', why: 'freigegeben' }, requested: [] } as any, {}), []);
  assert.deepEqual(wartetAuf({ turn: { who: 'Reviewer (niemand angefragt)', role: 'reviewer', why: '' }, requested: [] } as any, {}), []);
  assert.deepEqual(wartetAuf({ turn: { who: 'Knut, Christoph', role: 'reviewer', why: '' }, requested: [] } as any, {}), ['Knut', 'Christoph']);
});

test('PR-Sicht: Vorgabe ich, umschaltbar; Personenliste enthält mich auch ohne Treffer', () => {
  const prs = [
    { pr: 'a#1', repo: 'a', number: 1, title: 'Eins', url: 'https://github.com/o/a/pull/1', turn: { who: 'Knut', role: 'reviewer', why: 'Review angefragt' }, requested: [], updatedAt: '2026-11-03T10:00:00Z' },
    { pr: 'a#2', repo: 'a', number: 2, title: 'Zwei', url: 'https://github.com/o/a/pull/2', turn: { who: 'FazlOmar9', role: 'author', why: 'Änderungen verlangt' }, requested: [], updatedAt: '2026-11-03T11:00:00Z' },
    { pr: 'a#3', repo: 'a', number: 3, title: 'Drei', url: 'https://github.com/o/a/pull/3', turn: { who: 'Merge (Mensch)', role: 'merge', why: 'freigegeben' }, requested: [], updatedAt: '2026-11-03T12:00:00Z' },
  ] as any[];
  const s = prSicht(prs, 'Knut', {});
  assert.deepEqual(s.map((x) => x.pr), ['a#1']);
  assert.equal(s[0].warum, 'Review angefragt');
  assert.deepEqual(prSicht(prs, 'FazlOmar9', {}).map((x) => x.pr), ['a#2']);
  assert.equal(prSicht(prs, 'alle', {}).length, 3);
  assert.equal(prSicht(prs, 'alle', {})[0].pr, 'a#3', 'neueste zuerst');
  const p = personen(prs, 'Christoph', {});
  assert.equal(p[0].name, 'Christoph');
  assert.equal(p[0].anzahl, 0);
  assert.ok(p.some((x) => x.name === 'Knut' && x.anzahl === 1));
});

test('Uhrzeit in Wiener Zeit', () => {
  assert.equal(uhrzeit('2026-11-03T16:47:38Z'), '17:47');
  assert.equal(uhrzeit(null), '');
});
