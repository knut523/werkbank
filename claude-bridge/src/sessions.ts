// Eine Claude-Code-Sitzung je LibreChat-Unterhaltung.
//
// Ablauf eines Zuges: query() des Agent SDK läuft, die Nachrichten werden in lesbaren Text
// übersetzt und in die gerade offene HTTP-Antwort ("Sink") geschrieben. Will Claude schreiben,
// hält der PreToolUse-Hook an, stellt die Rückfrage, schließt die Antwort — und wartet, bis die
// nächste Nachricht in derselben Unterhaltung kommt ("ja"/"nein"). Dann läuft dieselbe Sitzung
// weiter und schreibt in die neue Antwort.

import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { classify, statusLine, confirmQuestion, parseAnswer, VAULT_DIR } from './tools.ts';
import { log } from './log.ts';

export interface Sink {
  write(text: string): void;
  finish(usage?: { input: number; output: number }): void;
  readonly closed: boolean;
}

type QueryFn = (p: { prompt: string; options: Record<string, any> }) => AsyncIterable<any> & { interrupt?: () => Promise<void> };

interface Pending {
  resolve: (answer: string) => void;
  timer: NodeJS.Timeout;
}

interface Live {
  key: string;
  userId: string;
  abort: AbortController;
  sink: Sink | null;
  buffer: string[];
  pending: Pending | null;
  lastKind: 'none' | 'text' | 'status';
  lastStatus: string;
  sawStreamText: boolean;
  usage: { input: number; output: number };
  turnTimer: NodeJS.Timeout | null;
  confirmChain: Promise<unknown>;
}

const cfg = {
  stateDir: process.env.BRIDGE_STATE_DIR || join(process.cwd(), '..', '.runtime', 'bridge'),
  maxTurns: Number(process.env.BRIDGE_MAX_TURNS || 40),
  turnTimeoutMs: Number(process.env.BRIDGE_TURN_TIMEOUT_S || 900) * 1000,
  confirmTimeoutMs: Number(process.env.BRIDGE_CONFIRM_TIMEOUT_S || 1800) * 1000,
};

const SYSTEM_APPEND = `
Du läufst in der OLAF-Werkbank: Die Person schreibt dir über eine Chat-Oberfläche (LibreChat), nicht im Terminal.
- Antworte auf Deutsch, in gut lesbarem Markdown.
- Der Obsidian-Vault liegt unter ${VAULT_DIR}. Lies ihn frei.
- Schreibzugriffe (Dateien schreiben/ändern, Bash-Befehle, Jira ändern) bestätigt die Person im Chat. Frag nicht selbst vorher nach, sondern ruf das Werkzeug direkt auf — das System stellt die Rückfrage und macht nach "ja" weiter. Wird ein Aufruf abgelehnt, respektiere das und frag nach, was stattdessen gewünscht ist.
- GitHub schreiben, pushen und mergen ist hier gesperrt.
- Rückfragen stellst du als normalen Text am Ende deiner Antwort.
`.trim();

// ---------- Zuordnung Unterhaltung → SDK-Sitzung (ohne Geheimnisse, als JSON-Datei) ----------

mkdirSync(cfg.stateDir, { recursive: true });
const mapFile = join(cfg.stateDir, 'sessions.json');
let sessionMap: Record<string, string> = {};
try { sessionMap = JSON.parse(readFileSync(mapFile, 'utf8')); } catch { /* erste Sitzung */ }

function saveMap() {
  const tmp = mapFile + '.tmp';
  writeFileSync(tmp, JSON.stringify(sessionMap, null, 1));
  renameSync(tmp, mapFile);
}

const lives = new Map<string, Live>();       // Unterhaltung → laufende Sitzung
const userLive = new Map<string, string>();  // Nutzer → Unterhaltung mit laufender Sitzung

export function stats() {
  return { live: lives.size, pending: [...lives.values()].filter(l => l.pending).length, sessions: Object.keys(sessionMap).length };
}

export function safeId(s: string): string {
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : createHash('sha256').update(s).digest('hex').slice(0, 24);
}

// ---------- Ausgabe ----------

function emit(live: Live, text: string) {
  if (!text) return;
  if (live.sink && !live.sink.closed) live.sink.write(text);
  else live.buffer.push(text);
}

