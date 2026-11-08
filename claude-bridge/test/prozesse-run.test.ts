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
