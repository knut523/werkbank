// `@review deep` führt Tests aus (Knut 17.10.2026, Release 17c: „deep lokal ja — Wegwerf-DB ja, aber nicht immer recreaten“).
//
// Modus WERKBANK_REVIEW_EXEC (Vorgabe local-allowlist): nur PRs von Autor:innen der Erlaubtliste (WERKBANK_REVIEW_EXEC_AUTHORS,
// Vorgabe knut523,bizarrochris) in WirStrom1-Repos und knut523/werkbank; alles andere bleibt ein statisches Deep-Review.
// `off` schaltet ab; `docker-remote` und `managed-agents` sind die späteren Adapter (heute: statisch mit Hinweis).
//
// Lokal heißt: auf der Workspace-VM, NICHT netzisoliert — das Ergebnis trägt diese Beschriftung. Die Umgebung ist geleert
// (keine Tokens, kein BW_SESSION/GH_TOKEN, kein SSH-Agent), HOME ist ein eigener Wegwerf-Ordner, der npm-Cache je Repo bleibt
// zwischen Läufen liegen. Deckel: Zeit je Schritt und gesamt, Node-Heap; jeder Lauf ist eine eigene Prozessgruppe und wird bei
// Zeitablauf als Ganzes beendet.
//
// Datenbank (Paket 154 §a, `createdb -T`): je Repo eine VORLAGE auf der lokalen Postgres (WERKBANK_REVIEW_PG_URL, Port 55433),
// Name mit Hash des Migrationsstands der Basis — einmal gebaut (in einer Bau-DB, dann umbenannt und als Template ohne
// Verbindungen gesperrt). Je Review `createdb -T <vorlage> olaf_rv_<pr>_<sha8>` (Retry, falls die Vorlage kurz belegt ist),
// dann nur das Delta `prisma migrate deploy` des PR-Zweigs, Suiten, danach DROP. Höchstens zwei Vorlagen je Repo. Angefasst
// werden nur Datenbanken mit den Präfixen olaf_tpl_ und olaf_rv_.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export type ExecModus = 'local-allowlist' | 'off' | 'docker-remote' | 'managed-agents';
export const execModus = (env = process.env): ExecModus => {
  const m = String(env.WERKBANK_REVIEW_EXEC ?? env.REVIEW_EXEC ?? 'local-allowlist').trim();
  return (['local-allowlist', 'off', 'docker-remote', 'managed-agents'] as const).includes(m as ExecModus) ? (m as ExecModus) : 'off';
};
export const execAutoren = (env = process.env) => String(env.WERKBANK_REVIEW_EXEC_AUTHORS || 'knut523,bizarrochris').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
export const BESCHRIFTUNG = 'tests executed on the workspace VM (not network-isolated)';

/** Darf dieser PR lokal Tests ausführen? grund = englisch, für Statuszeile und Kommentar. */
export function execErlaubt(repo: string, autor: string | null | undefined, env = process.env): { ok: boolean; grund: string } {
  const m = execModus(env);
  if (m === 'off') return { ok: false, grund: 'test execution is switched off' };
  if (m !== 'local-allowlist') return { ok: false, grund: `test execution via ${m} is not available yet` };
  const org = String(repo).split('/')[0].toLowerCase();
  if (org !== 'wirstrom1' && String(repo).toLowerCase() !== 'knut523/werkbank') return { ok: false, grund: 'repository is not on the allow-list' };
  if (!autor || !execAutoren(env).includes(String(autor).toLowerCase())) return { ok: false, grund: 'PR author is not on the allow-list' };
  return { ok: true, grund: '' };
}

// ---------- Läufer ----------

export interface RunErgebnis { code: number; out: string; timedOut?: boolean }
export type Run = (cmd: string, args: string[], o: { cwd?: string; env: Record<string, string>; timeoutMs: number }) => Promise<RunErgebnis>;

