// Delegieren und Phasen-Lead (Plan 165, docs/plan-melious-delegieren.md): reine Bausteine — Abschluss-Block, Übergabedatei (C1),
// Modell-Klassen und Prüferwahl (C6), Phasen-Modelle, Kappungszahlen (C8), Prüfbefehle der Brücke (C6), Unter-Worktree.
// Der Ablauf (Worker starten, warten, Ergebnis) steht in sessions.ts (startDelegation), weil er den Zugablauf mitbenutzt.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, symlinkSync, mkdirSync, statSync, readFileSync, appendFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export type Rolle = 'leser' | 'schreiber' | 'bauer' | 'pruefer';
export const ROLLEN: Rolle[] = ['leser', 'schreiber', 'bauer', 'pruefer'];
export type Phase = 'plan' | 'council' | 'pass-c' | 'push' | 'bau' | 'recherche' | 'review' | 'bericht';
// Variante A (Konzept v2): Opus entscheidet, Sonnet arbeitet.
export const PHASE_MODELL: Record<Phase, 'opus' | 'sonnet'> = {
  plan: 'opus', council: 'opus', 'pass-c': 'opus', push: 'opus',
  bau: 'sonnet', recherche: 'sonnet', review: 'sonnet', bericht: 'sonnet',
};
export const PHASEN = Object.keys(PHASE_MODELL) as Phase[];

// C8: Kappung als Zahlen (eine Stelle, im Plan als Tabelle).
export const KAPPUNG = {
  auftrag: 20_000,          // Zeichen je Auftrag an einen Worker
  ergebnis: 6_000,          // Zeichen Worker-Antwort an den Lead
  uebergabe: 8_000,         // Zeichen Übergabedatei
  schritte: { leser: 30, schreiber: 40, bauer: 80, pruefer: 30 } as Record<Rolle, number>,
  workerFenster: 120_000,   // Kompaktierungsfenster der Worker (Tokens)
  workerKompakt: 70,        // … ab Prozent
  leadKompakt: 80,          // Strang-Leads: Kompaktierung ab Prozent
  maxWorker: 3,             // laufende Worker je Strang (Konzept)
  lohntTokens: 20_000,      // Delegieren lohnt, wenn der Lead sonst mehr Tokens lesen/schreiben würde
  wartenS: 240,             // höchstens so lange wartet delegation_stand
  pruefS: 600, pruefMaxS: 1_800, pruefAusgabe: 2_000,
};

// ---------- Abschluss-Block ----------

export interface Abschluss { ziel: boolean; dateien: string[]; pruefungen: { befehl: string; ausgabe: string }[]; annahmen: string[]; widersprueche: string[]; urteil?: 'ok' | 'maengel' | 'falsch'; befunde?: string[] }

