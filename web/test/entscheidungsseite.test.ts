// Entscheidungsseite (Knut 19.10., Muster entscheidungen-site): Karten aus der Inbox — D-Fragen einzeln, wichtig oben, nach Thema.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baueInbox, type InboxQuellen } from '../server/inbox.ts';
import { fragenAus, empfohlenBeantwortbar } from '../server/entscheidungsseite.ts';

const leer: InboxQuellen = { karten: [], lose: [], vault: [], pflege: 0, schlange: [], kopfFehler: [] };
const now = Date.parse('2026-10-19T10:00:00Z');
const karte = (id: string, thema: string, entscheidungen: any[]) => ({ id, titel: `Strang ${id}`, strangTitel: `Strang ${id}`, thema, running: false, entscheidungen, berichtHash: 'h', rueckfragen: [],
  braucht: null, kannFreigeben: false, freigabe: null, github: [], statusAt: new Date(now - 3600_000), chat: null, paket: '300-x' });

test('Karten: eine je D-Frage, Worum aus der Frage, Optionen getrennt; Rückfrage mit Kontext; Pflege unter „Sonstiges“', () => {
  const ib = baueInbox({ ...leer, pflege: 2,
    karten: [karte('a1', 'Flex', [{ id: 'D1', frage: 'Fragebogen-Editor jetzt bauen? Er ist der Termin-Treiber für die Umfrage.', empfehlung: 'Ja, jetzt', optionenListe: ['Ja, jetzt', 'Später'], worum: 'Plan 132 ist fertig.' },
      { id: 'D2', frage: 'Tooltip zeigen?', empfehlung: null }])],
    lose: [{ id: 'q1', title: 'Nachtbau mit Eval?', recommendation: 'Ja', options: [{ label: 'Ja' }, { label: 'Nein' }], createdAt: new Date(now - 7200_000), context: 'kostet 40 min' }] }, { now });
  const { fragen, sonstiges } = fragenAus(ib.eintraege);
  const d1 = fragen.find((f) => f.teil === 'D1')!;
  assert.equal(d1.titel, 'Fragebogen-Editor jetzt bauen?'); assert.equal(d1.worum, 'Er ist der Termin-Treiber für die Umfrage. Plan 132 ist fertig.', 'Titel nicht doppelt, worum aus dem Kopf dazu');
  assert.deepEqual(d1.optionen, ['Ja, jetzt', 'Später']); assert.equal(d1.gruppe, 'Flex'); assert.equal(d1.id, `${d1.eintrag}~D1`);
  assert.ok(fragen.some((f) => f.teil === 'D2'));
  const q = fragen.find((f) => f.art === 'rueckfrage')!;
  assert.equal(q.worum, 'kostet 40 min'); assert.deepEqual(q.optionen, ['Ja', 'Nein']); assert.equal(q.gruppe, 'Hauptchat');
  assert.deepEqual(sonstiges.map((e) => e.id), ['pflege']);
  assert.equal(empfohlenBeantwortbar(d1), true);
  assert.equal(empfohlenBeantwortbar(fragen.find((f) => f.teil === 'D2')!), false, 'ohne Empfehlung nicht „wie empfohlen“');
});

test('Reihenfolge: Gruppen mit wichtigen Fragen zuerst, darin wichtige oben; Gruppen bleiben zusammen', () => {
  const ib = baueInbox({ ...leer, karten: [
    karte('a1', 'Ruhig', [{ id: 'D1', frage: 'Farbe der Kacheln?', empfehlung: 'blau' }]),
    karte('b2', 'Heikel', [{ id: 'D1', frage: 'Vertrag mit dem Kunden unterschreiben?', empfehlung: 'ja' }, { id: 'D2', frage: 'Logo größer?', empfehlung: 'nein' }]),
  ] }, { now });
  const { fragen } = fragenAus(ib.eintraege);
  assert.equal(fragen[0].gruppe, 'Heikel', 'Gruppe mit einer wichtigen Frage zuerst');
  assert.equal(fragen[0].stufe, 'wichtig');
  assert.deepEqual(fragen.map((f) => f.gruppe), ['Heikel', 'Heikel', 'Ruhig']);
});

