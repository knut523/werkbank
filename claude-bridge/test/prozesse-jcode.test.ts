// R4 (docs/plan-prozessregister.md): jcodeSpawn und opencodeSpawn laufen über den Prozessstarter (eigene Gruppe,
// Register). Timeout und Abbruch beenden die Gruppe (TERM→KILL) statt nur SIGTERM an den Hauptprozess —
// Enkel (bash-Tools, node --test) sterben mit, binnen Frist + 6 s.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { liste, registerDatei } from '../src/prozesse.ts';

const dir = mkdtempSync(join(tmpdir(), 'prozesse-jcode-'));
let mod: typeof import('../src/sessions.ts');

before(async () => {
  process.env.BRIDGE_STATE_DIR = join(dir, 'state');
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  // Fake-jcode: ignoriert SIGTERM, startet einen Enkel (sleep), schreibt dessen PID nach $JCODE_TEST_ENKEL, wartet.
  // (Ignorierte Signale werden über exec vererbt — auch der Enkel überlebt TERM, nur KILL hilft.)
  const jcode = `#!/bin/sh
trap '' TERM
sleep 600 &
echo $! > "$JCODE_TEST_ENKEL"
wait
`;
  // Fake-opencode: dasselbe, Enkel-Pfad kommt als zweites Argument (der Prompt).
  const oc = `#!/bin/sh
trap '' TERM
sleep 600 &
echo $! > "$2"
wait
`;
  writeFileSync(join(bin, 'jcode'), jcode);
  writeFileSync(join(bin, 'opencode'), oc);
  chmodSync(join(bin, 'jcode'), 0o755);
  chmodSync(join(bin, 'opencode'), 0o755);
  process.env.BRIDGE_JCODE_BIN = join(bin, 'jcode');
  process.env.BRIDGE_OPENCODE_BIN = join(bin, 'opencode');
  registerDatei(join(process.env.BRIDGE_STATE_DIR, 'prozesse.json'));
  mod = await import('../src/sessions.ts');
});

const tot = (pid: number) => { try { process.kill(pid, 0); return false; } catch (e: any) { return e.code === 'ESRCH'; } };
const warte = async (f: () => boolean, ms = 14_000) => { for (let t = 0; t < ms && !f(); t += 100) await new Promise((r) => setTimeout(r, 100)); return f(); };

async function pruefe(art: 'jcode' | 'opencode', abbruch: boolean) {
  const enkelDatei = join(dir, `enkel-${art}-${abbruch ? 'ab' : 'to'}-${Math.random().toString(36).slice(2)}`);
  const start = Date.now();
  if (art === 'jcode') {
    const out = await mod.jcodeSpawn({ cwd: dir, prompt: 't', model: null, tools: 'read', key: 'k', timeoutS: abbruch ? 600 : 1, abbruch: abbruch ? () => true : undefined, extra: { JCODE_TEST_ENKEL: enkelDatei } });
    assert.equal(out.code, null, `durch Signal beendet, Code ${out.code}`);
  } else {
    const out = await mod.opencodeSpawn({ cwd: dir, prompt: enkelDatei, timeoutS: abbruch ? 600 : 1, abbruch: () => abbruch });
    assert.equal(out.code, null, `durch Signal beendet, Code ${out.code}`);
  }
  assert.ok(existsSync(enkelDatei), 'Enkel wurde gestartet');
  const enkel = Number(readFileSync(enkelDatei, 'utf8').trim());
  const beideTot = await warte(() => tot(enkel), 12_000);
  assert.ok(beideTot, `Enkel ${enkel} binnen Frist + 6 s tot (ESRCH) — Abbruch über ${art}, Dauer ${Math.round((Date.now() - start) / 1000)} s`);
  assert.equal(liste().length, 0, 'Register ausgetragen');
}

test('jcodeSpawn: Timeout beendet Kind und Enkel (TERM ignoriert → Gruppe KILL), binnen Frist + 6 s', async () => {
  await pruefe('jcode', false);
});

test('jcodeSpawn: Abbruch (o.abbruch-Poll) beendet Kind und Enkel', async () => {
  await pruefe('jcode', true);
});

