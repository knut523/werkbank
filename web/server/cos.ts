// Chief of Staff, S1.2 Morgenlage (docs/plan-chief-of-staff.md): reine Funktionen. Die Sammler (Mongo, Vault, Stränge) stehen in cossammle.ts;
// hier nur: Zeit (Wiener Zeit, Zeitumstellung), Stichzeit, Vergleiche (PR-Schnappschuss, Jira, Stränge), Sortierung und Obergrenzen,
// Schulden je Seite, Themen, Berichtszeilen und die Vault-Seite (K10: höchstens 25 Zeilen, K19: „Stand“ in der ersten Zeile).

import type { Register, Personen, Zusage, ThemaZeile } from './cosregister.ts';
import { seiteVon } from './cosregister.ts';
import type { TerminKarte } from './cosvorbereitung.ts';

const DAY = 86_400_000;
export const GRENZEN = { entscheide: 7, nacht: 10, schulden: 5, blockiert: 7, themen: 8 } as const;

// ---------- Zeit (Wiener Zeit) ----------

const fmtParts = (d: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(d).map((p) => [p.type, p.value]));
const WT: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
/** Datum, Uhrzeit und Wochentag (0 = Sonntag) in Wiener Zeit. */
export function wien(d: Date): { datum: string; h: number; m: number; hhmm: string; wt: number } {
  const p = fmtParts(d);
  return { datum: `${p.year}-${p.month}-${p.day}`, h: Number(p.hour), m: Number(p.minute), hhmm: `${p.hour}:${p.minute}`, wt: WT[p.weekday] ?? 0 };
}
/** Offset Wien − UTC in Minuten zu diesem Zeitpunkt. */
function offsetMin(d: Date): number {
  const p = fmtParts(d);
  return (Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) - Math.floor(d.getTime() / 60_000) * 60_000) / 60_000;
}
/** Wiener Wanduhr (Datum + h:m) → UTC-Zeitpunkt, zeitumstellungsfest. */
export function wienZuUtc(datum: string, h: number, m: number): Date {
  const [y, mo, d] = datum.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, m);
  let t = guess - offsetMin(new Date(guess)) * 60_000;
  t = guess - offsetMin(new Date(t)) * 60_000;
  return new Date(t);
}
export const addTage = (datum: string, n: number) => new Date(Date.UTC(Number(datum.slice(0, 4)), Number(datum.slice(5, 7)) - 1, Number(datum.slice(8, 10)) + n)).toISOString().slice(0, 10);
export const tageZwischen = (von: string, bis: string) => Math.round((Date.UTC(Number(bis.slice(0, 4)), Number(bis.slice(5, 7)) - 1, Number(bis.slice(8, 10))) - Date.UTC(Number(von.slice(0, 4)), Number(von.slice(5, 7)) - 1, Number(von.slice(8, 10)))) / DAY);

/** „über Nacht“ seit: dem letzten Tagesabschluss (höchstens 4 Tage alt), sonst dem Vortag 18:00 Wiener Zeit (K16). */
export function stichzeit(jetzt: Date, abschluss?: Date | null): Date {
  if (abschluss && abschluss < jetzt && +jetzt - +abschluss <= 4 * DAY) return abschluss;
  return wienZuUtc(addTage(wien(jetzt).datum, -1), 18, 0);
}

/** Uhrzeit „HH:MM“ der Konfiguration → Minuten seit Mitternacht. */
export const hhmmMin = (s: string, fallback: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim()) ?? /^(\d{1,2}):(\d{2})$/.exec(fallback)!; return Number(m[1]) * 60 + Number(m[2]); };

// ---------- Eingaben (aus den Sammlern) ----------

