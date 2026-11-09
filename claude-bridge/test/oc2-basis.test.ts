// OC2-Strang Ende-zu-Ende durch die Brücke (Knut 07.11.): nachgebautes opencode 2 (Sitzungs-API, schreibt in den Arbeitsordner),
// Mock-Claude als Verifizierer. Geprüft: Schalter aus → sichtbar Claude; Gate lehnt ab → Befunde zurück an DIESELBE Sitzung → ok;
// zweiter Zug setzt die Sitzung fort (nur die neue Nachricht); MCP je Ordner mit Strang-Token; Buchung im Verbrauchsbuch;
// Melious unter der Untergrenze → Claude mit Grund.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync, chmodSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freiePorts } from './port-hilfe.ts';

const [PORT, OC2_PORT] = await freiePorts(2);   // freie Ports je Lauf (ports-p5), nichts fest verdrahtet
const STATE = mkdtempSync(join(tmpdir(), 'bridge-oc2s-'));
const HOMES = mkdtempSync(join(tmpdir(), 'claude-homes-oc2s-'));
const SKILLS = mkdtempSync(join(tmpdir(), 'skills-oc2s-'));
const ORCH = realpathSync(mkdtempSync(join(tmpdir(), 'orch-oc2s-')));
const OC2 = mkdtempSync(join(tmpdir(), 'oc2-oc2s-'));
const SPUR = join(OC2, 'spur'); mkdirSync(SPUR);
const tok = (s: string) => `sk-ant-oat01-oc2s-${s}-${'x'.repeat(24)}`;
const MEL: any = { id: 'melious', label: 'Melious', token: `sk-mel-oc2s-${'y'.repeat(24)}`, kind: 'melious', rest: 150_000, fallback: false, faktoren: { 'glm-5.3': { in: 1000, out: 4000, cache: 100 } } };
const wt = (name: string) => {
  const d = join(ORCH, name); mkdirSync(d);
  const g = (...a: string[]) => execFileSync('git', ['-C', d, ...a], { env: { PATH: String(process.env.PATH), HOME: d, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } });
  g('init', '-q'); writeFileSync(join(d, 'a.ts'), 'export const a = 1;\n'); g('add', '.'); g('commit', '-qm', 'basis');
  return d;
};
// opencode-2-Nachbau: Sitzungen mit Ort, Prompt schreibt gebaut.txt (mit „MOCK-ABLEHNEN“, solange der Auftrag es verlangt und
// keine Befunde kamen), Nachrichten mit Zeitstempel, Nutzung über die Sitzung summiert. Notiert Prompts und MCP-Einträge.
mkdirSync(join(OC2, 'bin')); mkdirSync(join(OC2, 'xdg/config/opencode'), { recursive: true });
writeFileSync(join(OC2, 'xdg/config/opencode/opencode.jsonc'), '{ "providers": { "melious": {} }, "update": "disable", "share": "disabled" }');
writeFileSync(join(OC2, 'bin/opencode2'), `#!/usr/bin/env node
const fs = require('fs'), path = require('path'), http = require('http'), E = process.env, a = process.argv.slice(2);
if (a[0] === '--version') { console.log('opencode v2.2.5'); process.exit(0); }
const port = Number(a[a.indexOf('--port') + 1]), soll = 'Basic ' + Buffer.from('opencode:' + E.OPENCODE_SERVER_PASSWORD).toString('base64');
const spur = (f, x) => fs.appendFileSync(${JSON.stringify(SPUR)} + '/' + f, JSON.stringify(x) + '\\n');
spur('server', { pfadVorn: E.PATH.split(':')[0], projekt: E.OPENCODE_DISABLE_PROJECT_CONFIG, schluesselOk: E.MELIOUS_API_KEY === ${JSON.stringify(MEL.token)} });
const ses = {}; let n = 0;
http.createServer(async (q, s) => {
  let b = ''; for await (const c of q) b += c;
  const ok = (d) => { s.setHeader('content-type', 'application/json'); s.end(JSON.stringify(d)); };
  if (q.headers.authorization !== soll) { s.statusCode = 401; return s.end('{}'); }
  if (q.url.startsWith('/api/experimental/mcp/')) { spur('mcp', { url: decodeURIComponent(q.url), body: b ? JSON.parse(b) : null }); s.statusCode = 204; return s.end(); }
  if (q.url.startsWith('/api/session?')) return ok({ data: [] });
  if (q.url === '/api/session' && q.method === 'POST') { const j = JSON.parse(b); const id = 'ses_' + (++n) + 'x'; ses[id] = { model: j.model.id, dir: j.location.directory, rechte: j.permissions, msgs: [], tok: 0, busy: 0, idle: 0, polls: 0 }; spur('neu', { id, rechte: j.permissions.length, werkbank: j.permissions.some((r) => r.action === 'werkbank_*' && r.effect === 'allow') }); return ok({ data: { id } }); }
  const m = q.url.match(/^\\/api\\/session\\/(ses_\\w+?)(\\/\\w+)?(\\?.*)?$/); const S = m && ses[m[1]];
  if (!S) { s.statusCode = 404; return s.end('{}'); }
  if (m[2] === '/prompt') {
    const text = JSON.parse(b).text; spur('prompt', { id: m[1], text: text.slice(0, 3000), lang: text.length });
    const befunde = /abgelehnt \\(Runde/.test(text);
    if (/BAUE/.test(text) || befunde) fs.writeFileSync(path.join(S.dir, 'gebaut.txt'), (/MOCK-ABLEHNEN/.test(text) && !befunde ? 'MOCK-ABLEHNEN\\n' : 'sauber\\n'));
    S.busy = Date.now(); S.polls = 0; S.tok += 1000; S.outcome = S.outcome;
    S.msgs.push({ type: 'user', time: { created: Date.now() }, text });
    S.antwort = 'Gebaut (' + S.model + ', Nachricht ' + S.msgs.filter((x) => x.type === 'user').length + ').\\n\\n### Stand\\n- Erledigt: gebaut.txt\\nStatus: fertig';
    return ok({ data: {} });
  }
  if (m[2] === '/message') return ok({ data: [...S.msgs].reverse() });
  if (m[2] === '/interrupt') return ok({ data: {} });
  S.polls++;
  if (S.polls === 2 && S.busy > S.idle) { S.idle = Date.now() + 1; S.outcome = 'succeeded'; S.msgs.push({ type: 'assistant', time: { created: Date.now() }, content: [{ type: 'text', text: S.antwort }] }); }
  return ok({ data: { model: { id: S.model }, tokens: { input: S.tok, output: S.tok / 10, cache: { read: 0 } }, ...(S.outcome ? { outcome: S.outcome } : {}), time: { busy: S.busy, idle: S.idle } } });
}).listen(port, '127.0.0.1');
`);
chmodSync(join(OC2, 'bin/opencode2'), 0o755);

