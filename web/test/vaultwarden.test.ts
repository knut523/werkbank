// Hauptsitzung 06.11. (Knut: „U have the melious key in the vault just connect it to the vault“): gemeinsame Hilfsfunktion
// bwSecret (aus dem GitHub-Lesetoken herausgelöst); GitHub verhält sich unverändert; Melious-Schlüssel der Reihenfolge
// gespeichert → Env → Vaultwarden (nur Knuts Konto), „erlaubt“ bleibt aus, bis jemand es einschaltet; nie im Klartext ausgegeben.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const R = mkdtempSync(join(tmpdir(), 'vault-'));
const LOG = join(R, 'aufrufe');
const SCHLUESSEL = `sk-mel-${'k'.repeat(30)}wxyz`;
// Nachbau von bw: `bw get item <name>` → JSON mit login.password; zählt die Aufrufe; prüft BW_SESSION.
writeFileSync(join(R, 'bw'), `#!/usr/bin/env node
const fs = require('fs'), item = process.argv[4];
fs.appendFileSync(${JSON.stringify(LOG)}, item + '\\n');
if (process.env.BW_SESSION !== 'sitzung-test') process.exit(1);
const w = { 'View only github API': 'token: ghp_LESEtest123', 'melious ai API Key': 'Schlüssel ${SCHLUESSEL}', 'leer': 'nichts' }[item];
if (!w) process.exit(4);
console.log(JSON.stringify({ login: { password: w } }));
`);
chmodSync(join(R, 'bw'), 0o755);
writeFileSync(join(R, 'session'), 'sitzung-test\n');
process.env.WERKBANK_BW_BIN = join(R, 'bw');
process.env.WERKBANK_VW_SESSION_DATEI = join(R, 'session');
process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_vault_test_${randomBytes(4).toString('hex')}`;
process.env.WERKBANK_CREDS_KEY = randomBytes(32).toString('hex');
process.env.WERKBANK_PILOT_EMAIL = 'knut@maxenergy.at';
for (const k of ['WERKBANK_GITHUB_TOKEN', 'MELIOUS_API_KEY', 'WERKBANK_MELIOUS_BW_ITEM', 'MELIOUS_STANDARD']) delete process.env[k];

const { connect } = await import('../server/db.ts');
const V = await import('../server/vaultwarden.ts');
const C = await import('../server/creds.ts');
const M = await import('../server/melious.ts');
let client: any;
before(async () => { client = await connect(); });
after(async () => { await client.db(process.env.WERKBANK_DB).dropDatabase(); await client.close(); });
const aufrufe = () => (existsSync(LOG) ? readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean) : []);

test('bwSecret: Muster aus dem Passwortfeld, 10 min im Speicher, ohne Sitzung oder ohne Treffer null', async () => {
  assert.equal(await V.bwSecret('leer', /sk-mel-\S+/), null);
  assert.equal(await V.bwSecret('fehlt', /x/), null);
  assert.equal(await V.bwSecret('melious ai API Key', /sk-mel-[\w-]+/), SCHLUESSEL);
  const n = aufrufe().length;
  assert.equal(await V.bwSecret('melious ai API Key', /sk-mel-[\w-]+/), SCHLUESSEL);
  assert.equal(aufrufe().length, n, 'aus dem Speicher, kein zweiter bw-Aufruf');
  process.env.WERKBANK_VW_SESSION_DATEI = join(R, 'gibt-es-nicht');
  assert.equal(await V.bwSecret('anderes', /x/), null, 'ohne Sitzungsdatei kein bw');
  // Phase 4: eine unlesbare Sitzung (hier ein Ordner) ergibt null statt eines synchronen Wurfs
  process.env.WERKBANK_VW_SESSION_DATEI = R;
  assert.equal(await V.bwSecret('anderes', /x/), null, 'unlesbare Sitzung → null');
  process.env.WERKBANK_VW_SESSION_DATEI = join(R, 'session');
  // Phase 4: gleichzeitige Abfragen desselben Elements teilen sich einen bw-Aufruf
  const m = aufrufe().length;
  assert.deepEqual(await Promise.all([V.bwSecret('View only github API', /ghp_\w+/), V.bwSecret('View only github API', /ghp_\w+/)]), ['ghp_LESEtest123', 'ghp_LESEtest123']);
  assert.equal(aufrufe().length, m + 1, 'ein bw-Aufruf für zwei gleichzeitige Abfragen');
});

test('GitHub-Lesetoken unverändert: Env zuerst, sonst Vaultwarden „View only github API“ mit ghp_/github_pat_', async () => {
  process.env.WERKBANK_GITHUB_TOKEN = 'ghp_ausEnv';
  assert.equal(await C.githubReadToken(), 'ghp_ausEnv');
  delete process.env.WERKBANK_GITHUB_TOKEN;
  assert.equal(await C.githubReadToken(), 'ghp_LESEtest123');
  assert.ok(aufrufe().includes('View only github API'));
});

const knut = { id: '6a1b2c3d4e5f60718293a4b5', email: 'knut@maxenergy.at', name: 'Knut', role: 'ADMIN' } as any;
const lisa = { id: '6a1b2c3d4e5f60718293a4b6', email: 'lisa@maxenergy.at', name: 'Lisa', role: 'USER' } as any;

test('Melious: ohne gespeicherten Schlüssel aus Vaultwarden (nur Knuts Konto), „erlaubt“ bleibt aus, Anzeige ••••+4 und Quelle', async () => {
  let s = await M.meliousSettings(knut);
  assert.equal(s.configured, true); assert.equal(s.quelle, 'vaultwarden'); assert.equal(s.last4, 'wxyz');
  assert.equal(s.enabled, false, 'der Schlüssel aus dem Vault schaltet nichts ein');
  assert.ok(!JSON.stringify(s).includes(SCHLUESSEL), 'nie im Klartext an den Browser');
  assert.equal(await M.meliousForBridge(knut), null, 'aus → kein Konto für die Brücke');
  s = await M.setMelious(knut, { enabled: true });
  assert.equal(s.enabled, true); assert.equal(s.quelle, 'vaultwarden');
  const b: any = await M.meliousForBridge(knut);
  assert.equal(b.token, SCHLUESSEL, 'die Brücke bekommt ihn (wie den gespeicherten)');
  assert.equal((await M.meliousSettings(lisa)).configured, false, 'andere Personen: kein Vault-Schlüssel');
});

test('Melious: Reihenfolge gespeichert → Env → Vaultwarden; Env nur mit gültigem sk-mel-Schlüssel', async () => {
  process.env.MELIOUS_API_KEY = 'kein-schluessel';
  assert.equal((await M.meliousSettings(lisa)).configured, false);
  process.env.MELIOUS_API_KEY = `sk-mel-${'e'.repeat(24)}env1`;
  let s = await M.meliousSettings(lisa);
  assert.equal(s.quelle, 'env'); assert.equal(s.last4, 'env1'); assert.equal(s.enabled, false);
  assert.equal((await M.meliousSettings(knut)).quelle, 'env', 'Env vor Vaultwarden');
  await M.setMelious(knut, { token: `sk-mel-${'g'.repeat(24)}gesp` });
  s = await M.meliousSettings(knut);
  assert.equal(s.quelle, 'gespeichert'); assert.equal(s.last4, 'gesp');
  assert.equal(await M.meliousKey(knut), `sk-mel-${'g'.repeat(24)}gesp`);
  delete process.env.MELIOUS_API_KEY;
  await M.removeMelious(knut);
  assert.equal((await M.meliousSettings(knut)).quelle, 'vaultwarden', 'nach dem Entfernen wieder der Vault');
  process.env.WERKBANK_MELIOUS_BW_ITEM = 'leer';
  assert.equal((await M.meliousSettings({ ...knut, id: '6a1b2c3d4e5f60718293a4b7' })).configured, false, 'Element ohne Schlüssel → nichts');
  delete process.env.WERKBANK_MELIOUS_BW_ITEM;
});