export interface KarteLite { id: string; titel: string; thema: string; ampel: 'laeuft' | 'blockiert' | 'push' | 'review'; running: boolean; braucht: string | null; entscheidungen: { id: string; frage: string; empfehlung: string }[]; berichtHash: string | null; rueckfragen: number; statusAt: string; startedAt?: string | null; chat?: string | null }
export interface FrageLite { id: string; title: string; recommendation: string; options: { label: string; consequence?: string }[]; strandId: string | null; strandTitel?: string; createdAt: string; link?: string | null }
export interface PrLite { pr: string; title: string; url: string; author: string | null; createdAt: string; updatedAt: string; reviewDecision: string | null; turn: { who: string; role: string; why: string } }
export interface PrSnap { pr: string; title: string; url: string; reviewDecision: string | null }
export interface IssueLite { key: string; summary: string; status: string; statusCategory?: string; assignee: string | null; duedate: string | null; updated: string; created?: string; statusSince?: string | null; blockedBy?: string[]; workstream?: string | null; url?: string }
export interface MeetingLite { pfad: string; name: string; titel: string; datum: string | null; mtime: number; status: string }
export interface BerichtZeile { art: 'daily' | 'dienste' | 'debrief' | 'sync'; label: string; zeile: string; link: string | null }
export interface TriageLite { id: string; datei: string; titel: string; zusagen: number; entscheidungen: number; datum: string | null }

export interface LageInput {
  jetzt: Date; stichzeit: Date;
  karten: KarteLite[]; fragen: FrageLite[];
  mine: { prs: { pr: string; title: string; url: string; why?: string }[]; tickets: { key: string; summary: string; duedate: string | null; why: string }[] };
  prs: PrLite[]; prSnapshot: Record<string, PrSnap> | null;
  jira: IssueLite[]; jiraSnapshot: Record<string, string> | null;
  olafJira?: { issues: IssueLite[]; fehler?: string | null } | null;
  register: { vorhanden: { zusagen: boolean; themen: boolean }; zusagen: Zusage[]; themen: ThemaZeile[]; personen: Personen[]; unlesbar: { zeile: number; text: string; abschnitt: string }[]; themenUnlesbar?: { zeile: number; text: string; abschnitt: string }[]; doppelt?: string[] };
  team: Set<string>;
  meetings: MeetingLite[]; triage: TriageLite[]; berichte: BerichtZeile[];
  roadmapFragen: number; ich: string;
  triageInfo?: { aelter: number; ohnePunkte: number };
  termine?: TerminKarte[];
}

// ---------- Ausgabe ----------

export interface Liste<T> { items: T[]; weitere: number; gesamt: number }
export const kappe = <T>(a: T[], n: number): Liste<T> => ({ items: a.slice(0, n), weitere: Math.max(0, a.length - n), gesamt: a.length });

export interface Entscheid { art: 'frage' | 'bericht' | 'triage'; id: string; titel: string; empfehlung: string; optionen: string[]; strang: { id: string; titel: string } | null; seit: string; wartet: boolean; berichtHash?: string | null; datei?: string; zusagen?: number; entscheidungen?: number }
export interface Blockiert { art: 'strang' | 'jira'; id: string; titel: string; von: string; seit?: string | null; link?: string | null }
export interface NachtItem { art: 'pr' | 'jira' | 'olafjira' | 'strang' | 'meeting'; text: string; link?: string | null; wann?: string | null }
export interface Schuld { id: string | null; wer: string | null; an: string; was: string; bis: string | null; fristUnklar: boolean; ueberfaellig: boolean; tage: number; thema?: string; quelle?: string; seite: string; abgeleitet: boolean; link?: string | null; notizen?: string[] }
export interface ThemaLage { name: string; stand: string; naechster: string; ball: string; geaendert: string | null; offeneZusagen: number; straenge: number; entscheidungen: number; bewegt: boolean }

export interface Lage {
  stand: { at: string; hhmm: string; datum: string; stichzeit: string };
  leer: string | null;
  entscheide: Liste<Entscheid>;
  blockiert: Liste<Blockiert>;
  nacht: { pr: Liste<NachtItem>; jira: Liste<NachtItem>; olafjira: Liste<NachtItem>; strang: Liste<NachtItem>; meeting: Liste<NachtItem>; olafjiraFehler: string | null };
  berichte: BerichtZeile[];
  schulden: { knut: Liste<Schuld>; team: Liste<Schuld>; partner: Liste<Schuld>; klaeren: Liste<Schuld>; ueberfaellig: number; rueckfragenAnKnut: number };
  themen: { zeilen: Liste<ThemaLage>; ruhig: number };
  triage: Liste<TriageLite>;
  triageInfo: { aelter: number; ohnePunkte: number };
  termine: TerminKarte[];
  unlesbar: { zeile: number; text: string; abschnitt: string }[];
  roadmapFragen: number;
}

