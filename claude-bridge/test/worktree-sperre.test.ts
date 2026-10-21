// Plan 274 (D4a, D1): höchstens ein Strang je Worktree — die Brücke lehnt Write/Edit in einen Git-Worktree ab, in dem gerade ein
// anderer Strang derselben Person läuft (Vorfall 20.10.: b9b968af und 4c836b73 im selben Rechner-Worktree). Dazu Tiefe „live“.
// In-Prozess gegen handleTurn mit Ersatz-CLI (wie tiefe.test.ts).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const STATE = mkdtempSync(join(tmpdir(), 'bridge-wt-'));
let mod: typeof import('../src/sessions.ts');

before(async () => {
  process.env.BRIDGE_STATE_DIR = STATE;
  process.env.BRIDGE_SKILLS = '';
  process.env.BRIDGE_MOCK = '1';   // Testumgebung: Speicherstand der Box nicht abfragen (sonst wartet der zweite Zug in der Schlange)
  delete process.env.BRIDGE_PERMISSION_MODE;
  mod = await import('../src/sessions.ts');
});

const repo = () => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'bridge-wt-repo-'))); execFileSync('git', ['init', '-q', d]); mkdirSync(join(d, 'src'), { recursive: true }); return d; };

/** Zug mit Ersatz-CLI: merkt die Optionen; hält den Zug offen, bis `los()` gerufen wird. */
function zug(user: string, conv: string) {
  let los!: () => void;
  const offen = new Promise<void>((r) => { los = r; });
  let options: any = null;
  const gesehen = new Promise<any>((r) => {
    const query = ({ prompt, options: o }: any) => (async function* () {
      options = o; r(o);
      if (typeof prompt !== 'string') await prompt[Symbol.asyncIterator]().next();
      yield { type: 'system', subtype: 'init', session_id: `s-${conv}` };
      await offen;
      yield { type: 'result', subtype: 'success', session_id: `s-${conv}`, is_error: false, usage: {} };
    })();
    const closers: (() => void)[] = [];
    const sink = { closed: false, done: false, write() {}, finish() { sink.done = true; sink.closed = true; closers.splice(0).forEach((f) => f()); }, onClose(f: () => void) { closers.push(f); } };
    void mod.handleTurn({ userId: user, convId: conv, token: 'tok-a', prompt: 'los', history: '', sink, query, accounts: async () => [{ id: 'chat', label: 'Chat', token: 'tok-a' }] } as any);
  });
  return { gesehen, los: () => los(), get options() { return options; } };
}

const pruefe = (o: any, file: string) => o.hooks.PreToolUse[0].hooks[0]({ tool_name: 'Write', tool_input: { file_path: file, content: 'x' } }, `t-${randomUUID()}`);

test('fremderWorktree: Datei im Worktree eines anderen laufenden Strangs (cwd oder geschriebene Datei) → dessen Schlüssel', () => {
  const wt = (p: string) => (p.startsWith('/w/a') ? '/w/a' : p.startsWith('/w/b') ? '/w/b' : '/w/paket');
  assert.equal(mod.fremderWorktree('/w/a/src/x.ts', [{ key: 'u:1', dir: '/w/a' }], wt), 'u:1', 'cwd im selben Worktree');
  assert.equal(mod.fremderWorktree('/w/a/src/x.ts', [{ key: 'u:2', dir: '/w/paket/259', written: ['/w/a/web/y.ts'] }], wt), 'u:2', 'Paketordner als cwd, schreibt aber in den Repo-Worktree');
  assert.equal(mod.fremderWorktree('/w/b/z.ts', [{ key: 'u:1', dir: '/w/a' }], wt), null);
  assert.equal(mod.fremderWorktree('/w/a/z.ts', [], wt), null);
});

test('Wächter: zweiter Strang darf nicht in den Worktree schreiben, in dem der erste gerade läuft; im eigenen schon; danach frei', async () => {
  const a = repo(), b = repo();
  const convA = randomUUID(), convB = randomUUID();
  mod.registerOrchestration('u-wt', convA, a, 'strand');
  mod.registerOrchestration('u-wt', convB, b, 'strand');
  const zA = zug('u-wt', convA);
  await zA.gesehen;
  const zB = zug('u-wt', convB);
  try {
    const oB = await zB.gesehen;
    // Ohne Auto-Modus lehnt der Strang Write ohnehin ab (keine Rückfragen) — geprüft wird deshalb der GRUND.
    const grund = (r: any) => String(r.hookSpecificOutput?.permissionDecisionReason ?? '');
    const fremd = await pruefe(oB, join(a, 'src', 'neu.ts'));
    assert.equal(fremd.hookSpecificOutput?.permissionDecision, 'deny', JSON.stringify(fremd));
    assert.match(grund(fremd), /höchstens ein Strang je Worktree/);
    assert.doesNotMatch(grund(await pruefe(oB, join(b, 'src', 'neu.ts'))), /höchstens ein Strang je Worktree/, 'eigener Worktree: keine Worktree-Sperre');
    zA.los();
    await new Promise((r) => setTimeout(r, 200));
    assert.doesNotMatch(grund(await pruefe(oB, join(a, 'src', 'neu.ts'))), /höchstens ein Strang je Worktree/, 'Strang A ist fertig → frei');
  } finally { zA.los(); zB.los(); }
});

test('Tiefe live: wird angenommen, in orch-state sichtbar, ohne Hinweis „Gegenprüfung STANDARDMÄSSIG“ (wie quick)', async () => {
  const conv = randomUUID();
  mod.registerOrchestration('u-live', conv, STATE, 'strand', { tiefe: 'live' as any });
  assert.equal(mod.orchStateOf('u-live').find((x) => x.conv === conv)!.tiefe, 'live');
  assert.ok(mod.TIEFEN.includes('live' as any));
  const z = zug('u-live', conv);
  const o = await z.gesehen;
  assert.doesNotMatch(o.systemPrompt.append, /Gegenprüfung: In plan-to-pr/);
  z.los();
});
