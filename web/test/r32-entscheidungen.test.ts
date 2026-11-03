// Release 32 „Übersicht klar“, Befunde 1 + 3 (UX-Test 422): Klartext statt Markdown, passende Antwortknöpfe, eine Zahl mit Zusammensetzung.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { klartext, empfehlungAus } from '../server/klartext.ts';
import { baueInbox, inboxZahl, type InboxQuellen } from '../server/inbox.ts';
import { fragenAus, brauchtSumme } from '../server/entscheidungsseite.ts';

const leer: InboxQuellen = { karten: [], lose: [], vault: [], pflege: 0, schlange: [], kopfFehler: [] };
const now = Date.parse('2026-11-03T10:00:00Z');
const vf = (head: string, o: Record<string, unknown> = {}) => ({ path: 'olaf/x/offene-fragen.md', line: 82, hash: 'h', head, section: 'Braucht Knut', title: 'olaf — Roadmap: offene Fragen', topic: 'Anmeldestrecke', since: '2026-11-01', grund: 'geht nach außen', ...o });
const F38 = '**F38 Vertriebs-Adresse für B2B-Anfragen:** an welche Adresse geht die Anfrage-Mail — Johannes Griesbeck persönlich ([[johannes]]) oder ein Funktionspostfach? Die E-Mail-Adresse ist im Vault nicht dokumentiert. Empfehlung: Funktionspostfach.';
const F39 = '**F39 Annahme-Weg des B2B-Angebots:** Link mit Angebot in der Mail (Kunde nimmt online an) / Vertrieb ruft an, bestätigt mündlich / digitale Unterschrift? Empfehlung: Link mit Angebot.';

test('klartext: Sternchen, Backticks, Wikilinks und Listenpunkte verschwinden, der Satz bleibt vollständig', () => {
  assert.equal(klartext('**F38 Vertriebs-Adresse:** an welche Adresse geht die Mail — [[johannes]] oder `info@x.at`?'), 'F38 Vertriebs-Adresse: an welche Adresse geht die Mail — johannes oder info@x.at?');
  assert.equal(klartext('- [[a|Anna]] und [Link](https://x.at) __fett__ *kursiv*'), 'Anna und Link fett kursiv');
  assert.equal(klartext('2 * 3 = 6 und a*b'), '2 * 3 = 6 und a*b', 'ein einzelnes Sternchen im Rechenausdruck bleibt');
  assert.equal(klartext(null), '');
});

test('empfehlungAus: „Empfehlung: …“ aus dem Fragetext, bis zum Satzende', () => {
  assert.equal(empfehlungAus(klartext(F38)), 'Funktionspostfach');
  assert.equal(empfehlungAus('Soll das live? Keine Ahnung.'), null);
});

test('Vault-Frage: ganze Frage ohne Sternchen, Empfehlung gefunden, Wahl-/Freitextfrage ohne „Nein“', () => {
  const ib = baueInbox({ ...leer, vaultFragen: [vf(F38.slice(0, 66), { frage: F38 }), vf(F39, { line: 85 })] }, { now });
  const { fragen } = fragenAus(ib.eintraege);
  const f38 = fragen.find((f) => /F38/.test(f.titel))!;
  assert.ok(!/\*/.test(f38.titel + f38.worum), 'kein Markdown-Sternchen');
  assert.match(f38.titel + ' ' + f38.worum, /Johannes Griesbeck persönlich \(johannes\) oder ein Funktionspostfach\?/, 'Frage vollständig, nicht bei „—“ abgeschnitten');
  assert.equal(f38.empfehlung, 'Funktionspostfach');
  assert.equal(f38.form, 'frei');
  assert.ok(!f38.antworten.includes('nein'), 'Welche-Adresse-Frage: kein „Nein“');
  assert.ok(f38.antworten.includes('anders') && f38.antworten.includes('spaeter'));
  const f39 = fragen.find((f) => /F39/.test(f.titel))!;
  assert.equal(f39.form, 'frei'); assert.ok(!f39.antworten.includes('nein'));
});

