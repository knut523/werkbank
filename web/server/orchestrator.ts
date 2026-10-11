// Orchestrator-Stränge (docs/plan-orchestrator-agents.md, Knut 09.10.2026: „schau, dass du einzelne Agents auf der
// Werkbank startest und koordinierst (du bist der Orchestrator)“).
//
// Die Haupt-Sitzung von Claude Code startet über den internen Kanal (scripts/orch → /internal/orchestrator/*) je
// Arbeitsstrang einen normalen Werkbank-Chat in Knuts Konto: Titel „Orchestrator · …“, Lesezeichen „Orchestrator“,
// Arbeitsordner = der angegebene Worktree. Die Brücke kennt den Strang vorab (die Web-App wählt die
// Unterhaltungs-ID und meldet sie an, bevor der Chat entsteht) und setzt dort strengere Sperren: kein GitHub-/Jira-
// Schreiben, keine Rückfragen. Status kommt aus dem ausdrücklichen Zustand der Brücke (Zug läuft / Ausgang) und —
// nur bei normalem Ende — aus der Status-Marke der letzten Antwort.

import { randomUUID } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { cfg } from './config.ts';
import { wb, lc } from './db.ts';
import { librechatAccessToken, type User } from './auth.ts';
import { createLibreChat } from './agent.ts';
import { prepareFresh } from './fresh.ts';
import { pruefe, parsePlan, protokolliere, g0Text, g0Optionen, OHNE_PR, vorbauAus, type VorbauErgebnis } from './vorbau.ts';
import { vienna } from './hygiene.ts';

export const ORCH_TAG = 'Orchestrator';
export type OrchStatus = 'running' | 'waiting' | 'done' | 'failed' | 'blocked_g0';

const internalHeaders = () => ({ 'content-type': 'application/json', 'x-werkbank-internal': process.env.WERKBANK_INTERNAL_TOKEN ?? '' });
const err = (status: number, msg: string) => Object.assign(new Error(msg), { status });
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 OLAF-Werkbank';

export interface BriefInput { title: string; prompt: string; cwd: string; plan?: string | null; person?: string; stand?: string | null }

/** Erster Text des Strangs. Erste Zeile = Titel; der Auftrag steht am Ende. */
export function orchBrief(b: BriefInput): string {
  const first = (b.person || 'Knut').split(/\s+/)[0];
  return [
    `Orchestrator · ${b.title}`,
    ...(b.stand ? [b.stand] : []),
    `Du bist ein Werkbank-Agent für einen Arbeitsstrang. Die Haupt-Sitzung (Orchestrator) hat dich gestartet und koordiniert mehrere Stränge; ${first} liest im Chat mit und kann jederzeit selbst schreiben.`,
    [
      'Regeln:',
      `- Arbeitsordner: \`${b.cwd}\` (dein aktuelles Verzeichnis). Arbeite dort; andere Repos und den Vault nur lesen, außer der Auftrag sagt ausdrücklich etwas anderes.`,
      b.plan ? `- Plandatei: \`${b.plan}\` — lies sie zuerst vollständig und arbeite danach (Definition of Done wörtlich nehmen).` : '- Gibt es keine Plandatei und ist der Auftrag nicht trivial: erst kurz planen (plan-to-pr), dann umsetzen.',
      '- Lokale Commits im Arbeitsordner sind erlaubt, wenn der Auftrag sie verlangt. **Nie pushen, keine Pull Requests, nie mergen, nie Jira oder Confluence schreiben, keine Tickets anlegen** — das ist hier technisch gesperrt; versuch nicht, es zu umgehen.',
      '- Es gibt keine Rückfragen im Chat: was eine Freigabe bräuchte, wird abgelehnt. Mach ohne diesen Schritt weiter, so weit es geht, und schreib es unter „Braucht Knut“ auf.',
      '- Offene inhaltliche Entscheidungen sammelst du und stellst sie am Ende gesammelt (je Kontext · Optionen · Empfehlung). Nichts still annehmen, was wirklich Knuts Entscheidung ist.',
      '- Tests und Prüfungen des Repos laufen lassen, bevor du „fertig“ meldest.',
    ].join('\n'),
    [
      'Schließe JEDE Antwort mit diesem Abschnitt (die Haupt-Sitzung liest ihn maschinell; nach „Status:“ genau eines der drei Wörter — „fertig“ nur, wenn der Auftrag erledigt und geprüft ist):',
      '```text',
      '### Stand',
      '- Erledigt: …',
      '- Offen: …',
      '- Braucht Knut: … (oder „nichts“)',
      'Status: fertig | braucht Antwort | blockiert',
      '```',
      'Schreib den Abschnitt selbst als normales Markdown, nicht als Codeblock.',
    ].join('\n'),
    `---\n\nAuftrag:\n${b.prompt.trim()}`,
  ].join('\n\n');
}

/** Text einer gespeicherten LibreChat-Nachricht: Agenten-Endpunkte legen ihn in content[] ab, `text` ist dann leer. */
export function messageText(m: any): string {
  if (!m) return '';
  const parts = Array.isArray(m.content) ? m.content.filter((p: any) => p?.type === 'text').map((p: any) => (typeof p.text === 'string' ? p.text : p.text?.value ?? '')).join('') : '';
  return (parts || String(m.text ?? '')).trim();
}

/** Status-Marke der letzten Antwort („Status: fertig | braucht Antwort | blockiert“), die letzte zählt. */
export function statusMark(text: string): 'fertig' | 'braucht Antwort' | 'blockiert' | null {
  const all = [...text.matchAll(/^[\s>*_-]*Status[*_]*\s*:\s*[*_]*\s*(fertig|braucht Antwort|blockiert)\b/gim)];
  const v = all.at(-1)?.[1]?.toLowerCase();
  return v === 'fertig' ? 'fertig' : v === 'braucht antwort' ? 'braucht Antwort' : v === 'blockiert' ? 'blockiert' : null;
}

export interface StrandState { running: boolean; interrupted: boolean; turn: { start: number; end: number | null; outcome: string | null } | null }
export interface LastMsg { fromUser: boolean; text: string; error: boolean; at: number }

/**
 * Status eines Strangs (rein, testbar). Reihenfolge: Startfehler → läuft (Brücke) → abgebrochen (Neustart) → letzte
 * Nachricht noch nicht bei der Brücke → Ausgang des Zuges → Status-Marke der Antwort.
 */
export type AutoCause = 'limit' | 'timeout' | 'interrupted' | 'lost' | 'busy' | 'rate_limit';

