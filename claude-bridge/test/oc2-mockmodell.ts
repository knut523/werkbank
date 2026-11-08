// Schein-Modell (OpenAI-kompatibel) für Tests gegen das echte opencode 2.2.5 — ohne Melious, ohne Energie. Gibt der Reihe nach die
// Schritte aus `schritte` aus (Werkzeugaufruf oder Text) und merkt sich jede Anfrage (Werkzeugliste, letzte Nachricht).
import { createServer, type Server } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { oc2Umgebung } from '../src/oc2server.ts';

export type Schritt = { tool: string; args: Record<string, unknown> } | { text: string };
export interface MockModell { neu(): void; port: number; anfragen: { tools: string[]; letzte: any; defs: any[]; nachrichten: any[] }[]; schritte: Schritt[]; stop(): Promise<void> }

export async function mockModell(schritte: Schritt[] = []): Promise<MockModell> {
  const anfragen: MockModell['anfragen'] = [];
  let n = 0;
  const m: MockModell = { neu: () => { n = 0; }, port: 0, anfragen, schritte, stop: async () => {} };
  const srv: Server = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      let j: any = {}; try { j = JSON.parse(b || '{}'); } catch { /* leer */ }
      if (!String(req.url).includes('chat/completions')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'glm-5.3-flash' }, { id: 'glm-5.3' }] })); return; }
      anfragen.push({ tools: (j.tools ?? []).map((t: any) => t.function?.name ?? t.name), letzte: (j.messages ?? []).slice(-1)[0], defs: j.tools ?? [], nachrichten: j.messages ?? [] });
      const s = m.schritte[n++] ?? { text: 'FERTIG' };
      const id = `call_${n}`, base = { id: `c${n}`, object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000), model: j.model };
      const usage = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
      const tc = 'tool' in s ? [{ index: 0, id, type: 'function', function: { name: s.tool, arguments: JSON.stringify(s.args) } }] : undefined;
      if (j.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const send = (o: any) => res.write(`data: ${JSON.stringify({ ...base, ...o })}\n\n`);
        send({ choices: [{ index: 0, delta: tc ? { role: 'assistant', tool_calls: tc } : { role: 'assistant', content: (s as any).text }, finish_reason: null }] });
        send({ choices: [{ index: 0, delta: {}, finish_reason: tc ? 'tool_calls' : 'stop' }], usage });
        res.end('data: [DONE]\n\n');
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ...base, object: 'chat.completion', choices: [{ index: 0, message: tc ? { role: 'assistant', content: null, tool_calls: tc.map(({ index: _i, ...r }) => r) } : { role: 'assistant', content: (s as any).text }, finish_reason: tc ? 'tool_calls' : 'stop' }], usage }));
      }
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  m.port = (srv.address() as any).port;
  m.stop = () => new Promise((r) => { srv.closeAllConnections?.(); srv.close(() => r()); });
  return m;
}

export const OC2_BIN = join(process.env.BRIDGE_OPENCODE2_HOME || join(homedir(), '.local', 'opencode2'), 'bin', 'opencode2');
export const oc2Da = () => existsSync(OC2_BIN);

/** Ein echter opencode-2-Server mit eigener Konfiguration: Provider „melious“ zeigt auf das Schein-Modell. */
export async function oc2MitMock(o: { tmp: string; mockPort: number; port?: number; passwort: string; pathVorn?: string; konfig?: Record<string, unknown>; envExtra?: Record<string, string> }): Promise<{ proc: ChildProcess; base: string; stop: () => void; env: Record<string, string> }> {
  const x = join(o.tmp, 'xdg');
  mkdirSync(join(x, 'config', 'opencode'), { recursive: true });
  writeFileSync(join(x, 'config', 'opencode', 'opencode.jsonc'), JSON.stringify({
    model: 'melious/glm-5.3-flash', small_model: 'melious/glm-5.3-flash', update: 'disable', share: 'disabled', snapshots: false, websearch: false,
    providers: { melious: { env: ['MELIOUS_API_KEY'], package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: `http://127.0.0.1:${o.mockPort}/v1` }, models: { 'glm-5.3-flash': { name: 'flash' }, 'glm-5.3': { name: 'glm' } } } },
    permissions: [{ action: '*', resource: '*', effect: 'deny' }],
    ...(o.konfig ?? {}),
  }, null, 1));
  // Dieselbe Umgebung wie in der Brücke (Wächter vorn im PATH, keine Projekt-Konfiguration), nur mit eigenem Ordner.
  const env: Record<string, string> = { ...oc2Umgebung(o.tmp, 'sk-mock', o.passwort), ...(o.pathVorn ? { PATH: `${o.pathVorn}:${oc2Umgebung(o.tmp, '', '').PATH}` } : {}), ...(o.envExtra ?? {}) };
  // opencode 2.2.5 meldet beim Start gelegentlich „port in use“ für einen freien Port — dann mit einem anderen Port neu.
  let letzter = '';
  for (let v = 0; v < 4; v++) {
    const port = o.port && !v ? o.port : 40000 + Math.floor(Math.random() * 9000);
    try { return await starte(port); } catch (e: any) { letzter = String(e?.message ?? e); }
  }
  throw new Error(letzter);
  async function starte(port: number) {
  const proc = spawn(OC2_BIN, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; proc.stderr?.on('data', (b) => { err = (err + b).slice(-4000); });
  const base = `http://127.0.0.1:${port}`, auth = `Basic ${Buffer.from(`opencode:${o.passwort}`).toString('base64')}`;
  const bis = Date.now() + 30_000;
  while (Date.now() < bis) {
    try { if ((await fetch(`${base}/api/session?limit=1`, { headers: { authorization: auth }, signal: AbortSignal.timeout(2000) })).status === 200) return { proc, base, env, stop: () => proc.kill('SIGKILL') }; } catch { /* startet */ }
    if (proc.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  proc.kill('SIGKILL');
  throw new Error(`opencode2 startet nicht: ${err.slice(-500)}`);
  }
}
