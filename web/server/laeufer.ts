// Review-Läufer (Plan 213 S7a/S7b, Council K6–K9, D4): führt die Prüfbefehle eines PR-Stands aus und meldet je Befehl
// ehrlich `ok | rot | konnte-nicht-laufen`, dazu `vollständig: ja|nein`. Die Befehle kommen nur aus dem Basiszweig
// (`.werkbank/pruefungen.json` am Basis-SHA, sonst die npm-Skripte typecheck/lint/test/build der package.json am Basis-SHA) —
// nie aus dem PR (K7). Austauschbares Backend: REVIEW_EXEC = local-allowlist | docker-remote | managed-agents.
//
//  - local-allowlist (Rückfall, D4 d): Kopie ohne .git per `git archive`, Umgebung nur aus einer Erlaubtliste, eigenes HOME/TMP,
//    `prlimit` (Speicher, CPU-Zeit, Dateigröße), Zeitdeckel je Befehl, ganze Prozessgruppe wird beendet. Das Netz ist NICHT
//    getrennt (die VM kann es nicht) — der Bericht sagt das sichtbar; nur für Repos der Erlaubtliste (K6).
//  - docker-remote (D4 a): derselbe Stand als Archiv per ssh an einen Docker-Host (Schlüssel mit erzwungenem Befehl, siehe
//    scripts/wb-review-runner.sh): Installieren mit Netz, Ausführen mit `--network none`, Datenbank als Sidecar im internen Netz,
//    CPU/RAM/Zeit/Prozess-Deckel, Container-Namensraum `wb-review-*`, Aufräumen per trap.
//  - managed-agents (D4 b): noch nicht angebunden (braucht API-Key und Abgleich mit der API) — meldet ehrlich „konnte nicht laufen“.
//
// Wegwerf-DB (K9): Der Aufseher startet sie außerhalb der gedeckelten Prozessgruppe und räumt sie in jedem Fall weg; vor jedem
// Lauf werden verwaiste Ordner `wb-review-*` älter als 2 h entfernt.

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, mkdirSync, existsSync, readdirSync, statSync, rmSync, writeFileSync, createReadStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, connect } from 'node:net';
import { GIT_SAFE } from './gitsafe.ts';

const execf = promisify(execFile);

export type Ergebnis = 'ok' | 'rot' | 'konnte-nicht-laufen';
export interface Befehl { name: string; befehl: string[]; ordner?: string; zeitS?: number; db?: 'mongo' | 'postgres' | null }
export interface LaufErgebnis { name: string; befehl: string; ergebnis: Ergebnis; code: number | null; ms: number; ausgabe: string; grund?: string }
export interface LaufBericht { backend: string; netz: 'getrennt' | 'nicht getrennt'; quelle: string; vollstaendig: boolean; gruende: string[]; ergebnisse: LaufErgebnis[] }
export interface Deckel { speicherMb: number; cpuS: number; dateiMb: number; befehlS: number; gesamtS: number }
export const DECKEL: Deckel = { speicherMb: 2048, cpuS: 900, dateiMb: 256, befehlS: 600, gesamtS: 1800 };

export type ExecName = 'local-allowlist' | 'docker-remote' | 'managed-agents';
export const execBackend = (env = process.env): ExecName => (['docker-remote', 'managed-agents'].includes(String(env.REVIEW_EXEC)) ? env.REVIEW_EXEC as ExecName : 'local-allowlist');

/** Erlaubtliste der Repos für Ausführung (K6): `REVIEW_EXEC_REPOS` (owner/repo, Komma), Vorgabe WirStrom1/* und knut523/werkbank. */
export function ausfuehrungErlaubt(repo: string, env = process.env): boolean {
  const liste = (env.REVIEW_EXEC_REPOS ?? 'WirStrom1/*,knut523/werkbank').split(',').map((s) => s.trim()).filter(Boolean);
  return liste.some((m) => (m.endsWith('/*') ? repo.startsWith(m.slice(0, -1)) : repo === m));
}

