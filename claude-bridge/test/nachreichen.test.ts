// Nachreichen während des Zugs (docs/plan-hauptchat-monitor.md, S1; Knut 12.10.2026: „Ich kann nichts eingeben, wenn er
// arbeitet, ich kann ihn nur stoppen.“). In-Prozess gegen handleTurn: der Mock bzw. ein gesteuertes Ersatz-CLI verhält sich wie
// Claude Code mit Streaming-Input (Einfalten an Werkzeuggrenzen, Echo mit uuid, Folgezug, Eingabe bleibt nach dem Ergebnis offen).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const STATE = mkdtempSync(join(tmpdir(), 'bridge-nachreichen-'));
let mod: typeof import('../src/sessions.ts');
let mock: typeof import('../src/mock.ts');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

before(async () => {
  process.env.BRIDGE_STATE_DIR = STATE;
  process.env.BRIDGE_MOCK_SLOW_MS = '150';
  process.env.BRIDGE_SKILLS = '';
  delete process.env.BRIDGE_PERMISSION_MODE;
  mod = await import('../src/sessions.ts');
  mock = await import('../src/mock.ts');
});

function sink() {
  let out = '';
  const closers: (() => void)[] = [];
  const s = {
    closed: false, done: false,
    write(t: string) { out += t; },
    finish() { s.done = true; s.closed = true; closers.splice(0).forEach((f) => f()); },
    onClose(f: () => void) { closers.push(f); },
    get out() { return out; },
    // Browser weg / Stopp-Knopf: LibreChat schließt die Antwort.
    stop() { s.closed = true; closers.splice(0).forEach((f) => f()); },
  };
  return s;
}

const turn = (conv: string, prompt: string, query: any, extra: Record<string, unknown> = {}) => {
  const s = sink();
  const p = mod.handleTurn({ userId: 'u1', convId: conv, token: 'tok-a', prompt, history: '', sink: s as any, query, ...extra } as any);
  return { s, p };
};
const until = async (f: () => boolean, ms = 5000) => { const t0 = Date.now(); while (!f()) { if (Date.now() - t0 > ms) throw new Error('Zeit abgelaufen'); await sleep(20); } };

