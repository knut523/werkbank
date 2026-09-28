// claude-bridge: OpenAI-kompatibler Endpunkt für LibreChat, dahinter Claude Code (Agent SDK).
//
//   GET  /health
//   GET  /v1/models
//   POST /v1/chat/completions   (stream: true → SSE, sonst JSON)
//
// Authorization: Bearer <Claude-OAuth-Token des Nutzers aus `claude setup-token`>.
// Der Token wird nur für die Dauer der Sitzung im Speicher gehalten und nie geloggt.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { handleTurn, stats, type Sink } from './sessions.ts';
import { mockQuery } from './mock.ts';
import { log } from './log.ts';

const PORT = Number(process.env.BRIDGE_PORT || 3090);
const HOST = process.env.BRIDGE_HOST || '127.0.0.1';
const MOCK = process.env.BRIDGE_MOCK === '1';

const MODELS: Record<string, string | undefined> = {
  'claude-code': undefined,          // Standardmodell von Claude Code
  'claude-code-sonnet': 'sonnet',
  'claude-code-opus': 'opus',
};
const TITLE_MODEL = 'olaf-titel';

const query = MOCK ? mockQuery : (await import('@anthropic-ai/claude-agent-sdk')).query;

// ---------- Hilfen ----------

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((p: any) => p?.type === 'text').map((p: any) => p.text).join('\n');
  return '';
}

function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 10 * 1024 * 1024) { reject(new Error('zu groß')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  // Nicht aufgelöste LibreChat-Platzhalter ignorieren.
  return s && !s.includes('{{') ? s : undefined;
}

// ---------- Antwort-Senken: SSE oder ein JSON-Stück ----------

function makeSink(res: ServerResponse, model: string, stream: boolean, includeUsage: boolean): Sink & { onClose: (fn: () => void) => void } {
  const id = 'chatcmpl-' + randomUUID();
  const created = Math.floor(Date.now() / 1000);
  let closed = false;
  let collected = '';
  const closeFns: (() => void)[] = [];
  let heartbeat: NodeJS.Timeout | undefined;
  const chunk = (delta: Record<string, unknown>, finish: string | null = null) =>
    `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;

  if (stream) {
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(chunk({ role: 'assistant', content: '' }));
    heartbeat = setInterval(() => res.write(': ping\n\n'), 15000);
  }
  res.on('close', () => {
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    for (const fn of closeFns) fn();
  });

  return {
    get closed() { return closed || res.writableEnded; },
    onClose(fn) { if (closed) fn(); else closeFns.push(fn); },
    write(text: string) {
      if (closed || res.writableEnded) return;
      if (stream) res.write(chunk({ content: text }));
      else collected += text;
    },
    finish(usage) {
      if (closed || res.writableEnded) return;
      if (heartbeat) clearInterval(heartbeat);
      const u = { prompt_tokens: usage?.input ?? 0, completion_tokens: usage?.output ?? 0, total_tokens: (usage?.input ?? 0) + (usage?.output ?? 0) };
      if (stream) {
        res.write(chunk({}, 'stop'));
        if (includeUsage) res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', created, model, choices: [], usage: u })}\n\n`);
        res.end('data: [DONE]\n\n');
      } else {
        json(res, 200, { id, object: 'chat.completion', created, model, choices: [{ index: 0, message: { role: 'assistant', content: collected }, finish_reason: 'stop' }], usage: u });
      }
    },
  };
}

// ---------- Titel ohne Claude-Aufruf ----------

function titleFrom(messages: any[]): string {
  const all = messages.map((m) => textOf(m.content)).join('\n');
  // LibreChats Titel-Vorlage enthält den Verlauf als "User: …" / "AI: …"
  const m = all.match(/(?:^|\n)\s*(?:User|Nutzer|Human)\s*:\s*(.+)/i);
  const src = (m ? m[1] : textOf(messages.at(-1)?.content)).replace(/[`*_#>"„“]/g, '').trim();
  const words = src.split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
  return (words.length > 60 ? words.slice(0, 59) + '…' : words) || 'Neuer Chat';
}

// ---------- Routen ----------

async function chat(req: IncomingMessage, res: ServerResponse) {
  const auth = String(req.headers.authorization ?? '');
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  let body: any;
  try { body = await readBody(req); } catch { return json(res, 400, { error: { message: 'Ungültiger JSON-Body' } }); }

  const model = String(body.model ?? 'claude-code');
  const stream = body.stream === true;
  const includeUsage = !!body.stream_options?.include_usage;
  const messages: any[] = Array.isArray(body.messages) ? body.messages : [];
  const sink = makeSink(res, model, stream, includeUsage);

  if (model === TITLE_MODEL) { sink.write(titleFrom(messages)); sink.finish(); return; }

  if (!token || token === 'user_provided') {
    sink.write('Es ist noch kein Claude-Token hinterlegt. Führe im Terminal `claude setup-token` aus und trag den Token im Schlüssel-Dialog dieses Endpunkts ein.');
    return sink.finish();
  }
  if (/^sk-ant-api/.test(token)) {
    sink.write('Das ist ein API-Schlüssel. Die Werkbank arbeitet ohne API-Schlüssel — bitte den Token aus `claude setup-token` eintragen (beginnt mit `sk-ant-oat`).');
    return sink.finish();
  }
  if (!(model in MODELS)) {
    sink.write(`Unbekanntes Modell „${model}“.`);
    return sink.finish();
  }

  const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user');
  const prompt = lastUserIdx >= 0 ? textOf(messages[lastUserIdx].content).trim() : '';
  if (!prompt) { sink.write('Leere Nachricht.'); return sink.finish(); }

  const tokenHash = createHash('sha256').update(token).digest('hex').slice(0, 16);
  const userId = header(req, 'x-librechat-user-id') ?? `t-${tokenHash}`;
  const firstUser = textOf(messages.find((m) => m.role === 'user')?.content);
  const convId = header(req, 'x-librechat-conversation-id') ?? `h-${createHash('sha256').update(firstUser).digest('hex').slice(0, 24)}`;

  const history = messages.slice(0, lastUserIdx)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => `${m.role === 'user' ? 'Nutzer' : 'Claude'}: ${textOf(m.content)}`)
    .join('\n\n')
    .slice(-30000);

  await handleTurn({ userId, convId, token, prompt, history, model: MODELS[model], sink, query: query as any });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, mock: MOCK, ...stats() });
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      return json(res, 200, { object: 'list', data: Object.keys(MODELS).map((id) => ({ id, object: 'model', created: 0, owned_by: 'olaf-werkbank' })) });
    }
    if (req.method === 'POST' && url.pathname === '/v1/chat/completions') return await chat(req, res);
    json(res, 404, { error: { message: 'Nicht gefunden' } });
  } catch (e: any) {
    log('request error', { path: url.pathname, error: String(e?.message ?? e).slice(0, 200) });
    if (!res.headersSent) json(res, 500, { error: { message: 'Interner Fehler' } });
    else res.end();
  }
});

server.listen(PORT, HOST, () => log('listening', { host: HOST, port: PORT, mock: MOCK }));
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { log('shutdown', { sig }); server.close(); process.exit(0); });
