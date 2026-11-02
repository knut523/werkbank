// „Mein Tag“ schlägt den Tag vor (R30b Teil B, docs/plan-tagesvorschlag.md): rein, regelbasiert, ohne Mongo.
// Prio 1 = fällig heute/morgen oder blockiert einen laufenden Strang · Prio 2 = Review/Feedback · Prio 3 = Rest;
// höchstens 3 Muss; Entscheidungen gebündelt; Termine sind Lücken; nur bei leerem Tag; Blöcke tragen quelle 'vorschlag'.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vorschlag, ausLage, TAGESVORSCHLAG_AN, type VorschlagEingabe } from '../server/tagesvorschlag.ts';

const HEUTE = '2026-11-02';
const leer: VorschlagEingabe = { datum: HEUTE, tickets: [], zusagen: [], entscheidungen: { anzahl: 0, blockiert: 0 }, reviews: [], termine: [], uebertrag: [] };
const e = (o: Partial<VorschlagEingabe>): VorschlagEingabe => ({ ...leer, ...o });
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

test('Schalter: nur „an“ schaltet (Vorgabe aus)', () => {
  assert.equal(TAGESVORSCHLAG_AN({}), false);
  assert.equal(TAGESVORSCHLAG_AN({ WERKBANK_TAGESVORSCHLAG: '1' }), false);
  assert.equal(TAGESVORSCHLAG_AN({ WERKBANK_TAGESVORSCHLAG: 'an' }), true);
});

test('Nichts bekannt → kein Vorschlag (kein erfundener Tag)', () => {
  assert.deepEqual(vorschlag(leer).bloecke, []);
});

test('Prio 1: fällig heute/morgen und überfällig; Entscheidungen, die einen Strang blockieren, sind Muss', () => {
  const r = vorschlag(e({
    tickets: [
      { key: 'PM-1', summary: 'Fällig morgen', duedate: '2026-11-03' },
      { key: 'PM-2', summary: 'Nächste Woche', duedate: '2026-11-09', inSprint: true },
      { key: 'PM-3', summary: 'Überfällig', duedate: '2026-10-30' },
    ],
    entscheidungen: { anzahl: 4, blockiert: 2 },
  }));
  const p = Object.fromEntries(r.bloecke.map((b) => [b.key ?? b.title, b.prio]));
  assert.equal(p['PM-1'], 1); assert.equal(p['PM-3'], 1); assert.equal(p['PM-2'], 3);
  const ent = r.bloecke.find((b) => /Entscheidungen/.test(b.title ?? ''))!;
  assert.equal(ent.prio, 1, 'blockiert laufende Stränge → Muss');
  assert.match(ent.title!, /4 offen/);
  assert.equal(r.bloecke.filter((b) => /Entscheidungen/.test(b.title ?? '')).length, 1, 'gebündelt: ein Block, nicht je Frage');
  assert.ok(r.bloecke.every((b) => b.quelle === 'vorschlag' && b.date === HEUTE && b.state === 'geplant'));
  assert.ok(r.bloecke.every((b) => b.grund && b.grund.length > 5), 'jeder Block sagt, warum');
});

test('Entscheidungen ohne Blockade sind Soll; Reviews gebündelt als Soll', () => {
  const r = vorschlag(e({ entscheidungen: { anzahl: 2, blockiert: 0 }, reviews: [{ pr: 'a/b#1', title: 'X' }, { pr: 'a/b#2', title: 'Y' }] }));
  assert.equal(r.bloecke.find((b) => /Entscheidungen/.test(b.title ?? ''))!.prio, 2);
  const rev = r.bloecke.filter((b) => /Review/.test(b.title ?? ''));
  assert.equal(rev.length, 1); assert.equal(rev[0].prio, 2); assert.match(rev[0].title!, /2 PRs/);
});

test('Höchstens 3 Muss — der Rest rutscht auf Soll, früheste Frist zuerst', () => {
  const tickets = ['2026-11-03', '2026-10-20', '2026-11-02', '2026-10-31', '2026-11-03'].map((d, i) => ({ key: `PM-${10 + i}`, summary: `T${i}`, duedate: d }));
  const r = vorschlag(e({ tickets, zusagen: [{ id: 'Z-1', was: 'Angebot an Rogue', bis: '2026-11-02', an: 'Rogue' }] }));
  const muss = r.bloecke.filter((b) => b.prio === 1);
  assert.equal(muss.length, 3);
  assert.deepEqual(muss.map((b) => b.key ?? b.title), ['PM-11', 'PM-13', 'PM-12'], 'überfällig 20.10., 31.10., dann heute');
  assert.ok(r.bloecke.filter((b) => b.prio === 2).length >= 3, 'übrige Fristen als Soll, nicht weggelassen');
});

