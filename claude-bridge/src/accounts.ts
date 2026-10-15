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

export interface Account {
  id: string; label: string; token: string;
  // Melious (Plan 162): Open-Weight-Modelle über die Anthropic-kompatible API. Nur, wenn die Werkbank es liefert (eingeschaltet).
  kind?: 'claude' | 'melious';
  model?: string;          // Melious: fester Modellname; leer = Claude-Namen durchreichen (Melious bildet sie ab)
  rest?: number;           // Melious: verbleibende Tokens bis zum Tages-/Monatsdeckel (Werkbank)
  fallback?: boolean;      // Melious: auch als letzter Ausweg, wenn alle Claude-Konten erschöpft sind
  sperre?: string;         // Melious: warum gesperrt (Deckel), für die Meldung
  // Melious-Lastverteilung (S7): Modelle mit freiem Monatsanteil (0..1, absteigend, Werkbank) und zulässige Modelle je Rolle.
  pool?: { model: string; frei: number }[];
  rollen?: Record<string, string[]>;   // je Rolle in Wunsch-Reihenfolge (die Werkbank ordnet nach Energie-Lage, S8)
  // Energie (S8): rest = verbleibende geschätzte Energie bis zum Deckel; Faktoren je Modell (Energie je 1 Mio. Tokens);
  // Nachfüll-Takt in Sekunden; eco = Modelle mit „:eco“ ansprechen (Melious leitet dann auf sparsamere Rechenzentren).
  faktoren?: Record<string, Faktor>;
  taktS?: number;
  eco?: boolean;
  // Knuts Setup (15.10.): Ersatzkette Opus → Sonnet → Melious (ketteModell, Vorgabe glm-5.3) für Hauptchat und Strang-Leads,
  // ohne Warte-Sperren; vorrang = Energietopf nahe der Obergrenze → niedrig-riskante Arbeit zuerst auf Melious.
  kette?: boolean;
  ketteModell?: string;
  vorrang?: boolean;
  chainModel?: string;   // nur in der Warteschlange: dieses Konto mit diesem Modell (Stufe der Ersatzkette)
}
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

// Lastverteilung (Knut, 11.10.2026): neue Züge verteilen sich auf die freien Konten, statt das zweite erst zu nehmen, wenn
// das erste erschöpft ist. Konto = Fingerabdruck des Tokens (über alle Personen: ein Konto, ein Kontingent). Eine
// laufende Unterhaltung behält ihr Konto (klebrig), solange es frei ist. Nur im Speicher; nach einem Neustart neu verteilt.
// BRIDGE_ACCOUNT_BALANCE=off → alte Reihenfolge (erstes freies Konto zuerst).
const running = new Map<string, number>();     // fp → laufende Züge
const lastPick = new Map<string, number>();    // fp → Zeitpunkt (Zähler) der letzten Wahl
const picks = new Map<string, number>();       // Konto-ID → gewählte Züge seit Start (für /health, ohne Tokens)
const stickyMap = new Map<string, string>();   // Unterhaltung → fp
let pickSeq = 0;

export const balanceOn = () => (process.env.BRIDGE_ACCOUNT_BALANCE ?? 'on') !== 'off';

/**
 * Reihenfolge der freien Konten für einen neuen Zug: zuerst das Konto der Unterhaltung (falls frei), dann das mit den
 * wenigsten laufenden Zügen, bei Gleichstand das am längsten nicht gewählte, sonst die Reihenfolge der Person.
 */
export function balance(queue: Account[], o: { sticky?: string; running: (fp: string) => number; last: (fp: string) => number }): Account[] {
  const f = queue.map((a, i) => ({ a, i, fp: fp(a.token) }));
  f.sort((x, y) => Number(y.fp === o.sticky) - Number(x.fp === o.sticky) || o.running(x.fp) - o.running(y.fp) || o.last(x.fp) - o.last(y.fp) || x.i - y.i);
  return f.map((x) => x.a);
}

