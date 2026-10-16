// Chief of Staff, S1.3 Meeting-Triage aus Vexa (docs/plan-chief-of-staff.md; K4, K12, K13, K14, K15, K21).
// Liest Meeting-Notizen des Notetakers (`sources: ["Vexa meeting_id N"]`, `status: draft`, Abschnitte `## Decisions` und `## Action Items`),
// schlägt Zusagen und Entscheidungen vor und trägt sie nach Knuts Ja ein. Der Vault wird nur hier in drei Fällen geschrieben: Register (über
// cosregister), Abschnitt `## Triage` + Status der Notiz (gezielte Zeilen), nie das Transkript. Keine Jira-Schreibzugriffe.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from './vault.ts';
import { addTage, tageZwischen } from './cos.ts';
import { hashText, feld, CosError, schreibeZusagen, parseRegister, registerRel, wienDatum, type ZNeu, type SchreibOpts } from './cosregister.ts';
import { writeAtomic, syncLocked } from './roadmapauto.ts';

// ---------- Fristen (K15) ----------

const WOCHENTAGE: Record<string, number> = { sonntag: 0, so: 0, montag: 1, mo: 1, dienstag: 2, di: 2, mittwoch: 3, mi: 3, donnerstag: 4, do: 4, freitag: 5, fr: 5, samstag: 6, sa: 6 };
const MONATE: Record<string, number> = { januar: 1, jaenner: 1, jänner: 1, februar: 2, maerz: 3, märz: 3, april: 4, mai: 5, juni: 6, juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12 };
const norm = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
const wtVon = (datum: string) => new Date(datum + 'T12:00:00Z').getUTCDay();
const pad = (n: number) => String(n).padStart(2, '0');
const gueltig = (j: number, m: number, d: number) => { const t = new Date(Date.UTC(j, m - 1, d)); return t.getUTCFullYear() === j && t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };

/** Freitag der ISO-Woche `kw` des Jahres `jahr`. */
function freitagDerKw(jahr: number, kw: number): string {
  const jan4 = new Date(Date.UTC(jahr, 0, 4));
  const montag1 = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86_400_000);
  return new Date(montag1.getTime() + ((kw - 1) * 7 + 4) * 86_400_000).toISOString().slice(0, 10);
}
const kwVon = (datum: string) => { const d = new Date(datum + 'T12:00:00Z'); const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const tag = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - tag + 3); const j = t.getUTCFullYear(); const e = new Date(Date.UTC(j, 0, 4)); return { jahr: j, kw: 1 + Math.round(((+t - +e) / 86_400_000 - 3 + ((e.getUTCDay() + 6) % 7)) / 7) }; };