/** Echt: ohne Shell, eigene Prozessgruppe, bei Zeitablauf die ganze Gruppe beenden; Ausgabe auf 200 kB gekürzt. */
export const realRun: Run = (cmd, args, o) => new Promise((resolve) => {
  let out = '';
  let fertig = false;
  const ende = (r: RunErgebnis) => { if (!fertig) { fertig = true; clearTimeout(t); resolve(r); } };
  const c = spawn(cmd, args, { cwd: o.cwd, env: o.env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const add = (b: Buffer) => { out += b.toString('utf8'); if (out.length > 400_000) out = out.slice(-200_000); };
  c.stdout.on('data', add); c.stderr.on('data', add);
  // Zeitablauf: Gruppe beenden UND sofort zurückkehren — ein entkommener Enkel könnte die Pipes sonst ewig offen halten (Pass C).
  const t = setTimeout(() => {
    try { process.kill(-c.pid!, 'SIGKILL'); } catch { /* schon weg */ }
    c.stdout.destroy(); c.stderr.destroy();
    ende({ code: 124, out: out.slice(-200_000), timedOut: true });
  }, o.timeoutMs);
  c.on('error', (e) => ende({ code: 127, out: String(e.message) }));
  c.on('close', (code) => ende({ code: code ?? 137, out: out.slice(-200_000) }));
});

/** Geleerte Umgebung: nur PATH, Wegwerf-HOME, wiederverwendbarer npm-Cache, Heap-Deckel — nichts aus process.env sonst. */
export function leereUmgebung(o: { home: string; npmCache: string; nodeBin?: string; heapMb?: number; extra?: Record<string, string> }): Record<string, string> {
  const path = [o.nodeBin ?? dirname(process.execPath), '/usr/local/bin', '/usr/bin', '/bin'].join(':');
  return {
    PATH: path, HOME: o.home, TMPDIR: join(o.home, 'tmp'), LANG: 'C.UTF-8', TZ: 'Europe/Vienna', CI: '1', NODE_ENV: 'test',
    npm_config_cache: o.npmCache, npm_config_update_notifier: 'false', npm_config_fund: 'false', npm_config_audit: 'false',
    NODE_OPTIONS: `--max-old-space-size=${o.heapMb ?? 3072}`, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1',
    ...(o.extra ?? {}),
  };
}

// ---------- Postgres-Vorlagen ----------

export interface PgZiel { host: string; port: string; user: string; password: string; db: string }
/** WERKBANK_REVIEW_PG_URL (postgres://user:pw@127.0.0.1:55433/postgres); fehlt sie, laufen DB-Suiten nicht. */
export function pgZiel(env = process.env): PgZiel | null {
  const raw = env.WERKBANK_REVIEW_PG_URL;
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (!/^postgres(ql)?:$/.test(u.protocol)) return null;
    return { host: u.hostname || '127.0.0.1', port: u.port || '55433', user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), db: u.pathname.replace(/^\//, '') || 'postgres' };
  } catch { return null; }
}
export const pgUrl = (z: PgZiel, db: string) => `postgresql://${encodeURIComponent(z.user)}:${encodeURIComponent(z.password)}@${z.host}:${z.port}/${db}`;
const pgEnv = (z: PgZiel): Record<string, string> => ({ PATH: '/usr/local/bin:/usr/bin:/bin', PGHOST: z.host, PGPORT: z.port, PGUSER: z.user, PGPASSWORD: z.password, PGDATABASE: z.db, PGCONNECT_TIMEOUT: '10' });

const IDENT = /^[a-z0-9_]{1,63}$/;
export const repoSlug = (repo: string) => String(repo).split('/')[1]?.toLowerCase().replace(/^olaf-/, '').replace(/[^a-z0-9]+/g, '_').slice(0, 24) || 'repo';
export const vorlageName = (repo: string, hash: string) => `olaf_tpl_${repoSlug(repo)}_${hash.slice(0, 10)}`;
export const reviewDbName = (repo: string, pr: number, sha: string) => `olaf_rv_${repoSlug(repo)}_${pr}_${sha.slice(0, 8)}`;
/** Nur unsere Präfixe; alles andere wird nie angefasst. */
export const unsere = (db: string) => IDENT.test(db) && /^olaf_(tpl|rv)_/.test(db);

export interface Pg {
  /** SQL über psql; liefert Zeilen (tA-Format). */
  sql: (q: string) => Promise<string[]>;
  createdb: (name: string, vorlage?: string) => Promise<void>;
  dropdb: (name: string) => Promise<void>;
}

export function pgVia(z: PgZiel, run: Run, psql = 'psql'): Pg {
  const bin = (n: string) => (process.env.WERKBANK_REVIEW_PG_BIN ? join(process.env.WERKBANK_REVIEW_PG_BIN, n) : n);
  const ok = async (cmd: string, args: string[]) => {
    const r = await run(bin(cmd), args, { env: pgEnv(z), timeoutMs: 120_000 });
    if (r.code !== 0) throw new Error(`${cmd}: ${r.out.trim().split('\n').slice(-2).join(' ').slice(0, 300)}`);
    return r.out;
  };
  return {
    sql: async (q) => (await ok(psql, ['-X', '-v', 'ON_ERROR_STOP=1', '-tA', '-c', q])).split('\n').map((s) => s.trim()).filter(Boolean),
    createdb: async (name, vorlage) => { if (!unsere(name) || (vorlage && !unsere(vorlage))) throw new Error('fremder DB-Name'); await ok('createdb', vorlage ? ['-T', vorlage, name] : [name]); },
    dropdb: async (name) => { if (!unsere(name)) throw new Error('fremder DB-Name'); await ok('dropdb', ['--if-exists', name]); },
  };
}

const bauSperre = new Map<string, Promise<boolean>>();
const warte = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Vorlage für diesen Migrationsstand: vorhanden → wiederverwenden; sonst in `<name>_bau` bauen (migrate(url) mit dem
 * Migrationsstand der Basis), umbenennen, als Template ohne Verbindungen sperren. Danach höchstens `behalten` Vorlagen je Repo.
 */
export async function vorlage(pg: Pg, repo: string, hash: string, migrate: (db: string) => Promise<void>, o: { behalten?: number; log?: (m: string) => void } = {}): Promise<{ name: string; neu: boolean }> {
  const name = vorlageName(repo, hash);
  if (!unsere(name)) throw new Error('fremder DB-Name');
  const da = async () => (await pg.sql(`select 1 from pg_database where datname = '${name}'`)).length > 0;
  if (await da()) return { name, neu: false };
  let p = bauSperre.get(name);
  if (!p) {
    bauSperre.set(name, p = (async () => {
      if (await da()) return false;
      const bau = `${name.slice(0, 59)}_bau`;
      await pg.dropdb(bau);   // Rest eines abgebrochenen Baus
      await pg.createdb(bau);
      try { await migrate(bau); } catch (e) { await pg.dropdb(bau).catch(() => {}); throw e; }
      await pg.sql(`alter database ${bau} rename to ${name}`);
      await pg.sql(`alter database ${name} with is_template true allow_connections false`);
      o.log?.(`vorlage gebaut ${name}`);
      // Aufräumen darf den fertigen Bau nicht scheitern lassen (z. B. alte Vorlage gerade belegt → nächstes Mal).
      await aufraeumen(pg, repo, o.behalten ?? 2, name).catch((e: any) => o.log?.(`aufräumen: ${String(e?.message ?? e).slice(0, 200)}`));
      return true;
    })().finally(() => bauSperre.delete(name)));
  }
  return { name, neu: await p };
}

/** Alte Vorlagen eines Repos (neueste = höchste oid) bis auf `behalten` löschen; die gerade gebaute bleibt immer. */
export async function aufraeumen(pg: Pg, repo: string, behalten: number, bleibt?: string): Promise<string[]> {
  const pre = `olaf_tpl_${repoSlug(repo)}_`;
  const rows = await pg.sql(`select datname from pg_database where datname like '${pre.replace(/_/g, '\\_')}%' and datname not like '%\\_bau' order by oid desc`);
  const weg = rows.filter((n) => unsere(n) && n.startsWith(pre) && n !== bleibt).slice(Math.max(0, behalten - (bleibt ? 1 : 0)));
  for (const n of weg) {
    await pg.sql(`alter database ${n} with is_template false allow_connections true`);
    await pg.dropdb(n);
  }
  return weg;
}

/** Review-DBs und Bau-DBs, die dieser Prozess gerade benutzt (alles andere mit unseren Präfixen ist verwaist). */
const aktiv = new Set<string>();
/** Nach einem Absturz liegengebliebene olaf_rv_* und *_bau löschen — nur unsere Präfixe, nie aktive. */
export async function verwaisteWeg(pg: Pg, log?: (m: string) => void): Promise<string[]> {
  const rows = await pg.sql(`select datname from pg_database where datname like 'olaf\\_rv\\_%' or (datname like 'olaf\\_tpl\\_%' and datname like '%\\_bau')`);
  const weg = rows.filter((n) => unsere(n) && !aktiv.has(n) && ![...bauSperre.keys()].some((t) => n === `${t.slice(0, 59)}_bau`));
  for (const n of weg) await pg.dropdb(n).catch((e: any) => log?.(`verwaist ${n}: ${e.message}`));
  return weg;
}

/** Review-DB aus der Vorlage; Postgres verweigert die Kopie, solange jemand mit der Vorlage verbunden ist → kurz warten, nochmal. */
export async function reviewDb(pg: Pg, vorlageDb: string, name: string, versuche = 5, pauseMs = 2000): Promise<void> {
  await pg.dropdb(name);
  for (let i = 1; ; i++) {
    try { await pg.createdb(name, vorlageDb); return; }
    catch (e: any) {
      if (i >= versuche || !/being accessed by other users|is being accessed/i.test(String(e?.message))) throw e;
      await warte(pauseMs * i);
    }
  }
}

// ---------- Ein Lauf ----------

export interface ExecJob { repo: string; number: number; head: string; basis: string | null; wt: string; paket: string; autor: string | null }
export interface ExecSchritt { name: string; code: number; minuten: number; timedOut: boolean; tail: string }
export interface ExecErgebnis { ausgefuehrt: boolean; grund: string; schritte: ExecSchritt[]; db: { vorlage: string; neu: boolean; review: string } | null; dbHinweis: string | null; md: string }
/** Adapter-Schnittstelle: heute lokal; docker-remote / managed-agents folgen mit derselben Form. */
export interface ExecAdapter { name: ExecModus; lauf: (job: ExecJob) => Promise<ExecErgebnis> }

/** Gesamtdeckel in Minuten (WERKBANK_REVIEW_EXEC_MIN, Vorgabe 20 seit 19.10. — die CI-Suiten brauchen mehr als 12; Unsinn → 20). */
export const execMinuten = (env = process.env) => { const n = Number(env.WERKBANK_REVIEW_EXEC_MIN); return Number.isFinite(n) && n > 0 && n <= 60 ? n : 20; };

/** Was die CI des Repos ausführt: `npm run <name>` aus .github/workflows/*.yml, in Reihenfolge, ohne Doppelte und ohne
 *  Deploy/Release/Publish/Sync/Mirror/Seed (Knut 19.10.: olaf-admin hat kein `test`, die Tests heißen `<bereich>:test[:db]`). */
export function ciSkripte(wt: string): string[] {
  const dir = join(wt, '.github', 'workflows');
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const f of readdirSync(dir).filter((x) => /\.ya?ml$/.test(x)).sort()) {
    let t = ''; try { t = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
    for (const m of t.matchAll(/npm run ([\w:.-]+)/g)) if (!out.includes(m[1]) && !/(^|:)(deploy|release|publish|sync|mirror|seed)$/.test(m[1])) out.push(m[1]);
  }
  return out;
}

/** Rein: Reihenfolge der Schritte — Grundskripte (typecheck, lint, test…), dann CI-Suiten, die eine geänderte Datei berühren,
 *  dann build, dann die übrigen CI-Suiten, solange der Deckel reicht. */
export function skriptPlan(grund: string[], ci: string[], scripts: Record<string, string>, geaendert: string[]): string[] {
  const da = (x: string) => !!scripts[x];
  const vorne = grund.filter((x) => x !== 'build' && da(x));
  const stems = geaendert.map((g) => g.split('/').pop()!.replace(/\.(test\.)?[cm]?[tj]sx?$/, '')).filter((x) => x.length >= 5);
  const trifft = (x: string) => geaendert.some((g) => scripts[x].includes(g)) || stems.some((st) => scripts[x].includes(st));
  const rest = ci.filter((x) => da(x) && !vorne.includes(x) && x !== 'build');
  const relevant = rest.filter(trifft);
  return [...vorne, ...relevant, ...(grund.includes('build') && da('build') ? ['build'] : []), ...rest.filter((x) => !relevant.includes(x))];
}
export const SKRIPTE = (env = process.env) => String(env.WERKBANK_REVIEW_EXEC_SCRIPTS || 'typecheck,lint,test,test:db,test:integration,build').split(',').map((s) => s.trim()).filter((s) => /^[\w:.-]{1,40}$/.test(s));

export function ergebnisMd(job: ExecJob, e: Omit<ExecErgebnis, 'md'>): string {
  const kopf = `# Tests — ${job.repo}#${job.number} @ ${job.head.slice(0, 7)}\n\n**${e.ausgefuehrt ? BESCHRIFTUNG : `static deep review — ${e.grund}`}**\n`;
  if (!e.ausgefuehrt) return `${kopf}\nNo commands from the PR were executed.\n`;
  const db = e.db ? `\nDatabase: copy of template \`${e.db.vorlage}\` (${e.db.neu ? 'built for this migration state' : 'reused'}), only the PR's new migrations applied, dropped afterwards.\n` : e.dbHinweis ? `\nDatabase: ${e.dbHinweis}\n` : '';
  const tab = ['| step | result | minutes |', '|---|---|---|', ...e.schritte.map((s) => `| ${s.name} | ${s.timedOut ? 'timed out' : s.code === 0 ? 'passed' : `failed (exit ${s.code})`} | ${s.minuten} |`)].join('\n');
  const fehl = e.schritte.filter((s) => s.code !== 0).map((s) => `\n## ${s.name} — last lines\n\n\`\`\`text\n${s.tail.replace(/```/g, "'''")}\n\`\`\`\n`).join('');
  return `${kopf}${db}\n${tab}\n${fehl}`;
}

