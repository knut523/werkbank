// Best-of-N-Bauen (council-bestofn-0811.md + Nachtrag): bei normalem Bauen laufen zwei Bauer (glm-5.3-flash, deepseek-v4.1-flash) parallel
// auf demselben Plan, je im eigenen Worktree. Schutzzonen → Opus, ein Bauer. Die Auswahl braucht kein Claude: Schnellprüfung (tsc/lint/Tests),
// Tamper-Guard, dann kleinerer Diff, Gleichstand → glm-flash. Voller Build/Tests nur am Sieger. Alles Äußere (Bauen, Prüfen, Ledger) wird injiziert.
// Abschalten: BRIDGE_BESTOFN=aus (oder automatisch: Zweitbauer gewinnt < 15 % nach 30 Läufen).
import { exec } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { FLASH, DEEPSEEK, GLM } from './modellwahl.ts';

type Env = Record<string, string | undefined>;
export const OPUS = 'opus';
export const bestofnAn = (env: Env = process.env) => String(env.BRIDGE_BESTOFN ?? '').trim().toLowerCase() !== 'aus';

// ---- Schutzzonen -------------------------------------------------------------------------------------------------------------------
export const SCHUTZZONEN = ['**/migrations/**', '**/auth/**', '**/billing/**', '**/abrechnung/**', '**/payment/**', '.github/workflows/**', '**/.env*', '.env*'];
/** Glob-Liste aus BRIDGE_SCHUTZZONEN (kommagetrennt), sonst die Vorgabe. */
export const schutzzonen = (env: Env = process.env) => { const l = (env.BRIDGE_SCHUTZZONEN ?? '').split(',').map((x) => x.trim()).filter(Boolean); return l.length ? l : SCHUTZZONEN; };
const globRe = (g: string) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0002').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0001/g, '(?:.*/)?').replace(/\u0002/g, '.*') + '$');
export const inSchutzzone = (dateien: string[], env: Env = process.env) => { const re = schutzzonen(env).map(globRe); return dateien.some((d) => re.some((r) => r.test(d.replace(/^\.\//, '')))); };

/** Welche Bauer für diese Änderung: Schutzzone → Opus allein; sonst beide Flash-Bauer (oder nur glm-flash, wenn Best-of-N aus ist). */
export function bauerFuer(dateien: string[], env: Env = process.env, stat?: Statistik): string[] {
  if (inSchutzzone(dateien, env)) return [OPUS];
  return bestofnAn(env) && !(stat && abgeschaltet(stat, env)) ? [FLASH, DEEPSEEK] : [FLASH];
}

// ---- Tamper-Guard ------------------------------------------------------------------------------------------------------------------
const TESTDATEI = /(^|\/)(test|tests|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]*\.py$|_test\.(py|go)$/;
const SKIP = /\.(skip|only|todo)\b|\b(xit|xdescribe|xtest)\s*\(|@pytest\.mark\.(skip|xfail)|\bt\.skip\(|\bit\.skip\b|\bdescribe\.skip\b/;
/**
 * Import-/Export-Zeilen dürfen sich ändern. Unified Diff gegen die Basis: Gründe, warum der Bauer Tests angefasst hat (leer = sauber). Neue Testdateien/hinzugefügte Tests sind erlaubt,
 * entfernte oder geänderte Zeilen in bestehenden Testdateien und jeder Skip-Marker nicht.
 */
export function tamperGruende(diff: string): string[] {
  const g: string[] = [];
  let datei = '', neu = false, imp = false;
  for (const z of diff.split('\n')) {
    const h = z.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (h) { datei = h[2]; neu = false; imp = false; continue; }
    if (z.startsWith('new file mode')) { neu = true; continue; }
    if (z.startsWith('deleted file mode') && TESTDATEI.test(datei)) { g.push(`${datei}: Testdatei gelöscht`); datei = ''; continue; }
    if (!TESTDATEI.test(datei) || z.startsWith('+++') || z.startsWith('---')) continue;
    const inhalt = z.slice(1);
    // Import-/Re-Export-Zeilen (auch mehrzeilig) dürfen sich ändern — neue Funktion mitimportiert ist kein Tamper.
    const kopfZeile = /^\s*(import\b|export\s*(\*|\{))/.test(inhalt);
    if (kopfZeile && !/\bfrom\b|^\s*import\s+['"]/.test(inhalt)) imp = true;
    const istImport = kopfZeile || imp || /^\s*\}\s*from\b/.test(inhalt);
    if (imp && /\bfrom\b/.test(inhalt)) imp = false;
    if (istImport && !z.startsWith('+')) continue;
    if (z.startsWith('-') && !neu) g.push(`${datei}: Zeile entfernt/geändert („${z.slice(1, 60).trim()}“)`);
    else if (z.startsWith('+') && SKIP.test(z)) g.push(`${datei}: Skip-Marker („${z.slice(1, 60).trim()}“)`);
  }
  return g;
}

// ---- Auswahl -----------------------------------------------------------------------------------------------------------------------
export interface BauErgebnis { bauer: string; ok: boolean; diff: string; log?: string }
export interface Schnell { tsc: boolean; lint: boolean; tests: boolean; repro?: boolean; log?: string }
export interface Kandidat extends BauErgebnis { schnell?: Schnell }
export const diffGroesse = (diff: string) => diff.split('\n').filter((z) => /^[+-](?![+-]{2})/.test(z)).length;
/** Warum ein Kandidat ausscheidet, oder '' wenn er im Rennen bleibt. */
export function ausschluss(k: Kandidat): string {
  if (!k.ok) return `Bau fehlgeschlagen${k.log ? `: ${k.log.slice(0, 200)}` : ''}`;
  const t = tamperGruende(k.diff);
  if (t.length) return `Tamper-Guard: ${t.slice(0, 3).join('; ')}`;
  const s = k.schnell;
  if (!s) return 'keine Schnellprüfung';
  if (!s.tsc) return 'tsc rot';
  if (!s.lint) return 'lint rot';
  if (!s.tests) return 'betroffene Tests rot';
  if (s.repro === false) return 'Repro-Test rot';
  return '';
}
/** Rein: im Rennen verbliebene Kandidaten, bester zuerst (kleinster Diff, Gleichstand → glm-flash), plus die Ausgeschiedenen. */
export function rangfolge(ks: Kandidat[]): { im: Kandidat[]; abgelehnt: { bauer: string; grund: string }[] } {
  const abgelehnt: { bauer: string; grund: string }[] = [];
  const im: Kandidat[] = [];
  for (const k of ks) { const g = ausschluss(k); g ? abgelehnt.push({ bauer: k.bauer, grund: g }) : im.push(k); }
  im.sort((a, b) => diffGroesse(a.diff) - diffGroesse(b.diff) || (a.bauer === FLASH ? -1 : 0) - (b.bauer === FLASH ? -1 : 0));
  return { im, abgelehnt };
}
/** Rein: Sieger = erster der Rangfolge. */
export function waehle(ks: Kandidat[]): { sieger: Kandidat | null; abgelehnt: { bauer: string; grund: string }[] } {
  const { im, abgelehnt } = rangfolge(ks);
  for (const k of im.slice(1)) abgelehnt.push({ bauer: k.bauer, grund: `größerer Diff (${diffGroesse(k.diff)} gegen ${diffGroesse(im[0].diff)})` });
  return { sieger: im[0] ?? null, abgelehnt };
}

// ---- Semaphor für schwere Prüfläufe ------------------------------------------------------------------------------------------------
export const maxPruefLaeufe = (env: Env = process.env) => { const n = Math.floor(Number(env.BRIDGE_PRUEFLAEUFE)); return Number.isFinite(n) && n >= 1 ? n : 3; };
export class Semaphor {
  private frei: number; private warten: (() => void)[] = []; spitze = 0; private laufend = 0;
  readonly max: number;
  constructor(max = maxPruefLaeufe()) { this.max = max; this.frei = max; }
  get wartend() { return this.warten.length; }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.frei > 0) this.frei--; else await new Promise<void>((r) => this.warten.push(r));
    this.spitze = Math.max(this.spitze, ++this.laufend);
    try { return await fn(); } finally { this.laufend--; const n = this.warten.shift(); n ? n() : this.frei++; }
  }
}
export const pruefSemaphor = new Semaphor();
/** Hilfs-Prüfer für die Praxis: Befehl im Worktree, grün bei Exit 0; läuft über den Semaphor. */
export const shellPruefung = (cwd: string, befehl: string, sem = pruefSemaphor) => sem.run(() => new Promise<{ ok: boolean; log: string }>((res) =>
  exec(befehl, { cwd, timeout: 15 * 60_000, maxBuffer: 8 << 20 }, (e, so, se) => res({ ok: !e, log: (String(so) + String(se)).slice(-4000) }))));

// ---- Statistik und Abschaltregel ---------------------------------------------------------------------------------------------------
export interface Statistik { laeufe: number; zweitSiege: number }
export const neueStatistik = (): Statistik => ({ laeufe: 0, zweitSiege: 0 });
/** Zweitbauer = deepseek. Nur Läufe mit zwei Bauern zählen. */
export function zaehle(s: Statistik, sieger: string | null) { s.laeufe++; if (sieger === DEEPSEEK) s.zweitSiege++; }
/** Ledger-Ereignis je Lauf: bauerEreignisse.on('lauf', ({id, bauer, sieger, abgelehnt}) => …) — verdrahtet der Integrator (verbrauch.ts). */
export const bauerEreignisse = new EventEmitter();
export const emittiereLauf: NonNullable<Deps['ledger']> = (e) => { try { bauerEreignisse.emit('lauf', e); } catch { /* Hörer darf den Bau nicht stören */ } };
export function statistikLaden(pfad: string): Statistik {
  try { const j = JSON.parse(readFileSync(pfad, 'utf8')); const l = Math.floor(Number(j.laeufe)), z = Math.floor(Number(j.zweitSiege)); if (l >= 0 && z >= 0 && z <= l) return { laeufe: l, zweitSiege: z }; } catch { /* keine oder kaputte Datei */ }
  return neueStatistik();
}
/** Atomar (tmp + rename, wie schlange.ts); ein Schreibfehler stört den Bau nicht. */
export function statistikSpeichern(pfad: string, s: Statistik): void {
  try { writeFileSync(pfad + '.tmp', JSON.stringify(s)); renameSync(pfad + '.tmp', pfad); } catch { /* Speicherstand läuft weiter */ }
}
export function abgeschaltet(s: Statistik, env: Env = process.env): boolean {
  if (!bestofnAn(env)) return true;
  return s.laeufe >= 30 && s.zweitSiege / s.laeufe < 0.15;
}

// ---- Rennen, Verlierer-Retry, Eskalation -------------------------------------------------------------------------------------------
export interface Auftrag { id: string; plan: string; dateien: string[] }
export interface Deps {
  bauen(bauer: string, a: Auftrag, o?: { fehlerlogs?: string[] }): Promise<BauErgebnis>;
  schnell(k: BauErgebnis, a: Auftrag): Promise<Schnell>;
  /** Voller Build + volle Tests, nur am Sieger (über den Semaphor). */
  voll?(k: BauErgebnis, a: Auftrag): Promise<{ ok: boolean; log: string }>;
  ledger?(e: { id: string; bauer: string[]; sieger: string | null; abgelehnt: { bauer: string; grund: string }[] }): void;
  jetzt?(): number;
}
export interface Lauf { auftrag: Auftrag; sieger: BauErgebnis | null; verlierer?: { bauer: string; diff: string; at: number; benutzt?: boolean }; fixrunden: number; logs: string[] }
export const VERLIERER_MS = 24 * 3600_000;

const pruefe = async (d: Deps, a: Auftrag, r: BauErgebnis): Promise<Kandidat> =>
  r.ok ? { ...r, schnell: await d.schnell(r, a).catch((e) => ({ tsc: false, lint: false, tests: false, log: String(e) })) } : r;

/** Ein Best-of-N-Lauf: bauen (parallel), prüfen, wählen; scheitern alle → glm-5.3 mit allen Fehlerlogs. Ledger-Hook je Lauf. */
export async function rennen(d: Deps, a: Auftrag, o: { env?: Env; stat?: Statistik } = {}): Promise<Lauf> {
  const bauer = bauerFuer(a.dateien, o.env, o.stat);
  const ks = await Promise.all(bauer.map(async (b) => pruefe(d, a, await d.bauen(b, a).catch((e) => ({ bauer: b, ok: false, diff: '', log: String(e) })))));
  const rf = rangfolge(ks);
  let abgelehnt = rf.abgelehnt, sieger: Kandidat | null = null;
  const lauf: Lauf = { auftrag: a, sieger: null, fixrunden: 0, logs: [] };
  const rote = new Set<Kandidat>();
  for (const k of rf.im) {   // voller Lauf nur am Sieger; rot → nächster der Rangfolge
    const v = d.voll ? await d.voll(k, a).catch((e) => ({ ok: false, log: String(e) })) : { ok: true, log: '' };
    if (v.ok) { sieger = k; break; }
    rote.add(k);
    abgelehnt = abgelehnt.concat({ bauer: k.bauer, grund: `voller Lauf rot: ${v.log.slice(-200)}` });
    lauf.logs.push(`${k.bauer}: voller Lauf rot\n${v.log.slice(-1500)}`);
  }
  if (sieger) for (const k of rf.im) if (k !== sieger && !rote.has(k)) abgelehnt = abgelehnt.concat({ bauer: k.bauer, grund: `größerer Diff (${diffGroesse(k.diff)} gegen ${diffGroesse(sieger.diff)})` });
  lauf.sieger = sieger;
  if (bauer.length === 2) zaehle(o.stat ?? neueStatistik(), sieger?.bauer ?? null);
  if (!sieger && bauer[0] !== OPUS) {
    const logs = lauf.logs.concat(abgelehnt.map((x) => `${x.bauer}: ${x.grund}`), ks.map((k) => k.schnell?.log ?? k.log ?? '').filter(Boolean));
    const k = await pruefe(d, a, await d.bauen(GLM, a, { fehlerlogs: logs }).catch((e) => ({ bauer: GLM, ok: false, diff: '', log: String(e) })));
    bauer.push(GLM); lauf.logs = logs;
    const w = waehle([k]); sieger = w.sieger; abgelehnt = abgelehnt.concat(w.abgelehnt); lauf.sieger = sieger;
  }
  const verl = rf.im.find((k) => k !== sieger && !rote.has(k)); // nur sauber geprüfte Verlierer taugen als Retry
  if (verl) lauf.verlierer = { bauer: verl.bauer, diff: verl.diff, at: (d.jetzt ?? Date.now)() };
  d.ledger?.({ id: a.id, bauer, sieger: sieger?.bauer ?? null, abgelehnt });
  return lauf;
}

export type Folge = { art: 'verlierer'; bauer: string; diff: string } | { art: 'fix'; bauer: string } | { art: 'eskalation'; bauer: string; fehlerlogs: string[] };
/** Rein: was folgt, wenn das Review den Sieger ablehnt. Erst der Verlierer-Diff (24 h), dann Fixrunden; nach 2 abgelehnten Fixrunden → glm-5.3. */
export function nachAblehnung(l: Lauf, grund: string, jetzt = Date.now()): Folge {
  l.logs.push(grund);
  const v = l.verlierer;
  if (v && !v.benutzt && jetzt - v.at <= VERLIERER_MS) { v.benutzt = true; return { art: 'verlierer', bauer: v.bauer, diff: v.diff }; }
  if (l.sieger?.bauer === GLM || l.sieger?.bauer === OPUS) return { art: 'fix', bauer: l.sieger.bauer };
  l.fixrunden++;
  return l.fixrunden > 2 ? { art: 'eskalation', bauer: GLM, fehlerlogs: l.logs } : { art: 'fix', bauer: l.sieger?.bauer ?? FLASH };
}
