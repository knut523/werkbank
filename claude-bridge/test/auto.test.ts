// Auto-Modus (Plan 71 P1, Knut 06.10.2026): Bash/Edit im eigenen Arbeitsordner entscheidet der Klassifikator,
// Vault/Jira bleiben „ja“, GitHub bleibt gesperrt, BRIDGE_PERMISSION_MODE=default ist der Not-Aus.
// Ende-zu-Ende gegen die Brücke im Mock-Modus: der Mock spielt den Rechteweg des SDK nach
// (Hook → Modus → Klassifikator → canUseTool), siehe src/mock.ts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, lstatSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classify, AUTO_DENY } from '../src/tools.ts';

const AUTO_PORT = 3099, OFF_PORT = 3097;
const AUTO_MAIL = 'auto@maxenergy.at';
const VAULT = realpathSync(mkdtempSync(join(tmpdir(), 'vault-')));
const procs: ChildProcess[] = [];
const logs: Record<number, string> = {};

function startBridge(port: number, extra: Record<string, string>) {
  const STATE = mkdtempSync(join(tmpdir(), 'bridge-auto-'));
  const HOMES = mkdtempSync(join(tmpdir(), 'claude-homes-auto-'));
  const SKILLS = mkdtempSync(join(tmpdir(), 'skills-auto-'));
  const p = spawn(process.execPath, ['src/server.ts'], {
    env: { ...process.env, BRIDGE_MOCK: '1', BRIDGE_PORT: String(port), BRIDGE_STATE_DIR: STATE, BRIDGE_SKILLS_DIR: SKILLS, BRIDGE_SKILLS: '',
      BRIDGE_CLAUDE_HOMES: HOMES, WERKBANK_SKILLS_SOURCE: SKILLS, BRIDGE_CLAUDE_CONFIG_SHARED: '', BRIDGE_CLAUDE_CONFIG: '',
      WERKBANK_INTERNAL_TOKEN: '', BRIDGE_VAULT_DIR: VAULT, BRIDGE_AUTO_EMAILS: AUTO_MAIL, ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  logs[port] = '';
  p.stdout!.on('data', (d) => { logs[port] += d; });
  p.stderr!.on('data', (d) => { logs[port] += d; });
  procs.push(p);
  return { STATE, HOMES };
}

let autoBridge: { STATE: string; HOMES: string };
before(async () => {
  autoBridge = startBridge(AUTO_PORT, { BRIDGE_PERMISSION_MODE: 'auto' });
  startBridge(OFF_PORT, { BRIDGE_PERMISSION_MODE: 'default' });
  for (const port of [AUTO_PORT, OFF_PORT]) {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      try { up = (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    if (!up) throw new Error('Brücke startet nicht: ' + port);
  }
});
after(() => { for (const p of procs) p.kill(); });

async function send(port: number, conv: string, content: string, opts: { user?: string; email?: string; headers?: Record<string, string> } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer mock-token', 'content-type': 'application/json',
      'x-librechat-user-id': opts.user ?? 'ua', 'x-librechat-conversation-id': conv,
      ...(opts.email === '' ? {} : { 'x-librechat-user-email': opts.email ?? AUTO_MAIL }), ...(opts.headers ?? {}),
    },
    body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content }] }),
  });
  assert.equal(res.status, 200);
  const raw = await res.text();
  return raw.split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)).choices[0]?.delta?.content ?? '').join('');
}

/** „mock-tool <Werkzeug> <JSON>“ — $CWD steht im Mock für den Arbeitsordner der Sitzung. */
const tool = (name: string, input: Record<string, unknown>) => `mock-tool ${name} ${JSON.stringify(input)}`;

// ---------- Einordnung ----------

