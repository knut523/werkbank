// Chat-Status (Release 29, Strang B): genau fünf Zustände je Chat — läuft · braucht Knut · in Review · fertig · hängt.
// Jeder frühere Zustand (Zustand aus Plan 213, Status des Hauptchats, Ampel der Übersicht) bildet auf genau einen ab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatStatus, chatStatusAn, CHAT_STATUS_TEXT, CHAT_STATUS_RANG, ABBILDUNG, offeneJeStrang, ersterSatz, zaehleChat, type ChatStatus } from '../server/chatstatus.ts';
import type { Zustand } from '../server/zustand.ts';

const ZUSTAENDE: Zustand[] = ['laeuft', 'schlange', 'wartet', 'stand-fehlt', 'haengt', 'blockiert', 'fertig', 'erledigt'];

test('Schalter: Vorgabe aus', () => {
  assert.equal(chatStatusAn({}), false);
  assert.equal(chatStatusAn({ WERKBANK_CHAT_STATUS: '1' }), true);
});

test('feste Menge: fünf Status, jeder mit Text und Rang', () => {
  const s: ChatStatus[] = ['laeuft', 'braucht', 'review', 'fertig', 'haengt'];
  assert.deepEqual(Object.keys(CHAT_STATUS_TEXT).sort(), [...s].sort());
  assert.deepEqual(Object.keys(CHAT_STATUS_RANG).sort(), [...s].sort());
  assert.equal(CHAT_STATUS_TEXT.braucht, 'braucht Knut');
  assert.equal(CHAT_STATUS_TEXT.review, 'in Review');
});

test('jeder alte Zustand bildet auf genau einen Chat-Status ab (Tabelle = Funktion)', () => {
  for (const z of ZUSTAENDE) {
    assert.ok(ABBILDUNG[z], `Abbildung für ${z}`);
    const ohneFragen = chatStatus({ zustand: z, offeneFragen: 0, geprueft: false }).status;
    assert.ok(Object.keys(CHAT_STATUS_TEXT).includes(ohneFragen));
    assert.equal(ohneFragen, ABBILDUNG[z].status, `${z}`);
  }
  assert.equal(ABBILDUNG.laeuft.status, 'laeuft');
  assert.equal(ABBILDUNG.schlange.status, 'laeuft');
  assert.equal(ABBILDUNG['stand-fehlt'].status, 'laeuft', 'Zwischenstand ist kein Warten auf Knut');
  assert.equal(ABBILDUNG.wartet.status, 'braucht');
  assert.equal(ABBILDUNG.blockiert.status, 'braucht');
  assert.equal(ABBILDUNG.haengt.status, 'haengt');
  assert.equal(ABBILDUNG.fertig.status, 'review', 'fertig gemeldet = wartet auf deine Durchsicht');
  assert.equal(ABBILDUNG.erledigt.status, 'fertig');
});

test('offene Fragen machen immer „braucht Knut“ — auch bei „läuft“ und „fertig gemeldet“', () => {
  assert.equal(chatStatus({ zustand: 'fertig', offeneFragen: 2, geprueft: false }).status, 'braucht', 'D1, D2 im Bericht offen');
  assert.equal(chatStatus({ zustand: 'laeuft', offeneFragen: 1, geprueft: false }).status, 'braucht', 'Rückfrage, Agent wartet im Werkzeug');
  assert.match(chatStatus({ zustand: 'fertig', offeneFragen: 2, geprueft: false }).grund, /2 offene Fragen/);
  assert.match(chatStatus({ zustand: 'fertig', offeneFragen: 1, geprueft: false }).grund, /1 offene Frage\b/);
  assert.equal(chatStatus({ zustand: 'schlange', offeneFragen: 1, geprueft: false }).status, 'laeuft', 'in der Schlange wartet niemand auf eine Antwort');
});

