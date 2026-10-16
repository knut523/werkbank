// Chief of Staff, S3.2 Budget je Strang und S3.3 Lebenszeichen (docs/plan-chief-of-staff.md; K7, D2, D3). Alles deterministisch, kein Modell.
//
// Budget: Verbrauch = Eingabe ohne Cache-Lesen + Cache-Schreiben + Ausgabe (K7), summiert über den Strang und seine Worker (zug_log). Melious-
// Energie wird getrennt ausgewiesen (delegationen), nicht in Tokens umgerechnet. Das Budget kommt vom Start (`orch start --budget`), sonst aus
// ORCH_BUDGET_TOKENS (Vorgabe 0 = aus, D3). ≥ 80 %: einmal eine Meldung an den Hauptchat + Zeile auf der Karte; ≥ 100 %: `autoStopped` mit
// cause 'budget' (die automatische Fortsetzung hält an) und eine Rückfrage „Weiter mit +50 % / Anhalten“. ponytail: Ein laufender Zug endet noch
// (Grenze 40 Schritte / 15 min bleibt); einen harten Abbruch mitten im Zug gibt es erst bei Bedarf.
//
// Lebenszeichen: der Takt ermittelt aus dem Stand je Strang „hängt?“ (läuft, aber seit ORCH_HAENGT_MIN (20) Minuten ohne Aktivität) und „still“
// (weder fertig noch laufend, ohne Aktivität seit 2 h, ohne offene Rückfrage). Gemeldet wird einmal je Zustand und Strang; „nichts zu melden“
// ist der Normalfall und kostet nichts.

import { randomUUID } from 'node:crypto';
import { wb } from './db.ts';
import { runs, questions, STRANDS, OPEN } from './orchestrator.ts';
import { meldeLeitstand } from './leitstand.ts';
import type { User } from './auth.ts';

// ---------- Budget ----------

export interface ZugLite { conv?: string | null; parent?: string | null; art?: string; input?: number; output?: number; cacheRead?: number }
export const budgetEnv = (env = process.env) => (Number(env.ORCH_BUDGET_TOKENS) > 0 ? Math.round(Number(env.ORCH_BUDGET_TOKENS)) : 0);
/** Budget des Strangs: am Strang gesetzt, sonst die Vorgabe; 0 = aus. */
export const budgetVon = (d: { budgetTokens?: unknown } | null | undefined, env = process.env) => (Number(d?.budgetTokens) > 0 ? Math.round(Number(d!.budgetTokens)) : budgetEnv(env));
/** K7: Eingabe ohne Cache-Lesen (zug_log.input enthält sie) + Ausgabe. */
export const tokensVon = (z: ZugLite) => Math.max(0, (z.input ?? 0) - (z.cacheRead ?? 0)) + (z.output ?? 0);

/** Verbrauch je Strang-Unterhaltung: eigene Züge + Worker (parent = „person:strang“). Hauptchat zählt nicht. */
export function verbrauchJeStrang(zs: ZugLite[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const z of zs) {
    const key = z.art === 'worker' ? String(z.parent ?? '').split(':').pop() : z.art === 'hauptchat' ? null : z.conv;
    if (!key) continue;
    m.set(key, (m.get(key) ?? 0) + tokensVon(z));
  }
  return m;
}

export type Stufe = 'aus' | 'ok' | 'warn' | 'stopp';
export const SCHWELLE = { warn: 0.8, stopp: 1 } as const;
export function stufe(tokens: number, budget: number): Stufe {
  if (!(budget > 0)) return 'aus';
  const p = tokens / budget;
  return p >= SCHWELLE.stopp ? 'stopp' : p >= SCHWELLE.warn ? 'warn' : 'ok';
}
export const prozent = (tokens: number, budget: number) => (budget > 0 ? Math.round((tokens / budget) * 100) : 0);
const fmt = (n: number) => n.toLocaleString('de-AT');

export interface BudgetAnzeige { budget: number; tokens: number; prozent: number; stufe: Stufe; energie: number }

export interface Ergebnis { gewarnt: string[]; gestoppt: string[]; angezeigt: number }