const strs = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Codeblöcke zeilenweise (Zaun ``` mit optionaler Sprache öffnet, nackter ``` schließt) — mit Lage im Text. */
export function codeBlocks(text: string): { lang: string; body: string; start: number; end: number }[] {
  const out: { lang: string; body: string; start: number; end: number }[] = [];
  let pos = 0;
  let open: { lang: string; start: number; bodyStart: number } | null = null;
  for (const line of text.split('\n')) {
    const next = pos + line.length + 1;
    const f = line.match(/^\s*```\s*([\w-]*)\s*$/);
    if (f && !open) open = { lang: f[1], start: pos, bodyStart: next };
    else if (f && open && !f[1]) { out.push({ lang: open.lang, body: text.slice(open.bodyStart, pos), start: open.start, end: Math.min(text.length, next) }); open = null; }
    pos = next;
  }
  return out;
}

/** Letzter Codeblock mit "abschluss" (oder letztes Objekt mit "abschluss") der Antwort; Grund, wenn er fehlt oder ungültig ist. */
export function parseAbschluss(text: string, rolle: Rolle): { ok: true; a: Abschluss; span: [number, number] | null } | { ok: false; why: string } {
  const blk = codeBlocks(text).reverse().find((b) => b.body.includes('"abschluss"'));
  const raw = text.lastIndexOf('{"abschluss"');
  const cand = blk?.body ?? (raw >= 0 ? text.slice(raw) : null);
  const span: [number, number] | null = blk ? [blk.start, blk.end] : raw >= 0 ? [raw, text.length] : null;
  if (!cand) return { ok: false, why: 'Abschluss-Block fehlt' };
  let j: any;
  try { j = JSON.parse(cand.trim()); } catch {
    // Unvollständiges Objekt am Textende: bis zur letzten schließenden Klammer
    try { j = JSON.parse(cand.slice(0, cand.lastIndexOf('}') + 1)); } catch { return { ok: false, why: 'Abschluss-Block ist kein gültiges JSON' }; }
  }
  const a = j?.abschluss;
  if (!a || typeof a !== 'object') return { ok: false, why: 'Feld „abschluss“ fehlt' };
  if (typeof a.ziel !== 'boolean') return { ok: false, why: '„ziel“ muss true oder false sein' };
  for (const k of ['dateien', 'annahmen', 'widersprueche']) if (!strs(a[k])) return { ok: false, why: `„${k}“ muss eine Liste von Texten sein` };
  if (!Array.isArray(a.pruefungen) || !a.pruefungen.every((p: any) => p && typeof p.befehl === 'string' && typeof p.ausgabe === 'string')) return { ok: false, why: '„pruefungen“ muss eine Liste von {befehl, ausgabe} sein' };
  if (rolle === 'pruefer') {
    if (!['ok', 'maengel', 'falsch'].includes(a.urteil)) return { ok: false, why: '„urteil“ muss ok, maengel oder falsch sein' };
    if (!strs(a.befunde)) return { ok: false, why: '„befunde“ muss eine Liste von Texten sein' };
  }
  return { ok: true, a: { ziel: a.ziel, dateien: a.dateien, pruefungen: a.pruefungen.map((p: any) => ({ befehl: p.befehl, ausgabe: p.ausgabe })), annahmen: a.annahmen, widersprueche: a.widersprueche, ...(rolle === 'pruefer' ? { urteil: a.urteil, befunde: a.befunde } : {}) }, span };
}

export const ABSCHLUSS_PFLICHT = (rolle: Rolle) => `Am Ende deiner Antwort steht PFLICHT ein maschinenlesbarer Abschluss-Block als letzter \`json\`-Codeblock, genau so aufgebaut:
\`\`\`json
{"abschluss": {"ziel": true, "dateien": ["pfad/geändert.ts"], "pruefungen": [{"befehl": "npm test", "ausgabe": "ok 12/12"}], "annahmen": ["…"], "widersprueche": ["…"]${rolle === 'pruefer' ? ', "urteil": "ok", "befunde": ["Datei:Zeile — Befund"]' : ''}}}
\`\`\`
ziel = Auftrag erfüllt (true/false, ehrlich). dateien = alle geänderten Dateien (leer, wenn keine). pruefungen = was du selbst ausgeführt hast, mit gekürzter Ausgabe. annahmen = was du angenommen hast, ohne es zu prüfen. widersprueche = was im Auftrag oder im Code nicht zusammenpasst.${rolle === 'pruefer' ? ' urteil = ok | maengel | falsch, befunde = je Befund Datei:Zeile, Schwere, Vorschlag.' : ''} Fehlt der Block oder ist er ungültig, gilt die Delegation als fehlgeschlagen.`;

// ---------- Übergabedatei (C1) ----------

export const UEBERGABE_ABSCHNITTE = ['Ziel', 'Stand', 'Annahmen', 'Offene Widersprüche', 'Prüfausgaben'];

/** Prüft das feste Schema: alle fünf `## `-Abschnitte vorhanden und nicht leer, Länge ≤ KAPPUNG.uebergabe. */
export function checkUebergabe(text: string): { ok: true; ziel: string } | { ok: false; why: string } {
  if (text.length > KAPPUNG.uebergabe) return { ok: false, why: `Übergabe ist ${text.length} Zeichen lang, höchstens ${KAPPUNG.uebergabe}` };
  const parts = new Map<string, string>();
  let cur: string | null = null;
  for (const line of text.split('\n')) {
    const h = line.match(/^##\s+(.+?)\s*$/);
    if (h) { cur = h[1]; parts.set(cur, ''); continue; }
    if (cur) parts.set(cur, parts.get(cur)! + line + '\n');
  }
  const fehlt = UEBERGABE_ABSCHNITTE.filter((s) => !parts.has(s));
  if (fehlt.length) return { ok: false, why: `Abschnitt fehlt: ${fehlt.map((s) => `„## ${s}“`).join(', ')}` };
  // Mindestinhalt (Council 165, 2): 20 Zeichen je Abschnitt; Annahmen/Widersprüche dürfen „keine“ sein.
  const leer = UEBERGABE_ABSCHNITTE.filter((s) => { const t = parts.get(s)!.trim(); return !(t.length >= 20 || (/Annahmen|Widersprüche/.test(s) && /^[-*\s]*keine\.?$/i.test(t))); });
  if (leer.length) return { ok: false, why: `Abschnitt zu knapp (mindestens 20 Zeichen): ${leer.map((s) => `„## ${s}“`).join(', ')} (nichts offen → „keine“ schreiben)` };
  return { ok: true, ziel: parts.get('Ziel')!.trim() };
}

// C2 (Einstufung, keine Sperre): Eingriffe mit Rückwirkung bevorzugen Opus.
export const RUECKWIRKUNG = /migration|migrier|abrechnung|rechnungslauf|kundendaten|personenbezug|dsgvo|datenbank-?schema/i;

export function phaseModell(phase: Phase, ziel = ''): { modell: 'opus' | 'sonnet'; c2: boolean } {
  const c2 = PHASE_MODELL[phase] === 'sonnet' && RUECKWIRKUNG.test(ziel);
  return { modell: c2 ? 'opus' : PHASE_MODELL[phase], c2 };
}

// ---------- Modell-Klassen und Prüfer (C6) ----------

/** Klasse eines Modells: 3 = Opus, 2 = Sonnet / GLM 5.3, 1 = Haiku und Flash-Modelle. Unbekannt = 1. */
export function klasse(model: string | null | undefined): number {
  const m = familie(model);
  return m === 'opus' ? 3 : m === 'sonnet' || m === 'glm-5.3' ? 2 : 1;
}

export interface Kandidat { anbieter: 'melious' | 'claude'; modell: string }
// Reihenfolge: zuerst Melious (Energie statt Claude-Kontingent), dann Claude Sonnet (unter dem Worker-Deckel C7).
export const PRUEFER_KANDIDATEN: Kandidat[] = [{ anbieter: 'melious', modell: 'glm-5.3' }, { anbieter: 'claude', modell: 'sonnet' }];

/** Prüfer: Modell ≠ Autor, Klasse ≥ Autor, Ressource frei. null = keiner frei (kein stiller Ersatz). */
export function pickPruefer(autor: string | null | undefined, frei: { melious: boolean; claude: boolean }): Kandidat | null {
  // Modellname = letztes Wort („Melious glm-5.3-flash“ → glm-5.3-flash); Claude als Familie („claude-sonnet-5-5“ = sonnet),
  // sonst genauer Vergleich (glm-5.3 ≠ glm-5.3-flash).
  const a = familie(autor);
  return PRUEFER_KANDIDATEN.find((k) => frei[k.anbieter] && klasse(k.modell) >= klasse(a) && k.modell !== a) ?? null;
}

export function familie(model: string | null | undefined): string {
  const m = String(model ?? '').toLowerCase().trim().split(/\s+/).pop()!.replace(/:eco$/, '');
  return /opus|sonnet|haiku/.exec(m)?.[0] ?? m;
}

export const RISIKO_RANG = { niedrig: 0, mittel: 1, hoch: 2 } as const;
export type RisikoStufe = keyof typeof RISIKO_RANG;
/** Untergrenze: eine Delegation ist nie weniger riskant als ihr Strang. */
export function risikoMin(gegeben: unknown, strang: RisikoStufe): RisikoStufe {
  const g = (Object.keys(RISIKO_RANG) as RisikoStufe[]).includes(gegeben as RisikoStufe) ? (gegeben as RisikoStufe) : strang;
  return RISIKO_RANG[g] >= RISIKO_RANG[strang] ? g : strang;
}

// ---------- Git und Prüfbefehle der Brücke (C6) ----------

/** Befehl als Argument-Liste (keine Shell), eigene Prozessgruppe; beim Zeitlimit wird die ganze Gruppe beendet (Code 124). */
export function run(cmd: string, args: string[], o: { cwd: string; env?: Record<string, string | undefined>; timeoutMs?: number; max?: number }): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    let out = '';
    let killed = false;
    let p: ReturnType<typeof spawn>;
    try { p = spawn(cmd, args, { cwd: o.cwd, env: (o.env ?? process.env) as NodeJS.ProcessEnv, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e: any) { return resolve({ code: 127, out: String(e?.message ?? e) }); }
    const add = (d: Buffer) => { out += d.toString('utf8'); if (out.length > 4_000_000) out = out.slice(-2_000_000); };
    p.stdout!.on('data', add); p.stderr!.on('data', add);
    const timer = setTimeout(() => { killed = true; try { process.kill(-p.pid!, 'SIGKILL'); } catch { /* schon weg */ } }, o.timeoutMs ?? 30_000);
    p.on('error', (e: any) => { clearTimeout(timer); resolve({ code: 127, out: String(e?.message ?? e) }); });
    p.on('close', (code) => { clearTimeout(timer); resolve({ code: killed ? 124 : code ?? 1, out: o.max ? out.slice(-o.max) : out }); });
  });
}
const git = (cwd: string, ...args: string[]) => run('git', ['-C', cwd, ...args], { cwd });

export async function isGitDir(dir: string): Promise<boolean> {
  return (await git(dir, 'rev-parse', '--is-inside-work-tree')).out.trim() === 'true';
}

/** Unter-Worktree vom aktuellen HEAD des Strangs, neben dem Strang-Ordner; node_modules des Strangs verlinkt. */
export async function subWorktree(strandDir: string, id: string): Promise<{ dir: string; branch: string; base: string; top: string; fest: { ref: string; sha: string } | null } | { error: string }> {
  const top = (await git(strandDir, 'rev-parse', '--show-toplevel')).out.trim();
  const base = (await git(strandDir, 'rev-parse', 'HEAD')).out.trim();
  if (!top || !/^[0-9a-f]{40}$/.test(base)) return { error: 'kein Git-Arbeitsordner mit Commit' };
  const dir = join(dirname(top), `${basename(top)}.deleg`, id);
  mkdirSync(dirname(dir), { recursive: true });
  const branch = `werkbank/deleg-${id}`;
  const r = await git(top, 'worktree', 'add', '-q', '-b', branch, dir, base);
  if (r.code !== 0) return { error: `git worktree add: ${r.out.trim().slice(-300)}` };
  // node_modules (bis zwei Ebenen tief) verlinken — Tests laufen ohne Neuinstallation; nie mitcommittet (.gitignore der Repos).
  const link = (rel: string) => { const src = join(top, rel, 'node_modules'); const dst = join(dir, rel, 'node_modules'); if (existsSync(src) && !existsSync(dst) && existsSync(join(dir, rel))) { try { symlinkSync(src, dst); } catch { /* egal */ } } };
  link('');
  // Der Link ist für Git eine Datei („node_modules/“ in .gitignore trifft ihn nicht) → in die gemeinsame info/exclude.
  const common = (await git(top, 'rev-parse', '--git-common-dir')).out.trim();
  const ex = join(common.startsWith('/') ? common : join(top, common), 'info', 'exclude');
  try {
    mkdirSync(dirname(ex), { recursive: true });
    const cur = existsSync(ex) ? readFileSync(ex, 'utf8') : '';
    if (!/^node_modules$/m.test(cur)) appendFileSync(ex, `${cur && !cur.endsWith('\n') ? '\n' : ''}# Werkbank: verlinkte node_modules in Unter-Worktrees (Plan 165)\nnode_modules\n`);
  } catch { /* egal */ }
  for (const e of safeList(top)) if (e !== 'node_modules' && !e.startsWith('.') && isDir(join(top, e))) link(e);
  return { dir, branch, base, top, fest: await integrationSha(top) };
}
const safeList = (d: string) => { try { return readdirSync(d); } catch { return []; } };
const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };

export async function removeWorktree(dir: string): Promise<void> {
  const common = (await git(dir, 'rev-parse', '--git-common-dir')).out.trim();
  const top = common ? dirname(common.startsWith('/') ? common : join(dir, common)) : dir;
  await git(top, 'worktree', 'remove', '--force', dir);
}

export interface GitStand { kopf: string; dateien: string[]; stat: string; dirty: string[]; hunk: string; commits: number }
export async function gitStand(dir: string, base: string): Promise<GitStand> {
  const kopf = (await git(dir, 'rev-parse', 'HEAD')).out.trim();
  const dateien = (await git(dir, 'diff', '--name-only', `${base}..HEAD`)).out.split('\n').filter(Boolean);
  const stat = (await git(dir, 'diff', '--stat', `${base}..HEAD`)).out.trim().slice(-1500);
  const dirty = (await git(dir, 'status', '--porcelain')).out.split('\n').filter(Boolean).map((l) => l.slice(3)).filter((f) => !/(^|\/)node_modules$/.test(f));
  const commits = Number((await git(dir, 'rev-list', '--count', `${base}..HEAD`)).out.trim()) || 0;
  // Stichprobe: der größte Hunk (deterministisch), gekürzt.
  const diff = (await git(dir, 'diff', '-U2', `${base}..HEAD`)).out;
  const hunks = diff.split(/\n(?=@@ )/).slice(1);
  const hunk = hunks.sort((a, b) => b.length - a.length)[0]?.slice(0, 1500) ?? '';
  return { kopf, dateien, stat, dirty, hunk, commits };
}

export interface PruefBefehl { name: string; befehl: string[]; ordner?: string; zeitS?: number }
export const pruefRefs = () => (process.env.BRIDGE_PRUEF_REF || 'origin/dev,origin/develop,origin/main,dev,main').split(',').map((s) => s.trim()).filter(Boolean);

/** Erste vorhandene Referenz des Integrationszweigs (nie der Strang selbst: den committet der Lead). */
export async function integrationRef(dir: string): Promise<string | null> {
  for (const r of pruefRefs()) if ((await git(dir, 'rev-parse', '--verify', '--quiet', `${r}^{commit}`)).code === 0) return r;
  return null;
}

/** Integrationszweig als feste Commit-Kennung (beim Anlegen des Unter-Worktrees gemerkt: ein Worker kann sie nicht umbiegen). */
export async function integrationSha(dir: string): Promise<{ ref: string; sha: string } | null> {
  const ref = await integrationRef(dir);
  const sha = ref ? (await git(dir, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`)).out.trim() : '';
  return ref && /^[0-9a-f]{40}$/.test(sha) ? { ref, sha } : null;
}

/** Prüfbefehle aus `.werkbank/pruefungen.json` des Integrationszweigs (fest gemerkt oder jetzt aufgelöst). Befehl = Argument-Liste. */
export async function pruefBefehle(dir: string, fest?: { ref: string; sha: string } | null): Promise<{ ref: string; list: PruefBefehl[] } | null> {
  // fest = null heißt „beim Anlegen gab es keinen Integrationszweig“ → nie neu auflösen (Pass C, 2: Refs teilen alle Worktrees).
  const ir = fest === undefined ? await integrationSha(dir) : fest;
  if (!ir) return null;
  const ref = `${ir.ref} @ ${ir.sha.slice(0, 10)}`;
  const r = await git(dir, 'show', `${ir.sha}:.werkbank/pruefungen.json`);
  if (r.code !== 0) return null;
  try {
    const j = JSON.parse(r.out);
    const list = Array.isArray(j) ? j : j.pruefungen;
    const ok = (p: any) => p && typeof p.name === 'string' && Array.isArray(p.befehl) && p.befehl.length > 0 && p.befehl.every((x: unknown) => typeof x === 'string')
      && (!p.ordner || (typeof p.ordner === 'string' && !p.ordner.split('/').includes('..') && !p.ordner.startsWith('/')));
    return { ref, list: (Array.isArray(list) ? list : []).filter(ok).slice(0, 8) };
  } catch { return null; }
}

export interface PruefErgebnis { name: string; befehl: string; ok: boolean; code: number; ausgabe: string; ms: number }
/** Führt die Prüfbefehle im Unter-Worktree aus (Umgebung ohne Geheimnisse; Zeitlimit je Befehl). Plus `git diff --check`. */
export async function pruefen(dir: string, base: string, env: Record<string, string | undefined>, o: { fest?: { ref: string; sha: string } | null; maxMs?: number } = {}): Promise<{ eingerichtet: boolean; ref: string | null; ergebnisse: PruefErgebnis[] }> {
  const cfg = await pruefBefehle(dir, o.fest);
  const list = cfg?.list;
  const ende = Date.now() + (o.maxMs ?? Infinity);
  const out: PruefErgebnis[] = [];
  const t0 = Date.now();
  const check = await git(dir, 'diff', '--check', `${base}..HEAD`);
  out.push({ name: 'diff-check', befehl: 'git diff --check', ok: check.code === 0, code: check.code, ausgabe: check.out.trim().slice(-KAPPUNG.pruefAusgabe), ms: Date.now() - t0 });
  for (const p of list ?? []) {
    const t = Date.now();
    const cwd = p.ordner ? join(dir, p.ordner) : dir;
    const befehl = p.befehl.join(' ');
    if (!existsSync(cwd)) { out.push({ name: p.name, befehl, ok: false, code: 2, ausgabe: `Ordner ${p.ordner} fehlt`, ms: 0 }); continue; }
    const rest = ende - Date.now();
    if (rest < 10_000) { out.push({ name: p.name, befehl, ok: false, code: 124, ausgabe: 'nicht gelaufen — Gesamtzeit der Prüfungen aufgebraucht', ms: 0 }); continue; }
    const r = await run(p.befehl[0], p.befehl.slice(1), { cwd, env, timeoutMs: Math.min(rest, Math.min(KAPPUNG.pruefMaxS, Math.max(10, p.zeitS ?? KAPPUNG.pruefS)) * 1000), max: KAPPUNG.pruefAusgabe });
    out.push({ name: p.name, befehl, ok: r.code === 0, code: r.code, ausgabe: r.out.trim(), ms: Date.now() - t });
  }
  return { eingerichtet: !!list?.length, ref: cfg?.ref ?? null, ergebnisse: out };
}

// Heikle Pfade (Council 165, 6): Prüfkonfiguration, Agenten-/CI-/Hook-Konfiguration, Paket-Skripte → Risiko „hoch“.
export const HEIKEL = /^(\.werkbank\/|\.claude\/|\.github\/|\.husky\/|\.gitattributes$|\.gitmodules$|(.*\/)?package\.json$)/;
export const heikleDateien = (files: string[]) => files.filter((f) => HEIKEL.test(f));

/** Abweichungen zwischen Behauptung (Abschluss) und Befund der Brücke — Eskalation sofort. */
export function abweichungen(a: Abschluss | null, g: GitStand | null, p: PruefErgebnis[] | null): string[] {
  const out: string[] = [];
  if (a && !a.ziel) out.push('Worker meldet: Ziel nicht erreicht');
  if (a && a.urteil && a.urteil !== 'ok') out.push(`Prüfer-Urteil: ${a.urteil}`);
  if (g) {
    const gemeldet = new Set((a?.dateien ?? []).map((f) => f.replace(/^\.\//, '')));
    const fehlt = g.dateien.filter((f) => !gemeldet.has(f));
    const zuviel = [...gemeldet].filter((f) => !g.dateien.includes(f) && !g.dirty.includes(f));
    if (a && fehlt.length) out.push(`geändert, aber nicht gemeldet: ${fehlt.slice(0, 10).join(', ')}`);
    if (a && zuviel.length) out.push(`gemeldet, aber nicht geändert: ${zuviel.slice(0, 10).join(', ')}`);
    if (g.dirty.length) out.push(`nicht committet: ${g.dirty.slice(0, 10).join(', ')}`);
  }
  if (g && heikleDateien(g.dateien).length) out.push(`heikle Pfade geändert (Risiko → hoch): ${heikleDateien(g.dateien).slice(0, 10).join(', ')}`);
  for (const r of p ?? []) if (!r.ok) out.push(`Brücken-Prüfung rot: ${r.name} (Code ${r.code})${a?.pruefungen.some((x) => x.befehl.includes(r.befehl.split(' ')[0])) ? ' — der Worker meldete sie als ausgeführt' : ''}`);
  return out;
}
