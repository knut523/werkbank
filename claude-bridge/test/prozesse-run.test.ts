// R5 (docs/plan-prozessregister.md): run() (delegation.ts) und pruefLauf (bauerrennen.ts) starten über den Prozessstarter (prozesse.ts)
// — Eintrag im Register, Abbruch (AbortSignal) und Timeout beenden die ganze Gruppe (Kind + Enkel), Register danach leer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liste, beenden } from '../src/prozesse.ts';
import { run } from '../src/delegation.ts';
import { pruefLauf } from '../src/bauerrennen.ts';

const tot = (pid: number) => { try { process.kill(pid, 0); return false; } catch (e: any) { return e.code === 'ESRCH'; } };
const warte = async (f: () => boolean, ms = 5000) => { for (let t = 0; t < ms && !f(); t += 50) await new Promise((r) => setTimeout(r, 50)); return f(); };
const dir = mkdtempSync(join(tmpdir(), 'prozesse-run-'));

/** Räumt jeden gestarteten Prozess des Tests selbst ab (Gruppe + Enkel), auch wenn eine Assertion vor dem Abbruch fiel. */
const raeumeAuf = (sh: number, enkel: number) => {
  try { if (sh) process.kill(-sh, 'SIGKILL'); } catch { /* weg */ }
  try { if (enkel) process.kill(enkel, 'SIGKILL'); } catch { /* weg */ }
};

test('run(): AbortSignal → Gruppe (Kind + Enkel) tot, Register geleert', async () => {
  const ac = new AbortController();
  const besitzer = 'r5-run-signal';
  const self = join(dir, 'self-run'), enkel = join(dir, 'enkel-run');
  let sh = 0, enkelPid = 0;
  try {
    const p = run('sh', ['-c', `echo $$ > ${self}; sleep 600 & echo $! > ${enkel}; wait`], { cwd: dir, besitzer, signal: ac.signal });
    assert.ok(await warte(() => existsSync(self) && existsSync(enkel) && readFileSync(self, 'utf8').trim() !== '' && readFileSync(enkel, 'utf8').trim() !== ''), 'Kind gestartet');
    sh = Number(readFileSync(self, 'utf8').trim()); enkelPid = Number(readFileSync(enkel, 'utf8').trim());
    const e = liste({ besitzer })[0];
    assert.ok(e && e.pid === sh, 'Eintrag im Register mit der PID des Kindes'); // rot vor dem Bau
    assert.equal(e.art, 'run');
    ac.abort();
    const r = await p;
    assert.notEqual(r.code, 0);
    assert.ok(await warte(() => tot(sh) && tot(enkelPid)), 'Kind und Enkel tot');
    assert.equal(liste({ besitzer }).length, 0, 'Register geleert');
  } finally { ac.abort(); raeumeAuf(sh, enkelPid); }
});

test('pruefLauf: AbortSignal → Gruppe (Kind + Enkel) tot, Register geleert', async () => {
  const ac = new AbortController();
  const besitzer = 'r5-pruef-signal';
  const self = join(dir, 'self-pruef'), enkel = join(dir, 'enkel-pruef');
  let sh = 0, enkelPid = 0;
  try {
    const p = pruefLauf(dir, 'sh', ['-c', `echo $$ > ${self}; sleep 600 & echo $! > ${enkel}; wait`], { timeoutMs: 60_000, signal: ac.signal, besitzer });
    assert.ok(await warte(() => existsSync(self) && existsSync(enkel) && readFileSync(self, 'utf8').trim() !== '' && readFileSync(enkel, 'utf8').trim() !== ''), 'Kind gestartet');
    sh = Number(readFileSync(self, 'utf8').trim()); enkelPid = Number(readFileSync(enkel, 'utf8').trim());
    const e = liste({ besitzer })[0];
    assert.ok(e && e.pid === sh, 'Eintrag im Register mit der PID des Kindes'); // rot vor dem Bau
    assert.equal(e.art, 'pruefung');
    ac.abort();
    const r = await p;
    assert.equal(r.ok, false);
    assert.ok(await warte(() => tot(sh) && tot(enkelPid)), 'Kind und Enkel tot');
    assert.equal(liste({ besitzer }).length, 0, 'Register geleert');
  } finally { ac.abort(); raeumeAuf(sh, enkelPid); }
});

