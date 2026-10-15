// Schattenbetrieb Planer–Umsetzer im PR-Ticker (Plan 183, Council 180, P4/P5/P7): neben dem Auto-Review läuft — eingeschaltet
// (Ticker-Schalter „Schatten-Review“) oder auf Knopfdruck — der Weg glm-5.3 plant → jcode + Flash prüft → Zitatprüfung → Urteil.
// Ergebnis an `pr_reviews.schatten` und als `schatten.md` im Review-Paket; NIE gepostet, es gibt hier keine Posten-Funktion.
// Ein Lauf zur Zeit, im Hintergrund (der Minutentakt wartet nicht); Claim mit Kennung, Ergebnis nur mit gültigem Claim.

import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { wb } from './db.ts';
import { reviewsCol, tickerSettings } from './prticker.ts';
import { prepareWorktree, klonDir, mitKlonSperre, realGit, scrub, type GitRun } from './prreview.ts';
import { reviewDir } from './bericht.ts';
import {
  planerReview, passendeFallstricke, nachbarRepos, diffOhneLock, schattenMarkdown, realJcode, jcodeBin, AUSFALLPFAD, FALLSTRICKE_START,
  type ChatFn, type JcodeFn, type Fallstrick, type PlanerErgebnis,
} from './planer.ts';
import type { Faktor } from './melious.ts';

export const fallstrickeCol = () => wb().collection('planer_fallstricke');

/** P2: Fallstrick-Liste; beim ersten Lesen mit dem Startwert (Zählpunkt 31/33) gefüllt. */
export async function ladeFallstricke(): Promise<Fallstrick[]> {
  await fallstrickeCol().updateOne({ _id: 'start-zaehlpunkt' as any }, { $setOnInsert: { text: FALLSTRICKE_START[0].text, repos: FALLSTRICKE_START[0].repos, stichworte: FALLSTRICKE_START[0].stichworte, quelle: 'olaf-admin#343 (Opus-Review, Kalibrierung 178)', at: new Date(0) } }, { upsert: true });
  return (await fallstrickeCol().find({}).sort({ at: 1 }).limit(200).toArray()).map((f: any) => ({ text: String(f.text), repos: f.repos ?? [], stichworte: f.stichworte ?? [] }));
}

const liste = (v: unknown, re: RegExp) => (Array.isArray(v) ? v : String(v ?? '').split(/[\s,]+/)).map((x) => String(x).trim()).filter((x) => re.test(x)).slice(0, 10);
/** P2: bestätigten Befund als Fallstrick merken (Knut, Knopf in der Schatten-Ansicht). */
export async function fallstrickMerken(by: { id: string; name: string }, b: any): Promise<{ id: string }> {
  const text = String(b?.text ?? '').trim().slice(0, 600);
  if (text.length < 20) throw Object.assign(new Error('Fallstrick: Text (mind. 20 Zeichen) fehlt.'), { status: 400 });
  const repos = liste(b?.repos, /^([\w.-]{1,100}\/)?[\w.-]{1,100}$/).map((r) => r.split('/').pop()!);
  const stichworte = liste(b?.stichworte, /^[\wäöüÄÖÜß.-]{3,40}$/);
  if (!repos.length && !stichworte.length) throw Object.assign(new Error('Fallstrick: mindestens ein Repo oder Stichwort.'), { status: 400 });
  const id = `fs-${randomBytes(4).toString('hex')}`;
  await fallstrickeCol().insertOne({ _id: id as any, text, repos, stichworte, quelle: String(b?.quelle ?? '').slice(0, 200), by: by.name, at: new Date() });
  return { id };
}