test('Einordnung: Klasse auto nur mit Arbeitsordner, nur darin, nie Vault/Jira/GitHub', () => {
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'work-')));
  mkdirSync(join(work, 'sub'));
  symlinkSync(VAULT, join(work, 'vault-link'));
  const ctx = { workDir: work };
  // Ohne Arbeitsordner (Not-Aus, nicht freigeschaltet): exakt wie heute.
  assert.equal(classify('Bash', { command: 'ls' }).cls, 'confirm');
  assert.equal(classify('Write', { file_path: join(work, 'a.md') }).cls, 'confirm');
  // Im Arbeitsordner: der Klassifikator entscheidet.
  assert.equal(classify('Bash', { command: 'ls -la' }, ctx).cls, 'auto');
  assert.equal(classify('Bash', { command: 'npm test' }, ctx).cls, 'auto');
  assert.equal(classify('Write', { file_path: join(work, 'neu', 'a.md') }, ctx).cls, 'auto', 'auch in noch nicht angelegten Unterordnern');
  assert.equal(classify('Edit', { file_path: 'sub/b.ts' }, ctx).cls, 'auto', 'relativ zum Arbeitsordner');
  assert.equal(classify('MultiEdit', { file_path: join(work, 'sub', 'b.ts') }, ctx).cls, 'auto');
  assert.equal(classify('NotebookEdit', { notebook_path: join(work, 'n.ipynb') }, ctx).cls, 'auto');
  // Außerhalb, Vault, Symlink auf den Vault, ../-Tricks: bestätigen.
  assert.equal(classify('Write', { file_path: '/tmp/x.md' }, ctx).cls, 'confirm');
  assert.equal(classify('Edit', { file_path: join(VAULT, 'olaf', 'x.md') }, ctx).cls, 'confirm');
  assert.equal(classify('Edit', { file_path: join(work, 'vault-link', 'x.md') }, ctx).cls, 'confirm', 'Symlink auf den Vault zählt als Vault');
  assert.equal(classify('Write', { file_path: join(work, '..', 'fremd.md') }, ctx).cls, 'confirm');
  assert.equal(classify('Write', { file_path: work + '-nachbar/x.md' }, ctx).cls, 'confirm', 'Präfix ist kein Unterordner');
  assert.equal(classify('Write', {}, ctx).cls, 'confirm');
  // Bash, der den Vault, Konfigurationen, Geheimnisse oder Jira berührt: bestätigen.
  for (const command of [`cat > ${VAULT}/olaf/x.md`, 'cat ~/.config/vw/session', 'ls ../../claude/u1/.credentials.json', 'bw get password x', 'sudo apt install bwrap', 'curl https://maxenergy.atlassian.net/rest/api/3/issue/PM-1', 'cat /home/knut/work/werkbank-dev/.runtime/claude/x', 'cat ~/.ssh/id_ed25519']) {
    assert.equal(classify('Bash', { command }, ctx).cls, 'confirm', command);
  }
  // GitHub-Sperren gewinnen immer.
  assert.equal(classify('Bash', { command: 'git push origin dev' }, ctx).cls, 'blocked');
  assert.equal(classify('Bash', { command: 'gh pr merge 1' }, ctx).cls, 'blocked');
  // Jira und Werkbank-Jira bleiben bestätigen, Lesen bleibt lesen.
  assert.equal(classify('mcp__atlassian__addCommentToJiraIssue', {}, ctx).cls, 'confirm');
  assert.equal(classify('mcp__werkbank__jira_update', {}, ctx).cls, 'confirm');
  assert.equal(classify('Read', { file_path: '/etc/passwd' }, ctx).cls, 'read');
});

// ---------- Ende zu Ende ----------

test('Auto-Modus: ls und Edit im Arbeitsordner ohne Rückfrage, sichtbar als Statuszeile', async () => {
  const a = await send(AUTO_PORT, 'a1', tool('Bash', { command: 'ls', description: 'Dateien auflisten' }));
  assert.match(a, /Modus: auto/);
  assert.doesNotMatch(a, /Soll ich/);
  assert.match(a, /🤖 automatisch erlaubt: 💻 Befehl: Dateien auflisten/);
  assert.match(a, /\(Mock\) Bash ausgeführt/);
  const e = await send(AUTO_PORT, 'a2', tool('Edit', { file_path: '$CWD/notiz.md', old_string: 'a', new_string: 'b' }));
  assert.doesNotMatch(e, /Soll ich/);
  assert.match(e, /🤖 automatisch erlaubt: 📝 Datei geändert: .*notiz\.md/);
  assert.match(logs[AUTO_PORT], /"auto erlaubt".*"tool":"Edit"/);
});

