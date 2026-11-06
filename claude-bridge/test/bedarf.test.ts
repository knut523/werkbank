// Bedarfskanal (Knut 06.11.): ein erteilter Zugang gilt für einen Ordner außerhalb des Worktrees, zeitlich begrenzt; nie für
// Geheimnis-Orte; danach erlaubt der Wächter dort lokale Commits (strangLokal) wie im eigenen Worktree.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let mod: typeof import('../src/sessions.ts');
const STATE = mkdtempSync(join(tmpdir(), 'bridge-bedarf-'));
const ANDERS = realpathSync(mkdtempSync(join(tmpdir(), 'anderes-repo-')));
const C = '22222222-2222-2222-2222-222222222222';
before(async () => { process.env.BRIDGE_STATE_DIR = STATE; mod = await import('../src/sessions.ts'); mkdirSync(join(STATE, 'wt'), { recursive: true }); mod.registerOrchestration('u2', C, join(STATE, 'wt')); });

test('Zugang: nur bestehende Ordner, keine Geheimnis-Orte, höchstens 24 h, unbekannter Strang → 404', () => {
  const jetzt = Date.now();
  const r = mod.strangFreigabe('u2', C, ANDERS, jetzt + 3600_000);
  assert.equal(r.pfad, ANDERS);
  assert.ok(mod.strangFreigaben('u2', C).includes(ANDERS));
  assert.throws(() => mod.strangFreigabe('u2', C, join(ANDERS, 'gibt-es-nicht'), jetzt + 1000), /gibt es nicht/);
  assert.throws(() => mod.strangFreigabe('u2', C, join(process.env.HOME ?? '/home', '.ssh'), jetzt + 1000), /Geheimnis|gibt es nicht/);
  assert.throws(() => mod.strangFreigabe('u2', C, ANDERS, jetzt + 30 * 3600_000), /24/);
  assert.throws(() => mod.strangFreigabe('u2', '33333333-3333-3333-3333-333333333333', ANDERS, jetzt + 1000), /Strang/);
});

test('Zugang läuft ab', () => {
  mod.strangFreigabe('u2', C, ANDERS, Date.now() + 50);
  const bis = Date.now() + 60;
  while (Date.now() < bis) { /* warten */ }
  assert.ok(!mod.strangFreigaben('u2', C).includes(ANDERS));
});