function emitText(live: Live, text: string) {
  if (live.lastKind === 'status') text = '\n' + text.replace(/^\n+/, '');
  live.lastKind = 'text';
  emit(live, text);
}

function emitStatus(live: Live, line: string) {
  // Kursiv, eine Zeile je Werkzeug; mehrere Statuszeilen stehen kompakt untereinander.
  if (line === live.lastStatus) return;
  const sep = live.lastKind === 'text' ? '\n\n' : '';
  live.lastKind = 'status';
  live.lastStatus = line;  // dieselbe Warnung nicht doppelt (s. o.)
  emit(live, `${sep}*${line.replace(/([\\*_\[\]<>])/g, '\\$1')}*  \n`);
}

function detach(live: Live) {
  if (live.turnTimer) { clearTimeout(live.turnTimer); live.turnTimer = null; }
  const s = live.sink;
  live.sink = null;
  if (s && !s.closed) s.finish(live.usage);
}

function attach(live: Live, sink: Sink) {
  live.sink = sink;
  live.lastKind = 'none';
  for (const t of live.buffer.splice(0)) sink.write(t);
  if (live.turnTimer) clearTimeout(live.turnTimer);
  live.turnTimer = setTimeout(() => {
    log('turn timeout', { conv: live.key });
    emitStatus(live, '⏱️ Zeitlimit erreicht — ich breche diesen Schritt ab. Schreib einfach weiter, die Unterhaltung bleibt erhalten.');
    live.abort.abort();
  }, cfg.turnTimeoutMs);
}

function end(live: Live) {
  if (live.pending) { clearTimeout(live.pending.timer); live.pending = null; }
  detach(live);
  lives.delete(live.key);
  if (userLive.get(live.userId) === live.key) userLive.delete(live.userId);
}

// ---------- Übersetzung der SDK-Nachrichten ----------

const AUTH_HINTS: Record<string, string> = {
  authentication_failed: 'Dein Claude-Token wurde abgelehnt. Erzeuge im Terminal mit `claude setup-token` einen neuen und trag ihn im Modell-Menü bei „Claude Code“ über das Zahnrad ein.',
  oauth_org_not_allowed: 'Dein Claude-Konto darf hier nicht verwendet werden (Organisation nicht zugelassen).',
  billing_error: 'Claude meldet ein Abrechnungsproblem mit deinem Konto.',
  rate_limit: 'Dein Claude-Kontingent ist gerade ausgeschöpft. Bitte später noch einmal.',
  overloaded: 'Claude ist gerade überlastet. Bitte gleich noch einmal versuchen.',
};

function handleMessage(live: Live, msg: any) {
  switch (msg.type) {
    case 'system':
      if (msg.subtype === 'init' && msg.session_id && sessionMap[live.key] !== msg.session_id) {
        sessionMap[live.key] = msg.session_id;
        saveMap();
      }
      return;
    case 'stream_event': {
      if (msg.parent_tool_use_id) return;
      const ev = msg.event;
      if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        live.sawStreamText = true;
        emitText(live, ev.delta.text);
      }
      return;
    }
    case 'assistant': {
      if (msg.error) {
        emitStatus(live, `⚠️ ${AUTH_HINTS[msg.error] ?? `Claude meldet einen Fehler (${msg.error}).`}`);
      }
      for (const block of msg.message?.content ?? []) {
        if (block.type === 'tool_use') {
          const cls = classify(block.name, block.input ?? {}).cls;
          if (cls === 'read') emitStatus(live, (msg.parent_tool_use_id ? '↳ ' : '') + statusLine(block.name, block.input ?? {}));
          // Schreibende Werkzeuge melden sich erst nach der Bestätigung (siehe Hook).
        } else if (block.type === 'text' && !live.sawStreamText && !msg.parent_tool_use_id && !msg.error) {
          emitText(live, block.text);
        }
      }
      return;
    }
    case 'result': {
      const u = msg.usage ?? {};
      live.usage.input += (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      live.usage.output += u.output_tokens ?? 0;
      if (msg.subtype === 'error_max_turns') emitStatus(live, `⏹️ Maximale Schrittzahl (${cfg.maxTurns}) erreicht. Schreib „weiter“, dann mache ich dort weiter.`);
      else if (msg.subtype !== 'success' || msg.is_error) emitStatus(live, /authenticat|401|token/i.test(String(msg.result ?? '')) ? `⚠️ ${AUTH_HINTS.authentication_failed}` : '⚠️ Bei der Ausführung ist ein Fehler aufgetreten.');
      return;
    }
  }
}

