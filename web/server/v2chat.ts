// Werkbank 2.0 (Paket 436, Council B1–B3): eigene Chats der 2.0 direkt auf der Brücke. Eigene Unterhaltungs-ID (`v2-<uuid>`, nie
// eine LibreChat-ID), der Zug läuft auf dem Server (nicht im Browser) und schreibt die Antwort fortlaufend in `werkbank.v2_nachrichten`;
// der Browser liest nach. Höchstens ein laufender Zug je Person, Text ≤ 8 000 Zeichen. Offene Züge beim Start → „abgebrochen“.
import { randomUUID } from 'node:crypto';
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

export const istV2Conv = (c: unknown) => typeof c === 'string' && /^v2-[0-9a-f-]{36}$/.test(c);

/** Liste meiner 2.0-Chats, neueste zuerst. */
export async function meineChats(u: User) {
  const l: any[] = await chats().find({ userId: u.id }).sort({ updatedAt: -1 }).limit(30).toArray();
  return l.map((c) => ({ conv: String(c._id), titel: String(c.titel ?? 'Chat'), at: c.updatedAt }));
}

export async function verlauf(u: User, conv: string, seit?: string) {
  if (!istV2Conv(conv)) throw err(400, 'Unbekannter Chat.');
  if (!(await chats().findOne({ _id: conv as any, userId: u.id }))) throw err(404, 'Diesen Chat gibt es nicht.');
  const q: any = { conv, userId: u.id };
  if (seit && !Number.isNaN(Date.parse(seit))) q.geaendert = { $gt: new Date(seit) };
  const l: any[] = await nachrichten().find(q).sort({ at: 1 }).limit(200).toArray();
  return l.map((m) => ({ id: String(m._id), rolle: m.rolle, text: String(m.text ?? ''), at: m.at, status: m.status, fehler: m.fehler ?? null }));
}

/** Eine Nachricht schicken: speichern, Zug auf der Brücke starten (im Hintergrund), sofort antworten. */
export async function senden(u: User, b: { text: unknown; conv?: unknown }, d: ZugDeps): Promise<{ conv: string; frage: string; antwort: string }> {
  const text = pruefeText(b.text);
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
    if (!conv) {
      conv = `v2-${randomUUID()}`;
      await chats().insertOne({ _id: conv as any, userId: u.id, titel: text.replace(/\s+/g, ' ').slice(0, 60), createdAt: now, updatedAt: now });
    } else await chats().updateOne({ _id: conv as any }, { $set: { updatedAt: now } });
    const frage = randomUUID(), antwort = randomUUID();
    await nachrichten().insertMany([
      { _id: frage as any, conv, userId: u.id, rolle: 'ich', text, status: 'fertig', at: now, geaendert: now },
      { _id: antwort as any, conv, userId: u.id, rolle: 'assistent', text: '', status: 'laeuft', at: new Date(now.getTime() + 1), geaendert: now },
    ]);
    void zug(u, conv, antwort, text, token, d).finally(() => laufend.delete(u.id));
    return { conv, frage, antwort };
  } catch (e) { laufend.delete(u.id); throw e; }
}

/** Der Zug: SSE der Brücke lesen, Text alle ~1 s in die Datenbank, am Ende fertig/fehler. */
async function zug(u: User, conv: string, id: string, text: string, token: string, d: ZugDeps) {
  const f = d.fetch ?? fetch;
  let out = '', last = 0;
  const set = (x: Record<string, unknown>) => nachrichten().updateOne({ _id: id as any }, { $set: { ...x, geaendert: new Date() } });
  try {
    const r = await f(`${d.bridgeUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-librechat-user-id': u.id, 'x-librechat-user-email': u.email, 'x-librechat-conversation-id': conv },
      body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content: text }] }),
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
