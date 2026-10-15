// realJcode (Plan 183): Aufruf von jcode mit Profil, Modell und Werkzeugen; Verbrauch ohne Sitzungsdatei aus der Ausgabe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { realJcode } from '../server/planer.ts';

test('realJcode: Argumente wie die Brücke; ohne Sitzungsdatei zählt usage aus der Ausgabe als ein Aufruf', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jcode-'));
  const bin = join(dir, 'jcode');
  writeFileSync(bin, '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ text: process.argv.slice(2).join(" "), usage: { input_tokens: 100, cache_read_input_tokens: 80, output_tokens: 7 } }));\n', { mode: 0o755 });
  process.env.WERKBANK_JCODE_BIN = bin;
  try {
    const r = await realJcode({ cwd: dir, prompt: 'P', model: 'glm-5.3-flash', key: 'test', tools: 'read', timeoutS: 30 });
    assert.equal(r.code, 0);
    assert.equal(r.text, '--provider-profile melious --model glm-5.3-flash --tools read run --json P');
    assert.deepEqual([r.usage, r.aufrufe], [{ input: 20, output: 7, cacheRead: 80, cacheWrite: 0 }, 1]);
    writeFileSync(bin, '#!/usr/bin/env node\nprocess.stdout.write("kein json"); process.exit(0);\n', { mode: 0o755 });
    const kaputt = await realJcode({ cwd: dir, prompt: 'P', model: 'm', key: 'test', tools: 'read', timeoutS: 30 });
    assert.equal(kaputt.code, -1, 'keine JSON-Ausgabe gilt als Fehlschlag');
  } finally { delete process.env.WERKBANK_JCODE_BIN; }
});
