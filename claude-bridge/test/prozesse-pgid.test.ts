// pgidOf muss die Prozessgruppe liefern (Feld 5), nicht die Session (Feld 6): kill(-pgid) und gruppeWeg meinen die Gruppe.
// Job-Control-Kinder (eigene Gruppe, gleiche Session) muss das Vorlauf-Aufräumen weiterhin finden.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { pgidOf, vorlaufAufraeumen, procStart } from '../src/prozesse.ts';

const tot = (pid: number) => { try { process.kill(pid, 0); return false; } catch (e: any) { return e.code === 'ESRCH'; } };
const warte = async (f: () => boolean, ms = 8000) => { for (let t = 0; t < ms && !f(); t += 50) await new Promise((r) => setTimeout(r, 50)); return f(); };
const ps = (pid: number, feld: string) => Number(execFileSync('ps', ['-o', `${feld}=`, '-p', String(pid)], { encoding: 'utf8' }).trim());

const startBash = async (dir: string) => {
  const datei = join(dir, 'kind');
  const leader = spawn('bash', ['-c', `set -m; sleep 600 & echo $! > ${datei}; wait`], { detached: true, stdio: 'ignore' });
  assert.ok(await warte(() => existsSync(datei) && readFileSync(datei, 'utf8').trim() !== ''), 'Kind gestartet');
  return { leader, kind: Number(readFileSync(datei, 'utf8').trim()) };
};

test('pgidOf liefert die echte Prozessgruppe (nicht die Session) eines Job-Control-Kindes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pgid-'));
  const { leader, kind } = await startBash(dir);
  try {
    assert.equal(ps(kind, 'sid'), leader.pid, 'Kind in der Session des Leaders');
    assert.notEqual(ps(kind, 'pgid'), ps(kind, 'sid'), 'Kind hat eigene Gruppe');
    assert.equal(pgidOf(kind), ps(kind, 'pgid'));
    assert.equal(pgidOf(leader.pid!), ps(leader.pid!, 'pgid'));
  } finally { try { process.kill(kind, 'SIGKILL'); } catch {} try { process.kill(-leader.pid!, 'SIGKILL'); } catch {} }
});

test('vorlaufAufraeumen: Leader weg, Job-Control-Kind (eigene Gruppe, gleiche Session) wird beendet', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pgid-'));
  const reg = join(dir, 'prozesse.json');
  const { leader, kind } = await startBash(dir);
  const start = procStart(leader.pid!);
  try {
    const e = { id: 'x1', pid: leader.pid!, start, besitzer: 't', art: 'test', cmd: 'bash', startedAt: Date.now(), fristAt: null, zuletztAktiv: Date.now() };
    writeFileSync(reg, JSON.stringify([e]));
    process.kill(leader.pid!, 'SIGKILL');
    assert.ok(await warte(() => !existsSync(`/proc/${leader.pid}`)), 'Leader weg');
    assert.ok(!tot(kind), 'Kind lebt noch');
    await vorlaufAufraeumen(reg, 2000);
    assert.ok(await warte(() => tot(kind)), 'Kind beendet');
  } finally { try { process.kill(kind, 'SIGKILL'); } catch {} }
});
