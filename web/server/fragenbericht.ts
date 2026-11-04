// Werkbank 2.0, D5 aus Paket 436 (Knut 03.11.: „bereits entschiedene Fragen automatisch schließen, damit die 58 schrumpfen“).
// Ein Unter-Chat stellt ein Fragenpaket (D1…Dn) und vermerkt die Entscheidungen später im Kopf seines Berichts
// (`fragen: - id: D1 … antwort: "…"`), z. B. „nach 24 h automatisch angenommen“. Die Rückfragen in Knuts Liste blieben trotzdem
// offen — Knut sah „11 offen“, der Agent sagte „3“. Hier: Fragen des Pakets, deren D-Gegenstück im Bericht eine Antwort hat, schließen
// sich mit Grund und Log-Zeile, ohne den Agenten anzuschreiben (er kennt die Entscheidung schon). Zuordnung nur über die Reihenfolge
// im Fragenpaket und nur, wenn die Anzahl übereinstimmt und jedes Paar inhaltlich passt (Council C1) — sonst nichts (nie raten).
// Automatisch Geschlossenes ist in 2.0 sichtbar und mit einem Klick wieder offen (C2); wieder Geöffnetes schließt sich nie erneut.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { wb } from './db.ts';

export interface BerichtFrage { id: string; frage?: string; antwort?: unknown }

/** Steht im Bericht eine Antwort, die eine Entscheidung ist (nicht leer, nicht „offen …“)? */
export function istEntschieden(antwort: unknown): string | null {
  const a = String(antwort ?? '').trim();
  if (!a || /^offen\b/i.test(a) || /^(\?|-|—|tbd|todo)$/i.test(a)) return null;
  return a.slice(0, 300);
}

const FUELL = new Set(['soll', 'sollen', 'sollte', 'welche', 'welcher', 'welches', 'oder', 'nicht', 'wird', 'werden', 'wenn', 'dann', 'auch', 'noch', 'eine', 'einen',
  'einer', 'eines', 'dass', 'über', 'sich', 'sind', 'haben', 'kann', 'können', 'nach', 'beim', 'damit', 'diese', 'dieser', 'dieses', 'schon', 'jetzt', 'heute', 'frage', 'knut', 'bitte']);
/** Kernwörter (ab 4 Buchstaben, ohne Füllwörter), auf 5 Zeichen gekürzt — „laufenden“ und „laufender“ zählen gleich. */
const kern = (t: string) => new Set(String(t ?? '').toLowerCase().split(/[^a-zäöüß0-9]+/).filter((w) => w.length >= 4 && !FUELL.has(w)).map((w) => w.slice(0, 5)));

const ANTEIL = 0.75;

/** C1: Passt die Frage im Bericht inhaltlich zur Rückfrage? Mindestens ein Drittel der Kernwörter der kürzeren Seite gemeinsam (mindestens eins). */
export function passtInhalt(berichtFrage: string, frageText: string): boolean {
  const a = kern(berichtFrage), b = kern(frageText);
  if (!a.size || !b.size) return false;
  const gemeinsam = [...a].filter((w) => b.has(w)).length;
  return gemeinsam >= Math.max(1, Math.ceil(Math.min(a.size, b.size) / 3));
}

/** Paar-Zuordnung Fragenpaket[i] ↔ Bericht D(i+1); nur bei gleicher Anzahl, fortlaufenden Kennungen D1…Dn und wenn mindestens drei Viertel
 *  der Paare inhaltlich passen (die Zuordnung stimmt). Geschlossen wird nur ein Paar, das selbst passt — ein unpassendes bleibt offen.
 *  ponytail: C1 präzisiert nach der Datenkopie (Paket 416: 11 von 12 passen, D4 nur sinngemäß „EEG/BEG“ = „Energiegemeinschaften“); Schwelle ANTEIL. */
export function entschiedeneFragen(paketFragen: { id: string; text: string }[], berichtFragen: BerichtFrage[]): { qid: string; d: string; antwort: string }[] {
  const passt = zuordnung(paketFragen, berichtFragen);
  if (!passt) return [];
  const out: { qid: string; d: string; antwort: string }[] = [];
  berichtFragen.forEach((f, i) => { const a = istEntschieden(f.antwort); if (a && passt[i]) out.push({ qid: paketFragen[i].id, d: `D${i + 1}`, antwort: a }); });
  return out;
}

/** Gilt die Zuordnung Fragenpaket[i] ↔ Bericht D(i+1)? Gleiche Anzahl, D1…Dn fortlaufend, ≥ ¾ der Paare passen inhaltlich (C1).
 *  Liefert je Paar „passt“ — oder null, wenn die Zuordnung nicht gilt. */
export function zuordnung(paketFragen: { id: string; text: string }[], berichtFragen: BerichtFrage[]): boolean[] | null {
  if (!paketFragen.length || paketFragen.length !== berichtFragen.length) return null;
  if (!berichtFragen.every((f, i) => String(f.id).trim().toUpperCase() === `D${i + 1}`)) return null;
  const passt = berichtFragen.map((f, i) => passtInhalt(String(f.frage ?? ''), paketFragen[i].text));
  return passt.filter(Boolean).length < Math.ceil(passt.length * ANTEIL) ? null : passt;
}

