// Claude verbinden ohne Terminal (Zielbild § 4a, P5; Walkthrough 221: team187 scheiterte an `claude setup-token`). Der Server
// startet das offizielle `claude setup-token` der eigenen Instanz in einem Pseudo-Terminal (`script`), zeigt den Anmelde-Link,
// nimmt den Code von claude.com entgegen und speichert den ausgegebenen Token wie „Speichern“ in der Einrichtung. Kein eigener
// OAuth-Client, kein Token im Log. Eine Anmeldung je Person zur Zeit, nach 10 Minuten beendet.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ANSI = /\x1b\[[0-9;?]*[a-zA-Z]/g;
/** Anmelde-Link aus der Ausgabe (OSC-8-Link oder Klartext). Nur claude.com/claude.ai mit OAuth-Pfad. */
export function linkAus(out: string): string | null {
  const osc = /\x1b\]8;[^;]*;(https:\/\/[^\x07\x1b\s]+)/.exec(out)?.[1];
  const roh = osc ?? /(https:\/\/(?:claude\.com|claude\.ai)\/[^\s\x07\x1b]*oauth\/authorize\?[^\s\x07\x1b]+)/.exec(out.replace(ANSI, ''))?.[1] ?? null;
  return roh && /^https:\/\/(claude\.com|claude\.ai)\/[^\s]*oauth\/authorize\?/.test(roh) ? roh : null;
}
/** Langlebiger Token aus der Ausgabe (sk-ant-oat…). */
export const tokenAus = (out: string): string | null => /(sk-ant-oat01-[A-Za-z0-9_-]{20,})/.exec(out.replace(ANSI, '').replace(/[\r\n ]/g, ''))?.[1] ?? null;
/** Code von der Rückruf-Seite: nur Zeichen, die dort vorkommen (kein Steuerzeichen, das das Terminal deuten könnte). */
export const codeOk = (c: string) => /^[A-Za-z0-9_#.~-]{10,400}$/.test(c);

/** Das `claude` der Instanz: das der Brücke (Agent-SDK) oder eines im PATH. */
export function claudeBin(repo = resolve(import.meta.dirname, '..', '..')): string | null {
  const sdk = join(repo, 'claude-bridge', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-linux-x64', 'claude');
  return existsSync(sdk) ? sdk : null;
}

interface Lauf { proc: ChildProcess; out: string; dir: string; timer: NodeJS.Timeout; at: number }
const laeufe = new Map<string, Lauf>();
const ende = (userId: string) => {
  const l = laeufe.get(userId);
  if (!l) return;
  clearTimeout(l.timer); try { process.kill(-l.proc.pid!, 'SIGKILL'); } catch { try { l.proc.kill('SIGKILL'); } catch { /* schon weg */ } }   // `script` übersteht SIGTERM; abgebrochene Anmeldung hat nichts zu retten
  try { rmSync(l.dir, { recursive: true, force: true }); } catch { /* egal */ }
  laeufe.delete(userId);
};
const warte = async (pruef: () => boolean, ms: number) => { const bis = Date.now() + ms; while (Date.now() < bis) { if (pruef()) return true; await new Promise((r) => setTimeout(r, 200)); } return pruef(); };

/** Startet die Anmeldung und liefert den Link (höchstens 20 s Warten auf die CLI). */
export async function starte(userId: string, bin = claudeBin()): Promise<{ url: string }> {
  if (!bin) throw Object.assign(new Error('Claude-CLI der Instanz nicht gefunden — scripts/setup.sh ausführen.'), { status: 503 });
  ende(userId);
  const dir = mkdtempSync(join(tmpdir(), 'claude-verbinden-'));   // leerer Konfigurations-Ordner: nichts von anderen Konten
  const proc = spawn('script', ['-qfc', `'${bin.replace(/'/g, '')}' setup-token`, '/dev/null'], {
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: dir, CLAUDE_CONFIG_DIR: dir, BROWSER: '/bin/false', TERM: 'xterm-256color', LANG: 'C.UTF-8' },
    stdio: ['pipe', 'pipe', 'pipe'], detached: true,   // eigene Prozessgruppe: beim Ende geht auch die CLI unter `script` mit
  });
  const l: Lauf = { proc, out: '', dir, at: Date.now(), timer: setTimeout(() => ende(userId), 10 * 60_000) };
  laeufe.set(userId, l);
  const nimm = (b: Buffer) => { l.out = (l.out + b.toString('utf8')).slice(-200_000); };
  proc.stdout?.on('data', nimm); proc.stderr?.on('data', nimm);
  proc.on('exit', () => { if (laeufe.get(userId) === l && !tokenAus(l.out)) { clearTimeout(l.timer); laeufe.delete(userId); } });
  await warte(() => !!linkAus(l.out) || proc.exitCode !== null, 20_000);
  const url = linkAus(l.out);
  if (!url) { ende(userId); throw Object.assign(new Error('Die Claude-Anmeldung startet nicht — bitte gleich noch einmal.'), { status: 502 }); }
  return { url };
}

/** Code einreichen; liefert den Token (nur an den Aufrufer, der ihn sofort speichert). */
export async function codeEinreichen(userId: string, code: string): Promise<string> {
  const l = laeufe.get(userId);
  if (!l) throw Object.assign(new Error('Keine Anmeldung offen — bitte „Mit Claude anmelden“ neu starten.'), { status: 409 });
  const c = code.trim();
  if (!codeOk(c)) throw Object.assign(new Error('Das sieht nicht wie der Code von claude.com aus — bitte genau den angezeigten Code einfügen.'), { status: 400 });
  l.proc.stdin?.write(c + '\r');
  await warte(() => !!tokenAus(l.out) || l.proc.exitCode !== null, 45_000);
  const token = tokenAus(l.out);
  ende(userId);
  if (!token) throw Object.assign(new Error('Claude hat keinen Token ausgegeben — Code abgelaufen oder falsch? Bitte neu starten.'), { status: 502 });
  return token;
}

export const offen = (userId: string) => laeufe.has(userId);
// Beim Ende des Servers keine verwaisten Anmeldungen zurücklassen (eigene Prozessgruppen überleben sonst den Neustart).
process.on('exit', () => { for (const id of [...laeufe.keys()]) ende(id); });