test('F10: aktuelle wichtige Vault-Fragen einzeln (immer wichtig, nie automatisch), der Rest ein Sammeleintrag unter „Sonstiges“', () => {
  const ib = baueInbox({ ...leer, vaultFragen: [{ path: 'olaf/x/spec-a.md', line: 12, hash: 'h', head: 'D5 2FA-Umfang: auf allen Schreibwegen?', section: 'Offene Fragen', title: 'Cockpit', topic: 'Cockpit', since: '2026-10-15', grund: 'geht nach außen' }], vaultRest: 305 }, { now });
  const v = ib.eintraege.find((e) => e.art === 'vaultfrage')!;
  assert.match(v.id, /^k-/); assert.equal(v.stufe, 'wichtig'); assert.equal(v.autoAb, null); assert.equal(v.thema, 'Cockpit');
  const { fragen, sonstiges } = fragenAus(ib.eintraege);
  assert.equal(fragen[0].art, 'vaultfrage'); assert.match(fragen[0].worum, /Abschnitt „Offene Fragen“.*geht nach außen.*„- Knut:“/);
  assert.deepEqual(fragen[0].antworten, ['ja', 'nein', 'anders', 'spaeter']);
  assert.match(sonstiges.find((e) => e.id === 'pflege-vault')!.frage, /305 weitere offene Vault-Fragen/);
});

test('Bericht-Kopf und Textblock liefern „Worum es geht“ und Optionen für die Karte', async () => {
  const { berichtKopf } = await import('../server/berichtkopf.ts');
  const { offeneEntscheidungen, blockWorum } = await import('../server/uebersicht.ts');
  const md = ['---', 'status: wartet_auf_knut', 'titel: x', 'fragen:', '  - id: D1', '    frage: Kacheln gleich?', '    worum: Heute sieht jede Rolle andere Kacheln.', '    optionen:', '      - gleich', '      - je Rolle',
    '    empfehlung: gleich', '    antwort: ""', '---', '', '**D2 — Tooltip zeigen?**', 'Der Tooltip erklärt die Kennzahl.', '- Empfehlung: ja', ''].join('\n');
  const k: any = berichtKopf(md);
  assert.equal(k.fragen[0].worum, 'Heute sieht jede Rolle andere Kacheln.'); assert.deepEqual(k.fragen[0].optionen, ['gleich', 'je Rolle']);
  const o = offeneEntscheidungen(md, null);
  assert.deepEqual(o.find((x) => x.id === 'D1')!.optionenListe, ['gleich', 'je Rolle']);
  assert.equal(o.find((x) => x.id === 'D2')!.worum, 'Der Tooltip erklärt die Kennzahl.', 'Textblock ohne Empfehlungszeile');
  assert.equal(blockWorum('**fett** Satz\n- Knut: ja\n- Optionen: a/b'), 'fett Satz');
});

test('U3: „Heute“ = gilt in 24 h als angenommen oder wichtig und hält einen Unter-Chat an; sonst „Offen“', async () => {
  const { heuteFaellig } = await import('../server/entscheidungsseite.ts');
  const t = Date.parse('2026-10-19T10:00:00Z');
  assert.equal(heuteFaellig({ autoAb: '2026-10-20T09:00:00Z', stufe: 'normal', blockiert: 0 }, t), true);
  assert.equal(heuteFaellig({ autoAb: '2026-10-21T09:00:00Z', stufe: 'normal', blockiert: 0 }, t), false);
  assert.equal(heuteFaellig({ autoAb: null, stufe: 'wichtig', blockiert: 1 }, t), true);
  assert.equal(heuteFaellig({ autoAb: null, stufe: 'wichtig', blockiert: 0 }, t), false);
});
