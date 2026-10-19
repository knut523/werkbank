// Chief of Staff, S3.4 Tagesabschluss (17:30, Werktage) und Wochendurchsicht (Fr 15:00) — generierte Vault-Seiten neben der Morgenlage und eine
// Nachmittagskarte (docs/plan-chief-of-staff.md; K10, K14, K16, K19). Der Tagesabschluss setzt die Stichzeit für „über Nacht“.
// Reine Funktionen (Inhalt, Markdown ≤ 25 Zeilen) + Takt. Die Register schreibt der Takt nie.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { wb } from './db.ts';
import { writeAtomic, syncLocked } from './roadmapauto.ts';
import { hashText, liesRegister, type Zusage } from './cosregister.ts';
import { wien, wienZuUtc, addTage, tageZwischen, hhmmMin, MAX_ZEILEN } from './cos.ts';
import type { Quellen } from './cossammle.ts';
import { cosOwner, cosAn } from './cosjob.ts';
import { verbrauchJeStrang } from './cosbudget.ts';
import { runs, questions } from './orchestrator.ts';
import type { User } from './auth.ts';

const kurz = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const kd = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;
const zhash = (z: Zusage) => hashText(JSON.stringify([z.wer, z.an, z.was, z.bis, z.fristUnklar, z.thema, z.quelle, z.notizen]));

export const REL_ABSCHLUSS = (datum: string) => `olaf/1-Projects/daily-debrief/${datum}-olaf-tagesabschluss.md`;
export const REL_WOCHE = (datum: string) => `olaf/1-Projects/daily-debrief/${datum}-olaf-woche.md`;

// ---------- Tagesabschluss ----------

export interface Entschieden { art: 'frage' | 'bericht'; titel: string; antwort: string }
export interface AbschlussInput { heute: string; entschieden: Entschieden[]; zusagen: Zusage[]; vorherIds: string[] | null; laeuft: { titel: string }[]; offeneFragen: number }
export interface Abschluss {
  datum: string; entschieden: Entschieden[]; erledigt: Zusage[]; verworfen: Zusage[]; neu: Zusage[]; morgen: Zusage[]; ueberfaellig: number; laeuft: { titel: string }[]; offeneFragen: number;
}

/** Morgen fällig: Werktag → nächster Tag; Freitag/Samstag → bis einschließlich Montag. */
export function morgenBis(heute: string): string {
  const wt = new Date(heute + 'T12:00:00Z').getUTCDay();
  return addTage(heute, wt === 5 ? 3 : wt === 6 ? 2 : 1);
}

export function tagesabschluss(i: AbschlussInput): Abschluss {
  const bis = morgenBis(i.heute);
  const vorher = i.vorherIds ? new Set(i.vorherIds) : null;
  return {
    datum: i.heute, entschieden: i.entschieden,
    erledigt: i.zusagen.filter((z) => z.abschnitt === 'erledigt' && z.erledigtAm === i.heute),
    verworfen: i.zusagen.filter((z) => z.abschnitt === 'verworfen' && z.erledigtAm === i.heute),
    neu: vorher ? i.zusagen.filter((z) => !vorher.has(z.id)) : [],
    morgen: i.zusagen.filter((z) => z.abschnitt === 'offen' && z.bis && z.bis > i.heute && z.bis <= bis),
    ueberfaellig: i.zusagen.filter((z) => z.abschnitt === 'offen' && z.bis && z.bis < i.heute).length,
    laeuft: i.laeuft, offeneFragen: i.offeneFragen,
  };
}

const kopfFm = (titel: string, datum: string) => ['---', `title: "${titel} ${datum}"`, 'type: reference', 'team: olaf', 'area: operations', 'status: current', `created: ${datum}`, `last-verified: ${datum}`, 'tags: [chief-of-staff, tagesabschluss]', 'sources: ["OLAF Workspace: Chief of Staff (generiert)"]', '---'];
const kapp = (z: string[]) => { while (z.length > MAX_ZEILEN) { const i = z.findLastIndex((x) => x.startsWith('- ')); if (i < 0) break; z.splice(i, 1); } return z.slice(0, MAX_ZEILEN); };
const liste = (zs: Zusage[], n = 3) => zs.slice(0, n).map((z) => `${z.id} ${z.wer ?? 'Wer: offen'} → ${z.an}: ${kurz(z.was, 60)}`).join(' · ');