test('Antwortform: Ja/Nein nur bei Ja/Nein-Fragen; Optionen werden zu Knöpfen; ohne Empfehlung kein blankes „Ja“ bei Wahlfragen', () => {
  const k = (id: string, ents: any[]) => ({ id, titel: `Strang ${id}`, strangTitel: `Strang ${id}`, thema: 'Flex', running: false, entscheidungen: ents, berichtHash: 'h', rueckfragen: [], braucht: null, kannFreigeben: false, freigabe: null, github: [], statusAt: new Date(now - 3600_000), chat: null, paket: '300-x' });
  const ib = baueInbox({ ...leer, karten: [k('a1', [
    { id: 'D1', frage: 'Darf der Hauptchat Korrektur-Pushes ohne Klick machen?', empfehlung: 'Ja', optionenListe: ['Ja', 'Nein'] },
    { id: 'D2', frage: 'Welches Modell für die Prüfung?', empfehlung: 'glm', optionenListe: ['glm', 'flash', 'sonnet'] },
    { id: 'D3', frage: 'Welche Frist nehmen wir?', empfehlung: null },
    { id: 'D4', frage: 'Tooltip zeigen?', empfehlung: null },
  ])] }, { now });
  const f = (kennung: string) => fragenAus(ib.eintraege).fragen.find((x) => x.kennung === kennung)!;
  assert.equal(f('D1').form, 'janein'); assert.deepEqual(f('D1').antworten, ['ja', 'nein', 'anders', 'spaeter']);
  assert.equal(f('D2').form, 'wahl'); assert.ok(!f('D2').antworten.includes('nein'));
  assert.deepEqual(f('D2').alternativen, ['flash', 'sonnet'], 'die nicht empfohlenen Optionen sind Knöpfe');
  assert.equal(f('D3').form, 'frei'); assert.deepEqual(f('D3').antworten, ['anders', 'spaeter'], 'ohne Empfehlung und ohne Optionen: Feld, kein Ja/Nein');
  assert.equal(f('D4').form, 'janein', 'Tooltip zeigen? bleibt Ja/Nein');
});

test('Eine Zahl: Heute + Offen + Sonstiges = inboxZahl; Hauptchat-Aufgaben zählen nirgends mit', () => {
  const ib = baueInbox({ ...leer, pflege: 2,
    karten: [{ id: 'a1', titel: 'S', strangTitel: 'S', thema: 'Flex', running: false, entscheidungen: [{ id: 'D1', frage: 'Soll X?', empfehlung: 'Ja' }, { id: 'D2', frage: 'Soll Y?', empfehlung: null }], berichtHash: 'h', rueckfragen: [], braucht: null, kannFreigeben: false, freigabe: null, github: [], statusAt: new Date(now - 3600_000), chat: null, paket: '300-x' } as any],
    lose: [{ id: 'q1', title: 'Nachtbau?', recommendation: 'Ja', options: [{ label: 'Ja' }, { label: 'Nein' }], createdAt: new Date(now - 7200_000) }],
    vaultFragen: [vf(F38.slice(0, 66), { frage: F38 })] }, { now });
  // eine Zeile als Hauptchat-Aufgabe markieren (klasse aktion) — zählt in inboxZahl nicht
  ib.eintraege.push({ id: 'b-x', art: 'braucht', frage: 'push', empfehlung: null, quelle: { text: 'S', strand: 's', url: null }, wartetSeit: null, blockiert: 0, antworten: ['anders'], daten: { klasse: 'aktion' }, stufe: 'normal', stufeGrund: '', autoAb: null } as any);
  const s = brauchtSumme(ib.eintraege, now);
  assert.equal(s.gesamt, inboxZahl(ib.eintraege), 'dieselbe Zahl wie Leiste, Kopf und Morgenlage');
  assert.equal(s.fang + s.heute + s.offen + s.sonstiges, s.gesamt);
  assert.equal(s.beimHauptchat, 1);
  assert.match(s.text, new RegExp(`^${s.gesamt} offen`), 'Text nennt die Zahl und ihre Teile');
  assert.match(s.text, /Sonstiges/);
});

import { zielText, optionAusAnders } from '../server/entscheidungsseite.ts';
import { frageEventText } from '../server/leitstand.ts';

