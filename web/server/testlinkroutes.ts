// Test-Links (docs/plan-testlinks.md): Routen der 2.0 (Liste, Start, Stoppen — nur Admins) und der interne Weg für `orch testlink`
// und das Strang-Werkzeug `testlink` (wartet bis Link oder Fehler). Antworten tragen nie Geheimnisse (testlink.sicht).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { realpathSync } from 'node:fs';
import type { User } from './auth.ts';
import * as tl from './testlink.ts';

type Handler = (req: IncomingMessage, res: ServerResponse, m: RegExpMatchArray, url: URL) => Promise<void>;
type On = (method: string, path: RegExp, h: Handler) => void;
const err = (status: number, msg: string) => Object.assign(new Error(msg), { status });

export interface TestlinkDeps {
  tl: tl.Deps;
  needUser: (req: IncomingMessage) => Promise<User>;
  body: (req: IncomingMessage, max?: number) => Promise<any>;
  send: (res: ServerResponse, status: number, body: unknown) => void;
  /** Strang der Person (Kennung) bzw. der Unterhaltung (Strang-Werkzeug) — cwd, written, title. */
  strang: (u: User, id: string) => Promise<any | null>;
  strangVonConv: (u: User, conv: string) => Promise<any | null>;
  log: (msg: string, data: Record<string, unknown>) => void;
}

const admin = (u: User) => u.role === 'ADMIN';

/** Ziel auflösen: Strang-Kennung (8 hex) → Ordner des Strangs; sonst ein Ordner unter den erlaubten Wurzeln. */
export async function zielOrdner(d: TestlinkDeps, u: User, ziel: { strang?: string | null; ordner?: string | null }): Promise<{ ordner: string; titel: string; strang: string | null }> {
  if (ziel.strang) {
    if (!/^[0-9a-f]{8}$/.test(ziel.strang)) throw err(400, 'Unbekannte Strang-Kennung.');
    const doc = await d.strang(u, ziel.strang);
    if (!doc) throw err(404, 'Diesen Unter-Chat gibt es nicht.');
    const o = ziel.ordner ? null : tl.strangOrdner(doc);
    if (!ziel.ordner && !o) throw err(422, `Im Arbeitsordner des Unter-Chats (${doc.cwd}) ist keine App zu erkennen — Ordner angeben (olaf-admin, olaf-tariff-app, Werkbank-Checkout oder Ordner mit index.html).`);
    return { ordner: pruefe(ziel.ordner ?? o!), titel: String(doc.title ?? ziel.strang).slice(0, 140), strang: ziel.strang };
  }
  if (!ziel.ordner) throw err(400, 'Strang oder Ordner angeben.');
  return { ordner: pruefe(ziel.ordner), titel: '', strang: null };
}
function pruefe(o: string): string {
  if (!o.startsWith('/')) throw err(400, 'Ordner bitte als absoluten Pfad.');
  let real: string;
  try { real = realpathSync(o); } catch { throw err(400, 'Den Ordner gibt es nicht.'); }
  if (!tl.wurzelErlaubt(real)) throw err(403, 'Test-Umgebungen nur für Ordner unter den Arbeitswurzeln (WERKBANK_TESTLINK_WURZELN, Vorgabe ~/work).');
  return real;
}

/** Text für CLI und Strang-Werkzeug. */
export function testlinkText(u: ReturnType<typeof tl.sicht>): string {
  if (u.status === 'laeuft') return [
    `Test-Link (angemeldet als ${tl.TEST_EMAIL}, ${u.profil}, Stand ${u.commit ?? '–'}${u.zweig ? ` auf ${u.zweig}` : ''}${u.dirty ? ' mit ungesicherten Änderungen' : ''}):`,
    u.link,
    `Läuft bis ${new Date(u.ablauf).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', dateStyle: 'short', timeStyle: 'short' })} · Gesundheit: mit Sitzung ${u.gesund?.mit ?? '–'}${u.gesund?.ohne != null ? `, ohne ${u.gesund.ohne}` : ''} · Kennung ${u.id}`,
    ...(u.geleert.length ? [`Geleert (nicht lokal): ${u.geleert.join(', ')}`] : []),
    `Lokal (Screenshots): ${u.lokal} · Stoppen: orch testlink ${u.ordner} --stop`,
    `Im Bericht unter review: eintragen — titel: Test-Link (angemeldet), url: ${u.link}`,
  ].join('\n');
  if (u.status === 'startet') return `Test-Umgebung ${u.id} startet noch (${u.schritt}).`;
  if (u.status === 'fehler') return `Test-Umgebung ${u.id} ist fehlgeschlagen: ${u.fehler}\n--- Logauszug ---\n${u.logAuszug ?? ''}`;
  return `Test-Umgebung ${u.id}: ${u.status}.`;
}

