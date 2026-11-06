// Lesende jcode-Worker (Phase 4, A3/A7): jeder Versuch der Modellreihe wird gebucht, auch der fehlgeschlagene; der Hinweis
// „Rückfall auf …“ nennt nur einen Versuch, den es wirklich gibt. Ende-zu-Ende durch die Brücke im Mock-Modus, jcode als Stub.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync, chmodSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repo } from './delegation-hilfe.ts';

const PORT = 3487;
const STATE = mkdtempSync(join(tmpdir(), 'bridge-wj-'));
const HOMES = mkdtempSync(join(tmpdir(), 'claude-homes-wj-'));
const SKILLS = mkdtempSync(join(tmpdir(), 'skills-wj-'));
const ORCH = realpathSync(mkdtempSync(join(tmpdir(), 'orch-wj-')));
const BIN = mkdtempSync(join(tmpdir(), 'bin-wj-'));
const tok = (s: string) => `sk-ant-oat01-wj-${s}-${'x'.repeat(24)}`;
const MEL = { id: 'melious', label: 'Melious', token: `sk-mel-wj-${'y'.repeat(24)}`, kind: 'melious', rest: 200_000, fallback: false, faktoren: { 'glm-5.3-flash': { in: 1, out: 1 }, 'deepseek-v4.1-flash-1017': { in: 1, out: 1 } } };
// Stub: „LANGSAM“ im Auftrag hält ihn 3 s (Grenzen-Test); mit „--model glm-5.3-flash“ scheitert der Lauf (Exit 1, aber mit Verbrauch); jedes andere Modell liefert.
writeFileSync(join(BIN, 'jcode'), `#!/bin/sh
case "$*" in *LANGSAM*) sleep 3;; esac
m=""; while [ $# -gt 0 ]; do [ "$1" = "--model" ] && m="$2"; shift; done
if [ "$m" = "glm-5.3-flash" ]; then echo '{"text":"","model":"glm-5.3-flash","usage":{"input_tokens":40,"output_tokens":4,"cache_read_input_tokens":0}}'; exit 1; fi
echo '{"text":"Antwort aus jcode","model":"'"$m"'","usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":0}}'
`);
chmodSync(join(BIN, 'jcode'), 0o755);

let proc: ChildProcess, web: Server, out = '';
const zuege: any[] = [];

before(async () => {
  web = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    if (req.headers['x-werkbank-internal'] !== 'geheim') { res.statusCode = 403; res.end('{}'); return; }
    // Person „ohnepreis“: Konto ohne Preisliste (A-S8: dann gilt die Modellreihe trotzdem)
    if (req.url === '/internal/claude-accounts') { const { userId } = JSON.parse(b); res.end(JSON.stringify({ accounts: [{ id: 'chat', label: 'Chat', token: null }, userId === 'ohnepreis' ? { ...MEL, faktoren: undefined } : MEL] })); return; }
    if (req.url === '/internal/zug-log') { zuege.push(JSON.parse(b).zug); res.end('{"ok":true}'); return; }
    if (req.url === '/internal/session-start') { res.end(JSON.stringify({ text: '' })); return; }
    res.end('{}');
  });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', () => r()));
  const wurl = `http://127.0.0.1:${(web.address() as any).port}`;
  proc = spawn(process.execPath, ['src/server.ts'], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, BRIDGE_MOCK: '1', BRIDGE_PORT: String(PORT), BRIDGE_STATE_DIR: STATE, BRIDGE_SKILLS_DIR: SKILLS, BRIDGE_SKILLS: '',
      WERKBANK_URL: wurl, WERKBANK_INTERNAL_TOKEN: 'geheim', MELIOUS_BASE_URL: wurl, BRIDGE_CLAUDE_HOMES: HOMES, WERKBANK_ORCH_ROOTS: ORCH, WERKBANK_SKILLS_SOURCE: SKILLS,
      BRIDGE_CLAUDE_CONFIG_SHARED: '', BRIDGE_CLAUDE_CONFIG: '', BRIDGE_PERMISSION_MODE: '', BRIDGE_WORKER_JCODE: 'on', BRIDGE_JCODE_BIN: join(BIN, 'jcode'),
      BRIDGE_MODELL_GEWICHTE: 'glm-5.3-flash:1', BRIDGE_MAX_LESER: '4' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout!.on('data', (d) => { out += d; });
  proc.stderr!.on('data', (d) => { out += d; });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('Brücke startet nicht');
});
after(() => { proc.kill(); web.close(); });

