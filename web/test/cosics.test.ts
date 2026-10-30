// Chief of Staff, Strang E (Paket 374): ICS-Feed — reine Funktion buildICS (RFC 5545: CRLF, Pflichtfelder,
// Escaping, All-Day) und die Empfehlung einer Budget-Zahl aus der Messung (D3). API-Tests (Token-Route,
// Schalter) stehen in api.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildICS, icsEsc, uidVon, budgetEmpfehlung } from '../server/cosics.ts';
import type { Register, Termin, Zusage } from '../server/cosregister.ts';

const termin = (t: Partial<Termin>): Termin => ({ zeile: 1, text: 'x', datum: '2026-10-23', zeit: '10:00', titel: 'Rogue: Vertrag', mit: ['Christoph'], ...t });

test('Escaping nach RFC 5545: Komma, Semikolon, Backslash, Zeilenumbruch', () => {
  assert.equal(icsEsc('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
  assert.equal(icsEsc('plain'), 'plain');
});

test('UID ist deterministisch (Quelle + Kennung), DTSTAMP aus dem Jetzt', () => {
  const a = uidVon('zusagen-register.md', 'Z-001'), b = uidVon('zusagen-register.md', 'Z-002');
  assert.match(a, /^cos-/); assert.notEqual(a, b);
  assert.equal(uidVon('zusagen-register.md', 'Z-001'), a);
  const jetzt = new Date('2026-10-26T12:00:00Z');
  const leer = buildICS({ termine: [], fristen: [], dtstamp: jetzt });
  assert.ok(leer.includes('END:VCALENDAR\r\n'), 'leerer Feed gültig');
  assert.match(leer, /BEGIN:VTIMEZONE\r\n/);
});

test('buildICS: Termin mit Zeit wird VEVENT mit DTSTART/DTEND (Europe/Vienna als TZID), ohne Zeit All-Day (VALUE=DATE)', () => {
  const jetzt = new Date('2026-10-26T06:00:00Z');
  const ics = buildICS({ termine: [termin({})], fristen: [], dtstamp: jetzt });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'), 'Kopf');
  assert.ok(ics.includes('VERSION:2.0\r\n'), 'Version');
  assert.ok(ics.includes('PRODID:-//Knut Werkbank//Chief of Staff//DE\r\n'), 'ProdID');
  assert.ok(ics.includes('CALSCALE:GREGORIAN\r\n'), 'Calscale');
  assert.ok(ics.includes('METHOD:PUBLISH\r\n'), 'Methode');
  assert.ok(ics.includes('X-WR-CALNAME:Chief of Staff Termine (Werkbank)'), 'Kalendername');
  assert.match(ics, /BEGIN:VEVENT\r\n/);
  assert.match(ics, /DTSTART;TZID=Europe\/Vienna:20261023T100000\r\n/);   // Ortszeit über die Zeitzone des Kalenders
  // DTEND kann gefaltet sein (75-Oktett-Grenze): Leerzeichen-Fortsetzung auflösen
  const flach = ics.replace(/\r\n /g, '');
  assert.match(flach, /DTEND;TZID=Europe\/Vienna:20261023T110000\r\n/);   // Termin mit Uhrzeit: eine Stunde
  assert.match(flach, /SUMMARY:Rogue: Vertrag\r\n/);
  assert.match(flach, /DESCRIPTION:mit: Christoph\r\n/);
  assert.match(ics, /UID:cos-[0-9a-f]{16}\r\n/);
  assert.match(ics, /END:VEVENT\r\n/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
  const tag = buildICS({ termine: [termin({ zeit: null })], fristen: [], dtstamp: jetzt });
  assert.match(tag, /DTSTART;VALUE=DATE:20261023\r\n/);
  assert.ok(!/DTEND/.test(tag), 'All-Day ohne DTEND (RFC 5545 erlaubt das für DATE)');
});

test('buildICS: Fristen aus Zusagen werden All-Day-Events; ohne bis und erledigt fallen weg', () => {
  const jetzt = new Date('2026-10-26T06:00:00Z');
  const z = (id: string, was: string, bis: string | null, abschnitt: string): Zusage =>
    ({ id, wer: 'Christoph Bitzner', an: 'Knut', was, bis, fristUnklar: false, notizen: [], abschnitt, zeile: 1 } as Zusage);
  const ics = buildICS({
    termine: [], fristen: [
      z('Z-001', 'Belieferungsstatus in den Report', '2026-10-23', 'offen'),
      z('Z-002', 'ohne Frist', null, 'offen'),
      z('Z-003', 'schon erledigt', '2026-10-23', 'erledigt'),
      z('Z-004', 'Frist unklar', null, 'offen'),
    ], dtstamp: jetzt,
  });
  const flach = ics.replace(/\r\n /g, '');   // Falten auflösen, dann prüfen
  assert.match(flach, /SUMMARY:Frist Z-001: Belieferungsstatus in den Report \(Christoph Bitzner → Knut\)/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261023\r\n/);
  assert.ok(!ics.includes('Z-002'), 'ohne bis kein Event');
  assert.ok(!ics.includes('Z-003'), 'erledigt kein Event');
  assert.ok(!ics.includes('Z-004'), 'Frist unklar kein Event');
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 1);
});

test('buildICS: Summary und Description werden escapet (Komma, Zeilenumbruch)', () => {
  const jetzt = new Date('2026-10-26T06:00:00Z');
  const ics = buildICS({ termine: [termin({ titel: 'Roge, du; ich\\ du', mit: ['A', 'B'] })], fristen: [], dtstamp: jetzt });
  assert.ok(ics.includes('SUMMARY:Roge\\, du\\; i'), 'Komma und Semikolon escapet');
  assert.ok(ics.includes('h\\\\ du'), 'Backslash escapet');
  assert.ok(ics.includes('DESCRIPTION:mit: A\\, B\r\n'), 'mit-Liste escapet');
});

test('buildICS: lange Zeilen werden nach 75 Oktetten gefaltet (RFC 5545)', () => {
  const jetzt = new Date('2026-10-26T06:00:00Z');
  const lang = 'Ein sehr langer Titel. '.repeat(12);
  const ics = buildICS({ termine: [termin({ titel: lang })], fristen: [], dtstamp: jetzt });
  const zeilen = ics.split('\r\n');
  for (const z of zeilen) assert.ok(Buffer.byteLength(z, 'utf8') <= 75, `Zeile zu lang (${Buffer.byteLength(z, 'utf8')}): ${z.slice(0, 40)}…`);
});

test('buildICS: Termine ohne Datum und unbekannte Quellen fallen weg, Duplikate (gleiche UID) bleiben', () => {
  const jetzt = new Date('2026-10-26T06:00:00Z');
  const ics = buildICS({ termine: [termin({ datum: null })], fristen: [], dtstamp: jetzt });
  assert.ok(!/BEGIN:VEVENT/.test(ics));
});

test('buildICS: 23:00-Termin endet am Folgetag 00:00 (kein T240000, Pass C)', () => {
  const jetzt = new Date('2026-10-26T06:00:00Z');
  const ics = buildICS({ termine: [termin({ datum: '2026-10-23', zeit: '23:00' }), termin({ datum: '2026-12-31', zeit: '23:30' })], fristen: [], dtstamp: jetzt });
  const flach = ics.replace(/\r\n /g, '');
  assert.match(flach, /DTSTART;TZID=Europe\/Vienna:20261023T230000\r\n/);
  assert.match(flach, /DTEND;TZID=Europe\/Vienna:20261024T000000\r\n/, '23:00 → Folgetag 00:00');
  assert.match(flach, /DTSTART;TZID=Europe\/Vienna:20261231T233000\r\n/);
  assert.match(flach, /DTEND;TZID=Europe\/Vienna:20270101T003000\r\n/, 'Silvester 23:30 → Neujahr 00:30, auch über Jahresgrenze');
  assert.ok(!flach.includes('T2400'), 'T240000 kommt nie vor');
});

test('buildICS: Zeitzone wird als VTIMEZONE ausgeliefert (Europe/Vienna, Sommer- und Winterzeit)', () => {
  const jetzt = new Date('2026-10-26T06:00:00Z');
  const ics = buildICS({ termine: [termin({})], fristen: [], dtstamp: jetzt });
  assert.match(ics, /BEGIN:VTIMEZONE\r\nTZID:Europe\/Vienna\r\n/);
  assert.match(ics, /TZNAME:CET\r\n/);
  assert.match(ics, /TZNAME:CEST\r\n/);
  assert.match(ics, /END:VTIMEZONE\r\n/);
  // Termin mit Uhrzeit bezieht sich auf die Zeitzone
  assert.match(ics, /DTSTART;TZID=Europe\/Vienna:20261023T100000\r\n/);
});

test('D3: Budget-Empfehlung aus der Messung — Median der Stränge, x2, auf 50k gerundet; ohne Messung null', () => {
  assert.equal(budgetEmpfehlung([]), null);
  assert.equal(budgetEmpfehlung([{ conv: 'a', tokens: 100_000 }]), 200_000);
  assert.equal(budgetEmpfehlung([{ conv: 'a', tokens: 100_000 }, { conv: 'b', tokens: 300_000 }, { conv: 'c', tokens: 500_000 }]), 600_000);   // Median 300k x2
  assert.equal(budgetEmpfehlung([{ conv: 'a', tokens: 61_000 }, { conv: 'b', tokens: 62_000 }]), 150_000);   // Median 61,5k x2 = 123k → auf 50k gerundet
  assert.equal(budgetEmpfehlung([{ conv: 'a', tokens: 12_000 }]), 50_000);   // Minimum
});

// Register-Typ nur für die Signatur (buildICS nimmt die fertig geparsten Listen).
const _ = (r: Register) => r;
