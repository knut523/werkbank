// Bedarfskanal (Knut 06.11.: „Wichtig ist, dass du den Strängen gibst, was sie brauchen — oder sie danach fragen können.“ und
// „Ich will nicht, dass die Hauptsitzung zum Flaschenhals wird“): Lesen und Lokales dürfen Stränge selbst; alles darüber hinaus
// (GitHub schreiben, Merge, Jira schreiben, Deploy, Zugang außerhalb des Worktrees, Geheimnisse …) melden sie mit bedarf_melden.
// Die Hauptsitzung bekommt es sofort (Hauptchat-Meldung) und sieht es in der 2.0 unter „Braucht Hauptsitzung“ mit Erteilen /
// Erledigt / Ablehnen; die Antwort geht als Nachricht an den Strang (eingereiht, wenn er arbeitet). „zugang“ gilt zeitlich begrenzt.
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import type { User } from './auth.ts';
import { wb } from './db.ts';

export const BEDARF_ARTEN = ['github', 'merge', 'jira', 'deploy', 'zugang', 'recht', 'geheimnis', 'datei', 'entscheidung', 'sonstiges'] as const;
export type BedarfArt = typeof BEDARF_ARTEN[number];
export const BEDARF_NAME: Record<BedarfArt, string> = { github: 'GitHub schreiben', merge: 'Merge', jira: 'Jira schreiben', deploy: 'Deploy', zugang: 'Zugang', recht: 'Recht (gesperrter Befehl)', geheimnis: 'Geheimnis', datei: 'Datei', entscheidung: 'Entscheidung', sonstiges: 'Sonstiges' };
export type BedarfAntwort = 'erteilt' | 'erledigt' | 'abgelehnt';

export const bedarfCol = () => wb().collection('strang_bedarf');

export function bedarfPruefen(b: { art?: unknown; text?: unknown; pfad?: unknown }): { art: BedarfArt; text: string; pfad: string | null } | { fehler: string } {
  const art = String(b.art ?? '') as BedarfArt;
  if (!BEDARF_ARTEN.includes(art)) return { fehler: `art ist eine von: ${BEDARF_ARTEN.join(', ')}.` };
  const text = String(b.text ?? '').trim();
  if (!text) return { fehler: 'Text fehlt — genau was und warum.' };
  if (text.length > 1000) return { fehler: 'Höchstens 1000 Zeichen — Details in den Bericht.' };
  let pfad: string | null = null;
  if (art === 'zugang') {
    pfad = String(b.pfad ?? '').trim() || null;
    if (!pfad) return { fehler: 'Bei art=zugang den Ordner angeben (pfad, absolut).' };
    if (!isAbsolute(pfad) || /\.\./.test(pfad)) return { fehler: 'pfad muss absolut sein (ohne ..).' };
  }
  return { art, text, pfad };
}

/** Frist eines Zugangs: Vorgabe 4 h, höchstens 24 h. */
export const zugangBis = (minuten: number, now = Date.now()) => new Date(now + Math.min(24 * 60, Math.max(15, Number(minuten) || 240)) * 60_000);
const uhr = (d: Date) => d.toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' });

export function bedarfAntwortText(b: { art: string; text: string; pfad?: string | null }, antwort: BedarfAntwort, notiz: string, bis: Date | null): string {
  const was = b.art === 'zugang' && antwort === 'erteilt' && bis ? `Zugang zu ${b.pfad} bis ${uhr(bis)} (lokal: ändern und committen; Push/Merge bleiben gesperrt)` : `„${b.text.slice(0, 160)}“`;
  return `Hauptsitzung zu deinem Bedarf (${BEDARF_NAME[b.art as BedarfArt] ?? b.art}) — ${antwort}: ${was}.${notiz ? ` ${notiz}` : ''}`;
}