// ---------- Bestätigung für Schreibzugriffe ----------

function makeGuard(live: Live) {
  return async (input: any) => {
    const tool: string = input.tool_name;
    const toolInput: Record<string, unknown> = input.tool_input ?? {};
    const { cls, why } = classify(tool, toolInput);
    const decide = (permissionDecision: 'allow' | 'deny', reason: string) => ({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason: reason },
    });
    if (cls === 'read') return decide('allow', 'Lesen ist ohne Rückfrage erlaubt.');
    if (cls === 'blocked') {
      emitStatus(live, `⛔ Gesperrt im Pilot: ${why}`);
      return decide('deny', `Im OLAF-Werkbank-Pilot gesperrt (${why}). Nicht erneut versuchen; sag der Person, dass sie das selbst im Terminal tun muss.`);
    }
    // confirm: Rückfrage stellen, Antwort schließen, auf die nächste Nachricht warten.
    // Parallele Schreibaufrufe werden nacheinander abgefragt.
    const run = live.confirmChain.then(() => confirm(tool, toolInput));
    live.confirmChain = run.catch(() => undefined);
    return run;
  };

  async function confirm(tool: string, toolInput: Record<string, unknown>) {
    const decide = (permissionDecision: 'allow' | 'deny', reason: string) => ({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason: reason },
    });
    if (live.abort.signal.aborted) return decide('deny', 'Abgebrochen.');
    emitText(live, (live.lastKind === 'none' ? '' : '\n\n') + confirmQuestion(tool, toolInput));
    const answer = await new Promise<string>((resolve) => {
      live.pending = {
        resolve,
        timer: setTimeout(() => resolve('\u0000timeout'), cfg.confirmTimeoutMs),
      };
      detach(live);
    });
    if (live.pending) { clearTimeout(live.pending.timer); live.pending = null; }
    if (answer === '\u0000timeout') {
      log('confirm timeout', { conv: live.key });
      return decide('deny', 'Keine Antwort auf die Rückfrage — nicht ausgeführt.');
    }
    const a = parseAnswer(answer);
    if (a === 'yes') {
      emitStatus(live, '✅ ' + statusLine(tool, toolInput));
      return decide('allow', 'Von der Person im Chat bestätigt.');
    }
    emitStatus(live, '🚫 Nicht ausgeführt.');
    return decide('deny', a === 'no'
      ? 'Die Person hat abgelehnt. Nicht ausführen.'
      : `Die Person hat nicht bestätigt, sondern geantwortet: "${answer.slice(0, 2000)}". Nicht ausführen; richte dich nach ihrer Antwort.`);
  }
}

// ---------- Öffentliche Schnittstelle ----------

export interface TurnRequest {
  userId: string;
  convId: string;
  token: string;
  prompt: string;
  history: string;   // bisheriger Verlauf aus LibreChat, falls die Sitzung neu ist
  model?: string;
  sink: Sink;
  query: QueryFn;
}