// ---------- ① Entscheide ----------

export function entscheide(i: Pick<LageInput, 'karten' | 'fragen' | 'triage'>): Entscheid[] {
  const karteVon = new Map(i.karten.map((k) => [k.id, k]));
  const out: Entscheid[] = [];
  for (const q of i.fragen) {
    const k = q.strandId ? karteVon.get(q.strandId) : undefined;
    out.push({ art: 'frage', id: q.id, titel: q.title, empfehlung: q.recommendation, optionen: q.options.map((o) => o.label), strang: q.strandId ? { id: q.strandId, titel: k?.titel ?? q.strandTitel ?? '' } : null, seit: q.createdAt, wartet: !!q.strandId });
  }
  for (const k of i.karten) for (const e of k.entscheidungen) {
    out.push({ art: 'bericht', id: `${k.id}:${e.id}`, titel: e.frage, empfehlung: e.empfehlung, optionen: [], strang: { id: k.id, titel: k.titel }, seit: k.statusAt, wartet: !k.running, berichtHash: k.berichtHash });
  }
  for (const t of i.triage) out.push({ art: 'triage', id: t.id, titel: `Meeting „${t.titel}“: ${t.zusagen} ${t.zusagen === 1 ? 'Zusage' : 'Zusagen'}, ${t.entscheidungen} ${t.entscheidungen === 1 ? 'Entscheidung' : 'Entscheidungen'} übernehmen?`, empfehlung: t.entscheidungen ? 'Zusagen eintragen, Entscheidungen als ADR im Chat' : 'Zusagen ins Register eintragen', optionen: ['Ja', 'Nein', 'Anders'], strang: null, seit: t.datum ?? '', wartet: false, datei: t.datei, zusagen: t.zusagen, entscheidungen: t.entscheidungen });
  // zuerst, worauf ein Strang wartet, dann das Älteste
  return out.sort((a, b) => Number(b.wartet) - Number(a.wartet) || String(a.seit || '9').localeCompare(String(b.seit || '9')));
}

// ---------- ② Blockiert ----------

export function blockiert(i: Pick<LageInput, 'karten' | 'jira'>): Blockiert[] {
  const out: Blockiert[] = [];
  for (const k of i.karten) {
    if (k.ampel === 'blockiert') out.push({ art: 'strang', id: k.id, titel: k.titel, von: k.braucht ?? 'Unter-Chat meldet „blockiert“', seit: k.statusAt, link: k.chat ?? null });
    else if (k.braucht) out.push({ art: 'strang', id: k.id, titel: k.titel, von: `braucht Knut: ${k.braucht}`, seit: k.statusAt, link: k.chat ?? null });
  }
  for (const t of i.jira) {
    if (t.statusCategory === 'done' || t.status === 'Done') continue;
    if (/blockiert|blocked/i.test(t.status) || (t.blockedBy?.length ?? 0) > 0) out.push({ art: 'jira', id: t.key, titel: `${t.key} ${t.summary}`, von: t.blockedBy?.length ? `blockiert durch ${t.blockedBy.slice(0, 3).join(', ')}` : `Status ${t.status}`, seit: t.updated, link: t.url ?? null });
  }
  return out.sort((a, b) => String(a.seit ?? '9').localeCompare(String(b.seit ?? '9')));
}

// ---------- ③ Über Nacht (nur Zustandswechsel, K10) ----------

export function prNacht(prs: PrLite[], snap: Record<string, PrSnap> | null, st: Date): NachtItem[] {
  const out: NachtItem[] = [];
  const jetzt = new Set(prs.map((p) => p.pr));
  for (const p of prs) {
    if (new Date(p.createdAt) > st) { out.push({ art: 'pr', text: `${p.pr} neu: ${p.title}`, link: p.url, wann: p.createdAt }); continue; }
    const alt = snap?.[p.pr];
    if (alt && alt.reviewDecision !== p.reviewDecision && p.reviewDecision) out.push({ art: 'pr', text: `${p.pr} ${p.reviewDecision === 'APPROVED' ? 'freigegeben' : p.reviewDecision === 'CHANGES_REQUESTED' ? 'mit angefragten Änderungen' : 'Review: ' + p.reviewDecision}: ${p.title}`, link: p.url, wann: p.updatedAt });
  }
  if (snap) for (const s of Object.values(snap)) if (!jetzt.has(s.pr)) out.push({ art: 'pr', text: `${s.pr} gemergt oder geschlossen: ${s.title}`, link: s.url });
  return out.sort((a, b) => String(b.wann ?? '').localeCompare(String(a.wann ?? '')));
}

