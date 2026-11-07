// B1 (Knut 07.11., Release 2.0): Ereignisstrom für die Terminal-Sitzung — `orch inbox` / `orch wait` statt Pollen mit `orch list`.
// Ereignisse: fertig, wartet, blockiert, hängt, Deckel, review_ready (dieselbe Einordnung wie die Hauptchat-Meldung, strandEvent),
// „hängt“ ohne Status-Zeile, Rückfragen der Stränge an Knut und offener Bedarf. Je Person in `orch_ereignisse`, einmal je Schlüssel;
// `wait` blockiert bis zum ersten ungelesenen Ereignis oder bis zum Timeout und quittiert, was es ausgibt. Gesammelt wird beim
// Aufruf (und während `wait` alle paar Sekunden) — kein eigener Takt, nichts läuft, solange niemand fragt.
import { wb } from './db.ts';
import type { User } from './auth.ts';
import { runs, STRANDS, questions, orchStatus, lastMessage, strandStates, type LastMsg, type StrandState } from './orchestrator.ts';
import { strandEvent } from './leitstand.ts';
import { bedarfCol } from './bedarf.ts';

export const ereignisseCol = () => wb().collection('orch_ereignisse');
/** Nur Ereignisse der letzten 6 h (wie das Wecken des Hauptchats) — ein erster Aufruf flutet nicht mit Altem. */
export const FRISCH_MS = 6 * 3600_000;
export const WARTE_MAX_MS = 15 * 60_000;

export interface Ereignis { key: string; kind: string; text: string; excerpt?: string; strand: { id: string; title: string } | null; at: number }

/** Rein: die Ereignisse eines Strangs zu seinem jetzigen Stand. */
export function strangEreignisse(run: any, st: { status: string; reason: string; cause?: string }, s: StrandState | null | undefined, last: LastMsg | null, now = Date.now()): Ereignis[] {
  const strand = { id: String(run._id), title: String(run.title ?? '') };
  const out: Ereignis[] = [];
  const e = strandEvent(run, st, s, last, now);
  if (e) out.push({ key: e.key, kind: e.kind, text: e.text, excerpt: e.excerpt, strand: e.strand ?? strand, at: e.at });
  // „hängt“ ohne Status-Zeile meldet der Auto-Weiter-Takt dem Hauptchat selbst (strandEvent schweigt dazu) — hier als Ereignis.
  if (run.autoStopped?.cause === 'ohne_status') {
    const at = new Date(run.autoStopped.at).getTime();
    out.push({ key: `haengt-os:${strand.id}:${at}`, kind: 'haengt', at, text: String(run.autoStopped.reason ?? 'hängt (ohne Status-Zeile)'), strand });
  }
  return out;
}

type Deps = { strandStates: typeof strandStates; lastMessage: typeof lastMessage };

/** Neue Ereignisse der Person anlegen (einmal je Schlüssel). Liefert die Zahl der neu angelegten. */
export async function sammeln(u: User, now = Date.now(), deps: Deps = { strandStates, lastMessage }): Promise<number> {
  let states: Map<string, any>;
  try { states = await deps.strandStates(u); } catch { states = new Map(); }   // Brücke weg: Stand aus Mongo und LibreChat genügt
  const neu: Ereignis[] = [];
  const strands: any[] = await runs().find({ userId: u.id, ...STRANDS, reviewedAt: null, startError: null, conv: { $ne: null }, status: { $ne: 'blocked_g0' }, startedAt: { $gt: new Date(now - 14 * 86400_000) } }).limit(200).toArray();
  for (const d of strands) {
    const s = states.get(d.conv);
    if (s?.running) continue;
    const last = await deps.lastMessage(u, d.conv).catch(() => null);
    neu.push(...strangEreignisse(d, orchStatus(d, s, last, now), s, last, now));
  }
  const ab = new Date(now - FRISCH_MS);
  for (const q of await questions().find({ userId: u.id, status: 'offen', 'strand.id': { $exists: true, $ne: null }, createdAt: { $gte: ab } }).limit(200).toArray() as any[])
    neu.push({ key: `frage:${q._id}`, kind: 'frage', at: new Date(q.createdAt).getTime(), text: `Rückfrage an Knut: ${String(q.title ?? '')}`, strand: { id: String(q.strand.id), title: String(q.strand.title ?? '') } });
  for (const b of await bedarfCol().find({ userId: u.id, status: 'offen', at: { $gte: ab } }).limit(200).toArray() as any[])
    neu.push({ key: `bedarf:${b._id}`, kind: 'bedarf', at: new Date(b.at).getTime(), text: `Bedarf (${b.art}): ${String(b.text ?? '')}${b.pfad ? ` — ${b.pfad}` : ''} · beantworten: orch_bedarf / 2.0`, strand: b.strand ? { id: String(b.strand.id), title: String(b.strand.title ?? '') } : null });
  let n = 0;
  for (const e of neu) {
    if (!(now - e.at < FRISCH_MS)) continue;
    const r = await ereignisseCol().updateOne({ _id: `${u.id}:${e.key}` as any }, { $setOnInsert: { userId: u.id, key: e.key, kind: e.kind, text: String(e.text).slice(0, 600), excerpt: String(e.excerpt ?? '').slice(0, 1200), strand: e.strand, at: new Date(e.at), createdAt: new Date(now), gelesen: null } }, { upsert: true });
    if (r.upsertedCount) n++;
  }
  return n;
}

