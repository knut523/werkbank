// Mehrere Claude-Konten je Person mit automatischem Wechsel (Knut, 06.10.2026, „wie cswap auto“).
//
// Die Werkbank liefert über den internen Kanal die Konten einer Person in ihrer Reihenfolge (POST
// /internal/claude-accounts); `chat` ist der Schlüssel, den LibreChat mit der Anfrage schickt. Meldet ein Zug
// rate_limit, wird das Konto bis zum Reset als erschöpft vermerkt und das nächste übernimmt (sessions.ts).
//
// Zustand (ohne Geheimnisse): .runtime/bridge/claude-accounts.json — Person → Konto-ID → { until, fp }.
// fp = Fingerabdruck des Tokens (8 Hex-Zeichen): wird ein Konto mit neuem Token ersetzt, gilt der Vermerk nicht mehr.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { log } from './log.ts';
import { cleanEnv } from './mcpcall.ts';
import { applyHome, type ClaudeHome } from './claudehome.ts';

export interface Account { id: string; label: string; token: string }
export type Exhausted = Record<string, { until: number; fp?: string }>;

export const DEFAULT_RESET_MS = 60 * 60_000;   // ohne Reset-Zeit aus dem Fehler: 1 Stunde
export const CHAT_LABEL = 'Chat-Schlüssel';

export const fp = (token: string) => createHash('sha256').update(token).digest('hex').slice(0, 8);

const stateDir = () => process.env.BRIDGE_STATE_DIR || join(process.cwd(), '..', '.runtime', 'bridge');
let state: Record<string, Exhausted> | null = null;

function load(): Record<string, Exhausted> {
  if (state) return state;
  try { state = JSON.parse(readFileSync(join(stateDir(), 'claude-accounts.json'), 'utf8')); } catch { state = {}; }
  return state!;
}

function save() {
  const now = Date.now();
  const s = load();
  for (const [u, ex] of Object.entries(s)) {
    for (const [id, v] of Object.entries(ex)) if (!(v?.until > now)) delete ex[id];
    if (!Object.keys(ex).length) delete s[u];
  }
  mkdirSync(stateDir(), { recursive: true });
  const f = join(stateDir(), 'claude-accounts.json');
  writeFileSync(f + '.tmp', JSON.stringify(s, null, 1), { mode: 0o600 });
  renameSync(f + '.tmp', f);
}

/** Vermerke je Konto einer Person (nur noch gültige). */
export function exhaustedOf(user: string): Exhausted {
  const now = Date.now();
  return Object.fromEntries(Object.entries(load()[user] ?? {}).filter(([, v]) => v?.until > now));
}

export function markExhausted(user: string, a: Account, resetsAt?: number) {
  const until = resetsAt && resetsAt > Date.now() ? resetsAt : Date.now() + DEFAULT_RESET_MS;
  const s = load();
  s[user] = { ...(s[user] ?? {}), [a.id]: { until, fp: fp(a.token) } };
  save();
}

/**
 * Welche Konten in welcher Reihenfolge versucht werden: alle nicht erschöpften in der Reihenfolge der Person. Sind alle
 * erschöpft, einmal das mit dem frühesten Reset (vielleicht ist es schon wieder frei).
 */
export function pickAccounts(accounts: Account[], ex: Exhausted, now = Date.now()): Account[] {
  const busy = (a: Account) => { const v = ex[a.id]; return !!v && v.until > now && (!v.fp || v.fp === fp(a.token)); };
  const free = accounts.filter((a) => !busy(a));
  if (free.length || !accounts.length) return free;
  return [[...accounts].sort((x, y) => ex[x.id].until - ex[y.id].until)[0]];
}

/** Reset-Zeitpunkt aus rate_limit_info (Sekunden oder Millisekunden seit 1970) → ms. */
export function resetMs(v: unknown): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n < 1e12 ? n * 1000 : n;
}

/** Konten in Reihenfolge, ohne Doppelte; `chat` (token null) = der Schlüssel aus der Anfrage. Immer mindestens dieser. */
export function normalizeAccounts(list: { id?: unknown; label?: unknown; token?: unknown }[] | null | undefined, chatToken: string): Account[] {
  const out: Account[] = [];
  const seen = new Set<string>();
  for (const a of list ?? []) {
    const id = String(a?.id ?? '');
    const token = id === 'chat' ? chatToken : typeof a?.token === 'string' ? a.token : '';
    if (!/^[\w-]{1,40}$/.test(id) || !token || seen.has(token)) continue;
    seen.add(token);
    out.push({ id, label: String(a?.label ?? '').slice(0, 40) || (id === 'chat' ? CHAT_LABEL : id), token });
  }
  // Der Schlüssel aus der Anfrage ist immer dabei — fehlt er in der Liste der Werkbank, als letztes Konto.
  if (!seen.has(chatToken)) out.push({ id: 'chat', label: CHAT_LABEL, token: chatToken });
  return out;
}

export function isRateLimitText(s: string): boolean {
  return /rate.?limit|\b429\b|usage limit|quota/i.test(s);
}

type QueryFn = (p: { prompt: string; options: Record<string, any> }) => AsyncIterable<any>;

/**
 * Testet ein Konto mit einem Minimalzug (ein Modellaufruf, keine Werkzeuge, keine MCP-Server) in der Konfiguration der
 * Person. Ergebnis ohne Inhalte: ok, oder die Fehlerart (rate_limit mit Reset, auth, failed).
 */
export async function testAccount(query: QueryFn, p: { token: string; cwd: string; home: ClaudeHome }): Promise<{ ok: boolean; error?: 'rate_limit' | 'auth' | 'failed'; resetsAt?: number }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 60_000);
  const env = cleanEnv(p.token);
  const options: Record<string, any> = {
    cwd: p.cwd, settingSources: [], tools: [], mcpServers: {}, maxTurns: 1, permissionMode: 'default', abortController: abort, env,
    canUseTool: async () => ({ behavior: 'deny', message: 'nur Test' }), skills: [],
  };
  applyHome(p.home, env, options);
  let reset: number | undefined;
  let error: 'rate_limit' | 'auth' | 'failed' | undefined;
  let ok = false;
  try {
    for await (const m of query({ prompt: 'Antworte nur mit: ok', options })) {
      if (m.type === 'rate_limit_event' && m.rate_limit_info?.status === 'rejected') reset = resetMs(m.rate_limit_info.resetsAt);
      if (m.type === 'assistant' && m.error) error = m.error === 'rate_limit' ? 'rate_limit' : /auth|oauth|billing|account|verification/.test(m.error) ? 'auth' : 'failed';
      if (m.type === 'result') ok = !error && m.subtype === 'success' && !m.is_error;
    }
  } catch (e: any) {
    const t = String(e?.message ?? e).replaceAll(p.token, '***');
    error = isRateLimitText(t) ? 'rate_limit' : /auth|401|token|login/i.test(t) ? 'auth' : 'failed';
    log('kontotest fehlgeschlagen', { error: t.slice(0, 200) });
  } finally { clearTimeout(timer); }
  if (ok) return { ok: true };
  return { ok: false, error: error ?? 'failed', ...(error === 'rate_limit' ? { resetsAt: reset ?? Date.now() + DEFAULT_RESET_MS } : {}) };
}