test('Termine sind Lücken: keine Überlappung, Termine selbst stehen als Block da', () => {
  const r = vorschlag(e({
    termine: [{ zeit: '09:00', titel: 'Daily' }, { zeit: '10:30', titel: 'Rogue Call' }],
    tickets: [{ key: 'PM-1', summary: 'A', duedate: HEUTE }, { key: 'PM-2', summary: 'B', duedate: HEUTE }, { key: 'PM-3', summary: 'C', duedate: HEUTE }],
    entscheidungen: { anzahl: 1, blockiert: 1 },
  }));
  const bs = [...r.bloecke].sort((a, b) => a.start - b.start);
  for (let i = 1; i < bs.length; i++) assert.ok(bs[i - 1].start + bs[i - 1].dur <= bs[i].start, `Überlappung ${hm(bs[i - 1].start)} / ${hm(bs[i].start)}`);
  const daily = bs.find((b) => /Daily/.test(b.title ?? ''))!;
  assert.equal(daily.start, 9 * 60); assert.equal(daily.prio, null);
  assert.ok(bs.every((b) => b.start % 15 === 0 && b.dur % 15 === 0 && b.start >= 7 * 60 && b.start + b.dur <= 20 * 60), 'im Raster');
});

test('Termin ohne Uhrzeit blockiert nichts (nur als Hinweis), Übertrag von gestern behält seine Prio', () => {
  const r = vorschlag(e({ termine: [{ zeit: null, titel: 'Irgendwann' }], uebertrag: [{ title: 'Spec schreiben', dur: 90, prio: 1 }, { key: 'PM-7', dur: 30, prio: null }] }));
  assert.ok(!r.bloecke.some((b) => /Irgendwann/.test(b.title ?? '')));
  assert.ok(r.hinweise.some((h) => /Irgendwann/.test(h)));
  const spec = r.bloecke.find((b) => b.title === 'Spec schreiben')!;
  assert.equal(spec.prio, 1); assert.equal(spec.dur, 90); assert.match(spec.grund, /gestern/);
  assert.equal(r.bloecke.find((b) => b.key === 'PM-7')!.prio, 3);
});

test('Voller Tag: was nicht passt, wird gezählt statt still weggelassen', () => {
  const tickets = Array.from({ length: 20 }, (_, i) => ({ key: `PM-${100 + i}`, summary: `T${i}`, duedate: HEUTE }));
  const r = vorschlag(e({ tickets }));
  assert.ok(r.bloecke.length < 20);
  assert.equal(r.ausgelassen, 20 - r.bloecke.length);
});

test('ausLage: echte Morgenlage-Eingabe (Erzeuger-Form) → Vorschlags-Eingabe', () => {
  // Form wie cossammle.sammleEingabe (LageInput) — nur die Felder, die der Vorschlag liest.
  const lage: any = {
    jetzt: new Date('2026-11-02T06:55:00Z'), ich: 'Knut',
    mine: { prs: [{ pr: 'WirStrom1/olaf-admin#412', title: 'Admin UAT', url: 'u', why: 'Review angefragt' }], tickets: [] },
    register: { personen: [{ name: 'Knut Peters', seite: 'Knut', auch: ['Knut'] }], zusagen: [
      { id: 'Z-3', wer: 'Knut', an: 'Rogue', was: 'Vertrag prüfen', bis: '2026-11-03', abschnitt: 'offen', fristUnklar: false, notizen: [], zeile: 1 },
      { id: 'Z-4', wer: 'Lena', an: 'Knut', was: 'Zahlen schicken', bis: '2026-11-02', abschnitt: 'offen', fristUnklar: false, notizen: [], zeile: 2 },
      { id: 'Z-5', wer: 'Knut', an: 'Team', was: 'Alt', bis: '2026-10-01', abschnitt: 'erledigt', fristUnklar: false, notizen: [], zeile: 3 },
    ] },
    termine: [{ wann: 'heute', datum: '2026-11-02', zeit: '14:00', titel: 'Sync WirStrom' }, { wann: 'morgen', datum: '2026-11-03', zeit: '09:00', titel: 'Morgen' }],
  };
  const ents = [{ wartet: true }, { wartet: false }, { wartet: true }];
  const v = ausLage(lage, ents as any, { datum: '2026-11-02', tickets: [{ key: 'PM-9', summary: 'X', duedate: null }], uebertrag: [], termine: true });
  assert.deepEqual(v.zusagen.map((z) => z.id), ['Z-3'], 'nur Knuts offene Zusagen');
  assert.deepEqual(v.entscheidungen, { anzahl: 3, blockiert: 2 });
  assert.deepEqual(v.reviews.map((r) => r.pr), ['WirStrom1/olaf-admin#412']);
  assert.deepEqual(v.termine, [{ zeit: '14:00', titel: 'Sync WirStrom' }], 'nur heute');
  assert.deepEqual(ausLage(lage, [], { datum: '2026-11-02', tickets: [], uebertrag: [], termine: false }).termine, [], 'ohne COS_ICS keine Termine (D4)');
});
