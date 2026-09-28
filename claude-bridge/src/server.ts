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
import { handleTurn, stats, scratchFor, safeId, type Sink } from './sessions.ts';
import { skillsFor } from './skills.ts';
import { extractAttachments, saveAttachments, attachmentNote } from './attachments.ts';
import { mockQuery } from './mock.ts';
import { log } from './log.ts';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Werkbank-Web (Kontext-Paket, Task-Hygiene, Jira-Nachziehen) und die eigenen MCP-Server.
const WEB_URL = process.env.WERKBANK_URL || 'http://127.0.0.1:3070';
const STATE_DIR = process.env.BRIDGE_STATE_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.runtime', 'bridge');
const INTERNAL = process.env.WERKBANK_INTERNAL_TOKEN || '';
const MCP_DIR = process.env.WERKBANK_MCP_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'mcp');

/** MCP-Server nur für Werkbank-Sitzungen — die Nutzer-Konfiguration von Claude Code bleibt unberührt. */
function mcpServersFor(userId: string): Record<string, unknown> {
  const node = process.execPath;
  const servers: Record<string, unknown> = {
    'vault-search': {
      type: 'stdio', command: node, args: [join(MCP_DIR, 'vault-search.ts')],
      env: { WERKBANK_VAULT_DIR: process.env.BRIDGE_VAULT_DIR || '/vault', MEILI_HOST: process.env.MEILI_HOST || 'http://127.0.0.1:7700', MEILI_MASTER_KEY: process.env.MEILI_MASTER_KEY || '', PATH: process.env.PATH || '' },
    },
  };
  if (INTERNAL) {
    servers.werkbank = {
      type: 'stdio', command: node, args: [join(MCP_DIR, 'werkbank-tools.ts')],
      env: { WERKBANK_URL: WEB_URL, WERKBANK_INTERNAL_TOKEN: INTERNAL, WERKBANK_USER_ID: userId, PATH: process.env.PATH || '' },
    };
  }
  return servers;
}

async function sessionContext(userId: string, convId: string, eod: boolean, skills: unknown): Promise<string> {
  if (!INTERNAL) return '';
  const r = await fetch(`${WEB_URL}/internal/session-start`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL },
    body: JSON.stringify({ userId, conv: convId, eod, skills }), signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) throw new Error(`Werkbank ${r.status}`);
  const j: any = await r.json();
  log('kontext', { user: userId, tokens: j.tokens, cached: j.cached, questions: j.questions?.length ?? 0 });
  return String(j.text ?? '');
}

const PORT = Number(process.env.BRIDGE_PORT || 3090);
const HOST = process.env.BRIDGE_HOST || '127.0.0.1';
const MOCK = process.env.BRIDGE_MOCK === '1';

const MODELS: Record<string, string | undefined> = {
  'claude-code': undefined,          // Standardmodell von Claude Code
  'claude-code-sonnet': 'sonnet',
  'claude-code-opus': 'opus',
};
const TITLE_MODEL = 'olaf-titel';

// Pilot: Die Sitzungen laufen als VM-Nutzer (Knuts Dateien, Knuts Jira-Anmeldung).
// Deshalb nur freigegebene LibreChat-Konten; leer = alle (nur für Tests/Mock).
const ALLOWED_EMAILS = (process.env.BRIDGE_ALLOWED_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

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
    sink.write('Es ist noch kein Claude-Token hinterlegt. Führe im Terminal `claude setup-token` aus und trag den Token im Modell-Menü bei „Claude Code“ über das Zahnrad ein.');
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

  if (ALLOWED_EMAILS.length) {
    const email = (header(req, 'x-librechat-user-email') ?? '').toLowerCase();
    if (!ALLOWED_EMAILS.includes(email)) {
      log('not allowed', { user: header(req, 'x-librechat-user-id') ?? '?' });
      sink.write('Der Pilot der Werkbank ist noch nicht für dein Konto freigeschaltet: Claude Code läuft hier vorerst unter dem Nutzer der VM (mit dessen Dateien und Jira-Zugang). Der Team-Zugang kommt mit dem eigenen Team-Workspace.');
      return sink.finish();
    }
  }

  const lastUserIdx = messages.map((m) => m.role).lastIndexOf('user');
  let prompt = lastUserIdx >= 0 ? textOf(messages[lastUserIdx].content).trim() : '';
  const atts = lastUserIdx >= 0 ? extractAttachments(messages[lastUserIdx].content) : [];
  if (!prompt && !atts.length) { sink.write('Leere Nachricht.'); return sink.finish(); }

  const tokenHash = createHash('sha256').update(token).digest('hex').slice(0, 16);
  const userId = header(req, 'x-librechat-user-id') ?? `t-${tokenHash}`;
  const firstUser = textOf(messages.find((m) => m.role === 'user')?.content);
  const convId = header(req, 'x-librechat-conversation-id') ?? `h-${createHash('sha256').update(firstUser).digest('hex').slice(0, 24)}`;

  // Anhänge ins Arbeitsverzeichnis der Person legen und im Prompt nennen.
  if (atts.length) {
    const { saved, rejected } = saveAttachments(scratchFor(userId), convId, atts);
    log('attachments', { user: userId, saved: saved.length, rejected: rejected.length });
    prompt = (prompt || 'Sieh dir bitte die angehängten Dateien an.') + '\n' + attachmentNote(saved, rejected);
  }
  // Vorgabe der gewählten Vorlage (LibreChat schickt promptPrefix als System-Nachricht).
  const instructions = messages.filter((m) => m.role === 'system' || m.role === 'developer').map((m) => textOf(m.content)).join('\n\n').trim().slice(0, 8000);
  const readonly = header(req, 'x-werkbank-mode') === 'readonly';

  const history = messages.slice(0, lastUserIdx)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => `${m.role === 'user' ? 'Nutzer' : 'Claude'}: ${textOf(m.content)}`)
    .join('\n\n')
    .slice(-30000);

  const known = !!header(req, 'x-librechat-user-id');   // echtes Konto, nicht nur Token-Hash
  await handleTurn({
    userId, convId, token, prompt, history, model: MODELS[model], sink, query: query as any, readonly, instructions: instructions || undefined,
    sessionContext: known ? () => sessionContext(userId, convId, /Tagesabschluss/i.test(instructions) || /^\s*tagesabschluss\b/i.test(prompt), skillsFor(STATE_DIR, `${safeId(userId)}:${safeId(convId)}`, instructions, prompt)) : undefined,
    mcpServers: known ? mcpServersFor(userId) : undefined,
    onMeasure: known && INTERNAL ? (m) => {
      log('kontext gemessen', { user: userId, ...m });
      fetch(`${WEB_URL}/internal/measure`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify({ userId, conv: convId, measured: m }) }).catch(() => {});
    } : undefined,
  });
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