/** Takt (eine Minute): Budgets prüfen, Schwellen einmal melden, Anzeige am Strang festhalten. */
export async function budgetTick(deps: { userById: (id: string) => Promise<User | null>; log?: (m: string, d?: any) => void }, now = Date.now()): Promise<Ergebnis> {
  const out: Ergebnis = { gewarnt: [], gestoppt: [], angezeigt: 0 };
  const docs: any[] = await runs().find({ ...STRANDS, ...OPEN, startError: null, conv: { $ne: null }, startedAt: { $gt: new Date(now - 14 * 86400_000) } }).toArray();
  const mitBudget = docs.filter((d) => budgetVon(d) > 0);
  if (!mitBudget.length) return out;
  const seit = new Date(Math.min(...mitBudget.map((d) => new Date(d.startedAt).getTime())));
  const convs = new Set(mitBudget.map((d) => String(d.conv)));
  const zs = ((await wb().collection('zug_log').find({ at: { $gte: seit } }).project({ conv: 1, parent: 1, art: 1, input: 1, output: 1, cacheRead: 1 }).toArray()) as any[]);
  const verbrauch = verbrauchJeStrang(zs);
  const energien = new Map<string, number>();
  for (const x of (await wb().collection('delegationen').find({ conv: { $in: [...convs] } }).project({ conv: 1, energie: 1 }).toArray()) as any[]) energien.set(x.conv, (energien.get(x.conv) ?? 0) + (x.energie ?? 0));
  for (const d of mitBudget) {
    const budget = budgetVon(d), tokens = verbrauch.get(String(d.conv)) ?? 0, st = stufe(tokens, budget);
    const zeigen: BudgetAnzeige = { budget, tokens, prozent: prozent(tokens, budget), stufe: st, energie: energien.get(String(d.conv)) ?? 0 };
    const set: Record<string, unknown> = { 'budget.anzeige': zeigen, 'budget.at': new Date(now) };
    const u = await deps.userById(d.userId).catch(() => null);
    if ((st === 'warn' || st === 'stopp') && !d.budget?.warn80At && (await runs().updateOne({ _id: d._id, 'budget.warn80At': null }, { $set: { 'budget.warn80At': new Date(now) } })).modifiedCount) {
      if (u) await meldeLeitstand(u, d, `Budget zu ${zeigen.prozent} % verbraucht (${fmt(tokens)} von ${fmt(budget)} Tokens) — bei 100 % hält der Unter-Chat an und fragt Knut.`, now).catch(() => {});
      out.gewarnt.push(String(d._id));
    }
    if (st === 'stopp' && !d.autoStopped && !d.budget?.stopAt && u) {
      const at = new Date(now);
      const r = await runs().updateOne({ _id: d._id, autoStopped: null }, { $set: { autoStopped: { at, reason: `Budget erreicht (${fmt(tokens)} von ${fmt(budget)} Tokens)`, cause: 'budget' }, 'budget.stopAt': at } });
      if (r.modifiedCount) {
        const qid = 'q-' + randomUUID().replace(/-/g, '').slice(0, 12);
        try { await questions().insertOne({
          _id: qid, userId: u.id, kind: 'budget', title: `Budget erreicht: „${d.title}“ (${fmt(tokens)} von ${fmt(budget)} Tokens)`.slice(0, 140),
          context: `Der Unter-Chat ${d._id} hat sein Tokenbudget erreicht (Eingabe ohne Cache-Lesen + Ausgabe, mit Workern). Ein laufender Zug endet noch; danach ruht der Chat, bis du entscheidest. Arbeitsordner: ${d.cwd}.`,
          options: [{ label: 'Weiter mit +50 %', consequence: `Hebt das Budget auf ${fmt(Math.ceil(budget * 1.5))} Tokens und schickt „weiter“.` }, { label: 'Anhalten', consequence: 'Der Unter-Chat gilt als geprüft und läuft nicht weiter.' }],
          recommendation: 'Chat ansehen: kommt der Unter-Chat voran und der Rest ist klein, „Weiter mit +50 %“; sonst „Anhalten“ und den Auftrag schärfen.',
          strand: { id: String(d._id), title: d.title, url: d.url }, link: d.url, plan: d.plan ?? null, createdAt: at, status: 'offen', answer: null,
        } as any); } catch (e) { await runs().updateOne({ _id: d._id }, { $set: { autoStopped: null, 'budget.stopAt': null } }); throw e; }   // ohne Rückfrage keine Pause (sonst bliebe der Chat ohne Ausweg stehen)
        deps.log?.('cos budget stopp', { id: d._id, tokens, budget });
        out.gestoppt.push(String(d._id));
      }
    }
    await runs().updateOne({ _id: d._id }, { $set: set });
    out.angezeigt++;
  }
  return out;
}