export function jiraNacht(issues: IssueLite[], snap: Record<string, string> | null, st: Date, art: 'jira' | 'olafjira' = 'jira'): NachtItem[] {
  const out: NachtItem[] = [];
  const erledigt = (i: IssueLite) => i.statusCategory === 'done' || i.status === 'Done';
  for (const i of issues) {
    if (new Date(i.updated) <= st) continue;
    const label = `${i.key} ${i.summary}`;
    if (i.created && new Date(i.created) > st) { out.push({ art, text: `${label} neu${i.assignee ? ` (${i.assignee})` : ''}`, link: i.url ?? null, wann: i.updated }); continue; }
    const vorher = snap?.[i.key];
    if (erledigt(i) && ((vorher && vorher !== i.status) || (!snap && i.statusSince && new Date(i.statusSince) > st))) { out.push({ art, text: `${label} erledigt`, link: i.url ?? null, wann: i.updated }); continue; }
    if (vorher && vorher !== i.status) { out.push({ art, text: `${label}: ${vorher} → ${i.status}`, link: i.url ?? null, wann: i.updated }); continue; }
    if (!snap && !erledigt(i) && i.statusSince && new Date(i.statusSince) > st) out.push({ art, text: `${label}: Status ${i.status}`, link: i.url ?? null, wann: i.updated });
  }
  return out.sort((a, b) => String(b.wann ?? '').localeCompare(String(a.wann ?? '')));
}

export function strangNacht(karten: KarteLite[], st: Date): NachtItem[] {
  const out: NachtItem[] = [];
  for (const k of karten) {
    if (k.startedAt && new Date(k.startedAt) > st) { out.push({ art: 'strang', text: `Unter-Chat neu: ${k.titel}`, link: k.chat ?? null, wann: k.startedAt }); continue; }
    if (new Date(k.statusAt) <= st || k.running) continue;
    if (k.ampel === 'blockiert') out.push({ art: 'strang', text: `Unter-Chat blockiert: ${k.titel}`, link: k.chat ?? null, wann: k.statusAt });
    else if (k.ampel === 'push' || k.ampel === 'review') out.push({ art: 'strang', text: `Unter-Chat fertig: ${k.titel}`, link: k.chat ?? null, wann: k.statusAt });
  }
  return out.sort((a, b) => String(b.wann ?? '').localeCompare(String(a.wann ?? '')));
}

export function meetingNacht(ms: MeetingLite[], st: Date): NachtItem[] {
  return ms.filter((m) => m.mtime > +st).sort((a, b) => b.mtime - a.mtime).map((m) => ({ art: 'meeting' as const, text: `Meeting-Notiz: ${m.titel}`, link: m.pfad, wann: new Date(m.mtime).toISOString() }));
}

// ---------- ④ Wer schuldet was ----------

const namePassend = (a: string | null, ich: string) => !!a && a.toLowerCase().split(/\s+/)[0] === ich.toLowerCase();