/** Ergebnis aus Ausgang und Signal (rein). */
export function einordnen(o: { code: number | null; signal?: string | null; zeit?: boolean; fehlt?: boolean }): { ergebnis: Ergebnis; grund?: string } {
  if (o.fehlt || o.code === 127) return { ergebnis: 'konnte-nicht-laufen', grund: 'Werkzeug fehlt' };
  if (o.zeit) return { ergebnis: 'konnte-nicht-laufen', grund: 'Zeitdeckel erreicht' };
  if (o.signal === 'SIGXCPU' || o.code === 152) return { ergebnis: 'konnte-nicht-laufen', grund: 'CPU-Deckel erreicht' };
  if (o.signal === 'SIGKILL' || o.code === 137) return { ergebnis: 'konnte-nicht-laufen', grund: 'beendet (Speicher-/Prozessdeckel?)' };
  if (o.signal === 'SIGXFSZ' || o.code === 153) return { ergebnis: 'konnte-nicht-laufen', grund: 'Dateigrößen-Deckel erreicht' };
  return o.code === 0 ? { ergebnis: 'ok' } : { ergebnis: 'rot' };
}

/** vollständig nur, wenn jeder Befehl gelaufen ist (ok oder rot) und nichts übersprungen wurde (forge pr_review.py). */
export function vollstaendig(e: LaufErgebnis[], gruende: string[]): boolean {
  return gruende.length === 0 && e.length > 0 && e.every((x) => x.ergebnis !== 'konnte-nicht-laufen');
}

// ---------- Befehle nur aus dem Basiszweig (K7) ----------

export type Git = (args: string[], cwd: string) => Promise<string>;
export const realGit: Git = async (args, cwd) => (await execf('git', [...GIT_SAFE, ...args], { cwd, timeout: 60_000, maxBuffer: 32 << 20, encoding: 'utf8' })).stdout;

const gueltig = (p: any): p is Befehl => p && typeof p.name === 'string' && Array.isArray(p.befehl) && p.befehl.length > 0 && p.befehl.every((x: unknown) => typeof x === 'string')
  && (!p.ordner || (typeof p.ordner === 'string' && !p.ordner.split('/').includes('..') && !p.ordner.startsWith('/')));

/** Prüfbefehle am Basis-SHA: `.werkbank/pruefungen.json`, sonst npm-Skripte typecheck/lint/test/build (Wurzel und eine Ebene tiefer). */
export async function befehleAusBasis(wt: string, basis: string, git: Git = realGit): Promise<{ quelle: string; befehle: Befehl[] }> {
  try {
    const j = JSON.parse(await git(['show', `${basis}:.werkbank/pruefungen.json`], wt));
    const list = (Array.isArray(j) ? j : j.pruefungen ?? []).filter(gueltig).slice(0, 12);
    if (list.length) return { quelle: `.werkbank/pruefungen.json @ ${basis.slice(0, 10)}`, befehle: list };
  } catch { /* keine Datei am Basis-SHA */ }
  const dateien = (await git(['ls-tree', '-r', '--name-only', basis], wt).catch(() => '')).split('\n').filter((f) => /^([^/]+\/)?package\.json$/.test(f));
  const befehle: Befehl[] = [];
  for (const f of dateien.slice(0, 6)) {
    let pkg: any;
    try { pkg = JSON.parse(await git(['show', `${basis}:${f}`], wt)); } catch { continue; }
    const ordner = dirname(f) === '.' ? undefined : dirname(f);
    for (const s of ['typecheck', 'lint', 'test', 'build']) if (typeof pkg?.scripts?.[s] === 'string') befehle.push({ name: `${ordner ?? '.'}:${s}`, befehl: ['npm', 'run', s], ordner, zeitS: 600, db: /mongo/i.test(pkg.scripts[s]) ? 'mongo' : /postgres|pg_/i.test(pkg.scripts[s]) ? 'postgres' : null });
  }
  return { quelle: `package.json-Skripte @ ${basis.slice(0, 10)}`, befehle: befehle.slice(0, 12) };
}

// ---------- Aufräumen (K9) ----------

export const LAUF_PREFIX = 'wb-review-';
/** Verwaiste Lauf-Ordner älter als `alterMs` entfernen (vor jedem Lauf). */
export function aufraeumenAlt(root = tmpdir(), alterMs = 2 * 3600_000, now = Date.now()): string[] {
  const weg: string[] = [];
  let namen: string[] = [];
  try { namen = readdirSync(root).filter((n) => n.startsWith(LAUF_PREFIX)); } catch { return weg; }
  for (const n of namen) {
    try { if (now - statSync(join(root, n)).mtimeMs > alterMs) { rmSync(join(root, n), { recursive: true, force: true }); weg.push(n); } } catch { /* weg */ }
  }
  return weg;
}

