// Leitstand (docs/plan-leitstand.md, Plan 132): Knuts Orchestrator-Chat auf der Brücke. Reine Einordnung (Wächter-Tabelle S4,
// Git-Muster, PostHog, orch-Werkzeuge, Strang-Sperren) und Ende-zu-Ende gegen die Brücke im Mock-Modus (Art je Unterhaltung,
// Grenzen, Rückfragen strikt ja/nein, Meldung beantwortet keine Rückfrage, Batch-Kennung, Abmelden, Zusatz-MCP).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { classify, orchestratorBlock, leitstandCheck, parseAnswer, VAULT_DIR } from '../src/tools.ts';
import { wakeBatch, idleToReap } from '../src/sessions.ts';
import { leitstandMcp } from '../src/claudehome.ts';

const PORT = 3294;
const MAIL = 'leit@maxenergy.at', OTHER = 'team@maxenergy.at';
const INTERNAL = 'test-intern-' + randomUUID();
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'leit-roots-')));
const LEIT = join(ROOT, 'knut');
mkdirSync(LEIT);
const VAULT = realpathSync(mkdtempSync(join(tmpdir(), 'vault-leit-')));
const MCPFILE = join(ROOT, 'mcp.json');
writeFileSync(MCPFILE, JSON.stringify({ mcpServers: {
  compartment: { type: 'stdio', command: '~/bin/compartment', args: ['--vault', '~/.compartment/m.vault', 'serve'] },
  posthog: { type: 'http', url: 'https://mcp.posthog.com/mcp', headers: { 'x-posthog-mcp-consumer': 'plugin' } },
  werkbank: { type: 'stdio', command: '/bin/false' },   // reservierter Name: wird nie überschrieben
} }));
let bridge: ChildProcess;
let STATE = '';

before(async () => {
  const state = STATE = mkdtempSync(join(tmpdir(), 'bridge-leit-'));
  bridge = spawn(process.execPath, ['src/server.ts'], {
    env: { ...process.env, BRIDGE_MOCK: '1', BRIDGE_PORT: String(PORT), BRIDGE_STATE_DIR: state, BRIDGE_SKILLS: '',
      BRIDGE_CLAUDE_HOMES: mkdtempSync(join(tmpdir(), 'homes-leit-')), BRIDGE_CLAUDE_CONFIG_SHARED: '', BRIDGE_CLAUDE_CONFIG: '',
      WERKBANK_SKILLS_SOURCE: mkdtempSync(join(tmpdir(), 'skills-leit-')), WERKBANK_INTERNAL_TOKEN: INTERNAL, WERKBANK_URL: 'http://127.0.0.1:9',
      BRIDGE_VAULT_DIR: VAULT, BRIDGE_AUTO_EMAILS: `${MAIL},${OTHER}`, LEITSTAND_EMAILS: MAIL, BRIDGE_ALLOWED_EMAILS: '', WERKBANK_ORCH_ROOTS: ROOT,
      BRIDGE_PERMISSION_MODE: 'auto', BRIDGE_AUTO_SCOPE: 'voll', BRIDGE_MAX_PARALLEL_CHATS: '1', LEITSTAND_MCP_FILE: MCPFILE },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return; } catch { /* startet */ } await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('Brücke startet nicht');
});
after(() => bridge?.kill());

const internal = (path: string, body: unknown) => fetch(`http://127.0.0.1:${PORT}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify(body) });
const state = async (user = 'ul') => (await (await fetch(`http://127.0.0.1:${PORT}/internal/orch-state?user=${user}`, { headers: { 'x-werkbank-internal': INTERNAL } })).json()).strands as any[];
async function send(conv: string, content: string, user = 'ul', email = MAIL) {
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: 'Bearer mock-token', 'content-type': 'application/json', 'x-librechat-user-id': user, 'x-librechat-conversation-id': conv, 'x-librechat-user-email': email },
    body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content }] }),
  });
  return (await res.text()).split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)).choices[0]?.delta?.content ?? '').join('');
}
const tool = (name: string, input: Record<string, unknown>) => `mock-tool ${name} ${JSON.stringify(input)}`;
const opts = async (conv: string, user = 'ul', email = MAIL) => JSON.parse((await send(conv, 'mock-optionen', user, email)).match(/OPTIONEN (\{.*\})/)![1]);

