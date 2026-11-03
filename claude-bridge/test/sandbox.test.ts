// Sandbox Stufe 1 für Unter-Chats (Paket 436, Nachtrag 7 / Plan E13, S19): jeder Zugriffsversuch läuft zweimal —
// mit der Umgebung der Brücke (Köder greifbar: Kontrolle) und mit der Umgebung eines Unter-Chats (muss scheitern).
// Nur Köder in Wegwerf-Ordnern; echte Zugangsdaten werden nie angefasst.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sandbox-koeder-'));
process.env.BRIDGE_STATE_DIR = join(dir, 'state');
const { strangSandbox } = await import('../src/sandbox.ts');
const { orchGitEnv } = await import('../src/sessions.ts');

const GEHEIM = 'KOEDER-' + Math.random().toString(36).slice(2);
// Köder: ein laufender ssh-agent, ein Git-Credential-Store mit Passwort, eine Vaultwarden-Sitzung, ein GitHub-Token
const agent = execFileSync('ssh-agent', ['-s', '-a', join(dir, 'agent.sock')], { encoding: 'utf8' });
const agentPid = /SSH_AGENT_PID=(\d+)/.exec(agent)![1];
after(() => { try { process.kill(Number(agentPid)); } catch { /* schon weg */ } });
writeFileSync(join(dir, 'creds'), `https://agent:${GEHEIM}@github.com\n`);
writeFileSync(join(dir, 'gitconfig'), `[credential]\n\thelper = store --file ${join(dir, 'creds')}\n`);
const bruecke: Record<string, string | undefined> = {
  PATH: process.env.PATH, HOME: dir,
  SSH_AUTH_SOCK: join(dir, 'agent.sock'), SSH_AGENT_PID: agentPid,
  GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'), BW_SESSION: GEHEIM, GH_TOKEN: GEHEIM, GITHUB_TOKEN: GEHEIM,
};
const strang = () => { const e = { ...bruecke }; strangSandbox(e, { stateDir: process.env.BRIDGE_STATE_DIR!, leseToken: null }); orchGitEnv(e); return e; };
const lauf = (env: Record<string, string | undefined>, cmd: string, input?: string) => spawnSync('bash', ['-c', cmd], { env: env as NodeJS.ProcessEnv, input, encoding: 'utf8', timeout: 10_000 });

test('SSH-Agent: mit Brücken-Umgebung erreichbar (Kontrolle), im Unter-Chat nicht', () => {
  assert.equal(lauf(bruecke, 'ssh-add -l').status, 1, 'Kontrolle: Agent antwortet (keine Schlüssel = 1)');
  const r = lauf(strang(), 'ssh-add -l');
  assert.equal(r.status, 2, `Unter-Chat: keine Verbindung zum Agenten (2), war ${r.status}: ${r.stderr}`);
});

test('Git-Credential-Helfer: Kontrolle liefert das Köder-Passwort, im Unter-Chat kommt nichts', () => {
  const frage = 'protocol=https\nhost=github.com\n\n';
  assert.match(lauf(bruecke, 'git credential fill', frage).stdout, new RegExp(GEHEIM), 'Kontrolle');
  const r = lauf(strang(), 'git credential fill', frage);
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stdout + r.stderr, new RegExp(GEHEIM));
});

test('Eingeschleuster Helfer über GIT_CONFIG_PARAMETERS/GIT_CONFIG_COUNT: Kontrolle liefert das Köder-Passwort, im Unter-Chat nichts (Pass C)', () => {
  const frage = 'protocol=https\nhost=github.com\n\n';
  const helfer = `store --file ${join(dir, 'creds')}`;
  const ein = { ...bruecke, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_PARAMETERS: `'credential.helper'='${helfer}'` };
  assert.match(lauf(ein, 'git credential fill', frage).stdout, new RegExp(GEHEIM), 'Kontrolle PARAMETERS');
  const zwei = { ...bruecke, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: helfer };
  assert.match(lauf(zwei, 'git credential fill', frage).stdout, new RegExp(GEHEIM), 'Kontrolle COUNT');
  for (const e of [ein, zwei]) {
    const s = { ...e, DBUS_SESSION_BUS_ADDRESS: 'unix:path=/tmp/koeder-bus' };
    strangSandbox(s, { stateDir: process.env.BRIDGE_STATE_DIR!, leseToken: null }); orchGitEnv(s);
    const r = lauf(s, 'git credential fill', frage);
    assert.doesNotMatch(r.stdout + r.stderr, new RegExp(GEHEIM));
    assert.equal(s.DBUS_SESSION_BUS_ADDRESS, undefined, 'kein Weg zum Schlüsselbund');
  }
});

test('GitHub-Token: im Unter-Chat weder in der Umgebung noch über die gh-Anmeldung (leere Konfiguration)', () => {
  const e = strang();
  assert.equal(e.GH_TOKEN, undefined); assert.equal(e.GITHUB_TOKEN, undefined);
  assert.deepEqual(readdirSync(e.GH_CONFIG_DIR!), [], 'leere gh-Konfiguration');
  const r = lauf(e, 'gh auth token');
  assert.notEqual(r.status, 0, 'gh hat keine Anmeldung');
  assert.doesNotMatch(r.stdout, new RegExp(GEHEIM));
  const l = { ...bruecke }; strangSandbox(l, { stateDir: process.env.BRIDGE_STATE_DIR!, leseToken: 'nur-lesen' });
  assert.equal(l.GH_TOKEN, 'nur-lesen', 'nur das Lesetoken kommt durch');
});

test('Vaultwarden-Sitzung und SSH-Schlüssel für Git: im Unter-Chat weg bzw. abgeschaltet', () => {
  const e = strang();
  assert.equal(lauf(e, 'printf %s "${BW_SESSION-}"').stdout, '');
  assert.match(e.GIT_SSH_COMMAND!, /IdentityFile=none/); assert.match(e.GIT_SSH_COMMAND!, /IdentityAgent=none/);
  assert.equal(lauf(e, 'git config --get credential.helper').stdout.trim(), '', 'kein Helfer konfiguriert');
});
