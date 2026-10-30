// Chief of Staff, Strang E (Paket 374): Termine und Fristen als abonnierbarer ICS-Feed (RFC 5545). Der Feed
// hängt nicht an M365 (Plan 209, E1): Termine kommen aus dem Abschnitt „## Termine“ des Zusagen-Registers,
// offene Zusagen mit `bis` werden zu Frist-Events (All-Day). Ohne Uhrzeit ist ein Termin ganztägig; mit
// Uhrzeit gilt Europe/Vienna (als VTIMEZONE, DTSTART floating mit TZID — Outlook und Apple lesen das).
// UIDs sind deterministisch aus Quelle + Kennung: ein Kalender, der denselben Feed neu lädt, verschiebt
// die Events nicht. Alles rein und deterministisch — Route und Token in cosroutes.ts.

import { createHash } from 'node:crypto';
import type { Termin, Zusage } from './cosregister.ts';

export const ICS_AN = () => (process.env.COS_ICS ?? 'aus') === 'an';

/** RFC 5545 §3.3.11: Text escapen — Semikolon, Komma, Backslash, Zeilenumbruch. */
export const icsEsc = (s: string) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Zeilen nach 75 Oktetten falten (RFC 5545 §3.1): Fortsetzung mit einem Leerzeichen, nie mitten in einem UTF-8-Zeichen. */
function falte(zeile: string): string {
  const b = Buffer.from(zeile, 'utf8');
  if (b.length <= 75) return zeile;
  const out: string[] = [];
  let pos = 0;
  while (pos < b.length) {
    let n = Math.min(out.length === 0 ? 75 : 74, b.length - pos);   // Fortsetzungs-Leerzeichen zählt mit
    while (pos + n < b.length && (b[pos + n] & 0xc0) === 0x80) n--;  // nicht in ein UTF-8-Zeichen schneiden
    if (n <= 0) n = Math.min(out.length === 0 ? 75 : 74, b.length - pos);
    out.push((out.length === 0 ? '' : ' ') + b.subarray(pos, pos + n).toString('utf8'));
    pos += n;
  }
  return out.join('\r\n');
}

/** DTSTAMP: UTC nach RFC 5545 (JJJJMMTTTHHMMSSZ), aus einem festen Datum (Testbarkeit). */
export const dtstampVon = (d = new Date()) => `${d.toISOString().slice(0, 4)}${d.toISOString().slice(5, 7)}${d.toISOString().slice(8, 10)}T${d.toISOString().slice(11, 13)}${d.toISOString().slice(14, 16)}${d.toISOString().slice(17, 19)}Z`;

/** UID deterministisch aus Quelle und Kennung — neu laden verschiebt nichts. */
export const uidVon = (quelle: string, kennung: string) => `cos-${createHash('sha256').update(`${quelle}#${kennung}`).digest('hex').slice(0, 16)}`;

const datum8 = (iso: string) => iso.replace(/-/g, '');

// Europe/Vienna: CET (UTC+1) im Winter, CEST (UTC+2) im Sommer — Übergänge 2026 (letzter Sonntag im März / Oktober).
const VTIMEZONE = [
  'BEGIN:VTIMEZONE', 'TZID:Europe/Vienna',
  'BEGIN:STANDARD', 'DTSTART:19701025T030000', 'TZOFFSETFROM:+0200', 'TZOFFSETTO:+0100', 'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU', 'TZNAME:CET', 'END:STANDARD',
  'BEGIN:DAYLIGHT', 'DTSTART:19700329T020000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+0200', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU', 'TZNAME:CEST', 'END:DAYLIGHT',
  'END:VTIMEZONE',
];

export interface IcsInput { termine: Termin[]; fristen: Zusage[]; dtstamp?: Date }

