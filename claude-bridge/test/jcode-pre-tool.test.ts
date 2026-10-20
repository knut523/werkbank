// Release 20a (Nachtrag zu Fix 17e): der pre_tool-Hook der jcode-Worker / melious_sub sperrt Umgebungs- und Zugangsdateien für jedes
// Werkzeug (nicht nur die Shell) und Schreiben außerhalb des Arbeitsordners; der echte Hook-Aufruf (Exit 2 + Grund) über das Wrapper-Skript.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jcodeEntscheid } from '../src/jcode-pre-tool.ts';

const WT = '/home/x/work/wt';
const P = ['/pr', 'oc/'].join('');            // Pfade zusammengesetzt, damit der Text der Datei selbst keine Sperrmuster trägt
const ENV = ['env', 'iron'].join('');
test('Lesen: Umgebung, Prozess-Dateisystem und Schlüssel gesperrt — in jeder Schreibweise und für jedes Werkzeug', () => {
  const faelle: [string, unknown][] = [
    ['read', { file_path: '/home/knut/work/werkbank-dev/.env.local' }], ['read', { file_path: '.env' }], ['read', { file_path: 'librechat/.env' }],
    ['read', { file_path: `${P}self/${ENV}` }], ['read', { file_path: `${P}1234/${ENV}` }], ['agentgrep', { pattern: 'KEY', path: '/home/knut/work/werkbank-dev/.env.local' }],
    ['bash', { command: 'cat ~/work/werkbank-dev/.env.local' }], ['bash', { command: `cat /pr''oc/self/env"i"ron` }], ['read', { file_path: '/home/knut/.claude/.credentials.json' }],
    ['read', { file_path: '/home/knut/.melious/credentials.json' }], ['read', { file_path: '/home/knut/.jcode/auth.json' }], ['read', { file_path: '/home/knut/.ssh/id_ed25519' }],
    ['read', { file_path: '/home/knut/work/werkbank-dev/.runtime/werkbank.creds' }],
  ];
  for (const [tool, input] of faelle) assert.match(jcodeEntscheid(tool, input, WT) ?? 'ERLAUBT', /Abgelehnt/, `${tool} ${JSON.stringify(input)}`);
});
test('Normales Lesen bleibt erlaubt (Vault, Repo, Doku)', () => {
  const faelle: [string, unknown][] = [['read', { file_path: '/vault/olaf/2-Areas/x.md' }], ['read', { file_path: 'src/main.ts' }], ['agentgrep', { pattern: 'environment', path: 'src' }],
    ['bash', { command: 'git log --oneline -5' }], ['read', { file_path: 'docs/env-setup.md' }]];
  for (const [tool, input] of faelle) assert.equal(jcodeEntscheid(tool, input, WT), null, `${tool} ${JSON.stringify(input)}`);
});
test('Schreiben nur im Arbeitsordner', () => {
  assert.equal(jcodeEntscheid('write', { file_path: 'a/b.ts', content: 'x' }, WT), null);
  assert.equal(jcodeEntscheid('edit', { file_path: `${WT}/c.ts`, old_string: 'a', new_string: 'b' }, WT), null);
  assert.match(jcodeEntscheid('write', { file_path: '../other/x.ts', content: 'x' }, WT)!, /nur im Arbeitsordner/);
  assert.match(jcodeEntscheid('write', { file_path: '/home/x/work/wt-evil/x.ts', content: 'x' }, WT)!, /nur im Arbeitsordner/, 'Präfix ohne Trennzeichen zählt nicht');
  assert.match(jcodeEntscheid('write', { content: 'x' }, WT)!, /ohne Pfad/);
});
test('Echter Hook-Aufruf über das Wrapper-Skript: Exit 2 mit Grund, Exit 0 bei Erlaubtem, kaputte Eingabe gesperrt', () => {
  const hook = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks', 'jcode-pre-tool');
  const lauf = (tool: string, input: unknown, payload?: string) => spawnSync(hook, [], { encoding: 'utf8', env: { PATH: process.env.PATH, JCODE_HOOK_EVENT: 'pre_tool', JCODE_HOOK_TOOL_NAME: tool, JCODE_HOOK_CWD: WT,
    JCODE_HOOK_PAYLOAD: payload ?? JSON.stringify({ cwd: WT, event: 'pre_tool', tool_name: tool, tool_input: JSON.stringify(input) }) } });
  const nein = lauf('read', { file_path: '/home/knut/work/werkbank-dev/.env.local' });
  assert.equal(nein.status, 2); assert.match(nein.stderr, /Werkbank-Wächter/);
  assert.equal(lauf('read', { file_path: 'src/main.ts' }).status, 0);
  assert.equal(lauf('read', {}, '{kaputt').status, 2);
});