let proc: ChildProcess, web: Server, out = '';
const zugLog: any[] = [];
let konten: any[] = [{ id: 'chat', label: 'Chat', token: null }, MEL];
const start = async (extra: Record<string, string>) => {
  out = '';
  proc = spawn(process.execPath, ['src/server.ts'], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, BRIDGE_MOCK: '1', BRIDGE_PORT: String(PORT), BRIDGE_STATE_DIR: STATE, BRIDGE_SKILLS_DIR: SKILLS, BRIDGE_SKILLS: '',
      WERKBANK_URL: `http://127.0.0.1:${(web.address() as any).port}`, WERKBANK_INTERNAL_TOKEN: 'geheim', BRIDGE_CLAUDE_HOMES: HOMES, WERKBANK_ORCH_ROOTS: ORCH, WERKBANK_SKILLS_SOURCE: SKILLS,
      BRIDGE_CLAUDE_CONFIG_SHARED: '', BRIDGE_CLAUDE_CONFIG: '', BRIDGE_PERMISSION_MODE: 'auto', BRIDGE_AUTO_SCOPE: 'voll', BRIDGE_AUTO_EMAILS: 'knut@maxenergy.at',
      BRIDGE_OPENCODE2_HOME: OC2, BRIDGE_OPENCODE2_PORTS: String(OC2_PORT), BRIDGE_GATE_CHECKLISTE: 'aus', ...extra },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stdout!.on('data', (d) => { out += d; }); proc.stderr!.on('data', (d) => { out += d; });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) return; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('Brücke startet nicht');
};
const stop = async () => { if (proc && proc.exitCode === null) { proc.kill(); await new Promise((r) => proc.once('exit', r)); } };
before(async () => {
  web = createServer(async (req, res) => {
    let b = ''; for await (const c of req) b += c;
    if (req.headers['x-werkbank-internal'] !== 'geheim') { res.statusCode = 403; res.end('{}'); return; }
    if (req.url?.endsWith('/claude-accounts')) { res.end(JSON.stringify({ accounts: konten })); return; }
    if (req.url?.endsWith('/zug-log')) zugLog.push(JSON.parse(b).zug);
    res.end('{}');
  });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', () => r()));
});
after(async () => { await stop(); web.close(); });

