// Regeln aus Reviews (Plan 274, Zusatz A — Knut 20.10.2026: „Regeltreue verbessern, neue Regeln von Christoph sollen automatisch
// reinkommen“). Der PR-Ticker hängt jedes neue Review/jeden neuen Kommentar eines Reviewers von der Erlaubtliste als JSON-Zeile an
// `<WERKBANK_REGEL_DIR>/quellen/reviews-neu.jsonl` an (Felder wie christoph-reviews-30d.jsonl: repo, pr, title, art, state, at,
// body, inline[]; dazu id, url, von). Bei neuen Zeilen und sonst einmal am Tag läuft `<WERKBANK_REGEL_DIR>/regel-vorschlag.sh`;
// jeder neue Vorschlag wird eine Rückfrage an Knut (Heute › Entscheidungen) und eine Meldung im Hauptchat. „Übernehmen“ schreibt
// die Regel nach `quellen/regeln-bestaetigt.jsonl` — dort liest das Pre-Push-Gate (Paket 276) sie.
//
// Schnittstelle regel-vorschlag.sh (wird parallel gebaut; tolerant gelesen): Aufruf `regel-vorschlag.sh <reviews-neu.jsonl>`,
// Exit 0; Ausgabe JSON (Liste oder { vorschlaege: [...] }, je { titel, regel | text, begruendung?, belege? }) oder Zeilen
// „VORSCHLAG: <titel> — <regel>“. Fehlt das Skript, werden nur die Zeilen gesammelt.

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { wb } from './db.ts';

/** Ordner des Pre-Push-Gates (live: ~/work/knut/tools/pre-push-gate, gesetzt vom Release-Skript). Leer = aus — Tests und
 *  Instanzen ohne das Werkzeug schreiben so nie in eine fremde Datei. */
export const regelDir = (env = process.env): string | null => (env.WERKBANK_REGEL_DIR ? String(env.WERKBANK_REGEL_DIR) : null);
const unter = (env: NodeJS.ProcessEnv, ...teile: string[]) => { const d = regelDir(env); return d ? join(d, ...teile) : null; };
export const reviewsNeuDatei = (env = process.env) => unter(env, 'quellen', 'reviews-neu.jsonl');
export const bestaetigtDatei = (env = process.env) => unter(env, 'quellen', 'regeln-bestaetigt.jsonl');
export const vorschlagSkript = (env = process.env) => unter(env, 'regel-vorschlag.sh');
export const regelCol = () => wb().collection('regel_reviews');

export interface RegelZeile { repo: string; pr: number; title: string; art: 'review' | 'kommentar'; state?: string; at: string; body: string; inline: { path: string; line: number | null; body: string }[]; id: string; url: string; von: string }