/** Der ganze Feed als Text (CRLF-Zeilen). Reihenfolge: Termine, dann Fristen — beide chronologisch. */
export function buildICS(i: IcsInput): string {
  const stamp = dtstampVon(i.dtstamp);
  const events: { datum: string; zeit: string | null; zeilen: string[] }[] = [];
  for (const t of i.termine) {
    if (!t.datum) continue;
    const zeit = t.zeit && /^\d{2}:\d{2}$/.test(t.zeit) ? t.zeit : null;
    // Jede Zeile einzeln im Array — \r\n gehört nur zwischen fertige Zeilen (Pass C: eingebettetes CRLF in einer
    // „Zeile“ würde von falte() als eine logische Zeile gefaltet und das ICS unbrauchbar machen).
    const dt = zeit
      ? [`DTSTART;TZID=Europe/Vienna:${datum8(t.datum)}T${zeit.replace(':', '')}00`, `DTEND;TZID=Europe/Vienna:${plusStunde(t.datum, zeit)}`]
      : [`DTSTART;VALUE=DATE:${datum8(t.datum)}`];
    events.push({ datum: t.datum, zeit, zeilen: [
      'BEGIN:VEVENT', `UID:${uidVon('zusagen-register.md#termine', `${t.zeile}`)}`, `DTSTAMP:${stamp}`, ...dt,
      `SUMMARY:${icsEsc(t.titel || t.text)}`,
      ...(t.mit.length ? [`DESCRIPTION:${icsEsc(`mit: ${t.mit.join(', ')}`)}`] : []),
      'TRANSP:TRANSPARENT',   // Termine/Listen, die den Tag nicht blockieren
      'END:VEVENT',
    ] });
  }
  for (const z of i.fristen) {
    if (z.abschnitt !== 'offen' || !z.bis || z.fristUnklar) continue;
    events.push({ datum: z.bis, zeit: null, zeilen: [
      'BEGIN:VEVENT', `UID:${uidVon('zusagen-register.md', z.id)}`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${datum8(z.bis)}`,
      `SUMMARY:${icsEsc(`Frist ${z.id}: ${z.was} (${z.wer ?? 'Wer: offen'} → ${z.an})`)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    ] });
  }
  events.sort((a, b) => a.datum.localeCompare(b.datum) || String(a.zeit ?? '').localeCompare(String(b.zeit ?? '')));
  const kopf = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Knut Werkbank//Chief of Staff//DE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Chief of Staff Termine (Werkbank)', 'X-PUBLISHED-TTL:PT1H',   // Outlook: je Stunde neu laden
    ...VTIMEZONE];
  return [...kopf, ...events.flatMap((e) => e.zeilen), 'END:VCALENDAR'].map(falte).join('\r\n') + '\r\n';
}

/** „10:00“ + 1 h → Ende am selben Tag; 23:xx endet am Folgetag 00:xx (T240000 wäre ungültig, Pass C). */
const plusStunde = (datum: string, zeit: string) => {
  const h = Number(zeit.slice(0, 2)), m = zeit.slice(3);
  if (h < 23) return `${datum8(datum)}T${String(h + 1).padStart(2, '0')}${m}00`;
  const naechster = new Date(datum + 'T12:00:00Z');
  naechster.setUTCDate(naechster.getUTCDate() + 1);
  return `${naechster.toISOString().slice(0, 4)}${naechster.toISOString().slice(5, 7)}${naechster.toISOString().slice(8, 10)}T00${m}00`;
};

// ---------- D3: Budget-Zahl aus der Messung (Empfehlung für die Wochendurchsicht) ----------

/** Median der Token je Strang × 2, auf 50.000 aufgerundet (mindestens 50k). Ohne Messung null. */
export function budgetEmpfehlung(teuerste: { conv: string; tokens: number }[]): number | null {
  if (!teuerste.length) return null;
  const xs = teuerste.map((t) => t.tokens).sort((a, b) => a - b);
  const mitte = Math.floor(xs.length / 2);
  const median = xs.length % 2 ? xs[mitte] : Math.round((xs[mitte - 1] + xs[mitte]) / 2);
  return Math.max(50_000, Math.ceil((median * 2) / 50_000) * 50_000);
}
