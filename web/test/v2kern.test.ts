// Werkbank 2.0 (Paket 436, S3/S4): reine Regeln der Startseite — Rang, Karten, Zustandssatz, Heute erledigt, „wartet auf“.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jetztAuswahl, karteAusFrage, antwortWeg, zustandSatz, arbeitGruppe, erledigtSicht, wartetAuf, prSicht, personen, uhrzeit, kurz } from '../server/v2kern.ts';
import { rolle } from '../server/v2kern.ts';

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
  assert.deepEqual(wartetAuf({ turn: { who: 'Merge (Mensch)', role: 'merge', why: 'freigegeben' }, requested: ['bizarrochris'] } as any, { bizarrochris: 'Christoph' }), [], 'freigegeben + noch angefragt: wartet nicht auf Christoph');
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

test('Karte: Dateipfade mit Zeilennummern aus Agententexten werden für Menschen ausgeblendet', () => {
  const k = karteAusFrage(frage('q', { worum: 'Siehe `olaf/2-Areas/x/spec-a.md:51` und Z.56-59: soll das PDF die Texte holen?' }), { grund: '', strand: null, strandTitel: null, altUrl: 'x' });
  assert.doesNotMatch(k.worum, /\.md|:51|Z\.56/);
  assert.match(k.worum, /\(Notiz\)/);
});

test('S13/C6: Rolle — Admin leitet, wer einen GitHub-Namen hat, prüft (Reviewer), alle anderen sind Team; nie über offene PRs', () => {
  const names = { knut523: 'Knut', bizarrochris: 'Christoph' };
  assert.equal(rolle({ admin: true, vorname: 'Knut' }, names), 'leitung');
  assert.equal(rolle({ admin: false, vorname: 'Christoph' }, names), 'reviewer');
  assert.equal(rolle({ admin: false, vorname: 'christoph' }, names), 'reviewer', 'Groß-/Kleinschreibung egal');
  assert.equal(rolle({ admin: false, vorname: 'Lisa' }, names), 'team');
  assert.equal(rolle({ admin: false, vorname: '' }, names), 'team');
});

test('S12/C4: Alle Chats — Unter-Chats, Hauptchats, LibreChat- und 2.0-Chats zusammen, jede Unterhaltung genau einmal', async () => {
  const { chatListe } = await import('../server/v2kern.ts');
  const runs = [
    { _id: 'abcd1234', conv: 'c-strang', title: 'Netzentgelte', thema: 'Rechner', zustand: 'fertig', lastActivity: '2026-11-02T10:00:00Z', knutReviewedAt: '2026-11-02T12:00:00Z' },
    { _id: 'beef0001', conv: 'c-laeuft', title: 'Umfrage', zustand: 'laeuft', lastActivity: '2026-11-03T09:00:00Z' },
    { _id: 'hc000001', conv: 'c-haupt', title: 'Hauptchat', kind: 'leitstand', lastActivity: '2026-11-03T10:00:00Z' },
  ];
  const convs = [
    { conversationId: 'c-strang', title: 'Netzentgelte (LibreChat)', updatedAt: '2026-11-02T10:00:00Z' },
    { conversationId: 'c-haupt', title: 'Hauptchat', updatedAt: '2026-11-03T10:00:00Z' },
    { conversationId: 'c-alt', title: 'Alter Chat zu Tarifen', updatedAt: '2026-09-01T10:00:00Z', isArchived: true },
  ];
  const eigene = [{ conv: 'v2-1111', titel: 'Frage zu OLAF', at: '2026-11-03T08:00:00Z' }];
  const l = chatListe(runs as any, convs as any, eigene as any, { admin: true, lcUrl: 'https://lc' });
  assert.equal(l.length, 5, JSON.stringify(l.map((x) => x.titel)));
  assert.deepEqual(l.map((x) => x.art), ['hauptchat', 'unterchat', 'chat2', 'unterchat', 'chat'], 'neueste zuerst');
  const n = l.find((x) => x.titel === 'Netzentgelte')!;
  assert.equal(n.status, 'abgenommen'); assert.equal(n.thema, 'Rechner'); assert.equal(n.url, 'v2/arbeit/abcd1234');
  assert.equal(l.find((x) => x.art === 'chat')!.status, 'archiviert');
  assert.equal(l.find((x) => x.art === 'chat')!.url, 'https://lc/c/c-alt');
  assert.equal(l.find((x) => x.art === 'chat2')!.conv, 'v2-1111');
  const lisa = chatListe(runs as any, convs as any, eigene as any, { admin: false, lcUrl: 'https://lc' });
  assert.ok(lisa.every((x) => x.art === 'chat' || x.art === 'chat2'), 'Unter-Chats und Hauptchat nur für Admin');
});

