// Knut 06.11. (D1/D2): ensemble_review Ende-zu-Ende durch die Brücke (Mock-Lead) — eigener opencode-2-Server nur für dieses Review
// (nachgebautes Programm), Schlüssel aus dem Konto nur in dessen Umgebung, eigene Sitzungsdaten, drei Prüfer + Verifizierer + Schatten,
// Protokoll mit beiden Urteilen, Server danach weg; ohne opencode 2 alles über jcode.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync, chmodSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PORT = 3493;
const STATE = mkdtempSync(join(tmpdir(), 'bridge-ens-'));
const HOMES = mkdtempSync(join(tmpdir(), 'claude-homes-ens-'));
const SKILLS = mkdtempSync(join(tmpdir(), 'skills-ens-'));
const ORCH = realpathSync(mkdtempSync(join(tmpdir(), 'orch-ens-')));
const WT = join(ORCH, 'wt'); mkdirSync(WT);
const BIN = mkdtempSync(join(tmpdir(), 'bin-ens-'));
const OC2 = mkdtempSync(join(tmpdir(), 'oc2-ens-'));
const SPUR = join(OC2, 'spur'); mkdirSync(SPUR);
const tok = (s: string) => `sk-ant-oat01-ens-${s}-${'x'.repeat(24)}`;
const MEL = { id: 'melious', label: 'Melious', token: `sk-mel-ens-${'y'.repeat(24)}`, kind: 'melious', rest: 150_000, fallback: false, rollen: { leser: ['glm-5.3-flash'] } };
const g = (...a: string[]) => execFileSync('git', ['-C', WT, ...a], { encoding: 'utf8', env: { PATH: String(process.env.PATH), HOME: WT, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } }).trim();
g('init', '-q'); writeFileSync(join(WT, 'a.ts'), Array.from({ length: 20 }, (_, i) => `const z${i + 1} = ${i + 1};`).join('\n') + '\n'); g('add', '.'); g('commit', '-qm', 'basis');
const BASIS = g('rev-parse', 'HEAD');
writeFileSync(join(WT, 'a.ts'), readFileSync(join(WT, 'a.ts'), 'utf8').replace('const z2 = 2;', 'const z2 = eval(x);')); g('commit', '-qam', 'kopf');
const KOPF = g('rev-parse', 'HEAD');
// jcode-Nachbau: nennt Modell und Rolle (aus dem Prompt), damit man den Rückfall sieht.
writeFileSync(join(BIN, 'jcode'), `#!/usr/bin/env node
const a = process.argv.slice(2), m = a[a.indexOf('--model') + 1], p = a[a.length - 1];
require('fs').appendFileSync(${JSON.stringify(join(SPUR, 'jcode'))}, m + '\\n');
const text = p.startsWith('Drei unabhängige Prüfer') ? 'Bestätigt (jcode ' + m + '): a.ts:2 eval' : 'Befund a.ts:2 eval (jcode ' + m + ')';
console.log(JSON.stringify({ text, model: m, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 } }));
`);
chmodSync(join(BIN, 'jcode'), 0o755);
// opencode-2-Nachbau mit Sitzungs-API; Antwort je Modell; notiert Umgebung (nur Namen, Schlüssel ok?, Datenordner).
mkdirSync(join(OC2, 'bin')); mkdirSync(join(OC2, 'xdg/config/opencode'), { recursive: true });
writeFileSync(join(OC2, 'xdg/config/opencode/opencode.jsonc'), '{ "providers": { "melious": {} }, "update": "disable", "share": "disabled" }');
writeFileSync(join(OC2, 'bin/opencode2'), `#!/usr/bin/env node
const fs = require('fs'), http = require('http'), E = process.env, a = process.argv.slice(2);
if (a[0] === '--version') { console.log('opencode v2.2.5'); process.exit(0); }
if (fs.existsSync(${JSON.stringify(join(OC2, 'aus'))})) process.exit(1);
const port = Number(a[a.indexOf('--port') + 1]), soll = 'Basic ' + Buffer.from('opencode:' + E.OPENCODE_SERVER_PASSWORD).toString('base64');
fs.writeFileSync(${JSON.stringify(SPUR)} + '/server-' + process.pid + '.json', JSON.stringify({ port, pid: process.pid, schluesselOk: E.MELIOUS_API_KEY === ${JSON.stringify(MEL.token)}, daten: E.XDG_DATA_HOME, konfig: E.XDG_CONFIG_HOME, namen: Object.keys(E) }));
const ses = {}; let n = 0;
http.createServer(async (q, s) => {
  let b = ''; for await (const c of q) b += c;
  const ok = (d) => { s.setHeader('content-type', 'application/json'); s.end(JSON.stringify(d)); };
  if (q.headers.authorization !== soll) { s.statusCode = 401; return s.end('{}'); }
  if (q.url.startsWith('/api/session?')) return ok({ data: [] });
  if (q.url === '/api/session' && q.method === 'POST') { const id = 'ses_' + (++n); ses[id] = { model: JSON.parse(b).model.id, polls: 0 }; return ok({ data: { id } }); }
  const m = q.url.match(/^\\/api\\/session\\/(ses_\\d+)(\\/\\w+)?/); const S = m && ses[m[1]];
  if (!S) { s.statusCode = 404; return s.end('{}'); }
  if (m[2] === '/prompt') { S.prompt = JSON.parse(b).text; fs.appendFileSync(${JSON.stringify(join(SPUR, 'oc2'))}, S.model + (S.prompt.startsWith('Drei unabhängige Prüfer') ? ' verifiziert' : ' prüft') + '\\n'); return ok({ data: {} }); }
  if (m[2] === '/message') { const v = S.prompt.startsWith('Drei unabhängige Prüfer'); return ok({ data: [{ type: 'assistant', time: { created: 1 }, content: [{ type: 'text', text: v ? 'Bestätigt (' + S.model + '): a.ts:2 eval — blockierend' : 'Befund a.ts:2: eval (' + S.model + ')' }] }] }); }
  S.polls++; return ok({ data: { model: { id: S.model }, tokens: { input: 100, output: 50, cache: { read: 0 } }, ...(S.polls >= 2 ? { outcome: 'succeeded', time: { busy: 1, idle: 2 } } : { time: { busy: 2, idle: 1 } }) } });
}).listen(port, '127.0.0.1');
`);
chmodSync(join(OC2, 'bin/opencode2'), 0o755);

