// Plan 185/187 S2: LibreChat-Standard ausgeblendet; Lesezeichen-API bleibt an (Hauptchat setzt darüber seine Tags).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const yaml = readFileSync(new URL('../../librechat/librechat.yaml', import.meta.url), 'utf8');
const flag = (k: string) => new RegExp(`^  ${k}: (true|false)\\s*$`, 'm').exec(yaml)?.[1];

test('S2: Prompts, Presets, Temporärer Chat per yaml aus; Lesezeichen bleiben an (B4)', () => {
  assert.equal(flag('prompts'), 'false');
  assert.equal(flag('presets'), 'false');
  assert.equal(flag('temporaryChat'), 'false');
  assert.equal(flag('bookmarks'), 'true', 'bookmarks:false würde die Tags-API sperren');
});

test('S2: Patch 70 blendet nur die Oberfläche aus (keine API-/Server-Dateien)', () => {
  const p = readFileSync(new URL('../../librechat/patches/70-client-entruempeln.patch', import.meta.url), 'utf8');
  const dateien = [...p.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]);
  assert.ok(dateien.length >= 4);
  assert.ok(dateien.every((f) => f.startsWith('client/src/')), dateien.join(', '));
});