const freierPort = () => new Promise<number>((r, f) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as any).port; s.close(() => r(p)); }); s.on('error', f); });

/** Wegwerf-Mongo außerhalb der Prozessgruppe des Laufs; `stopp()` beendet sie und löscht den Ordner (auch nach Fehlern). */
export async function wegwerfMongo(o: { mongod?: string; dir: string }): Promise<{ url: string; stopp: () => Promise<void> } | null> {
  const bin = o.mongod ?? process.env.WERKBANK_REVIEW_MONGOD ?? join(process.env.HOME ?? '', 'work', 'werkbank-dev', '.runtime', 'bin', 'mongod');
  if (!existsSync(bin)) return null;
  const port = await freierPort();
  const db = join(o.dir, 'mongo'); mkdirSync(db, { recursive: true });
  const p = spawn(bin, ['--dbpath', db, '--bind_ip', '127.0.0.1', '--port', String(port), '--quiet', '--wiredTigerCacheSizeGB', '0.25'], { stdio: 'ignore', detached: false });
  for (let i = 0; i < 60; i++) { if (await new Promise<boolean>((r) => { const s = connect(port, '127.0.0.1', () => { s.end(); r(true); }); s.on('error', () => r(false)); })) break; await new Promise((r) => setTimeout(r, 250)); }
  return { url: `mongodb://127.0.0.1:${port}`, stopp: async () => { try { p.kill('SIGTERM'); } catch { /* weg */ } await new Promise((r) => setTimeout(r, 300)); try { p.kill('SIGKILL'); } catch { /* weg */ } rmSync(db, { recursive: true, force: true }); } };
}

// ---------- Backend: local-allowlist ----------

/** Umgebung nur aus der Erlaubtliste (keine Geheimnisse, kein Token, kein Git-Zugang). */
export function sichereUmgebung(home: string, extra: Record<string, string> = {}, env = process.env): Record<string, string> {
  return { PATH: env.PATH ?? '/usr/bin:/bin', HOME: home, TMPDIR: join(home, 'tmp'), LANG: 'C.UTF-8', TZ: 'Europe/Vienna', CI: '1', NODE_ENV: 'test',
    npm_config_cache: join(home, 'npm-cache'), npm_config_audit: 'false', npm_config_fund: 'false', npm_config_update_notifier: 'false', GIT_TERMINAL_PROMPT: '0', ...extra };
}