// ---------- Lebenszeichen ----------

export type Lebenszeichen = 'haengt' | 'still';
export const haengtMin = (env = process.env) => (Number(env.ORCH_HAENGT_MIN) > 0 ? Number(env.ORCH_HAENGT_MIN) : 20);
export const STILL_MIN = 120;

/** Zustand eines Strangs aus seinem festgeschriebenen Stand (rein, testbar). null = alles in Ordnung — der Normalfall. */
export function lebenszeichen(d: { lastStatus?: string | null; lastActivity?: unknown; startedAt?: unknown; lastSentAt?: unknown; autoStopped?: unknown; budget?: { stopAt?: unknown } }, offeneFragen: number, now: number, env = process.env): { zustand: Lebenszeichen; minuten: number } | null {
  const act = new Date((d.lastActivity ?? d.lastSentAt ?? d.startedAt) as any).getTime();
  if (!Number.isFinite(act)) return null;
  const min = Math.floor((now - act) / 60_000);
  const status = d.lastStatus ?? '';
  if (status === 'running') return min >= haengtMin(env) ? { zustand: 'haengt', minuten: min } : null;
  if (status === 'done' || status === 'blocked_g0' || !status) return null;
  if (offeneFragen > 0 || d.autoStopped) return null;   // wartet auf Knut: steht in den Entscheidungen
  return min >= STILL_MIN ? { zustand: 'still', minuten: min } : null;
}

export async function lebenszeichenTick(deps: { userById: (id: string) => Promise<User | null>; log?: (m: string, d?: any) => void }, now = Date.now()): Promise<{ gemeldet: string[]; entwarnt: string[] }> {
  const out = { gemeldet: [] as string[], entwarnt: [] as string[] };
  const docs: any[] = await runs().find({ ...STRANDS, ...OPEN, startError: null, conv: { $ne: null }, startedAt: { $gt: new Date(now - 14 * 86400_000) } }).toArray();
  if (!docs.length) return out;
  const offen = new Map<string, number>();
  for (const q of (await questions().find({ status: 'offen', 'strand.id': { $in: docs.map((d) => d._id) } }).project({ strand: 1 }).toArray()) as any[]) offen.set(String(q.strand.id), (offen.get(String(q.strand.id)) ?? 0) + 1);
  for (const d of docs) {
    const z = lebenszeichen(d, offen.get(String(d._id)) ?? 0, now);
    const alt = d.heartbeat?.zustand ?? null;
    if (!z) {
      if (alt) { await runs().updateOne({ _id: d._id }, { $set: { heartbeat: null } }); out.entwarnt.push(String(d._id)); }   // wieder in Ordnung: beim nächsten Mal wird erneut gemeldet
      continue;
    }
    if (alt === z.zustand) {   // schon gemeldet: nur die Minuten nachführen
      await runs().updateOne({ _id: d._id }, { $set: { 'heartbeat.minuten': z.minuten } });
      continue;
    }
    await runs().updateOne({ _id: d._id }, { $set: { heartbeat: { zustand: z.zustand, minuten: z.minuten, seit: new Date(now) } } });
    const u = await deps.userById(d.userId).catch(() => null);
    if (u) await meldeLeitstand(u, d, z.zustand === 'haengt' ? `hängt? läuft seit ${z.minuten} min ohne Aktivität.` : `still: seit ${Math.round(z.minuten / 60)} h ohne Aktivität und ohne Ergebnis.`, now).catch(() => {});
    deps.log?.('cos lebenszeichen', { id: d._id, zustand: z.zustand, min: z.minuten });
    out.gemeldet.push(String(d._id));
  }
  return out;
}
