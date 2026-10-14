// Review → Freigabe → Push (docs/plan-hauptchat-monitor.md §9; Knut 12.10.2026: „gib mir nochmal die Links, lass mich reviewen
// und dann freigeben — den Prozess sollten wir auch im Workspace mitdenken“). Council R3, Bedingungen 2–9:
//
// - Die Review-Ansicht eines Strangs zeigt, WAS freigegeben wird (Branch, Kopf, Basis, Commits, Diff-Statistik, sauber?),
//   Vorschau-Links aus dem Dienste-Register (mit Prüfung), PR-Texte und Entscheidungen aus dem Review-Paket — als Text.
// - Die Freigabe bindet Repo (origin-URL + Worktree des Strangs, nie aus der Anfrage), Branch, Kopf-SHA, Basis und die
//   Patch-ID des Diffs Basis..Kopf. Nur mit sauberem Worktree und nur für den gesehenen Kopf. Nie gelöscht: zurückziehen
//   setzt revokedAt, nach pushedAt geht das nicht mehr. Anlegen/Zurückziehen nur über Knuts Oberfläche, nie intern.
// - Durchsetzung: `orch freigabe-pruefen <repo> <sha>` (und der pre-push-Hook aus templates/git-hooks) ist nur dann grün,
//   wenn eine aktive Freigabe genau diesen SHA hat oder — nach einem Rebase — denselben Patch.
// - Gepusht wird nie von hier. Merge gibt es nicht.

import { execFileSync } from 'node:child_process';
import { readdirSync, realpathSync, readFileSync, statSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join, basename, dirname } from 'node:path';
import { homedir } from 'node:os';
import { parse as parseYaml } from 'yaml';
import { wb } from './db.ts';
import type { User } from './auth.ts';
import { GIT_SAFE } from './gitsafe.ts';
import { readBericht, paketDatei, reviewDir, findPaket } from './bericht.ts';
import { paketFile, PAKET_RE, renderPaketMd } from './reviewpakete.ts';

const err = (status: number, msg: string) => Object.assign(new Error(msg), { status });
export const freigaben = () => wb().collection('freigaben');

// ---------- Git (nur lesen, gehärtet, ohne Shell) ----------