/** Intern (CLI, Strang-Werkzeug): Start (wartet bis fertig), Stoppen oder Liste. */
export async function testlinkIntern(d: TestlinkDeps, u: User, b: any): Promise<{ text: string; umgebung?: any; umgebungen?: any[] }> {
  if (!admin(u)) throw err(403, 'Test-Links nur für Admins.');
  await tl.aufraeumen(d.tl).catch(() => null);
  if (b.liste === true || (!b.ziel && !b.conv)) {
    const l = tl.alle(d.tl).filter((x) => b.alle === true || x.status === 'laeuft' || x.status === 'startet').map((x) => tl.sicht(x));
    return { text: l.length ? l.map((x) => `${x.status === 'laeuft' ? '🟢' : x.status === 'startet' ? '⏳' : '⚪'} ${x.id}  ${x.profil}  ${x.commit ?? '–'}  ${x.status === 'laeuft' ? x.link : x.status}\n   ${x.ordner}`).join('\n') : 'Keine Test-Umgebung läuft.', umgebungen: l };
  }
  const zielText = String(b.ziel ?? '').trim();
  let ziel: { strang?: string | null; ordner?: string | null };
  if (b.conv) {
    const doc = await d.strangVonConv(u, String(b.conv));
    if (!doc) throw err(409, 'testlink gibt es nur in Unter-Chats (oder per orch testlink <strang|ordner>).');
    ziel = { strang: String(doc._id), ordner: zielText || null };
  } else ziel = /^[0-9a-f]{8}$/.test(zielText) ? { strang: zielText } : { ordner: zielText };
  const z = await zielOrdner(d, u, ziel);
  if (b.stop === true) {
    const s = await tl.stoppen(tl.umgebungsId(z.ordner), d.tl);
    d.log('testlink gestoppt (intern)', { user: u.id, ordner: z.ordner });
    return { text: s ? `Gestoppt: ${s.id} (${s.status}).` : 'Für diesen Ordner läuft keine Test-Umgebung.', umgebung: s ? tl.sicht(s) : null };
  }
  const r = await tl.starten({ ordner: z.ordner, titel: z.titel, strang: z.strang, von: u.email, neu: b.neu === true }, d.tl);
  const fertig = tl.sicht(await r.fertig);
  d.log('testlink (intern)', { user: u.id, id: fertig.id, status: fertig.status });
  return { text: testlinkText(fertig), umgebung: fertig };
}

export function registerTestlinks(on: On, d: TestlinkDeps) {
  on('GET', /^\/api\/v2\/testlinks$/, async (req, res, _m, url) => {
    const u = await d.needUser(req);
    if (!admin(u)) return d.send(res, 200, { nurAdmin: true, umgebungen: [] });
    await tl.aufraeumen(d.tl).catch(() => null);
    const strang = url.searchParams.get('strang');
    const l = tl.alle(d.tl).filter((x) => (!strang || x.strang === strang) && (url.searchParams.get('alle') === '1' || !x.geendet || Date.now() - new Date(x.geendet).getTime() < 864e5));
    d.send(res, 200, { umgebungen: l.map((x) => tl.sicht(x)), bereich: tl.portBereich(), tage: tl.TAGE, konto: tl.TEST_EMAIL });
  });
  // Start aus der 2.0: läuft im Hintergrund weiter; die Seite fragt den Stand nach (Status startet → läuft/fehler).
  on('POST', /^\/api\/v2\/testlinks$/, async (req, res) => {
    const u = await d.needUser(req);
    if (!admin(u)) throw err(403, 'Test-Links startet nur, wer die Unter-Chats führt.');
    const b = await d.body(req, 16 * 1024);
    const z = await zielOrdner(d, u, { strang: b.strang ? String(b.strang) : null, ordner: b.ordner ? String(b.ordner).trim() : null });
    const r = await tl.starten({ ordner: z.ordner, titel: z.titel, strang: z.strang, von: u.email, neu: b.neu === true }, d.tl);
    r.fertig.catch(() => null);
    d.log('testlink start (v2)', { user: u.id, id: r.u.id, schon: !!r.schon });
    d.send(res, 200, { umgebung: tl.sicht(r.u), schon: !!r.schon });
  });
  on('POST', /^\/api\/v2\/testlinks\/([a-z0-9-]{3,40})\/stoppen$/, async (req, res, m) => {
    const u = await d.needUser(req);
    if (!admin(u)) throw err(403, 'Nur wer die Unter-Chats führt.');
    const s = await tl.stoppen(m[1], d.tl);
    if (!s) throw err(404, 'Diese Test-Umgebung gibt es nicht (mehr).');
    d.log('testlink gestoppt (v2)', { user: u.id, id: m[1] });
    d.send(res, 200, { umgebung: tl.sicht(s) });
  });
}