/** Frist aus einem Text, relativ zum Meeting-Datum. Unklar → { bis: null, unklar: true } — nichts wird geraten. */
export function frist(text: string, meetingDatum: string | null): { bis: string | null; unklar: boolean } {
  const UNKLAR = { bis: null, unklar: true };
  if (!meetingDatum || !/^\d{4}-\d{2}-\d{2}$/.test(meetingDatum)) return UNKLAR;
  const t = norm(text);
  const [jahr, monat] = [Number(meetingDatum.slice(0, 4)), Number(meetingDatum.slice(5, 7))];
  let m: RegExpExecArray | null;
  // Spannen („in zwei bis drei Wochen“) sind nie eindeutig
  if (/\b(\d+|ein|zwei|drei|vier)\s+bis\s+(\d+|ein|zwei|drei|vier)\s+(wochen|tage|monate)/.test(t)) return UNKLAR;
  // bis 23.10. / bis 23.10.2026 / am 23.10.
  if ((m = /\b(?:bis|spaetestens|am|ab dem)\s+(?:zum\s+)?(\d{1,2})\.(\d{1,2})\.(?:(\d{4}))?/.exec(t))) {
    const tag = Number(m[1]), mon = Number(m[2]);
    let j = m[3] ? Number(m[3]) : jahr;
    if (!m[3] && mon < monat - 6) j += 1;   // Jahreswechsel: „bis 15.01.“ im Dezember
    return gueltig(j, mon, tag) ? { bis: `${j}-${pad(mon)}-${pad(tag)}`, unklar: false } : UNKLAR;
  }
  // KW 44 / bis KW44
  if ((m = /\bkw\s*(\d{1,2})\b/.exec(t))) {
    const kw = Number(m[1]);
    if (kw < 1 || kw > 53) return UNKLAR;
    const akt = kwVon(meetingDatum);
    const j = kw + 26 < akt.kw ? akt.jahr + 1 : akt.jahr;   // Jahreswechsel: KW 2 im Dezember
    return { bis: freitagDerKw(j, kw), unklar: false };
  }
  // heute / morgen / übermorgen
  if (/\bbis\s+heute\b/.test(t)) return { bis: meetingDatum, unklar: false };
  if (/\bbis\s+morgen\b/.test(t)) return { bis: addTage(meetingDatum, 1), unklar: false };
  if (/\bbis\s+uebermorgen\b/.test(t)) return { bis: addTage(meetingDatum, 2), unklar: false };
  // bis Freitag / bis Mo
  if ((m = /\bbis\s+(?:zum\s+|kommenden\s+|naechsten\s+)?(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|mo|di|mi|do|fr)\b/.exec(t))) {
    const ziel = WOCHENTAGE[m[1]];
    let diff = (ziel - wtVon(meetingDatum) + 7) % 7;
    if (diff === 0) diff = 7;
    return { bis: addTage(meetingDatum, diff), unklar: false };
  }
  // nächste Woche / bis Ende der Woche / diese Woche
  const fr = (datum: string) => addTage(datum, (5 - wtVon(datum) + 7) % 7);
  if (/\b(naechste|kommende)\s+woche\b/.test(t) && !/\bnaechste(n)?\s+(zwei|drei|\d)/.test(t)) return { bis: addTage(fr(meetingDatum), wtVon(meetingDatum) >= 1 && wtVon(meetingDatum) <= 5 ? 7 : 0), unklar: false };
  if (/\b(ende\s+der\s+woche|diese\s+woche|bis\s+ende\s+woche)\b/.test(t)) return { bis: fr(meetingDatum), unklar: false };
  // in 2 Wochen / in drei Tagen
  if ((m = /\bin\s+(\d+|einer|ein|zwei|drei|vier)\s+(woche|wochen|tag|tagen)\b/.exec(t))) {
    const z: Record<string, number> = { einer: 1, ein: 1, zwei: 2, drei: 3, vier: 4 };
    const n = z[m[1]] ?? Number(m[1]);
    return { bis: addTage(meetingDatum, /woch/.test(m[2]) ? n * 7 : n), unklar: false };
  }
  // bis Ende Oktober
  if ((m = /\bbis\s+ende\s+(januar|jaenner|februar|maerz|april|mai|juni|juli|august|september|oktober|november|dezember)\b/.exec(t))) {
    const mon = MONATE[m[1]];
    const j = mon < monat - 6 ? jahr + 1 : jahr;
    return { bis: addTage(`${mon === 12 ? j + 1 : j}-${pad(mon === 12 ? 1 : mon + 1)}-01`, -1), unklar: false };
  }
  return UNKLAR;
}

// ---------- Vexa-Notiz lesen (K12, K13) ----------

export interface Kandidat { wer: string | null; was: string; bis: string | null; fristUnklar: boolean }
export interface MeetingTriage {
  datei: string; name: string; titel: string; datum: string | null; status: string; vexa: boolean; hatTriage: boolean;
  aktionen: Kandidat[]; entscheidungen: string[]; teilnehmer: string[]; hash: string;
}

const LEERFORMEL = /^(keine|kein|nichts|n\/a|-|–|—|keine\s+formalen?|es\s+wurden\s+keine|none)\b/i;