let proc: ChildProcess, web: Server, out = '';
before(async () => {
  web = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    if (req.headers['x-werkbank-internal'] !== 'geheim') { res.statusCode = 403; res.end('{}'); return; }
    if (req.url?.endsWith('/claude-accounts')) { res.end(JSON.stringify({ accounts: [{ id: 'chat', label: 'Chat', token: null }, MEL] })); return; }
    res.end('{}');
  });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', () => r()));
  proc = spawn(process.execPath, ['src/server.ts'], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, BRIDGE_MOCK: '1', BRIDGE_PORT: String(PORT), BRIDGE_STATE_DIR: STATE, BRIDGE_SKILLS_DIR: SKILLS, BRIDGE_SKILLS: '',
      WERKBANK_URL: `http://127.0.0.1:${(web.address() as any).port}`, WERKBANK_INTERNAL_TOKEN: 'geheim', BRIDGE_CLAUDE_HOMES: HOMES, WERKBANK_ORCH_ROOTS: ORCH, WERKBANK_SKILLS_SOURCE: SKILLS,
      BRIDGE_CLAUDE_CONFIG_SHARED: '', BRIDGE_CLAUDE_CONFIG: '', BRIDGE_PERMISSION_MODE: 'auto', BRIDGE_AUTO_SCOPE: 'voll', BRIDGE_AUTO_EMAILS: 'knut@maxenergy.at', BRIDGE_JCODE_BIN: join(BIN, 'jcode'),
      BRIDGE_OPENCODE2_HOME: OC2, BRIDGE_ENSEMBLE_SCHATTEN: 'an' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout!.on('data', (d) => { out += d; }); proc.stderr!.on('data', (d) => { out += d; });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('Brücke startet nicht');
});
after(async () => { if (proc.exitCode === null) { proc.kill(); await new Promise((r) => proc.once('exit', r)); } web.close(); });