/** Führt eine Nachricht aus. Kehrt zurück, sobald die HTTP-Antwort geschlossen werden kann. */
export async function handleTurn(req: TurnRequest): Promise<void> {
  const key = `${safeId(req.userId)}:${safeId(req.convId)}`;
  const existing = lives.get(key);

  // 1) Antwort auf eine offene Rückfrage in dieser Unterhaltung.
  if (existing?.pending) {
    log('confirm answer', { conv: key });
    attach(existing, req.sink);
    existing.pending.resolve(req.prompt);
    return waitClosed(req.sink, existing);
  }
  if (existing) {
    req.sink.write('Diese Unterhaltung arbeitet noch an der vorigen Nachricht. Bitte kurz warten.');
    req.sink.finish();
    return;
  }

  // 2) Höchstens ein aktiver Zug je Nutzer.
  const otherKey = userLive.get(req.userId);
  const other = otherKey ? lives.get(otherKey) : undefined;
  if (other && !other.pending) {
    req.sink.write('Bei dir läuft gerade schon eine Anfrage in einem anderen Chat. Bitte warte, bis sie fertig ist.');
    req.sink.finish();
    return;
  }
  if (other?.pending) {
    // Offene Rückfrage in einem anderen Chat verfällt; dort bleibt die Sitzung fortsetzbar.
    log('abandon pending', { conv: other.key });
    other.pending.resolve('nein');
    other.abort.abort();
    end(other);
  }

  // 3) Neuer Zug.
  const live: Live = {
    key, userId: req.userId, abort: new AbortController(), sink: null, buffer: [], pending: null,
    lastKind: 'none', lastStatus: '', sawStreamText: false, usage: { input: 0, output: 0 }, turnTimer: null, confirmChain: Promise.resolve(),
  };
  lives.set(key, live);
  userLive.set(req.userId, key);
  attach(live, req.sink);

  const scratch = join(cfg.stateDir, 'scratch', safeId(req.userId));
  mkdirSync(scratch, { recursive: true });
  const resume = sessionMap[key];
  const prompt = !resume && req.history
    ? `Bisheriger Verlauf dieser Unterhaltung (aus der Chat-Oberfläche, zur Orientierung):\n\n${req.history}\n\n---\n\nNeue Nachricht:\n${req.prompt}`
    : req.prompt;

  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL']) delete env[k];
  env.CLAUDE_CODE_OAUTH_TOKEN = req.token;
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'olaf-werkbank-bridge/0.1';
  env.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD = '1';

  const guard = makeGuard(live);
  const options: Record<string, any> = {
    cwd: scratch,
    additionalDirectories: [VAULT_DIR],
    settingSources: ['user', 'project'],
    skills: 'all',
    systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM_APPEND },
    permissionMode: 'default',
    // Zweite Sicherung, falls ein Aufruf am Hook vorbei beim Rechte-Dialog landet.
    canUseTool: async (tool: string, input: Record<string, unknown>) => {
      const r: any = await guard({ tool_name: tool, tool_input: input });
      const d = r.hookSpecificOutput;
      return d.permissionDecision === 'allow'
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: d.permissionDecisionReason };
    },
    hooks: { PreToolUse: [{ hooks: [guard], timeout: Math.ceil(cfg.confirmTimeoutMs / 1000) + 60 }] },
    disallowedTools: ['AskUserQuestion'],
    // Jira: kein eigener Eintrag – der Atlassian-MCP kommt wie im Terminal aus der Nutzer-Konfiguration
    // (~/.claude.json, Scope "user", OAuth-Anmeldung per /mcp). Im Pilot ist das Knuts Jira-Zugang.
    maxTurns: cfg.maxTurns,
    includePartialMessages: true,
    abortController: live.abort,
    env,
    stderr: (d: string) => { if (/error/i.test(d)) log('sdk stderr', { conv: key, line: d.slice(0, 300).replaceAll(req.token, '***') }); },
  };
  if (resume) options.resume = resume;
  if (req.model) options.model = req.model;

  log('turn start', { conv: key, resume: !!resume, model: req.model ?? 'default' });

  // Die Sitzung läuft unabhängig von der HTTP-Antwort weiter (Rückfragen!).
  (async () => {
    try {
      for await (const msg of req.query({ prompt, options })) handleMessage(live, msg);
    } catch (e: any) {
      if (live.abort.signal.aborted) log('turn aborted', { conv: key });
      else {
        const text = String(e?.message ?? e).replaceAll(req.token, '***');
        log('turn error', { conv: key, error: text.slice(0, 300) });
        const auth = /auth|401|token|login/i.test(text);
        emitStatus(live, auth ? `⚠️ ${AUTH_HINTS.authentication_failed}` : '⚠️ Die Claude-Sitzung ist unerwartet beendet worden. Schreib einfach noch einmal.');
      }
    } finally {
      log('turn end', { conv: key, usage: live.usage });
      end(live);
    }
  })();

  return waitClosed(req.sink, live);
}

/** Wartet, bis die HTTP-Antwort geschlossen ist. Bricht der Browser ab, wird die Sitzung gestoppt. */
function waitClosed(sink: Sink & { onClose?: (fn: () => void) => void }, live: Live): Promise<void> {
  return new Promise((resolve) => {
    if (sink.closed) return resolve();
    sink.onClose?.(() => {
      if (live.sink === sink && !live.pending) {
        log('client gone, aborting', { conv: live.key });
        live.abort.abort();
      }
      resolve();
    });
  });
}
