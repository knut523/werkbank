// Messung je Zug und je Delegation (Plan 165, S8): was lief auf welchem Modell, in welcher Phase, mit wie vielen Tokens und wie viel
// Melious-Energie — und wie gut waren die Worker (Fehlschlag-, Verwerfquote). Quelle ist die Brücke (/internal/zug-log,
// /internal/delegation-log); angezeigt in der Melious-Kachel auf der Hauptchat-Seite. Aufbewahrung 30 Tage.

import { wb } from './db.ts';
import type { User } from './auth.ts';

const zuege = () => wb().collection('zug_log');
const delegationen = () => wb().collection('delegationen');
const AUFBEWAHRUNG_S = 30 * 86400;

let indexed = false;
async function ensureIndexes() {
  if (indexed) return;
  indexed = true;
  try {
    await zuege().createIndex({ at: 1 }, { expireAfterSeconds: AUFBEWAHRUNG_S });
    await zuege().createIndex({ userId: 1, at: -1 });
    await delegationen().createIndex({ at: 1 }, { expireAfterSeconds: AUFBEWAHRUNG_S });
    await delegationen().createIndex({ userId: 1, at: -1 });
  } catch { indexed = false; }
}

const str = (v: unknown, n = 120) => (typeof v === 'string' ? v.slice(0, n) : null);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);

/** Ein Zug (Versuch) aus der Brücke: nur Zahlen und Namen, kein Inhalt. */
export async function recordZug(u: User, raw: any, now = Date.now()): Promise<void> {
  if (!raw || typeof raw !== 'object') return;
  await ensureIndexes();
  await zuege().insertOne({
    userId: u.id, at: new Date(now), conv: str(raw.conv, 64), art: ['hauptchat', 'strang', 'worker'].includes(raw.art) ? raw.art : 'strang',
    phase: str(raw.phase, 20), konto: str(raw.konto, 60), anbieter: raw.anbieter === 'melious' ? 'melious' : 'claude', modell: str(raw.modell, 80) ?? '?',
    input: num(raw.input), output: num(raw.output), energie: num(raw.energie), outcome: str(raw.outcome, 20), ms: num(raw.ms),
    delegation: str(raw.delegation, 12), parent: str(raw.parent, 140), kette: raw.kette === true,
    // Plan 183 (P7): Messung je Stufe des Planer–Umsetzer-Wegs — Aufrufe, Cache-Anteil, Urteil der Stufe.
    ...(raw.aufrufe !== undefined ? { aufrufe: num(raw.aufrufe), cache: num(raw.cache), urteil: str(raw.urteil, 120) } : {}),
  } as any);
}

/** Eine Delegation (Start, Ende, Urteil): je Kennung ein Dokument, das letzte Bild gewinnt. */
export async function recordDelegation(u: User, raw: any, now = Date.now()): Promise<void> {
  if (!raw || typeof raw !== 'object' || !/^d-[0-9a-f]{6}$/.test(String(raw.id))) return;
  await ensureIndexes();
  const list = (v: unknown, n: number) => (Array.isArray(v) ? v.slice(0, n).map((x) => String(x).slice(0, 300)) : []);
  await delegationen().updateOne({ _id: `${u.id}:${raw.id}` as any }, {
    $set: {
      userId: u.id, at: new Date(now), id: raw.id, conv: str(raw.conv, 64), rolle: str(raw.rolle, 12), risiko: str(raw.risiko, 10), status: str(raw.status, 16),
      modell: str(raw.modell, 80), konto: str(raw.konto, 60), anbieter: str(raw.anbieter, 10), start: num(raw.start), ende: raw.ende ? num(raw.ende) : null,
      input: num(raw.input), output: num(raw.output), energie: num(raw.energie), abweichungen: list(raw.abweichungen, 12),
      pruefungen: Array.isArray(raw.pruefungen) ? raw.pruefungen.slice(0, 10).map((p: any) => ({ name: String(p?.name ?? '').slice(0, 40), ok: p?.ok === true })) : [],
      prueferUrteil: str(raw.prueferUrteil, 20), aufgabe: str(raw.aufgabe, 200),
      // Meldungen kommen ohne feste Reihenfolge an: ein Urteil wird gesetzt, nie durch ein späteres Bild ohne Urteil gelöscht.
      ...(str(raw.urteil, 20) ? { urteil: str(raw.urteil, 20) } : {}),
    },
  }, { upsert: true });
}

/** Gegenprüfung (challenge) je Unterhaltung zählen — für die Review-Karte „Gegenprüfung n×“. */
export async function recordChallenge(u: User, conv: unknown, art: unknown, ok: boolean): Promise<void> {
  if (typeof conv !== 'string' || !/^[\w-]{8,64}$/.test(conv)) return;
  await wb().collection('orchestrator_runs').updateOne({ userId: u.id, conv }, { $inc: { 'gegenpruefung.n': 1, ...(ok ? { 'gegenpruefung.ok': 1 } : {}), [`gegenpruefung.${art === 'diff' || art === 'plan' || art === 'council' ? art : 'sonst'}`]: 1 }, $set: { 'gegenpruefung.zuletzt': new Date() } });
}

