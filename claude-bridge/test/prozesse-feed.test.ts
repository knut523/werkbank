// Feed der laufenden Prozesse je Strang (Plan Prozessregister R11): die reine Abbildung `prozessSicht`,
// `orchStateOf().processes` und der Endpunkt GET /internal/prozesse. Keine festen Ports (test/port-hilfe.ts).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, openSync, closeSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { starte, beenden } from '../src/prozesse.ts';
import { freiePorts } from './port-hilfe.ts';

const STATE = mkdtempSync(join(tmpdir(), 'bridge-feed-'));
process.env.BRIDGE_STATE_DIR = STATE;
process.env.BRIDGE_SKILLS = '';
const mod = await import('../src/sessions.ts');

/** Felder, die ein Anzeige-Eintrag haben muss (DoD R11). */
const FELDER = ['art', 'besitzer', 'cmd', 'laufzeitS', 'zuletztAktivS', 'fristAt', 'zustand'];
const ganzeSekunden = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 0;

// ---------- rein ----------

test('prozessSicht: eigener Strang (genau und `#`-Unterstränge), Zeiten in ganzen Sekunden, Befehl gekürzt, kein env', () => {
  const jetzt = 1_800_000_000_000;
  const key = 'u1:strang1';
  const eintraege = [
    { id: 'p1', besitzer: key, art: 'claude-cli', cmd: 'claude -p ' + 'x'.repeat(300), startedAt: jetzt - 42_000, zuletztAktiv: jetzt - 5_400, fristAt: jetzt + 300_000 },
    { id: 'p2', besitzer: `${key}#endpruefung`, art: 'bash', cmd: 'npm test', startedAt: jetzt - 1_500, zuletztAktiv: jetzt - 400, fristAt: null },
    { id: 'p3', besitzer: 'u1:strang2', art: 'claude-cli', cmd: 'claude', startedAt: jetzt, zuletztAktiv: jetzt, fristAt: null },
  ];
  const zustaende = [{ id: 'p2', besitzer: `${key}#endpruefung`, zustand: 'checkin' as const }];

  const alle = mod.prozessSicht(eintraege, zustaende, jetzt);
  assert.equal(alle.length, 3, 'ohne Besitzer: alle Einträge des Registers');

  const meins = mod.prozessSicht(eintraege, zustaende, jetzt, key);
  assert.equal(meins.length, 2, 'genau die zwei Einträge des Strangs');
  assert.deepEqual(meins.map((p: any) => p.besitzer), [key, `${key}#endpruefung`]);

  const [a, b] = meins as any[];
  assert.equal(a.art, 'claude-cli');
  assert.equal(a.cmd.length, 120, 'Befehl auf 120 Zeichen gekürzt');
  assert.equal(a.laufzeitS, 42);
  assert.equal(a.zuletztAktivS, 5);
  assert.equal(a.fristAt, jetzt + 300_000);
  assert.equal(a.zustand, 'läuft', 'ohne Wächterzustand läuft');
  assert.equal(b.laufzeitS, 1);
  assert.equal(b.zuletztAktivS, 0);
  assert.equal(b.fristAt, null);
  assert.equal(b.zustand, 'checkin', 'Wächterzustand wird übernommen');

  for (const p of alle as any[]) {
    for (const f of FELDER) assert.ok(f in p, f);
    assert.ok(ganzeSekunden(p.laufzeitS) && ganzeSekunden(p.zuletztAktivS), 'ganzzahlige Sekunden');
    assert.equal('env' in p, false);
    assert.equal('environment' in p, false);
    assert.equal(JSON.stringify(p).includes('SECRET'), false);
  }
});

// ---------- Strang-Zustand ----------

