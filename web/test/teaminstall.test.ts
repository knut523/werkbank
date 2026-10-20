// P5 (Zielbild § 4a, F6): scripts/team-install.sh — nur Adressen aus dem Team, Trockenlauf zeigt den verwalteten Block und
// schreibt nichts (der echte Lauf baut LibreChat und ist für die Testsuite zu schwer).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SKRIPT = join(import.meta.dirname, '..', '..', 'scripts', 'team-install.sh');
const lauf = (...a: string[]) => { const wb = mkdtempSync(join(tmpdir(), 'team-install-')); const r = spawnSync('bash', [SKRIPT, ...a], { encoding: 'utf8', env: { ...process.env, WB_DIR: wb, HOME: wb } }); return { ...r, wb }; };

test('Aufruf: nur Team-Adressen; Trockenlauf zeigt Instanz-Profil team, nur diese Person, Vault nur lesen — und schreibt nichts', () => {
  assert.notEqual(lauf('jemand@example.com').status, 0);
  assert.notEqual(lauf('lisa@maxenergy.at', '--unsinn').status, 0);
  const r = lauf('lisa@maxenergy.at', '--trocken');
  assert.equal(r.status, 0, r.stderr);
  for (const z of ['WERKBANK_INSTANZ=team', 'BRIDGE_ALLOWED_EMAILS=lisa@maxenergy.at', 'WERKBANK_ALLOWED_EMAILS=lisa@maxenergy.at', 'WERKBANK_VAULT_DRYRUN=1', 'WERKBANK_VAULT_SYNC_SCRIPT=/bin/false'])
    assert.ok(r.stdout.includes(z), z);
  assert.equal(existsSync(join(r.wb, '.env.local')), false, 'Trockenlauf schreibt keine .env.local');
});