// ---------- Einordnung (rein) ----------

test('Git-Muster für alle Chats (DoD 29/34): globale Optionen vor dem Unterbefehl, refs/heads, keine Fehltreffer', () => {
  const work = mkdtempSync(join(tmpdir(), 'w-'));
  const ctx = { workDir: work, scope: 'voll' as const };
  const c = (command: string) => classify('Bash', { command }, ctx).cls;
  for (const cmd of ['git -C x merge y', 'git -C "a b" merge y', 'git -c k=v merge y', 'git push origin HEAD:refs/heads/main', 'git -C x push origin main',
    'git --no-pager push origin develop', 'git -c http.extraHeader=x push origin master', 'git -C x push --force', 'env A=b git push origin main', 'command git merge x']) {
    assert.equal(c(cmd), 'blocked', cmd);
  }
  for (const cmd of ['git -C x push origin feat/y', 'git -C "a b" push', 'git --git-dir=/r/.git push', 'git push origin main-fix', 'git push origin feature/main']) {
    assert.equal(c(cmd), 'confirm', cmd);
  }
  assert.notEqual(c('git merge-base HEAD origin/dev'), 'blocked', 'merge-base ist kein Merge');
  assert.equal(orchestratorBlock('Bash', { command: 'git merge-base a b' }), null);
  assert.equal(orchestratorBlock('Bash', { command: 'git -C "a b" push' }), 'git push');
});

test('Git-Präfix ohne katastrophales Backtracking: 60× -C prüft in unter 50 ms (Wächter läuft im Brücken-Prozess)', () => {
  const command = 'git ' + '-C '.repeat(60) + 'status';
  const t0 = performance.now();
  classify('Bash', { command }, { workDir: '/w', scope: 'voll' });
  orchestratorBlock('Bash', { command });
  assert.ok(performance.now() - t0 < 50, `${Math.round(performance.now() - t0)} ms`);
  assert.equal(classify('Bash', { command: 'git -C -C push origin main' }, {}).cls, 'blocked', '-C mit Argument „-C“');
  // Review B/C, Befund 1: auch lange Optionen (`--a` war als „-“+„-a“ und „--“+„a“ lesbar) und blankes -c.
  // Council-Diff R1: auch Werte in Anführungszeichen (`"a"` passte als Zitat UND als \S+).
  for (const command of ['git' + ' --a'.repeat(60) + ' x', 'git' + ' -c'.repeat(60) + ' x', 'git' + ' --git-dir'.repeat(60) + ' x',
    'git' + ' -C "a"'.repeat(60) + ' x', 'git' + " -c 'k=v'".repeat(60) + ' x', 'git' + " --git-dir 'a'".repeat(60) + ' x']) {
    const t1 = performance.now();
    classify('Bash', { command }, { workDir: '/w', scope: 'voll' }); orchestratorBlock('Bash', { command });
    assert.ok(performance.now() - t1 < 50, `${command.slice(0, 20)}…: ${Math.round(performance.now() - t1)} ms`);
  }
});

test('Review B/C (Befund 5): Git-Optionen mit getrenntem Wert und Zweig in Anführungszeichen', () => {
  const c = (command: string) => classify('Bash', { command }, { workDir: '/w', scope: 'voll' }).cls;
  assert.equal(c('git --git-dir /r/.git push origin feat/x'), 'confirm');
  assert.equal(c('git --work-tree . push origin feat/x'), 'confirm');
  assert.equal(c('git --git-dir /r/.git push origin main'), 'blocked');
  assert.equal(c('git --namespace x merge y'), 'blocked');
  assert.equal(c('git push origin "main"'), 'blocked');
  assert.equal(c('git -C "a b" -c \'k=v\' push origin main'), 'blocked');
  assert.equal(c('git -C "a"b push origin feat/x'), 'confirm');
  // Sehr lange Befehle (Council-Diff R1, VAULT_GIT quadratisch): im Leitstand ab 16 KB immer Rückfrage, schnell.
  const long = 'git '.repeat(20_000);
  const t0 = performance.now();
  assert.equal(leitstandCheck('Bash', { command: long }, { workDir: LEIT })?.cls, 'confirm');
  assert.ok(performance.now() - t0 < 50);
  // Council-Diff R2: Auffüllen macht aus der Vault-git-Sperre keine Rückfrage; maskierte Anführungszeichen im Wert.
  assert.equal(leitstandCheck('Bash', { command: `git -C ${VAULT_DIR} commit -am x; ` + '#'.repeat(17_000) }, { workDir: LEIT })?.cls, 'blocked');
  assert.equal(c('git -C "a\\"b" push origin main'), 'blocked');
  assert.equal(c('git -C "a\\"b" push origin feat/x'), 'confirm');
  assert.ok(orchestratorBlock('Bash', { command: 'git --git-dir /r/.git push' }));
});