export function orderForTurn(queue: Account[], conv: string): Account[] {
  if (!balanceOn() || queue.length < 2) return queue;
  return balance(queue, { sticky: stickyMap.get(conv), running: (k) => running.get(k) ?? 0, last: (k) => lastPick.get(k) ?? 0 });
}

/** Zug beginnt auf diesem Konto (auch nach einem Wechsel). Gibt die Freigabe zurück. */
export function acquire(conv: string, a: Account): () => void {
  const k = fp(a.token);
  running.set(k, (running.get(k) ?? 0) + 1);
  lastPick.set(k, ++pickSeq);
  picks.set(a.id, (picks.get(a.id) ?? 0) + 1);
  stickyMap.set(conv, k);
  if (stickyMap.size > 5000) stickyMap.delete(stickyMap.keys().next().value!);
  let done = false;
  return () => { if (done) return; done = true; const n = (running.get(k) ?? 1) - 1; if (n > 0) running.set(k, n); else running.delete(k); };
}

/** Für /health: laufende Züge je Konto-Fingerabdruck-Anzahl und gewählte Züge je Konto-ID — keine Tokens. */
export function balanceStats() {
  return { verteilung: balanceOn() ? 'an' : 'aus', kontenLaufend: running.size, laufendeZuege: [...running.values()].reduce((a, b) => a + b, 0), gewaehlt: Object.fromEntries(picks), melious: meliousStats() };
}

/** Reset-Zeitpunkt aus rate_limit_info (Sekunden oder Millisekunden seit 1970) → ms. */
export function resetMs(v: unknown): number | undefined {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n < 1e12 ? n * 1000 : n;
}

const MODEL_NAME = /^[\w.:/-]{1,80}$/;
/** Pool der Lastverteilung aus der Werkbank: gültige Namen, frei in [0,1], absteigend nach frei. */
const poolOf = (v: unknown) => (Array.isArray(v) ? v : [])
  .filter((p: any) => typeof p?.model === 'string' && MODEL_NAME.test(p.model) && Number.isFinite(Number(p.frei)))
  .map((p: any) => ({ model: p.model as string, frei: Math.max(0, Math.min(1, Number(p.frei))) }))
  .sort((x, y) => y.frei - x.frei).slice(0, 20);
export type Faktor = { in: number; out: number; cache?: number };   // Energie je 1 Mio. Tokens (Eingabe, Ausgabe, Cache-Treffer)
const faktorenOf = (v: unknown): Record<string, Faktor> => Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {})
  .filter(([k, f]: [string, any]) => MODEL_NAME.test(k) && Number(f?.in) >= 0 && Number(f?.out) >= 0).slice(0, 30).map(([k, f]: [string, any]) => [k, { in: Number(f.in), out: Number(f.out), ...(Number(f?.cache) >= 0 && f?.cache !== undefined && f?.cache !== null ? { cache: Number(f.cache) } : {}) }]));
const rollenOf = (v: unknown): Record<string, string[]> => Object.fromEntries(Object.entries(v && typeof v === 'object' ? v : {})
  .filter(([k, l]) => /^[a-z]{1,20}$/.test(k) && Array.isArray(l)).map(([k, l]) => [k, (l as unknown[]).filter((m): m is string => typeof m === 'string' && MODEL_NAME.test(m)).slice(0, 20)]));