export function orchStatus(run: { startError?: string | null; startedAt: Date | number; lastSentAt?: Date | number | null }, s: StrandState | null | undefined, last: LastMsg | null, now = Date.now()): { status: OrchStatus; reason: string; cause?: AutoCause } {
  if (run.startError) return { status: 'failed', reason: `Start fehlgeschlagen: ${run.startError}` };
  if (s?.running) return { status: 'running', reason: 'Zug läuft' };
  if (s?.interrupted) return { status: 'failed', reason: 'Zug abgebrochen (Brücke neu gestartet) — mit `send <id> weiter` fortsetzen', cause: 'interrupted' };
  const sent = new Date(run.lastSentAt ?? run.startedAt).getTime();
  if (!s?.turn || s.turn.start < sent - 5000) {
    if (last?.error && last.at >= sent - 5000) return { status: 'failed', reason: `LibreChat meldet einen Fehler: ${last.text.slice(0, 160)}` };
    if (now - sent < 180_000) return { status: 'running', reason: 'startet (Nachricht unterwegs zur Brücke)' };
    return { status: 'failed', reason: 'Nachricht ist nach 3 Minuten nicht bei der Brücke angekommen — `send <id> weiter` oder Chat ansehen', cause: 'lost' };
  }
  switch (s.turn.outcome) {
    case 'busy': return { status: 'failed', reason: 'Parallelgrenze der Brücke (BRIDGE_MAX_PARALLEL_CHATS) — später `send <id> weiter`', cause: 'busy' };
    case 'limit': return { status: 'waiting', reason: 'Schrittlimit des Zuges erreicht — `send <id> weiter`', cause: 'limit' };
    case 'timeout': return { status: 'waiting', reason: 'Zeitlimit des Zuges (15 min) erreicht — `send <id> weiter`', cause: 'timeout' };
    case 'rate_limit': return { status: 'failed', reason: 'Claude-Kontingent ausgeschöpft', cause: 'rate_limit' };
    case 'error': return { status: 'failed', reason: 'Fehler in der Claude-Sitzung — Chat ansehen, ggf. `send <id> weiter`' };
    case 'aborted': return { status: 'failed', reason: 'Zug abgebrochen' };
  }
  // Normal beendet: die Antwort speichert LibreChat erst nach dem Zug.
  if (!last || last.fromUser) {
    if (s.turn.end && now - s.turn.end < 60_000) return { status: 'running', reason: 'Antwort wird gespeichert' };
    return { status: 'waiting', reason: 'keine gespeicherte Antwort — Chat ansehen' };
  }
  if (last.error) return { status: 'failed', reason: `LibreChat meldet einen Fehler: ${last.text.slice(0, 160)}` };
  const mark = statusMark(last.text);
  if (mark === 'fertig') return { status: 'done', reason: 'Agent meldet „fertig“' };
  if (mark === 'blockiert') return { status: 'failed', reason: 'Agent meldet „blockiert“' };
  if (mark === 'braucht Antwort') return { status: 'waiting', reason: 'Agent braucht eine Antwort' };
  return { status: 'waiting', reason: 'Antwort ohne Status-Marke — lesen und antworten' };
}

// ---------- Automatisch fortsetzen (docs/plan-orchestrator-auto-weiter.md, Knut 11.10.2026: „max schrittlimits … mit dem
// orchestrator sollte das nicht passieren“) ----------
//
// Endet ein Zug eines orchestrierten Strangs an einer technischen Grenze (Schrittlimit, Zeitlimit, Brücken-Neustart,
// Nachricht nicht angekommen, Parallelgrenze, Kontingent), schickt die Werkbank selbst „weiter“. Nie bei geprüften
// Strängen, nach review_ready, bei offener Rückfrage zum Strang und nach dem Deckel. Normale Chats stehen nicht in
// orchestrator_runs und bleiben unberührt.

export const AUTO_BUSY_MS = 2 * 60_000, AUTO_RATE_MS = 30 * 60_000, AUTO_SAVE_MS = 30_000, AUTO_STALE_MS = 6 * 3600_000;
export const autoMax = () => Math.max(1, Math.floor(Number(process.env.ORCH_AUTO_WEITER_MAX)) || 30);
export const CAUSE_TEXT: Record<AutoCause, string> = { limit: 'Schrittlimit', timeout: 'Zeitlimit', interrupted: 'Brücke neu gestartet', lost: 'Nachricht nicht angekommen', busy: 'Parallelgrenze', rate_limit: 'Kontingent' };

export interface AutoRun { startedAt: Date | number; lastSentAt?: Date | number | null; reviewedAt?: unknown; reviewReadyAt?: unknown; autoStopped?: unknown; autoStreak?: number; autoFor?: string | null }
export interface AutoCtx { now: number; openQuestion: boolean; accountFree: boolean; max: number }
export type AutoDecision = { action: 'none' | 'wait' | 'send' | 'stop'; key?: string; why: string };

/** Ob und wann ein Strang automatisch fortgesetzt wird (rein, testbar). `key` kennzeichnet den Zug, der fortgesetzt wird. */
export function autoWeiter(run: AutoRun, st: { cause?: AutoCause }, s: StrandState | null | undefined, last: LastMsg | null, ctx: AutoCtx): AutoDecision {
  const cause = st.cause;
  if (!cause) return { action: 'none', why: 'kein technisches Zugende' };
  if (run.reviewedAt) return { action: 'none', why: 'geprüft' };
  if (run.reviewReadyAt) return { action: 'none', why: 'review_ready gemeldet' };
  if (run.autoStopped) return { action: 'none', why: 'Deckel erreicht' };
  if (ctx.openQuestion) return { action: 'none', why: 'wartet auf eine Rückfrage' };
  const sent = new Date(run.lastSentAt ?? run.startedAt).getTime();
  const t = s?.turn ?? null;
  let key = cause === 'lost' || !t ? `s:${sent}` : `t:${t.start}`;
  // Abgebrochener Zug, aber danach schon gesendet: wie „unterwegs“, nach 3 min wie „nicht angekommen“.
  if (cause === 'interrupted' && t && t.start < sent - 5000) {
    if (ctx.now - sent < 180_000) return { action: 'wait', why: 'Nachricht unterwegs' };
    key = `s:${sent}`;
  }
  if (run.autoFor === key) return { action: 'none', why: 'dieser Zug ist schon fortgesetzt' };
  const end = t?.end ?? t?.start ?? sent;
  // Review-Pass: alte Zugenden nie (sonst setzt der erste Takt nach dem Ausrollen tagealte Stränge auf einmal fort).
  if (ctx.now - Math.max(end, sent) > AUTO_STALE_MS) return { action: 'none', why: 'Zugende länger als 6 h her — von Hand fortsetzen' };
  if (cause === 'busy' && ctx.now - end < AUTO_BUSY_MS) return { action: 'wait', key, why: 'Parallelgrenze — erneut nach 2 min' };
  if (cause === 'rate_limit' && ctx.now - end < AUTO_RATE_MS && !ctx.accountFree) return { action: 'wait', key, why: 'Kontingent — erneut nach 30 min oder bei freiem Konto' };
  // Council R1, Bedingung 1: erst wenn LibreChat die Antwort des Zuges gespeichert hat (sonst falsche Elternnachricht).
  if ((cause === 'limit' || cause === 'timeout') && t && !(last && !last.fromUser && last.at >= t.start - 5000) && ctx.now - end < AUTO_SAVE_MS) return { action: 'wait', key, why: 'Antwort wird gespeichert' };
  if ((run.autoStreak ?? 0) >= ctx.max) return { action: 'stop', key, why: `${ctx.max}× automatisch fortgesetzt — Chat ansehen` };
  return { action: 'send', key, why: CAUSE_TEXT[cause] };
}