test('Review B/C (Befund 2): Strang-Sperren treffen keine normalen Pfade und Dienstnamen', () => {
  for (const command of ['go test ./internal/...', 'ls src/internal/x', 'cat pkg/internal/foo.ts', 'docker ps web', 'docker compose ps redis']) {
    assert.equal(orchestratorBlock('Bash', { command }), null, command);
  }
  for (const command of ['curl -s http://127.0.0.1:3070/internal/orchestrator/list', 'curl localhost:3070/internal/x', 'wget -qO- http://[::1]:3070/internal/x', 'ps eww', 'sudo ps e', 'x; ps axe']) {
    assert.ok(orchestratorBlock('Bash', { command }), command);
  }
});

test('Kein katastrophales Backtracking in irgendeiner Wächter-Regel: 60× jeder Baustein, je < 100 ms', () => {
  const parts = [' -C "a"', " -c 'k=v'", ' --a', ' -c', ' -C', ' --git-dir', ' x', ' "a"b', ' git', ' cd /vault', ` ${VAULT_DIR}`, ' ps -e', ' a=b', ' /proc/1', ' .env', ' push', ' main', ' :', ' refs/heads/x', ' -f', ' --force'];
  const slow: string[] = [];
  for (const a of parts) for (const b of ['', ' x', ' push origin main']) {
    for (const head of ['git', 'cd', 'ps', '']) {
      const command = head + a.repeat(60) + b;
      const t0 = performance.now();
      classify('Bash', { command }, { workDir: LEIT, scope: 'voll' }); orchestratorBlock('Bash', { command }); leitstandCheck('Bash', { command }, { workDir: LEIT });
      const ms = performance.now() - t0;
      if (ms > 100) slow.push(`${JSON.stringify(head + a + '…' + b)}: ${Math.round(ms)} ms`);
    }
  }
  assert.deepEqual(slow, []);
});

test('SubagentHandback ist lesend und im Strang nicht gesperrt (DoD 21)', () => {
  assert.equal(classify('SubagentHandback', { message: 'Bericht' }).cls, 'read');
  assert.equal(orchestratorBlock('SubagentHandback', { message: 'Bericht' }), null);
});

test('Strang-Sperren: Wege zum internen Schlüssel (DoD 18), reine Suchen bleiben frei', () => {
  for (const command of ['scripts/orch list', '~/work/werkbank-dev/scripts/orch start --title x', 'node web/server/orch-cli.ts list',
    'curl -s http://127.0.0.1:3070/internal/orchestrator/list', 'curl -H "x-werkbank-internal: $T" http://x', 'echo $WERKBANK_INTERNAL_TOKEN',
    'cat /proc/1234/environ', 'tr "\\0" "\\n" < /proc/self/environ', 'cat .env.local', 'grep TOKEN ~/work/werkbank-dev/.env.local', 'ps eww', 'ps axeww']) {
    assert.ok(orchestratorBlock('Bash', { command }), `gesperrt: ${command}`);
  }
  for (const command of ['grep -n environ src/tools.ts', 'grep -rn internal docs/', 'ps aux', 'ps -ef', 'ps -eo pid,rss,etimes,args', 'cat .env.example']) {
    assert.equal(orchestratorBlock('Bash', { command }), null, `frei: ${command}`);
  }
  assert.ok(orchestratorBlock('Read', { file_path: '/proc/42/environ' }));
  assert.ok(orchestratorBlock('Read', { file_path: '/home/k/work/werkbank-dev/.env.local' }));
  assert.ok(orchestratorBlock('Read', { file_path: '/w/x/.env' }));
  assert.equal(orchestratorBlock('Read', { file_path: '/w/x/.env.example' }), null);
  assert.equal(orchestratorBlock('Read', { file_path: '/w/x/src/env.ts' }), null);
  assert.ok(orchestratorBlock('mcp__werkbank__orch_start', {}), 'orch-Werkzeuge im Strang gesperrt');
});