/** Konten in Reihenfolge, ohne Doppelte; `chat` (token null) = der Schlüssel aus der Anfrage. Immer mindestens dieser. */
export function normalizeAccounts(list: { id?: unknown; label?: unknown; token?: unknown; kind?: unknown; model?: unknown; pool?: unknown; rollen?: unknown; faktoren?: unknown; taktS?: unknown; eco?: unknown; kette?: unknown; ketteModell?: unknown; vorrang?: unknown; rest?: unknown; fallback?: unknown; sperre?: unknown }[] | null | undefined, chatToken: string): Account[] {
  const out: Account[] = [];
  const seen = new Set<string>();
  for (const a of list ?? []) {
    const id = String(a?.id ?? '');
    if (a?.kind === 'melious') {
      const token = typeof a.token === 'string' ? a.token : '';
      if (id !== MELIOUS_ID || !MELIOUS_KEY.test(token) || seen.has(token) || out.some(isMelious)) continue;
      seen.add(token);
      const name = (v: unknown) => (typeof v === 'string' && /^[\w.:/-]{1,80}$/.test(v) ? v : undefined);
      out.push({ id, label: MELIOUS_LABEL, token, kind: 'melious', model: name(a.model), pool: poolOf(a.pool), rollen: rollenOf(a.rollen), faktoren: faktorenOf(a.faktoren), taktS: Number(a.taktS) > 0 ? Math.min(86_400, Number(a.taktS)) : undefined, eco: a.eco === true, kette: a.kette === true, ketteModell: name(a.ketteModell), vorrang: a.vorrang === true, rest: Math.max(0, Number(a.rest) || 0), fallback: a.fallback === true, sperre: typeof a.sperre === 'string' ? a.sperre.slice(0, 160) : undefined });
      continue;
    }
    const token = id === 'chat' ? chatToken : typeof a?.token === 'string' ? a.token : '';
    if (!/^[\w-]{1,40}$/.test(id) || !token || seen.has(token)) continue;
    seen.add(token);
    out.push({ id, label: String(a?.label ?? '').slice(0, 40) || (id === 'chat' ? CHAT_LABEL : id), token });
  }
  // Der Schlüssel aus der Anfrage ist immer dabei — fehlt er in der Liste der Werkbank, als letztes Claude-Konto.
  if (!seen.has(chatToken)) out.push({ id: 'chat', label: CHAT_LABEL, token: chatToken });
  return out;
}

// ---------- Melious (Plan 162, Knut 14.10.2026: testweise, vorsichtig, Verbrauch im Blick) ----------
// Standard aus: die Werkbank liefert das Konto nur, wenn Melious in der Einrichtung erlaubt ist. Genommen wird es dann nur
// (a) in Chats mit `/melious an` — dort zuerst — oder (b) mit „letzter Ausweg“, wenn kein Claude-Konto frei ist. Nie in der
// Lastverteilung, nie bei aufgebrauchtem Deckel (rest 0).

export const MELIOUS_ID = 'melious';
export const MELIOUS_LABEL = 'Melious';
export const MELIOUS_KEY = /^sk-mel-[\w-]{8,200}$/;
export const MELIOUS_HINT = 'Open-Weight-Modell, Ergebnisse prüfen';
export const meliousBaseUrl = () => process.env.MELIOUS_BASE_URL || 'https://api.melious.ai';
export const isMelious = (a?: Account | null) => a?.kind === 'melious';

/**
 * Warteschlange eines Zugs: Claude-Konten wie bisher (frei, verteilt), dazu Melious — vorne mit Chat-Schalter, hinten als
 * letzter Ausweg (nur mit `fallback` und wenn der Zug überlaufen darf: Risiko „niedrig“). Erschöpft oder Deckel erreicht → nie.
 */
export function planQueue(accounts: Account[], ex: Exhausted, o: { conv: string; chatOn: boolean; overflow?: boolean; kette?: boolean; sonnetStufe?: boolean; now?: number }): Account[] {
  const now = o.now ?? Date.now();
  const mel = accounts.find(isMelious);
  const claude = accounts.filter((a) => !isMelious(a));
  const queue = orderForTurn(pickAccounts(claude, ex, now), o.conv);
  const melOk = !!mel && meliousUsable(mel, ex, now);
  // Ersatzkette (Knut 15.10., Hauptchat und Strang-Leads, ohne Warte-Sperren): erst die Claude-Konten mit dem bestellten Modell
  // (Opus), dann alle Claude-Konten mit Sonnet (eigenes Kontingent), dann Melious mit dem Ketten-Modell (Vorgabe glm-5.3).
  if (o.kette) {
    const sonnet = o.sonnetStufe ? claude.map((a) => ({ ...a, chainModel: 'sonnet' })) : [];
    return [...(o.chatOn && melOk ? [mel!] : []), ...queue, ...sonnet, ...(melOk && !o.chatOn ? [{ ...mel!, chainModel: mel!.ketteModell ?? 'glm-5.3' }] : [])];
  }
  if (!melOk) return queue;
  if (o.chatOn) return [mel!, ...queue];
  return mel!.fallback && o.overflow !== false ? [...queue, mel!] : queue;
}