function abschnitt(body: string, titel: RegExp): string[] | null {
  const ls = body.split('\n');
  const i = ls.findIndex((l) => /^##\s/.test(l) && titel.test(l.replace(/^##\s+/, '')));
  if (i < 0) return null;
  const out: string[] = [];
  for (let k = i + 1; k < ls.length; k++) { if (/^##\s/.test(ls[k])) break; out.push(ls[k]); }
  return out;
}

export function liesMeeting(datei: string, text: string): MeetingTriage {
  const { fm, body } = parseFrontmatter(text);
  const name = datei.replace(/^.*\//, '').replace(/\.md$/, '');
  const datum = fm['meeting-date'] ? String(fm['meeting-date']).slice(0, 10) : (/^(\d{4}-\d{2}-\d{2})-/.exec(name)?.[1] ?? null);
  const sources = Array.isArray(fm.sources) ? fm.sources.map(String) : [];
  const aktionen: Kandidat[] = [];
  for (const l of abschnitt(body, /^Action Items\b/i) ?? []) {
    const m = /^\s*[-*]\s+\[ \]\s+(.*\S)\s*$/.exec(l);
    if (!m) continue;
    let was = m[1], wer: string | null = null;
    const n = /^\*\*([^*]+?):?\*\*:?\s*(.*)$/.exec(was);
    if (n) { wer = feld(n[1]).replace(/:$/, '') || null; was = n[2]; }
    const f = frist(was, datum);
    const w = feld(was);
    if (w) aktionen.push({ wer, was: w, bis: f.bis, fristUnklar: f.unklar });
  }
  // K13: maßgeblich ist das Frontmatter `decisions:`, sonst der Abschnitt ohne Leerformeln („Keine formalen Entscheidungen.“)
  let entscheidungen: string[];
  if (Array.isArray(fm.decisions) && fm.decisions.length) entscheidungen = fm.decisions.map((x) => feld(typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean);
  else {
    const zeilen = (abschnitt(body, /^Decisions\b|^Entscheidungen\b/i) ?? []).map((l) => l.replace(/^\s*[-*]\s+(\[[ x]\]\s+)?/, '').trim()).filter(Boolean);
    entscheidungen = zeilen.filter((z) => !LEERFORMEL.test(z)).map(feld);
  }
  return {
    datei, name, titel: String(fm.title ?? name), datum, status: String(fm.status ?? ''), vexa: sources.some((s) => /vexa/i.test(s)), hatTriage: /^##\s+Triage\b/m.test(body),
    aktionen, entscheidungen, teilnehmer: Array.isArray(fm.attendees) ? fm.attendees.map(String) : [], hash: hashText(text),
  };
}

// ---------- Vorschläge ----------

export const meetingTeams = () => (process.env.COS_MEETING_TEAMS || 'olaf').split(',').map((s) => s.trim()).filter((s) => /^[a-z0-9_-]+$/i.test(s));
export const TAGE_VORSCHLAG = 14;

export interface Vorschlag { id: string; datei: string; titel: string; zusagen: number; entscheidungen: number; datum: string | null }

/** Vexa-Entwürfe der letzten 14 Tage ohne `## Triage` mit mindestens einem Punkt; ältere nur als Zahl (K4). */
export function vorschlaege(vaultDir: string, teams: string[], heute: string, versteckt: Set<string>): { items: Vorschlag[]; aelter: number; ohnePunkte: number } {
  const items: Vorschlag[] = [];
  let aelter = 0, ohnePunkte = 0;
  for (const t of teams) {
    const dir = join(vaultDir, t, 'Meetings');
    let files: string[] = [];
    try { files = readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { continue; }
    for (const f of files) {
      const rel = `${t}/Meetings/${f}`;
      let text: string;
      try { if (!statSync(join(dir, f)).isFile()) continue; text = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
      if (!/^status:\s*draft\b/m.test(text.slice(0, 1500)) || !/vexa/i.test(text.slice(0, 2000))) continue;
      const m = liesMeeting(rel, text);
      if (!m.vexa || m.status !== 'draft' || m.hatTriage || versteckt.has(rel)) continue;
      if (m.datum && tageZwischen(m.datum, heute) < 0) continue;   // liegt noch in der Zukunft
      if (!m.datum || tageZwischen(m.datum, heute) > TAGE_VORSCHLAG) { aelter++; continue; }
      if (!m.aktionen.length && !m.entscheidungen.length) { ohnePunkte++; continue; }
      items.push({ id: `tri:${rel}`, datei: rel, titel: m.titel, zusagen: m.aktionen.length, entscheidungen: m.entscheidungen.length, datum: m.datum });
    }
  }
  items.sort((a, b) => String(b.datum).localeCompare(String(a.datum)));
  return { items, aelter, ohnePunkte };
}

// ---------- Übernehmen (Vorschau → Bestätigung) ----------

export function pruefeDatei(datei: string, teams: string[]): string {
  const m = /^([a-z0-9_-]+)\/Meetings\/([^/]+\.md)$/i.exec(String(datei ?? ''));
  if (!m || !teams.includes(m[1]) || m[2].includes('..')) throw new CosError(400, 'Nur Meeting-Notizen der freigegebenen Teams.');
  return datei;
}

const kurzDatum = (heute: string) => `${heute.slice(8, 10)}.${heute.slice(5, 7)}.`;

/** Triage-Abschnitt: je Punkt das Ziel (Z-Kennung oder „bewusst kein Jira“). */
export function triageAbschnitt(heute: string, aktionen: { k: Kandidat; ziel: string }[], entscheidungen: string[]): string {
  const z = [`## Triage (Werkbank, ${kurzDatum(heute)})`, ''];
  for (const a of aktionen) z.push(`- ${a.k.wer ? a.k.wer + ': ' : ''}${a.k.was} → ${a.ziel}; bewusst kein Jira`);
  for (const e of entscheidungen) z.push(`- Entscheidung: ${e} → ADR offen (im Chat entwerfen)`);
  return z.join('\n') + '\n';
}

/** Frontmatter `status: draft` → `archived`, sonst nichts. */
export function archiviert(text: string): string | null {
  const m = /^(---\r?\n[\s\S]*?\r?\n)status:\s*draft(\s*\r?\n)/.exec(text);
  if (!m) return null;
  return text.replace(/^(---\r?\n[\s\S]*?\r?\n)status:\s*draft(\s*\r?\n)/, '$1status: archived$2');
}

export function haengeTriageAn(text: string, abschnittText: string): string {
  const e = text.includes('\r\n') ? '\r\n' : '\n';
  const basis = text.endsWith('\n') ? text : text + e;
  return basis + e + abschnittText.replace(/\n/g, e);
}

export interface TriageOpts extends SchreibOpts { teams: string[]; registerHash?: string }

export async function triageUebernehmen(datei: string, o: TriageOpts): Promise<any> {
  pruefeDatei(datei, o.teams);
  const abs = join(o.vaultDir, datei);
  if (!existsSync(abs)) throw new CosError(404, 'Notiz nicht gefunden.');
  const text = readFileSync(abs, 'utf8');
  const m = liesMeeting(datei, text);
  if (!m.vexa || m.status !== 'draft') throw new CosError(409, 'Die Notiz ist kein offener Notetaker-Entwurf mehr.');
  if (m.hatTriage) throw new CosError(409, 'Diese Notiz ist schon triagiert.');
  if (!m.aktionen.length && !m.entscheidungen.length) throw new CosError(400, 'Nichts zu übernehmen.');
  const heute = o.heute ?? wienDatum();
  const regPfad = join(o.vaultDir, registerRel('zusagen'));
  const regText = existsSync(regPfad) ? readFileSync(regPfad, 'utf8') : '';
  const bereits = parseRegister(regText).zusagen.filter((z) => z.quelle?.includes(`[[${m.name}]]`));
  const neu: ZNeu[] = m.aktionen.filter((a) => !bereits.some((z) => z.was === a.was)).map((a) => ({ art: 'neu', wer: a.wer, an: 'Knut', was: a.was, bis: a.bis, fristUnklar: a.fristUnklar, quelle: `[[${m.name}]]` }));
  const archivieren = m.entscheidungen.length === 0;
  const hashes = { hash: m.hash, registerHash: hashText(regText) };
  const aenderungen = [
    ...neu.map((n) => `Register: ${n.wer || 'Wer: offen'} → Knut: ${n.was}${n.bis ? ` · bis ${n.bis}` : ' · Frist unklar'}`),
    ...(bereits.length ? [`Register: ${bereits.length} Zusage(n) stehen schon dort (${bereits.map((b) => b.id).join(', ')}) — nicht doppelt`] : []),
    `Notiz: Abschnitt „## Triage (Werkbank, ${kurzDatum(heute)})“ mit dem Ziel je Punkt wird angehängt`,
    archivieren ? 'Notiz: Status draft → archived' : `Notiz: Status bleibt draft — ${m.entscheidungen.length} Entscheidung(en) werden im Vault zu ADRs (im Chat entwerfen)`,
  ];
  if (!o.confirm) return { needsConfirm: true, datei, aenderungen, ...hashes };
  if ((o.locked ?? (() => syncLocked()))()) throw new CosError(409, 'Vault-Sync läuft gerade — bitte gleich noch einmal bestätigen.');
  if (o.hash !== hashes.hash) throw new CosError(409, 'Die Notiz wurde inzwischen geändert — bitte die Vorschau neu laden.');
  if (o.registerHash != null && o.registerHash !== hashes.registerHash) throw new CosError(409, 'Das Register wurde inzwischen geändert — bitte die Vorschau neu laden.');
  // 1. Register (Warteschlange, Hash und Sperre prüft die Pipeline erneut)
  const reg: any = neu.length ? await schreibeZusagen(neu, { ...o, confirm: true, hash: o.registerHash }) : { ids: [], zeilen: [] };
  const ids: string[] = reg.ids ?? [];
  // 2. Notiz: Abschnitt anhängen, danach Status — unmittelbar vorher Hash erneut prüfen
  const ziele = m.aktionen.map((a) => { const n = neu.findIndex((x) => x.was === a.was); const id = n >= 0 ? ids[n] : bereits.find((b) => b.was === a.was)?.id; return { k: a, ziel: id ? `${id} (Register)` : 'Register' }; });
  let neuText = haengeTriageAn(text, triageAbschnitt(heute, ziele, m.entscheidungen));
  if (archivieren) neuText = archiviert(neuText) ?? neuText;
  if (hashText(readFileSync(abs, 'utf8')) !== m.hash) throw new CosError(409, `Die Notiz wurde währenddessen geändert. Die Zusagen stehen schon im Register (${ids.join(', ') || 'keine neuen'}) — bitte die Notiz von Hand abschließen.`);
  if (!o.dry) { writeAtomic(abs, neuText); o.danach?.(); }
  return { ok: true, dry: !!o.dry, datei, ids, archiviert: archivieren, entscheidungen: m.entscheidungen.length };
}

// ---------- Rückstau aufräumen (K14, K21): ältere Entwürfe ohne Action Items sammelweise archivieren ----------

export interface RueckstauItem { datei: string; titel: string; datum: string | null; hash: string }

/** Notetaker-Entwürfe, die älter als 14 Tage sind, weder Action Items noch Entscheidungen haben und nicht triagiert sind. */
export function rueckstau(vaultDir: string, teams: string[], heute: string): RueckstauItem[] {
  const out: RueckstauItem[] = [];
  for (const t of teams) {
    const dir = join(vaultDir, t, 'Meetings');
    let files: string[] = [];
    try { files = readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { continue; }
    for (const f of files) {
      const rel = `${t}/Meetings/${f}`;
      let text: string;
      try { if (!statSync(join(dir, f)).isFile()) continue; text = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
      if (!/^status:\s*draft\b/m.test(text.slice(0, 1500)) || !/vexa/i.test(text.slice(0, 2000))) continue;
      const m = liesMeeting(rel, text);
      if (!m.vexa || m.status !== 'draft' || m.hatTriage || m.aktionen.length || m.entscheidungen.length) continue;
      if (!m.datum || tageZwischen(m.datum, heute) <= TAGE_VORSCHLAG) continue;
      out.push({ datei: rel, titel: m.titel, datum: m.datum, hash: m.hash });
    }
  }
  return out.sort((a, b) => String(b.datum).localeCompare(String(a.datum)));
}

export interface ArchivStore { put: (datei: string, doc: any) => Promise<void>; get: (datei: string) => Promise<any | null>; del: (datei: string) => Promise<void> }
export const RUECKGAENGIG_TAGE = 7;

export async function archiviereRueckstau(dateien: string[], o: { vaultDir: string; teams: string[]; heute: string; jetzt?: Date; confirm?: boolean; hashes?: Record<string, string>; dry?: boolean; locked?: () => boolean; store: ArchivStore; danach?: () => void }): Promise<any> {
  if (!Array.isArray(dateien) || !dateien.length) throw new CosError(400, 'Keine Notiz ausgewählt.');
  if (dateien.length > 200) throw new CosError(400, 'Höchstens 200 Notizen je Durchgang.');
  const erlaubt = new Map(rueckstau(o.vaultDir, o.teams, o.heute).map((x) => [x.datei, x]));
  const auswahl = dateien.map((d) => { pruefeDatei(d, o.teams); const x = erlaubt.get(d); if (!x) throw new CosError(409, `${d} gehört nicht (mehr) zum Rückstau — Vorschau neu laden.`); return x; });
  if (!o.confirm) return { needsConfirm: true, notizen: auswahl, aenderung: 'Status draft → archived (je Notiz, rückgängig 7 Tage)' };
  if ((o.locked ?? (() => syncLocked()))()) throw new CosError(409, 'Vault-Sync läuft gerade — bitte gleich noch einmal bestätigen.');
  for (const x of auswahl) if (o.hashes?.[x.datei] !== x.hash) throw new CosError(409, `${x.datei} wurde inzwischen geändert — Vorschau neu laden.`);
  const fertig: string[] = [];
  for (const x of auswahl) {
    const abs = join(o.vaultDir, x.datei);
    const alt = readFileSync(abs, 'utf8');
    if (hashText(alt) !== x.hash) throw new CosError(409, `${x.datei} wurde inzwischen geändert — ${fertig.length} Notizen sind schon archiviert (rückgängig möglich).`);
    const neu = archiviert(alt);
    if (!neu) continue;
    if (!o.dry) {
      writeAtomic(abs, neu);
      await o.store.put(x.datei, { alt: 'draft', neuHash: hashText(neu), at: o.jetzt ?? new Date() });
    }
    fertig.push(x.datei);
  }
  if (!o.dry) o.danach?.();
  return { ok: true, dry: !!o.dry, archiviert: fertig };
}

/** Rückgängig (7 Tage): nur, solange die Notiz unverändert so ist, wie wir sie hinterlassen haben. */
export async function rueckgaengig(datei: string, o: { vaultDir: string; teams: string[]; jetzt?: Date; locked?: () => boolean; store: ArchivStore; danach?: () => void }): Promise<any> {
  pruefeDatei(datei, o.teams);
  const doc = await o.store.get(datei);
  if (!doc) throw new CosError(404, 'Dazu gibt es nichts rückgängig zu machen.');
  if ((o.jetzt?.getTime() ?? Date.now()) - new Date(doc.at).getTime() > RUECKGAENGIG_TAGE * 86_400_000) throw new CosError(409, 'Die 7 Tage zum Rückgängigmachen sind vorbei.');
  if ((o.locked ?? (() => syncLocked()))()) throw new CosError(409, 'Vault-Sync läuft gerade — bitte gleich noch einmal.');
  const abs = join(o.vaultDir, datei);
  const text = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
  if (hashText(text) !== doc.neuHash) throw new CosError(409, 'Die Notiz wurde seitdem geändert — nicht automatisch zurücksetzen.');
  const zurueck = text.replace(/^(---\r?\n[\s\S]*?\r?\n)status:\s*archived(\s*\r?\n)/, '$1status: draft$2');
  if (zurueck === text) throw new CosError(409, 'Status nicht gefunden.');
  writeAtomic(abs, zurueck);
  await o.store.del(datei);
  o.danach?.();
  return { ok: true, datei };
}
