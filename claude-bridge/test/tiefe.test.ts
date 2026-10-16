// Tiefe je Strang (Plan 205, docs/plan-eta-tiefe.md): bei der Anmeldung gesetzt, in orch-state sichtbar; deep = doppelte
// Schritte je Zug, quick = ohne den Hinweis „Gegenprüfung STANDARDMÄSSIG“. In-Prozess gegen handleTurn mit Ersatz-CLI.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const STATE = mkdtempSync(join(tmpdir(), 'bridge-tiefe-'));
let mod: typeof import('../src/sessions.ts');

before(async () => {
  process.env.BRIDGE_STATE_DIR = STATE;
  process.env.BRIDGE_SKILLS = '';
  delete process.env.BRIDGE_PERMISSION_MODE;
  mod = await import('../src/sessions.ts');
});

const MEL = { id: 'melious', label: 'Melious', token: `sk-mel-tiefe-${'y'.repeat(24)}`, kind: 'melious', rest: 200_000, fallback: false };

/** Ein Zug mit Ersatz-CLI, das nur die Optionen merkt. */
async function optionsFor(tiefe?: 'quick' | 'regular' | 'deep') {
  const conv = randomUUID();
  mod.registerOrchestration('u1', conv, STATE, 'strand', tiefe ? { tiefe } : {});
  let seen: any = null;
  const query = ({ prompt, options }: any) => (async function* () {
    seen = options;
    if (typeof prompt !== 'string') await prompt[Symbol.asyncIterator]().next();
    yield { type: 'system', subtype: 'init', session_id: 's' };
    yield { type: 'result', subtype: 'success', session_id: 's', is_error: false, usage: {} };
  })();
  const closers: (() => void)[] = [];
  const sink = { closed: false, done: false, write() {}, finish() { sink.done = true; sink.closed = true; closers.splice(0).forEach((f) => f()); }, onClose(f: () => void) { closers.push(f); } };
  await mod.handleTurn({ userId: 'u1', convId: conv, token: 'tok-a', prompt: 'los', history: '', sink, query, accounts: async () => [{ id: 'chat', label: 'Chat', token: null }, MEL] } as any);
  return { conv, options: seen };
}

test('Tiefe: Vorgabe regular, in orch-state sichtbar; unbekannte Werte werden nicht übernommen', async () => {
  const { conv } = await optionsFor();
  assert.equal(mod.orchStateOf('u1').find((x) => x.conv === conv)!.tiefe, 'regular');
  const c2 = randomUUID();
  mod.registerOrchestration('u1', c2, STATE, 'strand', { tiefe: 'tief' as any });
  assert.equal(mod.orchStateOf('u1').find((x) => x.conv === c2)!.tiefe, 'regular');
  const c3 = randomUUID();
  mod.registerOrchestration('u1', c3, STATE, 'strand', { tiefe: 'deep' });
  assert.equal(mod.orchStateOf('u1').find((x) => x.conv === c3)!.tiefe, 'deep');
});

test('Tiefe deep: doppelte Schritte je Zug; regular und quick wie ORCH_MAX_TURNS', async () => {
  const reg = (await optionsFor('regular')).options;
  const deep = (await optionsFor('deep')).options;
  const quick = (await optionsFor('quick')).options;
  assert.ok(reg?.maxTurns > 0, 'Optionen gesehen');
  assert.equal(deep.maxTurns, reg.maxTurns * 2);
  assert.equal(quick.maxTurns, reg.maxTurns);
});

test('Tiefe quick: kein Hinweis „Gegenprüfung STANDARDMÄSSIG“; regular und deep behalten ihn', async () => {
  const hint = /Gegenprüfung: In plan-to-pr/;
  assert.match((await optionsFor('regular')).options.systemPrompt.append, hint);
  assert.match((await optionsFor('deep')).options.systemPrompt.append, hint);
  assert.doesNotMatch((await optionsFor('quick')).options.systemPrompt.append, hint);
});