export function abschlussMarkdown(a: Abschluss, o: { hhmm: string; morgenLink?: string | null } = { hhmm: '17:30' }): string {
  const z: string[] = [`Stand ${o.hhmm}, aktuell: Übersicht im OLAF Workspace (diese Seite wird nicht fortlaufend nachgeführt).`, `# Tagesabschluss ${a.datum}`, ''];
  z.push(`**Heute entschieden (${a.entschieden.length}):**${a.entschieden.length ? '' : ' nichts.'}`);
  for (const e of a.entschieden.slice(0, 3)) z.push(`- ${kurz(e.titel, 80)} → ${kurz(e.antwort, 40)}`);
  if (a.entschieden.length > 3) z.push(`- … und ${a.entschieden.length - 3} weitere`);
  z.push(`**Zusagen:** erledigt ${a.erledigt.length}${a.verworfen.length ? ` · verworfen ${a.verworfen.length}` : ''} · neu ${a.neu.length} · überfällig ${a.ueberfaellig}`);
  z.push(`**Morgen fällig (${a.morgen.length}):** ${liste(a.morgen) || 'nichts'}${a.morgen.length > 3 ? ` · … +${a.morgen.length - 3}` : ''}`);
  z.push(`**Läuft über Nacht (${a.laeuft.length}):** ${a.laeuft.slice(0, 3).map((l) => kurz(l.titel, 40)).join(' · ') || 'nichts'}`);
  if (a.offeneFragen) z.push(`**Offene Rückfragen an dich:** ${a.offeneFragen}`);
  z.push('Setzt die Stichzeit für „über Nacht“ der nächsten Morgenlage.');
  return [...kopfFm('Tagesabschluss', a.datum), ...kapp(z)].join('\n') + '\n';
}

// ---------- Wochendurchsicht ----------

export interface Teuer { conv: string; titel: string; tokens: number }
export interface WocheInput { heute: string; zusagen: Zusage[]; hist: Record<string, { hash: string; seit: string }>; themen: { name: string; geaendert: string | null; ball: string }[]; teuerste: Teuer[]; rueckstau: number }
export interface Woche {
  datum: string; ueberfaellig: Zusage[]; unveraendert: Zusage[]; naechsteWoche: Zusage[]; themenRuhig: { name: string; geaendert: string | null; ball: string }[]; teuerste: Teuer[]; rueckstau: number;
}
export const UNVERAENDERT_TAGE = 14, THEMA_RUHIG_TAGE = 7;

export function wochendurchsicht(i: WocheInput): Woche {
  const offen = i.zusagen.filter((z) => z.abschnitt === 'offen');
  const wt = new Date(i.heute + 'T12:00:00Z').getUTCDay();
  const montag = addTage(i.heute, ((8 - wt) % 7) || 7);
  const sonntag = addTage(montag, 6);
  return {
    datum: i.heute,
    ueberfaellig: offen.filter((z) => z.bis && z.bis < i.heute).sort((a, b) => String(a.bis).localeCompare(String(b.bis))),
    unveraendert: offen.filter((z) => { const h = i.hist[z.id]; return !!h && h.hash === zhash(z) && tageZwischen(h.seit, i.heute) >= UNVERAENDERT_TAGE; }),
    naechsteWoche: offen.filter((z) => z.bis && z.bis >= montag && z.bis <= sonntag),
    themenRuhig: i.themen.filter((t) => !t.geaendert || tageZwischen(t.geaendert, i.heute) >= THEMA_RUHIG_TAGE),
    teuerste: i.teuerste.slice(0, 5), rueckstau: i.rueckstau,
  };
}

/** Verlauf der Zusagen fortschreiben: gleiche Zeile → `seit` bleibt, geänderte Zeile → heute. */
export function histFortschreiben(alt: Record<string, { hash: string; seit: string }>, zusagen: Zusage[], heute: string): Record<string, { hash: string; seit: string }> {
  const neu: Record<string, { hash: string; seit: string }> = {};
  for (const z of zusagen) if (z.abschnitt === 'offen') { const h = zhash(z); neu[z.id] = alt[z.id]?.hash === h ? alt[z.id] : { hash: h, seit: heute }; }
  return neu;
}

