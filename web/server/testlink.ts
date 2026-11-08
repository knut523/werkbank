// Angemeldete Test-Links (Knut 06./07.11.2026: „remember to give me a magic logged in link always, this is a test env“; docs/plan-testlinks.md).
// Je Worktree eine Test-Umgebung: Profil erkennen, freie Ports, eigene Test-DB, Mails im Trockenlauf, App bauen/starten, Proxy mit
// Test-Sitzung (testlink-proxy.ts) → fertiger Link über die Coder-Vorschau. Stoppen und Aufräumen nur über eigene, verifizierte PIDs.
// Harte Regeln: nur lokale Test-Datenbanken (Postgres 127.0.0.1:55433, DB `olaf_tl_<id>`; Werkbank: Mongo der isolierten Instanz),
// keine Prod/UAT/Azure-Adresse in der Umgebung (solche Werte werden geleert), Sitzungs-Geheimnis je Umgebung (nie in API/Log),
// Ablauf nach 7 Tagen.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { procStart, lebt, beendenProz } from '../../claude-bridge/src/prozesse.ts';
import net from 'node:net';
import http from 'node:http';

export type Profil = 'olaf-admin' | 'olaf-tariff-app' | 'werkbank' | 'statisch';
export type Status = 'startet' | 'laeuft' | 'fehler' | 'gestoppt' | 'abgelaufen' | 'beendet';
export const TAGE = 7;
export const TEST_EMAIL = 'knut-test@example.test';
export const TEST_NAME = 'Knut (Test)';
export const PG = { host: '127.0.0.1', port: 55433, user: 'olaf', password: 'olaf' } as const;
const HIER = dirname(fileURLToPath(import.meta.url));
export const PROXY_SKRIPT = join(HIER, 'testlink-proxy.ts');

export interface Proz { rolle: string; pid: number; start: string | null }
export interface Ports { proxy: number; app: number | null; basis: number | null }
export interface Umgebung {
  id: string; profil: Profil; ordner: string; wurzel: string; titel: string; strang: string | null; von: string;
  zweig: string | null; commit: string | null; dirty: boolean; ports: Ports; prozesse: Proz[]; db: string | null;
  link: string; lokal: string; startPfad: string; status: Status; schritt: string; fehler: string | null; logAuszug: string | null;
  gestartet: string; ablauf: string; geendet: string | null; geleert: string[]; gesund: { mit: number; ohne: number | null } | null;
}
interface Geheim { secret: string; token: string; cookies: { name: string; value: string }[] }

// ---------- reine Regeln (getestet in test/testlink.test.ts) ----------

const json = (f: string): any => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };

/** Welches Profil hat dieser Ordner? Ein Unterordner eines Repos zählt mit der Git-Wurzel (gitWurzel). */
export function profilVon(dir: string, gitWurzel: (d: string) => string | null = gitTop): { profil: Profil; wurzel: string } | null {
  for (const d of [...new Set([dir, gitWurzel(dir) ?? dir])]) {
    const name = json(join(d, 'package.json'))?.name;
    if (name === 'olaf-admin') return { profil: 'olaf-admin', wurzel: d };
    if (name === 'olaf-tariff-app') return { profil: 'olaf-tariff-app', wurzel: d };
    if (existsSync(join(d, 'scripts', 'isoliert.sh')) && existsSync(join(d, 'web', 'server', 'main.ts'))) return { profil: 'werkbank', wurzel: d };
  }
  // Statisch nur der Ordner selbst (sonst würde jede index.html irgendwo im Repo zur „Seite“).
  for (const s of ['dist', 'build', 'out', '.']) if (existsSync(join(dir, s, 'index.html'))) return { profil: 'statisch', wurzel: s === '.' ? dir : join(dir, s) };
  return null;
}

/** Kennung je Ordner: lesbarer Teil + Prüfsumme des echten Pfads (ein Ordner = eine Umgebung). */
export const umgebungsId = (real: string) => `${basename(real).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'ordner'}-${createHash('sha1').update(real).digest('hex').slice(0, 6)}`;
/** DB-Name je Umgebung und Ablage — zwei Werkbank-Instanzen (Live, Testkopie) mit eigener Ablage teilen sich nie eine Test-DB. */
export const dbName = (id: string, ablage = '') => `olaf_tl_${id.replace(/-/g, '_')}${ablage ? `_${createHash('sha1').update(ablage).digest('hex').slice(0, 4)}` : ''}`;

/** Harte Prüfung der Test-DB: nur lokal, nur Port 55433, nur `olaf_tl_…`. Wirft mit Grund. */
export function testDbPruefen(db: { host: string; port: number; name: string }) {
  if (!['127.0.0.1', 'localhost', '::1'].includes(db.host)) throw new Error(`Test-DB nur lokal — Host „${db.host}“ ist nicht erlaubt.`);
  if (db.port !== 55433) throw new Error(`Test-DB nur auf der lokalen Postgres 55433 — Port ${db.port} ist nicht erlaubt.`);
  if (!/^olaf_tl_[a-z0-9_]{1,50}$/.test(db.name)) throw new Error(`Test-DB muss „olaf_tl_…“ heißen — „${db.name}“ ist nicht erlaubt.`);
  if (/prod|uat/i.test(db.name)) throw new Error(`Test-DB-Name „${db.name}“ klingt nach Prod/UAT — abgelehnt.`);
}

/** Einfacher dotenv-Leser (KEY=VALUE, export, Anführungszeichen, Kommentare) — wie Next ihn für .env*-Dateien nutzt. */
export function dotenvLesen(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const roh of text.split(/\r?\n/)) {
    const m = roh.match(/^\s*(?:export\s+)?([\w.-]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    const q = v[0];
    if ((q === '"' || q === "'" || q === '`') && v.lastIndexOf(q) > 0) v = v.slice(1, v.lastIndexOf(q));
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = q === '"' ? v.replace(/\\n/g, '\n') : v;
  }
  return out;
}
/** .env-Dateien eines Next-Projekts in Next-Reihenfolge (früher = gewinnt): .env.production.local, .env.local, .env.production, .env. */
export function envDateien(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of ['.env', '.env.production', '.env.local', '.env.production.local']) {
    try { Object.assign(out, dotenvLesen(readFileSync(join(root, f), 'utf8'))); } catch { /* fehlt */ }
  }
  return out;
}

