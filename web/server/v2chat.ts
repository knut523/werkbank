// Werkbank 2.0 (Paket 436, Council B1–B3): eigene Chats der 2.0 direkt auf der Brücke. Eigene Unterhaltungs-ID (`v2-<uuid>`, nie
// eine LibreChat-ID), der Zug läuft auf dem Server (nicht im Browser) und schreibt die Antwort fortlaufend in `werkbank.v2_nachrichten`;
// der Browser liest nach. Höchstens ein laufender Zug je Person, Text ≤ 8 000 Zeichen. Offene Züge beim Start → „abgebrochen“.
import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import { wb } from './db.ts';
import type { User } from './auth.ts';

export const TEXT_MAX = 8000;
/** Längster Zug; danach gilt er als hängend (abgebrochen), damit niemand dauerhaft gesperrt bleibt. */
export const ZUG_MAX_MS = 30 * 60_000;
const BESETZT = 'Es läuft schon eine Antwort — warte kurz, dann kannst du weiterschreiben.';
export const chats = () => wb().collection('v2_chats');
export const nachrichten = () => wb().collection('v2_nachrichten');
const err = (status: number, msg: string) => Object.assign(new Error(msg), { status });

export interface ZugDeps {
  bridgeUrl: string;
  token: (u: User) => Promise<string | null>;
  fetch?: typeof fetch;
  log?: (msg: string, data: Record<string, unknown>) => void;
}

/** Laufende Züge im Prozess (zweite Sperre neben der Datenbank: zwei Klicks im selben Augenblick). */
const laufend = new Set<string>();

/** Beim Start der API: Züge, die beim letzten Neustart offen waren, sichtbar als abgebrochen markieren (nie stilles Hängen). */
export async function abgebrochenMarkieren(): Promise<number> {
  const r = await nachrichten().updateMany({ status: 'laeuft' }, { $set: { status: 'abgebrochen', fertigAt: new Date(), fehler: 'Der Server wurde neu gestartet, während die Antwort lief — bitte noch einmal fragen.' } });
  return r.modifiedCount;
}

export function pruefeText(t: unknown): string {
  const text = String(t ?? '').trim();
  if (!text) throw err(400, 'Schreib eine Nachricht.');
  if (text.length > TEXT_MAX) throw err(413, `Höchstens ${TEXT_MAX} Zeichen je Nachricht.`);
  return text;
}

// ---- Paket G: Parität zum Terminal-Chat — Anhänge und Modellwahl je Chat. Abschaltung: WERKBANK_V2_ANHANG=aus, WERKBANK_V2_MODELLWAHL=aus ----
type Env = Record<string, string | undefined>;
export const anhangAn = (env: Env = process.env) => String(env.WERKBANK_V2_ANHANG ?? '').trim().toLowerCase() !== 'aus';
export const modellwahlAn = (env: Env = process.env) => String(env.WERKBANK_V2_MODELLWAHL ?? '').trim().toLowerCase() !== 'aus';
export const ANHANG_MAX_DATEIEN = 3;
export const anhangMaxBytes = (env: Env = process.env) => Math.max(0.001, Number(env.WERKBANK_V2_ANHANG_MB) || 4) * 1024 * 1024;
/** Die Brücke lehnt Bodies über 10 MB ab (Base64 + 1/3) — daher insgesamt höchstens 7 MB Rohdaten je Nachricht. */
export const ANHANG_MAX_GESAMT = 7 * 1024 * 1024;
/** Auswahl im Chat-Kopf → Modell-ID der Brücke (server.ts MODELS). Leer = Vorgabe von Claude Code. */
export const MODELLE: Record<string, { id: string; label: string }> = {
  '': { id: 'claude-code', label: 'Vorgabe' },
  opus: { id: 'claude-code-opus', label: 'Opus' },
  sonnet: { id: 'claude-code-sonnet', label: 'Sonnet' },
  haiku: { id: 'claude-code-haiku', label: 'Haiku' },
};
export function pruefeModell(m: unknown): string {
  const k = String(m ?? '').trim().toLowerCase();
  if (!(k in MODELLE)) throw err(400, 'Dieses Modell gibt es nicht (Vorgabe, Opus, Sonnet, Haiku).');
  return k;
}
export interface Anhang { name: string; mime: string; daten: Buffer }
/** Anhänge aus dem Body (name, mime, base64): nur Basename, Größen- und Anzahllimit; der Typ-Filter und das Ablegen im Arbeitsordner des Chats macht die Brücke. */
export function pruefeAnhaenge(roh: unknown, env: Env = process.env): Anhang[] {
  if (roh === undefined || roh === null || (Array.isArray(roh) && !roh.length)) return [];
  if (!anhangAn(env)) throw err(400, 'Anhänge sind ausgeschaltet.');
  if (!Array.isArray(roh)) throw err(400, 'anhaenge: Liste mit name, mime, daten (Base64).');
  if (roh.length > ANHANG_MAX_DATEIEN) throw err(413, `Höchstens ${ANHANG_MAX_DATEIEN} Dateien je Nachricht.`);
  const max = anhangMaxBytes(env);
  let summe = 0;
  return roh.map((a: any) => {
    const name = basename(String(a?.name ?? '').replace(/\\/g, '/')).replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/^\.+/, '').trim().slice(0, 100);
    if (!name) throw err(400, 'Eine Datei hat keinen Namen.');
    const mime = /^[\w.+-]+\/[\w.+-]+$/.test(String(a?.mime ?? '')) ? String(a.mime).toLowerCase() : 'application/octet-stream';
    const b64 = String(a?.daten ?? '');
    if (b64.length > Math.ceil(max * 4 / 3) + 8) throw err(413, `${name}: größer als ${Math.round(max / 1048576)} MB.`);
    const daten = Buffer.from(b64, 'base64');
    if (!daten.length) throw err(400, `${name}: leer.`);
    if (daten.length > max) throw err(413, `${name}: größer als ${Math.round(max / 1048576)} MB.`);
    summe += daten.length;
    if (summe > ANHANG_MAX_GESAMT) throw err(413, 'Zusammen höchstens 7 MB je Nachricht.');
    return { name, mime, daten };
  });
}
/** Nachrichteninhalt für die Brücke: Text + Datei-Teile (die Brücke legt sie im Arbeitsordner ab und nennt den Pfad im Auftrag). */
export const inhaltMitAnhang = (text: string, anh: Anhang[]) => anh.length
  ? [{ type: 'text', text }, ...anh.map((a) => ({ type: 'file', file: { filename: a.name, file_data: `data:${a.mime};base64,${a.daten.toString('base64')}` } }))]
  : text;