export function wocheMarkdown(w: Woche, o: { hhmm: string } = { hhmm: '15:00' }): string {
  const z: string[] = [`Stand ${o.hhmm}, aktuell: Übersicht im OLAF Workspace (diese Seite wird nicht fortlaufend nachgeführt).`, `# Wochendurchsicht ${w.datum}`, ''];
  z.push(`**Überfällige Zusagen (${w.ueberfaellig.length}):** ${liste(w.ueberfaellig) || 'keine'}${w.ueberfaellig.length > 3 ? ` · … +${w.ueberfaellig.length - 3}` : ''}`);
  z.push(`**Seit ${UNVERAENDERT_TAGE} Tagen unverändert (${w.unveraendert.length}):** ${liste(w.unveraendert) || 'keine'}`);
  z.push(`**Nächste Woche fällig (${w.naechsteWoche.length}):** ${liste(w.naechsteWoche) || 'nichts'}`);
  z.push(`**Themen ohne Bewegung seit ${THEMA_RUHIG_TAGE} Tagen (${w.themenRuhig.length}):** ${w.themenRuhig.slice(0, 6).map((t) => t.name).join(' · ') || 'keine'}`);
  z.push(`**Teuerste Unter-Chats der Woche:** ${w.teuerste.map((t) => `${kurz(t.titel, 30)} ${Math.round(t.tokens / 1000)}k`).join(' · ') || 'keine Messung'}`);
  if (w.rueckstau) z.push(`**Rückstau:** ${w.rueckstau} ältere Meeting-Entwürfe ohne Action Items — in der Übersicht gesammelt archivieren.`);
  return [...kopfFm('Wochendurchsicht', w.datum), ...kapp(z)].join('\n') + '\n';
}

// ---------- Sammler ----------

const meta = () => wb().collection('meta');

export async function sammleAbschluss(u: User, q: Quellen, jetzt: Date): Promise<Abschluss> {
  const w = wien(jetzt);
  const tagStart = wienZuUtc(w.datum, 0, 0);
  const reg = liesRegister(q.vaultDir);
  const vorher: any = await meta().findOne({ _id: 'cos_abschluss' as any });
  const entschieden: Entschieden[] = [];
  for (const x of (await questions().find({ userId: u.id, status: 'beantwortet', 'answer.at': { $gte: tagStart } }).project({ title: 1, answer: 1 }).limit(40).toArray()) as any[])
    entschieden.push({ art: 'frage', titel: String(x.title ?? ''), antwort: String(x.answer?.option || x.answer?.text || 'beantwortet') });
  for (const d of (await runs().find({ userId: u.id, 'entscheidungenAntwort.at': { $gte: tagStart } }).project({ title: 1, entscheidungenAntwort: 1 }).limit(40).toArray()) as any[])
    entschieden.push({ art: 'bericht', titel: `${(d.entscheidungenAntwort.ids ?? []).join(', ')} (${d.title})`, antwort: (d.entscheidungenAntwort.antworten ?? []).map((a: any) => a.art === 'akzeptiert' ? 'ja' : a.art === 'abgelehnt' ? 'nein' : 'eigene Antwort').join(', ') || 'beantwortet' });
  const ub = await q.uebersicht(u);
  const laeuft = ub.karten.filter((k: any) => k.running).map((k: any) => ({ titel: String(k.titel) }));
  return tagesabschluss({ heute: w.datum, entschieden, zusagen: reg.zusagen, vorherIds: Array.isArray(vorher?.zusagenIds) ? vorher.zusagenIds : null, laeuft, offeneFragen: ub.qs.length });
}

export async function sammleWoche(u: User, q: Quellen, jetzt: Date, rueckstauZahl = 0): Promise<{ woche: Woche; hist: Record<string, { hash: string; seit: string }> }> {
  const w = wien(jetzt);
  const reg = liesRegister(q.vaultDir);
  const h: any = await meta().findOne({ _id: 'cos_zusagen_hist' as any });
  const hist = (h?.hist ?? {}) as Record<string, { hash: string; seit: string }>;
  const seit = new Date(+jetzt - 7 * 86400_000);
  const zs = (await wb().collection('zug_log').find({ at: { $gte: seit } }).project({ conv: 1, parent: 1, art: 1, input: 1, output: 1, cacheRead: 1 }).toArray()) as any[];
  const proConv = verbrauchJeStrang(zs);
  const docs = (await runs().find({ userId: u.id, conv: { $in: [...proConv.keys()] } }).project({ conv: 1, title: 1 }).toArray()) as any[];
  const titel = new Map(docs.map((d) => [String(d.conv), String(d.title ?? '')]));
  const teuerste = [...proConv].map(([conv, tokens]) => ({ conv, titel: titel.get(conv) ?? conv.slice(0, 8), tokens })).filter((t) => titel.has(t.conv)).sort((a, b) => b.tokens - a.tokens);
  const themen = reg.themen.map((t) => ({ name: t.name, geaendert: t.geaendert, ball: t.ball }));
  return { woche: wochendurchsicht({ heute: w.datum, zusagen: reg.zusagen, hist, themen, teuerste, rueckstau: rueckstauZahl }), hist };
}

