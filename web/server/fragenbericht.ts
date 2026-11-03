// Werkbank 2.0, D5 aus Paket 436 (Knut 03.11.: „bereits entschiedene Fragen automatisch schließen, damit die 58 schrumpfen“).
// Ein Unter-Chat stellt ein Fragenpaket (D1…Dn) und vermerkt die Entscheidungen später im Kopf seines Berichts
// (`fragen: - id: D1 … antwort: "…"`), z. B. „nach 24 h automatisch angenommen“. Die Rückfragen in Knuts Liste blieben trotzdem
// offen — Knut sah „11 offen“, der Agent sagte „3“. Hier: Fragen des Pakets, deren D-Gegenstück im Bericht eine Antwort hat, schließen
// sich mit Grund und Log-Zeile, ohne den Agenten anzuschreiben (er kennt die Entscheidung schon). Zuordnung nur über die Reihenfolge
// im Fragenpaket und nur, wenn die Anzahl übereinstimmt — sonst nichts (nie raten).
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

/** Paar-Zuordnung Fragenpaket[i] ↔ Bericht D(i+1); nur bei gleicher Anzahl und fortlaufenden Kennungen D1…Dn. */
export function entschiedeneFragen(paketFragen: string[], berichtFragen: BerichtFrage[]): { qid: string; d: string; antwort: string }[] {
  if (!paketFragen.length || paketFragen.length !== berichtFragen.length) return [];
  if (!berichtFragen.every((f, i) => String(f.id).trim().toUpperCase() === `D${i + 1}`)) return [];
  const out: { qid: string; d: string; antwort: string }[] = [];
  berichtFragen.forEach((f, i) => { const a = istEntschieden(f.antwort); if (a) out.push({ qid: paketFragen[i], d: `D${i + 1}`, antwort: a }); });
  return out;
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
  const offen: any[] = await col.find({ userId, status: 'offen', 'paket.id': { $exists: true, $ne: null } }, { projection: { _id: 1, paket: 1, strand: 1, title: 1 } }).limit(500).toArray();
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
    for (const e of entschiedeneFragen(fp.fragen.map(String), bf).filter((x) => offenIds.has(x.qid))) {
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