export function schulden(i: LageInput): Lage['schulden'] {
  const heute = wien(i.jetzt).datum;
  const alle: Schuld[] = [];
  for (const z of i.register.zusagen) {
    if (z.abschnitt !== 'offen') continue;
    const seite = seiteVon(z.wer, i.register.personen, i.team);
    const tage = z.bis ? tageZwischen(z.bis, heute) : 0;
    alle.push({ id: z.id, wer: z.wer, an: z.an, was: z.was, bis: z.bis, fristUnklar: z.fristUnklar || !z.bis, ueberfaellig: !!z.bis && z.bis < heute, tage, thema: z.thema, quelle: z.quelle, seite, abgeleitet: false, notizen: z.notizen });
  }
  // abgeleitet (nicht ins Register geschrieben): dieselben Quellen wie „Wartet auf dich“ (K8)
  for (const p of i.mine.prs) alle.push({ id: null, wer: i.ich, an: 'Team', was: `PR ${p.pr}: ${p.why ?? 'dran'} — ${p.title}`, bis: null, fristUnklar: false, ueberfaellig: false, tage: 0, seite: 'Knut', abgeleitet: true, link: p.url });
  for (const t of i.mine.tickets) if (t.why === 'überfällig') alle.push({ id: null, wer: i.ich, an: 'Team', was: `${t.key} ${t.summary}`, bis: t.duedate, fristUnklar: false, ueberfaellig: true, tage: t.duedate ? tageZwischen(t.duedate, heute) : 0, seite: 'Knut', abgeleitet: true });
  for (const p of i.prs) if (p.reviewDecision === 'CHANGES_REQUESTED' && !namePassend(p.turn.who, i.ich) && p.turn.role === 'author') alle.push({ id: null, wer: p.turn.who, an: i.ich, was: `PR ${p.pr}: Änderungen verlangt — ${p.title}`, bis: null, fristUnklar: false, ueberfaellig: false, tage: 0, seite: seiteVon(p.turn.who, i.register.personen, i.team) === 'Seite?' ? 'Team' : seiteVon(p.turn.who, i.register.personen, i.team), abgeleitet: true, link: p.url });
  const mineKeys = new Set(i.mine.tickets.map((t) => t.key));
  const proPerson = new Map<string, IssueLite[]>();
  for (const t of i.jira) {
    if (t.statusCategory === 'done' || t.status === 'Done' || !t.duedate || t.duedate >= heute || mineKeys.has(t.key) || !t.assignee || namePassend(t.assignee, i.ich)) continue;
    proPerson.set(t.assignee, [...(proPerson.get(t.assignee) ?? []), t]);
  }
  for (const [wer, ts] of proPerson) {
    const aelteste = ts.reduce((a, b) => (a.duedate! < b.duedate! ? a : b));
    const seite = seiteVon(wer, i.register.personen, i.team);
    alle.push({ id: null, wer, an: i.ich, was: `${ts.length} überfällige Jira-Tickets (${ts.slice(0, 3).map((t) => t.key).join(', ')}${ts.length > 3 ? ' …' : ''})`, bis: aelteste.duedate, fristUnklar: false, ueberfaellig: true, tage: tageZwischen(aelteste.duedate!, heute), seite: seite === 'Seite?' ? 'Team' : seite, abgeleitet: true });
  }
  const sort = (a: Schuld, b: Schuld) => Number(b.ueberfaellig) - Number(a.ueberfaellig) || b.tage - a.tage || String(a.bis ?? '9').localeCompare(String(b.bis ?? '9')) || Number(a.abgeleitet) - Number(b.abgeleitet);
  const von = (s: string) => alle.filter((x) => x.seite === s).sort(sort);
  const klaeren = alle.filter((x) => x.seite === 'Seite?' || x.seite === 'offen').sort(sort);
  return {
    knut: kappe(von('Knut'), GRENZEN.schulden), team: kappe(von('Team'), GRENZEN.schulden), partner: kappe(von('Partner'), GRENZEN.schulden), klaeren: kappe(klaeren, GRENZEN.schulden),
    ueberfaellig: alle.filter((x) => x.ueberfaellig).length, rueckfragenAnKnut: i.fragen.length,
  };
}

// ---------- ⑤ Themen ----------

const nn = (s: string) => s.toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ').trim();

export function themen(i: LageInput, ents: Entscheid[]): Lage['themen'] {
  const stDatum = wien(i.stichzeit).datum;
  const zeilen: ThemaLage[] = i.register.themen.map((t) => {
    const offene = i.register.zusagen.filter((z) => z.abschnitt === 'offen' && z.thema && nn(z.thema) === nn(t.name)).length;
    const str = i.karten.filter((k) => nn(k.thema) === nn(t.name));
    const en = ents.filter((e) => e.strang && str.some((k) => k.id === e.strang!.id)).length;
    const knut = /^knut\b/i.test(t.ball.trim());
    const bewegt = !!t.geaendert && t.geaendert >= stDatum;
    return { name: t.name, stand: t.stand, naechster: t.naechster, ball: t.ball, geaendert: t.geaendert, offeneZusagen: offene, straenge: str.length, entscheidungen: en, bewegt: bewegt || knut || en > 0 };
  });
  const gezeigt = zeilen.filter((z) => z.bewegt).sort((a, b) => Number(/^knut/i.test(b.ball)) - Number(/^knut/i.test(a.ball)) || b.entscheidungen - a.entscheidungen || String(b.geaendert ?? '').localeCompare(String(a.geaendert ?? '')));
  return { zeilen: kappe(gezeigt, GRENZEN.themen), ruhig: zeilen.length - gezeigt.length };
}

