// Konten ohne Usage („unbekannt“, cswap kennt sie nicht): die Probe läuft nebenher, der erste Zug darf nicht an einer leeren Schlange scheitern.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

process.env.BRIDGE_STATE_DIR = mkdtempSync(join(tmpdir(), 'konto-unbekannt-'));
process.env.BRIDGE_SKILLS = '';
const b = await import('../src/claudebudget.ts');
const m = await import('../src/sessions.ts');

beforeEach(() => b.budgetVergessen());

const sink = () => { let out = ''; const c: (() => void)[] = []; const s: any = { closed: false, done: false, write(t: string) { out += t; }, finish() { s.done = true; s.closed = true; c.splice(0).forEach((f) => f()); }, onClose(f: () => void) { c.push(f); }, get out() { return out; } }; return s; };
// Der Token der Anfrage ist immer das Konto „chat“ (normalizeAccounts); beide Konten sind in cswap eingetragen, aber ohne Usage.
const KONTEN = (pre: string) => [{ id: 'chat', label: 'Chat', token: `tok-${pre}-1` }, { id: `${pre}2`, label: 'K2', token: `tok-${pre}-2` }];
const unbekannt = (pre: string) => b.aktualisiere({ accounts: [] }, { chat: '1', [`${pre}2`]: '2' });
const fakeQuery = (probeOk: boolean, n: { probe: number; zug: number }) => (a: any) => (async function* () {
  const probe = a.options?.model === 'haiku' && /Antworte nur mit: ok/.test(String(a.prompt));
  if (probe) {
    n.probe++;
    await new Promise((r) => setTimeout(r, 80));   // die Probe dauert: der Zug darf sie nicht überholen
    if (!probeOk) throw new Error('login failed');
    yield { type: 'result', subtype: 'success', session_id: 'p', is_error: false, usage: {} };
    return;
  }
  n.zug++;
  yield { type: 'assistant', session_id: 's', parent_tool_use_id: null, message: { model: 'm', content: [{ type: 'text', text: 'Antwort-vom-Konto' }], usage: {} } };
  yield { type: 'result', subtype: 'success', session_id: 's', is_error: false, usage: {} };
})();

test('alle Konten „unbekannt“, Probe gelingt: der erste Zug wartet auf sie und bekommt ein Konto', async () => {
  const pre = 'ua'; unbekannt(pre);
  const n = { probe: 0, zug: 0 }, s = sink();
  await m.handleTurn({ userId: `u-${randomUUID().slice(0, 6)}`, convId: randomUUID(), token: 'tok-ua-1', prompt: 'hallo', history: '', sink: s, query: fakeQuery(true, n), accounts: async () => KONTEN(pre) } as any);
  assert.doesNotMatch(s.out, /kein Konto frei/);
  assert.match(s.out, /Antwort-vom-Konto/);
  assert.equal(n.zug, 1);
});

test('Probe scheitert: Leads und Chats bekommen keinen Worker-Text, sondern einen passenden Hinweis', async () => {
  const pre = 'ub'; unbekannt(pre);
  const n = { probe: 0, zug: 0 }, s = sink();
  await m.handleTurn({ userId: `u-${randomUUID().slice(0, 6)}`, convId: randomUUID(), token: 'tok-ub-1', prompt: 'hallo', history: '', sink: s, query: fakeQuery(false, n), accounts: async () => KONTEN(pre) } as any);
  assert.equal(n.zug, 0);
  assert.doesNotMatch(s.out, /Worker/);
  assert.match(s.out, /Claude-Konto/);
});
