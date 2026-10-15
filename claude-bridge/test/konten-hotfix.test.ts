// Hotfix 15b (Knut 15.10.2026: „workspace sagt mein claude kontingent ist ausgeschöpft a) sollte er das nicht mit melious
// sagen und b) habe ich im 2. account noch usage“). Live: fünf Züge gleichzeitig, Kontenliste der Werkbank nach 3 s
// abgebrochen → nur Konto „chat“ (Wochenlimit) → „ausgeschöpft“, obwohl Konto 2 und Melious frei waren.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const STATE = mkdtempSync(join(tmpdir(), 'bridge-konten-hotfix-'));
let mod: typeof import('../src/sessions.ts');
let acc: typeof import('../src/accounts.ts');

before(async () => {
  process.env.BRIDGE_STATE_DIR = STATE;
  process.env.BRIDGE_SKILLS = '';
  delete process.env.BRIDGE_PERMISSION_MODE;
  mod = await import('../src/sessions.ts');
  acc = await import('../src/accounts.ts');
});

// ---------- 1. Kontenliste: Wiederholung und letzte erfolgreiche Liste ----------

test('Kontenliste: erster Abruf bricht ab → ein Wiederholversuch', async () => {
  let n = 0;
  const list = await acc.loadAccounts('w1', async () => { if (++n === 1) throw new Error('The operation was aborted due to timeout'); return [{ id: 'chat', label: 'K1', token: null }, { id: 'k2', label: 'K2', token: 'tok-k2' }]; });
  assert.equal(n, 2);
  assert.deepEqual(list.map((a) => a.id), ['chat', 'k2']);
});

test('Kontenliste: beide Abrufe scheitern → die letzte erfolgreich geladene Liste der Person', async () => {
  await acc.loadAccounts('w2', async () => [{ id: 'chat', label: 'K1', token: null }, { id: 'k2', label: 'K2', token: 'tok-k2' }]);
  let n = 0;
  const list = await acc.loadAccounts('w2', async () => { n++; throw new Error('timeout'); });
  assert.equal(n, 2);
  assert.deepEqual(list.map((a) => a.id), ['chat', 'k2']);
  // Nur je Person: eine andere Person bekommt nie diese Liste.
  await assert.rejects(acc.loadAccounts('w3', async () => { throw new Error('timeout'); }));
});

// ---------- 2. Nicht geladen + „chat“ meldet das Limit → nachladen und weiter ----------

const tokenOf = (options: any) => options?.env?.CLAUDE_CODE_OAUTH_TOKEN;
/** Ersatz-CLI: Konto mit Token in `limit` meldet rate_limit, alle anderen antworten mit ihrem Token. */
const cli = (limit: Set<string>, used: string[]) => ({ prompt, options }: any) => (async function* () {
  if (typeof prompt !== 'string') await prompt[Symbol.asyncIterator]().next();
  const t = tokenOf(options);
  used.push(t);
  if (limit.has(t)) {
    yield { type: 'rate_limit_event', session_id: 's', rate_limit_info: { status: 'rejected', resetsAt: Math.floor(Date.now() / 1000) + 3 * 86_400 } };
    yield { type: 'assistant', parent_tool_use_id: null, session_id: 's', error: 'rate_limit', message: { content: [{ type: 'text', text: 'Rate limit' }] } };
    yield { type: 'result', subtype: 'success', session_id: 's', is_error: true, result: 'Rate limit reached', usage: {} };
    return;
  }
  yield { type: 'stream_event', session_id: 's', parent_tool_use_id: null, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `Antwort über ${t}. ` } } };
  yield { type: 'result', subtype: 'success', session_id: 's', is_error: false, usage: {} };
})();

function sink() {
  let out = '';
  const closers: (() => void)[] = [];
  const s = { closed: false, done: false, write(t: string) { out += t; }, finish() { s.done = true; s.closed = true; closers.splice(0).forEach((f) => f()); }, onClose(f: () => void) { closers.push(f); }, get out() { return out; } };
  return s;
}

test('Kontenliste fehlt, „chat“ ist ausgeschöpft → Konten nachladen, Konto 2 übernimmt im selben Zug', async () => {
  let calls = 0;
  const accounts = async () => { if (++calls === 1) throw new Error('The operation was aborted due to timeout'); return [{ id: 'chat', label: 'Konto 1', token: null }, { id: 'k2', label: 'Konto 2', token: 'tok-n2' }]; };
  const used: string[] = [];
  const s = sink();
  await mod.handleTurn({ userId: 'nachladen', convId: randomUUID(), token: 'tok-n1', prompt: 'Hallo', history: '', sink: s as any, query: cli(new Set(['tok-n1']), used), accounts } as any);
  assert.equal(calls, 2, 'nach dem Limit neu geladen');
  assert.deepEqual(used, ['tok-n1', 'tok-n2']);
  assert.match(s.out, /Antwort über tok-n2/);
  assert.match(s.out, /↻ Konto „Konto 2“ übernimmt/);
  assert.doesNotMatch(s.out, /⚠️/);
});

