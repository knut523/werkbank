import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { starte, beenden, liste, registerDatei, vorlaufLesen, procStart, lebt, beendenProz, laeuft } from '../src/prozesse.ts';

const tot = (pid: number) => { try { process.kill(pid, 0); return false; } catch (e: any) { return e.code === 'ESRCH'; } };
const warte = async (f: () => boolean, ms = 5000) => { for (let t = 0; t < ms && !f(); t += 50) await new Promise((r) => setTimeout(r, 50)); return f(); };
const dir = mkdtempSync(join(tmpdir(), 'prozesse-'));
const reg = join(dir, 'prozesse.json');
registerDatei(reg);
const lies = () => JSON.parse(readFileSync(reg, 'utf8')) as any[];

test('starte: Eintrag in liste() und Registerdatei; beenden(besitzer) tötet Kind und Enkel, Eintrag weg', async () => {
  const enkelDatei = join(dir, 'enkel');
  const { id, kind } = starte('sh', ['-c', `sleep 600 & echo $! > ${enkelDatei}; wait`], { besitzer: 'strang-1', art: 'test', fristMs: 60_000, env: process.env });
  assert.ok(await warte(() => existsSync(enkelDatei) && readFileSync(enkelDatei, 'utf8').trim() !== ''));
  const enkel = Number(readFileSync(enkelDatei, 'utf8').trim());
  const e = liste().find((x) => x.id === id)!;
  assert.equal(e.pid, kind.pid); assert.equal(e.besitzer, 'strang-1'); assert.ok(e.start); assert.ok(e.fristAt);
  const d = lies().find((x) => x.id === id);
  assert.ok(d && d.pid === kind.pid && d.start === e.start && d.besitzer === 'strang-1' && d.fristAt);
  assert.equal(liste({ besitzer: 'andere' }).length, 0);
  const n = await beenden('strang-1', 3000);
  assert.equal(n, 1);
  assert.ok(await warte(() => tot(kind.pid!) && tot(enkel)), 'Kind und Enkel tot');
  assert.equal(liste().find((x) => x.id === id), undefined);
  assert.equal(lies().find((x) => x.id === id), undefined);
});

test('fremde PID (pid passt, Startzeit nicht) wird nicht getötet', async () => {
  const { id, kind } = starte('sleep', ['600'], { besitzer: 'fremd', art: 'test', env: process.env });
  try {
    assert.ok(procStart(kind.pid!));
    assert.equal(lebt({ pid: kind.pid!, start: 'falsch' }), false);
    assert.equal(await beendenProz({ pid: kind.pid!, start: 'falsch' }, 400), false);
    assert.equal(liste().find((x) => x.id === id)!.start, procStart(kind.pid!), 'echter Eintrag unberührt');
    assert.equal(tot(kind.pid!), false, 'lebt weiter');
  } finally { try { process.kill(-kind.pid!, 'SIGKILL'); } catch { /* weg */ } }
  assert.ok(await warte(() => tot(kind.pid!)));
});

test('natürliches Ende trägt aus; zuletztAktiv rückt bei Ausgabe vor', async () => {
  let t = 1000;
  const { id, kind } = starte('sh', ['-c', 'sleep 0.3; echo hallo; sleep 0.3'], { besitzer: 'b', art: 'test', env: process.env, jetzt: () => t } as any);
  const aktivitaet = (i: string) => liste().find((x) => x.id === i)?.zuletztAktiv ?? null;
  const a0 = aktivitaet(id)!;
  t = 5000;
  assert.ok(await warte(() => aktivitaet(id)! > a0));
  assert.equal(aktivitaet(id), 5000);
  await new Promise((r) => kind.on('exit', r));
  assert.ok(await warte(() => !liste().some((x) => x.id === id)));
  assert.equal(lies().some((x) => x.id === id), false);
  assert.equal(aktivitaet(id), null);
});