/** Melden: Doppel (gleicher Strang, Art, Text, offen) zählt einmal; höchstens 15 offene je Strang. */
export async function bedarfMelden(u: User, d: { _id: unknown; title?: string }, p: { art: BedarfArt; text: string; pfad: string | null }, now = new Date()) {
  const da: any = await bedarfCol().findOne({ userId: u.id, 'strand.id': String(d._id), art: p.art, text: p.text, status: 'offen' });
  if (da) return { id: String(da._id), neu: false };
  if ((await bedarfCol().countDocuments({ userId: u.id, 'strand.id': String(d._id), status: 'offen' })) >= 15) throw Object.assign(new Error('Schon 15 offene Bedarfe — erst die Antworten abwarten, am Rest weiterarbeiten.'), { status: 429 });
  const id = `b-${randomUUID().slice(0, 8)}`;
  try { await bedarfCol().insertOne({ _id: id as any, userId: u.id, strand: { id: String(d._id), title: String(d.title ?? '') }, ...p, status: 'offen', at: now }); }
  catch (e: any) {
    // Phase 4: zwei gleichzeitige Meldungen desselben Bedarfs — der eindeutige Index (db.ts) lässt nur eine zu; die zweite ist „schon da“.
    if (e?.code !== 11000) throw e;
    const schon: any = await bedarfCol().findOne({ userId: u.id, 'strand.id': String(d._id), art: p.art, text: p.text, status: 'offen' });
    if (schon) return { id: String(schon._id), neu: false };
    throw e;
  }
  return { id, neu: true };
}

export async function bedarfListe(u: User, o: { offen?: boolean } = {}) {
  return bedarfCol().find({ userId: u.id, ...(o.offen === false ? {} : { status: 'offen' }) }).sort({ at: -1 }).limit(100).toArray() as Promise<any[]>;
}

/** „Erteilen“ öffnet nur bei Zugang (Freigabe in der Brücke) etwas; bei einer Entscheidung ist es die Antwort. Alles andere (GitHub,
 *  Merge, Jira, Recht …) tut die Hauptsitzung selbst → „erledigt“ mit Beleg, oder „abgelehnt“ (Gegenprüfung 06.11.). */
export const ERTEILBAR = new Set(['zugang', 'entscheidung']);

/** Antworten (nur wenn noch offen — kein Doppelklick). Reihenfolge nach der Gegenprüfung 06.11.: erst die Freigabe in der Brücke
 *  (scheitert sie, bleibt der Bedarf offen), dann der Status, dann die Nachricht (scheitert sie, wieder offen — Wiederholen geht). */
export async function bedarfAntworten(u: User, id: string, a: { antwort: BedarfAntwort; notiz: string; dauerMin?: number }, deps: {
  senden: (u: User, strand: string, text: string) => Promise<unknown>;
  freigabe: (u: User, strand: string, pfad: string, bis: Date) => Promise<string | void>;
  /** Phase 4: Zugang wieder entziehen, wenn die Antwort zurückgerollt wird (sonst bliebe er bis zur Frist, auch nach „Ablehnen“). */
  entziehen?: (u: User, strand: string, pfad: string) => Promise<unknown>;
  col?: () => ReturnType<typeof bedarfCol>;
}, now = Date.now()) {
  const col = deps.col ?? bedarfCol;
  const b: any = await col().findOne({ _id: id as any, userId: u.id });
  if (!b) throw Object.assign(new Error('Diesen Bedarf gibt es nicht.'), { status: 404 });
  if (b.status !== 'offen') throw Object.assign(new Error('Schon beantwortet — Seite neu laden.'), { status: 409 });
  if (a.antwort === 'erteilt' && !ERTEILBAR.has(b.art)) throw Object.assign(new Error('Erteilen gibt es nur für Zugang und Entscheidung — sonst selbst erledigen („Erledigt“ mit Beleg) oder „Ablehnen“.'), { status: 400 });
  const bis = b.art === 'zugang' && a.antwort === 'erteilt' ? zugangBis(a.dauerMin ?? 240, now) : null;
  const real = bis ? (await deps.freigabe(u, b.strand.id, b.pfad, bis)) || b.pfad : b.pfad;
  const entziehen = async () => { if (bis) await deps.entziehen?.(u, b.strand.id, real).catch(() => null); };
  const r = await col().updateOne({ _id: id as any, status: 'offen' }, { $set: { status: a.antwort, notiz: a.notiz.slice(0, 1000), antwortAt: new Date(now), ...(bis ? { bis, pfadReal: real } : {}) } });
  if (!r.modifiedCount) { await entziehen(); throw Object.assign(new Error('Schon beantwortet — Seite neu laden.'), { status: 409 }); }
  try { await deps.senden(u, b.strand.id, bedarfAntwortText({ ...b, pfad: real }, a.antwort, a.notiz, bis)); }
  catch (e) { await col().updateOne({ _id: id as any }, { $set: { status: 'offen' }, $unset: { antwortAt: '', notiz: '', bis: '', pfadReal: '' } }); await entziehen(); throw e; }
  return { id, status: a.antwort, bis };
}