test('opencodeSpawn (opencode run): Timeout beendet Kind und Enkel, binnen Frist + 6 s', async () => {
  await pruefe('opencode', false);
});

test('opencodeSpawn (opencode run): Abbruch beendet Kind und Enkel', async () => {
  await pruefe('opencode', true);
});

// ── Gegenprüfung R4 (Verträge des Registers; Stand 1993d3b, kein Produktcode geändert) ─────────────────────
// Der Plan (docs/plan-prozessregister.md) verlangt von JEDEM Kindprozess einen Registereintrag mit
// „Besitzer, PID + Startzeit, Frist, letzte Aktivität“ (Strukturregel) und die Start-Mini-Spec nennt die
// Angaben ausdrücklich: `starte(cmd, args, { besitzer, art, fristMs, cwd, env })`. Aufräumen, Wächter und
// Anzeige lesen NUR aus diesem Register: „pro Strang Prozesse mit Art, Laufzeit, letzte Aktivität, Frist,
// Zustand“ (Sicht), R10 „Frist überschritten → Check-in; + Gnadenfrist → beenden“, R11 „processes mit art,
// laufzeitS, zuletztAktivS, fristAt, zustand“, R12 „Prozesse je Strang“. jcodeSpawn/opencodeSpawn füllen
// davon nur art und Besitzer-Name — Frist bleibt leer, als Besitzer steht die Startfunktion.
// (Die Fakes aus `before` laufen bis zum KILL; aufgeräumt wird über die Gruppe, die Einträge verschwinden.)

function laufend() {
  const jc = mod.jcodeSpawn({ cwd: dir, prompt: 't', model: null, tools: 'read', key: 'k', timeoutS: 600, extra: { JCODE_TEST_ENKEL: join(dir, 'enkel-register-jc') } });
  const oj = mod.opencodeSpawn({ cwd: dir, prompt: join(dir, 'enkel-register-oc'), timeoutS: 600, abbruch: () => false });
  const e = [liste({ art: 'jcode' }).at(-1), liste({ art: 'opencode-run' }).at(-1)];
  const weg = async () => { for (const x of e) if (x) { try { process.kill(-x.pid, 'SIGKILL'); } catch { /* weg */ } } await Promise.allSettled([jc, oj]); };
  return { e, weg };
}

test('jcodeSpawn/opencodeSpawn: Registereintrag trägt die Frist (timeoutS) — sonst wird der Lauf für Wächter und Anzeige nie überfällig', async () => {
  const { e, weg } = laufend();
  try {
    for (const [name, x] of [['jcode', e[0]], ['opencode-run', e[1]]] as const) {
      assert.ok(x, `${name}: Prozess steht im Register`);
      assert.notEqual(x!.fristAt, null, `${name}: fristAt gesetzt — der Wächter (R10) prüft nur fristAt, die Anzeige zeigt die Spalte Frist`);
      assert.ok(x!.fristAt! - x!.startedAt >= 600_000 - 5_000 && x!.fristAt! - x!.startedAt <= 600_000 + 60_000,
        `${name}: Frist liegt bei timeoutS (600 s), nicht bei ${x!.fristAt! - x!.startedAt} ms`);
    }
  } finally { await weg(); }
});

test('jcodeSpawn/opencodeSpawn: Registereintrag nennt den Auftraggeber (Besitzer), nicht die Startfunktion', async () => {
  const { e, weg } = laufend();
  try {
    for (const [name, x, nurFunktion] of [['jcode', e[0], 'jcodeSpawn'], ['opencode-run', e[1], 'opencodeSpawn']] as const) {
      assert.ok(x, `${name}: Prozess steht im Register`);
      assert.notEqual(x!.besitzer, nurFunktion, `${name}: Besitzer = Auftraggeber (Strang), nicht die Startfunktion — sonst findet kein Strang seinen Lauf (Sicht/R11/R12), kein Strang-Wächter kann ihn melden (R10: lives.get(besitzer)) und beenden(<Besitzer>) fasst die Läufe aller Stränge auf einmal an`);
    }
  } finally { await weg(); }
});
