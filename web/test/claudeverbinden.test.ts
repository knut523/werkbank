// P5: Claude verbinden ohne Terminal — Link aus der Ausgabe von `claude setup-token` (OSC-8), Code an die CLI, Token zurück.
// Mit einer nachgebauten CLI (gibt Link aus, liest den Code, gibt einen Token aus) statt eines echten Kontos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { linkAus, tokenAus, codeOk, starte, codeEinreichen, offen } from '../server/claudeverbinden.ts';

const URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=x&response_type=code&scope=user%3Ainference&state=abc';

test('Link, Token und Code werden streng erkannt', () => {
  assert.equal(linkAus(`Browser didn't open?\n\x1b]8;id=a;${URL}\x07Link\x1b]8;;\x07`), URL);
  assert.equal(linkAus(`siehe ${URL} `), URL);
  assert.equal(linkAus('\x1b]8;id=a;https://evil.example/oauth/authorize?x=1\x07'), null, 'nur claude.com/claude.ai');
  assert.equal(tokenAus('Your token:\r\n\x1b[1msk-ant-oat01-abcDEF_123-xyz456789012345\x1b[0m'), 'sk-ant-oat01-abcDEF_123-xyz456789012345');
  assert.equal(tokenAus('kein Token'), null);
  assert.equal(codeOk('AbC123_-xyz#state.9'), true);
  assert.equal(codeOk('abc\u001b[2J'), false, 'keine Steuerzeichen ans Terminal');
  assert.equal(codeOk('kurz'), false);
});

test('Ablauf mit nachgebauter CLI: Link → Code → Token; danach keine Anmeldung mehr offen', async () => {
  const d = mkdtempSync(join(tmpdir(), 'fake-claude-'));
  const bin = join(d, 'claude');
  writeFileSync(bin, `#!/bin/bash\nprintf 'Opening browser…\\n\\033]8;id=x;%s\\007Link\\033]8;;\\007\\nPaste code here: ' '${URL}'\nread -r code\n[ "$code" = "ABCDEFGHIJ123" ] && printf '\\nsk-ant-oat01-TESTTOKEN_abcdefghij0123456789\\n' || printf '\\nInvalid code\\n'\nsleep 1\n`);
  chmodSync(bin, 0o755);
  const r = await starte('u-test', bin);
  assert.equal(r.url, URL);
  assert.equal(offen('u-test'), true);
  await assert.rejects(codeEinreichen('u-test', 'x'), /Code/);
  assert.equal(await codeEinreichen('u-test', 'ABCDEFGHIJ123'), 'sk-ant-oat01-TESTTOKEN_abcdefghij0123456789');
  assert.equal(offen('u-test'), false);
  await assert.rejects(codeEinreichen('u-test', 'ABCDEFGHIJ123'), /Keine Anmeldung offen/);
});
