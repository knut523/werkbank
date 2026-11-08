// Busy-Prüfung: zwei Nachrichten derselben Unterhaltung, während die Kontenliste noch lädt, dürfen nicht beide einen Zug starten.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

process.env.BRIDGE_STATE_DIR = mkdtempSync(join(tmpdir(), 'busy-rennen-'));
process.env.BRIDGE_SKILLS = '';
const m = await import('../src/sessions.ts');

const sink = () => { let out = ''; const c: (() => void)[] = []; const s: any = { closed: false, done: false, write(t: string) { out += t; }, finish() { s.done = true; s.closed = true; c.splice(0).forEach((f) => f()); }, onClose(f: () => void) { c.push(f); }, get out() { return out; } }; return s; };

test('zwei Nachrichten auf denselben Schlüssel während req.accounts lädt: genau ein Zug, der andere bekommt „arbeitet noch“', async () => {
  let laeufe = 0;
  const query = () => (async function* () {
    laeufe++;
    await new Promise((r) => setTimeout(r, 300));
    yield { type: 'assistant', session_id: 's', parent_tool_use_id: null, message: { model: 'm', content: [{ type: 'text', text: 'fertig' }], usage: {} } };
    yield { type: 'result', subtype: 'success', session_id: 's', is_error: false, usage: {} };
  })();
  const accounts = async () => { await new Promise((r) => setTimeout(r, 60)); return [{ id: 'chat', label: 'Chat', token: 'tok-rennen' }]; };
  const conv = randomUUID(), user = `u-${randomUUID().slice(0, 6)}`;
  const s1 = sink(), s2 = sink();
  const req = (s: any, prompt: string) => ({ userId: user, convId: conv, token: 'tok-rennen', prompt, history: '', sink: s, query, accounts } as any);
  await Promise.all([m.handleTurn(req(s1, 'eins')), m.handleTurn(req(s2, 'zwei'))]);
  assert.equal(laeufe, 1, 'nur ein CLI-Lauf');
  const busy = [s1, s2].filter((s) => /arbeitet noch/.test(s.out));
  assert.equal(busy.length, 1, 'genau einer bekommt die Busy-Antwort');
  assert.equal([s1, s2].filter((s) => /fertig/.test(s.out)).length, 1);
});