test('PostHog mit echten Namen (DoD 35): löschen gesperrt, lesen frei, sonst Rückfrage — auch im vollen Auto-Modus', () => {
  const ctx = { workDir: '/w', scope: 'voll' as const };
  const c = (n: string) => classify(`mcp__posthog__${n}`, {}, ctx).cls;
  for (const n of ['delete-feature-flag', 'feature-flag-delete', 'dashboard-remove', 'skill-file-delete']) assert.equal(c(n), 'blocked', n);
  for (const n of ['feature-flag-get-all', 'execute-sql', 'read-data-schema', 'skill-list', 'skill-file-get', 'insight-retrieve', 'docs-search']) assert.equal(c(n), 'read', n);
  for (const n of ['feature-flag-update', 'create-feature-flag', 'exec', 'skill-create', 'skill-rename', 'cohort-get-or-create', 'experiment-launch']) assert.equal(c(n), 'confirm', n);
});

test('orch-Werkzeuge (DoD 15): nur im Leitstand; lesen frei, starten/senden/prüfen Klassifikator, Ordner außerhalb → Rückfrage', () => {
  const ctx = { workDir: LEIT, scope: 'voll' as const };
  assert.equal(classify('mcp__werkbank__orch_list', {}, ctx).cls, 'blocked', 'außerhalb des Leitstands');
  assert.equal(classify('mcp__werkbank__orch_start', { cwd: LEIT }, ctx).cls, 'blocked');
  const l = { ...ctx, leit: true };
  for (const n of ['orch_list', 'orch_show', 'orch_questions', 'orch_ask']) assert.equal(classify(`mcp__werkbank__${n}`, {}, l).cls, 'read', n);
  for (const n of ['orch_send', 'orch_review']) assert.equal(classify(`mcp__werkbank__${n}`, { id: 'x' }, l).cls, 'auto', n);
  assert.equal(classify('mcp__werkbank__orch_start', { cwd: join(LEIT, 'wt') }, l).cls, 'auto');
  assert.equal(classify('mcp__werkbank__orch_start', { cwd: '/tmp/x' }, l).cls, 'confirm');
  assert.equal(classify('mcp__werkbank__orch_start', { cwd: 'wt-relativ' }, l).cls, 'auto', 'relativ zum Leitstand-Ordner (Review A)');
  assert.equal(classify('mcp__werkbank__orch_start', { cwd: '../../etc' }, l).cls, 'confirm');
});