export const istV2Conv = (c: unknown) => typeof c === 'string' && /^v2-[0-9a-f-]{36}$/.test(c);

/** Liste meiner 2.0-Chats, neueste zuerst. */
export async function meineChats(u: User, n = 30) {
  const l: any[] = await chats().find({ userId: u.id }).sort({ updatedAt: -1 }).limit(Math.min(n, 500)).toArray();
  return l.map((c) => ({ conv: String(c._id), titel: String(c.titel ?? 'Chat'), at: c.updatedAt, vorlage: c.vorlage ?? null, modell: c.modell ?? '' }));
}

export async function verlauf(u: User, conv: string, seit?: string) {
  if (!istV2Conv(conv)) throw err(400, 'Unbekannter Chat.');
  if (!(await chats().findOne({ _id: conv as any, userId: u.id }))) throw err(404, 'Diesen Chat gibt es nicht.');
  const q: any = { conv, userId: u.id };
  if (seit && !Number.isNaN(Date.parse(seit))) q.geaendert = { $gt: new Date(seit) };
  const l: any[] = await nachrichten().find(q).sort({ at: 1 }).limit(200).toArray();
  return l.map((m) => ({ id: String(m._id), rolle: m.rolle, text: String(m.text ?? ''), at: m.at, status: m.status, fehler: m.fehler ?? null, ...(m.anhaenge?.length ? { anhaenge: m.anhaenge } : {}) }));
}