test('S12 (Pass C): kaputtes Datum legt die Liste nicht lahm, zwei Runs mit einer Unterhaltung erscheinen einmal, unsaubere IDs bekommen keinen Link', async () => {
  const { chatListe } = await import('../server/v2kern.ts');
  const l = chatListe([{ _id: 'a1', conv: 'c1', title: 'Eins', lastActivity: 'unbekannt' }, { _id: 'a2', conv: 'c1', title: 'Eins (neu gestartet)' }] as any,
    [{ conversationId: '../x?next=//boese', title: 'Komisch', updatedAt: 'kaputt' }] as any, [], { admin: true, lcUrl: 'https://lc' });
  assert.equal(l.filter((z) => z.conv === 'c1').length, 1);
  assert.equal(l.find((z) => z.titel === 'Komisch')!.url, null);
  assert.ok(l.every((z) => z.zuletzt === null));
});

test('S20 (D8 persönliche Instanzen): Rolle der Besitzerin aus der Einrichtung, sonst aus den Daten — nie bloß aus dem Admin-Flag', () => {
  const names = { knut523: 'Knut', bizarrochris: 'Christoph' };
  assert.equal(rolle({ admin: true, vorname: 'Lisa', zugang: false }, names), 'team', 'Lisa in ihrer eigenen Instanz, ohne Claude-Abo');
  assert.equal(rolle({ admin: true, vorname: 'Christoph', zugang: false }, names), 'reviewer', 'Christoph in seiner Instanz');
  assert.equal(rolle({ admin: true, vorname: 'Knut', zugang: true }, names), 'leitung', 'mit eigenem Zugang: leitet eigene Agenten');
  assert.equal(rolle({ admin: true, vorname: 'Christoph', zugang: true, einstellung: 'reviewer' }, names), 'reviewer', 'Einstellung schlägt Ableitung');
  assert.equal(rolle({ admin: true, vorname: 'Knut', zugang: false, einstellung: 'leitung' }, names), 'leitung', 'Test-Instanz: Knut ohne Zugang, Einstellung leitung');
  assert.equal(rolle({ admin: false, vorname: 'Lisa', zugang: false, einstellung: 'leitung' }, names), 'team', 'Einstellung gilt nur für die Besitzerin (Admin), nie für Gäste');
  assert.equal(rolle({ admin: true, vorname: 'X', zugang: true, einstellung: 'quatsch' }, names), 'leitung', 'unbekannte Einstellung = Ableitung');
});

test('S11: themaVon — ein Thema für alles: bestehende Regeln (themen.ts), Lage-Themen, Hilfsnamen werden aus dem Text erkannt', async () => {
  const { themaVon } = await import('../server/v2kern.ts');
  assert.equal(themaVon('Admin', ''), 'Admin');
  assert.equal(themaVon('Workspace', ''), 'Werkbank', 'Workspace heißt in der Oberfläche Werkbank');
  assert.equal(themaVon('Service-View', ''), 'Service');
  assert.equal(themaVon('Fragenpaket: Netzentgelte 2027 und ehrlicher Rechner (Pre-Plan 416)', ''), 'Rechner');
  assert.equal(themaVon('Hauptchat', 'Push freigeben: olaf-tariff-app Flex-Umfragen'), 'Flex');
  assert.equal(themaVon(null, 'Anmeldestrecke: Zählpunkt prüfen'), 'Anmeldestrecke');
  assert.equal(themaVon('Unter-Chats', 'irgendwas ohne Thema'), 'Sonstiges');
  assert.equal(themaVon(null, 'olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap/Bot/0-bot-uebersicht.md Bot'), 'Bot');
});