test('vorlaufLesen liefert Einträge einer früheren Datei, leer bei fehlender', () => {
  assert.deepEqual(vorlaufLesen(join(dir, 'gibtsnicht.json')), []);
  const { id, kind } = starte('sleep', ['600'], { besitzer: 'v', art: 'test', env: process.env });
  try { assert.ok(vorlaufLesen(reg).some((x) => x.id === id)); } finally { try { process.kill(-kind.pid!, 'SIGKILL'); } catch { /* weg */ } }
});

test('liste() liefert Kopien: Änderung daran erreicht das Register nicht', () => {
  const { id, kind } = starte('sleep', ['600'], { besitzer: 'k', art: 'test', env: process.env });
  try {
    const e = liste({ besitzer: 'k' })[0]; const start = e.start; e.start = 'x'; e.besitzer = 'y';
    assert.equal(liste({ besitzer: 'k' })[0].start, start);
  } finally { try { process.kill(-kind.pid!, 'SIGKILL'); } catch { /* weg */ } }
});

test('Leader endet, Enkel lebt in der Gruppe → Gruppe wird beendet, Eintrag weg', async () => {
  const enkelDatei = join(dir, 'enkel2');
  const { id, kind } = starte('sh', ['-c', `sleep 600 & echo $! > ${enkelDatei}; exit 0`], { besitzer: 'leader', art: 'test', env: process.env });
  await new Promise((r) => kind.once('exit', r));
  assert.ok(await warte(() => existsSync(enkelDatei) && readFileSync(enkelDatei, 'utf8').trim() !== ''));
  const enkel = Number(readFileSync(enkelDatei, 'utf8').trim());
  try {
    assert.ok(await warte(() => tot(enkel)), 'Enkel tot');
    assert.equal(liste().some((x) => x.id === id), false);
  } finally { try { process.kill(enkel, 'SIGKILL'); } catch { /* weg */ } }
});

test('beendenProz: Leader endet auf TERM, Enkel ignoriert TERM → Enkel wird trotzdem beendet', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'term-'));
  const k = spawn('sh', ['-c', `(trap '' TERM; exec sleep 600) & echo $! > ${dir}/enkel; wait`], { detached: true, stdio: 'ignore' });
  let enkel = 0;
  try {
    for (let i = 0; i < 100 && !enkel; i++) { try { enkel = Number(readFileSync(join(dir, 'enkel'), 'utf8')); } catch { await new Promise((r) => setTimeout(r, 20)); } }
    assert.ok(enkel > 0, 'Enkel gestartet');
    assert.equal(await beendenProz({ pid: k.pid!, start: procStart(k.pid!) }, 500), true);
    assert.equal(laeuft(enkel), false, 'Enkel läuft nicht mehr');
  } finally { try { process.kill(-k.pid!, 'SIGKILL'); } catch { /* weg */ } }
});

test('beenden(besitzer) endet auch Untereinträge `<besitzer>#…` (Endprüfung), aber keinen Namensvetter', async () => {
  const b = `u:strang-${process.pid}-${Date.now()}`;
  const haupt = starte('sleep', ['600'], { besitzer: b, art: 'claude-cli', env: process.env });
  const unter = starte('sleep', ['600'], { besitzer: `${b}#endpruefung`, art: 'claude-cli', env: process.env });
  const vetter = starte('sleep', ['600'], { besitzer: `${b}x`, art: 'claude-cli', env: process.env });
  try {
    assert.equal(await beenden(b, 2000), 2, 'Haupt- und Untereintrag beendet');
    assert.equal(laeuft(haupt.kind.pid!), false);
    assert.equal(laeuft(unter.kind.pid!), false, 'Endprüfung läuft nicht weiter');
    assert.equal(laeuft(vetter.kind.pid!), true, 'Namensvetter bleibt');
  } finally { await beenden(vetter.id, 2000); await beenden(unter.id, 2000); }
});