export function meliousUsable(mel: Account, ex: Exhausted, now = Date.now()): boolean {
  const v = ex[mel.id];
  return (mel.rest ?? 0) > 0 && !(v && v.until > now && (!v.fp || v.fp === fp(mel.token)));
}

// Modellnamen, die Claude Code neben dem Hauptmodell benutzt (Teilagenten, schnelles Hilfsmodell): bei Melious mit festem Modell
// auf dieses Modell, sonst bleiben die Claude-Namen (Melious bildet opus/sonnet/haiku ab).
const MODEL_ENV = ['ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL'];
const PROVIDER_ENV = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS', ...MODEL_ENV];

/**
 * Env eines Versuchs: Claude wie bisher (OAuth-Token, keine Basis-URL; Modell- und Beta-Einstellungen wie im Brücken-Prozess);
 * Melious: Basis-URL + API-Schlüssel, kein OAuth-Token, mit `model` alle Modellnamen auf dieses Modell.
 */
export function accountEnv(env: Record<string, string | undefined>, a: Account, model?: string) {
  for (const k of PROVIDER_ENV) delete env[k];
  if (!isMelious(a)) {
    env.CLAUDE_CODE_OAUTH_TOKEN = a.token;
    for (const k of ['CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS', ...MODEL_ENV]) if (process.env[k]) env[k] = process.env[k];
    return;
  }
  env.ANTHROPIC_BASE_URL = meliousBaseUrl();
  env.ANTHROPIC_API_KEY = a.token;
  // Für Gateways: weniger Anthropic-Betas. Einige schickt Claude Code trotzdem (Stub-Test 14.10.: claude-code, context-1m,
  // interleaved-thinking, effort …) — ob Melious sie ignoriert, zeigt erst der echte Zug.
  env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '1';
  if (model) for (const k of MODEL_ENV) env[k] = model;
}

/**
 * Fehlerart eines Melious-Fehlers (null = kein Grund zum Wechsel). „guthaben“: echter Test 14.10.2026 — jeder POST /v1/messages
 * ohne Guthaben antwortet 403 {"type":"error","error":{"type":"permission_error","message":"Insufficient credits…"}}, Claude Code
 * zeigt das als „Failed to authenticate. API Error: 403 Insufficient credits“ (Fehlerart authentication_failed). Das ist KEIN
 * ungültiger Schlüssel. Laut Doku auch 402 BILLING_2001/2003 (out of energy/credits).
 */
// PRO-Plan (Nachtrag 15.10.): Melious begrenzt über einen Energietopf, der alle 45 min nachfüllt. „energie“ = Topf leer
// (402 BILLING_2001 / out of energy) → nur bis zum nächsten Nachfüll-Takt. „guthaben“ = Credits außerhalb des Plans leer
// (403 „Insufficient credits“, 402 BILLING_2003) → bis Monatswechsel/Zurücksetzen. „limit“ = 429 (180 Anfragen/min) → Retry-After.
export type MeliousFehler = 'energie' | 'guthaben' | 'schluessel' | 'limit';
export function meliousErrorKind(code: unknown, text = ''): MeliousFehler | null {
  if (/insufficient credits|out of credits|BILLING_2003/i.test(text)) return 'guthaben';
  if (/BILLING_2001|out of energy|\b402\b/i.test(text) || code === 'billing_error') return 'energie';
  if (code === 'rate_limit' || /\b429\b|AUTH_1028|rate.?limit|quota/i.test(text)) return 'limit';
  if (code === 'authentication_failed' || /\b(401|403)\b|AUTH_10\d\d|invalid.{0,20}(key|token)/i.test(text)) return 'schluessel';
  return null;
}
export const meliousExhaustedError = (code: unknown, text = '') => meliousErrorKind(code, text) !== null;