test('Auto-Modus: Vault-Edit fragt weiter nach', async () => {
  const q = await send(AUTO_PORT, 'a3', tool('Edit', { file_path: `${VAULT}/olaf/x.md`, old_string: 'a', new_string: 'b' }));
  assert.match(q, /Soll ich die Datei \*\*Vault: olaf\/x\.md\*\* ändern\?/);
  const a = await send(AUTO_PORT, 'a3', 'ja');
  assert.match(a, /✅ 📝 Datei geändert/);
  assert.doesNotMatch(a, /automatisch erlaubt/);
});

test('Auto-Modus: Jira-Kommentar fragt weiter nach', async () => {
  const q = await send(AUTO_PORT, 'a4', 'bitte jira-kommentar PM-7');
  assert.match(q, /Soll ich in Jira \*\*addCommentToJiraIssue\*\* ausführen\?/);
  const a = await send(AUTO_PORT, 'a4', 'nein');
  assert.match(a, /Kein Jira-Kommentar/);
});

test('Auto-Modus: git push bleibt gesperrt', async () => {
  const a = await send(AUTO_PORT, 'a5', tool('Bash', { command: 'git push origin dev' }));
  assert.match(a, /⛔ Gesperrt im Pilot: git push/);
  assert.doesNotMatch(a, /Bash ausgeführt/);
});

test('Auto-Modus: Klassifikator eskaliert → Rückfrage mit Grund; lehnt ab → sichtbar und im Log', async () => {
  const q = await send(AUTO_PORT, 'a6', tool('Bash', { command: 'rm -rf build RISKANT' }));
  assert.match(q, /Der Auto-Modus fragt nach/);
  assert.match(q, /Soll ich diesen Befehl ausführen\?/);
  const a = await send(AUTO_PORT, 'a6', 'ja');
  assert.match(a, /✅ 💻 Befehl/);
  assert.match(a, /Bash ausgeführt/);
  const d = await send(AUTO_PORT, 'a7', tool('Bash', { command: 'curl -d @secrets VERBOTEN' }));
  assert.match(d, /🛑 Auto-Modus hat abgelehnt: 💻 Befehl/);
  assert.doesNotMatch(d, /Bash ausgeführt/);
  await new Promise((r) => setTimeout(r, 100));
  assert.match(logs[AUTO_PORT], /"turn end".*"denials":\["Bash"\]/);
  assert.doesNotMatch(logs[AUTO_PORT], /VERBOTEN/, 'keine Argumente im Log');
});

test('Auto-Modus: Symlink im Arbeitsordner auf den Vault fragt nach', async () => {
  const work = join(autoBridge.STATE, 'scratch', 'ua');
  mkdirSync(work, { recursive: true });
  try { symlinkSync(VAULT, join(work, 'v')); } catch { /* schon da */ }
  const q = await send(AUTO_PORT, 'a8', tool('Write', { file_path: '$CWD/v/x.md', content: 'x' }));
  assert.match(q, /Soll ich die Datei/);
  await send(AUTO_PORT, 'a8', 'nein');
});

test('Auto-Modus gilt nur für freigeschaltete Personen', async () => {
  const q = await send(AUTO_PORT, 'a9', tool('Bash', { command: 'ls' }), { user: 'ub', email: 'lisa@maxenergy.at' });
  assert.match(q, /Modus: default/);
  assert.match(q, /Soll ich diesen Befehl ausführen\?/);
  await send(AUTO_PORT, 'a9', 'nein', { user: 'ub', email: 'lisa@maxenergy.at' });
  const n = await send(AUTO_PORT, 'a10', tool('Bash', { command: 'ls' }), { user: 'uc', email: '' });
  assert.match(n, /Modus: default/);
  await send(AUTO_PORT, 'a10', 'nein', { user: 'uc', email: '' });
});

