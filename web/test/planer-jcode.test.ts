// realJcode (Plan 183): Aufruf von jcode mit Profil, Modell und Werkzeugen; Verbrauch ohne Sitzungsdatei aus der Ausgabe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

test('R4/R6: Worker-Umgebung ohne Git-/GitHub-Zugang aus HOME; hängender jcode wird nach SIGTERM hart beendet', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jcode-'));
  const bin = join(dir, 'jcode');
  writeFileSync(bin, '#!/usr/bin/env node\nconst e = process.env; process.stdout.write(JSON.stringify({ text: [e.GIT_CONFIG_GLOBAL, e.GIT_CONFIG_NOSYSTEM, e.GIT_TERMINAL_PROMPT, e.GH_CONFIG_DIR, e.GIT_ASKPASS, e.WB_TEST_DURCH ?? "-"].join("|") }));\n', { mode: 0o755 });
  process.env.WERKBANK_JCODE_BIN = bin;
  process.env.WB_TEST_DURCH = 'nein';
  try {
    const r = await realJcode({ cwd: dir, prompt: 'P', model: 'm', key: 'test', tools: 'read', timeoutS: 30 });
    assert.equal(r.text, '/dev/null|1|0|/nonexistent|/bin/false|-');
    // Runde 3: eigenes Wegwerf-HOME mit nur dem Melious-Profil, MCP aus Claude-Konfiguration aus; danach weg.
    writeFileSync(bin, '#!/usr/bin/env node\nconst e = process.env, fs = require("node:fs"); process.stdout.write(JSON.stringify({ text: JSON.stringify({ home: e.HOME, jhome: e.JCODE_HOME, mcp: e.JCODE_DISABLE_CLAUDE_MCP, cfg: fs.readFileSync(e.JCODE_HOME + "/config.toml", "utf8"), cwd: process.cwd() }) }));\n', { mode: 0o755 });
    const iso = JSON.parse((await realJcode({ cwd: dir, prompt: 'P', model: 'm', key: 'test', tools: 'read', timeoutS: 30 })).text);
    assert.notEqual(iso.home, process.env.HOME);
    assert.equal(iso.jhome, join(iso.home, '.jcode'));
    assert.equal(iso.mcp, '1');
    assert.match(iso.cfg, /^\[providers\.melious\]\ntype = "open-ai-compatible"\n/);
    assert.ok(!/mcp|memory/i.test(iso.cfg), 'nur das Profil');
    assert.equal(existsSync(iso.home), false, 'Wegwerf-HOME entfernt');
    // Arbeitsordner mit Agent-/MCP-Konfiguration wird abgelehnt, jcode startet gar nicht.
    writeFileSync(join(dir, '.mcp.json'), '{"mcpServers":{}}');
    const nein = await realJcode({ cwd: dir, prompt: 'P', model: 'm', key: 'test', tools: 'read', timeoutS: 30 });
    assert.equal(nein.code, -1); assert.match(nein.stderr, /nicht neutral \(\.mcp\.json\)/);
    rmSync(join(dir, '.mcp.json'));
    writeFileSync(bin, '#!/usr/bin/env node\nprocess.on("SIGTERM", () => {}); setInterval(() => {}, 1000);\n', { mode: 0o755 });
    const t0 = Date.now();
    const h = await realJcode({ cwd: dir, prompt: 'P', model: 'm', key: 'test', tools: 'read', timeoutS: 1, killNachMs: 300 });
    assert.ok(Date.now() - t0 < 5000, 'hart beendet');
    assert.notEqual(h.code, 0);
    // Runde 2: ein Kindprozess, der stdout erbt, darf das Ende nicht aufhalten — die ganze Prozessgruppe wird beendet.
    writeFileSync(bin, '#!/usr/bin/env node\nconst { spawn } = require("node:child_process"); spawn("sleep", ["60"], { stdio: "inherit" }); process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);\n', { mode: 0o755 });
    const t1 = Date.now();
    const k = await realJcode({ cwd: dir, prompt: 'P', model: 'm', key: 'test', tools: 'read', timeoutS: 1, killNachMs: 300 });
    assert.ok(Date.now() - t1 < 6000, `mit Kindprozess hart beendet (${Date.now() - t1} ms)`);
    assert.notEqual(k.code, 0);
  } finally { delete process.env.WERKBANK_JCODE_BIN; delete process.env.WB_TEST_DURCH; }
});