// ---------- Takt ----------

export type AbschlussErgebnis = 'aus' | 'zu-frueh' | 'wochenende' | 'geschrieben' | 'schon-da' | 'nichts' | 'gesperrt' | 'trocken' | 'ohne-person' | 'verpasst';
const SPAET = '23:30';

async function seiteSchreiben(rel: string, text: string, q: Quellen, o: { dry?: boolean; locked?: () => boolean }): Promise<'geschrieben' | 'schon-da' | 'gesperrt' | 'trocken'> {
  const abs = join(q.vaultDir, rel);
  if (existsSync(abs)) return 'schon-da';
  if ((o.locked ?? (() => syncLocked()))()) return 'gesperrt';
  if (o.dry) return 'trocken';
  writeAtomic(abs, text);
  return 'geschrieben';
}

/** Werktags ab COS_ZEIT_ABEND (17:30), einmal je Tag: Seite schreiben, Stichzeit und Zusagen-Verlauf festhalten. */
export async function abschlussTick(q: Quellen, o: { jetzt?: Date; dry?: boolean; locked?: () => boolean; person?: User | null } = {}): Promise<AbschlussErgebnis> {
  if (!cosAn()) return 'aus';
  const jetzt = o.jetzt ?? new Date();
  const w = wien(jetzt), min = w.h * 60 + w.m;
  if (w.wt === 0 || w.wt === 6) return 'wochenende';
  if (min < hhmmMin(process.env.COS_ZEIT_ABEND ?? '', '17:30')) return 'zu-frueh';
  const st: any = await meta().findOne({ _id: 'cos_abschluss' as any });
  if (st?.datum === w.datum) return 'nichts';
  if (min > hhmmMin(SPAET, SPAET)) return 'verpasst';
  const person = o.person === undefined ? await cosOwner() : o.person;
  if (!person) return 'ohne-person';
  const a = await sammleAbschluss(person, q, jetzt);
  const r = await seiteSchreiben(REL_ABSCHLUSS(w.datum), abschlussMarkdown(a, { hhmm: w.hhmm }), q, o);
  if (r === 'gesperrt' || r === 'trocken') return r;
  const reg = liesRegister(q.vaultDir);
  const h: any = await meta().findOne({ _id: 'cos_zusagen_hist' as any });
  await meta().updateOne({ _id: 'cos_abschluss' as any }, { $set: { datum: w.datum, at: jetzt, zusagenIds: reg.zusagen.map((z) => z.id) } }, { upsert: true });
  await meta().updateOne({ _id: 'cos_zusagen_hist' as any }, { $set: { hist: histFortschreiben(h?.hist ?? {}, reg.zusagen, w.datum), at: jetzt } }, { upsert: true });
  return r;
}

/** Freitags ab COS_ZEIT_WOCHE (15:00), einmal je Woche. */
export async function wocheTick(q: Quellen, o: { jetzt?: Date; dry?: boolean; locked?: () => boolean; person?: User | null; rueckstau?: () => number } = {}): Promise<AbschlussErgebnis> {
  if (!cosAn()) return 'aus';
  const jetzt = o.jetzt ?? new Date();
  const w = wien(jetzt), min = w.h * 60 + w.m;
  if (w.wt !== 5) return 'nichts';
  if (min < hhmmMin((process.env.COS_ZEIT_WOCHE ?? '').replace(/^Fr\s*/i, ''), '15:00')) return 'zu-frueh';
  const st: any = await meta().findOne({ _id: 'cos_woche' as any });
  if (st?.datum === w.datum) return 'nichts';
  if (min > hhmmMin(SPAET, SPAET)) return 'verpasst';
  const person = o.person === undefined ? await cosOwner() : o.person;
  if (!person) return 'ohne-person';
  const { woche } = await sammleWoche(person, q, jetzt, o.rueckstau?.() ?? 0);
  const r = await seiteSchreiben(REL_WOCHE(w.datum), wocheMarkdown(woche, { hhmm: w.hhmm }), q, o);
  if (r === 'gesperrt' || r === 'trocken') return r;
  await meta().updateOne({ _id: 'cos_woche' as any }, { $set: { datum: w.datum, at: jetzt } }, { upsert: true });
  return r;
}

