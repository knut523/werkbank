// opencode-2-Server gehören der Brücke (Hauptsitzung 06.11.: „KEIN Klartext-Schlüssel in Umgebung/Datei für Stränge — der
// OC2-Läufer bekommt den Schlüssel zur Laufzeit über denselben Weg wie die jcode-Delegation“). Der Melious-Schlüssel kommt wie
// bei jcode aus dem Konto (Werkbank entschlüsselt ihn aus der DB) und geht nur in die Umgebung der Server-Prozesse; die Brücke
// gibt den Servern nicht ihre eigene Umgebung mit. Das Server-Passwort entsteht je Brückenlauf im Speicher, keine Datei.
// Bedingungen der Entscheidung: (1) Absturz → Neustart (hier, statt scripts/opencode2-waechter.sh wache), (2) feste Version
// (Vorgabe 2.2.5) und Konfiguration geprüft vor dem ersten Start, (3) mehrere Server (Vorgabe 47811, 47812).
import { spawn as nodeSpawn, execFileSync, type ChildProcess } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

type Env = Record<string, string | undefined>;
export interface Oc2Zugang { urls: string[]; passwort: string }
export interface Oc2Server { sichern(key: string): Promise<Oc2Zugang | null>; stop(): void; zustand(): { port: number; pid: number | null; bereit: boolean; neustarts: number }[]; grund(): string | null }

export const oc2Home = (env: Env = process.env) => env.BRIDGE_OPENCODE2_HOME || join(homedir(), '.local', 'opencode2');
export const oc2Ports = (env: Env = process.env) => (env.BRIDGE_OPENCODE2_PORTS ?? '47811 47812').split(/[\s,]+/).map(Number).filter((p) => Number.isInteger(p) && p > 1024 && p < 65536);
export const oc2Version = (env: Env = process.env) => env.BRIDGE_OPENCODE2_VERSION || '2.2.5';

/** Bedingung 2: Version und Konfiguration (nur Melious, keine Updates, kein Teilen). Leer = in Ordnung, sonst der Grund. */
export function oc2Pruefen(home: string, version: string, versionVon: (bin: string) => string): string {
  const bin = join(home, 'bin', 'opencode2'), konfig = join(home, 'xdg', 'config', 'opencode', 'opencode.jsonc');
  if (!existsSync(bin)) return `${bin} fehlt`;
  const v = (versionVon(bin).match(/\d+\.\d+\.\d+/) ?? [''])[0];
  if (v !== version) return `Version „${v}“, erwartet ${version} (feste Version)`;
  let k = ''; try { k = readFileSync(konfig, 'utf8'); } catch { return `Konfiguration ${konfig} fehlt`; }
  if (!k.includes('"melious"')) return 'kein Provider melious in der Konfiguration';
  if (!/"update"\s*:\s*"disable"/.test(k)) return 'update ist nicht "disable"';
  if (!/"share"\s*:\s*"disabled"/.test(k)) return 'share ist nicht "disabled"';
  return '';
}

/** Umgebung eines Server-Prozesses: nur das Nötige — nichts aus der Umgebung der Brücke außer PATH/LANG. */
export function oc2Umgebung(home: string, key: string, passwort: string, env: Env = process.env): Record<string, string> {
  const x = join(home, 'xdg');
  return {
    PATH: env.PATH ?? '/usr/bin:/bin', HOME: homedir(), LANG: env.LANG ?? 'C.UTF-8',
    XDG_CONFIG_HOME: join(x, 'config'), XDG_DATA_HOME: join(x, 'data'), XDG_STATE_HOME: join(x, 'state'), XDG_CACHE_HOME: join(x, 'cache'),
    OPENCODE_DISABLE_AUTOUPDATE: '1', OPENCODE_DISABLE_SHARE: '1', OPENCODE_DISABLE_MODELS_FETCH: '1', DO_NOT_TRACK: '1', OPENCODE_DISABLE_FREE_MODELS: '1', OPENCODE_DISABLE_CLAUDE_CODE: '1',
    OPENCODE_SERVER_PASSWORD: passwort, MELIOUS_API_KEY: key,
  };
}