/** Für die Kachel: letzte 24 h je Art × Phase × Modell, Anteil Melious, letzte Delegationen, Quoten je Modell und Rolle (30 Tage). */
export async function messungView(u: User, now = Date.now()) {
  const seit = new Date(now - 24 * 3600_000);
  const zs: any[] = await zuege().find({ userId: u.id, at: { $gte: seit } }).project({ conv: 1, parent: 1, art: 1, phase: 1, modell: 1, anbieter: 1, input: 1, output: 1, energie: 1, kette: 1 }).toArray();
  const gruppen = new Map<string, { art: string; phase: string | null; modell: string; anbieter: string; zuege: number; tokens: number; energie: number; kette: number }>();
  for (const z of zs) {
    const k = `${z.art}|${z.phase ?? ''}|${z.modell}`;
    const g = gruppen.get(k) ?? { art: z.art, phase: z.phase ?? null, modell: z.modell, anbieter: z.anbieter, zuege: 0, tokens: 0, energie: 0, kette: 0 };
    g.zuege++; g.tokens += (z.input ?? 0) + (z.output ?? 0); g.energie += z.energie ?? 0; if (z.kette) g.kette++;
    gruppen.set(k, g);
  }
  const tokens = zs.reduce((a, z) => a + (z.input ?? 0) + (z.output ?? 0), 0);
  const tokensMel = zs.filter((z) => z.anbieter === 'melious').reduce((a, z) => a + (z.input ?? 0) + (z.output ?? 0), 0);
  const worker = zs.filter((z) => z.art === 'worker').reduce((a, z) => a + (z.input ?? 0) + (z.output ?? 0), 0);
  // Je Strang: Lead-Tokens gegen Worker-Tokens (lohnt das Delegieren?). parent der Worker = „person:strang“.
  const strang = new Map<string, { conv: string; lead: number; worker: number }>();
  for (const z of zs) {
    const c = z.art === 'worker' ? String(z.parent ?? '').split(':').pop() : z.art === 'strang' ? z.conv : null;
    if (!c) continue;
    const s = strang.get(c) ?? { conv: c, lead: 0, worker: 0 };
    s[z.art === 'worker' ? 'worker' : 'lead'] += (z.input ?? 0) + (z.output ?? 0);
    strang.set(c, s);
  }
  const ds: any[] = await delegationen().find({ userId: u.id }).sort({ start: -1 }).limit(200).toArray();
  const quoten = new Map<string, { modell: string; rolle: string; n: number; fehlgeschlagen: number; verworfen: number; abweichung: number }>();
  for (const d of ds.filter((x) => x.status !== 'laeuft')) {
    const k = `${d.modell ?? '?'}|${d.rolle}`;
    const q = quoten.get(k) ?? { modell: d.modell ?? '?', rolle: d.rolle, n: 0, fehlgeschlagen: 0, verworfen: 0, abweichung: 0 };
    q.n++; if (d.status === 'fehlgeschlagen') q.fehlgeschlagen++; if (d.urteil === 'verworfen') q.verworfen++; if ((d.abweichungen ?? []).length) q.abweichung++;
    quoten.set(k, q);
  }
  return {
    seit: seit.toISOString(),
    zuege: [...gruppen.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 20),
    summe: { zuege: zs.length, tokens, anteilMelious: tokens ? Math.round((tokensMel / tokens) * 100) : 0, workerTokens: worker, leadTokens: tokens - worker },
    delegationen: ds.slice(0, 8).map((d) => ({ id: d.id, rolle: d.rolle, risiko: d.risiko, status: d.status, modell: d.modell, energie: d.energie, tokens: (d.input ?? 0) + (d.output ?? 0),
      dauerMin: d.ende && d.start ? Math.max(1, Math.round((d.ende - d.start) / 60000)) : null, pruefungen: d.pruefungen ?? [], abweichungen: (d.abweichungen ?? []).length, prueferUrteil: d.prueferUrteil ?? null, urteil: d.urteil ?? null, aufgabe: d.aufgabe ?? '' })),
    quoten: [...quoten.values()].sort((a, b) => b.n - a.n).slice(0, 10).map((q) => ({ ...q, fehlPct: Math.round((q.fehlgeschlagen / q.n) * 100), verwPct: Math.round((q.verworfen / q.n) * 100) })),
    straenge: [...strang.values()].filter((s) => s.worker > 0).sort((a, b) => b.worker - a.worker).slice(0, 5),
  };
}