test('S11: themenUebersicht — je Thema Entscheidungen, Unter-Chats, Dokumente, PRs; größte zuerst, Sonstiges zuletzt', async () => {
  const { themenUebersicht } = await import('../server/v2kern.ts');
  const t = themenUebersicht({
    karten: [{ id: 'k1', titel: 'Flex-Umfrage live?', thema: 'Flex' }, { id: 'k2', titel: 'Werkbank-Release', thema: 'Workspace' }],
    runs: [{ _id: 'a1', title: 'Flex: Umfrage-Editor', zustand: 'laeuft' }, { _id: 'a2', title: 'irgendwas' }],
    notizen: [{ path: 'olaf/2-Areas/Neue-Geschaeftsfelder/Flexibilitaeten/0-flexibilitaeten-uebersicht.md', title: 'Flexibilitäten Übersicht' }],
    prs: [{ pr: 'WirStrom1/olaf-tariff-app#240', repo: 'olaf-tariff-app', title: 'Flex: Umfrage speichern' }],
  });
  const flex = t.find((x) => x.thema === 'Flex')!;
  assert.deepEqual([flex.entscheidungen, flex.unterchats, flex.dokumente, flex.prs], [1, 1, 1, 1]);
  assert.equal(t[0].thema, 'Flex');
  assert.equal(t[t.length - 1].thema, 'Sonstiges');
});

test('S22 (Christoph B2/B4): wer hat Änderungen verlangt; Kurzurteil des Agenten oben', async () => {
  const { verlangtVon, kurzurteil } = await import('../server/v2kern.ts');
  const names = { bizarrochris: 'Christoph' };
  assert.deepEqual(verlangtVon('CHANGES_REQUESTED', [{ author: 'bizarrochris', state: 'COMMENTED', submittedAt: '2026-11-01' }, { author: 'fazl', state: 'CHANGES_REQUESTED', submittedAt: '2026-11-02' }], names), { wer: ['fazl'], unbekannt: false });
  assert.deepEqual(verlangtVon('CHANGES_REQUESTED', [{ author: 'bizarrochris', state: 'COMMENTED' }], names), { wer: [], unbekannt: true }, 'GitHub sagt es, die Kopie kennt den Urheber nicht');
  assert.deepEqual(verlangtVon('CHANGES_REQUESTED', [{ author: 'fazl', state: 'CHANGES_REQUESTED', submittedAt: '2026-11-01' }, { author: 'fazl', state: 'APPROVED', submittedAt: '2026-11-02' }], names), { wer: [], unbekannt: true }, 'später freigegeben zählt nicht mehr');
  assert.deepEqual(verlangtVon('APPROVED', [], names), { wer: [], unbekannt: false });
  const k = kurzurteil('## Review\n\n**Kurz:** Solide Änderung, ein Punkt zum Statusabgleich.\n\n| # | Befund | Schwere |\n|---|---|---|\n| 1 | Status | mittel |\n| 2 | Typo | niedrig |\n');
  assert.equal(k.satz, 'Kurz: Solide Änderung, ein Punkt zum Statusabgleich.');
  assert.equal(k.befunde, 2);
  assert.equal(kurzurteil(null).satz, '');
});

test('S22 (Knut B7): schwache Chat-Titel („ja“, „Ok?“, „New Chat“) werden durch den Anfang der ersten eigenen Nachricht ersetzt', async () => {
  const { schwacherTitel, besserTitel } = await import('../server/v2kern.ts');
  for (const t of ['ja', 'Ok?', 'New Chat', 'Neuer Chat', '', 'weiter']) assert.equal(schwacherTitel(t), true, t);
  assert.equal(schwacherTitel('Umfrage-Editor: Rechte prüfen'), false);
  const b = besserTitel('ok', 'Kannst du mir die **Umfrage**-Ergebnisse vom Oktober zusammenfassen und als Tabelle geben?');
  assert.ok(b.startsWith('Kannst du mir die Umfrage-Ergebnisse vom Oktober') && b.endsWith('…') && b.length <= 73, b);
  assert.equal(besserTitel('Umfrage prüfen', 'egal'), 'Umfrage prüfen');
  assert.equal(besserTitel('ja', ''), 'ja', 'ohne Nachricht bleibt der Titel');
});

