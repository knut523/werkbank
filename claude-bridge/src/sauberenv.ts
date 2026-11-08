// Saubere Umgebung für alles, was vom Modell oder aus dem Repository stammenden Code ausführt (Prüfläufe, Tests).
// Eigenes Modul, damit bauerrennen/bauerstrang es ohne Importzyklus nutzen können (sessions.ts importiert bauerstrang.ts).
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// Was nie in die Umgebung einer Sitzung oder eines Prüfbefehls der Brücke gelangt (Variablennamen).
// Eine Quelle: scripts/secret-env.pattern und scripts/drop-env.names — dieselben Dateien liest scripts/sauber-env.sh (Gate).
const SKRIPTE = new URL('../../scripts/', import.meta.url);
const zeilen = (datei: string) => readFileSync(new URL(datei, SKRIPTE), 'utf8').split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
export const SECRET_ENV = new RegExp(zeilen('secret-env.pattern')[0]!.trim(), 'i');
export const DROP_ENV: string[] = zeilen('drop-env.names').join(' ').split(/\s+/).filter(Boolean);

const stateDir = () => process.env.BRIDGE_STATE_DIR || join(process.cwd(), '..', '.runtime', 'bridge');

// Git ohne Zugangsdaten für Stränge: eigene globale Konfiguration (nur Name/E-Mail), kein Credential-Helfer, Push auf
// github.com umgeleitet auf eine ungültige Adresse, keine Passwortabfrage. Wer die Umgebung im Befehl ausdrücklich
// überschreibt, kommt daran vorbei — dann greifen orchestratorBlock und der Klassifikator (ehrlich im Plan).
let orchGitConfig: string | null = null;
export function orchGitEnv(env: Record<string, string | undefined>, dir: string = stateDir()): void {
  if (!orchGitConfig || !existsSync(orchGitConfig)) {
    const get = (k: string) => { try { return execFileSync('git', ['config', '--global', '--get', k], { encoding: 'utf8', timeout: 3000 }).trim(); } catch { return ''; } };
    const name = (get('user.name') || 'Werkbank-Agent').replace(/[\n"\\]/g, '');
    const email = (get('user.email') || 'werkbank-agent@localhost').replace(/[\n"\\]/g, '');
    mkdirSync(dir, { recursive: true });
    orchGitConfig = join(dir, 'orch-gitconfig');
    writeFileSync(orchGitConfig, [
      '# Von der claude-bridge für Orchestrator-Stränge erzeugt: kein Push, keine Zugangsdaten.',
      '[user]', `\tname = ${name}`, `\temail = ${email}`,
      '[credential]', '\thelper =',
      '[url "https://push-gesperrt.invalid/"]', '\tpushInsteadOf = https://github.com/', '\tpushInsteadOf = git@github.com:', '\tpushInsteadOf = ssh://git@github.com/',
      '',
    ].join('\n'));
  }
  env.GIT_CONFIG_GLOBAL = orchGitConfig;
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_TERMINAL_PROMPT = '0';
  env.GIT_ASKPASS = '/bin/false';
  env.SSH_ASKPASS = '/bin/false';
  env.GCM_INTERACTIVE = 'never';
}

/**
 * Umgebung für Prüfbefehle der Brücke: ohne Geheimnisse (wie die Sitzung), Git ohne Zugangsdaten und ein leeres HOME — die
 * Tests führen vom Worker geschriebenen Code aus und sollen weder ~/.claude noch andere Zugangsdaten im Home sehen (Pass B, 3).
 * Kein Netz-Schnitt: dafür fehlt auf der VM eine Sandbox (Restrisiko im Bericht). HOME danach mit `raeumeEnv` löschen.
 */
export function checkEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of Object.keys(env)) if (SECRET_ENV.test(k)) delete env[k];
  for (const k of DROP_ENV) delete env[k];
  orchGitEnv(env);
  const home = mkdtempSync(join(tmpdir(), 'werkbank-pruef-'));
  Object.assign(env, { HOME: home, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), npm_config_cache: join(home, '.npm'), CI: '1' });
  return env;
}
/** Wegwerf-HOME aus `checkEnv` entfernen (immer im finally, auch nach Timeout/Abbruch). */
export function raeumeEnv(env: Record<string, string | undefined>): void {
  try { if (env.HOME) rmSync(env.HOME, { recursive: true, force: true }); } catch { /* egal */ }
}
