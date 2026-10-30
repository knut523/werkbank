// R29 D: Vault-Pflege im Hauptchat — Regel 9 des Vaults verlangt nach jeder Schreibsitzung `git add -A && git commit`.
// Bisher ist git im Vault im Hauptchat immer gesperrt. Mit BRIDGE_LEIT_VAULT_COMMIT=on wird genau diese Form zur Rückfrage mit Karte
// (Ja/Nein), alles andere im Vault-git bleibt gesperrt (push, reset, checkout, rebase, config …). Vorgabe aus.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { leitstandCheck, VAULT_DIR } from '../src/tools.ts';

const V = VAULT_DIR;
const chk = (cmd: string) => leitstandCheck('Bash', { command: cmd }, { workDir: '/tmp/w' });
afterEach(() => { delete process.env.BRIDGE_LEIT_VAULT_COMMIT; });

test('aus (Vorgabe): git im Vault bleibt gesperrt, auch add/commit', () => {
  assert.equal(chk(`git -C ${V} add -A && git -C ${V} commit -m "pflege"`)?.cls, 'blocked');
});

test('an: add + commit mit einfacher Nachricht → Rückfrage statt Sperre', () => {
  process.env.BRIDGE_LEIT_VAULT_COMMIT = 'on';
  for (const cmd of [
    `git -C ${V} add -A && git -C ${V} commit -m "olaf: Sprint-Notiz"`,
    `git -C ${V} add olaf/1-Projects/x.md`,
    `git -C ${V} commit -m 'vault: pflege'`,
    `git -C ${V} status --short`,
  ]) assert.equal(chk(cmd)?.cls, 'confirm', cmd);
});

test('an: alles andere im Vault-git bleibt gesperrt', () => {
  process.env.BRIDGE_LEIT_VAULT_COMMIT = 'on';
  for (const cmd of [
    `git -C ${V} push`, `git -C ${V} reset --hard`, `git -C ${V} checkout main`, `git -C ${V} rebase -i HEAD~3`,
    `git -C ${V} config user.name x`, `git -C ${V} commit -m "x" --no-verify`, `git -C ${V} commit -m "$(rm -rf /)"`,
    `git -C ${V} add -A && git -C ${V} push`, `git -C ${V} commit -m "a" ; rm -rf ${V}`,
    `git -C ${V} commit --amend -m "x"`, `git -C ${V}/../etc add -A`,
  ]) assert.equal(chk(cmd)?.cls, 'blocked', cmd);
});