export interface AbgleichZeile { qid: string; d: string; bericht: string | null; wiederOffen: boolean }
export interface Abgleich { zeilen: AbgleichZeile[]; offenListe: string[]; offenBericht: string[]; agentNennt: string[]; widerspruch: boolean }

/** Paket 436, Runde 4 (Knut B2 „Netzentgelte: Seite 5 offen, Agent nur D4 — wem glaube ich?“): Quelle der Wahrheit ist deine Liste —
 *  nur dorthin geht eine Antwort an den Agenten. Daneben, was der Bericht und der letzte Stand des Agenten als offen nennen, damit ein
 *  Widerspruch sichtbar ist statt still. Nur bei gültiger Zuordnung (wie D5); sonst null (nie raten). Rein. */
export function fragenAbgleich(paket: { id: string; text: string; status: string; autoOffen?: boolean }[], bericht: BerichtFrage[], stand: string): Abgleich | null {
  if (!zuordnung(paket, bericht)) return null;
  const zeilen: AbgleichZeile[] = [], offenListe: string[] = [], offenBericht: string[] = [];
  paket.forEach((q, i) => {
    const d = `D${i + 1}`, a = istEntschieden(bericht[i]?.antwort);
    if (!a) offenBericht.push(d);
    if (q.status !== 'offen') return;
    offenListe.push(d);
    zeilen.push({ qid: q.id, d, bericht: a, wiederOffen: !!q.autoOffen });
  });
  const zeile = /^\s*[-*]?\s*\**Braucht Knut:?\**:?\s*(.+)$/im.exec(stand ?? '')?.[1] ?? '';
  const agentNennt = [...new Set([...zeile.matchAll(/\bD(\d{1,2})\b/g)].map((m) => `D${m[1]}`))];
  const gleich = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
  return { zeilen, offenListe, offenBericht, agentNennt, widerspruch: !gleich(offenListe, offenBericht) || (!!zeile && !gleich(offenListe, agentNennt)) };
}

/** Fragen-Kopf eines Berichts lesen; null, wenn nicht da oder unlesbar. */
export function berichtFragen(reviewDir: string, paket: string): BerichtFrage[] | null {
  if (!/^\d{1,4}-[a-z0-9][a-z0-9-]*$/.test(paket)) return null;
  const p = join(reviewDir, paket, 'bericht.md');
  if (!existsSync(p)) return null;
  try {
    const m = readFileSync(p, 'utf8').match(/^---\n([\s\S]*?)\n---/);
    const h = m ? YAML.parse(m[1]) : null;
    return Array.isArray(h?.fragen) ? h.fragen : null;
  } catch { return null; }
}

/** Ein Durchgang für eine Person: offene Paket-Fragen schließen, die der Bericht schon entschieden hat. Liefert die geschlossenen. */
export async function fragenAusBericht(userId: string, reviewDir: string, o: { dry?: boolean; now?: number } = {}): Promise<{ id: string; d: string; antwort: string }[]> {
  const col = wb().collection('orchestrator_questions');
  const offen: any[] = await col.find({ userId, status: 'offen', autoOffen: { $ne: true }, 'paket.id': { $exists: true, $ne: null } }, { projection: { _id: 1, paket: 1, strand: 1, title: 1 } }).limit(500).toArray();
  const jePaket = new Map<string, any[]>();
  for (const q of offen) jePaket.set(String(q.paket.id), [...(jePaket.get(String(q.paket.id)) ?? []), q]);
  const out: { id: string; d: string; antwort: string }[] = [];
  for (const [pid, qs] of jePaket) {
    const fp: any = await wb().collection('fragenpakete').findOne({ _id: pid as any, userId });
    const strand = qs[0]?.strand?.id;
    const run: any = strand ? await wb().collection('orchestrator_runs').findOne({ _id: String(strand) as any, userId }, { projection: { paket: 1 } }) : null;
    const bf = fp && run?.paket ? berichtFragen(reviewDir, String(run.paket)) : null;
    if (!fp || !Array.isArray(fp.fragen) || !bf) continue;
    const offenIds = new Set(qs.map((q) => String(q._id)));
    const ids = fp.fragen.map(String);
    const texte = new Map((await col.find({ _id: { $in: ids as any[] }, userId }, { projection: { title: 1, context: 1 } }).toArray()).map((q: any) => [String(q._id), `${q.title ?? ''} ${String(q.context ?? '').slice(0, 300)}`]));
    for (const e of entschiedeneFragen(ids.map((id: string) => ({ id, text: texte.get(id) ?? '' })), bf).filter((x) => offenIds.has(x.qid))) {
      if (!o.dry) {
        const grund = `im Bericht als entschieden vermerkt (${e.d}): ${e.antwort}`;
        const r = await col.updateOne({ _id: e.qid as any, userId, status: 'offen' }, { $set: { status: 'zurückgezogen', withdrawnAt: new Date(o.now ?? Date.now()), withdrawnBy: 'auto', withdrawnReason: grund.slice(0, 400) }, $unset: { keyActive: '' } });
        if (!r.modifiedCount) continue;
        const q = qs.find((x) => String(x._id) === e.qid);
        await wb().collection('entscheidungs_log').insertOne({ userId, at: new Date(o.now ?? Date.now()), auto: true, durch: 'werkbank', antwort: `automatisch geschlossen: ${grund}`.slice(0, 500), frage: String(q?.title ?? ''), kennung: e.qid, ids: [e.d] } as any).catch(() => {});
      }
      out.push({ id: e.qid, d: e.d, antwort: e.antwort });
    }
  }
  return out;
}