test('S22 (Knut B6): gekürzte Meldungen enden nicht mitten im Satz — Schnitt an der letzten ganzen Stelle, Hinweis auf den Stand', async () => {
  const { zustandSatz } = await import('../server/v2kern.ts');
  const s = zustandSatz({ zustand: 'wartet', cs: { status: 'braucht', grund: 'Nur D4 ist offen. Entscheidung zum Vorteil (Empfehlung: b⋯' } } as any);
  assert.equal(s, 'Wartet auf dich: Nur D4 ist offen — ganzer Text unten im Stand.');
  const t = zustandSatz({ zustand: 'wartet', cs: { status: 'braucht', grund: 'Eine sehr lange Zeile ohne Punkt die irgendwo abbricht und weitergeht⋯' } } as any);
  assert.match(t, /^Wartet auf dich: Eine sehr lange Zeile ohne Punkt die irgendwo abbricht und weitergeht … — ganzer Text unten im Stand\.$/);
  assert.equal(zustandSatz({ zustand: 'wartet', cs: { status: 'braucht', grund: 'Frage zur Umfrage' } } as any), 'Wartet auf dich: Frage zur Umfrage.');
});

test('S22 Pass C: ganzeStelle schneidet nicht an „z. B.“, keine Zeilenumbrüche; verlangtVon ohne Zeitstempel; Befundzähler mit verankerter Trennzeile', async () => {
  const { zustandSatz, verlangtVon, kurzurteil } = await import('../server/v2kern.ts');
  assert.equal(zustandSatz({ zustand: 'wartet', cs: { status: 'braucht', grund: 'Siehe z. B. den PR zu Auth und die Notiz (Empfehlung: b⋯' } } as any), 'Wartet auf dich: Siehe z. B. den PR zu Auth und die Notiz — ganzer Text unten im Stand.');
  assert.doesNotMatch(zustandSatz({ zustand: 'wartet', cs: { status: 'braucht', grund: '1. Punkt eins.\n2. Punkt zwei (offen⋯' } } as any), /\n/);
  assert.deepEqual(verlangtVon('CHANGES_REQUESTED', [{ author: 'fazl', state: 'APPROVED' }, { author: 'fazl', state: 'CHANGES_REQUESTED', submittedAt: '2026-11-01' }], {}), { wer: ['fazl'], unbekannt: false }, 'Review ohne Zeit überschreibt nichts');
  assert.equal(kurzurteil('Kurz.\n\n| # | Befund |\n|---|---|\n| 1 | --- siehe Zeile 42 |\n| 2 | zwei |').befunde, 2);
});

test('Runde 4: „Fertig — Bericht liegt bereit“ nur mit Bericht; Thema in der Erklärung wie auf der Karte', async () => {
  const { zustandSatz, karteAusFrage } = await import('../server/v2kern.ts');
  assert.match(zustandSatz({ zustand: 'fertig', bericht: true, paket: '416-x' } as any), /Bericht liegt bereit/);
  assert.doesNotMatch(zustandSatz({ zustand: 'fertig', cs: { status: 'review' } } as any), /Bericht liegt bereit/);
  const f: any = { id: 'q', klasse: 'entscheidung', titel: 'Release trocken?', worum: '', empfehlung: null, optionen: [], alternativen: [], antworten: ['anders'], gruppe: 'Workspace', quelle: { text: 'x' }, blockiert: 0, wartetSeit: null };
  const k = karteAusFrage(f, { grund: '', strand: null, strandTitel: null, altUrl: 'http://alt' });
  assert.equal(k.erklaerung.find(([a]) => a === 'Thema')![1], k.thema);
  assert.equal(k.thema, 'Werkbank');
});

test('Runde 4 (Knut B3): standVoll — ganzer Stand-Abschnitt der letzten Agenten-Antwort, nicht der 600-Zeichen-Auszug', async () => {
  const { standVoll } = await import('../server/v2kern.ts');
  const lang = 'x'.repeat(900);
  const msgs = [{ rolle: 'ich', text: 'Auftrag' }, { rolle: 'assistent', text: `Viel davor\n### Stand\n- Erledigt: ${lang}\n- Braucht Knut: D1 — Schalter auf trocken oder live. Empfehlung: erst trocken, dann live nach dem ersten Lauf.` }, { rolle: 'ich', text: 'danke' }];
  const s = standVoll(msgs, 'alt…');
  assert.match(s, /^### Stand/); assert.match(s, /dann live nach dem ersten Lauf\.$/); assert.ok(s.length > 900);
  assert.equal(standVoll([], 'gespeicherter Auszug'), 'gespeicherter Auszug', 'ohne Verlauf: der gespeicherte Auszug');
  assert.equal(standVoll([{ rolle: 'assistent', text: 'kurz ohne Stand' }], 'x'), 'kurz ohne Stand');
  assert.ok(standVoll([{ rolle: 'assistent', text: `### Stand\n${'y'.repeat(9000)}` }], '').length <= 8000);
});