export interface EreignisDoc { _id: string; kind: string; text: string; excerpt: string; strand: { id: string; title: string } | null; at: Date; gelesen: Date | null }

let indiziert = false;
/** Pass B: Index für die Warterunden und Aufbewahrung 30 Tage (die Sammlung wuchs sonst unbegrenzt). */
async function ensureIndexes() {
  if (indiziert) return;
  indiziert = true;
  try { await ereignisseCol().createIndex({ userId: 1, gelesen: 1, at: 1 }); await ereignisseCol().createIndex({ createdAt: 1 }, { expireAfterSeconds: 30 * 86400 }); } catch { indiziert = false; }
}

/** Ungelesene Ereignisse, älteste zuerst. */
export async function offeneEreignisse(u: User, limit = 50): Promise<EreignisDoc[]> {
  await ensureIndexes();
  return ereignisseCol().find({ userId: u.id, gelesen: null }).sort({ at: 1, _id: 1 }).limit(limit).toArray() as any;
}

/** Als gelesen markieren: bestimmte Kennungen oder alle. Liefert die Zahl. */
export async function quittieren(u: User, ids: string[] | 'alle', now = Date.now()): Promise<number> {
  const f: any = { userId: u.id, gelesen: null, ...(ids === 'alle' ? {} : { _id: { $in: ids.map(String) } }) };
  return (await ereignisseCol().updateMany(f, { $set: { gelesen: new Date(now) } })).modifiedCount;
}

/** Blockierend: bis ein ungelesenes Ereignis da ist (dann ausgeben und quittieren) oder bis zum Timeout. */
export async function warten(u: User, o: { warteMs: number; intervallMs?: number; sammelnFn?: (u: User) => Promise<unknown>; abgebrochen?: () => boolean }): Promise<{ ereignisse: EreignisDoc[]; timeout: boolean }> {
  const bis = Date.now() + Math.max(0, Math.min(o.warteMs, WARTE_MAX_MS));
  const sam = o.sammelnFn ?? ((x: User) => sammeln(x));
  // Pass B (07.11.): neu sammeln (Brücke + letzte Nachricht je Strang) höchstens alle 15 s, dazwischen nur die Sammlung lesen.
  const sammelAbstand = Math.max(o.intervallMs ?? 3000, o.sammelnFn ? 0 : 15_000);
  let zuletzt = 0;
  for (;;) {
    if (Date.now() - zuletzt >= sammelAbstand) { zuletzt = Date.now(); await sam(u).catch(() => 0); }
    const l = await offeneEreignisse(u);
    // Pass B: nie für einen Aufrufer quittieren, der schon weg ist — sonst wären die Ereignisse verloren.
    if (l.length && o.abgebrochen?.()) return { ereignisse: [], timeout: true };
    if (l.length) { await quittieren(u, l.map((x) => String(x._id))); return { ereignisse: l, timeout: false }; }
    if (Date.now() >= bis || o.abgebrochen?.()) return { ereignisse: [], timeout: true };
    await new Promise((r) => setTimeout(r, Math.min(o.intervallMs ?? 3000, Math.max(0, bis - Date.now()))));
  }
}