// ---------- LibreChat (im Namen der Person) ----------

async function lcFetch(u: User, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ status: number; j: any }> {
  const token = await librechatAccessToken(u);
  const r = await fetch(`${cfg.librechatUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': UA },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  return { status: r.status, j: await r.json().catch(() => null) };
}

/** Titel „Orchestrator · …“ und Lesezeichen setzen, sobald LibreChat die Unterhaltung gespeichert hat. Idempotent. */
export async function decorate(u: User, conv: string, title: string): Promise<{ ok: boolean; why?: string }> {
  const c: any = await lc().collection('conversations').findOne({ conversationId: conv, user: u.id }, { projection: { title: 1, tags: 1 } });
  if (!c) return { ok: false, why: 'Unterhaltung noch nicht gespeichert' };
  const want = `Orchestrator · ${title}`.slice(0, 200);
  if (c.title !== want) {
    const r = await lcFetch(u, '/api/convos/update', { method: 'POST', body: { arg: { conversationId: conv, title: want } } });
    if (r.status >= 300) return { ok: false, why: `Titel: LibreChat ${r.status}` };
  }
  const tags: string[] = Array.isArray(c.tags) ? c.tags : [];
  if (!tags.includes(ORCH_TAG)) {
    const existing = await lcFetch(u, '/api/tags');
    if (Array.isArray(existing.j) && !existing.j.some((t: any) => t?.tag === ORCH_TAG)) {
      await lcFetch(u, '/api/tags', { method: 'POST', body: { tag: ORCH_TAG, description: 'Stränge, die die Haupt-Sitzung über die Werkbank gestartet hat' } });
    }
    const r = await lcFetch(u, `/api/tags/convo/${encodeURIComponent(conv)}`, { method: 'PUT', body: { tags: [...tags, ORCH_TAG] } });
    if (r.status >= 300) return { ok: false, why: `Lesezeichen: LibreChat ${r.status}` };
  }
  return { ok: true };
}

async function decorateSoon(u: User, conv: string, title: string, tries = 20) {
  for (let i = 0; i < tries; i++) {
    try { if ((await decorate(u, conv, title)).ok) return; } catch { /* weiter versuchen */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function lastMessage(u: User, conv: string): Promise<(LastMsg & { id: string }) | null> {
  const m: any = await lc().collection('messages').find({ conversationId: conv, user: u.id }).sort({ createdAt: -1 }).limit(1).next();
  return m ? { id: String(m.messageId), fromUser: !!m.isCreatedByUser, text: messageText(m), error: !!m.error, at: new Date(m.createdAt ?? 0).getTime() } : null;
}

async function strandStates(u: User): Promise<Map<string, StrandState & { dir: string; written: string[] }>> {
  const r = await fetch(`${cfg.bridgeUrl}/internal/orch-state?user=${encodeURIComponent(u.id)}`, { headers: internalHeaders(), signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw err(502, `Brücke antwortet mit ${r.status}`);
  const j: any = await r.json();
  return new Map((j.strands ?? []).map((s: any) => [s.conv, s]));
}

// ---------- Öffentliche Schnittstelle ----------

export interface StartInput { title: string; prompt: string; cwd: string; plan?: string | null; shared?: boolean; code?: boolean; slug?: string | null; aufrufer?: string; g0?: G0Tor | null }

const runs = () => wb().collection('orchestrator_runs');

async function newId(): Promise<string> {
  for (;;) { const id = randomUUID().slice(0, 8); if (!(await runs().findOne({ _id: id as any }))) return id; }
}

export async function startOrch(u: User, inp: StartInput): Promise<{ id: string; conv: string; url: string; cwd: string; plan: string | null; mode: any; stand: string | null; g0: G0Public | null; worktree: boolean; warning?: string }> {
  const title = String(inp.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const prompt = String(inp.prompt ?? '').trim();
  if (!title) throw err(400, 'Titel fehlt.');
  if (!prompt) throw err(400, 'Auftrag fehlt.');
  if (prompt.length > 40_000) throw err(400, 'Auftrag zu lang (höchstens 40 000 Zeichen) — Details in eine Plandatei.');
  let real: string;
  try { real = realpathSync(String(inp.cwd ?? '')); } catch { throw err(400, 'Arbeitsordner gibt es nicht.'); }
  let plan: string | null = null;
  if (inp.plan) {
    try { plan = realpathSync(String(inp.plan)); if (!statSync(plan).isFile()) throw new Error(); } catch { throw err(400, 'Plandatei gibt es nicht.'); }
  }
  // G0 „Prüfung vor dem Bau“ (docs/plan-vorbau-check.md): jeder Code-Auftrag. Treffer/Stopp → kein Start, Rückfrage.
  let g0: G0Tor | null = null;
  if (inp.code === true && !vorbauAus()) {   // WERKBANK_VORBAU_CHECK=off → kein G0, nichts blockiert
    g0 = inp.g0 ?? await g0Tor(u, { slug: inp.slug ?? null, plan, cwd: real, aufrufer: inp.aufrufer ?? 'orch start --code', title });
    if (!g0.go) throw Object.assign(err(409, g0.text), { g0: g0.public });
  }
  // Neuester Code (Knut 11.10.2026, fresh.ts): git fetch; Code-Auftrag → frischer Worktree vom Integrationszweig.
  const id = await newId();
  const fresh = prepareFresh(real, id, inp.code === true);
  real = fresh.cwd;
  // Ein Worktree, ein offener Strang (Council, Bedingung 8).
  if (!inp.shared) {
    const open = (await listOrch(u, { all: false })).filter((r) => r.cwd === real && (r.status === 'running' || r.status === 'waiting'));
    if (open.length) throw err(409, `Im Ordner arbeitet schon der Strang ${open[0].id} („${open[0].title}“, ${open[0].status}). Eigenen Worktree nehmen oder --shared.`);
  }
  const conv = randomUUID();
  // 1) Bei der Brücke anmelden (prüft den Ordner selbst). Ohne Anmeldung kein Chat (fail closed).
  const reg = await fetch(`${cfg.bridgeUrl}/internal/orchestrate`, { method: 'POST', headers: internalHeaders(), body: JSON.stringify({ userId: u.id, email: u.email, conv, dir: real }), signal: AbortSignal.timeout(5000) });
  const rj: any = await reg.json().catch(() => ({}));
  if (!reg.ok) throw err(reg.status === 400 || reg.status === 409 || reg.status === 403 ? reg.status : 502, rj.error ?? `Brücke antwortet mit ${reg.status}`);
  const stand = [fresh.status, g0 ? g0.text : null].filter(Boolean).join('\n') || null;
  const text = orchBrief({ title, prompt, cwd: rj.dir ?? real, plan, person: u.name, stand });
  const doc: any = { _id: id, userId: u.id, conv, url: `${cfg.librechatPublicUrl}/c/${conv}`, title, cwd: rj.dir ?? real, plan, prompt: prompt.slice(0, 500), startedAt: new Date(), lastSentAt: new Date(), sends: 1, reviewedAt: null, mode: rj.mode ?? null, startError: null, slug: g0?.slug ?? null, g0: g0?.public ?? null };
  await runs().insertOne(doc);
  // 2) Chat mit genau dieser ID anlegen; LibreChat fährt den Zug serverseitig.
  try {
    await createLibreChat(u, text, { conversationId: conv });
  } catch (e: any) {
    await runs().updateOne({ _id: id as any }, { $set: { startError: String(e.message ?? e).slice(0, 300) } });
    throw err(e.status ?? 502, String(e.message ?? e));
  }
  // 3) Titel + Lesezeichen im Hintergrund (LibreChat speichert die Unterhaltung erst nach ein paar Sekunden).
  decorateSoon(u, conv, title).catch(() => {});
  return { id, conv, url: doc.url, cwd: doc.cwd, plan, mode: doc.mode, stand, g0: g0?.public ?? null, worktree: fresh.worktree, ...(doc.mode && doc.mode !== 'auto' ? { warning: `Brücke läuft für dieses Konto im Modus „${doc.mode}“ — ohne Auto-Modus darf der Strang nur lesen.` } : {}) };
}

export async function listOrch(u: User, opts: { all?: boolean } = {}) {
  const docs: any[] = await runs().find({ userId: u.id, ...(opts.all ? {} : { reviewedAt: null }) }).sort({ startedAt: -1 }).limit(100).toArray();
  if (!docs.length) return [];
  let states = new Map<string, any>();
  let bridgeError: string | null = null;
  try { states = await strandStates(u); } catch (e: any) { bridgeError = String(e.message ?? e); }
  const out = [];
  for (const d of docs) {
    if (d.status === 'blocked_g0') {
      out.push({ id: d._id, title: d.title, status: 'blocked_g0' as OrchStatus, reason: `G0 ${d.g0?.ergebnis === 'stopp' ? 'nicht prüfbar' : 'Treffer'} — Rückfrage ${d.question ?? '?'} in der Werkbank (Heute)`, reviewed: !!d.reviewedAt, url: null, cwd: d.cwd, plan: d.plan,
        startedAt: d.startedAt, lastSentAt: d.startedAt, lastActivity: new Date(d.startedAt).getTime(), sends: 0, excerpt: d.g0?.text ?? '', written: [], slug: d.slug, g0: d.g0 ?? null, question: d.question ?? null });
      continue;
    }
    const last = await lastMessage(u, d.conv);
    const s = states.get(d.conv);
    let st: { status: OrchStatus; reason: string } = bridgeError ? { status: 'failed', reason: `Brücke nicht erreichbar: ${bridgeError}` } : orchStatus(d, s, last);
    if (d.autoStopped && st.status !== 'running') st = { status: 'failed', reason: String(d.autoStopped.reason) };
    // Titel/Lesezeichen nachziehen, falls der Start-Durchlauf es nicht geschafft hat (selbstheilend, idempotent).
    if (!d.decorated && !d.startError) { try { if ((await decorate(u, d.conv, d.title)).ok) await runs().updateOne({ _id: d._id }, { $set: { decorated: true } }); } catch { /* nächstes Mal */ } }
    out.push({
      id: d._id, title: d.title, status: st.status, reason: st.reason, reviewed: !!d.reviewedAt, url: d.url, cwd: d.cwd, plan: d.plan,
      startedAt: d.startedAt, lastSentAt: d.lastSentAt, lastActivity: Math.max(s?.turn?.end ?? 0, s?.turn?.start ?? 0, last?.at ?? 0) || null,
      sends: d.sends ?? 1, autoWeiter: d.autoTotal ?? 0, autoLast: d.autoLastAt ? { at: d.autoLastAt, cause: d.autoLastCause ?? null } : null, reviewReady: !!d.reviewReadyAt, excerpt: last && !last.fromUser ? excerpt(last.text) : '', written: s?.written ?? [],
    });
  }
  return out;
}

/** Auszug der letzten Antwort: der Abschnitt „### Stand“, sonst das Ende. */
export function excerpt(text: string, n = 600): string {
  const i = text.lastIndexOf('### Stand');
  const t = (i >= 0 ? text.slice(i) : text.slice(-n)).replace(/^\s*\*[^*\n]*\*\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

async function ownRun(u: User, id: string) {
  const d: any = await runs().findOne({ _id: id as any, userId: u.id });
  if (!d) throw err(404, `Strang ${id} gibt es nicht.`);
  return d;
}

export async function showOrch(u: User, id: string) {
  const d = await ownRun(u, id);
  const item = (await listOrch(u, { all: true })).find((r) => r.id === id);
  const last = d.conv ? await lastMessage(u, d.conv) : null;
  return { ...item, conv: d.conv, prompt: d.prompt, lastMessage: last ? { fromUser: last.fromUser, at: new Date(last.at), text: last.text.slice(-20_000) } : null };
}

export async function sendOrch(u: User, id: string, text: string) {
  const msg = String(text ?? '').trim();
  if (!msg) throw err(400, 'Nachricht fehlt.');
  const d = await ownRun(u, id);
  if (d.status === 'blocked_g0') throw err(409, `Strang ${id} wurde von G0 vor dem Bau gestoppt — erst die Rückfrage ${d.question ?? ''} in der Werkbank beantworten.`);
  const item = (await listOrch(u, { all: true })).find((r) => r.id === id);
  if (item?.status === 'running') throw err(409, `Strang ${id} arbeitet noch (${item.reason}) — warten, dann senden.`);
  await deliver(u, d.conv, msg);
  // Handnachricht: der Deckel beginnt neu, Stopp und review_ready sind aufgehoben (Council R1, Bedingung 4).
  await runs().updateOne({ _id: d._id }, { $set: { lastSentAt: new Date(), reviewedAt: null, reviewReadyAt: null, autoStreak: 0, autoStopped: null }, $inc: { sends: 1 } });
  await questions().updateMany({ userId: u.id, kind: 'auto-weiter', 'strand.id': d._id, status: 'offen' }, { $set: { status: 'zurückgezogen', withdrawnAt: new Date() } });
  return { id, conv: d.conv, url: d.url };
}

/** Nachricht an den Chat hängen (Elternnachricht = letzte gespeicherte); LibreChat 409 = Zug noch nicht abgeschlossen. */
async function deliver(u: User, conv: string, msg: string) {
  for (let i = 0; ; i++) {
    const last = await lastMessage(u, conv);
    if (!last) throw err(409, 'Im Chat ist noch keine Nachricht gespeichert.');
    try {
      await createLibreChat(u, msg, { conversationId: conv, parentMessageId: last.id });
      return;
    } catch (e: any) {
      if (e.status === 409 && i < 5) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      throw err(e.status ?? 502, String(e.message ?? e));
    }
  }
}

export interface AutoDeps { userById: (id: string) => Promise<User | null>; accountFree: (u: User) => Promise<boolean>; log?: (msg: string, data: Record<string, unknown>) => void }

let ticking = false;

/** Ein Durchgang über alle offenen Stränge (alle Personen). Läuft nie doppelt im Prozess (Council R1, Bedingung 3). */
export async function autoWeiterTick(deps: AutoDeps) {
  if (ticking) return;
  ticking = true;
  try {
    const docs: any[] = await runs().find({ reviewedAt: null, reviewReadyAt: null, startError: null, autoStopped: null, conv: { $ne: null }, status: { $ne: 'blocked_g0' }, startedAt: { $gt: new Date(Date.now() - 14 * 86400_000) } }).toArray();
    const byUser = new Map<string, any[]>();
    for (const d of docs) byUser.set(d.userId, [...(byUser.get(d.userId) ?? []), d]);
    for (const [userId, list] of byUser) {
      const u = await deps.userById(userId).catch(() => null);
      if (!u) continue;
      let states: Map<string, any>;
      try { states = await strandStates(u); } catch { continue; }   // Brücke weg: nichts entscheiden
      for (const d of list) {
        try { await autoOne(u, d, states.get(d.conv), deps); } catch (e: any) { deps.log?.('orch-auto-weiter fehler', { id: d._id, error: String(e?.message ?? e).slice(0, 200) }); }
      }
    }
  } finally { ticking = false; }
}

async function autoOne(u: User, d: any, s: any, deps: AutoDeps) {
  if (s?.running) return;
  const last = await lastMessage(u, d.conv);
  const st = orchStatus(d, s, last);
  if (!st.cause) return;
  const openQuestion = (await questions().countDocuments({ userId: u.id, 'strand.id': d._id, status: 'offen' })) > 0;
  const accountFree = st.cause === 'rate_limit' ? await deps.accountFree(u).catch(() => false) : false;
  const max = autoMax();
  const dec = autoWeiter(d, st, s, last, { now: Date.now(), openQuestion, accountFree, max });
  if (dec.action === 'stop') {
    const at = new Date();
    const r = await runs().updateOne({ _id: d._id, autoStopped: null }, { $set: { autoStopped: { at, reason: dec.why, cause: st.cause } } });
    if (!r.modifiedCount) return;
    // Eintrag in „Heute“: eine Rückfrage zum Strang (zählt in „Heute (n)“, blockiert weitere Fortsetzungen).
    let qid: string;
    do { qid = 'q-' + randomUUID().slice(0, 6); } while (await questions().findOne({ _id: qid as any }));
    await questions().insertOne({
      _id: qid, userId: u.id, kind: 'auto-weiter', title: `Strang „${d.title}“: ${dec.why}`.slice(0, 140),
      context: `Der Strang ${d._id} wurde ${max}-mal ohne Zutun fortgesetzt (zuletzt: ${CAUSE_TEXT[st.cause]}) und hält jetzt an. Arbeitsordner: ${d.cwd}.`,
      options: [{ label: 'Fortsetzen', consequence: 'Schickt „weiter“; der Zähler für den Deckel beginnt neu.' }, { label: 'Anhalten', consequence: 'Der Strang gilt als geprüft und läuft nicht weiter.' }],
      recommendation: 'Chat ansehen: kommt der Strang voran, „Fortsetzen“; dreht er sich im Kreis, „Anhalten“ und den Auftrag schärfen.',
      strand: { id: d._id, title: d.title, url: d.url }, link: d.url, plan: d.plan ?? null, createdAt: at, status: 'offen', answer: null,
    } as any);
    deps.log?.('orch-auto-weiter deckel', { id: d._id, max });
    return;
  }
  if (dec.action !== 'send') return;
  // Anspruch (atomar, überlebt den Neustart) — mit lastSentAt: kommt die Nachricht nie an, greift nach 3 min „lost“ (Bedingung 2).
  const n = (d.autoStreak ?? 0) + 1;
  const r = await runs().updateOne({ _id: d._id, autoFor: d.autoFor ?? null, autoStopped: null },
    { $set: { autoFor: dec.key, lastSentAt: new Date(), autoLastAt: new Date(), autoLastCause: st.cause }, $inc: { autoTotal: 1, autoStreak: 1, sends: 1 } });
  if (!r.modifiedCount) return;
  deps.log?.('orch-auto-weiter', { id: d._id, cause: st.cause, n });
  await deliver(u, d.conv, `weiter (automatisch fortgesetzt: ${CAUSE_TEXT[st.cause]}, ${n}/${max})`);
}

/** Takt für autoWeiterTick (aus main.ts); ORCH_AUTO_WEITER=off schaltet ab. */
export function startAutoWeiter(deps: AutoDeps) {
  if (process.env.ORCH_AUTO_WEITER === 'off') return null;
  const ms = Math.max(200, Number(process.env.ORCH_AUTO_WEITER_TICK_MS) || 20_000);
  return setInterval(() => { autoWeiterTick(deps).catch((e) => deps.log?.('orch-auto-weiter fehler', { error: String(e?.message ?? e).slice(0, 200) })); }, ms);
}

export async function reviewOrch(u: User, id: string, note = '') {
  const d = await ownRun(u, id);
  await runs().updateOne({ _id: d._id }, { $set: { reviewedAt: new Date(), reviewNote: String(note).slice(0, 500) } });
  return { id, reviewed: true };
}

// ---------- Rückfragen an Knut (Knut, 09.10.2026: „Wenn du Fragen hast, kannst du mir über die Werkbank eine
// Notification senden — für alle Dinge, wo du wirklich Input brauchst“) ----------
//
// Der Orchestrator legt eine Entscheidungsfrage an (Titel, Kontext, Optionen mit Folgen, Empfehlung, Bezug zu Strang/
// Plan). Sie erscheint in der Werkbank unter Heute → „Wartet auf dich“ und zählt in „Heute (n)“; Knut antwortet
// dort (Option und/oder Freitext); der Orchestrator liest die Antwort über die CLI. Regel: nur, was wirklich Knuts
// Entscheidung ist — nichts, was der Orchestrator selbst klären, nachlesen oder sicher entscheiden kann.

export interface AskInput { title: string; context: string; options?: { label: string; consequence?: string }[]; recommendation: string; strand?: string | null; link?: string | null; plan?: string | null;
  /** Stabiler Schlüssel (z. B. `<slug>#G0`): offen oder beantwortet → keine zweite Frage (409). */
  key?: string | null;
  /** Herkunft; für Automaten (`drift`) höchstens AUTO_PRO_TAG neue Fragen je Tag (429). */
  quelle?: string | null;
  g0?: { kriterien: string[]; ergebnis: string; belege?: string[] } | null }

export const AUTO_PRO_TAG = 5;

const questions = () => wb().collection('orchestrator_questions');

export async function askKnut(u: User, inp: AskInput) {
  const title = String(inp.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
  const context = String(inp.context ?? '').trim().slice(0, 2000);
  const recommendation = String(inp.recommendation ?? '').trim().slice(0, 600);
  if (!title || !context || !recommendation) throw err(400, 'Rückfrage braucht Titel, Kontext und Empfehlung (Regel: nur echte Entscheidungen, mit eigener Empfehlung).');
  const options = (Array.isArray(inp.options) ? inp.options : []).slice(0, 6).map((o) => ({ label: String(o?.label ?? '').trim().slice(0, 120), consequence: String(o?.consequence ?? '').trim().slice(0, 400) })).filter((o) => o.label);
  if (new Set(options.map((o) => o.label)).size !== options.length) throw err(400, 'Optionen müssen verschieden heißen.');
  let strand: { id: string; title: string; url: string } | null = null;
  if (inp.strand) {
    const r: any = await runs().findOne({ _id: String(inp.strand) as any, userId: u.id });
    if (!r) throw err(404, `Strang ${inp.strand} gibt es nicht.`);
    strand = { id: r._id, title: r.title, url: r.url };
  }
  const link = inp.link ? String(inp.link).slice(0, 500) : null;
  if (link && !/^(https?:\/\/|\/)/.test(link)) throw err(400, 'Link muss mit http(s):// oder / beginnen.');
  const key = inp.key ? String(inp.key).trim() : null;
  if (key && !/^[\w.-]{2,100}#[\w-]{1,20}$/.test(key)) throw err(400, 'Schlüssel hat die Form <slug>#<kennung>, z. B. kohorte-laufender-monat#G0.');
  const quelle = inp.quelle ? String(inp.quelle).slice(0, 30) : null;
  if (key) {
    const da: any = await questions().findOne({ userId: u.id, keyActive: key });
    if (da) throw Object.assign(err(409, `Schlüssel ${key} ist schon ${da.status} (${da._id}) — keine zweite Frage.`), { existing: String(da._id) });
  }
  if (quelle === 'drift') {
    const n = await questions().countDocuments({ userId: u.id, quelle, day: vienna().date });
    if (n >= AUTO_PRO_TAG) throw err(429, `Tageskappe: schon ${n} neue Rückfragen von „${quelle}“ heute (höchstens ${AUTO_PRO_TAG}).`);
  }
  let id: string;
  do { id = 'q-' + randomUUID().slice(0, 6); } while (await questions().findOne({ _id: id as any }));
  const doc: any = { _id: id, userId: u.id, title, context, options, recommendation, strand, link, plan: inp.plan ? String(inp.plan).slice(0, 500) : null, createdAt: new Date(), status: 'offen', answer: null,
    ...(key ? { key, keyActive: key } : {}), ...(quelle ? { quelle, day: vienna().date } : {}), ...(inp.g0 ? { g0: inp.g0 } : {}) };
  try { await questions().insertOne(doc); }
  catch (e: any) { if (e?.code === 11000) throw err(409, `Schlüssel ${key} ist schon vergeben — keine zweite Frage.`); throw e; }
  return publicQuestion(doc);
}

export function publicQuestion(d: any) {
  return { id: String(d._id), kind: d.kind ?? 'frage', title: d.title, context: d.context, options: d.options ?? [], recommendation: d.recommendation, strand: d.strand ?? null, link: d.link ?? null, plan: d.plan ?? null, createdAt: d.createdAt, status: d.status, answer: d.answer ?? null, key: d.key ?? null, quelle: d.quelle ?? null };
}

export async function listQuestions(u: User, opts: { open?: boolean; limit?: number } = {}) {
  const docs = await questions().find({ userId: u.id, ...(opts.open ? { status: 'offen' } : {}) }).sort({ createdAt: -1 }).limit(opts.limit ?? 50).toArray();
  return docs.map(publicQuestion);
}

export async function getQuestion(u: User, id: string) {
  const d = await questions().findOne({ _id: id as any, userId: u.id });
  if (!d) throw err(404, `Rückfrage ${id} gibt es nicht.`);
  return publicQuestion(d);
}

/** Knut antwortet (Werkbank-Oberfläche): Option und/oder Freitext. Eine beantwortete Frage bleibt beantwortet. */
export async function answerQuestion(u: User, id: string, a: { option?: string | null; text?: string | null }) {
  const d: any = await questions().findOne({ _id: id as any, userId: u.id });
  if (!d) throw err(404, 'Diese Rückfrage gibt es nicht.');
  if (d.status !== 'offen') throw err(409, d.status === 'beantwortet' ? 'Schon beantwortet.' : 'Vom Orchestrator zurückgezogen.');
  const option = a.option ? String(a.option) : null;
  const text = String(a.text ?? '').trim().slice(0, 4000);
  if (option && !(d.options ?? []).some((o: any) => o.label === option)) throw err(400, 'Unbekannte Option.');
  if (!option && !text) throw err(400, 'Option wählen oder Antwort schreiben.');
  const answer = { option, text, at: new Date(), by: u.email };
  const r = await questions().updateOne({ _id: id as any, status: 'offen' }, { $set: { status: 'beantwortet', answer } });
  if (!r.modifiedCount) throw err(409, 'Schon beantwortet.');
  // G0: jeder gewählte Knopf ins Protokoll (Fehlalarme, Kriterium „anderer Autor“ gesondert — DoD 13, 25).
  if (typeof d.key === 'string' && d.key.endsWith('#G0')) protokolliere({ art: 'knopf', slug: d.key.slice(0, -3), knopf: option ?? 'Freitext', text: text.slice(0, 200), kriterien: d.g0?.kriterien ?? [], ergebnis: d.g0?.ergebnis ?? null, frage: id, durch: u.email });
  // Deckel der automatischen Fortsetzung: die Antwort wirkt sofort auf den Strang.
  let action: string | null = null;
  if (d.kind === 'auto-weiter' && d.strand?.id && option) {
    try {
      if (option === 'Fortsetzen') { await sendOrch(u, d.strand.id, 'weiter'); action = 'fortgesetzt'; }
      if (option === 'Anhalten') { await reviewOrch(u, d.strand.id, 'angehalten nach dem Deckel der automatischen Fortsetzung'); action = 'angehalten'; }
    } catch (e: any) { action = `nicht ausgeführt: ${String(e.message ?? e).slice(0, 200)}`; }
  }
  return { ...publicQuestion({ ...d, status: 'beantwortet', answer }), ...(action ? { action } : {}) };
}

export async function withdrawQuestion(u: User, id: string) {
  const r = await questions().updateOne({ _id: id as any, userId: u.id, status: 'offen' }, { $set: { status: 'zurückgezogen', withdrawnAt: new Date() }, $unset: { keyActive: '' } });
  if (!r.matchedCount) throw err(409, 'Keine offene Rückfrage mit dieser Kennung.');
  return { id, status: 'zurückgezogen' };
}

// ---------- G0-Tor (docs/plan-vorbau-check.md) ----------
//
// Vor jedem Code-Bau (orch start --code, Nachtbau): vorbau-check. frei/fortsetzen → bauen, die Belege stehen im Chat.
// Treffer oder Stopp → kein Bau und EINE Rückfrage `<slug>#G0` mit den Knöpfen; gebaut wird danach nur über Knuts Antwort
// in der Werkbank („trotzdem bauen“, „auf Vorhandenem aufsetzen“, tagsüber „ohne PR-Prüfung bauen“), protokolliert.
// Nachts baut ein Stopp nie (Nachtbau aus) und fragt nicht je Item — der Nachtbau legt einen einzigen Morgeneintrag an.

export interface G0Public { ergebnis: string; text: string; belege: { text: string; pr?: string; sha?: string }[]; kriterien: string[]; stopp: string | null; question: string | null }
export interface G0Tor { go: boolean; slug: string; text: string; ergebnis: VorbauErgebnis; question: string | null; public: G0Public }
const BAUEN = new Set(['trotzdem bauen', 'auf Vorhandenem aufsetzen']);

/** Repos im Umfang: das Repo des Arbeitsordners und WERKBANK_VORBAU_REPOS (Komma), ohne Dubletten. */
export function g0Repos(cwd: string | null, env = process.env): string[] {
  const out = new Set<string>();
  for (const d of [cwd, ...(env.WERKBANK_VORBAU_REPOS ?? '').split(',')].map((x) => (x ?? '').trim()).filter(Boolean)) { try { out.add(realpathSync(d)); } catch { out.add(d); } }
  return [...out];
}

/** Kennungen der Treffer-Belege (PR-Link, sonst SHA, sonst Repo:Pfad) — woran eine Antwort gebunden ist. */
export const belegIds = (r: VorbauErgebnis) => r.belege.filter((b) => b.wirkung === 'treffer').map((b) => b.pr ?? b.sha ?? `${b.repo}:${b.pfad ?? b.branch ?? b.text}`);
/** Dasselbe aus einem Fragetext (Rückfragen von drift über `orch ask`, ohne strukturierte Belege). */
export const belegIdsAusText = (t: string) => [...t.matchAll(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+|\b[0-9a-f]{40}\b|[\w.-]+:(?:plans|docs)\/[\w.-]+\.md/g)].map((m) => m[0]);

/** Slug aus --slug oder dem Plan (`spec:`, sonst **Spec:**, sonst Plan-Slug). */
export function g0Slug(slug: string | null | undefined, plan: string | null | undefined): string {
  if (slug && String(slug).trim()) return String(slug).trim();
  if (plan) { try { const p = parsePlan(readFileSync(plan, 'utf8'), plan); return p.spec ?? p.specHeader ?? p.planSlug ?? ''; } catch { /* unten */ } }
  return '';
}

export async function g0Tor(u: User, o: { slug: string | null; plan: string | null; cwd: string | null; aufrufer: string; nachts?: boolean; strand?: string | null; title?: string }): Promise<G0Tor> {
  const slug = g0Slug(o.slug, o.plan);
  if (!slug) throw err(400, 'G0 (Prüfung vor dem Bau) braucht --slug <spec-slug> oder eine Plandatei mit `spec:` — ohne Identität kein Code-Bau.');
  const repos = g0Repos(o.cwd);
  let r = await pruefe({ slug, planDatei: o.plan, repos, aufrufer: o.aufrufer });
  const key = `${slug}#G0`;
  const mk = (go: boolean, text: string, q: string | null): G0Tor => ({ go, slug, text, ergebnis: r, question: q, public: { ergebnis: r.ergebnis, text: g0Text(r), belege: r.belege.map((b) => ({ text: b.text, pr: b.pr, sha: b.sha })), kriterien: r.kriterien, stopp: r.stopp?.grund ?? null, question: q } });
  if (r.ergebnis === 'frei' || r.ergebnis === 'fortsetzen') return mk(true, g0Text(r), null);
  if (o.nachts && r.ergebnis === 'stopp') return mk(false, `G0 nachts nicht prüfbar (${r.stopp!.grund}) — Nachtbau aus. ${r.stopp!.text}`, null);
  let da: any = await questions().findOne({ userId: u.id, keyActive: key });
  // Eine Antwort gilt nur für die Belege, die Knut gesehen hat: neue Treffer-Belege → die alte Frage ist überholt,
  // es gibt eine neue (sonst würde ein altes „trotzdem bauen“ einen später aufgetauchten fremden PR durchwinken).
  if (da?.status === 'beantwortet' && r.ergebnis === 'treffer') {
    const gesehen = new Set<string>(da.g0?.belege ?? belegIdsAusText(String(da.context ?? '')));
    if (belegIds(r).some((x) => !gesehen.has(x))) {
      await questions().updateOne({ _id: da._id, keyActive: key }, { $unset: { keyActive: '' }, $set: { ueberholtAt: new Date() } });
      da = null;
    }
  }
  if (da?.status === 'beantwortet') {
    const opt = da.answer?.option ?? '';
    const qid = String(da._id);
    const h = vienna().hour;
    if (opt === OHNE_PR && r.stopp?.grund === 'pr-api' && !o.nachts && h >= 6 && h < 22) {   // nur tagsüber
      r = await pruefe({ slug, planDatei: o.plan, repos, aufrufer: o.aufrufer, ohnePr: true });
      if (r.ergebnis === 'frei' || r.ergebnis === 'fortsetzen') { protokolliere({ art: 'override', slug, knopf: opt, aufrufer: o.aufrufer, frage: qid }); return mk(true, `${g0Text(r)}\nKnut hat „${OHNE_PR}“ gewählt (Rückfrage ${qid}, protokolliert).`, qid); }
      return mk(false, `G0: auch ohne PR-Prüfung ein Treffer, Rückfrage ${qid} ist aber schon beantwortet — kein Bau.\n${g0Text(r)}`, qid);
    }
    if (BAUEN.has(opt)) {
      protokolliere({ art: 'override', slug, knopf: opt, aufrufer: o.aufrufer, frage: qid });
      return mk(true, `${g0Text(r)}\nKnut hat „${opt}“ gewählt (Rückfrage ${qid}, protokolliert)${opt === 'auf Vorhandenem aufsetzen' ? ' — auf dem gefundenen Branch/PR aufsetzen, nicht neu bauen.' : '.'}`, qid);
    }
    return mk(false, `G0: Knut hat auf Rückfrage ${qid} „${opt || 'Freitext'}“ geantwortet — kein Bau.${da.answer?.text ? ` (${String(da.answer.text).slice(0, 200)})` : ''}`, qid);
  }
  if (da) return mk(false, `G0 ${r.ergebnis === 'stopp' ? 'Stopp' : 'Treffer'} — Rückfrage ${da._id} wartet noch auf Knut.\n${g0Text(r)}`, String(da._id));
  const treffer = r.ergebnis === 'treffer';
  const q = await askKnut(u, {
    key, quelle: o.aufrufer.split(' ')[0], strand: o.strand ?? null, plan: o.plan,
    title: treffer ? `Schon gebaut oder in Arbeit? „${o.title || slug}“` : `Vor dem Bau nicht prüfbar: „${o.title || slug}“`,
    context: `${o.title ? `Auftrag: ${o.title}\n` : ''}Spec: ${slug}\n${g0Text(r)}`,
    options: g0Optionen(r, o.nachts),
    recommendation: treffer
      ? (r.belege.some((b) => b.wirkung === 'treffer' && (b.art === 'baut' || b.art === 'autor')) ? 'auf Vorhandenem aufsetzen — erst mit dem anderen PR abstimmen' : 'Spec nachziehen/abräumen — die Arbeit liegt schon vor')
      : r.stopp!.knopf ? `${OHNE_PR}, wenn es eilt — sonst warten, bis die PR-API wieder antwortet` : 'warten, bis das neue Lesetoken da ist; „trotzdem bauen“ nur, wenn es eilt',
    g0: { kriterien: r.kriterien, ergebnis: r.ergebnis, belege: belegIds(r) },
  }).catch((e: any) => { if (e.status === 409) return null; throw e; });
  return mk(false, `G0 ${treffer ? 'Treffer' : 'Stopp'} — kein Bau. Rückfrage ${q?.id ?? key} in der Werkbank (Heute → Wartet auf dich).\n${g0Text(r)}`, q?.id ?? null);
}

// ---------- Nachtbau (DoD 9, 17, 24) ----------
//
// Aufrufer: `scripts/orch nachtbau --queue <datei>` (Cron, Patch in review-pakete/129-vorbau-check/patches/). Die Datei
// hält die von Knut freigegebenen Items (JSONL: slug, title, cwd, plan, prompt). Je Item G0; Treffer → Strang `blocked_g0`
// (sichtbar in „Heute“, mit der Rückfrage `<slug>#G0`) und weiter mit dem nächsten Item. Ist G0 nicht prüfbar
// (Lesetoken, Fetch, PR-API) → kein Bau, und genau EIN Morgeneintrag „G0 nachts nicht prüfbar“ je Nacht.

/** Für „Heute“: vor dem Bau gestoppte Stränge mit Belegen und dem Stand ihrer Rückfrage. */
export async function g0Blocked(u: User) {
  const docs: any[] = await runs().find({ userId: u.id, status: 'blocked_g0', reviewedAt: null }).sort({ startedAt: -1 }).limit(20).toArray();
  const out = [];
  for (const d of docs) {
    const q: any = d.question ? await questions().findOne({ _id: d.question, userId: u.id }) : null;
    out.push({ id: String(d._id), title: d.title, slug: d.slug, origin: d.origin ?? null, startedAt: d.startedAt, g0: d.g0 ?? null,
      question: q ? { id: String(q._id), status: q.status, option: q.answer?.option ?? null } : null });
  }
  return out;
}

export interface NachtItem { slug?: string | null; title: string; prompt: string; cwd: string; plan?: string | null }
export type NachtStatus = 'gestartet' | 'blocked_g0' | 'verworfen' | 'nicht geprüft' | 'fehler';

export async function nachtbau(u: User, items: NachtItem[], datum = vienna().date) {
  if (vorbauAus()) throw err(409, 'G0 ist abgeschaltet (WERKBANK_VORBAU_CHECK=off) — der Nachtbau baut ohne Prüfung nicht.');
  const out: { slug: string; title: string; status: NachtStatus; id?: string; question?: string | null; text: string }[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const slug = g0Slug(it.slug, it.plan);
    const title = String(it.title ?? '').slice(0, 80);
    let tor: G0Tor;
    try { tor = await g0Tor(u, { slug: it.slug ?? null, plan: it.plan ?? null, cwd: it.cwd, aufrufer: 'nachtbau', nachts: true, title }); }
    catch (e: any) { out.push({ slug, title, status: 'fehler', text: String(e.message ?? e).slice(0, 300) }); continue; }
    if (!tor.go && tor.ergebnis.ergebnis === 'stopp') {
      // Nicht prüfbar: dieses und alle folgenden Items bleiben liegen; ein Eintrag je Nacht, nicht je Item.
      const rest = items.slice(i);
      const q = await askKnut(u, {
        key: `g0-nachts#${datum}`, quelle: 'nachtbau', title: `G0 nachts nicht prüfbar — ${rest.length} Item(s) nicht gebaut`,
        context: `${tor.ergebnis.stopp!.text}\n\nNicht gebaut (bleiben in der Warteschlange):\n${rest.map((x) => `- ${x.title}${x.slug ? ` (${x.slug})` : ''}`).join('\n')}`,
        recommendation: tor.ergebnis.stopp!.grund === 'lesetoken' ? 'Neues GitHub-Lesetoken in Vaultwarden hinterlegen (Item „Github wirstrom read only“); die Items laufen in der nächsten Nacht.' : 'Ursache beheben; die Items laufen in der nächsten Nacht.',
      }).catch((e: any) => { if (e.status === 409) return null; throw e; });
      for (const x of rest) out.push({ slug: g0Slug(x.slug, x.plan), title: String(x.title ?? '').slice(0, 80), status: 'nicht geprüft', question: q?.id ?? null, text: 'G0 nachts nicht prüfbar' });
      break;
    }
    if (!tor.go) {
      const q: any = tor.question ? await questions().findOne({ _id: tor.question as any, userId: u.id }) : null;
      if (q?.status === 'beantwortet') {
        await runs().updateMany({ userId: u.id, slug, status: 'blocked_g0', reviewedAt: null }, { $set: { reviewedAt: new Date(), reviewNote: `verworfen: ${q.answer?.option ?? 'Freitext'}` } });
        out.push({ slug, title, status: 'verworfen', question: tor.question, text: tor.text });
        continue;
      }
      const open: any = await runs().findOne({ userId: u.id, slug, status: 'blocked_g0', reviewedAt: null });
      const id = open?._id ?? await newId();
      const set = { userId: u.id, conv: null, url: null, title, cwd: it.cwd, plan: it.plan ?? null, prompt: String(it.prompt ?? '').slice(0, 500), status: 'blocked_g0', slug, g0: tor.public, question: tor.question, origin: 'nachtbau', reviewedAt: null };
      if (open) await runs().updateOne({ _id: id }, { $set: set });
      else await runs().insertOne({ _id: id, ...set, startedAt: new Date(), lastSentAt: new Date(), sends: 0 } as any);
      if (tor.question) await questions().updateOne({ _id: tor.question as any, strand: null }, { $set: { strand: { id, title, url: null } } });
      out.push({ slug, title, status: 'blocked_g0', id, question: tor.question, text: tor.text });
      continue;
    }
    try {
      const r = await startOrch(u, { title, prompt: it.prompt, cwd: it.cwd, plan: it.plan ?? null, code: true, slug: tor.slug, aufrufer: 'nachtbau', g0: tor });
      // Ein früher blockierter Strang derselben Spec ist damit erledigt.
      await runs().updateMany({ userId: u.id, slug, status: 'blocked_g0', reviewedAt: null }, { $set: { reviewedAt: new Date(), reviewNote: `gestartet als ${r.id}` } });
      out.push({ slug, title, status: 'gestartet', id: r.id, question: tor.question, text: tor.text });
    } catch (e: any) { out.push({ slug, title, status: 'fehler', text: String(e.message ?? e).slice(0, 300) }); }
  }
  return out;
}