export interface LokalDeps {
  run?: Run; pg?: Pg | null; env?: NodeJS.ProcessEnv; git?: (args: string[], cwd: string) => Promise<string>;
  /** Wurzel für Wegwerf-HOMEs und den npm-Cache je Repo. */
  base?: string; jetzt?: () => number; log?: (m: string) => void;
}

/** Lokaler Adapter: npm ci, Skripte der Erlaubtliste, ggf. DB aus der Vorlage; Gesamtdeckel WERKBANK_REVIEW_EXEC_MIN (12). */
export function lokalAdapter(d: LokalDeps = {}): ExecAdapter {
  const env = d.env ?? process.env;
  const run = d.run ?? realRun;
  const jetzt = d.jetzt ?? Date.now;
  return {
    name: 'local-allowlist',
    lauf: async (job) => {
      const erl = execErlaubt(job.repo, job.autor, env);
      const leer = (grund: string): ExecErgebnis => { const e = { ausgefuehrt: false, grund, schritte: [], db: null, dbHinweis: null }; return { ...e, md: ergebnisMd(job, e) }; };
      if (!erl.ok) return leer(erl.grund);
      const pkg = join(job.wt, 'package.json');
      if (!existsSync(pkg)) return leer('no package.json in the repository');
      const scripts: Record<string, string> = (() => { try { return JSON.parse(readFileSync(pkg, 'utf8')).scripts ?? {}; } catch { return {}; } })();
      const base = d.base ?? join(env.HOME || homedir(), 'work', 'knut', 'pr-reviews', '_exec');
      const npmCache = join(base, 'npm-cache', job.repo.replace('/', '__'));
      mkdirSync(npmCache, { recursive: true }); mkdirSync(join(base, 'home'), { recursive: true });
      const home = mkdtempSync(join(base, 'home', 'h-'));
      mkdirSync(join(home, 'tmp'), { recursive: true });
      const ende = jetzt() + execMinuten(env) * 60_000;
      const z0 = pgZiel(env);
      // Ausgaben aus dem PR können die Verbindungs-URL samt Passwort drucken → vor dem Ablegen maskieren (Pass C).
      const maske = (t: string) => {
        let s = t.replace(/postgres(ql)?:\/\/[^\s'"]+/g, 'postgresql://***');
        if (z0?.password && z0.password.length >= 4) s = s.split(z0.password).join('***');
        return s;
      };
      const schritte: ExecSchritt[] = [];
      let db: ExecErgebnis['db'] = null, dbHinweis: string | null = null;
      const pg = d.pg === undefined ? (pgZiel(env) ? pgVia(pgZiel(env)!, run) : null) : d.pg;
      let dbUrl: string | null = null;
      let belegt: string | null = null;   // Review-DB dieses Laufs (wird im finally immer gelöscht)
      const schritt = async (name: string, cmd: string, args: string[]) => {
        const rest = ende - jetzt();
        if (rest < 10_000) { schritte.push({ name, code: 124, minuten: 0, timedOut: true, tail: 'overall time limit reached' }); return false; }
        const t0 = jetzt();
        const r = await run(cmd, args, { cwd: job.wt, env: leereUmgebung({ home, npmCache, extra: dbUrl ? { DATABASE_URL: dbUrl } : {} }), timeoutMs: Math.min(rest, 8 * 60_000) });
        schritte.push({ name, code: r.code, minuten: Math.round((jetzt() - t0) / 6000) / 10, timedOut: !!r.timedOut, tail: maske(r.out.trim().split('\n').slice(-40).join('\n').slice(-6000)) });
        return r.code === 0;
      };
      try {
        if (!(await schritt('npm ci', 'npm', ['ci', '--no-audit', '--no-fund']))) return fertig();
        // Datenbank: nur mit Prisma-Migrationen und konfigurierter Review-Postgres
        const mig = join(job.wt, 'prisma', 'migrations');
        if (existsSync(mig)) {
          const rvName = reviewDbName(job.repo, job.number, job.head);
          if (!pg) dbHinweis = 'not set up (no review database configured) — DB suites ran without a database';
          else if (!job.basis || !d.git) dbHinweis = 'not set up (merge base unknown)';
          else if (aktiv.has(rvName)) dbHinweis = 'not set up (a run for the same PR state is already using its database)';
          else if (ende - jetzt() < 120_000) dbHinweis = 'not set up (time limit)';
          else {
            aktiv.add(rvName); belegt = rvName;
            await verwaisteWeg(pg, d.log).catch(() => []);
            try {
              const hash = (await d.git(['rev-parse', `${job.basis}:prisma/migrations`], job.wt)).trim();
              if (!/^[0-9a-f]{7,40}$/.test(hash)) throw new Error('kein Migrationsstand der Basis');
              const z = pgZiel(env);
              const migrate = async (ziel: string, schema?: string) => {
                const r = await run('npx', ['--no-install', 'prisma', 'migrate', 'deploy', ...(schema ? ['--schema', schema] : [])], { cwd: job.wt, env: leereUmgebung({ home, npmCache, extra: { DATABASE_URL: z ? pgUrl(z, ziel) : `postgresql://x/${ziel}` } }), timeoutMs: Math.max(30_000, Math.min(ende - jetzt(), 5 * 60_000)) });
                if (r.code !== 0) throw new Error(`prisma migrate deploy: ${maske(r.out.trim().split('\n').slice(-3).join(' ')).slice(0, 300)}`);
              };
              const v = await vorlage(pg, job.repo, hash, async (bau) => {
                // Migrationsstand der BASIS (nicht des PRs) in einen Wegwerf-Ordner und von dort migrieren
                // (git archive + tar: der Worktree und sein Index bleiben unberührt)
                const tmp = mkdtempSync(join(tmpdir(), 'rv-basis-'));
                try {
                  await d.git!(['archive', '--format=tar', '-o', join(tmp, 'basis.tar'), job.basis!, 'prisma'], job.wt);
                  const x = await run('tar', ['-xf', join(tmp, 'basis.tar'), '-C', tmp], { env: { PATH: '/usr/bin:/bin' }, timeoutMs: 60_000 });
                  if (x.code !== 0) throw new Error(`tar: ${x.out.slice(0, 200)}`);
                  await migrate(bau, join(tmp, 'prisma', 'schema.prisma'));
                } finally { rmSync(tmp, { recursive: true, force: true }); }
              }, { log: d.log });
              const rv = reviewDbName(job.repo, job.number, job.head);
              await reviewDb(pg, v.name, rv);
              db = { vorlage: v.name, neu: v.neu, review: rv };
              dbUrl = z ? pgUrl(z, rv) : null;
              const t0 = jetzt();
              try { await migrate(rv); schritte.push({ name: 'prisma migrate deploy (PR delta)', code: 0, minuten: Math.round((jetzt() - t0) / 6000) / 10, timedOut: false, tail: '' }); }
              catch (e: any) { schritte.push({ name: 'prisma migrate deploy (PR delta)', code: 1, minuten: Math.round((jetzt() - t0) / 6000) / 10, timedOut: false, tail: String(e.message) }); }
            } catch (e: any) { dbHinweis = `not set up: ${maske(String(e?.message ?? e)).slice(0, 200)}`; }
          }
        }
        const geaendert = job.basis && d.git ? (await d.git(['diff', '--name-only', `${job.basis}...HEAD`], job.wt).catch(() => '')).split('\n').map((x) => x.trim()).filter(Boolean) : [];
        for (const s of skriptPlan(SKRIPTE(env), ciSkripte(job.wt), scripts, geaendert)) await schritt(`npm run ${s}`, 'npm', ['run', s, '--if-present']);
        return fertig();
      } finally {
        if (pg && belegt) await pg.dropdb(belegt).catch((e: any) => d.log?.(`dropdb ${belegt}: ${e.message}`));
        if (belegt) aktiv.delete(belegt);
        rmSync(home, { recursive: true, force: true });
      }
      function fertig(): ExecErgebnis {
        const e = { ausgefuehrt: true, grund: '', schritte, db, dbHinweis };
        return { ...e, md: ergebnisMd(job, e) };
      }
    },
  };
}

/** Ergebnis ins Paket (tests.md); liefert den Absatz für den Review-Auftrag. */
export function schreibeErgebnis(paketDir: string, e: ExecErgebnis): string {
  writeFileSync(join(paketDir, 'tests.md'), e.md);
  return e.ausgefuehrt
    ? `Tests: Der Workspace hat sie für dieses Deep-Review schon ausgeführt — Ergebnis in \`tests.md\` im Paket. Beziehe es ein und kennzeichne es im Kommentar mit „${BESCHRIFTUNG}“. Selbst führst du weiterhin nichts aus.`
    : `Tests: nicht ausgeführt (${e.grund}) — statisches Deep-Review; schreib im Kommentar „static deep review — ${e.grund}“.`;
}
