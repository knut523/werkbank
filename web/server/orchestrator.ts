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
import { realpathSync, statSync } from 'node:fs';
import { cfg } from './config.ts';
import { wb, lc } from './db.ts';
import { librechatAccessToken, type User } from './auth.ts';
import { createLibreChat } from './agent.ts';
import { prepareFresh } from './fresh.ts';

export const ORCH_TAG = 'Orchestrator';
export type OrchStatus = 'running' | 'waiting' | 'done' | 'failed';

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
export function orchStatus(run: { startError?: string | null; startedAt: Date | number; lastSentAt?: Date | number | null }, s: StrandState | null | undefined, last: LastMsg | null, now = Date.now()): { status: OrchStatus; reason: string } {
  if (run.startError) return { status: 'failed', reason: `Start fehlgeschlagen: ${run.startError}` };
  if (s?.running) return { status: 'running', reason: 'Zug läuft' };
  if (s?.interrupted) return { status: 'failed', reason: 'Zug abgebrochen (Brücke neu gestartet) — mit `send <id> weiter` fortsetzen' };
  const sent = new Date(run.lastSentAt ?? run.startedAt).getTime();
  if (!s?.turn || s.turn.start < sent - 5000) {
    if (last?.error && last.at >= sent - 5000) return { status: 'failed', reason: `LibreChat meldet einen Fehler: ${last.text.slice(0, 160)}` };
    if (now - sent < 180_000) return { status: 'running', reason: 'startet (Nachricht unterwegs zur Brücke)' };
    return { status: 'failed', reason: 'Nachricht ist nach 3 Minuten nicht bei der Brücke angekommen — `send <id> weiter` oder Chat ansehen' };
  }
  switch (s.turn.outcome) {
    case 'busy': return { status: 'failed', reason: 'Parallelgrenze der Brücke (BRIDGE_MAX_PARALLEL_CHATS) — später `send <id> weiter`' };
    case 'limit': return { status: 'waiting', reason: 'Schrittlimit des Zuges erreicht — `send <id> weiter`' };
    case 'timeout': return { status: 'waiting', reason: 'Zeitlimit des Zuges (15 min) erreicht — `send <id> weiter`' };
    case 'rate_limit': return { status: 'failed', reason: 'Claude-Kontingent ausgeschöpft' };
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

export interface StartInput { title: string; prompt: string; cwd: string; plan?: string | null; shared?: boolean; code?: boolean }

const runs = () => wb().collection('orchestrator_runs');

async function newId(): Promise<string> {
  for (;;) { const id = randomUUID().slice(0, 8); if (!(await runs().findOne({ _id: id as any }))) return id; }
}

export async function startOrch(u: User, inp: StartInput) {
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
  const text = orchBrief({ title, prompt, cwd: rj.dir ?? real, plan, person: u.name, stand: fresh.status });
  const doc: any = { _id: id, userId: u.id, conv, url: `${cfg.librechatPublicUrl}/c/${conv}`, title, cwd: rj.dir ?? real, plan, prompt: prompt.slice(0, 500), startedAt: new Date(), lastSentAt: new Date(), sends: 1, reviewedAt: null, mode: rj.mode ?? null, startError: null };
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
  return { id, conv, url: doc.url, cwd: doc.cwd, plan, mode: doc.mode, stand: fresh.status, worktree: fresh.worktree, ...(doc.mode && doc.mode !== 'auto' ? { warning: `Brücke läuft für dieses Konto im Modus „${doc.mode}“ — ohne Auto-Modus darf der Strang nur lesen.` } : {}) };
}

export async function listOrch(u: User, opts: { all?: boolean } = {}) {
  const docs: any[] = await runs().find({ userId: u.id, ...(opts.all ? {} : { reviewedAt: null }) }).sort({ startedAt: -1 }).limit(100).toArray();
  if (!docs.length) return [];
  let states = new Map<string, any>();
  let bridgeError: string | null = null;
  try { states = await strandStates(u); } catch (e: any) { bridgeError = String(e.message ?? e); }
  const out = [];
  for (const d of docs) {
    const last = await lastMessage(u, d.conv);
    const s = states.get(d.conv);
    const st = bridgeError ? { status: 'failed' as OrchStatus, reason: `Brücke nicht erreichbar: ${bridgeError}` } : orchStatus(d, s, last);
    // Titel/Lesezeichen nachziehen, falls der Start-Durchlauf es nicht geschafft hat (selbstheilend, idempotent).
    if (!d.decorated && !d.startError) { try { if ((await decorate(u, d.conv, d.title)).ok) await runs().updateOne({ _id: d._id }, { $set: { decorated: true } }); } catch { /* nächstes Mal */ } }
    out.push({
      id: d._id, title: d.title, status: st.status, reason: st.reason, reviewed: !!d.reviewedAt, url: d.url, cwd: d.cwd, plan: d.plan,
      startedAt: d.startedAt, lastSentAt: d.lastSentAt, lastActivity: Math.max(s?.turn?.end ?? 0, s?.turn?.start ?? 0, last?.at ?? 0) || null,
      sends: d.sends ?? 1, excerpt: last && !last.fromUser ? excerpt(last.text) : '', written: s?.written ?? [],
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
  const last = await lastMessage(u, d.conv);
  return { ...item, conv: d.conv, prompt: d.prompt, lastMessage: last ? { fromUser: last.fromUser, at: new Date(last.at), text: last.text.slice(-20_000) } : null };
}

export async function sendOrch(u: User, id: string, text: string) {
  const msg = String(text ?? '').trim();
  if (!msg) throw err(400, 'Nachricht fehlt.');
  const d = await ownRun(u, id);
  const item = (await listOrch(u, { all: true })).find((r) => r.id === id);
  if (item?.status === 'running') throw err(409, `Strang ${id} arbeitet noch (${item.reason}) — warten, dann senden.`);
  for (let i = 0; ; i++) {
    const last = await lastMessage(u, d.conv);
    if (!last) throw err(409, 'Im Chat ist noch keine Nachricht gespeichert.');
    try {
      await createLibreChat(u, msg, { conversationId: d.conv, parentMessageId: last.id });
      break;
    } catch (e: any) {
      if (e.status === 409 && i < 5) { await new Promise((r) => setTimeout(r, 1500)); continue; }
      throw err(e.status ?? 502, String(e.message ?? e));
    }
  }
  await runs().updateOne({ _id: d._id }, { $set: { lastSentAt: new Date(), reviewedAt: null }, $inc: { sends: 1 } });
  return { id, conv: d.conv, url: d.url };
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
// Plan). Sie erscheint in der Werkbank unter „Für mich offen“ (Roadmap) mit Zähler in der Navigation; Knut antwortet
// dort (Option und/oder Freitext); der Orchestrator liest die Antwort über die CLI. Regel: nur, was wirklich Knuts
// Entscheidung ist — nichts, was der Orchestrator selbst klären, nachlesen oder sicher entscheiden kann.

export interface AskInput { title: string; context: string; options?: { label: string; consequence?: string }[]; recommendation: string; strand?: string | null; link?: string | null; plan?: string | null }

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
  let id: string;
  do { id = 'q-' + randomUUID().slice(0, 6); } while (await questions().findOne({ _id: id as any }));
  const doc = { _id: id, userId: u.id, title, context, options, recommendation, strand, link, plan: inp.plan ? String(inp.plan).slice(0, 500) : null, createdAt: new Date(), status: 'offen', answer: null };
  await questions().insertOne(doc as any);
  return publicQuestion(doc);
}

export function publicQuestion(d: any) {
  return { id: String(d._id), title: d.title, context: d.context, options: d.options ?? [], recommendation: d.recommendation, strand: d.strand ?? null, link: d.link ?? null, plan: d.plan ?? null, createdAt: d.createdAt, status: d.status, answer: d.answer ?? null };
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
  return publicQuestion({ ...d, status: 'beantwortet', answer });
}

export async function withdrawQuestion(u: User, id: string) {
  const r = await questions().updateOne({ _id: id as any, userId: u.id, status: 'offen' }, { $set: { status: 'zurückgezogen', withdrawnAt: new Date() } });
  if (!r.matchedCount) throw err(409, 'Keine offene Rückfrage mit dieser Kennung.');
  return { id, status: 'zurückgezogen' };
}