test('Leitstand-Wächter S4 (DoD 16/38): Vault-git gesperrt, Live-Instanz/crontab/~/bin/Konfiguration Rückfrage, Ordnergrenzen', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'scratch-'));
  const ctx = { workDir: LEIT, scratch };
  const b = (command: string) => leitstandCheck('Bash', { command }, ctx)?.cls ?? null;
  for (const cmd of [`git -C ${VAULT_DIR} commit -am x`, `cd ${VAULT_DIR} && git add -A && git commit -m x`, `GIT_DIR=${VAULT_DIR}/.git git log`,
    `git --git-dir=${VAULT_DIR}/.git status`, `pushd ${VAULT_DIR}; git commit -am x`, `git --work-tree=${VAULT_DIR} add .`, `rm -rf ${VAULT_DIR}/.git`]) assert.equal(b(cmd), 'blocked', cmd);
  for (const cmd of ['~/work/werkbank-dev/scripts/werkbank.sh restart', 'crontab -e', 'cp x ~/bin/y', 'systemctl --user restart x', 'cat >> ~/.claude/settings.json',
    'echo x > .env', 'echo x > .git/hooks/pre-push', 'git config core.hooksPath /tmp']) assert.equal(b(cmd), 'confirm', cmd);
  for (const cmd of ['npm test', 'git -C ~/work/knut/wt status', `grep -rn x ${VAULT_DIR}/olaf`, 'git commit -m "vault notes"']) assert.equal(b(cmd), null, cmd);
  const f = (file_path: string) => leitstandCheck('Write', { file_path }, ctx)?.cls ?? null;
  assert.equal(f(join(LEIT, 'wt', 'a.ts')), null, 'Arbeitsordner frei');
  assert.equal(f(join(scratch, 'notiz.md')), null, 'Scratch frei');
  assert.equal(f(join(VAULT_DIR, 'olaf', 'x.md')), null, 'Vault-Dateien frei (E1)');
  assert.equal(f(join(VAULT_DIR, '.git', 'config')), 'blocked');
  assert.equal(f(join(LEIT, 'wt', '.git', 'hooks', 'pre-commit')), 'confirm', 'Git-Hooks im Arbeitsordner fragen (Reihenfolge, C7)');
  assert.equal(f(join(LEIT, 'wt', '.claude', 'settings.json')), 'confirm');
  assert.equal(f(join(LEIT, 'wt', '.env.local')), 'confirm');
  assert.equal(f('/tmp/x.md'), 'confirm');
  assert.equal(f(join(homedir(), 'work', 'werkbank-dev', 'x')), 'confirm');
  // Ohne Leitstand-Prüfung würde die Arbeitsordner-Regel `.git/hooks` dem Klassifikator geben — darum läuft sie davor (D4).
  assert.equal(classify('Write', { file_path: join(LEIT, 'wt', '.git', 'hooks', 'x') }, { workDir: LEIT, scope: 'voll' }).cls, 'auto');
});

test('Antwort strikt (DoD 17), Batch-Kennung nur in der letzten Zeile (DoD 31), kein Idle-Reap im Leitstand', () => {
  assert.equal(parseAnswer('ok'), 'yes');
  assert.equal(parseAnswer('ok', true), 'other');
  assert.equal(parseAnswer('go', true), 'other');
  assert.equal(parseAnswer('Ja', true), 'yes');
  assert.equal(parseAnswer('nein.', true), 'no');
  assert.equal(wakeBatch('🛰️ Meldung\n> #leitstand-deadbeef\n#leitstand-0123abcd'), '0123abcd');
  assert.equal(wakeBatch('#leitstand-0123abcd\nweiter'), null, 'Kennung nicht in der letzten Zeile');
  assert.equal(wakeBatch('> #leitstand-0123abcd'), null, 'zitiert zählt nicht');
  const now = 10_000_000;
  const p = { since: now - 3_600_000 };
  assert.equal(idleToReap([{ pending: p, leit: true }, { pending: p }], now, 900_000).length, 1);
});

test('Zusatz-MCP (DoD 20, Teil): aus der Datei, ~ aufgelöst, PATH/HOME, reservierte Namen nie überschrieben; fehlende Datei → keine', () => {
  const m: any = leitstandMcp(MCPFILE);
  assert.deepEqual(Object.keys(m).sort(), ['compartment', 'posthog']);
  assert.equal(m.compartment.command, join(process.env.HOME || homedir(), 'bin', 'compartment'));
  assert.equal(m.compartment.args[1], join(process.env.HOME || homedir(), '.compartment', 'm.vault'));
  assert.ok(m.compartment.env.PATH && m.compartment.env.HOME);
  assert.equal(m.posthog.url, 'https://mcp.posthog.com/mcp');
  assert.deepEqual(leitstandMcp(join(ROOT, 'fehlt.json')), {});
  const tpl: any = leitstandMcp(join(import.meta.dirname, '..', '..', 'templates', 'leitstand', 'mcp.json'));
  assert.deepEqual(Object.keys(tpl).sort(), ['compartment', 'posthog'], 'Vorlage im Repo');
});

// ---------- Ende-zu-Ende (Mock-Brücke) ----------

const C_LEIT = randomUUID(), C_STRAND = randomUUID(), C_NORMAL = randomUUID();