/** Ein Befehl in eigener Prozessgruppe unter prlimit; bei Zeitüberschreitung wird die ganze Gruppe beendet. */
export function laufe(argv: string[], o: { cwd: string; env: Record<string, string>; deckel: Deckel; zeitMs: number; prlimit?: boolean }): Promise<{ code: number | null; signal: string | null; zeit: boolean; fehlt: boolean; ausgabe: string; ms: number }> {
  const t0 = Date.now();
  const pre = o.prlimit === false ? [] : ['prlimit', `--as=${o.deckel.speicherMb * 1024 * 1024}`, `--cpu=${o.deckel.cpuS}`, `--fsize=${o.deckel.dateiMb * 1024 * 1024}`, '--core=0', '--'];
  const [cmd, ...args] = [...pre, ...argv];
  return new Promise((resolve) => {
    let out = '', zeit = false, fertig = false;
    const p = spawn(cmd, args, { cwd: o.cwd, env: o.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const add = (b: Buffer) => { out = (out + b.toString('utf8')).slice(-8000); };
    p.stdout.on('data', add); p.stderr.on('data', add);
    const t = setTimeout(() => { zeit = true; try { process.kill(-p.pid!, 'SIGKILL'); } catch { /* weg */ } }, o.zeitMs);
    const ende = (code: number | null, signal: string | null, fehlt = false) => { if (fertig) return; fertig = true; clearTimeout(t); try { process.kill(-p.pid!, 'SIGKILL'); } catch { /* schon weg */ } resolve({ code, signal, zeit, fehlt, ausgabe: out.trim().slice(-2000), ms: Date.now() - t0 }); };
    p.on('error', (e: any) => ende(null, null, e?.code === 'ENOENT'));
    p.on('close', (code, signal) => ende(code, signal));
  });
}

export interface BackendEingang { repo: string; wt: string; basis: string; befehle: Befehl[]; quelle: string; deckel?: Deckel; id?: string }
export interface Backend { name: ExecName; netzGetrennt: boolean; laufe(e: BackendEingang): Promise<LaufBericht> }

export function lokal(o: { prlimit?: boolean; mongo?: typeof wegwerfMongo } = {}): Backend {
  return {
    name: 'local-allowlist', netzGetrennt: false,
    async laufe(e) {
      const deckel = e.deckel ?? DECKEL;
      const gruende: string[] = ['Netz nicht getrennt (diese VM kann keine Netztrennung) — nur Repos der Erlaubtliste'];
      aufraeumenAlt();
      const dir = mkdtempSync(join(tmpdir(), LAUF_PREFIX));
      const ergebnisse: LaufErgebnis[] = [];
      let db: Awaited<ReturnType<typeof wegwerfMongo>> = null;
      try {
        const src = join(dir, 'src'); mkdirSync(src); mkdirSync(join(dir, 'home', 'tmp'), { recursive: true });
        // Stand ohne .git und ohne node_modules aus dem PR-Worktree (git archive des Kopfes).
        const tar = join(dir, 'stand.tar');
        await execf('git', [...GIT_SAFE, 'archive', '--format=tar', '-o', tar, 'HEAD'], { cwd: e.wt, timeout: 120_000 });
        await execf('tar', ['-xf', tar, '-C', src], { timeout: 120_000 });
        rmSync(tar, { force: true });
        const brauchtMongo = e.befehle.some((b) => b.db === 'mongo');
        if (brauchtMongo) { db = await (o.mongo ?? wegwerfMongo)({ dir }); if (!db) gruende.push('Wegwerf-Mongo nicht verfügbar'); }
        const env = sichereUmgebung(join(dir, 'home'), db ? { MONGO_URI: db.url, MONGO_URI_WERKBANK: db.url, MONGO_URL: db.url } : {});
        // Abhängigkeiten: je Ordner mit package-lock.json, ohne Skripte (--ignore-scripts), mit Netz (lokal nicht trennbar).
        const ordner = [...new Set(e.befehle.map((b) => b.ordner ?? '.'))];
        for (const od of ordner) {
          if (!existsSync(join(src, od, 'package-lock.json'))) continue;
          const r = await laufe(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: join(src, od), env, deckel, zeitMs: deckel.befehlS * 1000, prlimit: o.prlimit });
          const k = einordnen(r);
          if (k.ergebnis !== 'ok') gruende.push(`npm ci in ${od}: ${k.grund ?? `Ausgang ${r.code}`}`);
        }
        const ende = Date.now() + deckel.gesamtS * 1000;
        for (const b of e.befehle) {
          const befehl = b.befehl.join(' ');
          if (b.db === 'postgres') { ergebnisse.push({ name: b.name, befehl, ergebnis: 'konnte-nicht-laufen', code: null, ms: 0, ausgabe: '', grund: 'Postgres im lokalen Läufer nicht verfügbar (docker-remote nutzen)' }); continue; }
          if (b.db === 'mongo' && !db) { ergebnisse.push({ name: b.name, befehl, ergebnis: 'konnte-nicht-laufen', code: null, ms: 0, ausgabe: '', grund: 'keine Wegwerf-Mongo' }); continue; }
          const rest = ende - Date.now();
          if (rest < 10_000) { ergebnisse.push({ name: b.name, befehl, ergebnis: 'konnte-nicht-laufen', code: null, ms: 0, ausgabe: '', grund: 'Gesamtzeit aufgebraucht' }); continue; }
          const cwd = join(src, b.ordner ?? '.');
          if (!existsSync(cwd)) { ergebnisse.push({ name: b.name, befehl, ergebnis: 'konnte-nicht-laufen', code: null, ms: 0, ausgabe: '', grund: `Ordner ${b.ordner} fehlt` }); continue; }
          const r = await laufe(b.befehl, { cwd, env, deckel, zeitMs: Math.min(rest, Math.min(deckel.befehlS, b.zeitS ?? deckel.befehlS) * 1000), prlimit: o.prlimit });
          const k = einordnen(r);
          ergebnisse.push({ name: b.name, befehl, ergebnis: k.ergebnis, code: r.code, ms: r.ms, ausgabe: r.ausgabe, ...(k.grund ? { grund: k.grund } : {}) });
        }
      } catch (x: any) {
        gruende.push(`Läufer: ${String(x?.message ?? x).slice(0, 200)}`);
      } finally {
        await db?.stopp().catch(() => {});
        rmSync(dir, { recursive: true, force: true });
      }
      return { backend: 'local-allowlist', netz: 'nicht getrennt', quelle: e.quelle, vollstaendig: vollstaendig(ergebnisse, gruende.slice(1)), gruende, ergebnisse };
    },
  };
}

// ---------- Backend: docker-remote (D4 a) ----------

/**
 * Protokoll mit scripts/wb-review-runner.sh auf dem Docker-Host: stdin = tar.gz mit `src/` (Stand) und `spec.json`
 * ({ id, befehle, deckel }); stdout = je Befehl eine JSON-Zeile { name, befehl, code, signal, zeit, ms, ausgabe },
 * zuletzt { ende: true, gruende: [...] }. Der Schlüssel erzwingt den Befehl auf dem Host (kein Shell-Zugang).
 */
export function dockerRemote(o: { ssh?: string; host?: string; key?: string; env?: NodeJS.ProcessEnv } = {}): Backend {
  const env = o.env ?? process.env;
  const host = o.host ?? env.REVIEW_EXEC_SSH_HOST ?? '';
  const key = o.key ?? env.REVIEW_EXEC_SSH_KEY ?? '';
  const ssh = o.ssh ?? env.REVIEW_EXEC_SSH_BIN ?? 'ssh';
  return {
    name: 'docker-remote', netzGetrennt: true,
    async laufe(e) {
      const deckel = e.deckel ?? DECKEL;
      if (!host || !key) return { backend: 'docker-remote', netz: 'getrennt', quelle: e.quelle, vollstaendig: false, gruende: ['docker-remote nicht eingerichtet (Host oder Schlüsselpfad fehlt)'], ergebnisse: [] };
      aufraeumenAlt();
      const dir = mkdtempSync(join(tmpdir(), LAUF_PREFIX));
      const gruende: string[] = [];
      const ergebnisse: LaufErgebnis[] = [];
      try {
        const id = (e.id ?? `${Date.now().toString(36)}`).replace(/[^a-z0-9-]/gi, '').slice(0, 30);
        mkdirSync(join(dir, 'paket', 'src'), { recursive: true });
        await execf('git', [...GIT_SAFE, 'archive', '--format=tar', '-o', join(dir, 'stand.tar'), 'HEAD'], { cwd: e.wt, timeout: 120_000 });
        await execf('tar', ['-xf', join(dir, 'stand.tar'), '-C', join(dir, 'paket', 'src')], { timeout: 120_000 });
        writeFileSync(join(dir, 'paket', 'spec.json'), JSON.stringify({ id, befehle: e.befehle, deckel }));
        await execf('tar', ['-czf', join(dir, 'paket.tgz'), '-C', join(dir, 'paket'), '.'], { timeout: 120_000 });
        const zeilen = await new Promise<string>((resolve, reject) => {
          const p = spawn(ssh, ['-i', key, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15', host, 'run', id], { stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: env.PATH ?? '/usr/bin:/bin', HOME: env.HOME ?? '/tmp' } });
          let out = '', err = '';
          p.stdout.on('data', (b) => { out += b.toString('utf8'); });
          p.stderr.on('data', (b) => { err = (err + b.toString('utf8')).slice(-2000); });
          const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* weg */ } }, (deckel.gesamtS + 300) * 1000);
          p.on('error', (x) => { clearTimeout(t); reject(x); });
          p.on('close', (code) => { clearTimeout(t); code === 0 || out.includes('"ende"') ? resolve(out) : reject(new Error(`ssh endete mit ${code}: ${err.trim().slice(-300)}`)); });
          createReadStream(join(dir, 'paket.tgz')).pipe(p.stdin);
        });
        for (const l of zeilen.split('\n')) {
          let j: any; try { j = JSON.parse(l); } catch { continue; }
          if (j.ende) { for (const g of j.gruende ?? []) gruende.push(String(g).slice(0, 200)); continue; }
          const k = einordnen({ code: typeof j.code === 'number' ? j.code : null, signal: j.signal ?? null, zeit: !!j.zeit, fehlt: !!j.fehlt });
          ergebnisse.push({ name: String(j.name), befehl: String(j.befehl ?? ''), ergebnis: k.ergebnis, code: j.code ?? null, ms: Number(j.ms) || 0, ausgabe: String(j.ausgabe ?? '').slice(-2000), ...(k.grund ? { grund: k.grund } : {}) });
        }
        if (ergebnisse.length < e.befehle.length) gruende.push(`${e.befehle.length - ergebnisse.length} Befehl(e) ohne Ergebnis`);
      } catch (x: any) {
        gruende.push(`docker-remote: ${String(x?.message ?? x).slice(0, 300)}`);
      } finally { rmSync(dir, { recursive: true, force: true }); }
      return { backend: 'docker-remote', netz: 'getrennt', quelle: e.quelle, vollstaendig: vollstaendig(ergebnisse, gruende), gruende, ergebnisse };
    },
  };
}