async function send(c: string, content: string, user = 'knut') {
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${tok(user)}`, 'content-type': 'application/json', 'x-librechat-user-id': user, 'x-librechat-conversation-id': c },
    body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content }] }),
  });
  return (await res.text()).split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)).choices[0]?.delta?.content ?? '').join('');
}
const lead = (schritte: unknown[]) => `MOCK-LEAD ${JSON.stringify({ schritte })}`;

const strang = async (n: number, user = 'knut') => {
  const c = `00000000-0000-4000-9400-${String(n).padStart(12, '0')}`;
  const r = await fetch(`http://127.0.0.1:${PORT}/internal/orchestrate`, { method: 'POST', headers: { 'x-werkbank-internal': 'geheim', 'content-type': 'application/json' }, body: JSON.stringify({ userId: user, conv: c, dir: repo(ORCH, `wj${n}`), email: 'knut@x', risiko: 'niedrig' }) });
  assert.equal(r.status, 200, await r.text());
  return c;
};

test('Rückfall in der Modellreihe: beide Versuche gebucht, Ergebnis vom zweiten Modell', async () => {
  const c = await strang(1);
  const t = await send(c, lead([{ tool: 'delegieren', args: { rolle: 'leser', aufgabe: 'Lies README.md' } }, { tool: 'delegation_stand', args: { warten_s: 30 } }]));
  assert.match(t, /Antwort aus jcode/, t + out.slice(-2000));
  assert.match(t, /Modell: Melious deepseek-v4\.1-flash-1017 \(jcode\)[^\n]*Tokens 50 ein \/ 9 aus/, 'Verbrauch beider Versuche (40+10 / 4+5)');
  const worker = zuege.filter((z) => z?.art === 'worker' && z.anbieter === 'melious');
  assert.deepEqual(worker.map((z) => [z.modell, z.outcome]), [['glm-5.3-flash (jcode)', 'fehler'], ['deepseek-v4.1-flash-1017 (jcode)', 'ok']], 'jeder Versuch gebucht');
});

test('J2: mit jcode gilt die eigene Leser-Grenze (hier 4), nicht die Worker-Grenze 3', async () => {
  const c = await strang(2);
  const t = await send(c, lead([...[1, 2, 3, 4, 5].map((n) => ({ tool: 'delegieren', args: { rolle: 'leser', aufgabe: `Lies ${n} LANGSAM` } })), { tool: 'delegation_stand', args: { warten_s: 30 } }]));
  assert.equal((t.match(/Delegation d-[0-9a-f]{6} gestartet/g) ?? []).length, 4, t);
  assert.match(t, /\[delegieren\] FEHLER 429: Schon 4 lesende Worker laufen/);
});

test('A-S8: ohne Preisliste gilt die Modellreihe trotzdem (Rückfall auf das nächste Modell, nicht Profil-Standard)', async () => {
  const c = await strang(3, 'ohnepreis');
  const t = await send(c, lead([{ tool: 'delegieren', args: { rolle: 'leser', aufgabe: 'Lies README.md' } }, { tool: 'delegation_stand', args: { warten_s: 30 } }]), 'ohnepreis');
  assert.match(t, /Modell: Melious deepseek-v4\.1-flash-1017 \(jcode\)/, t);
});
