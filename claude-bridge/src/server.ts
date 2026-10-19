// claude-bridge: OpenAI-kompatibler Endpunkt für LibreChat, dahinter Claude Code (Agent SDK).
//
//   GET  /health
//   GET  /v1/models
//   POST /v1/chat/completions   (stream: true → SSE, sonst JSON)
//
// Authorization: Bearer <Claude-OAuth-Token des Nutzers aus `claude setup-token`>.
// Der Token wird nur für die Dauer der Sitzung im Speicher gehalten und nie geloggt.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { handleTurn, stats, scratchFor, workDirFor, safeId, sessionsOf, registerOrchestration, orchStateOf, orchKindOf, endLeitstand, autoFor, injectMessage, injectState, STRAND_MODEL, TIEFEN, startDelegation, melSub, auslastungFuer, delegationStand, delegationUrteil, phaseWechseln, type Sink, type Tiefe } from './sessions.ts';
import { orchDirProblem } from './tools.ts';
import { skillsFor } from './skills.ts';
import { extractAttachments, saveAttachments, attachmentNote } from './attachments.ts';
import { mockQuery } from './mock.ts';
import { mcpCall, mcpStatus } from './mcpcall.ts';
import { directCall } from './mcpdirect.ts';
import { homeFor, ensureHome, atlassianServer, leitstandMcp, type ClaudeHome } from './claudehome.ts';
import { log } from './log.ts';
import { testAccount, loadAccounts, markExhausted, exhaustedOf, balanceStats, clearExhausted, MELIOUS_KEY, MELIOUS_ID, MELIOUS_MODEL } from './accounts.ts';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Werkbank-Web (Kontext-Paket, Task-Hygiene, Jira-Nachziehen) und die eigenen MCP-Server.
const WEB_URL = process.env.WERKBANK_URL || 'http://127.0.0.1:3070';
const STATE_DIR = process.env.BRIDGE_STATE_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.runtime', 'bridge');
const INTERNAL = process.env.WERKBANK_INTERNAL_TOKEN || '';
const MCP_DIR = process.env.WERKBANK_MCP_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'mcp');

/**
 * Die MCP-Server einer Werkbank-Sitzung — und nur diese (strictMcpConfig): vault-search, werkbank,
 * forge-review (falls eingerichtet), atlassian (Jira, OAuth je Claude-Konfiguration).
 */