test('run(): Timeout → ganze Gruppe tot, Register geleert', async () => {
  const besitzer = 'r5-run-timeout';
  const enkel = join(dir, 'enkel-run-t');
  let enkelPid = 0;
  try {
    const p = run('sh', ['-c', `sleep 600 & echo $! > ${enkel}; wait`], { cwd: dir, besitzer, timeoutMs: 400 });
    const e = liste({ besitzer })[0];
    assert.ok(e, 'Eintrag im Register'); // rot vor dem Bau
    const r = await p;
    assert.equal(r.code, 124);
    enkelPid = Number(readFileSync(enkel, 'utf8').trim());
    assert.ok(await warte(() => tot(enkelPid)), 'Enkel tot');
    assert.equal(liste({ besitzer }).length, 0, 'Register nach dem Timeout leer');
  } finally { raeumeAuf(0, enkelPid); }
});

test('pruefLauf: Timeout → ganze Gruppe tot, Register geleert', async () => {
  const besitzer = 'r5-pruef-timeout';
  const enkel = join(dir, 'enkel-pruef-t');
  let enkelPid = 0;
  try {
    const r = await pruefLauf(dir, 'sh', ['-c', `sleep 600 & echo $! > ${enkel}; wait`], { timeoutMs: 400, besitzer });
    assert.equal(r.ok, false);
    enkelPid = Number(readFileSync(enkel, 'utf8').trim());
    assert.ok(await warte(() => tot(enkelPid)), 'Enkel tot');
    assert.equal(liste({ besitzer }).length, 0, 'Register nach dem Timeout leer');
  } finally { raeumeAuf(0, enkelPid); }
});

test('run()/pruefLauf: Vorgabe besitzer "bridge", art "run"/"pruefung"; danach Register leer', async () => {
  try {
    const p = run('sleep', ['2'], { cwd: dir, timeoutMs: 300 });
    const e = liste({ besitzer: 'bridge', art: 'run' })[0];
    assert.ok(e, 'run-Eintrag unter besitzer "bridge"'); // rot vor dem Bau
    const q = pruefLauf(dir, 'sleep', ['2'], { timeoutMs: 300 });
    const f = liste({ besitzer: 'bridge', art: 'pruefung' })[0];
    assert.ok(f, 'pruefung-Eintrag unter besitzer "bridge"');
    await Promise.all([p, q]);
    assert.ok(await warte(() => liste({ besitzer: 'bridge' }).length === 0), 'beide ausgetragen');
  } finally { await beenden('bridge', 2000).catch(() => { /* egal */ }); }
});

// ---- Gegenprüfung R5: Fehlerpfad eines nicht startbaren Befehls (ENOENT, z. B. fehlendes Git oder falsches cwd) ----
// run() ist laut Vertrag ein Promise<{code, out}> (Startfehler → 127); der Startfehler darf weder die Brücke abräumen
// noch als Ausnahme an den Aufrufer gehen. Je Fall ein eigener Kindprozess, damit ein Absturz nicht den Testlauf verdeckt.
const sonde = (rumpf: string) => `const { run } = await import(${JSON.stringify(new URL('../src/delegation.ts', import.meta.url).href)});\n${rumpf}\n`;
const starteSonde = async (name: string, rumpf: string) => {
  const { spawnSync } = await import('node:child_process');
  const { writeFileSync } = await import('node:fs');
  const datei = join(dir, `sonde-${name}.mjs`);
  writeFileSync(datei, sonde(rumpf));
  return spawnSync(process.execPath, [datei], { encoding: 'utf8', timeout: 30_000, cwd: dir });
};

