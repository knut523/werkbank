// Nutzung messen (Plan 213 S0, Council K5/K4/P8): welche Seiten wer (nur Rolle) wie oft öffnet, über welchen Weg
// Antworten kommen (Oberfläche, Chat-Knopf, Unter-Chat), und ob jemand den Workspace direkt oder im Chat aufruft.
// Gezählt wird je Tag in der Collection `nutzung` — keine Inhalte, keine Personen-IDs, keine Ticket- oder Paketnamen.
// Grundlage für „erst messen, dann umziehen“: kein Umzug und keine Entfernung, bevor 14 Tage Zahlen da sind.

import { wb } from './db.ts';
import { log } from './log.ts';

export type Rolle = 'admin' | 'team';
export type Weg = 'ui' | 'chat-knopf' | 'unterchat' | 'hauptchat';
export type Zugang = 'chat' | 'direkt';

/** Seiten, die gezählt werden — alles andere fällt unter „andere“, damit keine freien Texte in die Zählung kommen. */
const SEITEN = new Set(['heute', 'uebersicht', 'inbox', 'arbeit', 'arbeit/unterchats', 'arbeit/reviews', 'arbeit/tickets', 'roadmap', 'sprint', 'board', 'ziele',
  'timebox', 'wissen', 'dateien', 'ablage', 'skills', 'einrichtung', 'einstellungen', 'leitstand', 'chat']);

/** `#/roadmap/prs` → `roadmap`, `#/wissen/olaf/x.md` → `wissen`, `#/arbeit/reviews` → `arbeit/reviews`. */
export function seiteAus(hash: unknown): string {
  const teile = String(hash ?? '').replace(/^#?\/?/, '').split(/[/?~]/).filter(Boolean);
  if (!teile.length) return 'heute';
  const zwei = `${teile[0]}/${teile[1] ?? ''}`.toLowerCase();
  if (SEITEN.has(zwei)) return zwei;
  const eins = teile[0].toLowerCase();
  return SEITEN.has(eins) ? eins : 'andere';
}

export const rolleVon = (u: { role?: string }): Rolle => (u.role === 'ADMIN' ? 'admin' : 'team');
/** Über den Chat (LibreChat-Proxy setzt `x-forwarded-prefix: /werkbank`) oder direkt auf dem Workspace-Port. */
export const zugangVon = (headers: Record<string, unknown>): Zugang => (String(headers['x-forwarded-prefix'] ?? '') === '/werkbank' ? 'chat' : 'direkt');

const tagVon = (d = new Date()) => d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });

// Gesammelt im Speicher, alle 60 s (und beim Lesen) gebündelt geschrieben — eine Seitenansicht kostet keinen DB-Zugriff.
const offen = new Map<string, number>();
let timer: NodeJS.Timeout | null = null;
function merke(art: string, schluessel: Record<string, string>) {
  const k = JSON.stringify({ tag: tagVon(), art, ...schluessel });
  offen.set(k, (offen.get(k) ?? 0) + 1);
  if (!timer) { timer = setTimeout(() => { timer = null; void schreibe().catch((e) => log('nutzung', { error: String(e?.message ?? e).slice(0, 160) })); }, 60_000); timer.unref?.(); }
}

export async function schreibe(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = null; }
  const jetzt = [...offen.entries()];
  offen.clear();
  if (!jetzt.length) return;
  try {
    await wb().collection('nutzung').bulkWrite(jetzt.map(([k, n]) => ({ updateOne: { filter: JSON.parse(k), update: { $inc: { n } }, upsert: true } })), { ordered: false });
  } catch (e) {
    // Nichts verlieren: zurück in den Puffer (begrenzt), beim nächsten Takt erneut.
    if (offen.size < 5_000) for (const [k, n] of jetzt) offen.set(k, (offen.get(k) ?? 0) + n);
    throw e;
  }
}

export function seiteGesehen(hash: unknown, rolle: Rolle, zugang: Zugang) { merke('seite', { seite: seiteAus(hash), rolle, zugang }); }
/** Arten von Antworten — feste Liste, damit nie freier Text aus einer Anfrage in die Zählung kommt (Pass C). */
const ARTEN = new Set(['rueckfrage', 'entscheidung', 'braucht', 'nacharbeit', 'abhaken', 'push', 'pflege', 'inbox']);
/** Eine Antwort auf eine Frage/Entscheidung: art = Art der Frage (rueckfrage, entscheidung, braucht, push, pflege, …). */
export function antwortGezaehlt(art: string, weg: Weg) { const a = String(art).toLowerCase(); merke('antwort', { frage: ARTEN.has(a) ? a : 'andere', weg }); }

export interface NutzungsZeile { tag: string; art: string; n: number; seite?: string; rolle?: Rolle; zugang?: Zugang; frage?: string; weg?: Weg }

/** Auswertung der letzten `tage` Tage: Summen je Seite/Rolle/Zugang und je Antwortweg, dazu die Zahl der Tage mit Daten. */
export async function auswertung(tage = 14, now = new Date()) {
  await schreibe();
  const ab = tagVon(new Date(now.getTime() - (tage - 1) * 86_400_000));
  const zeilen = await wb().collection<NutzungsZeile>('nutzung').find({ tag: { $gte: ab } }, { projection: { _id: 0 } }).toArray();
  const seiten: Record<string, { admin: number; team: number; chat: number; direkt: number }> = {};
  const antworten: Record<string, Partial<Record<Weg, number>>> = {};
  for (const z of zeilen) {
    if (z.art === 'seite' && z.seite) {
      const s = (seiten[z.seite] ??= { admin: 0, team: 0, chat: 0, direkt: 0 });
      s[z.rolle ?? 'team'] += z.n; s[z.zugang ?? 'direkt'] += z.n;
    } else if (z.art === 'antwort' && z.frage && z.weg) {
      const a = (antworten[z.frage] ??= {});
      a[z.weg] = (a[z.weg] ?? 0) + z.n;
    }
  }
  const tageMitDaten = new Set(zeilen.map((z) => z.tag)).size;
  return { ab, tage, tageMitDaten, genug: tageMitDaten >= 14, seiten, antworten };
}
