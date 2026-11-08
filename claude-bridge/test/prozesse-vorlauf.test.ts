// R2 Start-Aufräumen: Waisen eines früheren Bridge-Laufs werden beim Start beendet, Fremde nie angefasst.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { vorlaufAufraeumen, procStart, type Eintrag, laeuft } from '../src/prozesse.ts';

const tot = (pid: number) => { try { process.kill(pid, 0); return false; } catch (e: any) { return e.code === 'ESRCH'; } };
const warte = async (f: () => boolean, ms = 8000) => { for (let t = 0; t < ms && !f(); t += 50) await new Promise((r) => setTimeout(r, 50)); return f(); };

// Hilfsprozess: eigene Gruppe (detached), startet einen Enkel in derselben Gruppe und wartet.
const starteGruppe = async (dir: string, name: string) => {
  const enkelDatei = join(dir, name);
  const leader = spawn('sh', ['-c', `sleep 600 & echo $! > ${enkelDatei}; wait`], { detached: true, stdio: 'ignore' });
  assert.ok(await warte(() => existsSync(enkelDatei) && readFileSync(enkelDatei, 'utf8').trim() !== ''), 'Enkel gestartet');
  const enkel = Number(readFileSync(enkelDatei, 'utf8').trim());
  return { leader, enkel };
};
const eintrag = (pid: number, start: string | null, id: string, besitzer: string): Eintrag =>
  ({ id, pid, start, besitzer, art: 'test', cmd: 'sh -c sleep', startedAt: Date.now(), fristAt: null, zuletztAktiv: Date.now() });
const gruppeTot = async (dir: string, g: { leader: any; enkel: number }) => {
  assert.ok(await warte(() => tot(g.leader.pid) && tot(g.enkel)), 'ganze Gruppe tot');
};

test('vorlaufAufraeumen: eigene lebende Gruppe tot, fremder Eintrag (falsche Startzeit) unangetastet, Datei geleert', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vorlauf-'));
  const reg = join(dir, 'prozesse.json');
  const eigene = await starteGruppe(dir, 'enkel-eigen');
  const fremd = spawn('sleep', ['600'], { detached: true, stdio: 'ignore' });
  try {
    writeFileSync(reg, JSON.stringify([
      eintrag(eigene.leader.pid!, procStart(eigene.leader.pid!), 'a', 'vorlauf-eigen'),
      eintrag(fremd.pid!, '1', 'f', 'vorlauf-fremd'),   // echte PID, Startzeit passt nicht → fremd
    ]));
    const n = await vorlaufAufraeumen(reg);
    assert.ok(n >= 1, 'mindestens ein Eintrag geräumt');
    await gruppeTot(dir, eigene);
    assert.equal(laeuft(fremd.pid!), true, 'fremder Prozess läuft weiter (laeuft: Zombie zählt als tot)');
    assert.deepEqual(JSON.parse(readFileSync(reg, 'utf8')), [], 'Registerdatei geleert');
  } finally {
    for (const p of [eigene.leader.pid!, eigene.enkel, fremd.pid!]) { try { process.kill(-p, 'SIGKILL'); } catch { try { process.kill(p, 'SIGKILL'); } catch { /* weg */ } } }
  }
});

test('vorlaufAufraeumen: Leader per SIGKILL weg, Enkel lebt in der Gruppe → Enkel wird beendet', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vorlauf-'));
  const reg = join(dir, 'prozesse.json');
  const eigene = await starteGruppe(dir, 'enkel-waise');
  try {
    const start = procStart(eigene.leader.pid!);
    process.kill(eigene.leader.pid!, 'SIGKILL');   // Absturz: kein exit-Handler, Gruppe lebt weiter
    assert.ok(await warte(() => tot(eigene.leader.pid!) && !tot(eigene.enkel)), 'Leader tot, Enkel lebt');
    writeFileSync(reg, JSON.stringify([eintrag(eigene.leader.pid!, start, 'a', 'vorlauf-waise')]));
    const n = await vorlaufAufraeumen(reg);
    assert.ok(n >= 1, 'Waise geräumt');
    assert.ok(await warte(() => tot(eigene.enkel)), 'Enkel tot');
  } finally {
    for (const p of [eigene.leader.pid!, eigene.enkel]) { try { process.kill(-p, 'SIGKILL'); } catch { try { process.kill(p, 'SIGKILL'); } catch { /* weg */ } } }
  }
});

test('Start-Aufräumen löscht nie Einträge, die der neue Lauf inzwischen registriert hat', async () => {
  const { starte, beenden, registerDatei } = await import('../src/prozesse.ts');
  const dir = mkdtempSync(join(tmpdir(), 'vorlauf-neu-'));
  const datei = join(dir, 'prozesse.json');
  const g = await starteGruppe(dir, 'alt');
  writeFileSync(datei, JSON.stringify([eintrag(g.leader.pid!, procStart(g.leader.pid!), 'alt1', 'vorlauf')]));
  const auf = vorlaufAufraeumen(datei, 300);   // wie in sessions.ts: nicht abgewartet
  registerDatei(datei);
  const neu = starte('sh', ['-c', 'sleep 600'], { besitzer: 'neu-lauf', art: 'test' });
  await auf;
  await gruppeTot(dir, g);
  try {
    const inDatei = JSON.parse(readFileSync(datei, 'utf8')) as Eintrag[];
    assert.ok(inDatei.some((e) => e.id === neu.id), 'Eintrag des neuen Laufs steht noch in der Datei');
  } finally { await beenden(neu.id); registerDatei(null); }
});