test('run(): nicht startbarer Befehl → {code:127} und kein Absturz der Brücke', async () => {
  // fehlender Befehl (kein git im PATH) und fehlendes cwd (entfernter Unter-Worktree: removeWorktree ruft git mit genau diesem cwd); beides ist derselbe Startfehler.
  const faelle: [string, string][] = [
    ['fehlender Befehl', `await run('gibtsnicht-xyz-9', [], { cwd: ${JSON.stringify(dir)} })`],
    ['fehlendes cwd', `await run('git', ['rev-parse', 'HEAD'], { cwd: ${JSON.stringify(join(dir, 'gibtsnicht-xyz-cwd'))} })`],
  ];
  for (const [name, aufruf] of faelle) {
    const res = await starteSonde(`enoent-${name.split(' ')[0]}`, `const r = ${aufruf};\nconsole.log('ERGEBNIS ' + JSON.stringify(r));`);
    assert.equal(res.status, 0, `${name}: Kindprozess abgestürzt (status ${res.status}): ${String(res.stderr ?? '').split('\n').slice(0, 3).join(' | ')}`);
    assert.match(String(res.stdout), /"code":127/, `${name}: Ergebnis fehlt: ${String(res.stdout).slice(-200)}`);
  }
});

test('run(): nicht startbarer Befehl mit Abbruchsignal → {code:127} statt Ausnahme', async () => {
  const res = await starteSonde('enoent-signal', [
    `const ac = new AbortController();`,
    `try { const r = await run('gibtsnicht-xyz-9', [], { cwd: ${JSON.stringify(dir)}, signal: ac.signal }); console.log('ERGEBNIS ' + JSON.stringify(r)); }`,
    `catch (e) { console.log('GEWORFEN ' + (e && e.constructor ? e.constructor.name : String(e))); }`,
  ].join('\n'));
  assert.equal(res.status, 0, `Kindprozess abgestürzt (status ${res.status}): ${String(res.stderr ?? '').split('\n').slice(0, 3).join(' | ')}`);
  assert.match(String(res.stdout), /ERGEBNIS \{"code":127/, `statt {code:127}: ${String(res.stdout).slice(-200)}`);
});

// ---- Gegenprüfung R5 (Runde 2), Befund 1: der Abbruch setzt kein Abbruch-Merkmal ---------------------------------
// Timeout: `killed = true` → Code 124 (run) bzw. `zeit` → ok:false (pruefLauf). Der Abbruchpfad (`brichAb` → beenden)
// setzt das Merkmal nicht: das Ergebnis ist allein der Ausstiegscode des beendeten Prozesses. Ein Befehl, der SIGTERM
// fängt und sauber mit 0 endet (Wrapper-/Prüfskript mit eigenem Aufräumen), wird deshalb nach abort() als Erfolg
// gemeldet — der Aufrufer (pruefen() → code 0 = grün, betroffeneTests() → ok) hält eine abgebrochene Prüfung für grün.
// Erwartet wird wie beim Timeout ein Fehlschlag (Doku an run(): „Zeitlimit oder Abbruchsignal → beenden(id) …
// (Code 124)“; die bestehenden Abbruch-Tests prüfen `notEqual(r.code, 0)` / `ok === false`).
test('run(): Abbruch nach dem Start ist kein Erfolg (Code 0), auch wenn der Befehl SIGTERM fängt', async () => {
  const ac = new AbortController();
  const besitzer = 'r5-run-abort-faengt-term';
  const self = join(dir, 'self-abort-run');
  let sh = 0;
  try {
    // Falle steht vor der PID-Ausgabe: die Datei beweist, dass der Befehl SIGTERM fängt und selbst mit 0 endet.
    const p = run('sh', ['-c', `trap "exit 0" TERM; echo $$ > ${self}; sleep 600`], { cwd: dir, besitzer, signal: ac.signal });
    assert.ok(await warte(() => existsSync(self) && readFileSync(self, 'utf8').trim() !== ''), 'Kind gestartet (TERM-Falle steht)');
    sh = Number(readFileSync(self, 'utf8').trim());
    ac.abort();
    const r = await p;
    assert.notEqual(r.code, 0, `abgebrochener Lauf meldet Erfolg (code ${r.code}) — die Prüfung gilt dann als grün`);
    assert.equal(liste({ besitzer }).length, 0, 'Register geleert');
  } finally { ac.abort(); raeumeAuf(sh, 0); }
});

// Befund 1b: derselbe Abbruchpfad in pruefLauf — dort fehlt das `zeit`-Merkmal, `(rc ?? code) === 0` wird zu ok:true.
test('pruefLauf: Abbruch nach dem Start ist kein grüner Lauf (ok), auch wenn der Befehl SIGTERM fängt', async () => {
  const ac = new AbortController();
  const besitzer = 'r5-pruef-abort-faengt-term';
  const self = join(dir, 'self-abort-pruef');
  let sh = 0;
  try {
    const p = pruefLauf(dir, 'sh', ['-c', `trap "exit 0" TERM; echo $$ > ${self}; sleep 600`], { timeoutMs: 60_000, besitzer, signal: ac.signal });
    assert.ok(await warte(() => existsSync(self) && readFileSync(self, 'utf8').trim() !== ''), 'Kind gestartet (TERM-Falle steht)');
    sh = Number(readFileSync(self, 'utf8').trim());
    ac.abort();
    const r = await p;
    assert.equal(r.ok, false, 'abgebrochener Prüflauf meldet grün — der Aufrufer (betroffeneTests) nimmt das als bestandene Tests');
    assert.equal(liste({ besitzer }).length, 0, 'Register geleert');
  } finally { ac.abort(); raeumeAuf(sh, 0); }
});

// ---- Gegenprüfung R5 (Runde 2), Befund 2: Registereintrag ohne Frist ---------------------------------------------
// Die Strukturregel des Plans (docs/plan-prozessregister.md) verlangt von JEDEM Kindprozess einen Registereintrag mit
// „Besitzer, PID + Startzeit, Frist, letzte Aktivität“; die Start-Mini-Spec nennt `starte(cmd, args, { besitzer, art,
// fristMs, cwd, env })`. Wächter (R10: `if (e.fristAt != null && jetzt > e.fristAt)`) und Anzeige (R11/R12: Spalte Frist)
// lesen nur `fristAt` — ein Eintrag ohne Frist wird nie „überfällig“ und nie über den Wächter beendet. run() und
// pruefLauf haben aber ein Zeitlimit (30 s bzw. 15 min, der Aufrufer setzt es), also ist ihre Frist bekannt; starte()
// bekommt sie nicht mit (in der Schwester-Punkt R4 wurde genau das mit `fristMs: timeoutS * 1000` nachgezogen).
test('run()/pruefLauf: Registereintrag trägt die Frist (Zeitlimit) — sonst wird der Lauf für Wächter und Anzeige nie überfällig', async () => {
  const besitzer = 'r5-frist';
  const timeoutMs = 5_000;
  let p: Promise<{ code: number; out: string }> | undefined, q: Promise<{ ok: boolean; log: string }> | undefined;
  try {
    p = run('sleep', ['30'], { cwd: dir, besitzer, timeoutMs });
    q = pruefLauf(dir, 'sleep', ['30'], { timeoutMs, besitzer });
    const e = liste({ besitzer, art: 'run' })[0], f = liste({ besitzer, art: 'pruefung' })[0];
    assert.ok(e && f, 'beide Läufe stehen im Register');
    for (const [name, x] of [['run', e!], ['pruefLauf', f!]] as const) {
      assert.notEqual(x.fristAt, null, `${name}: fristAt gesetzt (Frist = eigenes Zeitlimit) — sonst greift der Wächter nie`);
      const d = x.fristAt! - x.startedAt;
      assert.ok(d >= timeoutMs * 0.9 && d <= timeoutMs + 60_000, `${name}: Frist entspricht dem Zeitlimit (${d} ms statt ~${timeoutMs} ms)`);
    }
  } finally {
    await beenden(besitzer, 3000).catch(() => { /* egal */ });
    await Promise.allSettled([p, q]);
  }
});
