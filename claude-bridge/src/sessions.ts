// Eine Claude-Code-Sitzung je LibreChat-Unterhaltung.
//
// Ablauf eines Zuges: query() des Agent SDK läuft, die Nachrichten werden in lesbaren Text
// übersetzt und in die gerade offene HTTP-Antwort ("Sink") geschrieben. Will Claude schreiben,
// hält der PreToolUse-Hook an, stellt die Rückfrage, schließt die Antwort — und wartet, bis die
// nächste Nachricht in derselben Unterhaltung kommt ("ja"/"nein"). Dann läuft dieselbe Sitzung
// weiter und schreibt in die neue Antwort.

import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { classify, statusLine, prepLine, confirmQuestion, parseAnswer, jiraWriteKeys, VAULT_DIR, AUTO_DENY } from './tools.ts';
import { homeFor, ensureHome, applyHome, homesRoot } from './claudehome.ts';
import { log } from './log.ts';
import { AGENTS, READONLY_ROLES, maxSubagents, orchestratorAppend } from './agents.ts';
import { skillsFor } from './skills.ts';
import { pickAccounts, exhaustedOf, markExhausted, normalizeAccounts, resetMs, isRateLimitText, type Account } from './accounts.ts';

export interface Sink {
  write(text: string): void;
  /** Denken (Zusammenfassung) als eigener Kanal — im Stream `delta.reasoning_content`, LibreChat zeigt es als „Gedanken“. */
  reason?(text: string): void;
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
  readonly: boolean;
  // Zeitmessung je Zug (ms seit Eingang der Anfrage), nur für das Log.
  t0: number;
  times: Record<string, number>;
  progressShown: Map<string, number>;
  onSkill?: (name: string) => void;
  // Schreibende Atlassian-Aufrufe dieses Zuges (tool_use_id → Werkzeug/Argumente), bis ihr Ergebnis kommt.
  jiraCalls: Map<string, { name: string; input: Record<string, unknown> }>;
  onJiraWrite?: (keys: string[], tool: string) => void;
  home: string;   // CLAUDE_CONFIG_DIR dieser Sitzung oder 'shared'
  // Auto-Modus (Plan 71 P1): Rechte-Modus des Zuges, Arbeitsordner für die Klasse „auto“ (nur im Auto-Modus gesetzt),
  // automatisch zu entscheidende Aufrufe bis zu ihrem Ergebnis, abgelehnte Werkzeuge (nur Namen, fürs Log).
  mode: PermissionMode;
  workDir?: string;
  autoCalls: Map<string, { name: string; input: Record<string, unknown>; sub: boolean }>;
  denials: string[];
  // Mehrere Claude-Konten: hat dieser Versuch rate_limit gemeldet (mit Reset), und ist schon etwas passiert?
  rateLimited: { resetsAt?: number } | null;
  rateLimitReset?: number;
  progressed: boolean;
  // Orchestrator (P2): gestartete Teilagenten (tool_use_id → Beschreibung), Starts in diesem Zug, Rolle je agent_id.
  subagents: Map<string, string>;
  subagentStarts: number;
  agentTypes: Map<string, string>;
}

export type PermissionMode = 'default' | 'auto' | 'dontAsk';

const cfg = {
  stateDir: process.env.BRIDGE_STATE_DIR || join(process.cwd(), '..', '.runtime', 'bridge'),
  maxTurns: Number(process.env.BRIDGE_MAX_TURNS || 40),
  turnTimeoutMs: Number(process.env.BRIDGE_TURN_TIMEOUT_S || 900) * 1000,
  confirmTimeoutMs: Number(process.env.BRIDGE_CONFIRM_TIMEOUT_S || 1800) * 1000,
};

// ---------- Auto-Modus (Plan 71 P1, Knut 06.10.2026) ----------
// BRIDGE_PERMISSION_MODE=auto (Vorgabe in scripts/start.sh) + E-Mail in BRIDGE_AUTO_EMAILS (Vorgabe: Knut) → der
// SDK-Modus „auto“: Bash/Edits im eigenen Arbeitsordner entscheidet der Klassifikator. Alles andere wie heute.
// BRIDGE_PERMISSION_MODE=default (oder nicht gesetzt) ist der Not-Aus: exakt das bisherige Verhalten.

