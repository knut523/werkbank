import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wien, wienZuUtc, stichzeit, addTage, tageZwischen, entscheide, blockiert, prNacht, jiraNacht, strangNacht, schulden, themen, baueLage, lageMarkdown, dailyZeilen, debriefZeile, syncZeile, kappe, GRENZEN, MAX_ZEILEN, type LageInput, type KarteLite, type FrageLite } from '../server/cos.ts';
import { parseRegister, parseThemen, teamSet } from '../server/cosregister.ts';

const JETZT = new Date('2026-10-16T05:00:00Z');   // 07:00 Wien (MESZ)

test('Wiener Zeit: Wanduhr → UTC, Zeitumstellung am 25.10.2026 (K15)', () => {
  assert.equal(wienZuUtc('2026-10-16', 18, 0).toISOString(), '2026-10-16T16:00:00.000Z');
  assert.equal(wienZuUtc('2026-10-26', 18, 0).toISOString(), '2026-10-26T17:00:00.000Z', 'nach der Umstellung MEZ');
  assert.equal(wienZuUtc('2026-10-25', 6, 55).toISOString(), '2026-10-25T05:55:00.000Z', 'am Umstellungstag morgens MEZ');
  assert.equal(wien(new Date('2026-10-25T01:30:00Z')).hhmm, '02:30');   // nach der Umstellung (01:00 UTC): MEZ
  assert.equal(wien(new Date('2026-10-25T00:30:00Z')).hhmm, '02:30');   // vor der Umstellung: MESZ
  assert.equal(wien(new Date('2026-10-24T23:30:00Z')).datum, '2026-10-25');
  assert.equal(wien(JETZT).hhmm, '07:00');
  assert.equal(addTage('2026-12-31', 1), '2027-01-01');
  assert.equal(tageZwischen('2026-10-23', '2026-10-16'), -7);
});

test('Stichzeit: letzter Abschluss, sonst Vortag 18:00 Wiener Zeit (K16)', () => {
  assert.equal(stichzeit(JETZT).toISOString(), '2026-10-15T16:00:00.000Z');
  const abend = new Date('2026-10-15T15:30:00Z');
  assert.equal(stichzeit(JETZT, abend).toISOString(), abend.toISOString());
  assert.equal(stichzeit(JETZT, new Date('2026-10-01T15:30:00Z')).toISOString(), '2026-10-15T16:00:00.000Z', 'zu alter Abschluss zählt nicht');
  // Montag früh: Freitag-Abschluss gilt
  assert.equal(stichzeit(new Date('2026-10-19T05:00:00Z'), new Date('2026-10-16T15:30:00Z')).toISOString(), '2026-10-16T15:30:00.000Z');
  // Jahreswechsel
  assert.equal(stichzeit(new Date('2027-01-01T06:00:00Z')).toISOString(), '2026-12-31T17:00:00.000Z');
});

const karte = (o: Partial<KarteLite> = {}): KarteLite => ({ id: 'k1', titel: 'Strang A', thema: 'Flex', ampel: 'review', running: false, braucht: null, entscheidungen: [], berichtHash: 'h', rueckfragen: 0, statusAt: '2026-10-16T03:00:00Z', ...o });
const frage = (o: Partial<FrageLite> = {}): FrageLite => ({ id: 'q1', title: 'Soll X?', recommendation: 'Ja', options: [{ label: 'Ja' }, { label: 'Nein' }], strandId: null, createdAt: '2026-10-15T10:00:00Z', ...o });