const conv = (n: number) => `00000000-0000-4000-9400-${String(n).padStart(12, '0')}`;
async function send(c: string, content: string) {
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, { method: 'POST',
    headers: { authorization: `Bearer ${tok('knut')}`, 'content-type': 'application/json', 'x-librechat-user-id': 'knut', 'x-librechat-conversation-id': c, 'x-librechat-user-email': 'knut@maxenergy.at' },
    body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content }] }) });
  return (await res.text()).split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)).choices[0]?.delta?.content ?? '').join('');
}
const register = async (c: string) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/internal/orchestrate`, { method: 'POST', headers: { 'x-werkbank-internal': 'geheim', 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'knut', email: 'knut@maxenergy.at', conv: c, dir: WT }) });
  assert.equal(r.status, 200, await r.text());
};
const lead = (args: object) => `MOCK-LEAD ${JSON.stringify({ schritte: [{ tool: 'ensemble_review', args }] })}`;
const lebt = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('ensemble_review: eigener opencode-2-Server, drei Prüfer + Verifizierer glm-5.2 + Schatten, Protokoll mit beiden Urteilen, Server danach weg', async () => {
  const c = conv(1); await register(c);
  const t = await send(c, lead({ auftrag: 'Review des Deltas', bereich: `${BASIS}..${KOPF}` }));
  assert.match(t, /Bestätigt \(glm-5\.2\): a\.ts:2 eval — blockierend/);
  assert.match(t, /Ensemble: 3 Prüfläufe/); assert.match(t, /Schatten glm-5\.3-flash protokolliert/);
  const oc2 = readFileSync(join(SPUR, 'oc2'), 'utf8').trim().split('\n').sort();
  assert.deepEqual(oc2, ['deepseek-v4.1-flash-1017 prüft', 'glm-5.2 prüft', 'glm-5.2 verifiziert', 'glm-5.3-flash prüft', 'glm-5.3-flash verifiziert']);
  assert.ok(!existsSync(join(SPUR, 'jcode')), 'kein jcode nötig');
  const srv = readdirSync(SPUR).filter((f) => f.startsWith('server-')).map((f) => JSON.parse(readFileSync(join(SPUR, f), 'utf8')));
  assert.equal(srv.length, 1, 'genau ein Server für dieses Review');
  assert.equal(srv[0].schluesselOk, true); assert.ok(!srv[0].namen.includes('WERKBANK_INTERNAL_TOKEN'));
  assert.ok(srv[0].daten.includes('ens-oc2-') && !srv[0].daten.startsWith(OC2), 'eigene Sitzungsdaten'); assert.equal(srv[0].konfig, join(OC2, 'xdg/config'), 'geprüfte Konfiguration');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(lebt(srv[0].pid), false, 'Server nach dem Review beendet'); assert.ok(!existsSync(srv[0].daten), 'Sitzungsdaten weg');
  const prot = readdirSync(join(STATE, 'ensemble')).map((f) => JSON.parse(readFileSync(join(STATE, 'ensemble', f), 'utf8')));
  assert.equal(prot.length, 1);
  assert.equal(prot[0].verifizierer.modell, 'glm-5.2'); assert.match(prot[0].verifizierer.text, /Bestätigt \(glm-5\.2\)/);
  assert.equal(prot[0].schatten.modell, 'glm-5.3-flash'); assert.match(prot[0].schatten.text, /Bestätigt \(glm-5\.3-flash\)/);
  assert.deepEqual(prot[0].pruefer.map((p: any) => p.laeufer), ['opencode2', 'opencode2', 'opencode2']);
  assert.match(out, /"event":"ensemble-review"/); assert.ok(!out.includes(MEL.token), 'Schlüssel nie im Log');
});

test('opencode 2 startet nicht → alle Läufe über jcode (Rückfall), sichtbar; falscher Bereich → Fehler', async () => {
  writeFileSync(join(OC2, 'aus'), '1');
  const c = conv(2); await register(c);
  const t = await send(c, lead({ auftrag: 'Review', bereich: `${BASIS}..${KOPF}` }));
  assert.match(t, /Bestätigt \(jcode glm-5\.2\)/); assert.match(t, /opencode 2 nicht verfügbar/);
  assert.deepEqual(readFileSync(join(SPUR, 'jcode'), 'utf8').trim().split('\n').sort(), ['deepseek-v4.1-flash-1017', 'glm-5.2', 'glm-5.2', 'glm-5.3-flash', 'glm-5.3-flash']);
  // K8: höchstens 4 Ensembles je Zug
  const c4 = conv(9); await register(c4);
  const viele = await send(c4, `MOCK-LEAD ${JSON.stringify({ schritte: Array.from({ length: 5 }, () => ({ tool: 'ensemble_review', args: { auftrag: 'Review', bereich: `${BASIS}..${KOPF}` } })) })}`);
  assert.equal((viele.match(/\[ensemble_review\] FEHLER 429: Höchstens 4 Review-Ensembles je Zug/g) ?? []).length, 1, viele.slice(-600));
  rmSync(join(OC2, 'aus'));
  await register(conv(3));
  assert.match(await send(conv(3), lead({ auftrag: 'R', bereich: 'a; rm -rf /' })), /FEHLER 400: bereich/);
});

test('Gegenprüfung 06.11.: leerer Bereich → nichts zu prüfen; Web-Weg nur unter den erlaubten Arbeitsordnern, sonst 403', async () => {
  const c = conv(4); await register(c);
  assert.match(await send(c, lead({ auftrag: 'R', bereich: `${KOPF}..${KOPF}` })), /Keine Änderungen in .* — nichts zu prüfen, kein Ensemble gelaufen/);
  const pfad = `http://127.0.0.1:${PORT}/internal/ensemble-web`;
  const web = async (body: object) => { const r = await fetch(pfad, { method: 'POST', headers: { 'x-werkbank-internal': 'geheim', 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'knut', auftrag: 'Gegenprüfung', ...body }) }); return JSON.parse((await r.text()).trim()); };
  assert.match((await web({ cwd: tmpdir(), bereich: `${BASIS}...${KOPF}` })).error, /nicht unter den erlaubten Arbeitsordnern/);
  const ok = await web({ cwd: WT, bereich: `${BASIS}...${KOPF}` });
  assert.match(ok.text, /Bestätigt \(glm-5\.2\)/); assert.ok(ok.nutzung.length >= 4, 'Nutzung je Lauf an die Werkbank (sie bucht)');
  assert.equal((await fetch(pfad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403, 'nur mit internem Schlüssel');
});