const emailList = (s: string | undefined) => (s ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

/** Rechte-Modus für einen Zug. Board-readonly → dontAsk (der Wächter lehnt weiter selbst ab; dontAsk ist die zweite Schicht). */
export function autoFor(req: { email?: string; readonly?: boolean }): PermissionMode {
  if (process.env.BRIDGE_PERMISSION_MODE !== 'auto') return 'default';
  if (req.readonly) return 'dontAsk';
  return req.email && emailList(process.env.BRIDGE_AUTO_EMAILS).includes(req.email.toLowerCase()) ? 'auto' : 'default';
}

/**
 * Flag-Settings im Auto-Modus (gelten auch für die geteilte Konfiguration): AUTO_DENY plus die absoluten Pfade der
 * Konfigurationen je Person. Keine Deny-Regel für den Vault — Deny schlägt das „ja“ im Chat.
 */
export function autoSettings(): { permissions: { deny: string[]; disableBypassPermissionsMode: 'disable' } } {
  const homes = resolve(homesRoot());
  return { permissions: { deny: [...AUTO_DENY, `Read(/${homes}/*/.credentials.json)`, `Edit(/${homes}/**)`], disableBypassPermissionsMode: 'disable' } };
}

const ansi = (s: unknown) => String(s ?? '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);

const SYSTEM_APPEND = `
Du läufst in der OLAF-Werkbank: Die Person schreibt dir über eine Chat-Oberfläche (LibreChat), nicht im Terminal.
- Antworte auf Deutsch, in gut lesbarem Markdown.
- Der Obsidian-Vault liegt unter ${VAULT_DIR}. Lies ihn frei; zum Finden nimm zuerst das Werkzeug vault-search (search, read_note, backlinks, links, list_folder, recent).
- Schreibzugriffe (Dateien schreiben/ändern, Bash-Befehle, Jira ändern) bestätigt die Person im Chat. Frag nicht selbst vorher nach, sondern ruf das Werkzeug direkt auf — das System stellt die Rückfrage und macht nach "ja" weiter. Wird ein Aufruf abgelehnt, respektiere das und frag nach, was stattdessen gewünscht ist.
- GitHub schreiben, pushen und mergen ist hier gesperrt.
- Rückfragen stellst du als normalen Text am Ende deiner Antwort.
`.trim();

const AUTO_APPEND = 'Auto-Modus ist an: Bash-Befehle und Datei-Änderungen in deinem Arbeitsordner (dem aktuellen Arbeitsverzeichnis) laufen ohne Rückfrage, wenn der Sicherheits-Klassifikator zustimmt; jede solche Freigabe sieht die Person als Statuszeile. Vault, Jira und alles außerhalb des Arbeitsordners bestätigt die Person weiterhin im Chat.';

// ---------- Zuordnung Unterhaltung → SDK-Sitzung (ohne Geheimnisse, als JSON-Datei) ----------

mkdirSync(cfg.stateDir, { recursive: true });
const mapFile = join(cfg.stateDir, 'sessions.json');
let sessionMap: Record<string, string> = {};
try { sessionMap = JSON.parse(readFileSync(mapFile, 'utf8')); } catch { /* erste Sitzung */ }

// Mit welcher Claude-Konfiguration eine Sitzung angelegt wurde (Verlauf liegt dort; Fortsetzen nur mit derselben).
// Ohne Eintrag: vor Runde 4 angelegt, also mit der Konfiguration des VM-Nutzers ('shared').
const homeFile = join(cfg.stateDir, 'session-homes.json');
let homeMap: Record<string, string> = {};
try { homeMap = JSON.parse(readFileSync(homeFile, 'utf8')); } catch { /* keine */ }

function saveMap() {
  for (const [f, data] of [[mapFile, sessionMap], [homeFile, homeMap]] as const) {
    const tmp = f + '.tmp';
    writeFileSync(tmp, JSON.stringify(data, null, 1));
    renameSync(tmp, f);
  }
}

const lives = new Map<string, Live>();       // Unterhaltung → laufende Sitzung
const MAX_WAITING = 5;   // offene Rückfragen je Person (je eine wartende Claude-Sitzung)
// Board-Agenten (Plan 71 E5, Knut 07.10.2026): nur lesende Läufe (readonly + dontAsk) zählen nicht gegen die Sperre
// „ein Zug je Person“, haben aber eine eigene Obergrenze je Person.
const MAX_BOARD_RUNS = Math.max(1, Number(process.env.BRIDGE_MAX_BOARD_RUNS || 2));

/** Nur lesender Board-Lauf: der Wächter lehnt jedes Schreiben ab, das SDK fragt nie (dontAsk). */
export function isBoardRun(l: { readonly: boolean; mode: PermissionMode }): boolean {
  return l.readonly && l.mode === 'dontAsk';
}

/** Darf ein neuer Zug starten? Normale Chats: einer zur Zeit je Person; Board-Läufe: bis MAX_BOARD_RUNS daneben. */
export function lockFor(mine: { readonly: boolean; mode: PermissionMode; pending: unknown }[], next: { readonly: boolean; mode: PermissionMode }): 'ok' | 'chat-busy' | 'board-full' {
  if (isBoardRun(next)) return mine.filter(isBoardRun).length >= MAX_BOARD_RUNS ? 'board-full' : 'ok';
  return mine.some((l) => !isBoardRun(l) && !l.pending) ? 'chat-busy' : 'ok';
}

// Status je Unterhaltung (Idee: coder/agentapi „running/stable“, CloudCLI Sitzungsliste).
const lastSeen = new Map<string, { at: number; turns: number; title: string; written?: string[] }>();

/** Sitzungen einer Person: läuft / wartet auf „ja“ / bereit — neueste zuerst. */
export function sessionsOf(userId: string) {
  const prefix = safeId(userId) + ':';
  const keys = new Set([...Object.keys(sessionMap), ...lastSeen.keys()].filter((k) => k.startsWith(prefix)));
  return [...keys].map((k) => {
    const l = lives.get(k);
    const seen = lastSeen.get(k);
    return {
      conv: k.slice(prefix.length), status: l ? (l.pending ? 'wartet auf ja' : 'läuft') : 'bereit',
      lastActivity: seen?.at ?? null, turns: seen?.turns ?? null, title: seen?.title ?? '', resumable: !!sessionMap[k], written: seen?.written ?? [],
    };
  }).sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0)).slice(0, 30);
}