/** Abgleich für einen Unter-Chat: sein Fragenpaket (das mit den meisten Fragen dieses Unter-Chats), Status je Frage, Bericht-Kopf. */
export async function abgleichFuer(userId: string, strandId: string, reviewDir: string, stand: string): Promise<Abgleich | null> {
  const col = wb().collection('orchestrator_questions');
  const qs: any[] = await col.find({ userId, 'strand.id': strandId, 'paket.id': { $exists: true, $ne: null } }, { projection: { paket: 1 } }).limit(200).toArray();
  if (!qs.length) return null;
  const n = new Map<string, number>();
  for (const q of qs) n.set(String(q.paket.id), (n.get(String(q.paket.id)) ?? 0) + 1);
  const pid = [...n].sort((a, b) => b[1] - a[1])[0][0];
  const [fp, run]: any[] = await Promise.all([wb().collection('fragenpakete').findOne({ _id: pid as any, userId }), wb().collection('orchestrator_runs').findOne({ _id: strandId as any, userId }, { projection: { paket: 1 } })]);
  const bf = fp && Array.isArray(fp.fragen) && run?.paket ? berichtFragen(reviewDir, String(run.paket)) : null;
  if (!bf) return null;
  const ids = fp.fragen.map(String);
  const je = new Map((await col.find({ _id: { $in: ids as any[] }, userId }, { projection: { title: 1, context: 1, status: 1, autoOffen: 1 } }).toArray()).map((q: any) => [String(q._id), q]));
  return fragenAbgleich(ids.map((id: string) => { const q: any = je.get(id) ?? {}; return { id, text: `${q.title ?? ''} ${String(q.context ?? '').slice(0, 300)}`, status: String(q.status ?? ''), autoOffen: q.autoOffen === true }; }), bf, stand);
}

/** C2: was in den letzten Tagen automatisch geschlossen wurde (beide Wege: R32 und Bericht), neueste zuerst. */
export async function automatischGeschlossen(userId: string, o: { tage?: number; now?: number } = {}): Promise<{ id: string; titel: string; grund: string; at: Date }[]> {
  const seit = new Date((o.now ?? Date.now()) - (o.tage ?? 7) * 86400_000);
  const qs: any[] = await wb().collection('orchestrator_questions').find({ userId, status: 'zurückgezogen', withdrawnBy: 'auto', withdrawnAt: { $gte: seit } }, { projection: { title: 1, withdrawnReason: 1, withdrawnAt: 1 } })
    .sort({ withdrawnAt: -1 }).limit(50).toArray();
  return qs.map((q) => ({ id: String(q._id), titel: String(q.title ?? ''), grund: String(q.withdrawnReason ?? ''), at: q.withdrawnAt }));
}

/** C2: eine automatisch geschlossene Frage wieder öffnen — nur eigene, nur automatisch geschlossene. Danach schließt sie sich nie wieder von selbst. */
export async function wiederOeffnen(userId: string, id: string, o: { now?: number } = {}): Promise<boolean> {
  const col = wb().collection('orchestrator_questions');
  const q: any = await col.findOne({ _id: id as any, userId, status: 'zurückgezogen', withdrawnBy: 'auto' });
  if (!q) return false;
  const da = q.key ? await col.findOne({ userId, keyActive: q.key }) : null;
  const setze = (mitKey: boolean) => col.updateOne({ _id: id as any, userId, status: 'zurückgezogen', withdrawnBy: 'auto' },
    { $set: { status: 'offen', autoOffen: true, ...(mitKey ? { keyActive: q.key } : {}) }, $unset: { withdrawnAt: '', withdrawnBy: '', withdrawnReason: '' } });
  // Schlüssel nur zurück, wenn frei; belegt ihn jemand im selben Moment (Unique-Index), öffnet die Frage ohne Schlüssel (Pass C, F2).
  const r = await setze(!!q.key && !da).catch((e: any) => { if (e?.code === 11000) return setze(false); throw e; });
  if (!r.modifiedCount) return false;
  await wb().collection('entscheidungs_log').insertOne({ userId, at: new Date(o.now ?? Date.now()), wiederOffen: true, durch: 'knut', antwort: 'wieder geöffnet (war automatisch geschlossen)', frage: String(q.title ?? ''), kennung: id, ids: [] } as any).catch(() => {});
  return true;
}