test('Nachtrag A: die Bestätigung nennt das Ziel; ein Wahl-Knopf wird zur echten Option; langer Text kommt wörtlich beim Hauptchat an', () => {
  assert.equal(zielText({ art: 'braucht', quelle: { text: 'Unter-Chat „Kalender-Abgleich“', strand: 's', url: null }, daten: {} } as any), 'den Unter-Chat „Kalender-Abgleich“');
  assert.equal(zielText({ art: 'rueckfrage', quelle: { text: 'Hauptchat', strand: null, url: null }, daten: {} } as any), 'den Hauptchat');
  assert.equal(zielText({ art: 'entscheidung', quelle: { text: 'Bericht 500', strand: 's', url: null }, daten: { strangTitel: 'Bot v5' } } as any), 'den Unter-Chat „Bot v5“');
  assert.deepEqual(optionAusAnders(['flash', 'glm'], 'Anders: flash'), { option: 'flash', notiz: '' });
  assert.deepEqual(optionAusAnders(['flash', 'glm'], 'Anders: glm — weil schneller'), { option: 'glm', notiz: 'weil schneller' });
  assert.equal(optionAusAnders(['flash', 'glm'], 'Anders: sonnet'), null, 'unbekannte Option bleibt Freitext');
  assert.equal(optionAusAnders(['flash'], 'Lieber so'), null);
  const lang = 'x'.repeat(3000);
  const t = frageEventText({ _id: 'q1', title: 'Frist?', answer: { option: null, text: lang } });
  assert.ok(t.endsWith(lang), 'ganzer Wortlaut, nicht bei 600 abgeschnitten');
});

import { fangHierAn } from '../server/entscheidungsseite.ts';

const fr = (id: string, o: Record<string, unknown> = {}) => ({ id, eintrag: id, teil: null, art: 'rueckfrage', gruppe: 'Flex', kennung: null, titel: `Frage ${id}`, worum: '', optionen: [], alternativen: [], empfehlung: 'Ja', form: 'janein', stufe: 'normal', stufeGrund: null,
  autoAb: null, quelle: { text: 'Hauptchat', url: null }, wartetSeit: '2026-11-02T08:00:00Z', antworten: ['ja', 'nein', 'anders', 'spaeter'], blockiert: 0, ref: null, ...o }) as any;
const T = Date.parse('2026-11-03T10:00:00Z');

test('Fang hier an: höchstens 5, blockierende zuerst, dann Frist, dann Kund:innen; Hauptchat-Aufgaben nie', () => {
  const liste = [fr('a'), fr('kunde', { stufe: 'wichtig', stufeGrund: 'Außenwirkung' }), fr('frist', { autoAb: '2026-11-03T14:00:00Z' }), fr('block', { blockiert: 1, stufe: 'wichtig', stufeGrund: 'Push/Release/Merge' }), fr('aktion', { klasse: 'aktion', blockiert: 3 }),
    fr('b'), fr('c'), fr('d'), fr('e')];
  const f = fangHierAn(liste, T);
  assert.equal(f.length, 5);
  assert.deepEqual(f.slice(0, 3).map((x) => x.id), ['block', 'frist', 'kunde']);
  assert.ok(!f.some((x) => x.id === 'aktion'));
  assert.match(f[0].grund, /Unter-Chat/); assert.match(f[1].grund, /Frist|angenommen/i); assert.match(f[2].grund, /Kund/i);
  assert.deepEqual(fangHierAn(liste, T).map((x) => x.id), f.map((x) => x.id), 'stabil');
});

test('Fang hier an: nichts Dringendes → die ältesten offenen, nie mehr als 5; leere Liste → leer', () => {
  assert.deepEqual(fangHierAn([], T), []);
  const alt = Array.from({ length: 8 }, (_, i) => fr(`q${i}`, { wartetSeit: `2026-10-${20 + i}T08:00:00Z` }));
  const f = fangHierAn(alt, T);
  assert.equal(f.length, 5); assert.equal(f[0].id, 'q0', 'ältester zuerst');
});

test('Zahl: Fang hier an + Heute + Offen + Sonstiges = gesamt', () => {
  const ib = baueInbox({ ...leer, pflege: 1, lose: Array.from({ length: 9 }, (_, i) => ({ id: `q${i}`, title: `Frage ${i}?`, recommendation: 'Ja', options: [{ label: 'Ja' }, { label: 'Nein' }], createdAt: new Date(now - (i + 1) * 3600_000) })) }, { now });
  const s = brauchtSumme(ib.eintraege, now);
  assert.equal(s.fang, 5);
  assert.equal(s.fang + s.heute + s.offen + s.sonstiges, s.gesamt);
  assert.equal(s.gesamt, inboxZahl(ib.eintraege));
  assert.match(s.text, /5 Fang hier an/);
});