test('① Entscheide: zuerst, worauf ein Strang wartet, dann das Älteste; Obergrenze 7 mit „weitere“', () => {
  const i = {
    karten: [karte({ id: 'k1', entscheidungen: [{ id: 'D1', frage: 'Bericht-Frage', empfehlung: 'Option A' }], statusAt: '2026-10-14T00:00:00Z' }), karte({ id: 'k2', running: true, entscheidungen: [{ id: 'D2', frage: 'läuft noch', empfehlung: '' }] })],
    fragen: [frage({ id: 'qa', createdAt: '2026-10-10T00:00:00Z' }), frage({ id: 'qb', strandId: 'k1', createdAt: '2026-10-15T00:00:00Z' })],
    triage: [{ id: 't1', datei: 'olaf/Meetings/x.md', titel: 'Review', zusagen: 3, entscheidungen: 1, datum: '2026-10-12' }],
  };
  const e = entscheide(i);
  assert.deepEqual(e.map((x) => x.id), ['k1:D1', 'qb', 'qa', 't1', 'k2:D2']);
  assert.equal(e[0].wartet, true); assert.equal(e.at(-1)!.wartet, false);
  assert.ok(e.slice(0, 2).every((x) => x.wartet), 'Strang wartet → oben');
  assert.match(e.find((x) => x.art === 'triage')!.titel, /3 Zusagen, 1 Entscheidung übernehmen\?/);
  const viele = Array.from({ length: 12 }, (_, n) => frage({ id: 'q' + n }));
  const k = kappe(entscheide({ karten: [], fragen: viele, triage: [] }), GRENZEN.entscheide);
  assert.equal(k.items.length, 7); assert.equal(k.weitere, 5); assert.equal(k.gesamt, 12);
});

test('② Blockiert: Stränge (blockiert, Braucht Knut) und Jira-Tickets im Blockiert-Status', () => {
  const b = blockiert({ karten: [karte({ ampel: 'blockiert', braucht: 'Zugang fehlt' }), karte({ id: 'k2', titel: 'B', braucht: 'Entscheidung D1' }), karte({ id: 'k3', titel: 'C' })], jira: [
    { key: 'PM-1', summary: 'a', status: 'Blockiert', assignee: null, duedate: null, updated: '2026-10-10T00:00:00Z' },
    { key: 'PM-2', summary: 'b', status: 'In Arbeit', assignee: null, duedate: null, updated: '2026-10-11T00:00:00Z', blockedBy: ['PM-9'] },
    { key: 'PM-3', summary: 'c', status: 'Done', statusCategory: 'done', assignee: null, duedate: null, updated: '2026-10-11T00:00:00Z', blockedBy: ['PM-9'] }] });
  assert.deepEqual(b.map((x) => x.id), ['PM-1', 'PM-2', 'k1', 'k2'].sort((x, y) => b.findIndex((z) => z.id === x) - b.findIndex((z) => z.id === y)));
  assert.equal(b.length, 4);
  assert.match(b.find((x) => x.id === 'PM-2')!.von, /PM-9/);
});