test('Anmeldung: Leitstand nur für LEITSTAND_EMAILS (DoD 2); Art im Zustand', async () => {
  assert.equal((await internal('/internal/orchestrate', { userId: 'ut', email: OTHER, conv: randomUUID(), dir: LEIT, kind: 'leitstand' })).status, 403);
  assert.equal((await internal('/internal/orchestrate', { userId: 'ul', email: MAIL, conv: C_LEIT, dir: LEIT, kind: 'leitstand' })).status, 200);
  const wt = join(ROOT, 'strang'); mkdirSync(wt);
  assert.equal((await internal('/internal/orchestrate', { userId: 'ul', email: MAIL, conv: C_STRAND, dir: wt })).status, 200);
  const st = await state();
  assert.equal(st.find((s) => s.conv === C_LEIT).kind, 'leitstand');
  assert.equal(st.find((s) => s.conv === C_STRAND).kind, 'strand');
});

test('Leitstand ist kein Strang (DoD 3/4/5/20): Grenzen, Systemtext, Monitor gesperrt, Zusatz-MCP, Werkbank-MCP mit WERKBANK_LEITSTAND', async () => {
  const o = await opts(C_LEIT);
  assert.equal(o.maxTurns, 200);
  assert.ok(o.disallowed.includes('Monitor'));
  assert.equal(o.leitstand, true);
  assert.equal(o.strang, false);
  assert.equal(o.gitConfig, false, 'Git mit Knuts Zugangsdaten (E7), anders als im Strang');
  assert.equal(o.werkbankLeit, '1', 'orch-Werkzeuge im Werkbank-MCP');
  assert.ok(o.mcp.includes('compartment') && o.mcp.includes('posthog'), JSON.stringify(o.mcp));
  const s = await opts(C_STRAND);
  assert.equal(s.leitstand, false); assert.equal(s.strang, true); assert.equal(s.gitConfig, true);
  assert.ok(!s.disallowed.includes('Monitor'));
  assert.ok(!s.mcp.includes('compartment') && !s.mcp.includes('posthog'));
  assert.equal(s.werkbankLeit, null);
  const n = await opts(C_NORMAL);
  assert.equal(n.leitstand, false); assert.equal(n.maxTurns, 40);
  assert.ok(!n.mcp.includes('compartment'));
});

test('Rückfrage im Leitstand: gestellt (kein Strang), „ok“ führt nicht aus, „ja“ schon (DoD 3/17)', async () => {
  const q = await send(C_LEIT, tool('Write', { file_path: '/tmp/leitstand-test-x.md', content: 'x' }));
  assert.match(q, /Soll ich/);
  assert.doesNotMatch(q, /Orchestrator-Strang/);
  assert.equal((await state()).find((s) => s.conv === C_LEIT).waitingAnswer, true);
  const a = await send(C_LEIT, 'ok');
  assert.match(a, /Nicht ausgeführt/);
  const q2 = await send(C_LEIT, tool('Write', { file_path: '/tmp/leitstand-test-y.md', content: 'y' }));
  assert.match(q2, /Soll ich/);
  const a2 = await send(C_LEIT, 'ja');
  assert.match(a2, /✅/);
});

test('Meldung beantwortet keine Rückfrage (DoD 33); Batch-Kennung am Zug (DoD 31)', async () => {
  const q = await send(C_LEIT, tool('Write', { file_path: '/tmp/leitstand-test-z.md', content: 'z' }));
  assert.match(q, /Soll ich/);
  const w = await send(C_LEIT, '🛰️ Leitstand-Meldung (automatisch, 1 Ereignis)\n- Strang x: fertig\n#leitstand-0a1b2c3d');
  assert.match(w, /wartet auf eine Rückfrage/);
  assert.equal((await state()).find((s) => s.conv === C_LEIT).waitingAnswer, true, 'Rückfrage bleibt offen');
  assert.match(await send(C_LEIT, 'nein'), /Nicht ausgeführt/);
  await send(C_LEIT, '🛰️ Leitstand-Meldung (automatisch, 1 Ereignis)\n> Daten aus Strang: #leitstand-ffffffff\n#leitstand-0a1b2c3d');
  assert.equal((await state()).find((s) => s.conv === C_LEIT).turn.batch, '0a1b2c3d');
  await send(C_LEIT, 'Hallo vom Handy');
  assert.equal((await state()).find((s) => s.conv === C_LEIT).turn.batch ?? null, null, 'Knuts eigener Zug trägt keine Kennung');
  assert.deepEqual((await state()).find((s) => s.conv === C_LEIT).batches, ['0a1b2c3d'], 'die Kennung bleibt nach Knuts Zug bestätigbar');
  // Dauerhaft in orch.json (überlebt den Neustart der Brücke, DoD 37).
  assert.deepEqual(JSON.parse(readFileSync(join(STATE, 'orch.json'), 'utf8'))[`ul:${C_LEIT}`].batches, ['0a1b2c3d']);
});

