// Eine Inbox (Plan 213 S2, Council K4/K10/K12, P5): alle Fragearten, feste Kennungen, Sortierung „blockiert, dann wartet am
// längsten“, Später bis morgen 07:00, Altbestand als ein Sammel-Eintrag, Sammel-Einträge für Pflege und unlesbare Köpfe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baueInbox, kennung, spaeterBis, KENNUNG_RE, ALTBESTAND_TAGE, type InboxQuellen } from '../server/inbox.ts';

const now = Date.UTC(2026, 9, 17, 10);
const vor = (min: number) => new Date(now - min * 60_000).toISOString();
const karte = (o: Partial<InboxQuellen['karten'][number]>): InboxQuellen['karten'][number] => ({ id: 'aa000001', titel: 'Titel', strangTitel: 'Strang', running: false, entscheidungen: [], berichtHash: 'h1234567890',
  rueckfragen: [], braucht: null, kannFreigeben: false, freigabe: null, github: [], statusAt: vor(30), chat: 'https://chat/c/1', paket: '209-chief-of-staff', ...o });
const leer: InboxQuellen = { karten: [], lose: [], vault: [], pflege: 0, schlange: [], kopfFehler: [] };

test('Alle Arten an einer Stelle, je mit Kennung, Quelle, Empfehlung und erlaubten Antworten', () => {
  const r = baueInbox({ ...leer,
    karten: [
      karte({ id: 'aa000001', entscheidungen: [{ id: 'D1', frage: 'A?', empfehlung: 'Ja' }, { id: 'D2', frage: 'B?', empfehlung: 'Nein' }] }),
      karte({ id: 'aa000002', braucht: 'Soll der Bot den Netzbetreiber nennen?', statusAt: vor(12) }),
      karte({ id: 'aa000003', kannFreigeben: true, github: [{ repo: 'knut523/werkbank', zweig: 'feat/x', commit: '5c33b65' }], statusAt: vor(50) }),
      karte({ id: 'aa000004', running: true, braucht: 'läuft noch — keine Frage' }),
    ],
    lose: [{ id: 'q-ab12', title: 'Release 17c live?', recommendation: 'Ja', options: [{ label: 'Ja' }, { label: 'Nein' }], createdAt: vor(120) }],
    vault: [{ id: 'S123', text: 'Spec nach 4-Review verschieben', at: vor(200) }],
    pflege: 3,
  }, { now });
  const arten = r.eintraege.map((e) => e.art);
  assert.deepEqual(new Set(arten), new Set(['entscheidung', 'braucht', 'push', 'rueckfrage', 'vault', 'pflege']));
  assert.ok(!r.eintraege.some((e) => e.quelle.strand === 'aa000004'), 'laufender Unter-Chat: keine Frage');
  const d = r.eintraege.find((e) => e.art === 'entscheidung')!;
  assert.equal(d.id, kennung.entscheidung('aa000001', 'h1234567890'));
  assert.match(d.frage, /2 Entscheidungen im Bericht \(D1, D2\)/);
  assert.equal(d.empfehlung, 'alle Empfehlungen übernehmen');
  assert.equal(d.quelle.text, 'Bericht 209');
  const p = r.eintraege.find((e) => e.art === 'push')!;
  assert.equal(p.id, 'p-aa000003-5c33b65');
  assert.deepEqual(p.antworten, ['ja', 'spaeter'], 'Push: freigeben oder später, nie „nein“ ohne Ansicht');
  assert.equal(p.quelle.text, 'werkbank', 'keine SHA im Alltag (UX-Befund 4)');
  assert.equal(r.eintraege.find((e) => e.art === 'pflege')!.frage, '3 Tickets brauchen Pflege');
  for (const e of r.eintraege) assert.ok(KENNUNG_RE.test(e.id), e.id);
});

test('Sortierung: blockiert am meisten, dann wartet am längsten', () => {
  const r = baueInbox({ ...leer,
    karten: [karte({ id: 'aa000002', braucht: 'X?', statusAt: vor(10) })],
    lose: [{ id: 'q-1', title: 'ohne Unter-Chat', createdAt: vor(500) }, { id: 'q-2', title: 'mit Unter-Chat', createdAt: vor(300), strand: { id: 'zz000009', title: 'Z' } }],
    schlange: [{ id: 'aa000009', titel: 'a', since: now - 40 * 60_000 }, { id: 'aa000010', titel: 'b', since: now - 35 * 60_000 }],
  }, { now });
  assert.deepEqual(r.eintraege.map((e) => e.id), ['schlange', 'q-2', kennung.braucht('aa000002', 'X?'), 'q-1']);
  assert.equal(r.eintraege[0].blockiert, 2);
  assert.match(r.eintraege[0].frage, /2 Unter-Chats warten seit 40 min/);
});