// ---------- Lage ----------

export function baueLage(i: LageInput): Lage {
  const w = wien(i.jetzt);
  const ents = entscheide(i);
  const nacht = {
    pr: prNacht(i.prs, i.prSnapshot, i.stichzeit), jira: jiraNacht(i.jira, i.jiraSnapshot, i.stichzeit),
    olafjira: i.olafJira ? jiraNacht(i.olafJira.issues, null, i.stichzeit, 'olafjira') : [], strang: strangNacht(i.karten, i.stichzeit), meeting: meetingNacht(i.meetings, i.stichzeit),
  };
  const s = schulden(i);
  const th = themen(i, ents);
  const registerLeer = !i.register.vorhanden.zusagen && !i.register.vorhanden.themen || (i.register.zusagen.length === 0 && i.register.themen.length === 0);
  return {
    stand: { at: i.jetzt.toISOString(), hhmm: w.hhmm, datum: w.datum, stichzeit: i.stichzeit.toISOString() },
    leer: registerLeer ? 'Register noch leer → Einwurf (Notizen, Transkript oder Mail einwerfen; Zusagen und Themen entstehen daraus)' : null,
    entscheide: kappe(ents, GRENZEN.entscheide),
    blockiert: kappe(blockiert(i), GRENZEN.blockiert),
    nacht: { pr: kappe(nacht.pr, GRENZEN.nacht), jira: kappe(nacht.jira, GRENZEN.nacht), olafjira: kappe(nacht.olafjira, GRENZEN.nacht), strang: kappe(nacht.strang, GRENZEN.nacht), meeting: kappe(nacht.meeting, GRENZEN.nacht), olafjiraFehler: i.olafJira?.fehler ?? null },
    berichte: i.berichte,
    schulden: s, themen: th,
    triage: kappe(i.triage, GRENZEN.entscheide),
    triageInfo: i.triageInfo ?? { aelter: 0, ohnePunkte: 0 },
    termine: i.termine ?? [],
    unlesbar: [...i.register.unlesbar, ...(i.register.themenUnlesbar ?? [])],
    roadmapFragen: i.roadmapFragen,
  };
}

// ---------- Berichtszeilen (K1: nur, wenn der Bericht von heute ist) ----------