function mcpServersFor(userId: string, claudeToken: string, home: ClaudeHome, convId = ''): Record<string, unknown> {
  const leit = orchKindOf(userId, convId) === 'leitstand';
  const strang = orchKindOf(userId, convId) === 'strand';   // Plan 154, S4: hauptchat_melden nur in Unter-Chats
  const node = process.execPath;
  const servers: Record<string, unknown> = {
    'vault-search': {
      type: 'stdio', command: node, args: [join(MCP_DIR, 'vault-search.ts')],
      env: { WERKBANK_VAULT_DIR: process.env.BRIDGE_VAULT_DIR || '/vault', MEILI_HOST: process.env.MEILI_HOST || 'http://127.0.0.1:7700', MEILI_MASTER_KEY: process.env.MEILI_MASTER_KEY || '', PATH: process.env.PATH || '',
        // Such-Protokoll (web/mcp/search-log.ts, zwei Wochen): Person und Unterhaltung nur gehasht im Protokoll.
        WERKBANK_SEARCH_LOG_DIR: process.env.WERKBANK_SEARCH_LOG_DIR || join(STATE_DIR, '..', 'search-log'),
        WERKBANK_SEARCH_LOG: process.env.WERKBANK_SEARCH_LOG || '', WERKBANK_SEARCH_LOG_UNTIL: process.env.WERKBANK_SEARCH_LOG_UNTIL || '',
        WERKBANK_USER_ID: userId, WERKBANK_CONV_ID: convId },
    },
  };
  // forge-review (PR-Review als Entwurf, nur lesend gegen GitHub), angebunden über WERKBANK_FORGE_MCP
  // (Launcher ~/work/forge/tools/forge-review-mcp). Die Modellaufrufe laufen mit dem Claude-Zugang
  // DER PERSON (CLAUDE_CODE_OAUTH_TOKEN), nie mit dem Login der VM. Den GitHub-Lese-Token liest der
  // Launcher selbst aus seiner Datei (FORGE_REVIEW_ENV); die Brücke reicht keine Werkbank-Geheimnisse durch.
  if (process.env.WERKBANK_FORGE_MCP) {
    const [command, ...args] = process.env.WERKBANK_FORGE_MCP.split(' ');
    servers['forge-review'] = {
      type: 'stdio', command, args,
      env: {
        PATH: process.env.PATH || '', HOME: process.env.HOME || '',
        FORGE_REVIEW_ENV: process.env.FORGE_REVIEW_ENV || '',
        CLAUDE_CODE_OAUTH_TOKEN: claudeToken,
        ...(home.dir ? { CLAUDE_CONFIG_DIR: home.dir } : {}),
      },
    };
  }
  if (INTERNAL) {
    servers.werkbank = {
      type: 'stdio', command: node, args: [join(MCP_DIR, 'werkbank-tools.ts')],
      // WERKBANK_CONV_ID: review_ready markiert nur den Lauf DIESER Unterhaltung (nie aus den Argumenten des Agenten).
      // WERKBANK_LEITSTAND: nur aus der Art in der Brücke (orch.json), nie aus einem Header (Plan 132, S3).
      // WERKBANK_BRIDGE_URL (Plan 165): delegieren/delegation_*/phase_wechseln rufen die Brücke direkt (Stränge); melious_sub und
      // auslastung auch der Lead (Knut 19.10., native Verteilung).
      env: { WERKBANK_URL: WEB_URL, WERKBANK_INTERNAL_TOKEN: INTERNAL, WERKBANK_USER_ID: userId, WERKBANK_CONV_ID: convId, PATH: process.env.PATH || '', ...(leit ? { WERKBANK_LEITSTAND: '1' } : {}), ...(strang ? { WERKBANK_STRANG: '1' } : {}), ...(strang || leit ? { WERKBANK_BRIDGE_URL: `http://127.0.0.1:${PORT}` } : {}) },
    };
  }
  return { ...(leit ? leitstandMcp() : {}), ...servers, ...atlassianServer() };
}

/** Claude-Konten der Person in Reihenfolge (Werkbank, interner Kanal). chat = der Schlüssel aus der Anfrage. */
// 10 s und ein Wiederholversuch, sonst die letzte geladene Liste der Person (Hotfix 15b: 3 s reichten bei fünf Zügen nicht).
async function claudeAccounts(userId: string): Promise<{ id: string; label: string; token: string | null }[]> {
  return loadAccounts(userId, async () => {
    const r = await fetch(`${WEB_URL}/internal/claude-accounts`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL },
      body: JSON.stringify({ userId }), signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`Werkbank ${r.status}`);
    const j: any = await r.json();
    return Array.isArray(j.accounts) ? j.accounts : [];
  }) as Promise<{ id: string; label: string; token: string | null }[]>;
}