/** Neue Reviews/Kommentare von Reviewern der Erlaubtliste (nie die eigenen) ab `ab` als Zeilen (rein). */
export function regelZeilen(prs: any[], ab: string, allow: string[], me: string): RegelZeile[] {
  const ok = new Set(allow.map((a) => a.toLowerCase()));
  const ich = me.toLowerCase();
  const out: RegelZeile[] = [];
  for (const p of prs) {
    const voll = String(p.repository?.nameWithOwner ?? '');
    if (!voll || !p.number) continue;
    const basis = { repo: voll.split('/').pop()!, pr: Number(p.number), title: String(p.title ?? '') };
    const wer = (x: any) => String(x?.author?.login ?? '').toLowerCase();
    for (const r of p.reviews?.nodes ?? []) {
      const von = wer(r);
      if (!r?.id || !r.submittedAt || r.submittedAt < ab || !ok.has(von) || von === ich || r.state === 'PENDING') continue;
      const inline = (r.comments?.nodes ?? []).filter((c: any) => c?.body).map((c: any) => ({ path: String(c.path ?? ''), line: c.line ?? c.originalLine ?? null, body: String(c.body) }));
      if (!String(r.body ?? '').trim() && !inline.length) continue;   // leeres „Approve“ ohne Text: nichts zu lernen
      out.push({ ...basis, art: 'review', state: String(r.state ?? ''), at: r.submittedAt, body: String(r.body ?? ''), inline, id: String(r.id), url: String(r.url ?? p.url ?? ''), von });
    }
    for (const c of p.comments?.nodes ?? []) {
      const von = wer(c);
      if (!c?.id || !c.createdAt || c.createdAt < ab || !ok.has(von) || von === ich || !String(c.body ?? '').trim()) continue;
      out.push({ ...basis, art: 'kommentar', at: c.createdAt, body: String(c.body), inline: [], id: String(c.id), url: String(c.url ?? p.url ?? ''), von });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/** Neue Zeilen anhängen — genau einmal je GitHub-Kennung (Mongo als Gedächtnis, die Datei bleibt append-only). */
export async function regelAnhaengen(zeilen: RegelZeile[], now = new Date(), datei = reviewsNeuDatei()): Promise<number> {
  if (!zeilen.length || !datei || !existsSync(dirname(dirname(datei)))) return 0;   // aus bzw. Werkzeug nicht eingerichtet: nichts schreiben
  mkdirSync(dirname(datei), { recursive: true });
  let n = 0;
  for (const z of zeilen) {
    // Erst die Datei, dann das Gedächtnis (Gegenprüfung): bricht es dazwischen ab, gibt es höchstens eine doppelte Zeile (über `id`
    // erkennbar) statt einer für immer verlorenen.
    if (await regelCol().findOne({ _id: z.id as any }, { projection: { _id: 1 } })) continue;
    appendFileSync(datei, JSON.stringify(z) + '\n');
    try { await regelCol().insertOne({ _id: z.id as any, at: now, repo: z.repo, pr: z.pr }); } catch (e: any) { if (e?.code !== 11000) throw e; }
    n++;
  }
  return n;
}

export interface Vorschlag { titel: string; regel: string; begruendung?: string; belege?: string[] }

/** Ausgabe von regel-vorschlag.sh lesen (rein): JSON-Liste, { vorschlaege: [] } oder „VORSCHLAG: titel — regel“-Zeilen. */
export function parseVorschlaege(stdout: string): Vorschlag[] {
  const t = String(stdout ?? '').trim();
  if (!t) return [];
  const norm = (x: any): Vorschlag | null => {
    const titel = String(x?.titel ?? x?.title ?? '').trim().slice(0, 120);
    const regel = String(x?.regel ?? x?.text ?? x?.rule ?? '').trim().slice(0, 1500);
    if (!titel && !regel) return null;
    return { titel: titel || regel.slice(0, 80), regel: regel || titel, ...(x?.begruendung ? { begruendung: String(x.begruendung).slice(0, 800) } : {}), ...(Array.isArray(x?.belege) ? { belege: x.belege.map(String).slice(0, 5) } : {}) };
  };
  try {
    const j = JSON.parse(t);
    const liste = Array.isArray(j) ? j : Array.isArray(j?.vorschlaege) ? j.vorschlaege : [];
    return liste.map(norm).filter(Boolean) as Vorschlag[];
  } catch { /* Textform */ }
  return t.split('\n').map((l) => l.match(/^\s*VORSCHLAG:\s*(.+?)(?:\s+[—–-]\s+(.+))?\s*$/)).filter(Boolean)
    .map((m) => norm({ titel: m![1], regel: m![2] ?? m![1] })).filter(Boolean) as Vorschlag[];
}

/** Stabile Kennung eines Vorschlags (gleiche Regel = keine zweite Rückfrage). */
export const vorschlagKey = (v: Vorschlag) => `regel-${createHash('sha256').update(v.regel.toLowerCase().replace(/\s+/g, ' ')).digest('hex').slice(0, 12)}#R`;

/** Läuft das Skript jetzt? Neue Zeilen → ja; sonst einmal am Tag (rein). */
export const vorschlagFaellig = (neu: number, letzter: Date | null | undefined, now = Date.now()) => neu > 0 || !letzter || now - new Date(letzter).getTime() >= 24 * 3600_000;

export interface VorschlagDeps {
  /** Rückfrage anlegen (askKnut); null = gab es schon (Schlüssel). */
  frage: (v: Vorschlag, key: string) => Promise<string | null>;
  melde: (text: string) => Promise<unknown>;
  laufe?: (skript: string, datei: string) => Promise<string>;
  log?: (m: string, d?: any) => void;
}

const laufeSkript = (skript: string, datei: string) => new Promise<string>((ok, nein) =>
  execFile(skript, [datei], { timeout: 180_000, maxBuffer: 4 << 20, env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', LANG: 'C.UTF-8' } }, (e, out) => (e ? nein(e) : ok(String(out)))));

/** Ein Vorschlags-Lauf: Skript (falls vorhanden) → neue Vorschläge als Rückfragen + eine Meldung im Hauptchat. */
export async function regelVorschlaege(deps: VorschlagDeps, o: { neu: number; now?: number; env?: NodeJS.ProcessEnv } = { neu: 0 }): Promise<{ lauf: boolean; neu: string[]; fehler?: string }> {
  const env = o.env ?? process.env;
  const now = o.now ?? Date.now();
  const skript = vorschlagSkript(env), datei = reviewsNeuDatei(env);
  if (!skript || !datei || !existsSync(skript) || !existsSync(datei)) return { lauf: false, neu: [] };
  const st: any = await wb().collection('meta').findOne({ _id: 'regel_vorschlag' as any });
  if (!vorschlagFaellig(o.neu, st?.at, now)) return { lauf: false, neu: [] };
  await wb().collection('meta').updateOne({ _id: 'regel_vorschlag' as any }, { $set: { at: new Date(now) } }, { upsert: true });
  let out: string;
  try { if (!(statSync(skript).mode & 0o111)) throw new Error('regel-vorschlag.sh ist nicht ausführbar'); out = await (deps.laufe ?? laufeSkript)(skript, datei); }
  catch (e: any) { const fehler = String(e?.message ?? e).slice(0, 300); deps.log?.('regel-vorschlag fehler', { fehler }); return { lauf: true, neu: [], fehler }; }
  const neu: string[] = [];
  for (const v of parseVorschlaege(out).slice(0, 10)) {
    const id = await deps.frage(v, vorschlagKey(v)).catch(() => null);
    if (id) neu.push(id);
  }
  if (neu.length) await deps.melde(`${neu.length} neue Regel-Vorschläge aus den Reviews (${neu.join(', ')}) — Knut bestätigt sie in Heute › Entscheidungen („Übernehmen“/„Verwerfen“).`).catch(() => {});
  deps.log?.('regel-vorschlag', { neu: neu.length });
  return { lauf: true, neu };
}

/** „Übernehmen“: die Regel als Zeile nach regeln-bestaetigt.jsonl (das Pre-Push-Gate liest sie). */
export function regelBestaetigen(v: Vorschlag & { key?: string; frage?: string }, von: string, now = new Date(), datei = bestaetigtDatei()): boolean {
  if (!datei || !existsSync(dirname(dirname(datei)))) return false;
  mkdirSync(dirname(datei), { recursive: true });
  appendFileSync(datei, JSON.stringify({ at: now.toISOString(), von, titel: v.titel, regel: v.regel, ...(v.begruendung ? { begruendung: v.begruendung } : {}), ...(v.key ? { key: v.key } : {}), ...(v.frage ? { frage: v.frage } : {}) }) + '\n');
  return true;
}