// Adressen, die nie in eine Test-Umgebung gehören (Prod/UAT/Azure-Dienste, Schlüsseltresor-Verweise).
const GEFAHR = /(\.database\.azure\.com|\.azurewebsites\.net|\.vault\.azure\.net|\.servicebus\.windows\.net|\.core\.windows\.net|\.documents\.azure\.com|\.azure-api\.net|@Microsoft\.KeyVault\(|(^|[^a-z])(prod|uat)([^a-z]|$))/i;
const ADRESS_SCHLUESSEL = /(URL|URI|HOST|ENDPOINT|DSN|CONNECTION|SERVER|DOMAIN|ORIGIN|DATABASE|^DB_|_DB$|PG|MONGO|REDIS|WEBHOOK|API_BASE|_BASE$)/i;
const LOKAL = (h: string) => /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[?::1\]?)$/i.test(h) || /\.(ws\.konekto\.energy|test|local|localhost|example)$/i.test(h);
const hostsIn = (v: string) => [...v.matchAll(/(?:[a-z][a-z0-9+.-]*:\/\/)(?:[^\s:@/]+(?::[^\s@/]*)?@)?(\[[0-9a-f:]+\]|[a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase())
  .concat(/^[a-z0-9.-]+\.[a-z]{2,}(:\d+)?$/i.test(v.trim()) ? [v.trim().toLowerCase().replace(/:\d+$/, '')] : []);

/** Umgebung prüfen: jede Prod/UAT/Azure-Adresse und jede nicht-lokale Adresse in einem Adress-Schlüssel wird geleert (leer gesetzt —
 *  Next übernimmt dann den Datei-Wert nicht). Ergebnis: bereinigte Umgebung und die geleerten Schlüssel (ohne Werte). */
export function envPruefen(env: Record<string, string>, erlaubt: string[] = []): { env: Record<string, string>; geleert: string[] } {
  const out = { ...env };
  const geleert: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    if (!v) continue;
    const fern = ADRESS_SCHLUESSEL.test(k) && hostsIn(v).some((h) => !LOKAL(h) && !erlaubt.includes(h));
    if (GEFAHR.test(v) || fern) { out[k] = ''; geleert.push(k); }
  }
  return { env: out, geleert: geleert.sort() };
}

/** Signierter better-auth-Sitzungs-Cookie: `<token>.<base64(HMAC-SHA256(secret, token))>`, URL-kodiert (wie better-call signCookie). */
export const betterAuthCookie = (token: string, secret: string) => encodeURIComponent(`${token}.${createHmac('sha256', secret).update(token).digest('base64')}`);

/** Coder-Vorschau-Adresse (Skill coder-preview-links): https://<port>--<agent>--<workspace>--<user>.ws.konekto.energy */
export function vorschauUrl(port: number, env: NodeJS.ProcessEnv = process.env): string {
  const ws = env.CODER_WORKSPACE_NAME || hostname();
  const wer = env.CODER_WORKSPACE_OWNER_NAME || env.USER || userInfo().username;
  return `https://${port}--${env.CODER_WORKSPACE_AGENT_NAME || 'main'}--${ws}--${wer}.${env.WERKBANK_PREVIEW_DOMAIN || 'ws.konekto.energy'}`;
}

/** Portbereich aus WERKBANK_TESTLINK_PORTE („3600-3699“). */
export function portBereich(s = process.env.WERKBANK_TESTLINK_PORTE): [number, number] {
  const m = String(s ?? '').match(/^(\d{4,5})-(\d{4,5})$/);
  const a = m ? Number(m[1]) : 3600, b = m ? Number(m[2]) : 3699;
  return a >= 1024 && b > a && b <= 65535 ? [a, b] : [3600, 3699];
}
export function portFrei(p: number): Promise<boolean> {
  return new Promise((ok) => { const s = net.createServer(); s.once('error', () => ok(false)); s.listen(p, '127.0.0.1', () => s.close(() => ok(true))); });
}
/** Werkbank (scripts/isoliert.sh, ISO_PORT_BASE): Web = b, LibreChat = b+10, Brücke = b+20, Meili = b+4225, Mongo = b+24010. */
export const isoPorts = (b: number) => [b, b + 10, b + 20, b + 4225, b + 24010];

/** Freie Ports je Profil aus dem Bereich, ohne die schon vergebenen. */
export async function portsWaehlen(profil: Profil, bereich: [number, number], belegt: Set<number>, frei: (p: number) => Promise<boolean> = portFrei): Promise<Ports> {
  const nimm = async (aus: Set<number>) => { for (let p = bereich[0]; p <= bereich[1]; p++) if (!belegt.has(p) && !aus.has(p) && await frei(p)) return p; return null; };
  let basis: number | null = null;
  if (profil === 'werkbank') {
    for (let b = bereich[0]; b + 20 <= bereich[1] && basis === null; b++) {
      const ps = isoPorts(b);
      if (ps.some((p) => belegt.has(p))) continue;
      if ((await Promise.all(ps.map(frei))).every(Boolean)) basis = b;
    }
    if (basis === null) throw new Error(`Kein freier Portblock für eine Werkbank-Testkopie in ${bereich.join('–')}.`);
  }
  const block = new Set(basis === null ? [] : isoPorts(basis));
  const mitApp = profil === 'olaf-admin' || profil === 'olaf-tariff-app';
  const app = mitApp ? await nimm(block) : basis;
  if (mitApp && app === null) throw new Error(`Kein freier Port in ${bereich.join('–')}.`);
  const proxy = await nimm(new Set([...block, ...(app === null ? [] : [app])]));
  if (proxy === null) throw new Error(`Kein freier Port für den Proxy in ${bereich.join('–')}.`);
  return { proxy, app, basis };
}

/** Geheimnisse aus Logzeilen nehmen (Werte und typische Schlüssel=Wert-Muster). */
export function schwaerzen(text: string, geheim: string[]): string {
  let t = text;
  for (const g of geheim.filter((x) => x && x.length >= 6)) t = t.split(g).join('***');
  return t.replace(/((?:secret|password|passwd|token|api[_-]?key|pepper|cookie)["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, '$1***');
}

// procStart/lebt/beenden liegen im Prozessregister (claude-bridge/src/prozesse.ts); hier nur weitergereicht.
export { procStart, lebt };
export const beenden = beendenProz;

// ---------- Werkzeuge mit Wirkung ----------

/** Schlanke Umgebung für Kindprozesse — nie die Werkbank-eigenen Geheimnisse (WERKBANK_INTERNAL_TOKEN, Schlüssel …) weitergeben. */
export function grundEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'SHELL', 'CODER_WORKSPACE_NAME', 'CODER_WORKSPACE_OWNER_NAME', 'CODER_WORKSPACE_AGENT_NAME', 'npm_config_cache'])
    if (env[k]) out[k] = String(env[k]);
  out.PATH = [dirname(process.execPath), out.PATH ?? '/usr/bin:/bin'].join(':');
  return out;
}

export function gitTop(d: string): string | null {
  const r = sync('git', ['-C', d, 'rev-parse', '--show-toplevel']);
  return r.code === 0 ? r.out.trim() || null : null;
}
function sync(cmd: string, args: string[], opt: { cwd?: string; env?: Record<string, string>; input?: string } = {}) {
  // Kurz und ohne Shell: git/psql-Abfragen; Exit ≠ 0 als Code, nicht als Ausnahme.
  const r = spawnSync(cmd, args, { cwd: opt.cwd, env: opt.env ?? grundEnv(), input: opt.input, encoding: 'utf8', timeout: 60_000 });
  return { code: r.status ?? 1, out: String(r.stdout ?? ''), err: String(r.stderr ?? '') };
}

export function gitStand(d: string): { zweig: string | null; commit: string | null; dirty: boolean } {
  const c = sync('git', ['-C', d, 'rev-parse', '--short=9', 'HEAD']);
  if (c.code !== 0) return { zweig: null, commit: null, dirty: false };
  const z = sync('git', ['-C', d, 'rev-parse', '--abbrev-ref', 'HEAD']).out.trim();
  // next-env.d.ts schreibt Next bei jedem Build selbst um — keine eigene Änderung.
  const s = sync('git', ['-C', d, 'status', '--porcelain', '--untracked-files=no']).out.split('\n').filter((l) => l.trim() && !/\bnext-env\.d\.ts$/.test(l));
  return { zweig: z && z !== 'HEAD' ? z : null, commit: c.out.trim(), dirty: s.length > 0 };
}

/** Befehl ausführen, Ausgabe ins Log der Umgebung; Ergebnis: Exit-Code. */
export function ausfuehren(cmd: string, args: string[], o: { cwd: string; env: Record<string, string>; log: string; timeoutMs?: number }): Promise<number> {
  return new Promise((ok) => {
    const fd = openSync(o.log, 'a');
    writeFileSync(fd, `\n$ ${cmd} ${args.join(' ')}   (${new Date().toISOString()})\n`);
    const c = spawn(cmd, args, { cwd: o.cwd, env: o.env, stdio: ['ignore', fd, fd], detached: true });
    const t = setTimeout(() => { try { process.kill(-c.pid!, 'SIGKILL'); } catch { /* weg */ } }, o.timeoutMs ?? 15 * 60_000);
    c.on('error', () => { clearTimeout(t); closeSync(fd); ok(127); });
    c.on('exit', (code) => { clearTimeout(t); closeSync(fd); ok(code ?? 1); });
  });
}
/** Dauerprozess in eigener Sitzung (Prozessgruppe) starten; PID + Startzeit für das spätere, gezielte Beenden. */
export function dauerprozess(rolle: string, cmd: string, args: string[], o: { cwd: string; env: Record<string, string>; log: string }): Proz {
  const fd = openSync(o.log, 'a');
  const c = spawn(cmd, args, { cwd: o.cwd, env: o.env, stdio: ['ignore', fd, fd], detached: true });
  closeSync(fd);
  c.unref();
  const pid = c.pid ?? 0;
  return { rolle, pid, start: pid ? procStart(pid) : null };
}

function psql(db: string, sql: string, input?: string) {
  return sync('psql', ['-h', PG.host, '-p', String(PG.port), '-U', PG.user, '-d', db, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], { env: { ...grundEnv(), PGPASSWORD: PG.password }, input });
}
const sqlText = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** HTTP-Abruf ohne Weiterleitung zu folgen (Status, Location). */
export function abrufen(url: string, headers: Record<string, string> = {}, timeoutMs = 15_000): Promise<{ status: number; location: string | null }> {
  return new Promise((ok) => {
    const r = http.get(url, { headers, timeout: timeoutMs }, (res) => { res.resume(); ok({ status: res.statusCode ?? 0, location: (res.headers.location as string) ?? null }); });
    r.on('timeout', () => r.destroy());
    r.on('error', () => ok({ status: 0, location: null }));
  });
}

// ---------- Profile ----------

export interface Ctx { u: Umgebung; geheim: Geheim; dir: string; log: string; neu: boolean; schritt: (s: string) => void }
export interface ProfilImpl {
  /** Pfad, der mit Sitzung über den Proxy 200 liefern muss; Pfad, der ohne Sitzung 401/30x liefern muss (null = ohne Anmeldung). */
  pruef: string; schutz: string | null; startPfad: string;
  vorbereiten(c: Ctx): Promise<void>;
  starten(c: Ctx): Promise<Proz[]>;
  /** Test-Sitzung anlegen (7 Tage) und die Cookies für den Proxy liefern. */
  sitzung(c: Ctx): Promise<{ name: string; value: string }[]>;
  aufraeumen(c: { u: Umgebung; dir: string; log: string }): Promise<void>;
  /** Statische Seite: der Proxy liefert die Dateien selbst. */
  statisch?: boolean;
}

/** npm ci nur, wenn nötig — nie zwei gleichzeitig auf dieser Maschine (Skill olaf-admin-lokal, Falle 4): flock + Warten auf fremde npm. */
async function abhaengigkeiten(c: Ctx, root: string, pruefDatei: string) {
  if (existsSync(join(root, pruefDatei))) return;
  c.schritt('installiert Abhängigkeiten (npm ci)');
  for (let i = 0; i < 120 && sync('pgrep', ['-x', 'npm']).code === 0; i++) await new Promise((r) => setTimeout(r, 5000));
  const code = await ausfuehren('flock', [join(homedir(), '.cache', 'werkbank-testlink-npm.lock'), 'npm', 'ci', '--include=dev', '--no-fund', '--no-audit', '--loglevel=error'], { cwd: root, env: grundEnv(), log: c.log, timeoutMs: 20 * 60_000 });
  if (code !== 0) throw new Error(`npm ci in ${root} fehlgeschlagen (Exit ${code}).`);
}

/** Next-Build nur, wenn der vorhandene nicht zu Commit, Umgebung (NEXT_PUBLIC_*) und Stand passt. Danach static/public neben den Standalone-Build. */
async function nextBauen(c: Ctx, env: Record<string, string>, fremdOk = false) {
  const root = c.u.wurzel;
  const fp = createHash('sha256').update(JSON.stringify(Object.entries(env).filter(([k]) => k.startsWith('NEXT_PUBLIC_')).sort())).digest('hex').slice(0, 16);
  const marke = join(root, '.next', 'werkbank-testlink.json');
  const bid = (() => { try { return readFileSync(join(root, '.next', 'BUILD_ID'), 'utf8').trim(); } catch { return null; } })();
  const m = json(marke);
  const standalone = existsSync(join(root, '.next', 'standalone', 'server.js'));
  const passt = !c.neu && !c.u.dirty && standalone && m && m.buildId === bid && m.fp === fp && m.commit === c.u.commit;
  // Ein vorhandener Build ohne unsere Marke (z. B. eine laufende Vorschau aus diesem Worktree) wird übernommen, wenn er nach dem
  // letzten Commit entstand und der Baum sauber ist — ein Neubau würde der laufenden Vorschau die Dateien unter den Füßen tauschen.
  // Nur für Profile ohne eingebaute Test-Schalter (olaf-admin); `neu` baut immer.
  const fremd = !passt && fremdOk && !m && !c.neu && !c.u.dirty && standalone && (() => { try { return statSync(join(root, '.next', 'BUILD_ID')).mtimeMs / 1000 >= Number(sync('git', ['-C', root, 'log', '-1', '--format=%ct']).out.trim()); } catch { return false; } })();
  if (fremd) c.schritt('übernimmt den vorhandenen Build (nach dem letzten Commit gebaut)');
  if (!passt && !fremd) {
    c.schritt('baut (2–3 Minuten)');
    const code = await ausfuehren('npm', ['run', 'build'], { cwd: root, env: { ...env, NODE_ENV: 'production' }, log: c.log, timeoutMs: 20 * 60_000 });
    if (code !== 0) throw new Error(`Build fehlgeschlagen (Exit ${code}).`);
    const neuBid = (() => { try { return readFileSync(join(root, '.next', 'BUILD_ID'), 'utf8').trim(); } catch { return null; } })();
    writeFileSync(marke, JSON.stringify({ buildId: neuBid, fp, commit: c.u.commit, at: new Date().toISOString() }));
  }
  if (!existsSync(join(root, '.next', 'standalone', 'server.js'))) throw new Error('Kein Standalone-Build (.next/standalone/server.js fehlt) — next.config ohne output: "standalone"?');
  // Falle 1 (olaf-admin-lokal): ohne .next/static neben dem Standalone-Build rendert die Seite nackt.
  cpSync(join(root, '.next', 'static'), join(root, '.next', 'standalone', '.next', 'static'), { recursive: true, force: true });
  if (existsSync(join(root, 'public'))) cpSync(join(root, 'public'), join(root, '.next', 'standalone', 'public'), { recursive: true, force: true });
}

const dbEnv = (name: string) => ({ DB_HOST: PG.host, DB_PORT: String(PG.port), DB_USER: PG.user, DB_PASSWORD: PG.password, DB_NAME: name, DB_SSL: 'disable', DATABASE_URL: `postgresql://${PG.user}:${PG.password}@${PG.host}:${PG.port}/${name}` });
const linkBasis = (u: Umgebung) => u.link.replace(/\/[^/]*$/, '').replace(/(https:\/\/[^/]+).*/, '$1');

/** Umgebung einer Next-App aus .env*-Dateien (geprüft) + festen Test-Werten. */
function nextEnv(c: Ctx, fest: Record<string, string>, leeren: string[]): Record<string, string> {
  const dateien = envDateien(c.u.wurzel);
  const geprueft = envPruefen(dateien);
  // gemeldet wird nur, was wirklich gesetzt war (Schlüssel, nie Werte)
  c.u.geleert = [...new Set([...geprueft.geleert, ...leeren.filter((k) => dateien[k])])].sort();
  return { ...grundEnv(), ...geprueft.env, ...Object.fromEntries(leeren.map((k) => [k, ''])), ...fest, NEXT_TELEMETRY_DISABLED: '1' };
}

const adminEnv = (c: Ctx) => nextEnv(c, {
  ...dbEnv(c.u.db!), BETTER_AUTH_SECRET: c.geheim.secret, BETTER_AUTH_URL: linkBasis(c.u), ADMIN_BASE_URL: linkBasis(c.u),
  // Mails nur im Trockenlauf (src/lib/brevo.ts: MAIL_DRY_RUN === 'true' oder kein BREVO_API_KEY); Umgebung „dev“.
  MAIL_DRY_RUN: 'true', APP_ENV: 'dev', WEBSITE_SITE_NAME: '', PORT: String(c.u.ports.app), HOSTNAME: '127.0.0.1',
}, ['BREVO_API_KEY', 'BREVO_WEBHOOK_SECRET', 'APPLICATIONINSIGHTS_CONNECTION_STRING', 'NEXT_PUBLIC_POSTHOG_KEY', 'NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN', 'POSTHOG_API_KEY']);

const OLAF_ADMIN: ProfilImpl = {
  pruef: '/', schutz: '/', startPfad: '/',
  async vorbereiten(c) {
    const name = c.u.db!;
    testDbPruefen({ host: PG.host, port: PG.port, name });
    c.schritt('prüft die lokale Postgres (55433)');
    if (psql('postgres', 'select 1').code !== 0) throw new Error('Die lokale Postgres auf 127.0.0.1:55433 antwortet nicht — einmal ~/.claude/skills/olaf-admin-lokal/start.sh laufen lassen (startet sie).');
    await abhaengigkeiten(c, c.u.wurzel, 'node_modules/.bin/next');
    const da = psql('postgres', `select 1 from pg_database where datname=${sqlText(name)}`).out.trim() === '1';
    if (da && c.neu) psql('postgres', `drop database if exists "${name}" with (force)`);
    if (!da || c.neu) {
      const r = psql('postgres', `create database "${name}"`);
      if (r.code !== 0) throw new Error(`Test-DB ${name} ließ sich nicht anlegen: ${r.err.slice(-300)}`);
    }
    const env = adminEnv(c);
    c.schritt('Migrationen');
    if (await ausfuehren('npx', ['prisma', 'migrate', 'deploy'], { cwd: c.u.wurzel, env, log: c.log, timeoutMs: 5 * 60_000 }) !== 0) throw new Error('prisma migrate deploy fehlgeschlagen.');
    if ((!da || c.neu) && existsSync(join(c.u.wurzel, 'tools', 'local-db', 'seed.ts'))) {
      c.schritt('Seed');
      // Der Seed weigert sich selbst auf allem außer localhost:55433 — doppelt hält besser.
      if (await ausfuehren('npx', ['tsx', 'tools/local-db/seed.ts'], { cwd: c.u.wurzel, env: { ...env, DB_HOST: 'localhost' }, log: c.log, timeoutMs: 5 * 60_000 }) !== 0) c.schritt('Seed fehlgeschlagen — weiter ohne Beispieldaten');
      const fx = join(homedir(), 'work', 'service-view-lab', 'fixtures', 'service-fixture.sql');
      if (existsSync(fx)) sync('psql', ['-h', PG.host, '-p', String(PG.port), '-U', PG.user, '-d', name, '-f', fx], { env: { ...grundEnv(), PGPASSWORD: PG.password } });
    }
    await nextBauen(c, env, true);
  },
  async starten(c) {
    return [dauerprozess('app', process.execPath, ['server.js'], { cwd: join(c.u.wurzel, '.next', 'standalone'), env: { ...adminEnv(c), NODE_ENV: 'production' }, log: c.log })];
  },
  async sitzung(c) {
    const name = c.u.db!;
    testDbPruefen({ host: PG.host, port: PG.port, name });
    const mitRechten = psql(name, `select 1 from information_schema.columns where table_name='user' and column_name='permissions'`).out.trim() === '1';
    const r1 = psql(name, `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", role, "twoFactorEnabled"${mitRechten ? ', permissions' : ''})
      VALUES ('tl-knut', ${sqlText(TEST_NAME)}, ${sqlText(TEST_EMAIL)}, true, NOW(), NOW(), 'admin', true${mitRechten ? `, '{}'::jsonb` : ''})
      ON CONFLICT (id) DO UPDATE SET role='admin', "twoFactorEnabled"=true, banned=false, "updatedAt"=NOW()`);
    if (r1.code !== 0) throw new Error(`Test-Admin ließ sich nicht anlegen: ${r1.err.slice(-300)}`);
    const r2 = psql(name, `DELETE FROM session WHERE id='tl-knut-session'; INSERT INTO session (id, "expiresAt", token, "createdAt", "updatedAt", "userId")
      VALUES ('tl-knut-session', ${sqlText(c.u.ablauf)}::timestamptz, ${sqlText(c.geheim.token)}, NOW(), NOW(), 'tl-knut')`);
    if (r2.code !== 0) throw new Error(`Test-Sitzung ließ sich nicht anlegen: ${r2.err.slice(-300)}`);
    const v = betterAuthCookie(c.geheim.token, c.geheim.secret);
    // Über die https-Vorschau heißt der Cookie __Secure-… (Skill olaf-admin-lokal); beide schicken.
    return [{ name: 'better-auth.session_token', value: v }, { name: '__Secure-better-auth.session_token', value: v }];
  },
  async aufraeumen({ u }) {
    if (!u.db) return;
    testDbPruefen({ host: PG.host, port: PG.port, name: u.db });
    psql('postgres', `drop database if exists "${u.db}" with (force)`);
  },
};

const TARIF: ProfilImpl = {
  pruef: '/', schutz: null, startPfad: '/',
  async vorbereiten(c) {
    await abhaengigkeiten(c, c.u.wurzel, 'node_modules/.bin/next');
    await nextBauen(c, tarifEnv(c));
  },
  async starten(c) {
    return [dauerprozess('app', process.execPath, ['server.js'], { cwd: join(c.u.wurzel, '.next', 'standalone'), env: { ...tarifEnv(c), NODE_ENV: 'production' }, log: c.log })];
  },
  async sitzung() { return []; },
  async aufraeumen() { /* keine DB */ },
};
// Tarif-App: ohne olaf-admin und Rechen-API (Dev-Bypass, src/lib/services/api.ts) — nie echte Anträge, keine Analyse-Ereignisse.
const tarifEnv = (c: Ctx) => nextEnv(c, { NEXT_PUBLIC_ADMIN_DEV_BYPASS: 'true', NEXT_PUBLIC_APP_ENV: 'dev', NEXT_PUBLIC_APP_URL: linkBasis(c.u), PORT: String(c.u.ports.app), HOSTNAME: '127.0.0.1' },
  ['CALC_API_URL', 'NEXT_PUBLIC_CALC_API_URL', 'NEXT_PUBLIC_ADMIN_API_URL', 'NEXT_PUBLIC_BATTERY_AUTARKY_URL', 'NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN', 'NEXT_PUBLIC_POSTHOG_HOST', 'APPLICATIONINSIGHTS_CONNECTION_STRING']);

const isoEnv = (c: { u: Umgebung; dir: string }) => ({
  ...grundEnv(), ISO_DIR: join(c.dir, 'iso'), ISO_PORT_BASE: String(c.u.ports.basis),
  // Testkopie: Brücke im Mock (kein Modellaufruf), nur das Testkonto, Jira/Vault im Trockenlauf (isoliert.sh setzt WERKBANK_DRYRUN=1).
  BRIDGE_MOCK: '1', WERKBANK_ALLOWED_EMAILS: TEST_EMAIL, BRIDGE_ALLOWED_EMAILS: TEST_EMAIL, BRIDGE_AUTO_EMAILS: '', BRIDGE_CLAUDE_CONFIG_SHARED: '',
});
const WERKBANK: ProfilImpl = {
  pruef: '/api/v2/start?teil=oben', schutz: '/api/v2/start?teil=oben', startPfad: '/v2/',
  async vorbereiten(c) {
    const w = c.u.wurzel;
    await abhaengigkeiten(c, join(w, 'web'), 'node_modules/.bin/vite');
    await abhaengigkeiten(c, join(w, 'claude-bridge'), 'node_modules');
    // Oberflächen (alt und 2.0) für diesen Stand bauen — sonst zeigt die Testkopie einen alten Build.
    c.schritt('baut die Oberflächen');
    for (const [d, args] of [[join(w, 'web'), ['vite', 'build', '--logLevel', 'error']], [join(w, 'web', 'app'), ['vite', 'build', '--logLevel', 'error']]] as const)
      if (await ausfuehren('npx', [...args], { cwd: d, env: grundEnv(), log: c.log, timeoutMs: 10 * 60_000 }) !== 0) throw new Error(`Build in ${d} fehlgeschlagen.`);
  },
  async starten(c) {
    c.schritt('startet die isolierte Werkbank (Mongo, Brücke im Mock, LibreChat, Web)');
    const code = await ausfuehren('bash', [join(c.u.wurzel, 'scripts', 'isoliert.sh'), 'start'], { cwd: c.u.wurzel, env: isoEnv(c), log: c.log, timeoutMs: 10 * 60_000 });
    const pids = join(c.dir, 'iso', 'pids');
    const ps = existsSync(pids) ? readdirSync(pids).filter((f) => f.endsWith('.pid')).map((f) => { const pid = Number(readFileSync(join(pids, f), 'utf8').trim()); return { rolle: f.replace(/\.pid$/, ''), pid, start: procStart(pid) }; }) : [];
    if (code !== 0) { c.u.prozesse = ps; throw new Error(`scripts/isoliert.sh start fehlgeschlagen (Exit ${code}).`); }
    return ps;
  },
  async sitzung(c) {
    const { MongoClient } = await import('mongodb');
    const port = (c.u.ports.basis ?? 0) + 24010;
    const m = new MongoClient(`mongodb://127.0.0.1:${port}`, { serverSelectionTimeoutMS: 5000 });
    try {
      await m.connect();
      const users = m.db('LibreChat').collection('users');
      await users.updateOne({ email: TEST_EMAIL }, { $set: { name: TEST_NAME, username: 'knut-test', role: 'ADMIN', emailVerified: true, provider: 'local', updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
      const user: any = await users.findOne({ email: TEST_EMAIL });
      const sessions = m.db('werkbank').collection('sessions');
      await sessions.deleteMany({ zweck: 'testlink' } as any);
      await sessions.insertOne({ _id: createHash('sha256').update(c.geheim.token).digest('hex') as any, userId: String(user._id), email: TEST_EMAIL, name: TEST_NAME, role: 'ADMIN', createdAt: new Date(), expiresAt: new Date(c.u.ablauf), zweck: 'testlink' } as any);
    } finally { await m.close().catch(() => {}); }
    return [{ name: 'wb_session', value: c.geheim.token }];
  },
  async aufraeumen(c) {
    if (existsSync(join(c.u.wurzel, 'scripts', 'isoliert.sh')) && existsSync(join(c.dir, 'iso')))
      await ausfuehren('bash', [join(c.u.wurzel, 'scripts', 'isoliert.sh'), 'stop'], { cwd: c.u.wurzel, env: isoEnv(c), log: c.log, timeoutMs: 2 * 60_000 });
    rmSync(join(c.dir, 'iso'), { recursive: true, force: true });
  },
};

const STATISCH: ProfilImpl = {
  pruef: '/', schutz: null, startPfad: '/', statisch: true,
  async vorbereiten() { /* nichts */ }, async starten() { return []; }, async sitzung() { return []; }, async aufraeumen() { /* nichts */ },
};

export const PROFILE: Record<Profil, ProfilImpl> = { 'olaf-admin': OLAF_ADMIN, 'olaf-tariff-app': TARIF, werkbank: WERKBANK, statisch: STATISCH };

// ---------- Ablage und Lebenszyklus ----------

export interface Deps {
  /** Ordner für die Umgebungen (je Kennung ein Unterordner). */
  ablage: string;
  profile?: Partial<Record<Profil, ProfilImpl>>;
  jetzt?: () => Date;
  portFrei?: (p: number) => Promise<boolean>;
  /** Gesundheitscheck: Wartezeit gesamt, Abstand. */
  warteMs?: number; abstandMs?: number;
  log?: (msg: string, data: Record<string, unknown>) => void;
  /** Höchstzahl gleichzeitig laufender Umgebungen. */
  max?: number;
}

const pfadDer = (d: Deps, id: string) => join(d.ablage, id);
function lesen(d: Deps, id: string): Umgebung | null { return json(join(pfadDer(d, id), 'umgebung.json')); }
function speichern(d: Deps, u: Umgebung) {
  const dir = pfadDer(d, u.id); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const f = join(dir, 'umgebung.json'); writeFileSync(`${f}.tmp`, JSON.stringify(u, null, 2)); renameSync(`${f}.tmp`, f);
}
function geheimLesen(d: Deps, id: string): Geheim | null { return json(join(pfadDer(d, id), 'geheim.json')); }
function geheimSchreiben(d: Deps, id: string, g: Geheim) { writeFileSync(join(pfadDer(d, id), 'geheim.json'), JSON.stringify(g), { mode: 0o600 }); }

export function alle(d: Deps): Umgebung[] {
  if (!existsSync(d.ablage)) return [];
  return readdirSync(d.ablage).map((id) => lesen(d, id)).filter((u): u is Umgebung => !!u).sort((a, b) => b.gestartet.localeCompare(a.gestartet));
}
/** Was nach außen geht (API, CLI, Werkzeug): ohne PIDs-Startzeiten und nie mit Geheimnissen (die liegen nur in geheim.json). */
export function sicht(u: Umgebung, jetzt = new Date()) {
  const { prozesse, ...rest } = u;
  const stand = u.wurzel && u.commit ? gitStand(u.wurzel) : null;
  return { ...rest, prozesse: prozesse.length, laeuftNoch: u.status === 'laeuft' && prozesse.every(lebt), neuerCommit: stand?.commit && stand.commit !== u.commit ? stand.commit : null, abgelaufen: new Date(u.ablauf) <= jetzt };
}

const laufend = new Map<string, Promise<Umgebung>>();

export interface StartEingabe { ordner: string; titel?: string; strang?: string | null; von: string; neu?: boolean }

/** Start (oder vorhandene laufende Umgebung desselben Stands zurückgeben). `fertig` = Promise bis Link/Fehler; `u` sofort (Status startet). */
export async function starten(e: StartEingabe, d: Deps): Promise<{ u: Umgebung; fertig: Promise<Umgebung>; schon?: boolean }> {
  let real: string;
  try { real = realpathSync(e.ordner); } catch { throw Object.assign(new Error('Den Ordner gibt es nicht.'), { status: 400 }); }
  const p = profilVon(real);
  if (!p) throw Object.assign(new Error(`Kein bekanntes Profil in ${real} (olaf-admin, olaf-tariff-app, Werkbank-Checkout oder Ordner mit index.html).`), { status: 422 });
  const id = umgebungsId(real);
  const jetzt = d.jetzt?.() ?? new Date();
  if (laufend.has(id)) { const u = lesen(d, id)!; return { u, fertig: laufend.get(id)!, schon: true }; }
  const alt = lesen(d, id);
  const stand = p.profil === 'statisch' ? { zweig: null, commit: null, dirty: false } : gitStand(p.wurzel);
  if (alt && alt.status === 'laeuft' && !e.neu && alt.prozesse.every(lebt) && alt.commit === stand.commit && !stand.dirty && new Date(alt.ablauf) > jetzt) {
    // Derselbe Ordner, jetzt aus einem Unter-Chat: Zuordnung nachtragen (sonst findet der Knopf dort die laufende Umgebung nicht).
    if (e.strang && alt.strang !== e.strang) { alt.strang = e.strang; if (e.titel) alt.titel = e.titel; speichern(d, alt); }
    return { u: alt, fertig: Promise.resolve(alt), schon: true };
  }
  const max = d.max ?? (Number(process.env.WERKBANK_TESTLINK_MAX) || 6);
  if (alle(d).filter((x) => x.id !== id && (x.status === 'laeuft' || x.status === 'startet')).length >= max)
    throw Object.assign(new Error(`Schon ${max} Test-Umgebungen laufen — erst eine stoppen (Speicher).`), { status: 429 });
  if (alt) await stoppen(id, d, 'gestoppt');

  const impl = (d.profile?.[p.profil] ?? PROFILE[p.profil]);
  const belegt = new Set(alle(d).filter((x) => x.status === 'laeuft' || x.status === 'startet').flatMap((x) => [x.ports.proxy, x.ports.app, ...(x.ports.basis ? isoPorts(x.ports.basis) : [])].filter((n): n is number => !!n)));
  const ports = await portsWaehlen(p.profil, portBereich(), belegt, d.portFrei);
  const link = `${vorschauUrl(ports.proxy)}${impl.startPfad}`;
  const u: Umgebung = {
    id, profil: p.profil, ordner: real, wurzel: p.wurzel, titel: e.titel || basename(real), strang: e.strang ?? null, von: e.von,
    ...stand, ports, prozesse: [], db: p.profil === 'olaf-admin' ? dbName(id, d.ablage) : null,
    link, lokal: `http://127.0.0.1:${ports.proxy}${impl.startPfad}`, startPfad: impl.startPfad, status: 'startet', schritt: 'bereitet vor', fehler: null, logAuszug: null,
    gestartet: jetzt.toISOString(), ablauf: new Date(jetzt.getTime() + TAGE * 864e5).toISOString(), geendet: null, geleert: [], gesund: null,
  };
  speichern(d, u);
  const dir = pfadDer(d, id);
  const log = join(dir, 'app.log');
  writeFileSync(log, '');
  const geheim: Geheim = { secret: randomBytes(32).toString('base64url'), token: randomBytes(32).toString('hex'), cookies: [] };
  geheimSchreiben(d, id, geheim);
  const ctx: Ctx = { u, geheim, dir, log, neu: !!e.neu, schritt: (s) => { u.schritt = s; speichern(d, u); } };
  const fertig = (async () => {
    try {
      await impl.vorbereiten(ctx);
      ctx.schritt('startet');
      u.prozesse = await impl.starten(ctx);
      speichern(d, u);
      ctx.schritt('legt die Test-Sitzung an');
      geheim.cookies = await impl.sitzung(ctx);
      geheimSchreiben(d, id, geheim);
      const host = new URL(link).host;
      const pcfg = join(dir, 'proxy.json');
      writeFileSync(pcfg, JSON.stringify({ listen: ports.proxy, upstream: impl.statisch ? null : ports.app, statisch: impl.statisch ? u.wurzel : null, cookies: geheim.cookies, ablauf: u.ablauf, host }), { mode: 0o600 });
      u.prozesse.push(dauerprozess('proxy', process.execPath, [PROXY_SKRIPT, pcfg], { cwd: dir, env: grundEnv(), log: join(dir, 'proxy.log') }));
      speichern(d, u);
      ctx.schritt('Gesundheitscheck');
      u.gesund = await gesundheit(u, impl, host, d);
      u.status = 'laeuft'; u.schritt = 'läuft'; speichern(d, u);
      d.log?.('testlink läuft', { id, profil: u.profil, commit: u.commit, proxy: ports.proxy });
      return u;
    } catch (err: any) {
      u.fehler = String(err?.message ?? err).slice(0, 600);
      u.logAuszug = logAuszug(log, geheim);
      d.log?.('testlink fehler', { id, profil: u.profil, fehler: u.fehler.slice(0, 200) });
      await aufraeumenEine(u, d, impl);
      u.status = 'fehler'; u.geendet = new Date().toISOString(); speichern(d, u);
      return u;
    } finally { laufend.delete(id); }
  })();
  laufend.set(id, fertig);
  return { u, fertig };
}

export function logAuszug(log: string, g: Geheim | null, zeilen = 40): string {
  let t = '';
  try { t = readFileSync(log, 'utf8'); } catch { return ''; }
  return schwaerzen(t.split('\n').slice(-zeilen).join('\n'), [g?.secret ?? '', g?.token ?? '', ...(g?.cookies ?? []).map((c) => c.value), PG.password === 'olaf' ? '' : PG.password]).slice(-6000);
}

/** Mit Proxy (Test-Sitzung) 200 — Weiterleitungen auf demselben Host werden verfolgt, /login zählt nicht; ohne Sitzung direkt an der App
 *  401/30x (nur Profile mit Anmeldung). Ohne Anmeldung offen = Fehler (die App schützt sich nicht). */
export async function gesundheit(u: Umgebung, impl: Pick<ProfilImpl, 'pruef' | 'schutz'>, host: string, d: Pick<Deps, 'warteMs' | 'abstandMs'>): Promise<{ mit: number; ohne: number | null }> {
  const bis = Date.now() + (d.warteMs ?? 120_000);
  let mit = 0, ohne: number | null = null, grund = '';
  while (Date.now() < bis) {
    let pfad = impl.pruef;
    let r = await abrufen(`http://127.0.0.1:${u.ports.proxy}${pfad}`, { host });
    for (let i = 0; i < 4 && r.status >= 300 && r.status < 400 && r.location; i++) {
      const l = new URL(r.location, `https://${host}`);
      if (l.host !== host) break;
      pfad = l.pathname + l.search;
      r = await abrufen(`http://127.0.0.1:${u.ports.proxy}${pfad}`, { host });
    }
    mit = r.status;
    const anmeldung = /\/(login|sign-?in|anmelden)\b/.test(pfad);
    ohne = impl.schutz && u.ports.app ? (await abrufen(`http://127.0.0.1:${u.ports.app}${impl.schutz}`, { host })).status : null;
    if (mit === 200 && !anmeldung) {
      if (ohne === null || [401, 403, 302, 303, 307, 308].includes(ohne)) return { mit, ohne };
      if (ohne === 200) throw new Error(`Ohne Anmeldung liefert ${impl.schutz} schon 200 — die App ist nicht geschützt; Link wird nicht ausgegeben.`);
    }
    grund = anmeldung ? `landet auf ${pfad} (Sitzung greift nicht)` : `mit Sitzung ${mit || 'keine Antwort'}`;
    await new Promise((r2) => setTimeout(r2, d.abstandMs ?? 2000));
  }
  throw new Error(`Gesundheitscheck fehlgeschlagen: ${grund}${ohne !== null ? `, ohne Sitzung ${ohne || 'keine Antwort'}` : ''}.`);
}

async function aufraeumenEine(u: Umgebung, d: Deps, impl?: ProfilImpl) {
  for (const p of [...u.prozesse].reverse()) await beenden(p).catch(() => false);
  try { await (impl ?? d.profile?.[u.profil] ?? PROFILE[u.profil]).aufraeumen({ u, dir: pfadDer(d, u.id), log: join(pfadDer(d, u.id), 'app.log') }); } catch (e: any) { d.log?.('testlink aufräumen fehler', { id: u.id, fehler: String(e?.message ?? e).slice(0, 200) }); }
  rmSync(join(pfadDer(d, u.id), 'geheim.json'), { force: true });
  rmSync(join(pfadDer(d, u.id), 'proxy.json'), { force: true });
}

/** Stoppen: Prozesse (nur eigene, verifiziert), DB bzw. Testinstanz, Geheimnisse weg; der Eintrag bleibt mit Status und Logs. */
export async function stoppen(id: string, d: Deps, status: Status = 'gestoppt'): Promise<Umgebung | null> {
  if (laufend.has(id)) await laufend.get(id)!.catch(() => null);
  const u = lesen(d, id);
  if (!u) return null;
  if (!['gestoppt', 'abgelaufen', 'beendet'].includes(u.status) || existsSync(join(pfadDer(d, id), 'geheim.json'))) await aufraeumenEine(u, d);
  if (u.status === 'laeuft' || u.status === 'startet' || u.status === 'fehler') { u.status = u.status === 'fehler' && status === 'gestoppt' ? 'fehler' : status; u.geendet = new Date().toISOString(); }
  u.schritt = u.status === 'fehler' ? 'Fehler' : 'beendet';
  speichern(d, u);
  d.log?.('testlink gestoppt', { id, status: u.status });
  return u;
}

/** Takt (alle 10 min) und vor jeder Liste: Abgelaufenes stoppen, Umgebungen mit toten Prozessen beenden, verwaiste Starts als Fehler,
 *  alte Einträge (beendet seit > 7 Tagen) löschen. */
export async function aufraeumen(d: Deps): Promise<{ abgelaufen: string[]; beendet: string[] }> {
  const jetzt = d.jetzt?.() ?? new Date();
  const out = { abgelaufen: [] as string[], beendet: [] as string[] };
  for (const u of alle(d)) {
    if (laufend.has(u.id)) continue;
    if ((u.status === 'laeuft' || u.status === 'startet') && new Date(u.ablauf) <= jetzt) { await stoppen(u.id, d, 'abgelaufen'); out.abgelaufen.push(u.id); continue; }
    if (u.status === 'laeuft' && !u.prozesse.every(lebt)) { await stoppen(u.id, d, 'beendet'); out.beendet.push(u.id); continue; }
    if (u.status === 'startet') { await stoppen(u.id, d, 'beendet'); out.beendet.push(u.id); continue; }   // Start ohne laufenden Vorgang (Neustart der Werkbank)
    if (u.geendet && jetzt.getTime() - new Date(u.geendet).getTime() > TAGE * 864e5) rmSync(pfadDer(d, u.id), { recursive: true, force: true });
  }
  return out;
}

/** Kandidaten-Ordner eines Strangs: Arbeitsordner, dann die Git-Wurzeln der geschriebenen Dateien (erster mit Profil gewinnt). */
export function strangOrdner(doc: { cwd?: string | null; written?: string[] | null }): string | null {
  const kand = [doc.cwd, ...(doc.written ?? []).map((f) => gitTop(existsSync(f) && statSync(f).isDirectory() ? f : dirname(f)))].filter((x): x is string => !!x && existsSync(x));
  return kand.find((k) => profilVon(k)) ?? null;
}

/** Erlaubte Wurzeln für Test-Umgebungen (WERKBANK_TESTLINK_WURZELN, durch „:“ getrennt; Vorgabe ~/work). */
export function wurzelErlaubt(real: string, s = process.env.WERKBANK_TESTLINK_WURZELN): boolean {
  const ws = (s ? s.split(':') : [join(homedir(), 'work')]).filter(Boolean).map((w) => { try { return realpathSync(w); } catch { return w; } });
  return ws.some((w) => real === w || real.startsWith(w.endsWith(sep) ? w : w + sep)) && !/(^|\/)\.(ssh|gnupg|aws|config|claude)(\/|$)/.test(real);
}
