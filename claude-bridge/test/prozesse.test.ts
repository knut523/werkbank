import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { starte, beenden, liste, aktivitaet, registerDatei, vorlaufLesen, procStart, lebt } from '../src/prozesse.ts';

const tot = (pid: number) => { try { process.kill(pid, 0); return false; } catch (e: any) { return e.code === 'ESRCH'; } };
const warte = async (f: () => boolean, ms = 5000) => { for (let t = 0; t < ms && !f(); t += 50) await new Promise((r) => setTimeout(r, 50)); return f(); };
const dir = mkdtempSync(join(tmpdir(), 'prozesse-'));
const reg = join(dir, 'prozesse.json');
registerDatei(reg);
const lies = () => JSON.parse(readFileSync(reg, 'utf8')) as any[];

test('starte: Eintrag in liste() und Registerdatei; beenden(besitzer) tötet Kind und Enkel, Eintrag weg', async () => {
  const enkelDatei = join(dir, 'enkel');
  const { id, kind } = starte('sh', ['-c', `sleep 600 & echo $! > ${enkelDatei}; wait`], { besitzer: 'strang-1', art: 'test', fristMs: 60_000 });
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
  const { id, kind } = starte('sleep', ['600'], { besitzer: 'fremd', art: 'test' });
  try {
    assert.ok(procStart(kind.pid!));
    assert.equal(lebt({ pid: kind.pid!, start: 'falsch' }), false);
    // Eintrag mit falscher Startzeit unterschieben
    liste().find((x) => x.id === id)!.start = 'falsch';
    assert.equal(await beenden(id, 400), 0);
    assert.equal(tot(kind.pid!), false, 'lebt weiter');
  } finally { try { process.kill(-kind.pid!, 'SIGKILL'); } catch { /* weg */ } }
  assert.ok(await warte(() => tot(kind.pid!)));
});

test('natürliches Ende trägt aus; zuletztAktiv rückt bei Ausgabe vor', async () => {
  let t = 1000;
  const { id, kind } = starte('sh', ['-c', 'sleep 0.3; echo hallo; sleep 0.3'], { besitzer: 'b', art: 'test', jetzt: () => t } as any);
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
  const { id, kind } = starte('sleep', ['600'], { besitzer: 'v', art: 'test' });
  try { assert.ok(vorlaufLesen(reg).some((x) => x.id === id)); } finally { try { process.kill(-kind.pid!, 'SIGKILL'); } catch { /* weg */ } }
});