async function sessionContext(userId: string, convId: string, eod: boolean, skills: unknown): Promise<string> {
  if (!INTERNAL) return '';
  const r = await fetch(`${WEB_URL}/internal/session-start`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL },
    body: JSON.stringify({ userId, conv: convId, eod, skills }), signal: AbortSignal.timeout(10_000),
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
  'claude-code-haiku': 'haiku',      // nicht im Modellmenü; für den Modellvergleich (Plan 162) über die API der Brücke
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
    reason(text: string) {
      // Nur im Stream: LibreChat liest `reasoning_content` bei eigenen Endpunkten als Denk-Abschnitt.
      if (closed || res.writableEnded || !stream) return;
      res.write(chunk({ reasoning_content: text }));
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
  // Vom Board angelegte Chats beginnen mit „PM-123 · Titel“ — die Zeile ist der Titel.
  if (/^[A-Z][A-Z0-9]+-\d+ · \S/.test(src)) return src.length > 70 ? src.slice(0, 69) + '…' : src;
  const words = src.split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
  return (words.length > 60 ? words.slice(0, 59) + '…' : words) || 'Neuer Chat';
}

function internalOk(req: IncomingMessage): boolean {
  const want = Buffer.from(INTERNAL);
  const got = Buffer.from(String(req.headers['x-werkbank-internal'] ?? ''));
  return want.length > 0 && want.length === got.length && timingSafeEqual(want, got);
}

// ---------- Routen ----------

async function chat(req: IncomingMessage, res: ServerResponse) {
  const receivedAt = Date.now();
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
    sink.write('Das ist ein API-Schlüssel. Der OLAF Workspace arbeitet ohne API-Schlüssel — bitte den Token aus `claude setup-token` eintragen (beginnt mit `sk-ant-oat`).');
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
      sink.write('Der Pilot des OLAF Workspace ist noch nicht für dein Konto freigeschaltet: Claude Code läuft hier vorerst unter dem Nutzer der VM (mit dessen Dateien und Jira-Zugang). Der Team-Zugang kommt mit dem eigenen Team-Workspace.');
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

  // Anhänge in den Arbeitsordner dieses Chats legen und im Prompt nennen (relativer Pfad = relativ zu dessen cwd).
  if (atts.length) {
    const { saved, rejected } = saveAttachments(workDirFor(userId, convId), convId, atts);
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
  const email = (header(req, 'x-librechat-user-email') ?? '').toLowerCase() || undefined;
  await handleTurn({ email,
    userId, convId, token, prompt, history, model: MODELS[model], sink, query: query as any, readonly, receivedAt, instructions: instructions || undefined,
    sessionContext: known ? () => sessionContext(userId, convId, /Tagesabschluss/i.test(instructions) || /^\s*tagesabschluss\b/i.test(prompt), skillsFor(STATE_DIR, `${safeId(userId)}:${safeId(convId)}`, instructions, prompt)) : undefined,
    mcpServers: known ? mcpServersFor(userId, token, homeFor(safeId(userId), email), convId) : undefined,
    // Plan 165: Worker bekommen die MCP-Server ihrer eigenen (verdeckten) Unterhaltung; Protokoll je Zug und Delegation.
    mcpFor: known ? (c) => mcpServersFor(userId, token, homeFor(safeId(userId), email), c) : undefined,
    onTurnLog: known && INTERNAL ? (z) => {
      fetch(`${WEB_URL}/internal/zug-log`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify({ userId, zug: z }) }).catch(() => {});
    } : undefined,
    onDelegation: known && INTERNAL ? (d) => {
      fetch(`${WEB_URL}/internal/delegation-log`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify({ userId, delegation: d }) }).catch(() => {});
    } : undefined,
    // Mehrere Claude-Konten: bei rate_limit übernimmt das nächste (Liste über den internen Kanal, nie vom Browser).
    accounts: known && INTERNAL ? () => claudeAccounts(userId) : undefined,
    // Jira im Chat geändert → Werkbank zieht die Tickets sofort nach und schiebt die Änderung an offene Boards.
    onJiraWrite: known && INTERNAL ? (keys, tool) => {
      log('jira im chat geschrieben', { user: userId, keys, tool });
      fetch(`${WEB_URL}/internal/jira-touched`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify({ userId, keys, tool }) }).catch(() => {});
    } : undefined,
    onSkill: known && INTERNAL ? (name) => {
      if (!/^[\w:.-]{1,80}$/.test(name)) return;
      fetch(`${WEB_URL}/internal/skill-used`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify({ userId, skill: name }) }).catch(() => {});
    } : undefined,
    // Melious (Plan 162): Verbrauch je Versuch an die Werkbank (zählt Tag/Monat, warnt bei 80 %, sperrt bei 100 %).
    onMeliousUsage: known && INTERNAL ? (u, model) => {
      fetch(`${WEB_URL}/internal/melious-usage`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify({ userId, conv: convId, usage: u, model }) }).catch(() => {});
    } : undefined,
    onMeasure: known && INTERNAL ? (m) => {
      log('kontext gemessen', { user: userId, ...m });
      fetch(`${WEB_URL}/internal/measure`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': INTERNAL }, body: JSON.stringify({ userId, conv: convId, measured: m }) }).catch(() => {});
    } : undefined,
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  try {
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, mock: MOCK, ...stats(), konten: balanceStats() });
    // Sitzungen einer Person (nur für Werkbank-Web, mit internem Token; ohne Inhalte außer dem Kurztitel).
    if (req.method === 'GET' && url.pathname === '/sessions') {
      if (!INTERNAL || req.headers['x-werkbank-internal'] !== INTERNAL) return json(res, 403, { error: 'Nicht erlaubt' });
      return json(res, 200, { sessions: sessionsOf(url.searchParams.get('user') ?? '') });
    }
    // Orchestrator-Stränge (docs/plan-orchestrator-agents.md): Anmeldung einer neuen Unterhaltung mit Arbeitsordner, Zustand.
    if (req.method === 'POST' && url.pathname === '/internal/orchestrate') {
      if (!internalOk(req)) return json(res, 403, { error: 'Nicht erlaubt' });
      const b = await readBody(req);
      const userId = String(b.userId ?? ''), conv = String(b.conv ?? '');
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId) || !/^[0-9a-f-]{36}$/.test(conv)) return json(res, 400, { error: 'Ungültige Person oder Unterhaltung.' });
      const email = String(b.email ?? '').toLowerCase();
      if (ALLOWED_EMAILS.length && !ALLOWED_EMAILS.includes(email)) return json(res, 403, { error: 'Konto nicht freigeschaltet.' });
      const { problem, real } = orchDirProblem(String(b.dir ?? ''));
      if (problem) return json(res, 400, { error: problem });
      // Leitstand (Plan 132, S1): nur für LEITSTAND_EMAILS (Vorgabe: BRIDGE_AUTO_EMAILS), unabhängig von der Freigabeliste.
      const kind = b.kind === 'leitstand' ? 'leitstand' : 'strand';
      if (kind === 'leitstand') {
        const leitEmails = String(process.env.LEITSTAND_EMAILS ?? process.env.BRIDGE_AUTO_EMAILS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
        if (!email || !leitEmails.includes(email)) return json(res, 403, { error: 'Hauptchat nur für freigeschaltete Admins (LEITSTAND_EMAILS).' });
      }
      // Modell und Risikostufe des Strangs (Plan 162, S2) — nur bei der Anmeldung, kein Wechsel mitten im Strang.
      // Der Hauptchat läuft nie auf Melious und hat keine Risikostufe (Review 2, Befund 2): nur für Stränge.
      const modell = kind === 'strand' && typeof b.modell === 'string' && b.modell ? b.modell : undefined;
      if (modell && !STRAND_MODEL.test(modell)) return json(res, 400, { error: 'Modell: claude:opus|sonnet|haiku oder melious:<modell>.' });
      const risiko = kind !== 'strand' ? undefined : b.risiko === 'niedrig' || b.risiko === 'mittel' || b.risiko === 'hoch' ? b.risiko : undefined;
      // Rollen-Profil (Plan 162, S6): nur Stränge, nur beim Start.
      const profil = kind === 'strand' && (b.profil === 'bauer' || b.profil === 'leser' || b.profil === 'schreiber' || b.profil === 'release') ? b.profil : undefined;
      if (kind === 'strand' && b.profil && !['voll', 'bauer', 'leser', 'schreiber', 'release'].includes(String(b.profil))) return json(res, 400, { error: 'Profil: voll, bauer, leser, schreiber oder release.' });
      // Tiefe (Plan 205): nur Stränge, nur beim Start; unbekannt → 400.
      if (kind === 'strand' && b.tiefe != null && !TIEFEN.includes(b.tiefe)) return json(res, 400, { error: 'Tiefe: quick, regular oder deep.' });
      const tiefe = kind === 'strand' ? b.tiefe as Tiefe | undefined : undefined;
      try { registerOrchestration(userId, conv, real!, kind, { modell, risiko, profil, tiefe, vorrang: b.vorrang === true }); } catch (e: any) { return json(res, e.status ?? 500, { error: e.message }); }
      log(kind === 'leitstand' ? 'leitstand angemeldet' : 'strang angemeldet', { user: userId, conv });
      return json(res, 200, { ok: true, dir: real, mode: autoFor({ email }) });
    }
    if (req.method === 'POST' && url.pathname === '/internal/orchestrate/end') {
      if (!internalOk(req)) return json(res, 403, { error: 'Nicht erlaubt' });
      const b = await readBody(req);
      return json(res, 200, { ok: endLeitstand(String(b.userId ?? ''), String(b.conv ?? '')) });
    }
    // Nachreichen während des Zugs (docs/plan-hauptchat-monitor.md, S1): nur für Werkbank-Web; der Schlüssel person:chat
    // beschränkt jede Nachricht auf die eigenen Unterhaltungen der Person.
    if (req.method === 'POST' && url.pathname === '/internal/inject') {
      if (!internalOk(req)) return json(res, 403, { error: 'Nicht erlaubt' });
      const b = await readBody(req);
      const userId = String(b.userId ?? ''), conv = String(b.conv ?? '');
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId) || !/^[0-9a-f-]{36}$/.test(conv)) return json(res, 400, { error: 'Ungültige Person oder Unterhaltung.' });
      const r = injectMessage(userId, conv, String(b.text ?? ''));
      return r.ok ? json(res, 200, { id: r.id, state: 'zugestellt' }) : json(res, r.status, { error: r.error });
    }
    const inj = req.method === 'GET' ? url.pathname.match(/^\/internal\/inject\/([0-9a-f-]{36})$/) : null;
    if (inj) {
      if (!internalOk(req)) return json(res, 403, { error: 'Nicht erlaubt' });
      const st = injectState(url.searchParams.get('user') ?? '', inj[1]);
      return st ? json(res, 200, { id: inj[1], ...st }) : json(res, 404, { error: 'unbekannt' });
    }
    // Plan 165: Werkzeuge der Strang-Leads (Werkbank-MCP mit Person und Unterhaltung aus seiner Umgebung, nie aus Argumenten).
    const deleg = req.method === 'POST' ? url.pathname.match(/^\/internal\/(delegate|delegate-stand|delegate-urteil|phase|mel-sub|auslastung)$/) : null;
    if (deleg) {
      if (!internalOk(req)) return json(res, 403, { error: 'Nicht erlaubt' });
      const b = await readBody(req);
      const userId = String(b.userId ?? ''), conv = String(b.conv ?? '');
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId) || !/^[A-Za-z0-9_-]{1,64}$/.test(conv)) return json(res, 400, { error: 'Ungültige Person oder Unterhaltung.' });
      // Knut 19.10.: melious_sub und auslastung auch für den Lead (native Verteilung Claude ↔ Melious).
      const fn = { delegate: startDelegation, 'delegate-stand': delegationStand, 'delegate-urteil': delegationUrteil, phase: phaseWechseln, 'mel-sub': melSub, auslastung: (u: string, c: string) => auslastungFuer(u, c) }[deleg[1] as 'delegate'];
      const r = await fn(userId, conv, b);
      return r.ok ? json(res, 200, r) : json(res, r.status, { error: r.error });
    }
    if (req.method === 'GET' && url.pathname === '/internal/orch-state') {
      if (!internalOk(req)) return json(res, 403, { error: 'Nicht erlaubt' });
      return json(res, 200, { strands: orchStateOf(url.searchParams.get('user') ?? '') });
    }
    // Ein bestätigter MCP-Aufruf (Jira-Schreiben vom Board) bzw. der MCP-Status — nur für Werkbank-Web.
    if (req.method === 'POST' && (url.pathname === '/internal/mcp-call' || url.pathname === '/internal/mcp-status')) {
      if (!INTERNAL || req.headers['x-werkbank-internal'] !== INTERNAL) return json(res, 403, { error: 'Nicht erlaubt' });
      const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
      if (!/^sk-ant-oat|^mock-/.test(token) && !MOCK) return json(res, 400, { ok: false, error: 'claude_auth', message: 'Kein gültiger Claude-Token.' });
      const b = await readBody(req);
      const uid = String(b.userId ?? 'werkbank');
      const cwd = scratchFor(uid);
      const home = homeFor(safeId(uid), b.email ? String(b.email) : undefined);
      await ensureHome(home);
      if (url.pathname === '/internal/mcp-status') return json(res, 200, { ...(await mcpStatus(query as any, token, cwd, home)), home: { mode: home.mode, dir: home.dir } });
      if (!/^mcp__[\w-]+__\w+$/.test(String(b.tool ?? ''))) return json(res, 400, { ok: false, error: 'failed', message: 'Ungültiges Werkzeug.' });
      const t0 = Date.now();
      // Schnell: direkt als MCP-Client mit Claude Codes gespeichertem Atlassian-Zugang (kein Modell). Geht das nicht
      // (kein/abgelaufener Zugang, Mock), der bisherige Weg über eine Claude-Sitzung. BRIDGE_MCP_DIRECT=off schaltet ab.
      const direct = MOCK || process.env.BRIDGE_MCP_DIRECT === 'off' ? null : await directCall({ home, tool: String(b.tool), input: b.input ?? {} });
      const r = direct ?? await mcpCall(query as any, { token, cwd, home, tool: String(b.tool), input: b.input ?? {} });
      log('mcp call', { user: String(b.userId ?? '?'), tool: b.tool, ok: r.ok, error: r.error, ms: Date.now() - t0, via: direct ? 'direkt' : 'sitzung' });
      return json(res, 200, r);
    }
    // Mehrere Claude-Konten (nur für Werkbank-Web): Zustand je Person (erschöpft bis …) und Test eines Kontos.
    if (req.method === 'GET' && url.pathname === '/internal/accounts-state') {
      if (!INTERNAL || req.headers['x-werkbank-internal'] !== INTERNAL) return json(res, 403, { error: 'Nicht erlaubt' });
      const ex = exhaustedOf(safeId(url.searchParams.get('user') ?? ''));
      return json(res, 200, { exhausted: Object.fromEntries(Object.entries(ex).map(([id, v]) => [id, v.until])) });
    }
    if (req.method === 'POST' && url.pathname === '/internal/account-test') {
      if (!INTERNAL || req.headers['x-werkbank-internal'] !== INTERNAL) return json(res, 403, { error: 'Nicht erlaubt' });
      const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
      const b = await readBody(req);
      const melious = b.kind === 'melious';
      if (melious ? !MELIOUS_KEY.test(token) : !/^sk-ant-oat/.test(token) && !MOCK) return json(res, 400, { ok: false, error: 'auth' });
      const uid = String(b.userId ?? 'werkbank');
      const home = homeFor(safeId(uid), b.email ? String(b.email) : undefined);
      await ensureHome(home);
      const model = melious && typeof b.model === 'string' && MELIOUS_MODEL.test(b.model) ? b.model : undefined;
      const r = await testAccount(query as any, { token, cwd: scratchFor(uid), home, melious, model });
      const accountId = melious ? MELIOUS_ID : String(b.accountId ?? '');
      if ((r.error === 'rate_limit' || r.error === 'guthaben') && /^[\w-]{1,40}$/.test(accountId)) markExhausted(safeId(uid), { id: accountId, label: accountId, token }, r.resetsAt);
      // Melious getestet und ok → ein alter Vermerk (z. B. „Guthaben leer“ vor dem Aufladen) ist hinfällig.
      if (r.ok && melious) clearExhausted(safeId(uid), MELIOUS_ID);
      log('kontotest', { user: uid, konto: accountId, ok: r.ok, error: r.error });
      return json(res, 200, r);
    }
    // Vermerk „erschöpft“ eines Kontos aufheben (Einrichtung: „zurücksetzen“, nur für Werkbank-Web).
    if (req.method === 'POST' && url.pathname === '/internal/accounts-reset') {
      if (!INTERNAL || req.headers['x-werkbank-internal'] !== INTERNAL) return json(res, 403, { error: 'Nicht erlaubt' });
      const b = await readBody(req);
      const id = String(b.accountId ?? '');
      if (!/^[\w-]{1,40}$/.test(id)) return json(res, 400, { error: 'Ungültiges Konto.' });
      const ok = clearExhausted(safeId(String(b.userId ?? '')), id);
      log('konto zurückgesetzt', { user: String(b.userId ?? '?'), konto: id, war: ok });
      return json(res, 200, { ok });
    }
    if (req.method === 'GET' && url.pathname === '/v1/models') {
      return json(res, 200, { object: 'list', data: Object.keys(MODELS).filter((id) => id !== 'claude-code-haiku').map((id) => ({ id, object: 'model', created: 0, owned_by: 'olaf-werkbank' })) });
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