type GitFn = (args: string[], cwd: string, input?: string) => string;
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_ASKPASS: '/bin/false' };
export const git: GitFn = (args, cwd, input) => execFileSync('git', [...GIT_SAFE, ...args], { cwd, env: GIT_ENV, input, timeout: 10_000, maxBuffer: 64 << 20, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const tryGit = (g: GitFn, args: string[], cwd: string, input?: string) => { try { return g(args, cwd, input); } catch { return null; } };

/** origin-URL ohne Zugangsdaten und ohne .git am Ende — der Schlüssel eines Repos über Worktrees und Klone hinweg. */
export const repoKey = (url: string) => url.trim().replace(/^(https?:\/\/)[^@/]+@/, '$1').replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '').replace(/\/+$/, '').toLowerCase();

const BASES = ['develop', 'dev', 'main', 'master'];

/** Patch-ID des Diffs Basis..Kopf (plumbing, ohne Textconv/externes Diff); null, wenn leer oder nicht berechenbar. */
export function patchId(g: GitFn, dir: string, base: string, head: string): string | null {
  const diff = tryGit(g, ['diff-tree', '-p', '--no-color', '--no-ext-diff', '--no-textconv', base, head], dir);
  if (!diff) return null;
  const out = tryGit(g, ['patch-id', '--stable'], dir, diff + '\n');
  return out ? out.split(/\s+/)[0] || null : null;
}

export interface RepoFakten { dir: string; key: string | null; branch: string | null; head: string; clean: boolean; dirty: string[]; baseRef: string | null; mergeBase: string | null; commits: { sha: string; subject: string }[]; more: number; stat: string; patchId: string | null }

/** Was freigegeben würde (rein bis auf git, testbar mit einem git-Ersatz). */
export function repoFakten(dir: string, g: GitFn = git): RepoFakten {
  const head = tryGit(g, ['rev-parse', 'HEAD'], dir);
  if (!head || !/^[0-9a-f]{40}$/.test(head)) throw err(409, `Im Arbeitsordner des Strangs gibt es kein git-Repo (${dir}).`);
  const b = tryGit(g, ['symbolic-ref', '--quiet', '--short', 'HEAD'], dir);
  const branch = b && tryGit(g, ['check-ref-format', '--branch', b], dir) ? b : null;
  const porcelain = tryGit(g, ['status', '--porcelain', '--untracked-files=normal'], dir) ?? '?? (status nicht lesbar)';
  const dirty = porcelain ? porcelain.split('\n').filter(Boolean).slice(0, 20) : [];
  const url = tryGit(g, ['remote', 'get-url', 'origin'], dir);
  const baseRef = BASES.map((x) => `origin/${x}`).find((r) => tryGit(g, ['rev-parse', '--verify', '--quiet', `refs/remotes/${r}`], dir)) ?? null;
  const mergeBase = baseRef ? tryGit(g, ['merge-base', 'HEAD', baseRef], dir) : null;
  const log = mergeBase ? tryGit(g, ['log', '--no-color', '--format=%H%x09%s', '-n', '31', `${mergeBase}..HEAD`], dir) ?? '' : '';
  const all = log.split('\n').filter(Boolean).map((l) => { const [sha, ...s] = l.split('\t'); return { sha, subject: s.join('\t').slice(0, 200) }; });
  return {
    dir, key: url ? repoKey(url) : null, branch, head, clean: dirty.length === 0, dirty, baseRef, mergeBase,
    commits: all.slice(0, 30), more: Math.max(0, all.length - 30),
    stat: mergeBase ? (tryGit(g, ['diff', '--no-color', '--no-ext-diff', '--no-textconv', '--stat=100', '--stat-count=40', mergeBase, 'HEAD'], dir) ?? '') : '',
    patchId: mergeBase ? patchId(g, dir, mergeBase, 'HEAD') : null,
  };
}

/** Arbeitsordner eines Strangs als Repo-Ordner: wirklich vorhanden, unter ~/work (Pfad aus Mongo, nie aus der Anfrage). */
export function strandRepo(d: any): string {
  let real: string;
  try { real = realpathSync(String(d.cwd ?? '')); } catch { throw err(409, 'Arbeitsordner des Strangs gibt es nicht mehr.'); }
  const work = realpathSync(join(process.env.HOME || homedir(), 'work'));
  if (!real.startsWith(work + '/')) throw err(409, 'Arbeitsordner liegt nicht unter ~/work.');
  return real;
}

// ---------- Vorschau-Links (nur aus dem Dienste-Register, Council R3, Bedingung 7) ----------

// Infrastruktur der Workspace (00-dienste.yaml, Abschnitt „nie stoppen“) und die Werkbank selbst: nie anfragen.
const GESPERRT = new Set([22, 2112, 2113, 3070, 3080, 3090, 6060, 7700, 13337, 27017, 38429, 39429, 41001, 41002, 41003, 55433]);
const HOST = (env = process.env) => env.WERKBANK_VORSCHAU_HOST || 'main--dev--knut.ws.konekto.energy';
export const dienstePfad = () => process.env.WERKBANK_DIENSTE_FILE || join(reviewDir(), '00-dienste.yaml');

export interface Vorschau { port: number; link: string; was: string; status: number | null; ergebnis: 'läuft' | 'läuft (Anmeldung)' | 'Proxy läuft, Ziel antwortet nicht' | 'antwortet nicht' | 'Fehler'; at: number }

/** Register-Einträge zum Paket (Nummer) bzw. Strang-Thema; Port aus dem Link (nur das Coder-Muster) und gesperrte Ports raus. */
export function vorschauEintraege(yamlText: string, paketNr: number | null, linksImBericht: string[], env = process.env): { port: number; link: string; was: string }[] {
  let list: any[] = [];
  try { const y = parseYaml(yamlText); list = Array.isArray(y) ? y : []; } catch { return []; }
  const host = HOST(env).replace(/\./g, '\\.');
  const re = new RegExp(`^https://(\\d{2,5})--${host}(/[^\\s)>\\]"']*)?$`);
  const portsImBericht = new Set(linksImBericht.map((l) => re.exec(l)?.[1]).filter(Boolean).map(Number));
  const out: { port: number; link: string; was: string }[] = [];
  for (const e of list) {
    if (!e || typeof e !== 'object' || e.schutz === 'live') continue;
    const link = String(e.link ?? '');
    const m = re.exec(link);
    if (!m) continue;
    const port = Number(m[1]);
    if (!(port > 1024 && port < 65536) || GESPERRT.has(port)) continue;
    const zumPaket = paketNr !== null && String(e.paket ?? '').split(/[,\s]+/).map(Number).includes(paketNr);
    if (!zumPaket && !portsImBericht.has(port)) continue;
    if (!out.some((x) => x.port === port)) out.push({ port, link, was: String(e.was ?? '').slice(0, 160) });
  }
  return out.slice(0, 12);
}

/** Ein einzelner Link aus dem Bericht-Kopf (Teil C, H5): nur das Coder-Muster, Port > 1024, nicht gesperrt — sonst null. */
export function vorschauAusLink(link: string, titel = '', env = process.env): { port: number; link: string; was: string } | null {
  const re = new RegExp(`^https://(\\d{2,5})--${HOST(env).replace(/\./g, '\\.')}(/[^\\s)>\\]"']*)?$`);
  const m = re.exec(link);
  if (!m) return null;
  const port = Number(m[1]);
  return port > 1024 && port < 65536 && !GESPERRT.has(port) ? { port, link, was: titel.slice(0, 160) } : null;
}

const cache = new Map<number, Vorschau>();
/** GET / auf 127.0.0.1:<port>, keine Weiterleitung, Körper nie gelesen, 3 s; Ergebnis 30 s gemerkt. */
export async function pruefeVorschau(v: { port: number; link: string; was: string }, force = false, now = Date.now()): Promise<Vorschau> {
  const c = cache.get(v.port);
  if (c && !force && now - c.at < 30_000) return { ...c, link: v.link, was: v.was };
  let status: number | null = null;
  try {
    const r = await fetch(`http://127.0.0.1:${v.port}/`, { redirect: 'manual', signal: AbortSignal.timeout(3000), headers: { accept: 'text/html' } });
    status = r.status;
    try { await r.body?.cancel(); } catch { /* egal */ }
  } catch { status = null; }
  const ergebnis: Vorschau['ergebnis'] = status === null ? 'antwortet nicht' : status === 502 || status === 504 ? 'Proxy läuft, Ziel antwortet nicht'
    : status === 401 || status === 403 ? 'läuft (Anmeldung)' : status < 500 ? 'läuft' : 'Fehler';
  const out = { ...v, status, ergebnis, at: now };
  cache.set(v.port, out);
  return out;
}

// ---------- Entscheidungen aus dem Bericht (Council R3, Bedingung 8) ----------

export interface Entscheidung { id: string; titel: string; text: string; knut: string }

/** Blöcke `**D1 — …**` / `**E-147-1 · …**` (zeilengenau, nicht in Codezäunen) bis zum nächsten Block oder `## `. */
export function entscheidungen(md: string): Entscheidung[] {
  const out: Entscheidung[] = [];
  let cur: { id: string; titel: string; lines: string[] } | null = null;
  let fence = false;
  const close = () => {
    if (!cur) return;
    const knut = [...cur.lines].reverse().map((l) => /^\s*-\s*Knut:\s*(.*)$/.exec(l)).find(Boolean);
    if (!out.some((x) => x.id === cur!.id)) out.push({ id: cur.id, titel: cur.titel.slice(0, 200), text: cur.lines.join('\n').trim().slice(0, 3000), knut: (knut?.[1] ?? '').trim() });
    cur = null;
  };
  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) { fence = !fence; if (cur) cur.lines.push(line); continue; }
    if (fence) { if (cur) cur.lines.push(line); continue; }
    const h = /^\s*(?:[-*]\s+)?\*\*(D\d{1,3}|E-\d{1,4}-\d{1,3})\s*[—·–:-]\s*(.+?)\*\*/.exec(line);
    if (h) { close(); cur = { id: h[1], titel: h[2], lines: [] }; continue; }
    if (/^#{1,3}\s/.test(line)) { close(); continue; }
    if (cur) cur.lines.push(line);
  }
  close();
  return out.slice(0, 40);
}