export function stats() {
  return { live: lives.size, pending: [...lives.values()].filter(l => l.pending).length, sessions: Object.keys(sessionMap).length };
}

export function scratchFor(userId: string): string {
  const dir = join(cfg.stateDir, 'scratch', safeId(userId));
  mkdirSync(dir, { recursive: true });
  return dir;
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

/** Gedanken nur live — ohne offene Antwort (wartet auf „ja“) gibt es keine, also auch nichts zu puffern. */
function emitReason(live: Live, text: string) {
  if (text && live.sink && !live.sink.closed) live.sink.reason?.(text);
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
}

// ---------- Übersetzung der SDK-Nachrichten ----------

const AUTH_HINTS: Record<string, string> = {
  authentication_failed: 'Dein Claude-Token wurde abgelehnt. Erzeuge im Terminal mit `claude setup-token` einen neuen und trag ihn im Modell-Menü bei „Claude Code“ über das Zahnrad ein.',
  oauth_org_not_allowed: 'Dein Claude-Konto darf hier nicht verwendet werden (Organisation nicht zugelassen).',
  billing_error: 'Claude meldet ein Abrechnungsproblem mit deinem Konto.',
  rate_limit: 'Dein Claude-Kontingent ist gerade ausgeschöpft. Bitte später noch einmal.',
  overloaded: 'Claude ist gerade überlastet. Bitte gleich noch einmal versuchen.',
};

function mark(live: Live, what: string) {
  if (live.times[what] === undefined) live.times[what] = Date.now() - live.t0;
}

/** „Teilagent <Beschreibung>“ für Statuszeilen. */
function subLabel(input: Record<string, any>): string {
  const d = String(input.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 50);
  const t = input.subagent_type ? String(input.subagent_type) : '';
  return d ? (t && t !== 'general-purpose' ? `${d} (${t})` : d) : t || '…';
}

/** Präfix für Zeilen aus einem Teilagenten: „↳ Teilagent <Beschreibung>: “ bzw. „↳ “, wenn er unbekannt ist. */
function subPrefix(live: Live, parent: string | null | undefined): string {
  if (!parent) return '';
  const label = live.subagents.get(parent);
  return label ? `↳ Teilagent ${label}: ` : '↳ ';
}

function handleMessage(live: Live, msg: any) {
  if (msg.type !== 'system' && msg.type !== 'rate_limit_event') mark(live, 'ersteNachricht');
  switch (msg.type) {
    case 'rate_limit_event':
      // Reset-Zeitpunkt merken; ob das Konto wirklich erschöpft ist, sagt erst die Fehlerart rate_limit.
      if (msg.rate_limit_info?.status === 'rejected') live.rateLimitReset = resetMs(msg.rate_limit_info.resetsAt);
      return;
    case 'system':
      if (msg.subtype === 'init') mark(live, 'init');
      if (msg.subtype === 'init' && msg.session_id && sessionMap[live.key] !== msg.session_id) {
        sessionMap[live.key] = msg.session_id;
        homeMap[live.key] = live.home;
        saveMap();
      }
      if (msg.subtype === 'permission_denied') {
        // Vom Klassifikator (oder dontAsk/Deny-Regel) abgelehnt — sichtbar machen, ohne Argumente ins Log.
        const call = live.autoCalls.get(msg.tool_use_id);
        live.autoCalls.delete(msg.tool_use_id);
        live.denials.push(String(msg.tool_name ?? '?'));
        log('auto abgelehnt', { conv: live.key, tool: msg.tool_name, grund: msg.decision_reason_type });
        if (live.mode === 'auto') emitStatus(live, `🛑 Auto-Modus hat abgelehnt: ${(call?.sub ? '↳ ' : '') + statusLine(String(msg.tool_name ?? ''), call?.input ?? {})}`);
      }
      return;
    case 'stream_event': {
      if (msg.parent_tool_use_id) return;
      const ev = msg.event;
      if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
        mark(live, 'ersterText');
        live.sawStreamText = true;
        live.progressed = true;
        emitText(live, ev.delta.text);
      } else if (ev?.type === 'content_block_delta' && ev.delta?.type === 'thinking_delta') {
        // Zusammengefasstes Denken (thinking display „summarized“, s. u.) live als Gedanken.
        emitReason(live, String(ev.delta.thinking ?? ''));
      } else if (ev?.type === 'content_block_start' && /thinking/.test(ev.content_block?.type ?? '')) {
        // Man soll sehen, dass etwas passiert — auch wenn keine Gedanken-Zusammenfassung kommt.
        mark(live, 'denkt');
        emitStatus(live, '💭 denkt nach …');
      } else if (ev?.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
        // Werkzeugaufruf beginnt: bei langen Eingaben (Datei, Teilagent, Jira anlegen) sofort eine Zeile,
        // nicht erst, wenn die ganze Eingabe formuliert ist.
        const line = prepLine(String(ev.content_block.name ?? ''));
        if (line) { live.progressed = true; emitStatus(live, line); }
      }
      return;
    }
    case 'tool_progress': {
      // Lange Werkzeugschritte (Teilagent, Suche, MCP): alle 15 s ein Lebenszeichen.
      if (msg.parent_tool_use_id) return;
      // Erstes Lebenszeichen nach 5 s, danach alle 15 s.
      const el = Number(msg.elapsed_time_seconds ?? 0);
      const s = el >= 15 ? Math.floor(el / 15) * 15 : el >= 5 ? 5 : 0;
      if (s < 5 || (live.progressShown.get(msg.tool_use_id) ?? 0) >= s) return;
      live.progressShown.set(msg.tool_use_id, s);
      emitStatus(live, `⏳ ${statusLine(String(msg.tool_name ?? ''), {}).replace(/:.*$/, '')} läuft seit ${s} s …`);
      return;
    }
    case 'assistant': {
      if (msg.error === 'rate_limit') {
        // Kontingent ausgeschöpft: die Meldung kommt erst, wenn kein weiteres Konto übernehmen kann (handleTurn).
        live.rateLimited = { resetsAt: live.rateLimitReset };
      } else if (msg.error) {
        emitStatus(live, `⚠️ ${AUTH_HINTS[msg.error] ?? `Claude meldet einen Fehler (${msg.error}).`}`);
      }
      for (const block of msg.message?.content ?? []) {
        if (block.type === 'tool_use') {
          live.progressed = true;
          const cls = classify(block.name, block.input ?? {}, { workDir: live.workDir }).cls;
          if (cls === 'auto' && live.mode === 'auto') live.autoCalls.set(block.id, { name: block.name, input: block.input ?? {}, sub: !!msg.parent_tool_use_id });
          if (live.onJiraWrite && jiraWriteKeys(block.name, block.input ?? {}) !== null) live.jiraCalls.set(block.id, { name: block.name, input: block.input ?? {} });
          // Nutzung je Skill zählen (Knut, 29.09.: Skill-Kern nach einer Woche mit echten Zahlen nachschärfen).
          if (block.name === 'Skill' && live.onSkill) { try { live.onSkill(String(block.input?.skill ?? block.input?.command ?? '').replace(/^\//, '').split(/\s/)[0]); } catch { /* egal */ } }
          if ((block.name === 'Task' || block.name === 'Agent') && !msg.parent_tool_use_id) live.subagents.set(block.id, subLabel(block.input ?? {}));
          if (cls === 'read') emitStatus(live, subPrefix(live, msg.parent_tool_use_id) + statusLine(block.name, block.input ?? {}));
          // Schreibende Werkzeuge melden sich erst nach der Bestätigung (siehe Hook).
        } else if (block.type === 'text' && !live.sawStreamText && !msg.parent_tool_use_id && !msg.error) {
          live.progressed = true;
          emitText(live, block.text);
        }
      }
      return;
    }
    case 'user': {
      // Ergebnis eines schreibenden Jira-Aufrufs (auch aus Teilagenten): Schlüssel an die Werkbank, damit die
      // Jira-Kopie und offene Board-Seiten sofort nachziehen (Knut, 29.09.: „instant update des board“).
      // Auto-Modus: Ergebnis eines Aufrufs, den niemand gefragt hat → der Klassifikator hat ihn erlaubt.
      if (live.autoCalls.size) {
        for (const b of msg.message?.content ?? []) {
          const call = b?.type === 'tool_result' ? live.autoCalls.get(b.tool_use_id) : undefined;
          if (!call) continue;
          live.autoCalls.delete(b.tool_use_id);
          log('auto erlaubt', { conv: live.key, tool: call.name });
          emitStatus(live, `🤖 automatisch erlaubt: ${(call.sub ? '↳ ' : '') + statusLine(call.name, call.input)}`);
          rememberWritten(live, call.name, call.input);
        }
      }
      // Ergebnis eines Teilagenten (Haupt-Faden): eine Abschlusszeile je Teilagent.
      if (live.subagents.size && !msg.parent_tool_use_id) {
        for (const b of msg.message?.content ?? []) {
          const label = b?.type === 'tool_result' ? live.subagents.get(b.tool_use_id) : undefined;
          if (label === undefined) continue;
          live.subagents.delete(b.tool_use_id);
          emitStatus(live, `↳ Teilagent ${label} ${b.is_error ? 'abgebrochen' : 'fertig'}`);
        }
      }
      if (!live.jiraCalls.size) return;
      for (const b of msg.message?.content ?? []) {
        const call = b?.type === 'tool_result' ? live.jiraCalls.get(b.tool_use_id) : undefined;
        if (!call) continue;
        live.jiraCalls.delete(b.tool_use_id);
        if (b.is_error) continue;
        const text = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((c: any) => c?.text ?? '').join('\n') : '';
        const keys = jiraWriteKeys(call.name, call.input, text) ?? [];
        if (keys.length) { try { live.onJiraWrite!(keys, call.name); } catch { /* egal */ } }
      }
      return;
    }
    case 'result': {
      for (const d of msg.permission_denials ?? []) if (!live.denials.includes(String(d?.tool_name))) live.denials.push(String(d?.tool_name ?? '?'));
      const u = msg.usage ?? {};
      live.usage.input += (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      live.usage.output += u.output_tokens ?? 0;
      if (live.rateLimited) { /* Meldung bzw. Kontowechsel in handleTurn */ }
      else if (msg.subtype === 'error_max_turns') emitStatus(live, `⏹️ Maximale Schrittzahl (${cfg.maxTurns}) erreicht. Schreib „weiter“, dann mache ich dort weiter.`);
      else if (msg.subtype !== 'success' || msg.is_error) emitStatus(live, /authenticat|401|token/i.test(String(msg.result ?? '')) ? `⚠️ ${AUTH_HINTS.authentication_failed}` : '⚠️ Bei der Ausführung ist ein Fehler aufgetreten.');
      return;
    }
  }
}

// ---------- Bestätigung für Schreibzugriffe ----------

function rememberWritten(live: Live, tool: string, toolInput: Record<string, unknown>) {
  // Geschriebene Dateien merken (für „Dokumente an der Karte“), nur Pfade.
  const f = toolInput.file_path ?? toolInput.notebook_path;
  if (f && /^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) {
    const seen = lastSeen.get(live.key);
    if (seen) seen.written = [...new Set([...(seen.written ?? []), String(f)])].slice(-50);
  }
}

/**
 * Der Wächter. Als PreToolUse-Hook: (input) mit tool_name/tool_input. Als canUseTool (Eskalation des Auto-Modus oder
 * zweite Sicherung): escalated = true, dann gibt es für „auto“ keine Durchreiche mehr, sondern die Rückfrage im Chat.
 */
function makeGuard(live: Live) {
  return async (input: any, toolUseId?: unknown, _opts?: unknown, escalated?: { reason?: string }) => {
    const tool: string = input.tool_name;
    const toolInput: Record<string, unknown> = input.tool_input ?? {};
    const { cls, why } = classify(tool, toolInput, { workDir: live.workDir });
    // Teilagent? Der Hook nennt agent_id/agent_type; canUseTool nur die agent_id (Rolle aus einem früheren Hook-Aufruf).
    const agentId: string | undefined = input.agent_id;
    if (agentId && input.agent_type) live.agentTypes.set(agentId, String(input.agent_type));
    const role = agentId ? (input.agent_type ? String(input.agent_type) : live.agentTypes.get(agentId)) : undefined;
    // Der Hook ist maßgeblich dafür, was als „automatisch erlaubt“ gemeldet wird (nicht die Einordnung beim Streamen).
    if (typeof toolUseId === 'string') {
      if (cls === 'auto' && live.mode === 'auto' && !escalated) live.autoCalls.set(toolUseId, live.autoCalls.get(toolUseId) ?? { name: tool, input: toolInput, sub: false });
      else live.autoCalls.delete(toolUseId);
    }
    const decide = (permissionDecision: 'allow' | 'deny', reason: string) => ({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason: reason },
    });
    if ((tool === 'Task' || tool === 'Agent') && !agentId) {
      // Obergrenze an Teilagenten je Zug (Kosten).
      if (live.subagentStarts >= maxSubagents()) {
        emitStatus(live, `⛔ Höchstens ${maxSubagents()} Teilagenten je Nachricht — weitere nicht gestartet`);
        return decide('deny', `Höchstens ${maxSubagents()} Teilagenten je Nachricht. Keine weiteren starten; fasse die vorhandenen Ergebnisse zusammen oder erledige den Rest selbst.`);
      }
      live.subagentStarts++;
    }
    if (role && READONLY_ROLES.has(role) && cls !== 'read') {
      emitStatus(live, `🔒 Teilagent „${role}“ ist nur lesend: ${statusLine(tool, toolInput)} nicht ausgeführt`);
      return decide('deny', `Teilagent „${role}“ ist nur lesend. Nichts schreiben oder ausführen; schreib in dein Ergebnis, was zu tun wäre.`);
    }
    if (cls === 'read') return decide('allow', 'Lesen ist ohne Rückfrage erlaubt.');
    if (cls === 'blocked') {
      emitStatus(live, `⛔ Gesperrt im Pilot: ${why}`);
      return decide('deny', `Im OLAF-Werkbank-Pilot gesperrt (${why}). Nicht erneut versuchen; sag der Person, dass sie das selbst im Terminal tun muss.`);
    }
    if (live.readonly) {
      emitStatus(live, `🔒 Nur lesen (Board-Agent): ${statusLine(tool, toolInput)} nicht ausgeführt`);
      return decide('deny', 'Dieser Lauf ist nur lesend (vom Werkbank-Board gestartet). Nichts schreiben; schreib stattdessen auf, was zu tun wäre.');
    }
    // Auto-Modus: keine Entscheidung — der Klassifikator des SDK entscheidet; eskaliert er, kommt canUseTool (unten).
    if (cls === 'auto' && live.mode === 'auto' && !escalated) return {};
    // confirm: Rückfrage stellen, Antwort schließen, auf die nächste Nachricht warten.
    // Parallele Schreibaufrufe werden nacheinander abgefragt.
    const note = (agentId ? `**Teilagent „${role ?? 'Teilagent'}“ möchte:**\n\n` : '')
      + (escalated && cls === 'auto' ? `_Der Auto-Modus fragt nach${escalated.reason ? `: ${ansi(escalated.reason)}` : '.'}_\n\n` : '');
    const run = live.confirmChain.then(() => confirm(tool, toolInput, note));
    live.confirmChain = run.catch(() => undefined);
    return run;
  };

  async function confirm(tool: string, toolInput: Record<string, unknown>, note = '') {
    const decide = (permissionDecision: 'allow' | 'deny', reason: string) => ({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision, permissionDecisionReason: reason },
    });
    if (live.abort.signal.aborted) return decide('deny', 'Abgebrochen.');
    emitText(live, (live.lastKind === 'none' ? '' : '\n\n') + note + confirmQuestion(tool, toolInput));
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
      rememberWritten(live, tool, toolInput);
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
  readonly?: boolean;      // Board-Agent: Schreibwerkzeuge ohne Rückfrage ablehnen
  instructions?: string;   // System-Vorgabe der Vorlage (LibreChat promptPrefix), gilt ab Sitzungsbeginn
  sessionContext?: () => Promise<string>;       // Kontext-Paket für neue Sitzungen
  mcpServers?: Record<string, unknown>;         // Werkbank-eigene MCP-Server (nur für diese Sitzung)
  onMeasure?: (m: Record<string, number>) => void;   // echte Kontext-Aufteilung nach dem ersten Zug
  receivedAt?: number;     // Eingang der HTTP-Anfrage (für die Zeitmessung)
  onSkill?: (name: string) => void;   // ein Skill wurde aufgerufen (Zählung, ohne Inhalt)
  email?: string;          // für die Wahl der Claude-Konfiguration (je Person / geteilt)
  onJiraWrite?: (keys: string[], tool: string) => void;   // erfolgreicher schreibender Jira-Aufruf im Chat
  // Weitere Claude-Konten der Person in Reihenfolge (über den internen Kanal von der Werkbank; chat = req.token).
  accounts?: () => Promise<{ id: string; label: string; token: string | null }[]>;
}

function thinkingDisplay(): string | null {
  const v = (process.env.BRIDGE_THINKING_DISPLAY ?? 'summarized').trim();
  return v === 'off' || v === '' ? null : v;
}

const CONTINUE_PROMPT = 'Mach bitte genau dort weiter, wo du unterbrochen wurdest — das Claude-Konto wurde gewechselt, weil das Kontingent ausgeschöpft war. Wiederhole keine Schritte, die schon erledigt sind.';

/** Führt eine Nachricht aus. Kehrt zurück, sobald die HTTP-Antwort geschlossen werden kann. */
export async function handleTurn(req: TurnRequest): Promise<void> {
  const key = `${safeId(req.userId)}:${safeId(req.convId)}`;
  const seen = lastSeen.get(key);
  lastSeen.set(key, { at: Date.now(), turns: (seen?.turns ?? 0) + 1, title: seen?.title || req.prompt.replace(/\s+/g, ' ').slice(0, 60), written: seen?.written });
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

  // 2) Höchstens ein aktiver Zug je Nutzer. Chats, die nur auf „ja“ warten, zählen nicht — ein vom
  //    Board angesetzter Agent darf auf die Antwort warten, während die Person woanders weiterchattet.
  //    Board-Läufe (nur lesend) laufen daneben, höchstens MAX_BOARD_RUNS je Person (E5).
  const mine = [...lives.values()].filter((l) => l.userId === req.userId);
  const mode = autoFor(req);
  const lock = lockFor(mine, { readonly: !!req.readonly, mode });
  if (lock !== 'ok') {
    req.sink.write(lock === 'board-full'
      ? `Bei dir laufen schon ${MAX_BOARD_RUNS} Board-Agenten. Bitte warte, bis einer fertig ist.`
      : 'Bei dir läuft gerade schon eine Anfrage in einem anderen Chat. Bitte warte, bis sie fertig ist.');
    req.sink.finish();
    return;
  }
  const waiting = mine.filter((l) => l.pending && !isBoardRun(l));
  if (waiting.length >= MAX_WAITING) {
    // Die älteste offene Rückfrage verfällt; dort bleibt die Sitzung fortsetzbar.
    const oldest = waiting[0];
    log('abandon pending', { conv: oldest.key });
    oldest.pending!.resolve('nein');
    oldest.abort.abort();
    end(oldest);
  }

  // 3) Neuer Zug.
  const live: Live = {
    key, userId: req.userId, abort: new AbortController(), sink: null, buffer: [], pending: null,
    lastKind: 'none', lastStatus: '', sawStreamText: false, usage: { input: 0, output: 0 }, turnTimer: null, confirmChain: Promise.resolve(),
    readonly: !!req.readonly, t0: req.receivedAt ?? Date.now(), times: {}, progressShown: new Map(), onSkill: req.onSkill,
    jiraCalls: new Map(), onJiraWrite: req.onJiraWrite, home: '',
    mode, autoCalls: new Map(), denials: [], rateLimited: null, progressed: false,
    subagents: new Map(), subagentStarts: 0, agentTypes: new Map(),
  };
  lives.set(key, live);
  attach(live, req.sink);
  // Sofort ein Lebenszeichen: bis zum ersten Token vergehen mit echtem Claude einige Sekunden
  // (CLI-Start, MCP-Server, langer System-Prompt, Denken).
  emitStatus(live, '⏳ Claude arbeitet …');
  mark(live, 'arbeitet');

  const scratch = scratchFor(req.userId);
  if (live.mode === 'auto') live.workDir = scratch;
  // Eigene Claude-Konfiguration je Person (oder die geteilte des VM-Nutzers, siehe claudehome.ts).
  const home = homeFor(safeId(req.userId), req.email);
  live.home = home.dir ?? 'shared';
  try { await ensureHome(home); } catch (e: any) { log('konfig fehlgeschlagen', { conv: key, error: String(e?.message ?? e).slice(0, 120) }); }
  // Fortsetzen nur in derselben Konfiguration — dort liegt der Verlauf der Sitzung; sonst neu mit dem Verlauf aus LibreChat.
  const resume = sessionMap[key] && (homeMap[key] ?? 'shared') === live.home ? sessionMap[key] : undefined;
  let prompt = !resume && req.history
    ? `Bisheriger Verlauf dieser Unterhaltung (aus der Chat-Oberfläche, zur Orientierung):\n\n${req.history}\n\n---\n\nNeue Nachricht:\n${req.prompt}`
    : req.prompt;
  if (!resume && req.instructions) prompt = `Vorgabe für diesen Chat (aus der gewählten Vorlage):\n${req.instructions}\n\n---\n\n${prompt}`;

  // Die Sitzung (und ihre Bash-Befehle) bekommt keine Geheimnisse der Werkbank mit.
  const env: Record<string, string | undefined> = { ...process.env };
  for (const k of Object.keys(env)) if (/KEY|SECRET|TOKEN|PASSWORD|CREDS|_IV$|MONGO_URI/i.test(k)) delete env[k];
  for (const k of ['ANTHROPIC_BASE_URL', 'BW_SESSION']) delete env[k];
  env.CLAUDE_CODE_OAUTH_TOKEN = req.token;
  env.CLAUDE_AGENT_SDK_CLIENT_APP = 'olaf-werkbank-bridge/0.1';
  env.CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD = '1';
  // MCP-Werkzeuge erst bei Bedarf laden (Tool Search), statt alle Schemas in jede Runde zu packen.
  // „auto“ hat im ersten echten Zug nichts zurückgestellt (Werkzeuge 66 805 Tokens, deferred 0) —
  // deshalb „true“: MCP-Schemas immer erst bei Bedarf (kürzerer Prompt, schnellerer erster Token).
  env.ENABLE_TOOL_SEARCH = process.env.BRIDGE_TOOL_SEARCH || 'true';

  // Kontext-Paket + Hygiene-Fragen nur für neue Sitzungen (nicht bei resume, nicht im Nur-lesen-Lauf).
  // Parallel dazu: die Claude-Konten der Person (ohne Werkbank: nur der Schlüssel aus der Anfrage).
  const accountsP = (req.accounts ? req.accounts().catch((e: any) => { log('konten nicht geladen', { conv: key, error: String(e?.message ?? e).slice(0, 120) }); return null; }) : Promise.resolve(null))
    .then((list) => normalizeAccounts(list, req.token));
  let extra = '';
  if (!resume && !req.readonly && req.sessionContext) {
    try { extra = await req.sessionContext(); } catch (e: any) { log('kontext fehlgeschlagen', { conv: key, error: String(e?.message ?? e).slice(0, 120) }); }
  }
  const user = safeId(req.userId);
  const accounts = await accountsP;
  const queue = pickAccounts(accounts, exhaustedOf(user));
  const tokens = accounts.map((a) => a.token);
  const redact = (t: string) => tokens.reduce((x, tok) => x.replaceAll(tok, '***'), t);
  let acct: Account = queue[0];
  env.CLAUDE_CODE_OAUTH_TOKEN = acct.token;
  mark(live, 'kontext');
  const guard = makeGuard(live);
  const options: Record<string, any> = {
    cwd: scratch,
    additionalDirectories: [VAULT_DIR],
    settingSources: ['user', 'project'],
    // Nicht alle ~220 Skills: Kern + Vorlage + im Chat genannte (claude-bridge/src/skills.ts).
    skills: skillsFor(cfg.stateDir, key, req.instructions ?? '', req.prompt),
    systemPrompt: { type: 'preset', preset: 'claude_code', append: [SYSTEM_APPEND, live.mode === 'auto' ? AUTO_APPEND : '', process.env.BRIDGE_SUBAGENT_ROLES === 'off' ? '' : orchestratorAppend(), extra].filter(Boolean).join('\n\n') },
    mcpServers: withToken(req.mcpServers ?? {}, acct.token),
    permissionMode: live.mode,
    // Eskalation des Auto-Modus (Rückfrage im Chat) bzw. zweite Sicherung, falls ein Aufruf am Hook vorbei beim
    // Rechte-Dialog landet.
    canUseTool: async (tool: string, input: Record<string, unknown>, opts?: { toolUseID?: string; decisionReason?: string; agentID?: string }) => {
      if (opts?.toolUseID) live.autoCalls.delete(opts.toolUseID);
      const r: any = await guard({ tool_name: tool, tool_input: input, agent_id: opts?.agentID }, opts?.toolUseID, undefined, { reason: opts?.decisionReason });
      const d = r.hookSpecificOutput;
      return d.permissionDecision === 'allow'
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: d.permissionDecisionReason };
    },
    hooks: { PreToolUse: [{ hooks: [guard], timeout: Math.ceil(cfg.confirmTimeoutMs / 1000) + 60 }] },
    disallowedTools: ['AskUserQuestion'],
    // Orchestrator (P2): feste Rollen für Teilagenten; durchgesetzt im Wächter (agent_type), BRIDGE_SUBAGENT_ROLES=off schaltet ab.
    ...(process.env.BRIDGE_SUBAGENT_ROLES === 'off' ? {} : { agents: AGENTS }),
    // MCP: nur die Werkbank-Server aus req.mcpServers (vault-search, werkbank, forge-review, atlassian) —
    // strictMcpConfig (applyHome) blendet Nutzer-, Projekt- und Plugin-Server aus. Jira-OAuth je Konfiguration.
    maxTurns: cfg.maxTurns,
    includePartialMessages: true,
    // Gedanken als Zusammenfassung anfordern, damit sie live erscheinen (nur die Anzeige; Denkmodus und -budget bleiben
    // wie in Claude Code eingestellt). BRIDGE_THINKING_DISPLAY=omitted|off schaltet ab.
    ...(thinkingDisplay() ? { extraArgs: { 'thinking-display': thinkingDisplay() } } : {}),
    abortController: live.abort,
    env,
    stderr: (d: string) => { if (/error/i.test(d)) log('sdk stderr', { conv: key, line: redact(d.slice(0, 300)) }); },
  };
  if (live.mode === 'auto') options.settings = autoSettings();
  applyHome(home, env, options);
  if (resume) options.resume = resume;
  if (req.model) options.model = req.model;

  log('turn start', { conv: key, resume: !!resume, model: req.model ?? 'default', konfig: home.mode, mcp: Object.keys(options.mcpServers), permissionMode: live.mode, ...(accounts.length > 1 ? { konto: acct.id, konten: accounts.length } : {}) });

  // Die Sitzung läuft unabhängig von der HTTP-Antwort weiter (Rückfragen!).
  (async () => {
    try {
      // Ein Versuch je Konto: meldet einer rate_limit, übernimmt das nächste dieselbe Anfrage.
      for (let i = 0; ; i++) {
        live.rateLimited = null; live.rateLimitReset = undefined; live.progressed = false;
        await attempt(prompt);
        if (!live.rateLimited || live.abort.signal.aborted) break;
        markExhausted(user, acct, live.rateLimited.resetsAt);
        const next = queue[i + 1];
        if (!next) {
          log('kontingent erschöpft', { conv: key, konto: acct.id, konten: accounts.length });
          emitStatus(live, `⚠️ ${AUTH_HINTS.rate_limit}`);
          break;
        }
        log('konto gewechselt', { conv: key, von: acct.id, nach: next.id, mitten: live.progressed });
        emitStatus(live, `↻ Konto „${next.label}“ übernimmt (Kontingent von „${acct.label}“ ausgeschöpft)`);
        acct = next;
        env.CLAUDE_CODE_OAUTH_TOKEN = acct.token;
        options.mcpServers = withToken(req.mcpServers ?? {}, acct.token);
        // Noch nichts passiert → dieselbe Anfrage von vorn (gleiche Ausgangslage). Schon mitten im Zug → die Sitzung
        // fortsetzen (alle Konten teilen die Konfiguration und damit den Verlauf), ohne Schritte doppelt zu machen.
        if (live.progressed && sessionMap[key]) { options.resume = sessionMap[key]; prompt = CONTINUE_PROMPT; }
      }
    } finally {
      mark(live, 'ende');
      log('turn end', { conv: key, usage: live.usage, ms: live.times, ...(live.subagentStarts ? { teilagenten: live.subagentStarts } : {}), ...(live.denials.length ? { denials: live.denials } : {}) });
      end(live);
    }
  })();

  async function attempt(p: string) {
    try {
      const q: any = req.query({ prompt: p, options });
      let measured = false;
      for await (const msg of q) {
        handleMessage(live, msg);
        // Einmal je neuer Sitzung messen, was den Kontext füllt (lokale Schätzung des CLI, kein Extra-Aufruf).
        if (msg.type === 'result' && !resume && !measured && !live.rateLimited && typeof q.getContextUsage === 'function' && req.onMeasure) {
          measured = true;
          try {
            const u: any = await Promise.race([q.getContextUsage({ detail: 'summary' }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]);
            const cat = (re: RegExp) => (u.categories ?? []).filter((c: any) => re.test(c.name) && c.kind !== 'deferred').reduce((a: number, c: any) => a + (c.tokens ?? 0), 0);
            req.onMeasure({ total: u.totalTokens, systemPrompt: cat(/system prompt/i), tools: cat(/tools/i), skills: cat(/skill/i), memory: cat(/memory/i), deferredTools: (u.categories ?? []).filter((c: any) => c.kind === 'deferred').reduce((a: number, c: any) => a + (c.tokens ?? 0), 0) });
          } catch { /* Messung ist optional */ }
        }
      }
    } catch (e: any) {
      if (live.abort.signal.aborted) { log('turn aborted', { conv: key }); return; }
      const text = redact(String(e?.message ?? e));
      log('turn error', { conv: key, error: text.slice(0, 300) });
      if (live.rateLimited || isRateLimitText(text)) { live.rateLimited = live.rateLimited ?? { resetsAt: live.rateLimitReset }; return; }
      const auth = /auth|401|token|login/i.test(text);
      emitStatus(live, auth ? `⚠️ ${AUTH_HINTS.authentication_failed}` : '⚠️ Die Claude-Sitzung ist unerwartet beendet worden. Schreib einfach noch einmal.');
    }
  }

  return waitClosed(req.sink, live);
}

/** MCP-Server mit dem Claude-Token des aktiven Kontos (forge-review rechnet mit dem Zugang der Person). */
function withToken(servers: Record<string, any>, token: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(servers)) out[k] = v?.env?.CLAUDE_CODE_OAUTH_TOKEN ? { ...v, env: { ...v.env, CLAUDE_CODE_OAUTH_TOKEN: token } } : v;
  return out;
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