/** Bis wann ein Melious-Fehler das Konto aus dem Wechsel nimmt (ms). taktS = Nachfüll-Takt der Energie (Vorgabe 2700 s). */
export function meliousResetAt(kind: MeliousFehler, text = '', o: { now?: number; taktS?: number } = {}): number {
  const now = o.now ?? Date.now();
  if (kind === 'guthaben') return nextBerlinMonth(now);
  if (kind === 'energie') return now + (o.taktS ?? (Number(process.env.MELIOUS_TAKT_S) || 2700)) * 1000;
  if (kind === 'limit') { const s = Number(/retry[- ]?after\D{0,5}(\d{1,5})/i.exec(text)?.[1]); return now + (s > 0 ? s : 60) * 1000; }
  return now + DEFAULT_RESET_MS;
}

/** Geschätzte Energie eines Melious-Versuchs: Tokens × Faktor des Modells (Energie je 1 Mio. Tokens; `:eco` zählt wie das Modell). */
export function energieOf(u: MeliousUsage, model: string | undefined, faktoren: Record<string, Faktor> | undefined): number {
  const f = faktoren?.[String(model ?? '').replace(/:eco$/, '')] ?? faktoren?.standard;
  if (!f) return 0;
  // wie die Werkbank: Cache-Treffer zum Cache-Preis (Annahme), ohne Cache-Preis zum Eingabepreis.
  return ((u.input + u.cacheWrite) * f.in + u.cacheRead * (f.cache ?? f.in) + u.output * f.out) / 1e6;
}

