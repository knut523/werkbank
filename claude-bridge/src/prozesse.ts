// Der eine Prozessstarter und das Register dazu (Plan Prozessregister R1).
// Jeder Kindprozess startet über `starte`: eigene Prozessgruppe, Eintrag im Register (Besitzer, PID + Startzeit, Frist, letzte Aktivität),
// Austrag beim Ende. Beenden, Wächter und Anzeige lesen nur aus diesem Register. Fremde PIDs werden nie signalisiert.
import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
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
  // Auf die ganze Gruppe warten, nicht nur den Leader: ein Mitglied, das TERM ignoriert, überlebte sonst den Leader.
  if (!(await gruppeWeg(p.pid, frist))) { sig('SIGKILL'); await gruppeWeg(p.pid, 3000); }
  return true;
}

/** Läuft der Prozess noch? Weg oder Zombie (beendet, nur noch nicht abgeholt) = läuft nicht. */
export function laeuft(pid: number): boolean {
  try { const s = readFileSync(`/proc/${pid}/stat`, 'utf8'); return s.slice(s.lastIndexOf(')') + 2)[0] !== 'Z'; } catch { return false; }
}
/** Wartet, bis kein Mitglied der Prozessgruppe mehr läuft (Zombies zählen als weg). true = Gruppe weg innerhalb der Frist. */
export async function gruppeWeg(pgid: number, fristMs = 3000): Promise<boolean> {
  const weg = () => !lebendePids().some((pid) => pgidOf(pid) === pgid && laeuft(pid));
  for (let t = 0; t < fristMs; t += 50) { if (weg()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return weg();
}

const reg = new Map<string, Eintrag>();
let datei: string | null = null;
let zaehler = 0;

/** Register zusätzlich atomar (tmp + rename) in diese Datei spiegeln; null = nur Speicher. */
export function registerDatei(pfad: string | null) { datei = pfad; if (pfad) schreibe(); }
function schreibe() { if (datei) schreibeNach(datei); }
/** Atomar (tmp + rename): immer nur die Einträge DIESES Laufs. */
function schreibeNach(ziel: string) {
  try {
    mkdirSync(dirname(ziel), { recursive: true });
    const tmp = `${ziel}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify([...reg.values()], null, 1));
    renameSync(tmp, ziel);
  } catch { /* Spiegel darf den Start nicht stören */ }
}
/** Einträge eines früheren Laufs (R2 räumt auf; hier wird nichts beendet). */
export function vorlaufLesen(pfad: string): Eintrag[] {
  try { const a = JSON.parse(readFileSync(pfad, 'utf8')); return Array.isArray(a) ? a : []; } catch { return []; }
}

/** Kurzform ohne Geheimnisse: nur Befehl und gekürzte Argumente, nie die Umgebung. */
const kurz = (cmd: string, args: string[]) => [cmd, ...args].join(' ').replace(/\s+/g, ' ').slice(0, 120);

/** PGID + Startzeit aus /proc/<pid>/stat (Feld 5 = pgrp; Feld 22 = Startzeit, siehe procStart). */
function pgidOf(pid: number): number | null {
  try { const s = readFileSync(`/proc/${pid}/stat`, 'utf8'); const rest = s.slice(s.lastIndexOf(')') + 2).split(' '); return Number(rest[3]); } catch { return null; }
}
function startzeitOf(pid: number): string | null {
  try { const s = readFileSync(`/proc/${pid}/stat`, 'utf8'); return s.slice(s.lastIndexOf(')') + 2).split(' ')[19] ?? null; } catch { return null; }
}
const lebendePids = () => readdirSync('/proc').filter((d) => /^\d+$/.test(d)).map(Number);

/** Start-Aufräumen (R2): beendet alle noch lebenden Prozesse aus dem Register des Vorlaufs. Fremde (Startzeit passt
 *  nicht, anderer pgid) werden nie angefasst. Rückgabe: Anzahl geräumter Einträge. Liest die Datei synchron vor dem ersten await. */
export async function vorlaufAufraeumen(pfad: string, frist = 6000): Promise<number> {
  const eintraege = vorlaufLesen(pfad);
  if (!eintraege.length) return 0;
  // Datei synchron übernehmen, vor dem ersten await: danach stehen dort nur die Einträge dieses Laufs —
  // unabhängig davon, ob registerDatei() vorher oder nachher kommt, und ohne spätes Überschreiben.
  schreibeNach(pfad);
  let geräumt = 0;
  for (const e of eintraege) {
    // Leader lebt mit passender Startzeit → eigene Gruppe ordentlich TERM → KILL.
    if (lebt(e)) { if (await beendenProz(e, frist)) geräumt++; continue; }
    // Leader weg (Absturz, kein exit-Handler) → Gruppe kann noch leben: alle /proc-Prozesse mit pgid == e.pid
    // und Startzeit >= e.start suchen und per SIGKILL beenden. Ohne e.start nichts tun (könnte fremd sein).
    if (!e.start || !e.pid) continue;
    // PID existiert noch, aber mit anderer Startzeit → PID wiederverwendet, Gruppe gehört jemand anderem: nie anfassen.
    // Nur wenn der Leader ganz weg ist, kann die Gruppe noch Waisen von uns haben (der Kernel vergibt die PID einer belegten Gruppe nicht neu).
    if (existsSync(`/proc/${e.pid}`)) continue;
    const alt = Number(e.start);
    for (const pid of lebendePids()) {
      const pgid = pgidOf(pid);
      if (pgid !== e.pid) continue;                     // fremde Gruppe, nie anfassen
      const z = startzeitOf(pid);
      if (!z || Number(z) < alt) continue;   // zu alt oder unlesbar → fremd, nie anfassen
      try { process.kill(pid, 'SIGKILL'); } catch { /* weg */ }
    }
    geräumt++;
  }
  return geräumt;
}

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
  // Leader weg → Rest der Gruppe (Enkel mit geerbter Gruppe) beenden, erst dann austragen; ESRCH = Gruppe schon leer.
  kind.once('exit', () => { try { process.kill(-pid, 'SIGKILL'); } catch { /* Gruppe schon tot */ } if (reg.delete(id)) schreibe(); });
  return { id, kind };
}

export const aktivitaet = (id: string): number | null => reg.get(id)?.zuletztAktiv ?? null;
export const liste = (f?: { besitzer?: string; art?: string }): Eintrag[] =>
  [...reg.values()].filter((e) => (!f?.besitzer || e.besitzer === f.besitzer) && (!f?.art || e.art === f.art)).map((e) => ({ ...e }));

/** Alle Einträge mit dieser id oder diesem Besitzer: nur wenn PID + Startzeit passen, Gruppe TERM → KILL. Anzahl tatsächlich beendeter. */
export async function beenden(idOderBesitzer: string, fristMs = 6000): Promise<number> {
  const ziele = [...reg.values()].filter((e) => e.id === idOderBesitzer || e.besitzer === idOderBesitzer);
  const r = await Promise.all(ziele.map((e) => beendenProz(e, fristMs)));
  return r.filter(Boolean).length;
}