const pr = (n: number, o: any = {}) => ({ pr: `admin#${n}`, title: `T${n}`, url: `https://gh/${n}`, author: 'x', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-16T01:00:00Z', reviewDecision: null as string | null, turn: { who: 'Knut', role: 'reviewer', why: 'Review angefragt' }, ...o });
const ST = new Date('2026-10-15T16:00:00Z');

test('③ PRs: nur Zustandswechsel — neu, freigegeben, weg; reine Aktualisierungen nicht (K10)', () => {
  const snap = { 'admin#1': { pr: 'admin#1', title: 'T1', url: 'u', reviewDecision: null }, 'admin#2': { pr: 'admin#2', title: 'T2', url: 'u2', reviewDecision: null }, 'admin#3': { pr: 'admin#3', title: 'T3', url: 'u3', reviewDecision: null } };
  const n = prNacht([pr(1, { reviewDecision: 'APPROVED' }), pr(3), pr(4, { createdAt: '2026-10-16T02:00:00Z' })], snap, ST);
  assert.deepEqual(n.map((x) => x.text).sort(), ['admin#1 freigegeben: T1', 'admin#2 gemergt oder geschlossen: T2', 'admin#4 neu: T4']);
  assert.deepEqual(prNacht([pr(3)], null, ST), [], 'ohne Schnappschuss nur „neu“');
});

test('③ Jira: neu, erledigt, Status geändert; Aktualisierung ohne Statuswechsel nicht', () => {
  const t = (key: string, o: any = {}) => ({ key, summary: 's' + key, status: 'In Arbeit', assignee: 'Anna', duedate: null, updated: '2026-10-16T03:00:00Z', ...o });
  const snap = { 'PM-1': 'To Do', 'PM-2': 'In Arbeit', 'PM-3': 'In Arbeit', 'PM-5': 'To Do' };
  const n = jiraNacht([t('PM-1'), t('PM-2'), t('PM-3', { status: 'Done', statusCategory: 'done' }), t('PM-4', { created: '2026-10-16T02:00:00Z' }), t('PM-5', { updated: '2026-10-10T00:00:00Z', status: 'Done' })], snap, ST);
  assert.deepEqual(n.map((x) => x.text).sort(), ['PM-1 sPM-1: To Do → In Arbeit', 'PM-3 sPM-3 erledigt', 'PM-4 sPM-4 neu (Anna)']);
  const o = jiraNacht([t('PM-9', { statusSince: '2026-10-16T01:00:00Z' }), t('PM-8', { statusSince: '2026-09-01T00:00:00Z' })], null, ST);
  assert.equal(o.length, 1);
});

test('③ Stränge: neu, fertig, blockiert; laufende nicht', () => {
  const n = strangNacht([karte({ id: 'a', titel: 'A', startedAt: '2026-10-16T01:00:00Z' }), karte({ id: 'b', titel: 'B' }), karte({ id: 'c', titel: 'C', ampel: 'blockiert' }), karte({ id: 'd', titel: 'D', running: true, ampel: 'laeuft' }), karte({ id: 'e', titel: 'E', statusAt: '2026-10-01T00:00:00Z' })], ST);
  assert.deepEqual(n.map((x) => x.text).sort(), ['Unter-Chat blockiert: C', 'Unter-Chat fertig: B', 'Unter-Chat neu: A']);
});

const REG = `## Offen

- **Z-001** · Knut Peters → Christoph Bitzner · Report schreiben · bis 2026-10-10 · Thema: Flex
- **Z-002** · martenc → Knut · PR prüfen · bis 2026-10-30 · Thema: Cockpit
- **Z-003** · Rogue GmbH → Knut · Vertrag · bis 2026-10-12
- **Z-004** · Wer: offen → Knut · Unterlage nachziehen · Frist unklar
- **Z-005** · Fremder Dritter → Knut · etwas · bis 2026-10-01

## Personen

- Knut · Knut · auch: Knut Peters
- Christoph Bitzner · Team · auch: martenc
- Rogue GmbH · Partner
`;
const eingabe = (o: Partial<LageInput> = {}): LageInput => {
  const r = parseRegister(REG);
  return {
    jetzt: JETZT, stichzeit: ST, karten: [], fragen: [], mine: { prs: [], tickets: [] }, prs: [], prSnapshot: null, jira: [], jiraSnapshot: null,
    register: { vorhanden: { zusagen: true, themen: true }, zusagen: r.zusagen, themen: [], personen: r.personen, unlesbar: [] },
    team: teamSet([{ name: 'Daniela Martinez', aliase: ['Daniela'] }]), meetings: [], triage: [], berichte: [], roadmapFragen: 0, ich: 'Knut', ...o,
  };
};

test('④ Wer schuldet was: Seiten, Überfälliges zuerst, abgeleitete Zeilen, Obergrenze 5 (K8, K11)', () => {
  const s = schulden(eingabe({
    mine: { prs: [{ pr: 'admin#7', title: 'Cockpit-Tab', url: 'u', why: 'Review angefragt' }], tickets: [{ key: 'PM-50', summary: 'Alt', duedate: '2026-10-01', why: 'überfällig' }, { key: 'PM-51', summary: 'Ohne', duedate: null, why: 'ohne Datum' }] },
    prs: [pr(8, { author: 'martenc', reviewDecision: 'CHANGES_REQUESTED', turn: { who: 'Christoph Bitzner', role: 'author', why: 'Änderungen verlangt' } })],
    jira: [{ key: 'PM-60', summary: 'x', status: 'To Do', assignee: 'Daniela Martinez', duedate: '2026-10-05', updated: '2026-10-10T00:00:00Z' }, { key: 'PM-61', summary: 'y', status: 'Done', statusCategory: 'done', assignee: 'Daniela Martinez', duedate: '2026-10-05', updated: '2026-10-10T00:00:00Z' }],
    fragen: [frage()],
  }));
  assert.equal(s.knut.gesamt, 3);   // Z-001 + PR + PM-50 (überfällig) — „ohne Datum“ zählt nicht
  assert.equal(s.knut.items[0].ueberfaellig, true);
  assert.ok(s.knut.items.some((x) => x.id === 'Z-001' && !x.abgeleitet));
  assert.ok(s.knut.items.some((x) => x.abgeleitet && /admin#7/.test(x.was)));
  assert.ok(!JSON.stringify(s).includes('PM-51'), '„ohne Datum“ ist keine Schuld');
  assert.deepEqual(s.team.items.map((x) => x.id ?? x.was.slice(0, 20)).sort(), ['PR admin#8: Änderung', 'Z-002', '1 überfällige Jira-T'].sort());
  assert.deepEqual(s.partner.items.map((x) => x.id), ['Z-003']);
  assert.deepEqual(s.klaeren.items.map((x) => x.id).sort(), ['Z-004', 'Z-005']);
  assert.equal(s.rueckfragenAnKnut, 1);
  assert.equal(s.team.items.find((x) => x.id === 'Z-002')!.seite, 'Team');
  const viele = eingabe({ register: { ...eingabe().register, zusagen: Array.from({ length: 9 }, (_, n) => ({ ...parseRegister(REG).zusagen[0], id: 'Z-9' + n })) } });
  const s2 = schulden(viele);
  assert.equal(s2.knut.items.length, 5); assert.equal(s2.knut.weitere, 4);
});

test('⑤ Themen: nur Bewegtes oder Ball bei Knut, der Rest als Zahl; Namen passen zu themaOf (K9)', () => {
  const th = parseThemen('## Themen\n\n- **Flex** · Stand: läuft · Nächster Schritt: Umfrage · Ball bei: Knut · geändert 2026-10-01\n- **Rogue** · Stand: Vertrag · Nächster Schritt: Entwurf · Ball bei: Christoph · geändert 2026-10-16\n- **Cockpit** · Stand: ok · Nächster Schritt: – · Ball bei: Team · geändert 2026-09-01\n').themen;
  const ents = entscheide({ karten: [karte({ thema: 'Cockpit', entscheidungen: [{ id: 'D1', frage: 'f', empfehlung: '' }] })], fragen: [], triage: [] });
  const r = themen(eingabe({ register: { ...eingabe().register, themen: th }, karten: [karte({ thema: 'Cockpit', entscheidungen: [{ id: 'D1', frage: 'f', empfehlung: '' }] })] }), ents);
  assert.deepEqual(r.zeilen.items.map((z) => z.name), ['Flex', 'Cockpit', 'Rogue']);
  assert.equal(r.ruhig, 0);
  assert.equal(r.zeilen.items.find((z) => z.name === 'Flex')!.offeneZusagen, 1, 'Z-001 Thema Flex');
  assert.equal(r.zeilen.items.find((z) => z.name === 'Cockpit')!.entscheidungen, 1);
});

test('Lage: leeres Register → Hinweis „Register noch leer → Einwurf“ (K16)', () => {
  const l = baueLage(eingabe({ register: { vorhanden: { zusagen: false, themen: false }, zusagen: [], themen: [], personen: [], unlesbar: [] } }));
  assert.match(l.leer ?? '', /Register noch leer → Einwurf/);
  assert.equal(baueLage(eingabe()).leer, null);
});

test('Berichtszeilen: Dienste, Abgleich, Zahlen, Vault-Sync nur von heute (K1)', () => {
  const daily = '## Dienste und RAM (dienste, 06:50)\n\n- Zum Aufräumen vorgeschlagen: **24** Dienste, ≈ 2439 MB.\n- x\n\n## Abgleich\n\n**Schon gebaut** (6)\n\n- a\n\n**Nur lokal** (2)\n';
  const z = dailyZeilen(daily);
  assert.match(z.dienste!, /^Zum Aufräumen vorgeschlagen: 24 Dienste/);
  assert.equal(z.daily, 'Abgleich Spec ↔ Plan: Schon gebaut 6 · Nur lokal 2');
  assert.equal(dailyZeilen('nichts').daily, null);
  assert.equal(debriefZeile('## Zahlen\n- offen **87** · überfällig **19**\n\n**Offene**'), 'offen 87 · überfällig 19');
  const sync = '# P\n\n## 2026-10-15 10:00\n\n- `a.md` x\n\n## 2026-10-16 07:35\n\n- `a.md` x\n- `b.md` y\n- Nicht geändert: z\n';
  assert.equal(syncZeile(sync, '2026-10-16'), 'Vault-Sync 07:35: 2 Dateien geändert');
  assert.equal(syncZeile(sync, '2026-10-17'), null, 'kein Platzhalter für Fehlendes');
});

test('Vault-Seite: Stand in der ersten Zeile (K19), bei voller Last höchstens 25 Zeilen Inhalt (K10), Links nur auf geprüfte Notizen', () => {
  const viele = <T>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));
  const r = parseRegister(REG);
  const l = baueLage(eingabe({
    karten: viele(40, (n) => karte({ id: 'k' + n, titel: 'Strang ' + n, ampel: 'blockiert', braucht: 'Blocker ' + n, entscheidungen: [{ id: 'D1', frage: 'Frage ' + n, empfehlung: 'Ja' }] })),
    fragen: viele(30, (n) => frage({ id: 'q' + n })), prs: viele(50, (n) => pr(n, { createdAt: '2026-10-16T01:00:00Z' })),
    register: { ...eingabe().register, zusagen: viele(60, (n) => ({ ...r.zusagen[0], id: 'Z-' + n })), unlesbar: viele(5, (n) => ({ zeile: n, text: 'x', abschnitt: 'offen' })) },
    berichte: [{ art: 'debrief', label: 'Jira-Debrief', zeile: 'z', link: 'olaf/1-Projects/daily-debrief/2026-10-16-olaf-debrief.md' }, { art: 'dienste', label: 'Dienste', zeile: 'z', link: null }],
  }));
  const md = lageMarkdown(l, { links: { 'olaf/1-Projects/daily-debrief/2026-10-16-olaf-debrief.md': '2026-10-16-olaf-debrief' } });
  const [, fm, body] = md.split(/^---\n|\n---\n/);
  assert.match(fm, /type: reference\nteam: olaf\narea: operations/);
  const zeilen = body.replace(/\n$/, '').split('\n');
  assert.ok(zeilen.length <= MAX_ZEILEN, `${zeilen.length} Zeilen`);
  assert.match(zeilen[0], /^Stand 07:00, aktuell: Übersicht/);
  assert.match(md, /\[\[2026-10-16-olaf-debrief\]\]/);
  assert.ok(!md.includes('[[Dienste]]'));
  const ohne = lageMarkdown(l, { links: {} });
  assert.ok(!/\[\[/.test(ohne), 'ohne geprüfte Datei kein Wikilink');
});

test('kappe (Walkthrough 221): „… und N weitere“ trägt die versteckten Einträge mit, damit die Liste aufklappt', () => {
  assert.deepEqual(kappe([1, 2, 3], 5), { items: [1, 2, 3], weitere: 0, gesamt: 3 });
  const k = kappe([1, 2, 3, 4, 5, 6, 7], 5);
  assert.deepEqual(k.rest, [6, 7]);
  assert.equal(k.weitere, 2);
  assert.equal(kappe(Array.from({ length: 80 }, (_, i) => i), 5).rest!.length, 50, 'höchstens 50 nachgereicht');
});