test('von Knut geprüft = fertig; offene Fragen gehen vor', () => {
  assert.equal(chatStatus({ zustand: 'fertig', offeneFragen: 0, geprueft: true }).status, 'fertig');
  assert.equal(chatStatus({ zustand: 'erledigt', offeneFragen: 0, geprueft: false }).status, 'fertig');
  assert.equal(chatStatus({ zustand: 'fertig', offeneFragen: 1, geprueft: true }).status, 'braucht');
});

test('Rang: braucht Knut zuerst, fertig zuletzt', () => {
  const r = CHAT_STATUS_RANG;
  assert.ok(r.braucht < r.review && r.review < r.haengt && r.haengt < r.laeuft && r.laeuft < r.fertig);
});

test('Fragen je Strang aus den Inbox-Einträgen (Entscheidung zählt je D-Nummer, Rückfrage und „braucht“ je eins)', () => {
  const e = (id: string, art: string, strand: string | null, daten: any = {}) => ({ id, art, quelle: { strand }, daten }) as any;
  const m = offeneJeStrang([
    e('d-a-1', 'entscheidung', 'aaaaaaaa', { entscheidungen: [{ id: 'D1' }, { id: 'D2' }] }),
    e('q-1', 'rueckfrage', 'aaaaaaaa'), e('q-2', 'rueckfrage', 'bbbbbbbb'), e('q-3', 'rueckfrage', null),
    e('b-a-1', 'braucht', 'cccccccc'), e('p-a', 'push', 'aaaaaaaa'), e('pf', 'pflege', 'aaaaaaaa'),
  ]);
  assert.equal(m.get('aaaaaaaa'), 3, 'D1, D2 + eine Rückfrage; Push und Pflege sind keine Fragen');
  assert.equal(m.get('bbbbbbbb'), 1);
  assert.equal(m.get('cccccccc'), 1);
  assert.equal(m.has('null'), false);
});

test('„Worum“ in einem Satz', () => {
  assert.equal(ersterSatz('Das ist der erste Satz. Und noch ein zweiter, der nicht gebraucht wird.'), 'Das ist der erste Satz.');
  assert.equal(ersterSatz(''), '');
  assert.ok(ersterSatz('x'.repeat(500)).length <= 200);
  assert.ok(ersterSatz('x'.repeat(500)).endsWith('…'));
});

test('Zählung: eine Zahl für Leiste, Arbeit und Chatkopf', () => {
  const z = zaehleChat(['braucht', 'braucht', 'review', 'laeuft', 'fertig', 'haengt']);
  assert.equal(z.braucht, 2); assert.equal(z.review, 1); assert.equal(z.fertig, 1);
  assert.equal(z.fuerDich, 3, 'braucht Knut + in Review (hängt zählt nicht: das macht der Strang selbst weiter)');
});

test('Arbeit-Zeile: ohne Schalter kein Chat-Status, mit Schalter genau einer — und er sortiert „braucht Knut“ nach oben', async () => {
  const { zeile, sortiere } = await import('../server/arbeit.ts');
  const d = (id: string, zustand: string, extra: any = {}) => ({ _id: id, title: id, zustand, lastStatus: 'waiting', startedAt: new Date(), ...extra });
  assert.equal(zeile(d('a', 'fertig')).cs, null, 'Vorgabe aus: Arbeit bleibt wie sie war');
  const z = zeile(d('a', 'fertig'), { offeneFragen: 0 });
  assert.equal(z.cs?.status, 'review'); assert.equal(z.cs?.text, 'in Review');
  assert.equal(zeile(d('b', 'fertig'), { offeneFragen: 2 }).cs?.status, 'braucht');
  assert.equal(zeile(d('c', 'fertig', { knutReviewedAt: new Date() }), { offeneFragen: 0 }).cs?.status, 'fertig');
  const sortiert = sortiere([zeile(d('l', 'laeuft'), { offeneFragen: 0 }), zeile(d('r', 'fertig'), { offeneFragen: 0 }), zeile(d('b', 'wartet'), { offeneFragen: 1 })]).map((x) => x.id);
  assert.deepEqual(sortiert, ['b', 'r', 'l']);
});