test('Kontenliste fehlt auch beim Nachladen → keine „ausgeschöpft“-Meldung ohne Hinweis, dass die Konten nicht geladen waren', async () => {
  const accounts = async () => { throw new Error('timeout'); };
  const s = sink();
  await mod.handleTurn({ userId: 'nachladen2', convId: randomUUID(), token: 'tok-m1', prompt: 'Hallo', history: '', sink: s as any, query: cli(new Set(['tok-m1']), []), accounts } as any);
  assert.match(s.out, /⚠️ Claude-Kontingent von „Chat-Schlüssel“ \(Reset [^)]+\) ausgeschöpft\. Die Kontenliste der Werkbank war nicht zu laden — ob weitere Claude-Konten oder Melious frei sind, ist unbekannt/);
  assert.doesNotMatch(s.out, /nicht erlaubt/);
  assert.doesNotMatch(s.out, /Dein Claude-Kontingent ist gerade ausgeschöpft\. Bitte später noch einmal\.\s*$/);
});

// ---------- 3. Wirklich alles leer: jedes Glied in der Meldung ----------

test('Alles leer: die Meldung nennt jedes Claude-Konto mit Reset und den Melious-Stand', async () => {
  const now = Date.UTC(2026, 9, 15, 10, 0);
  const k: any[] = [{ id: 'chat', label: 'Konto 1', token: 'a' }, { id: 'k2', label: 'Konto 2', token: 'b' }];
  const ex = { chat: { until: Date.UTC(2026, 9, 18, 7, 0) }, k2: { until: Date.UTC(2026, 9, 15, 13, 0) } };
  const ohne = acc.erschoepftMeldung(k, ex, now);
  assert.match(ohne, /„Konto 1“ \(Reset So 18\.10\., 09:00\)/);
  assert.match(ohne, /„Konto 2“ \(Reset heute 15:00\)/);
  assert.match(ohne, /Melious: in der Einrichtung nicht erlaubt/);
  const mel = { id: 'melious', label: 'Melious', token: 'sk-mel-x', kind: 'melious', rest: 0, sperre: 'Monatsdeckel erreicht' };
  assert.match(acc.erschoepftMeldung([...k, mel], ex, now), /Melious: gesperrt \(Monatsdeckel erreicht\)/);
  assert.match(acc.erschoepftMeldung([...k, { ...mel, sperre: undefined }], ex, now), /Melious: Energie bis zum Deckel aufgebraucht/);
  assert.match(acc.erschoepftMeldung([...k, { ...mel, sperre: undefined }], { ...ex, melious: { until: Date.UTC(2026, 9, 15, 11, 0) } }, now), /Melious: gesperrt bis heute 13:00/);
  const frei = { ...mel, sperre: undefined, rest: 1234.4, faktoren: { standard: { in: 1, out: 1 } } };
  assert.match(acc.erschoepftMeldung([...k, frei], ex, now), /Melious: frei \(≈ 1\.234 Energie geschätzt\), als letzter Ausweg in der Einrichtung aus/);
  assert.match(acc.erschoepftMeldung([...k, { ...frei, fallback: true }], ex, now), /Melious: frei \(≈ 1\.234 Energie geschätzt\), für diesen Zug aber nicht freigegeben/);
});

test('Alles leer im Zug: statt nur des Claude-Texts die Meldung mit allen Gliedern', async () => {
  const s = sink();
  await mod.handleTurn({ userId: 'alleleer', convId: randomUUID(), token: 'tok-l1', prompt: 'Hallo', history: '', sink: s as any, query: cli(new Set(['tok-l1', 'tok-l2']), []), accounts: async () => [{ id: 'chat', label: 'Konto 1', token: null }, { id: 'k2', label: 'Konto 2', token: 'tok-l2' }] } as any);
  assert.match(s.out, /⚠️ Claude-Kontingent ausgeschöpft — „Konto 1“ \(Reset [^)]+\) und „Konto 2“ \(Reset [^)]+\); Melious: in der Einrichtung nicht erlaubt/);
});