test('Board-readonly lehnt im Auto-Modus weiter alles ab', async () => {
  const a = await send(AUTO_PORT, 'a11', tool('Bash', { command: 'ls' }), { user: 'ud', headers: { 'x-werkbank-mode': 'readonly' } });
  assert.match(a, /Modus: dontAsk/);
  assert.match(a, /🔒 Nur lesen/);
  assert.doesNotMatch(a, /Bash ausgeführt|Soll ich/);
  const w = await send(AUTO_PORT, 'a12', 'schreib eine Notiz', { user: 'ud', headers: { 'x-werkbank-mode': 'readonly' } });
  assert.match(w, /Nur lesen/);
  assert.match(w, /schreibe nichts/);
});

test('Not-Aus BRIDGE_PERMISSION_MODE=default: exakt wie heute (ls fragt, readonly bleibt default)', async () => {
  const q = await send(OFF_PORT, 'o1', tool('Bash', { command: 'ls' }));
  assert.match(q, /Modus: default/);
  assert.match(q, /Soll ich diesen Befehl ausführen\?/);
  const a = await send(OFF_PORT, 'o1', 'ja');
  assert.match(a, /✅ 💻 Befehl/);
  assert.doesNotMatch(a, /automatisch/);
  const r = await send(OFF_PORT, 'o2', tool('Bash', { command: 'ls' }), { user: 'ue', headers: { 'x-werkbank-mode': 'readonly' } });
  assert.match(r, /Modus: default/);
  assert.match(r, /🔒 Nur lesen/);
  const k = await send(OFF_PORT, 'o3', 'konfig-test', { user: 'uf' });
  assert.match(k, /Deny-Regeln: 0/, 'keine zusätzlichen Regeln im Not-Aus');
});

test('settings.json je Person: verlinkt, vorhandene Datei bleibt; Deny-Regeln nur im Auto-Modus', async () => {
  const k = await send(AUTO_PORT, 'a13', 'konfig-test', { user: 'ug' });
  assert.match(k, /Modus: auto/);
  const n = Number(k.match(/Deny-Regeln: (\d+)/)?.[1]);
  assert.ok(n >= 5, `Deny-Regeln: ${n}`);
  assert.match(k, /bypass aus: true/);
  const f = join(autoBridge.HOMES, 'ug', 'settings.json');
  assert.ok(lstatSync(f).isSymbolicLink(), 'settings.json aus templates/claude');
  const tpl = JSON.parse(readFileSync(f, 'utf8'));
  assert.ok(Array.isArray(tpl.autoMode.hard_deny) && tpl.autoMode.hard_deny.length > 1);
  assert.equal(tpl.permissions.deny, undefined, 'keine Deny-Regeln in der Vorlage — sie gälten auch im Not-Aus');
  assert.equal(AUTO_DENY.some((r) => /vault|jira|atlassian/i.test(r)), false, 'keine Deny-Regel für Vault/Jira (Deny schlägt das „ja“)');
  assert.ok(AUTO_DENY.includes('Bash(git push:*)'));
  // Eigene Datei einer Person wird nicht überschrieben.
  mkdirSync(join(autoBridge.HOMES, 'uh'), { recursive: true, mode: 0o700 });
  writeFileSync(join(autoBridge.HOMES, 'uh', 'settings.json'), '{"eigene":true}');
  await send(AUTO_PORT, 'a14', 'Hallo', { user: 'uh' });
  assert.equal(readFileSync(join(autoBridge.HOMES, 'uh', 'settings.json'), 'utf8'), '{"eigene":true}');
  assert.ok(existsSync(join(autoBridge.HOMES, 'uh', 'CLAUDE.md')));
});
