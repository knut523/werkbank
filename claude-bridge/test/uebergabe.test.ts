// Paket G: automatische Übergabe bei Kontext ≥ Grenze — rein (Grenze, DoD, Statusblock) und durch handleTurn (frische Sitzung statt resume).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sollUebergeben, uebergabeGrenze, dodWoertlich, offenePunkte, statusblock, kontextVon } from '../src/uebergabe.ts';

test('Grenze: Vorgabe 150k, Env-Wert, Abschaltung', () => {
  assert.equal(uebergabeGrenze({}), 150_000);
  assert.equal(uebergabeGrenze({ BRIDGE_UEBERGABE_TOKENS: '90000' }), 90_000);
  assert.equal(uebergabeGrenze({ BRIDGE_UEBERGABE_TOKENS: '5' }), 150_000);
  assert.equal(sollUebergeben(149_999, {}), false);
  assert.equal(sollUebergeben(150_000, {}), true);
  assert.equal(sollUebergeben(900_000, { BRIDGE_UEBERGABE: 'aus' }), false);
  assert.equal(kontextVon({ input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 }), 115);
});

test('Statusblock: Ziel, DoD wörtlich, Stand, offene Punkte, Dateien', () => {
  const auftrag = 'Baue X.\n\n## DoD\n- Test grün\n- Register nachgezogen\n\n## Sonst\nnichts';
  assert.equal(dodWoertlich(auftrag), '## DoD\n- Test grün\n- Register nachgezogen');
  assert.deepEqual(offenePunkte('fertig: A\n- [ ] B prüfen\n- [x] C'), ['- [ ] B prüfen']);
  const b = statusblock({ auftrag, letzte: 'Teil A fertig.\n- [ ] Teil B offen', dateien: ['/w/a.ts'], ctx: 152_000 });
  for (const h of ['## Ziel', '## DoD (wörtlich)', '## Stand', '## Offene Punkte', '## Dateien']) assert.match(b, new RegExp(h.replace(/[()]/g, '\\$&')));
  assert.match(b, /- Register nachgezogen/);
  assert.match(b, /152k/);
  assert.match(b, /- \/w\/a\.ts/);
});

const STATE = mkdtempSync(join(tmpdir(), 'bridge-uebergabe-'));
let mod: typeof import('../src/sessions.ts');
before(async () => { process.env.BRIDGE_STATE_DIR = STATE; process.env.BRIDGE_SKILLS = ''; delete process.env.BRIDGE_PERMISSION_MODE; mod = await import('../src/sessions.ts'); });

const sink = () => { let out = ''; const c: (() => void)[] = []; const s: any = { closed: false, done: false, write(t: string) { out += t; }, finish() { s.done = true; s.closed = true; c.splice(0).forEach((f) => f()); }, onClose(f: () => void) { c.push(f); }, get out() { return out; } }; return s; };
const textOf = async (p: any): Promise<string> => { if (typeof p === 'string') return p; for await (const m of p) { const c = m?.message?.content; return typeof c === 'string' ? c : (c ?? []).map((x: any) => x.text ?? '').join(''); } return ''; };

test('Zug nach 150k Kontext: frische Sitzung mit Statusblock (kein resume), Hinweis im Chat; darunter bleibt resume', async () => {
  const calls: { resume?: string; prompt: string }[] = [];
  let ctx = 160_000, n = 0;
  const query = (a: any) => (async function* () {
    calls.push({ resume: a.options?.resume, prompt: await textOf(a.prompt) });
    const sid = `s-${++n}`;
    yield { type: 'system', subtype: 'init', session_id: sid };
    yield { type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { model: 'm', content: [{ type: 'text', text: 'Teil A fertig.\n- [ ] Teil B offen' }], usage: { input_tokens: 10, cache_read_input_tokens: ctx } } };
    yield { type: 'result', subtype: 'success', session_id: sid, is_error: false, usage: { input_tokens: 1, output_tokens: 1 } };
  })();
  const conv = randomUUID();
  const zug = async (prompt: string) => { const s = sink(); await mod.handleTurn({ userId: 'u1', convId: conv, token: 'tok-a', prompt, history: '', sink: s, query } as any); return s; };
  await zug('Baue X. DoD: Test grün');
  const s2 = await zug('weiter');
  assert.equal(calls[1].resume, undefined, 'nicht fortgesetzt');
  assert.match(calls[1].prompt, /## Ziel[\s\S]*Baue X/);
  assert.match(calls[1].prompt, /Teil B offen/);
  assert.match(calls[1].prompt, /## Neue Nachricht\s+weiter/);
  assert.match(s2.out, /Kontext bei 160k/);
  // danach ist der Zähler zurückgesetzt, aber die Antwort der neuen Sitzung ist wieder groß → nächster Zug wieder frisch; bei kleinem Kontext resume
  ctx = 20_000;
  await zug('noch eins');   // Sitzung 2 meldet 20k
  const s4 = await zug('und weiter');
  assert.equal(calls[3].resume, 's-3');
  assert.doesNotMatch(s4.out, /Kontext bei/);
});

test('Zähler überleben den Neustart (Session-Ablage)', async () => {
  const { ladeStand, speichereStand } = await import('../src/uebergabe.ts');
  const f = join(mkdtempSync(join(tmpdir(), 'ueb-')), 'session-uebergabe.json');
  assert.deepEqual(ladeStand(f), {});
  speichereStand(f, { c1: { ctx: 151_000, letzte: 'x', erst: 'Auftrag', n: 2 } });
  const neu = ladeStand(f);   // „Neustart“: frisch von der Platte
  assert.equal(neu.c1.ctx, 151_000);
  assert.equal(neu.c1.n, 2);
  assert.equal(sollUebergeben(neu.c1.ctx, {}), true, 'die Grenze greift auch nach dem Neustart');
});