// ---------- Backend: managed-agents (D4 b) — noch nicht angebunden ----------

export function managedAgents(env = process.env): Backend {
  return {
    name: 'managed-agents', netzGetrennt: true,
    async laufe(e) {
      const grund = env.REVIEW_EXEC_ANTHROPIC_KEY_REF ? 'Managed-Agents-Adapter noch nicht angebunden (API-Abgleich ausstehend)' : 'Managed Agents braucht einen API-Key (Console) — noch nicht eingerichtet';
      return { backend: 'managed-agents', netz: 'getrennt', quelle: e.quelle, vollstaendig: false, gruende: [grund], ergebnisse: e.befehle.map((b) => ({ name: b.name, befehl: b.befehl.join(' '), ergebnis: 'konnte-nicht-laufen' as const, code: null, ms: 0, ausgabe: '', grund })) };
    },
  };
}

export function backend(env = process.env): Backend {
  const n = execBackend(env);
  return n === 'docker-remote' ? dockerRemote({ env }) : n === 'managed-agents' ? managedAgents(env) : lokal();
}

/** `ausfuehrung.md` (deutsch, fürs Paket) und ein englischer Abschnitt „Tests“ für den Kommentar. */
export function berichtMd(b: LaufBericht): { de: string; en: string } {
  const z = (r: LaufErgebnis) => `| ${r.name} | \`${r.befehl.replace(/\|/g, '\\|')}\` | ${r.ergebnis}${r.grund ? ` (${r.grund})` : ''} | ${Math.round(r.ms / 1000)} s |`;
  const de = [
    '# Ausführung (Review-Läufer)', '',
    `Backend: ${b.backend} · Netz: ${b.netz} · Befehle aus: ${b.quelle} · vollständig: ${b.vollstaendig ? 'ja' : 'nein'}`,
    ...(b.gruende.length ? ['', ...b.gruende.map((g) => `- ${g}`)] : []), '',
    '| Prüfung | Befehl | Ergebnis | Dauer |', '|---|---|---|---|', ...b.ergebnisse.map(z), '',
    ...b.ergebnisse.filter((r) => r.ergebnis !== 'ok' && r.ausgabe).flatMap((r) => [`## ${r.name} — Ausgabe (Ende)`, '', '```', r.ausgabe.slice(-1500), '```', '']),
  ].join('\n');
  const en = [
    '### Tests', '',
    `Executed by the review runner (${b.backend}; network ${b.netz === 'getrennt' ? 'isolated' : 'NOT isolated'}; commands from the base branch). Complete: ${b.vollstaendig ? 'yes' : 'no'}.`, '',
    ...b.ergebnisse.map((r) => `- ${r.name}: ${r.ergebnis === 'ok' ? 'passed' : r.ergebnis === 'rot' ? 'FAILED' : `could not run${r.grund ? ` (${r.grund})` : ''}`}`),
    ...(b.vollstaendig ? [] : ['', '> Incomplete run — a missing failure is not evidence of correctness.']),
  ].join('\n');
  return { de, en };
}