/** Beginn des nächsten Monats in Europe/Berlin (ms) — bis dahin gilt „Guthaben leer“, wenn niemand vorher zurücksetzt. */
export function nextBerlinMonth(now = Date.now()): number {
  const berlin = (t: number) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).format(t);
  const [y, m] = berlin(now).slice(0, 7).split('-').map(Number);
  const want = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01 00`;
  for (const off of [1, 2]) { const t = Date.UTC(y, m, 1) - off * 3600_000; if (berlin(t) === want) return t; }
  return Date.UTC(y, m, 1);
}

/** Vermerk „erschöpft“ für ein Konto aufheben (Einrichtung: „zurücksetzen“, z. B. nach dem Aufladen bei Melious). */
export function clearExhausted(user: string, id: string): boolean {
  const s = load();
  if (!s[user]?.[id]) return false;
  delete s[user][id];
  save();
  return true;
}

// Chat-Schalter „mit Melious testen“ (je Unterhaltung, Standard aus). Zustand ohne Geheimnisse: .runtime/bridge/melious-chats.json.
// Je Chat optional ein Modell (Knut 14.10.: im PRO-Plan GLM 5.3 / GLM 5.3 Flash / DeepSeek V4.1 Flash / V4 Flash — expliziter
// Name statt nur der opus/sonnet/haiku-Abbildung); es gilt vor dem Modell aus der Einrichtung.
export const MELIOUS_MODEL = /^[\w.:/-]{1,80}$/;
let chats: Record<string, { at: number; model?: string }> | null = null;
const chatsFile = () => join(stateDir(), 'melious-chats.json');
function loadChats() { if (!chats) { try { chats = JSON.parse(readFileSync(chatsFile(), 'utf8')); } catch { chats = {}; } } return chats!; }
export const meliousChatOn = (conv: string) => !!loadChats()[conv];
export const meliousChatModel = (conv: string) => loadChats()[conv]?.model;
/** an/aus je Chat; `model`: Name setzen, null = zurück auf die Einrichtung, undefined = unverändert. */
export function setMeliousChat(conv: string, on: boolean, model?: string | null) {
  const c = loadChats();
  if (on) c[conv] = { at: Date.now(), model: model === undefined ? c[conv]?.model : model ?? undefined }; else delete c[conv];
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(chatsFile() + '.tmp', JSON.stringify(c, null, 1), { mode: 0o600 });
  renameSync(chatsFile() + '.tmp', chatsFile());
}

// Für /health: Melious-Züge und Tokens seit Start (ohne Schlüssel).
export type MeliousUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };
const mel = { zuege: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
export function countMelious(u: MeliousUsage) { mel.zuege++; mel.input += u.input; mel.output += u.output; mel.cacheRead += u.cacheRead; mel.cacheWrite += u.cacheWrite; }
export const meliousStats = () => ({ ...mel, chatsAn: Object.keys(loadChats()).length });
export const usageTotal = (u: MeliousUsage) => u.input + u.output + u.cacheRead + u.cacheWrite;
/** usage eines SDK-Ergebnisses bzw. einer API-Antwort → die vier Zählwerte. */
export const usageOf = (u: any): MeliousUsage => ({ input: Number(u?.input_tokens) || 0, output: Number(u?.output_tokens) || 0, cacheRead: Number(u?.cache_read_input_tokens) || 0, cacheWrite: Number(u?.cache_creation_input_tokens) || 0 });

export function isRateLimitText(s: string): boolean {
  return /rate.?limit|\b429\b|usage limit|quota/i.test(s);
}

type QueryFn = (p: { prompt: string; options: Record<string, any> }) => AsyncIterable<any>;

/**
 * Testet ein Konto mit einem Minimalzug (ein Modellaufruf, keine Werkzeuge, keine MCP-Server) in der Konfiguration der
 * Person. Ergebnis ohne Inhalte: ok, oder die Fehlerart (rate_limit mit Reset, auth, failed).
 */
export async function testAccount(query: QueryFn, p: { token: string; cwd: string; home: ClaudeHome; melious?: boolean; model?: string }): Promise<{ ok: boolean; error?: 'rate_limit' | 'auth' | 'failed' | 'guthaben'; resetsAt?: number; usage?: MeliousUsage }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 60_000);
  const env = cleanEnv(p.token);
  if (p.melious) accountEnv(env, { id: MELIOUS_ID, label: MELIOUS_LABEL, token: p.token, kind: 'melious' }, p.model);
  const options: Record<string, any> = {
    cwd: p.cwd, settingSources: [], tools: [], mcpServers: {}, maxTurns: 1, permissionMode: 'default', abortController: abort, env,
    canUseTool: async () => ({ behavior: 'deny', message: 'nur Test' }), skills: [],
  };
  applyHome(p.home, env, options);
  if (p.melious && p.model) options.model = p.model;
  let reset: number | undefined;
  let error: 'rate_limit' | 'auth' | 'failed' | 'guthaben' | undefined;
  let ok = false;
  let usage: MeliousUsage | undefined;   // Melious: der Test zählt mit (Werkbank)
  try {
    for await (const m of query({ prompt: 'Antworte nur mit: ok', options })) {
      if (m.type === 'rate_limit_event' && m.rate_limit_info?.status === 'rejected') reset = resetMs(m.rate_limit_info.resetsAt);
      if (m.type === 'assistant' && m.error) error = p.melious && meliousErrorKind(m.error, (m.message?.content ?? []).map((b: any) => b?.text ?? '').join(' ')) === 'guthaben' ? 'guthaben' : m.error === 'rate_limit' ? 'rate_limit' : /auth|oauth|billing|account|verification/.test(m.error) ? 'auth' : 'failed';
      if (m.type === 'result') ok = !error && m.subtype === 'success' && !m.is_error;
      if (p.melious && m.type === 'result') { usage = usageOf(m.usage); countMelious(usage); }
    }
  } catch (e: any) {
    const t = String(e?.message ?? e).replaceAll(p.token, '***');
    error = p.melious && meliousErrorKind(null, t) === 'guthaben' ? 'guthaben' : isRateLimitText(t) ? 'rate_limit' : /auth|401|token|login/i.test(t) ? 'auth' : 'failed';
    log('kontotest fehlgeschlagen', { error: t.slice(0, 200) });
  } finally { clearTimeout(timer); }
  if (ok) return { ok: true, ...(usage ? { usage } : {}) };
  return { ok: false, error: error ?? 'failed', ...(error === 'rate_limit' ? { resetsAt: reset ?? Date.now() + DEFAULT_RESET_MS } : error === 'guthaben' ? { resetsAt: nextBerlinMonth() } : {}), ...(usage ? { usage } : {}) };
}