const fingerabdruck = (key: string) => createHash('sha256').update(key).digest('hex').slice(0, 16);

export function opencode2Server(o: {
  home: string; ports: number[]; version: string; log?: (m: string, d?: object) => void;
  spawnFn?: typeof nodeSpawn; fetchFn?: typeof fetch; versionVon?: (bin: string) => string; startMs?: number; maxNeustarts?: number;
}): Oc2Server {
  const sp = o.spawnFn ?? nodeSpawn, f = o.fetchFn ?? fetch, log = o.log ?? (() => {});
  const versionVon = o.versionVon ?? ((bin: string) => { try { return execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 10_000, env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: homedir() } }); } catch { return ''; } });
  const passwort = randomBytes(24).toString('base64url');
  const auth = `Basic ${Buffer.from(`opencode:${passwort}`).toString('base64')}`;
  const run = join(o.home, 'waechter');
  const kinder = new Map<number, { c: ChildProcess | null; bereit: boolean; neustarts: number }>(o.ports.map((p) => [p, { c: null, bereit: false, neustarts: 0 }]));
  let besitzt = false, key: string | null = null, fp: string | null = null, gestoppt = false, grund: string | null = null, geprueft = false, start: Promise<Oc2Zugang | null> | null = null;

  const antwortet = async (p: number) => { try { return (await f(`http://127.0.0.1:${p}/api/session?limit=1`, { headers: { authorization: auth }, signal: AbortSignal.timeout(3000) })).status === 200; } catch { return false; } };
  // Ein Server aus einem früheren Brückenlauf (Brücke hart beendet) hielte den Port mit einem anderen Passwort — vorher beenden,
  // aber nur, wenn die Prozessdatei wirklich auf einen opencode-Server dieses Ports zeigt.
  const istServer = (pid: number, p: number) => {
    let cmd = ''; try { cmd = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' '); } catch { return false; }
    return pid > 1 && /opencode/.test(cmd) && cmd.includes(' serve ') && cmd.includes(`--port ${p}`);
  };
  const altenBeenden = async (p: number) => {
    let pid = 0; try { pid = Number(readFileSync(join(run, `${p}.pid`), 'utf8').trim()); } catch { return; }
    if (!istServer(pid, p)) return;
    log('opencode2 alter server beendet', { port: p, pid });
    try { process.kill(pid, 'SIGTERM'); } catch { return; }
    for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 100)); if (!istServer(pid, p)) return; }
    if (istServer(pid, p)) try { process.kill(pid, 'SIGKILL'); } catch { /* weg */ }   // Gegenprüfung: PID vor SIGKILL erneut prüfen
  };
  // Gegenprüfung 06.11.: zwei Brücken mit derselben Installation würden sich die Server gegenseitig beenden — wer zuerst kommt,
  // besitzt sie (Sperrdatei mit der Prozessnummer der Brücke); die andere nimmt jcode.
  const besitzen = (): boolean => {
    const f = join(run, 'bruecke.pid');
    try { mkdirSync(run, { recursive: true }); } catch { return false; }
    for (let i = 0; i < 2; i++) {
      try { writeFileSync(f, String(process.pid), { flag: 'wx' }); return true; } catch { /* schon da */ }
      let alt = 0; try { alt = Number(readFileSync(f, 'utf8').trim()); } catch { /* weg */ }
      if (alt === process.pid) return true;
      let lebt = false; try { if (alt > 1) { process.kill(alt, 0); lebt = true; } } catch (e: any) { lebt = e?.code === 'EPERM'; }
      if (lebt) return false;
      try { rmSync(f, { force: true }); } catch { return false; }
    }
    return false;
  };
  const starte = async (p: number): Promise<boolean> => {
    const k = kinder.get(p)!;
    await altenBeenden(p);
    if (gestoppt || k.c) return false;
    const c = sp(join(o.home, 'bin', 'opencode2'), ['serve', '--hostname', '127.0.0.1', '--port', String(p)], { env: oc2Umgebung(o.home, key!, passwort), stdio: 'ignore' });
    k.c = c;
    try { mkdirSync(run, { recursive: true }); writeFileSync(join(run, `${p}.pid`), String(c.pid ?? '')); } catch { /* nur für `netz` */ }
    c.on('error', () => { /* exit folgt bzw. antwortet() bleibt falsch */ });
    c.on('exit', (code, sig) => {
      if (k.c !== c) return;
      k.c = null; k.bereit = false;
      if (gestoppt) return;
      // Bedingung 1: ein abgestürzter Server startet neu — offene Sitzungen stößt der Läufer danach an (laeufer.ts, OC2_WEITER).
      if (k.neustarts >= (o.maxNeustarts ?? 5)) { log('opencode2 server aufgegeben', { port: p, code, sig }); return; }
      k.neustarts++;
      log('opencode2 server weg — neustart', { port: p, code, sig, neustarts: k.neustarts });
      setTimeout(() => { if (!gestoppt && !k.c && key) void starte(p); }, 1000).unref();
    });
    const bis = Date.now() + (o.startMs ?? 30_000);
    while (Date.now() < bis) {
      if (await antwortet(p)) { k.bereit = k.c === c; log('opencode2 server gestartet', { port: p, pid: c.pid }); return k.bereit; }
      if (k.c !== c) return false;
      await new Promise((r) => setTimeout(r, 300));
    }
    log('opencode2 server antwortet nach dem Start nicht', { port: p });
    return false;
  };
  const stop = () => {
    gestoppt = true;
    for (const [p, k] of kinder) { k.c?.kill('SIGTERM'); k.c = null; k.bereit = false; try { rmSync(join(run, `${p}.pid`), { force: true }); } catch { /* egal */ } }
    if (besitzt) try { if (readFileSync(join(run, 'bruecke.pid'), 'utf8').trim() === String(process.pid)) rmSync(join(run, 'bruecke.pid'), { force: true }); } catch { /* egal */ }
  };
  return {
    stop, grund: () => grund,
    zustand: () => [...kinder].map(([port, k]) => ({ port, pid: k.c?.pid ?? null, bereit: k.bereit, neustarts: k.neustarts })),
    async sichern(neu) {
      if (gestoppt || !neu) return null;
      // ponytail: ein Schlüssel je Brückenlauf (Knuts Konto). Ein anderes Konto bekommt jcode, statt fremde Server mitzunutzen;
      // Obergrenze: mehrere Melious-Konten parallel → je Konto eigene Ports, erst wenn das gebraucht wird.
      if (fp && fingerabdruck(neu) !== fp) return null;
      if (!geprueft) {
        geprueft = true;
        grund = oc2Pruefen(o.home, o.version, versionVon) || (besitzen() ? null : 'eine andere Brücke besitzt die opencode-2-Server (waechter/bruecke.pid)');
        besitzt = !grund;
        if (grund) log('opencode2 nicht gestartet', { grund });
      }
      if (grund) return null;
      key = neu; fp = fingerabdruck(neu);
      // Alle Adressen an den Pool, sobald einer antwortet: ein Server im Neustart pausiert dort, offene Sitzungen warten auf ihn.
      const zugang = () => ([...kinder.values()].some((k) => k.bereit) ? { urls: [...kinder.keys()].map((p) => `http://127.0.0.1:${p}`), passwort } : null);
      if ([...kinder.values()].every((k) => k.c)) return start ?? zugang();
      start ??= (async () => {
        await Promise.all([...kinder].filter(([, k]) => !k.c).map(([p]) => starte(p)));
        start = null;
        return zugang();
      })();
      return start;
    },
  };
}