// P5: nicht für Migrationen, Auth, Geld/Tarif — an Pfaden und (Migration) am Inhalt; Mindestgröße ohne Lock-Dateien.
const P5_PFAD: [RegExp, string][] = [
  // Review R10: auch `db-migrations/`, `migrate.py`, Alembic/Flyway/Liquibase/Knex-Ordner und das Prisma-Schema.
  [/(^|\/)([\w-]*migrations?|migrate[\w-]*|alembic|flyway|liquibase|knex)(\/|\.|$)|\.sql$|(^|\/)schema\.prisma$/i, 'Migration'],
  [/(^|\/)(auth|login|logout|session|oauth|middleware)[\w.-]*(\/|$)|(^|\/)(auth|middleware|session)\.[jt]sx?$/i, 'Auth'],
  [/tarif|tariff|preis|price|pricing|billing|abrechnung|rechnung|invoice|payment|zahlung/i, 'Geld/Tarif'],
];
const P5_INHALT: [RegExp, string][] = [
  [/^\+.*\b((ALTER|CREATE|DROP)\s+TABLE|DROP\s+(INDEX|TRIGGER|POLICY|COLUMN))\b/im, 'Migration (SQL im Diff)'],
  [/^\+.*\b(create_table|drop_table|add_column|createTable|dropTable|alterTable)\s*\(/m, 'Migration (Schema-Aufruf im Diff)'],
];
export const P5_MIN_ZEICHEN = 1500;
export function p5Grund(dateien: string[], diff: string): string | null {
  const gruende = new Set<string>();
  for (const f of dateien) for (const [re, g] of P5_PFAD) if (re.test(f)) gruende.add(`${g} (${f})`);
  for (const [re, g] of P5_INHALT) if (re.test(diff)) gruende.add(g);
  if (diffOhneLock(diff).length < P5_MIN_ZEICHEN) gruende.add(`Diff zu klein (< ${P5_MIN_ZEICHEN} Zeichen ohne Lock-Dateien)`);
  return gruende.size ? `P5: ${[...gruende].slice(0, 4).join('; ')}` : null;
}

/** Knopf „Schatten-Review starten“: aus keinem/abgeschlossenem Zustand → wartet. Läuft einer, passiert nichts. */
export async function schattenAnstossen(id: string, by: string, now = new Date()): Promise<boolean> {
  const r = await reviewsCol().updateOne({ _id: id as any, $or: [{ schatten: null }, { schatten: { $exists: false } }, { 'schatten.status': { $in: ['fertig', 'fehler', 'ausgefallen', 'übersprungen'] } }] },
    { $set: { schatten: { status: 'wartet', at: now, by } } });
  return r.modifiedCount > 0;
}

export interface SchattenDeps {
  userById: (id: string) => Promise<any>;
  chatFor: (u: any) => ChatFn;
  keyFor: (u: any) => Promise<string | null>;
  faktorenFor: (u: any) => Promise<Record<string, Faktor>>;
  prInfo: (repo: string, n: number) => Promise<{ state: string; head: string; base: string; body: string } | null>;
  recordZug?: (u: any, raw: any) => Promise<void>;
  git?: GitRun;
  jcode?: JcodeFn;
  jcodeDa?: () => boolean;
  log?: (m: string, d: Record<string, unknown>) => void;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
}

const STALE_MS = 45 * 60_000;
let laeuft: Promise<void> | null = null;
/** Für Tests: auf den laufenden Hintergrundlauf warten. */
export const schattenLaeuft = () => laeuft;

/** Ein Takt: Hängengebliebene beenden, dann höchstens einen wartenden Lauf im Hintergrund starten. */
export async function schattenTick(deps: SchattenDeps): Promise<{ started: number }> {
  const now = deps.now?.() ?? new Date();
  await reviewsCol().updateMany({ 'schatten.status': 'läuft', 'schatten.startedAt': { $lt: new Date(now.getTime() - STALE_MS) } },
    { $set: { 'schatten.status': 'fehler', 'schatten.fehler': 'nach 45 min nicht fertig (Neustart?) — neu anstoßen', 'schatten.doneAt': now } });
  if (laeuft) return { started: 0 };
  // Schalter aus → nur noch von Hand angestoßene Läufe (mit `by`); automatisch eingereihte warten (Review R7, Rückweg).
  const an = (await tickerSettings()).schatten;
  const token = randomBytes(6).toString('hex');
  const r: any = await reviewsCol().findOneAndUpdate({ 'schatten.status': 'wartet', ...(an ? {} : { 'schatten.by': { $exists: true } }) }, { $set: { 'schatten.status': 'läuft', 'schatten.token': token, 'schatten.startedAt': now } }, { sort: { 'schatten.at': 1 }, returnDocument: 'after' });
  const doc = r && 'value' in r && !('_id' in r) ? r.value : r;   // mongodb 6: Dokument direkt
  if (!doc) return { started: 0 };
  laeuft = schattenLauf(doc, token, deps).catch((e) => deps.log?.('schatten fehler', { pr: `${doc.repo}#${doc.number}`, error: scrub(e?.message ?? e) })).finally(() => { laeuft = null; });
  return { started: 1 };
}

/** Ergebnis schreiben — nur solange der eigene Claim gilt (Plan-Challenge 6). */
async function setze(id: any, token: string, set: Record<string, unknown>): Promise<boolean> {
  const sch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(set)) sch[`schatten.${k}`] = v;
  const r = await reviewsCol().updateOne({ _id: id, 'schatten.token': token, 'schatten.status': 'läuft' }, { $set: sch });
  return r.modifiedCount > 0;
}