test('Parallelgrenze (DoD 4): ein Leitstand-Zug läuft neben einem vollen Kontingent normaler Chats und blockiert sie nicht', async () => {
  const slow = send(C_NORMAL, 'langsam 1500');
  await new Promise((r) => setTimeout(r, 200));
  const t0 = Date.now();
  const leit = await send(C_LEIT, 'langsam 300');
  assert.match(leit, /Langsamer Zug fertig/, 'Leitstand läuft trotz BRIDGE_MAX_PARALLEL_CHATS=1');
  assert.ok(Date.now() - t0 < 1400);
  assert.match(await slow, /Langsamer Zug fertig/);
  const both = await Promise.all([send(C_LEIT, 'langsam 600'), (async () => { await new Promise((r) => setTimeout(r, 100)); return send(randomUUID(), 'langsam 100'); })()]);
  assert.match(both[1], /Langsamer Zug fertig/, 'normaler Chat neben laufendem Leitstand');
});

test('Rückfrage des Leitstands wird nicht von MAX_WAITING verdrängt (DoD 4)', async () => {
  assert.match(await send(C_LEIT, tool('Write', { file_path: '/tmp/leitstand-mw.md', content: 'x' })), /Soll ich/);
  for (let i = 0; i < 6; i++) assert.match(await send(randomUUID(), tool('Write', { file_path: `/tmp/leitstand-mw-${i}.md`, content: 'x' })), /Soll ich/);
  assert.equal((await state()).find((s) => s.conv === C_LEIT).waitingAnswer, true);
  await send(C_LEIT, 'nein');
});

test('Umgehungsprobe über den echten Wächter (D4): Vault-git im Leitstand gesperrt, obwohl der volle Auto-Modus es dem Klassifikator gäbe', async () => {
  const a = await send(C_LEIT, tool('Bash', { command: `git -C ${VAULT} commit -am x` }));
  assert.match(a, /Gesperrt im Pilot: git im Vault/);
  const b = await send(C_LEIT, tool('Write', { file_path: join(LEIT, 'wt', '.git', 'hooks', 'pre-push'), content: 'x' }));
  assert.match(b, /Soll ich/, 'Git-Hook im Arbeitsordner fragt nach');
  await send(C_LEIT, 'nein');
  // Derselbe Befehl in einem normalen Chat geht an den Klassifikator (Mock: erlaubt) — die Sperre gilt nur im Leitstand.
  assert.doesNotMatch(await send(randomUUID(), tool('Bash', { command: `git -C ${VAULT} log` })), /Gesperrt/);
});

test('Verdichtung sichtbar (DoD 6)', async () => {
  assert.match(await send(C_NORMAL, 'mock-verdichten'), /🗜️ Kontext wird verdichtet/);
});

test('Abmelden (DoD 1/27): beendeter Leitstand startet keinen Zug mehr, Zustand „beendet“', async () => {
  assert.equal((await (await internal('/internal/orchestrate/end', { userId: 'ul', conv: C_STRAND })).json()).ok, false, 'nur Leitstände');
  assert.equal((await (await internal('/internal/orchestrate/end', { userId: 'ul', conv: C_LEIT })).json()).ok, true);
  const before = (await state()).find((s) => s.conv === C_LEIT).turn;
  assert.match(await send(C_LEIT, 'mock-optionen'), /Hauptchat ist beendet/);
  const st = (await state()).find((s) => s.conv === C_LEIT);
  assert.equal(st.kind, 'beendet');
  assert.deepEqual(st.turn, before, 'kein neuer Zug');
});