const ersterTreffer = (text: string, re: RegExp) => re.exec(text)?.[1]?.trim() ?? null;
const ohneMd = (s: string) => s.replace(/\*\*/g, '').replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, '$1').replace(/`/g, '').trim();

/** Eine Zeile aus dem Morgenbericht (Dienste + Abgleich). null = nichts Brauchbares. */
export function dailyZeilen(text: string): { daily: string | null; dienste: string | null } {
  const dienste = ersterTreffer(text, /^## Dienste und RAM[^\n]*\n+(?:>[^\n]*\n+)?- ([^\n]+)/m);
  const zahlen = [...text.matchAll(/^\*\*([^*\n]+)\*\* \((\d+)\)\s*$/gm)].map((m) => `${m[1]} ${m[2]}`);
  return { daily: zahlen.length ? `Abgleich Spec ↔ Plan: ${zahlen.join(' · ')}` : null, dienste: dienste ? ohneMd(dienste).slice(0, 140) : null };
}
/** `## Zahlen`-Zeile des Debriefs. */
export const debriefZeile = (text: string) => { const z = ersterTreffer(text, /^## Zahlen\s*\n+- ([^\n]+)/m); return z ? ohneMd(z).slice(0, 160) : null; };
/** Letzter Lauf im Vault-Sync-Protokoll: nur, wenn er von `datum` ist. */
export function syncZeile(text: string, datum: string): string | null {
  const laeufe = text.split(/^## /m).slice(1).map((s) => ({ kopf: /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/.exec(s), body: s })).filter((x) => x.kopf && x.kopf[1] === datum);
  const l = laeufe.at(-1);
  if (!l) return null;
  const dateien = (l.body.match(/^- `[^`]+\.md`/gm) ?? []).length;
  return `Vault-Sync ${l.kopf![2]}: ${dateien} Dateien geändert`;
}

// ---------- Vault-Seite (K10, K19) ----------

const kurz = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
export const MAX_ZEILEN = 25;

/** Die Seite neben dem Debrief: Stand in der ersten Zeile, höchstens 25 Zeilen Inhalt nach dem Kopf (K10). Links nur auf geprüfte Notizen (`links`). */
export function lageMarkdown(l: Lage, o: { links?: Record<string, string>; schreibe?: string } = {}): string {
  const heute = l.stand.datum;
  const fm = ['---', `title: "Morgenlage ${heute}"`, 'type: reference', 'team: olaf', 'area: operations', 'status: current', `created: ${heute}`, `last-verified: ${heute}`, 'tags: [chief-of-staff, morgenlage]', 'sources: ["OLAF Workspace: Chief of Staff (generiert)"]', '---'];
  const z: string[] = [];
  z.push(`Stand ${l.stand.hhmm}, aktuell: Übersicht im OLAF Workspace (diese Seite wird nicht fortlaufend nachgeführt).`);
  z.push(`# Morgenlage ${heute}`);
  z.push('');
  const entsText = (e: Entscheid) => `${kurz(e.titel, 90)}${e.empfehlung ? ` (Empfehlung: ${kurz(e.empfehlung, 60)})` : ''}`;
  z.push(`**Entscheide heute (${l.entscheide.gesamt}):**${l.entscheide.gesamt ? '' : ' nichts offen.'}`);
  for (const e of l.entscheide.items.slice(0, 3)) z.push(`- ${entsText(e)}`);
  if (l.entscheide.gesamt > 3) z.push(`- … und ${l.entscheide.gesamt - 3} weitere → Übersicht`);
  z.push(`**Blockiert (${l.blockiert.gesamt}):** ${l.blockiert.items.slice(0, 2).map((b) => kurz(b.titel, 50) + ' – ' + kurz(b.von, 40)).join(' · ') || 'nichts'}${l.blockiert.gesamt > 2 ? ` · … +${l.blockiert.gesamt - 2}` : ''}`);
  const n = l.nacht;
  z.push(`**Über Nacht:** PRs ${n.pr.gesamt} · Jira ${n.jira.gesamt}${n.olafjira.gesamt ? ` + OLAF ${n.olafjira.gesamt}` : ''} · Unter-Chats ${n.strang.gesamt} · Meetings ${n.meeting.gesamt}`);
  const s = l.schulden;
  z.push(`**Wer schuldet was:** Knut ${s.knut.gesamt} · Team ${s.team.gesamt} · Partner ${s.partner.gesamt}${s.klaeren.gesamt ? ` · Seite? ${s.klaeren.gesamt}` : ''} · überfällig ${s.ueberfaellig}`);
  z.push(`**Themen:** ${l.leer ? 'Register noch leer → Einwurf' : l.themen.zeilen.items.slice(0, 4).map((t) => `${t.name} (Ball: ${t.ball || '–'})`).join(' · ') || 'ruhig'}${l.themen.ruhig ? ` · ${l.themen.ruhig} ruhig` : ''}`);
  const b = l.berichte.map((r) => (r.link && o.links?.[r.link] ? `[[${o.links[r.link]}]]` : r.label)).join(' · ');
  if (b) z.push(`**Berichte:** ${b}`);
  if (l.unlesbar.length) z.push(`**Nicht lesbar im Register:** ${l.unlesbar.length} Zeilen`);
  // Obergrenze (K10): lieber Aufzählungspunkte weglassen als überschreiten
  while (z.length > MAX_ZEILEN) { const i = z.findLastIndex((x) => x.startsWith('- ')); if (i < 0) break; z.splice(i, 1); }
  return [...fm, ...z.slice(0, MAX_ZEILEN)].join('\n') + '\n';
}