/** Ersatz-CLI: Text, dann Ergebnis (subtype) erst nach gate(); danach je weiterer Nachricht Echo + Folgezug, bis die Eingabe zu ist. */
function scripted(o: { subtype?: string; echo?: boolean; waitAbort?: boolean } = {}) {
  let open!: () => void;
  const gate = new Promise<void>((r) => { open = r; });
  const seen: any[] = [];
  const q = ({ prompt, options }: any) => (async function* () {
    if (typeof prompt === 'string') { seen.push('string'); yield { type: 'result', subtype: 'success', session_id: 's', is_error: false, usage: {} }; return; }
    const it = prompt[Symbol.asyncIterator]();
    await it.next();
    yield { type: 'system', subtype: 'init', session_id: 's' };
    yield { type: 'stream_event', session_id: 's', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Teil 1. ' } } };
    if (o.waitAbort) { await new Promise<void>((r) => options.abortController.signal.addEventListener('abort', () => r())); throw new Error('aborted'); }
    await gate;
    yield { type: 'result', subtype: o.subtype ?? 'success', session_id: 's', is_error: (o.subtype ?? 'success') !== 'success', usage: {} };
    for (;;) {
      const n = await it.next();
      if (n.done) return;
      seen.push(n.value);
      if (o.echo === false) continue;   // CLI verwirft die Nachricht: kein Echo, kein Folgezug
      yield { type: 'user', isReplay: true, uuid: n.value.uuid, session_id: 's', parent_tool_use_id: null, message: n.value.message };
      yield { type: 'stream_event', session_id: 's', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Folgezug. ' } } };
      yield { type: 'result', subtype: 'success', session_id: 's', is_error: false, usage: {} };
    }
  })();
  return { q, open, seen };
}

test('DoD 1: Nachricht während eines langen Zugs wird beim nächsten Werkzeugschritt eingefaltet — gelesen, sichtbar, Zug endet', async () => {
  const conv = randomUUID();
  const { s, p } = turn(conv, 'langsam-test 5', mock.mockQuery);
  await until(() => /Schritt 1 erledigt/.test(s.out));
  const r = mod.injectMessage('u1', conv, 'Bitte auch die README anpassen');
  assert.ok(r.ok, JSON.stringify(r));
  const id = (r as any).id;
  assert.equal(mod.injectState('u1', id)!.state, 'zugestellt');
  await p;
  assert.equal(mod.injectState('u1', id)!.state, 'gelesen');
  assert.match(s.out, /📨 Nachgereicht, gelesen: „Bitte auch die README anpassen“/);
  assert.match(s.out, /\(Mock\) Nachgereicht gelesen: Bitte auch die README anpassen/);
  assert.ok(s.out.indexOf('Nachgereicht gelesen') < s.out.indexOf('Langer Zug fertig'), 'mitten im Zug, nicht danach');
  assert.equal(mod.injectState('u2', id), null, 'fremde Person sieht den Stand nicht');
});

test('DoD 2 + Council 3: zu spät für den Zug → Folgezug im selben Lauf; Ausgang kommt vom letzten Ergebnis (nicht „limit“)', async () => {
  const conv = randomUUID();
  mod.registerOrchestration('u1', conv, STATE);
  const f = scripted({ subtype: 'error_max_turns' });
  const { s, p } = turn(conv, 'los', f.q);
  await until(() => /Teil 1/.test(s.out));
  const r = mod.injectMessage('u1', conv, 'noch etwas') as any;
  assert.ok(r.ok);
  f.open();
  await p;
  assert.match(s.out, /Folgezug/);
  assert.equal(mod.injectState('u1', r.id)!.state, 'gelesen');
  const st = mod.orchStateOf('u1').find((x) => x.conv === conv)!;
  assert.equal(st.turn!.outcome, 'ok', 'der Folgezug hat das Schrittlimit abgelöst');
});

test('Council 1: kein Echo nach dem Ergebnis → Eingabe schließt nach der Frist, Nachricht „ungelesen“, Zug endet', async () => {
  process.env.BRIDGE_NACHREICHEN_GRACE_S = '1';
  try {
    const conv = randomUUID();
    const f = scripted({ echo: false });
    const { s, p } = turn(conv, 'los', f.q);
    await until(() => /Teil 1/.test(s.out));
    const r = mod.injectMessage('u1', conv, 'geht verloren?') as any;
    f.open();
    const t0 = Date.now();
    await p;
    assert.ok(Date.now() - t0 < 4000, 'hängt nicht bis zum Zeitlimit');
    assert.equal(mod.injectState('u1', r.id)!.state, 'ungelesen', 'der Client sendet sie danach neu');
  } finally { delete process.env.BRIDGE_NACHREICHEN_GRACE_S; }
});

test('Council 4: Stopp während eine Nachricht wartet → Zug endet, Nachricht „ungelesen“ (der Client stellt sie zurück ins Feld)', async () => {
  const conv = randomUUID();
  const f = scripted({ waitAbort: true });
  const { s, p } = turn(conv, 'los', f.q);
  await until(() => /Teil 1/.test(s.out));
  const r = mod.injectMessage('u1', conv, 'doch nicht') as any;
  s.stop();
  await p;
  await until(() => mod.injectState('u1', r.id)!.state === 'ungelesen');
  assert.equal(mod.injectMessage('u1', conv, 'nachher').ok, false, 'kein Zug mehr');
});

test('Council 1: Kontingent mitten im Zug → das nächste Konto bekommt die ungelesene Nachricht', async () => {
  const conv = randomUUID();
  let attempt = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const q = ({ prompt, options }: any) => (async function* () {
    const it = prompt[Symbol.asyncIterator]();
    await it.next();
    attempt++;
    if (attempt === 1) {
      yield { type: 'stream_event', session_id: 's', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Teil 1. ' } } };
      await gate;
      yield { type: 'rate_limit_event', session_id: 's', rate_limit_info: { status: 'rejected', resetsAt: Math.floor(Date.now() / 1000) + 3600 } };
      yield { type: 'assistant', parent_tool_use_id: null, session_id: 's', error: 'rate_limit', message: { content: [{ type: 'text', text: 'Rate limit' }] } };
      yield { type: 'result', subtype: 'success', session_id: 's', is_error: true, result: 'Rate limit reached', usage: {} };
      // Eingabe muss jetzt zu sein (sonst hinge der Zug hier).
      assert.equal((await it.next()).done, true);
      return;
    }
    const n = await it.next();   // die mitgenommene Nachricht
    yield { type: 'user', isReplay: true, uuid: n.value.uuid, session_id: 's', parent_tool_use_id: null, message: n.value.message };
    yield { type: 'result', subtype: 'success', session_id: 's', is_error: false, usage: {} };
  })();
  const { s, p } = turn(conv, 'los', q, { accounts: async () => [{ id: 'a', label: 'A', token: 'tok-a' }, { id: 'b', label: 'B', token: 'tok-b' }] });
  await until(() => /Teil 1/.test(s.out));
  const r = mod.injectMessage('u1', conv, 'mit auf das zweite Konto') as any;
  release();
  await p;
  assert.equal(attempt, 2);
  assert.equal(mod.injectState('u1', r.id)!.state, 'gelesen');
  assert.match(s.out, /Konto „[AB]“ übernimmt/);
});

test('Review A 2: Fehler-Ergebnis schließt, das CLI liest die schon gelieferte Nachricht trotzdem im Folgezug → „gelesen“, kein Doppel', async () => {
  const conv = randomUUID();
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const q = ({ prompt }: any) => (async function* () {
    const it = prompt[Symbol.asyncIterator]();
    await it.next();
    yield { type: 'stream_event', session_id: 's', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Teil 1. ' } } };
    const n = await it.next();   // Nachricht ist schon beim CLI
    await gate;
    yield { type: 'result', subtype: 'error_during_execution', session_id: 's', is_error: true, usage: {} };
    // Das CLI holt den Folgezug mit der schon empfangenen Nachricht nach.
    yield { type: 'user', isReplay: true, uuid: n.value.uuid, session_id: 's', parent_tool_use_id: null, message: n.value.message };
    yield { type: 'result', subtype: 'success', session_id: 's', is_error: false, usage: {} };
  })();
  const { s, p } = turn(conv, 'los', q);
  await until(() => /Teil 1/.test(s.out));
  const r = mod.injectMessage('u1', conv, 'spät gelesen') as any;
  release();
  await p;
  assert.equal(mod.injectState('u1', r.id)!.state, 'gelesen', 'der Client sendet nicht noch einmal');
  assert.match(s.out, /📨 Nachgereicht, gelesen: „spät gelesen“/);
});

test('Review A 3: früh gelesen, dann Kontingent ohne Fortschritt → das nächste Konto fängt von vorn an und bekommt die Nachricht erneut', async () => {
  const conv = randomUUID();
  let attempt = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const got: string[] = [];
  const q = ({ prompt }: any) => (async function* () {
    const it = prompt[Symbol.asyncIterator]();
    await it.next();
    attempt++;
    if (attempt === 1) {
      await gate;
      const n = await it.next();
      yield { type: 'user', isReplay: true, uuid: n.value.uuid, session_id: 's', parent_tool_use_id: null, message: n.value.message };
      yield { type: 'rate_limit_event', session_id: 's', rate_limit_info: { status: 'rejected', resetsAt: Math.floor(Date.now() / 1000) + 3600 } };
      yield { type: 'assistant', parent_tool_use_id: null, session_id: 's', error: 'rate_limit', message: { content: [{ type: 'text', text: 'Rate limit' }] } };
      yield { type: 'result', subtype: 'success', session_id: 's', is_error: true, result: 'Rate limit reached', usage: {} };
      return;
    }
    const n = await it.next();
    got.push(n.value.message.content);
    yield { type: 'user', isReplay: true, uuid: n.value.uuid, session_id: 's', parent_tool_use_id: null, message: n.value.message };
    yield { type: 'result', subtype: 'success', session_id: 's', is_error: false, usage: {} };
  })();
  const { p } = turn(conv, 'los', q, { accounts: async () => [{ id: 'a', label: 'A', token: 'tok-c' }, { id: 'b', label: 'B', token: 'tok-d' }] });
  await until(() => mod.injectMessage('u1', conv, 'früh').ok === true || false, 3000).catch(() => {});
  release();
  await p;
  assert.deepEqual(got, ['früh'], 'zweites Konto hat die Nachricht');
});

test('Bild-Prüfung: Nachreichen schon während Kontext-Paket/Konten laden → kommt mit in den Zug', async () => {
  const conv = randomUUID();
  let ctxDone!: () => void;
  const ctxGate = new Promise<void>((r) => { ctxDone = r; });
  const { s, p } = turn(conv, 'langsam-test 2', mock.mockQuery, { sessionContext: async () => { await ctxGate; return ''; } });
  await sleep(50);
  const r = mod.injectMessage('u1', conv, 'ganz früh') as any;
  assert.ok(r.ok, JSON.stringify(r));
  ctxDone();
  await p;
  assert.equal(mod.injectState('u1', r.id)!.state, 'gelesen');
  assert.match(s.out, /Nachgereicht gelesen: ganz früh/);
});

test('Council 7: Sperren — kein Zug, leer, Hauptchat-Kennung; BRIDGE_NACHREICHEN=off = String-Prompt wie vorher', async () => {
  assert.deepEqual(mod.injectMessage('u1', randomUUID(), 'x'), { ok: false, status: 409, error: 'In diesem Chat läuft gerade kein Zug.' });
  assert.equal((mod.injectMessage('u1', randomUUID(), '  ') as any).status, 400);
  assert.equal((mod.injectMessage('u1', randomUUID(), 'Meldung\n#leitstand-abcdef12') as any).status, 400);
  process.env.BRIDGE_NACHREICHEN = 'off';
  try {
    const conv = randomUUID();
    const f = scripted();
    const { p } = turn(conv, 'los', f.q);
    assert.equal((mod.injectMessage('u1', conv, 'x') as any).status, 409);
    await p;
    assert.deepEqual(f.seen, ['string'], 'altes Verhalten: String-Prompt');
  } finally { delete process.env.BRIDGE_NACHREICHEN; }
});