const conv = (n: number) => `00000000-0000-4000-9500-${String(n).padStart(12, '0')}`;
async function send(c: string, content: string) {
  const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, { method: 'POST',
    headers: { authorization: `Bearer ${tok('knut')}`, 'content-type': 'application/json', 'x-librechat-user-id': 'knut', 'x-librechat-conversation-id': c, 'x-librechat-user-email': 'knut@maxenergy.at' },
    body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content }] }) });
  return (await res.text()).split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)).choices[0]?.delta?.content ?? '').join('');
}
const register = async (c: string, dir: string) => {
  const r = await fetch(`http://127.0.0.1:${PORT}/internal/orchestrate`, { method: 'POST', headers: { 'x-werkbank-internal': 'geheim', 'content-type': 'application/json' }, body: JSON.stringify({ userId: 'knut', email: 'knut@maxenergy.at', conv: c, dir, laeufer: 'oc2' }) });
  assert.equal(r.status, 200, await r.text());
};
const spur = (f: string) => (existsSync(join(SPUR, f)) ? readFileSync(join(SPUR, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const orchState = async () => (await (await fetch(`http://127.0.0.1:${PORT}/internal/orch-state?user=knut`, { headers: { 'x-werkbank-internal': 'geheim' } })).json()) as any;

test('Schalter aus: der OC2-Strang läuft sichtbar mit Claude, mit Grund', async () => {
  await start({});
  try {
    const c = conv(1); await register(c, wt('aus'));
    const t = await send(c, 'BAUE etwas');
    assert.match(t, /opencode 2 lieferte kein brauchbares Ergebnis \(OC2-Stränge sind aus \(BRIDGE\\?_OPENCODE2\\?_STRANG\)\) — dieser Zug läuft mit Claude weiter/);
    assert.equal(spur('prompt').length, 0, 'kein opencode-2-Zug');
  } finally { await stop(); }
});

test('Gate: GLM baut, Claude lehnt ab → Befunde an DIESELBE Sitzung → ok; zweiter Zug setzt die Sitzung fort; MCP und Buchung', async () => {
  await start({ BRIDGE_BESTOFN: 'aus', BRIDGE_OPENCODE2_STRANG: 'an' });
  try {
    const dir = wt('gate'), c = conv(2); await register(c, dir);
    const t = await send(c, 'BAUE die Datei MOCK-ABLEHNEN');
    assert.match(t, /✅ Claude-Gate: ok \(Runden 1: abgelehnt · claude sonnet · 2: ok · claude sonnet\)/, t.slice(-800));
    assert.match(t, /Status: fertig/);
    assert.match(t, /Claude-Gate: abgelehnt \(Runde 1\) — Befunde gehen zurück an den GLM-Bauer/);
    assert.equal(readFileSync(join(dir, 'gebaut.txt'), 'utf8'), 'sauber\n');
    const p = spur('prompt');
    assert.equal(p.length, 2); assert.equal(p[0].id, p[1].id, 'Rückgabe an dieselbe Sitzung');
    assert.match(p[1].text, /abgelehnt \(Runde 1\)[\s\S]*MOCK-ABLEHNEN steht noch drin/);
    const neu = spur('neu'); assert.equal(neu.length, 1); assert.equal(neu[0].werkbank, true, 'MCP-Werkzeuge erlaubt');
    const srv = spur('server')[0]; assert.match(srv.pfadVorn, /claude-bridge\/shim$/); assert.equal(srv.projekt, '1'); assert.equal(srv.schluesselOk, true);
    const mcp = spur('mcp'); assert.ok(mcp.some((x) => x.url.includes(`location[directory]=${dir}`) && x.body?.config?.headers?.authorization?.startsWith('Bearer ')), JSON.stringify(mcp));
    // Verbrauchsbuch: zwei Bau-Runden auf opencode 2, zwei Verifizierer-Läufe auf Claude (gebucht ohne Warten — kurz nachsehen)
    for (let i = 0; i < 40 && zugLog.filter((z) => z.conv === c).length < 4; i++) await new Promise((r) => setTimeout(r, 50));
    const bau = zugLog.filter((z) => z.conv === c && z.laeufer === 'oc2'), rev = zugLog.filter((z) => z.conv === c && z.laeufer === 'claude');
    assert.equal(bau.length, 2); assert.equal(bau[0].aufgabe, 'bau'); assert.equal(bau[0].anbieter, 'melious'); assert.ok(bau[0].energie > 0);
    assert.deepEqual(rev.map((z) => z.outcome), ['abgelehnt', 'ok']); assert.equal(rev[0].aufgabe, 'review');
    const st = (await orchState()).find?.((x: any) => x.conv === c) ?? null;
    // Zweiter Zug: dieselbe Sitzung, nur die neue Nachricht (kein Verlauf), ohne Änderung → kein Gate
    const t2 = await send(c, 'Wie ist der Stand?');
    const p2 = spur('prompt');
    assert.equal(p2.length, 3); assert.equal(p2[2].id, p[0].id, 'Sitzung fortgesetzt'); assert.doesNotMatch(p2[2].text, /Bisheriger Verlauf/);
    assert.match(t2, /Nachricht 3/); assert.doesNotMatch(t2, /Claude-Gate/);
    void st;
  } finally { await stop(); }
});

// ports-p5: feste Testports waren im Parallelauf rot (ein fremder Dienst auf dem Port antwortet für die Testbrücke).
// Diese Datei nimmt ihre Ports aus freiePorts(); der Wächter hält das fest.
test('keine feste Portnummer in dieser Datei (ports-p5)', () => {
  const quelle = readFileSync(new URL('./oc2-basis.test.ts', import.meta.url), 'utf8');
  assert.match(quelle, /await freiePorts\(/, 'Ports kommen aus freiePorts');
  assert.doesNotMatch(quelle, /PORT\s*=\s*[0-9]{4,5}|\|\| ?[0-9]{4,5}[^0-9]|port[s]?:\s*[0-9]{4,5}/, 'feste Portnummer');
});

test('Melious unter der Untergrenze: kein OC2-Zug, Claude mit Grund', async () => {
  konten = [{ id: 'chat', label: 'Chat', token: null }, { ...MEL, fuell: 0.01 }];
  await start({ BRIDGE_BESTOFN: 'aus', BRIDGE_OPENCODE2_STRANG: 'an', BRIDGE_MELIOUS_BODEN: '5' });
  try {
    const vorher = spur('prompt').length;
    const c = conv(3); await register(c, wt('boden'));
    const t = await send(c, 'BAUE etwas');
    assert.match(t, /Melious unter der Untergrenze \(1 % \\?< 5 %\)/);
    assert.equal(spur('prompt').length, vorher);
  } finally { await stop(); konten = [{ id: 'chat', label: 'Chat', token: null }, MEL]; }
});