test('orchStateOf: processes je Strang — die beiden eigenen sichtbar, fremder Strang fehlt, kein env', async () => {
  const user = 'k1user', conv = randomUUID();
  mod.registerOrchestration(user, conv, STATE, 'strand');
  const key = mod.sitzungsKey(user, conv);
  const kinder = [
    starte('sleep', ['600'], { besitzer: key, art: 'claude-cli' }),
    starte('sleep', ['600'], { besitzer: `${key}#endpruefung`, art: 'bash' }),
    starte('sleep', ['600'], { besitzer: `${user}:fremd`, art: 'claude-cli' }),
  ];
  try {
    const s = mod.orchStateOf(user).find((x: any) => x.conv === conv)!;
    assert.ok(s, 'Strang im Zustand');
    assert.equal(s.processes.length, 2, 'genau zwei Prozesse des Strangs');
    assert.deepEqual([...s.processes].map((p: any) => p.art).sort(), ['bash', 'claude-cli']);
    for (const p of s.processes) {
      for (const f of FELDER) assert.ok(f in p, f);
      assert.ok(ganzeSekunden(p.laufzeitS) && ganzeSekunden(p.zuletztAktivS));
      assert.ok(['läuft', 'checkin', 'überfällig'].includes(p.zustand), String(p.zustand));
      assert.equal('env' in p, false);
    }
    assert.equal(JSON.stringify(s.processes).includes('fremd'), false, 'fremder Strang fehlt');
    assert.equal(JSON.stringify(kinder.map((k) => k.id)).includes('fremd'), false);
  } finally {
    await beenden(key, 3000);
    await beenden(`${user}:fremd`, 3000);
  }
});

// ---------- Endpunkt ----------

const [PORT] = await freiePorts(1);
const INTERNAL = 'test-intern-' + randomUUID();
let bridge: ChildProcess;
let LOG = '';

before(async () => {
  const tmp = (n: string) => mkdtempSync(join(tmpdir(), n));
  // Ausgabe in eine Datei, nicht in eine Pipe: eine Pipe bliebe offen, wenn das Kind eigene Kinder hat (Testdatei hängt sonst).
  LOG = join(tmp('feed-log-'), 'bridge.log');
  const fd = openSync(LOG, 'a');
  bridge = spawn(process.execPath, ['src/server.ts'], {
    env: {
      ...process.env, BRIDGE_MOCK: '1', BRIDGE_PORT: String(PORT), BRIDGE_STATE_DIR: tmp('feed-srv-'), BRIDGE_SKILLS: '',
      BRIDGE_CLAUDE_HOMES: tmp('feed-homes-'), BRIDGE_CLAUDE_CONFIG_SHARED: '', BRIDGE_CLAUDE_CONFIG: '',
      WERKBANK_SKILLS_SOURCE: tmp('feed-skills-'), WERKBANK_INTERNAL_TOKEN: INTERNAL, WERKBANK_URL: 'http://127.0.0.1:9',
      BRIDGE_VAULT_DIR: tmp('feed-vault-'), BRIDGE_ALLOWED_EMAILS: '', WERKBANK_ORCH_ROOTS: tmp('feed-roots-'),
      BRIDGE_MAX_PARALLEL_CHATS: '1', BRIDGE_DRAIN: 'aus',
    },
    stdio: ['ignore', fd, fd],
  });
  closeSync(fd);
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return; } catch { /* startet noch */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Brücke startet nicht: ${readFileSync(LOG, 'utf8').slice(-600)}`);
});
after(async () => {
  if (!bridge) return;
  bridge.kill();
  await new Promise((r) => setTimeout(r, 300));
  if (bridge.exitCode === null) bridge.kill('SIGKILL');
});

test('GET /internal/prozesse: ohne Token 403, mit Token Liste im Feed-Format', async () => {
  const ohne = await fetch(`http://127.0.0.1:${PORT}/internal/prozesse`);
  assert.equal(ohne.status, 403);

  const ohneUser = await fetch(`http://127.0.0.1:${PORT}/internal/prozesse`, { headers: { 'x-werkbank-internal': INTERNAL } });
  assert.equal(ohneUser.status, 400, 'ohne user keine Liste über alle Personen');

  const mit = await fetch(`http://127.0.0.1:${PORT}/internal/prozesse?user=feedu`, { headers: { 'x-werkbank-internal': INTERNAL } });
  assert.equal(mit.status, 200);
  const j = await mit.json();
  assert.ok(Array.isArray(j), 'Liste der Einträge dieser Person');
  for (const p of j as any[]) assert.ok(String(p.besitzer).startsWith('feedu:'), `fremder Eintrag ${p.besitzer}`);
  for (const p of j as any[]) {
    for (const f of FELDER) assert.ok(f in p, f);
    assert.equal('env' in p, false);
  }
});

test('GET /internal/orch-state: processes je Strang auch über die Route', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/internal/orch-state?user=feedu`, { headers: { 'x-werkbank-internal': INTERNAL } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.strands));
  for (const s of j.strands as any[]) assert.ok(Array.isArray(s.processes), 'processes je Strang');
});