export const berichtHash = (t: string | null) => createHash('sha256').update(t ?? '').digest('hex').slice(0, 16);

// ---------- Review-Ansicht ----------

const paketNrOf = (name: string | null) => (name && /^(\d{1,4})-/.exec(name) ? Number(/^(\d{1,4})-/.exec(name)![1]) : null);

export async function reviewDetail(d: any, opts: { pruefen?: boolean; g?: GitFn; readDienste?: () => string } = {}) {
  const berichtPfad = paketDatei(d, 'bericht');
  const bericht = readBericht(berichtPfad);
  const paket = d.paket ?? (berichtPfad ? basename(dirname(berichtPfad)) : null) ?? findPaket([d.prompt]);
  // PR-Texte: pr*.md im Paketordner (sicher gelesen, höchstens 8).
  const prTexte: { name: string; text: string }[] = [];
  if (paket && PAKET_RE.test(paket)) {
    let names: string[] = [];
    try { names = readdirSync(join(reviewDir(), paket)).filter((n) => /^pr[\w.-]*\.md$/i.test(n)).sort().slice(0, 8); } catch { /* kein Ordner */ }
    for (const n of names) { const p = paketFile(reviewDir(), paket, n); const t = p ? readBericht(p) : null; if (t !== null) prTexte.push({ name: n, text: t.slice(0, 40_000) }); }
  }
  const links = [...(bericht ?? '').matchAll(/https:\/\/\d{2,5}--[\w.-]+[^\s)>\]"'`]*/g)].map((m) => m[0]);
  let yamlText = '';
  // Fester Pfad (Umgebung/Vorgabe), kein Agententext; höchstens 512 KB.
  try { yamlText = (opts.readDienste ?? (() => (statSync(dienstePfad()).size <= 512 * 1024 ? readFileSync(dienstePfad(), 'utf8') : '')))(); } catch { /* kein Register */ }
  const eintraege = vorschauEintraege(yamlText, paketNrOf(paket), links);
  const vorschau = await Promise.all(eintraege.map((v) => (opts.pruefen === false ? Promise.resolve({ ...v, status: null, ergebnis: 'antwortet nicht' as const, at: 0 }) : pruefeVorschau(v))));
  let repo: (RepoFakten & { fehler?: undefined }) | { fehler: string } ;
  try { repo = repoFakten(strandRepo(d), opts.g); } catch (e: any) { repo = { fehler: String(e.message ?? e) }; }
  const fg = await freigaben().find({ strand: String(d._id) }).sort({ at: -1 }).limit(20).toArray();
  return {
    id: String(d._id), title: d.title, url: d.url, paket, status: d.lastStatus ?? null, running: d.lastStatus === 'running',
    bericht: bericht ?? null, berichtHtml: bericht && paket ? renderPaketMd(bericht, paket, 'bericht.md') : null, berichtHash: berichtHash(bericht), prTexte, entscheidungen: bericht ? entscheidungen(bericht) : [],
    beantwortet: d.entscheidungenAntwort ?? null, vorschau, repo, freigaben: fg.map(publicFreigabe),
  };
}

export const publicFreigabe = (f: any) => ({ id: String(f._id), repo: f.repo, key: f.key, branch: f.branch, head: f.head, baseRef: f.baseRef, patchId: f.patchId, at: f.at, by: f.by, revokedAt: f.revokedAt ?? null, pushedAt: f.pushedAt ?? null, pr: f.pr ?? null, aktiv: !f.revokedAt });

// ---------- Freigeben / zurückziehen (nur über Knuts Oberfläche) ----------

export async function freigeben(u: User, d: any, seen: { head?: string; patchId?: string | null }, g: GitFn = git, log?: (m: string, x: Record<string, unknown>) => void) {
  if (d.lastStatus === 'running') throw err(409, 'Der Unter-Chat arbeitet gerade — erst wenn er fertig ist, freigeben.');
  const f = repoFakten(strandRepo(d), g);
  if (!f.clean) throw err(409, `Ungespeicherte Änderungen im Arbeitsordner (${f.dirty.length}) — die Vorschau zeigt dann etwas anderes als der Commit. Erst committen lassen.`);
  if (!f.branch) throw err(409, 'Kein Branch ausgecheckt (losgelöster Kopf) — so lässt sich nichts freigeben.');
  if (!f.key) throw err(409, 'Repo ohne origin — so lässt sich nichts freigeben.');
  if (!f.mergeBase || !f.patchId) throw err(409, 'Keine Basis (origin/develop|dev|main) oder leerer Diff — nichts freizugeben.');
  if (String(seen.head ?? '') !== f.head || (seen.patchId ?? null) !== f.patchId) throw err(409, 'Der Stand hat sich inzwischen geändert — Seite neu laden und noch einmal ansehen.');
  const da: any = await freigaben().findOne({ strand: String(d._id), key: f.key, branch: f.branch, head: f.head, revokedAt: null });
  if (da) return publicFreigabe(da);
  const doc = { _id: 'f-' + randomUUID().slice(0, 8), userId: u.id, strand: String(d._id), title: d.title, repo: f.dir, key: f.key, branch: f.branch, head: f.head, baseRef: f.baseRef, mergeBase: f.mergeBase, patchId: f.patchId,
    commits: f.commits.length, at: new Date(), by: u.email, aktiv: true, revokedAt: null, pushedAt: null, pr: null };
  // Eindeutiger Index auf aktive Freigaben (db.ts): zwei schnelle Klicks ergeben eine Freigabe.
  try { await freigaben().insertOne(doc as any); }
  catch (e: any) { if (e?.code === 11000) { const x: any = await freigaben().findOne({ strand: doc.strand, key: doc.key, branch: doc.branch, head: doc.head, aktiv: true }); if (x) return publicFreigabe(x); } throw e; }
  log?.('freigabe', { user: u.id, id: doc._id, strand: doc.strand, branch: doc.branch, head: doc.head.slice(0, 12) });
  return publicFreigabe(doc);
}

export async function zurueckziehen(u: User, strand: string, id: string, log?: (m: string, x: Record<string, unknown>) => void) {
  const r = await freigaben().updateOne({ _id: id as any, strand, userId: u.id, revokedAt: null, pushedAt: null }, { $set: { revokedAt: new Date(), revokedBy: u.email, aktiv: false } });
  if (!r.modifiedCount) throw err(409, 'Diese Freigabe ist schon zurückgezogen oder gepusht.');
  log?.('freigabe zurück', { user: u.id, id });
  return { id, revoked: true };
}

// ---------- Prüfweg für den Push (CLI / pre-push-Hook; liest nur) ----------

/**
 * Darf <sha> aus dem Repo in <dir> gepusht werden? Ja nur bei einer aktiven, nicht gepushten Freigabe desselben Repos
 * (origin-URL) mit genau diesem SHA. Knut, 14.10.2026 (Plan Leitstand Teil C, D2/H4): „gilt nur für genau den gesehenen Stand —
 * ändert sich ein Commit, verfällt die Freigabe“; die Rebase-Toleranz über die patch-id (Plan 154) entfällt.
 */
export async function pruefeFreigabe(u: User, dir: string, sha: string, g: GitFn = git): Promise<{ ok: boolean; grund: string; freigabe?: ReturnType<typeof publicFreigabe> }> {
  if (!/^[0-9a-f]{40}$/.test(sha)) return { ok: false, grund: 'SHA ungültig (40 Hex-Zeichen).' };
  let real: string;
  try { real = realpathSync(dir); } catch { return { ok: false, grund: 'Repo-Ordner gibt es nicht.' }; }
  const url = tryGit(g, ['remote', 'get-url', 'origin'], real);
  if (!url) return { ok: false, grund: 'Repo ohne origin.' };
  const key = repoKey(url);
  const list: any[] = await freigaben().find({ userId: u.id, key, revokedAt: null, pushedAt: null }).sort({ at: -1 }).limit(50).toArray();
  if (!list.length) return { ok: false, grund: `Keine aktive Freigabe für ${key} — erst im OLAF Workspace reviewen und freigeben.` };
  const exakt = list.find((f) => f.head === sha);
  if (exakt) return { ok: true, grund: `freigegeben (${exakt._id}, ${exakt.branch}, genau dieser Stand)`, freigabe: publicFreigabe(exakt) };
  const alt = list[0];
  return { ok: false, grund: `Dieser Stand (${sha.slice(0, 12)}) ist nicht freigegeben — freigegeben ist ${alt.branch} @ ${String(alt.head).slice(0, 12)}. Jeder neue Commit (auch ein Rebase) braucht eine neue Freigabe im OLAF Workspace.` };
}

export async function gepusht(u: User, id: string, pr: string | null) {
  const p = pr ? String(pr).slice(0, 300) : null;
  if (p && !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(p)) throw err(400, 'PR-Link hat die Form https://github.com/<org>/<repo>/pull/<n>.');
  const r = await freigaben().updateOne({ _id: id as any, userId: u.id, revokedAt: null, pushedAt: null }, { $set: { pushedAt: new Date(), pr: p } });
  if (!r.modifiedCount) throw err(409, 'Keine aktive, noch nicht gepushte Freigabe mit dieser Kennung.');
  return { id, pushed: true, pr: p };
}

export async function listeFreigaben(u: User, opts: { alle?: boolean } = {}) {
  const docs = await freigaben().find({ userId: u.id, ...(opts.alle ? {} : { revokedAt: null, pushedAt: null }) }).sort({ at: -1 }).limit(50).toArray();
  return docs.map((f: any) => ({ ...publicFreigabe(f), strand: f.strand, title: f.title }));
}