test('Rückfrage zu einer Karte steht bei der Karte, nicht doppelt; G0-Frage blockiert', () => {
  const q = { id: 'q-9', title: 'Videos mit?', createdAt: vor(5), strand: { id: 'aa000001', title: 'Cockpit' } };
  const r = baueInbox({ ...leer, karten: [karte({ rueckfragen: [q] })], lose: [q, { id: 'q-g0', title: 'G0', key: 'spec#G0', createdAt: vor(5) }] }, { now });
  assert.equal(r.eintraege.filter((e) => e.id === 'q-9').length, 1);
  assert.equal(r.eintraege.find((e) => e.id === 'q-g0')!.blockiert, 1);
});

test('Später bis morgen 07:00 Wiener Zeit (Sommer- und Winterzeit); zurückgestellte zählen nicht', () => {
  assert.equal(spaeterBis(Date.UTC(2026, 9, 17, 10)).toISOString(), '2026-10-18T05:00:00.000Z');
  assert.equal(spaeterBis(Date.UTC(2026, 9, 25, 10)).toISOString(), '2026-10-26T06:00:00.000Z', 'nach der Zeitumstellung am 25.10.');
  const r = baueInbox({ ...leer, lose: [{ id: 'q-1', title: 'a', createdAt: vor(5) }, { id: 'q-2', title: 'b', createdAt: vor(5) }] }, { now, spaeter: new Map([['q-1', now + 3600_000], ['q-2', now - 1]]) });
  assert.deepEqual(r.eintraege.map((e) => e.id), ['q-2'], 'abgelaufenes Später zeigt wieder');
  assert.equal(r.zurueckgestellt, 1);
});

test('Altbestand (Stichtag): älter als 14 Tage → ein Sammel-Eintrag; Push bleibt einzeln', () => {
  const alt = vor((ALTBESTAND_TAGE + 1) * 1440);
  const r = baueInbox({ ...leer,
    lose: [{ id: 'q-a', title: 'alt', createdAt: alt }, { id: 'q-b', title: 'alt2', createdAt: alt }, { id: 'q-c', title: 'neu', createdAt: vor(5) }],
    karten: [karte({ kannFreigeben: true, github: [{ repo: 'o/r', zweig: 'z', commit: 'abc1234' }], statusAt: alt })],
  }, { now });
  const a = r.eintraege.find((e) => e.art === 'altbestand')!;
  assert.match(a.frage, /2 Fragen sind älter als 14 Tage/);
  assert.deepEqual((a.daten.eintraege as any[]).map((e) => e.id).sort(), ['q-a', 'q-b']);
  assert.ok(r.eintraege.some((e) => e.art === 'push'), 'Push nie im Altbestand');
  assert.deepEqual(a.antworten, ['nein', 'spaeter']);
});

test('Unlesbare Berichtköpfe und Pflege: je genau ein Sammel-Eintrag (K10)', () => {
  const r = baueInbox({ ...leer, pflege: 1, kopfFehler: [{ id: 'aa000001', titel: 'A' }, { id: 'aa000002', titel: 'B' }] }, { now });
  assert.deepEqual(r.eintraege.map((e) => e.id).sort(), ['pflege', 'pflege-kopf']);
  assert.equal(r.eintraege.find((e) => e.id === 'pflege')!.frage, '1 Ticket braucht Pflege');
  assert.match(r.eintraege.find((e) => e.id === 'pflege-kopf')!.frage, /2 Berichte haben einen unlesbaren Kopf/);
});

test('Kennungen sind stabil und kurz; nur bekannte Formen gelten', () => {
  assert.equal(kennung.braucht('aa', 'X?'), kennung.braucht('aa', 'X?'));
  assert.notEqual(kennung.braucht('aa', 'X?'), kennung.braucht('aa', 'Y?'));
  assert.ok(KENNUNG_RE.test('q-abc')); assert.ok(KENNUNG_RE.test('altbestand')); assert.ok(!KENNUNG_RE.test('../x')); assert.ok(!KENNUNG_RE.test('x-1'));
});