export async function schattenLauf(r: any, token: string, deps: SchattenDeps): Promise<void> {
  const g = deps.git ?? realGit;
  const env = deps.env ?? process.env;
  const ende = async (status: string, extra: Record<string, unknown>) => { await setze(r._id, token, { status, doneAt: deps.now?.() ?? new Date(), ...extra }); };
  const u = await deps.userById(r.ownerId);
  if (!u) return ende('fehler', { fehler: 'Besitzer des Auto-Reviews nicht gefunden' });
  const key = await deps.keyFor(u);
  if (!key) return ende('ausgefallen', { fehler: `kein Melious-Schlüssel · ${AUSFALLPFAD}` });
  if (!(deps.jcodeDa ?? (() => existsSync(jcodeBin(env))))()) return ende('ausgefallen', { fehler: `jcode nicht installiert (${jcodeBin(env)}) · ${AUSFALLPFAD}` });
  const pr = await deps.prInfo(r.repo, r.number).catch(() => null);
  if (!pr) return ende('fehler', { fehler: 'PR-Stand nicht lesbar' });
  if (pr.state !== 'OPEN') return ende('übersprungen', { fehler: `PR ${pr.state === 'MERGED' ? 'gemergt' : 'geschlossen'}` });
  if (pr.head !== r.head) return ende('übersprungen', { fehler: `neuer Stand ${pr.head.slice(0, 7)} seit dem Review` });
  if (!/^[\w./-]{1,100}$/.test(pr.base) || pr.base.includes('..')) return ende('fehler', { fehler: 'Basis-Branch ungültig' });
  let wt: string | null = null;
  try {
    wt = await prepareWorktree(r.repo, r.number, r.head, g, undefined, '-schatten');
    await mitKlonSperre(klonDir(r.repo), () => g(['fetch', '--no-tags', 'origin', `+refs/heads/${pr.base}:refs/remotes/origin/${pr.base}`], klonDir(r.repo)));
    const basis = String(await g(['merge-base', 'HEAD', `origin/${pr.base}`], wt)).trim();
    const [diff, diffStat, namen] = await Promise.all([g(['diff', `${basis}...HEAD`], wt), g(['diff', '--stat', `${basis}...HEAD`], wt), g(['diff', '--name-only', `${basis}...HEAD`], wt)]);
    const p5 = p5Grund(String(namen).split('\n').filter(Boolean), String(diff));
    if (p5 && env.WERKBANK_SCHATTEN_P5 !== 'messen') return await ende('übersprungen', { fehler: p5 });
    const erg: PlanerErgebnis = await planerReview({ chat: deps.chatFor(u), jcode: deps.jcode ?? realJcode, key, faktoren: await deps.faktorenFor(u) }, {
      dir: wt, basis, diff: String(diff), diffStat: String(diffStat), ziel: `Code-Review ${r.repo}#${r.number} am Stand ${r.head.slice(0, 7)}: ${r.title ?? ''}`,
      prText: pr.body, fallstricke: passendeFallstricke(await ladeFallstricke(), r.repo, String(diff)), nachbarn: nachbarRepos(r.repo, env),
    });
    for (const s of erg.stufen) await deps.recordZug?.(u, { conv: `schatten-${String(r._id).slice(0, 50)}`, art: 'worker', phase: `schatten-${s.stufe}`, anbieter: 'melious', konto: 'melious', modell: s.modell, input: s.input, output: s.output, energie: s.energie, outcome: erg.status === 'fertig' ? 'ok' : 'fehler', ms: s.ms, aufrufe: s.aufrufe, cache: s.cache, urteil: s.urteil }).catch(() => null);
    const { workerText, ...rest } = erg;
    if (r.paket) { try { writeFileSync(join(reviewDir(), r.paket, 'schatten.md'), schattenMarkdown(erg, `${r.repo}#${r.number} @ ${r.head.slice(0, 7)}`)); } catch { /* Paket weg */ } }
    await ende(erg.status, { ...rest, head: r.head, ...(p5 ? { p5 } : {}), energie: Math.round(erg.stufen.reduce((a, s) => a + s.energie, 0) * 100) / 100 });
    deps.log?.('schatten fertig', { pr: `${r.repo}#${r.number}`, status: erg.status, empfehlung: erg.empfehlung ?? null });
  } catch (e: any) {
    await ende(e?.skip ? 'übersprungen' : 'fehler', { fehler: scrub(e?.message ?? e) });
  } finally {
    if (wt) await mitKlonSperre(klonDir(r.repo), () => g(['worktree', 'remove', '--force', wt!], klonDir(r.repo))).catch(() => null);
  }
}

/** Für die Review-Ansicht: was vom Schattenlauf gezeigt wird (ohne Claim-Kennung). */
export function schattenAnsicht(s: any, hauptEmpfehlung: string | null) {
  if (!s) return null;
  const { token, ...rest } = s;
  return { ...rest, abweichung: hauptEmpfehlung && s.empfehlung ? hauptEmpfehlung !== s.empfehlung : null };
}
