// Der eine Prozessstarter und das Register dazu (Plan Prozessregister R1).
// Jeder Kindprozess startet über `starte`: eigene Prozessgruppe, Eintrag im Register (Besitzer, PID + Startzeit, Frist, letzte Aktivität),
// Austrag beim Ende. Beenden, Wächter und Anzeige lesen nur aus diesem Register. Fremde PIDs werden nie signalisiert.
import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Eintrag {
  id: string; pid: number; start: string | null; besitzer: string; art: string;
  cmd: string; startedAt: number; fristAt: number | null; zuletztAktiv: number;
}
export interface StarteOpt {
  besitzer: string; art: string; fristMs?: number; cwd?: string; env?: NodeJS.ProcessEnv; stdio?: StdioOptions;
  /** Uhr (Tests). */ jetzt?: () => number;
}

/** PID + Startzeit (Feld 22 in /proc/<pid>/stat) — nie nach Namen. */
export function procStart(pid: number): string | null {
  try { const s = readFileSync(`/proc/${pid}/stat`, 'utf8'); return s.slice(s.lastIndexOf(')') + 2).split(' ')[19] ?? null; } catch { return null; }
}
export const lebt = (p: { pid: number; start: string | null }) => p.pid > 1 && !!p.start && procStart(p.pid) === p.start;

/** Eigenen Prozess samt Gruppe beenden: TERM, nach Frist KILL. Nur wenn PID und Startzeit passen. */
export async function beendenProz(p: { pid: number; start: string | null }, frist = 6000): Promise<boolean> {
  if (!lebt(p)) return false;
  const sig = (s: NodeJS.Signals) => { try { process.kill(-p.pid, s); } catch { try { process.kill(p.pid, s); } catch { /* weg */ } } };
  sig('SIGTERM');
  for (let t = 0; t < frist && lebt(p); t += 200) await new Promise((r) => setTimeout(r, 200));
  if (lebt(p)) sig('SIGKILL');
  return true;
}

const reg = new Map<string, Eintrag>();
let datei: string | null = null;
let zaehler = 0;

/** Register zusätzlich atomar (tmp + rename) in diese Datei spiegeln; null = nur Speicher. */
export function registerDatei(pfad: string | null) { datei = pfad; if (pfad) schreibe(); }
function schreibe() {
  if (!datei) return;
  try {
    mkdirSync(dirname(datei), { recursive: true });
    const tmp = `${datei}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify([...reg.values()], null, 1));
    renameSync(tmp, datei);
  } catch { /* Spiegel darf den Start nicht stören */ }
}
/** Einträge eines früheren Laufs (R2 räumt auf; hier wird nichts beendet). */
export function vorlaufLesen(pfad: string): Eintrag[] {
  try { const a = JSON.parse(readFileSync(pfad, 'utf8')); return Array.isArray(a) ? a : []; } catch { return []; }
}

/** Kurzform ohne Geheimnisse: nur Befehl und gekürzte Argumente, nie die Umgebung. */
const kurz = (cmd: string, args: string[]) => [cmd, ...args].join(' ').replace(/\s+/g, ' ').slice(0, 120);

export function starte(cmd: string, args: string[], o: StarteOpt): { id: string; kind: ChildProcess } {
  const jetzt = o.jetzt ?? Date.now;
  const kind = spawn(cmd, args, { cwd: o.cwd, env: o.env, stdio: o.stdio ?? ['ignore', 'pipe', 'pipe'], detached: true });
  const id = `p${++zaehler}-${kind.pid ?? 0}-${jetzt().toString(36)}`;
  const pid = kind.pid ?? 0;
  if (!pid) return { id, kind }; // Start fehlgeschlagen ('error' kommt beim Aufrufer an) — kein Eintrag
  const t = jetzt();
  const e: Eintrag = { id, pid, start: procStart(pid), besitzer: o.besitzer, art: o.art, cmd: kurz(cmd, args), startedAt: t, fristAt: o.fristMs ? t + o.fristMs : null, zuletztAktiv: t };
  reg.set(id, e); schreibe();
  const an = () => { e.zuletztAktiv = jetzt(); };
  kind.stdout?.on('data', an); kind.stderr?.on('data', an);
  kind.once('exit', () => { if (reg.delete(id)) schreibe(); });
  return { id, kind };
}

export const aktivitaet = (id: string): number | null => reg.get(id)?.zuletztAktiv ?? null;
export const liste = (f?: { besitzer?: string; art?: string }): Eintrag[] =>
  [...reg.values()].filter((e) => (!f?.besitzer || e.besitzer === f.besitzer) && (!f?.art || e.art === f.art));

/** Alle Einträge mit dieser id oder diesem Besitzer: nur wenn PID + Startzeit passen, Gruppe TERM → KILL. Anzahl tatsächlich beendeter. */
export async function beenden(idOderBesitzer: string, fristMs = 6000): Promise<number> {
  const ziele = [...reg.values()].filter((e) => e.id === idOderBesitzer || e.besitzer === idOderBesitzer);
  const r = await Promise.all(ziele.map((e) => beendenProz(e, fristMs)));
  return r.filter(Boolean).length;
}