/** Eine Nachricht schicken: speichern, Zug auf der Brücke starten (im Hintergrund), sofort antworten. */
export async function senden(u: User, b: { text: unknown; conv?: unknown; vorlage?: { name: string; prefix: string } | null; modell?: unknown; anhaenge?: unknown }, d: ZugDeps): Promise<{ conv: string; frage: string; antwort: string }> {
  const text = pruefeText(b.text);
  const anh = pruefeAnhaenge(b.anhaenge);
  const wunsch = b.modell === undefined || !modellwahlAn() ? undefined : pruefeModell(b.modell);
  const token = await d.token(u);
  if (!token) throw err(412, 'Für den Chat brauchst du einen Claude-Zugang — alles andere geht ohne. Frag Knut, wenn du einen brauchst.');
  // Sperre synchron belegen, bevor irgendein await kommt (sonst kommen zwei gleichzeitige Klicks beide durch — Pass C).
  if (laufend.has(u.id)) throw err(409, BESETZT);
  laufend.add(u.id);
  try {
    if (await nachrichten().findOne({ userId: u.id, status: 'laeuft', geaendert: { $gt: new Date(Date.now() - ZUG_MAX_MS) } })) throw err(409, BESETZT);
    let conv = istV2Conv(b.conv) ? String(b.conv) : null;
    if (conv && !(await chats().findOne({ _id: conv as any, userId: u.id }))) throw err(404, 'Diesen Chat gibt es nicht.');
    const now = new Date();
    let prefix: string | null = null, modell = '';
    if (!conv) {
      conv = `v2-${randomUUID()}`;
      // S22: Vorlage (LibreChat-modelSpecs) wird am Chat gemerkt und geht bei jedem Zug als System-Nachricht mit — wie in LibreChat.
      const v = b.vorlage && typeof b.vorlage.prefix === 'string' ? { vorlage: String(b.vorlage.name).slice(0, 80), prefix: b.vorlage.prefix.slice(0, 4000) } : {};
      await chats().insertOne({ _id: conv as any, userId: u.id, titel: text.replace(/\s+/g, ' ').slice(0, 60), createdAt: now, updatedAt: now, modell: wunsch ?? '', ...v });
      prefix = (v as any).prefix ?? null;
      modell = wunsch ?? '';
    } else {
      const c: any = await chats().findOneAndUpdate({ _id: conv as any, userId: u.id }, { $set: { updatedAt: now, ...(wunsch !== undefined ? { modell: wunsch } : {}) } }, { returnDocument: 'after' });
      prefix = c?.prefix ?? c?.value?.prefix ?? null;
      modell = String(c?.modell ?? c?.value?.modell ?? '');
    }
    const frage = randomUUID(), antwort = randomUUID();
    await nachrichten().insertMany([
      { _id: frage as any, conv, userId: u.id, rolle: 'ich', text, status: 'fertig', at: now, geaendert: now, ...(anh.length ? { anhaenge: anh.map((a) => a.name) } : {}) },
      { _id: antwort as any, conv, userId: u.id, rolle: 'assistent', text: '', status: 'laeuft', at: new Date(now.getTime() + 1), geaendert: now },
    ]);
    void zug(u, conv, antwort, inhaltMitAnhang(text, anh), token, d, prefix, MODELLE[modell]?.id ?? 'claude-code').finally(() => laufend.delete(u.id));
    return { conv, frage, antwort };
  } catch (e) { laufend.delete(u.id); throw e; }
}

/** Der Zug: SSE der Brücke lesen, Text alle ~1 s in die Datenbank, am Ende fertig/fehler. */
async function zug(u: User, conv: string, id: string, text: string | unknown[], token: string, d: ZugDeps, prefix: string | null = null, modell = 'claude-code') {
  const f = d.fetch ?? fetch;
  let out = '', last = 0;
  const set = (x: Record<string, unknown>) => nachrichten().updateOne({ _id: id as any }, { $set: { ...x, geaendert: new Date() } });
  try {
    const r = await f(`${d.bridgeUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-librechat-user-id': u.id, 'x-librechat-user-email': u.email, 'x-librechat-conversation-id': conv },
      body: JSON.stringify({ model: modell, stream: true, messages: [...(prefix ? [{ role: 'system', content: prefix }] : []), { role: 'user', content: text }] }),
      signal: AbortSignal.timeout(ZUG_MAX_MS),
    });
    if (!r.ok || !r.body) throw new Error(`Der Assistent antwortet gerade nicht (${r.status}).`);
    const dec = new TextDecoder();
    let buf = '';
    for await (const chunk of r.body as any) {
      buf += dec.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data: {')) continue;
        try { out += JSON.parse(line.slice(6)).choices?.[0]?.delta?.content ?? ''; } catch { /* Teilzeile */ }
      }
      if (Date.now() - last > 1000) { last = Date.now(); await set({ text: out }); }
    }
    await set({ text: out, status: 'fertig', fertigAt: new Date() });
  } catch (e: any) {
    d.log?.('v2 chat fehler', { user: u.id, conv, error: String(e?.message ?? e).slice(0, 200) });
    const fehler = e?.name === 'TimeoutError' ? 'Die Antwort hat zu lange gedauert und wurde abgebrochen — frag noch einmal.' : String(e?.message ?? e).slice(0, 300);
    await set({ text: out, status: 'fehler', fehler, fertigAt: new Date() }).catch((x) => d.log?.('v2 chat status', { conv, error: String(x?.message ?? x).slice(0, 120) }));
  }
}
