// Werkbank 2.0 (Paket 436, Schritt 0): eine schmale API für die neue Oberfläche (web/app, /v2/) auf den bestehenden Funktionen.
// Nur lesen — einziger Schreibweg sind Antworten auf Fragen über die bestehende Antwortlogik (Council B4) und der Chat (v2chat.ts,
// Hauptchat über den Adapter v2librechat.ts). Alle Routen hinter der bestehenden Anmeldung (B3). Freigaben nach außen gibt es hier nicht.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { User } from './auth.ts';
import { fragenAus, type Frage } from './entscheidungsseite.ts';
import { inboxZahl, type InboxEintrag } from './inbox.ts';
import { fragenJeStrang } from './chatstatus.ts';
import { jetztAuswahl, karteAusFrage, antwortWeg, zustandSatz, arbeitGruppe, erledigtSicht, prSicht, personen, uhrzeit, kurz, type ArbeitZeile, type LivePrLite } from './v2kern.ts';
import * as eigen from './v2chat.ts';
import * as librechat from './v2librechat.ts';

type Handler = (req: IncomingMessage, res: ServerResponse, m: RegExpMatchArray, url: URL) => Promise<void>;
type On = (method: string, path: RegExp, h: Handler) => void;
const err = (status: number, msg: string) => Object.assign(new Error(msg), { status });

export interface V2Deps {
  needUser: (req: IncomingMessage) => Promise<User>;
  body: (req: IncomingMessage, max?: number) => Promise<any>;
  send: (res: ServerResponse, status: number, body: unknown) => void;
  inboxFuer: (u: User) => Promise<{ eintraege: InboxEintrag[] }>;
  unterchatListe: (u: User, erledigt: boolean) => Promise<{ zeilen: any[] }>;
  erledigtDaten: (u: User, tag: string) => Promise<{ straenge: any[] }>;
  fragenAntwort: (u: User, b: any) => Promise<any>;
  strang: (u: User, id: string) => Promise<any | null>;
  hauptchat: (u: User) => Promise<{ conv: string; url: string | null } | null>;
  laeuftChat: (u: User, conv: string) => Promise<boolean>;
  livePrs: () => Promise<{ map: Map<string, any>; sync?: any }>;
  githubNames: () => Record<string, string>;
  letzteReviews: () => Promise<any[]>;
  reviewKommentar: (paket: string) => { empfehlung: string; text: string } | null;
  pakete: () => { name: string; titel: string; status: string; at: number }[];
  vaultSuche: (q: string) => Promise<{ path: string; title: string; team?: string; snippet?: string }[]>;
  vaultNeu: (n: number) => { path: string; title: string; team?: string; mtime: number }[];
  wienDatum: () => string;
  claudeToken: (u: User) => Promise<string | null>;
  bridgeUrl: string;
  /** Wurzel der alten Werkbank (über LibreChat, z. B. https://…/wb). */
  altUrl: string;
  log: (msg: string, data: Record<string, unknown>) => void;
}

const vorname = (u: User) => u.name.trim().split(/\s+/)[0] ?? u.name;
const admin = (u: User) => u.role === 'ADMIN';

/** Kennung → Unter-Chat (Kennung, Titel) der Frage, aus dem Inbox-Eintrag. */
function strangJe(eintraege: InboxEintrag[]) {
  const m = new Map<string, { id: string | null; titel: string | null }>();
  for (const e of eintraege) {
    const q = String(e.quelle?.text ?? '').match(/^Unter-Chat „(.*)“$/)?.[1];
    m.set(e.id, { id: e.quelle?.strand ? String(e.quelle.strand) : null, titel: String((e.daten as any)?.strangTitel ?? q ?? '') || null });
  }
  return m;
}

function karten(d: V2Deps, fragen: Frage[], eintraege: InboxEintrag[], liste: { f: Frage; grund: string }[]) {
  const sj = strangJe(eintraege);
  return liste.map(({ f, grund }) => { const s = sj.get(f.eintrag); return karteAusFrage(f, { grund, strand: s?.id ?? null, strandTitel: s?.titel ?? null, altUrl: `${d.altUrl}/entscheidungen` }); });
}

const arbeitKarte = (z: any) => ({ id: String(z.id), titel: kurz(z.titel, 140), thema: z.thema ?? '', satz: zustandSatz(z as ArbeitZeile), gruppe: arbeitGruppe(z as ArbeitZeile), zuletzt: z.zuletzt ?? null, uhr: uhrzeit(z.zuletzt),
  offen: z.cs?.offen ?? 0, links: [...(z.paket && z.bericht ? [{ label: 'Bericht', url: `/v2/dokument?paket=${encodeURIComponent(z.paket)}&datei=bericht.md` }] : [])] });

export function registerV2(on: On, d: V2Deps) {
  // --- Startseite „Jetzt“: eine Zahl, ≤ 5 Karten, Läuft, Heute erledigt, PRs, Dokumente — ein Abruf ---
  on('GET', /^\/api\/v2\/start$/, async (req, res) => {
    const u = await d.needUser(req);
    const ib = await d.inboxFuer(u);
    const { fragen } = fragenAus(ib.eintraege);
    const jetzt = karten(d, fragen, ib.eintraege, jetztAuswahl(fragen));
    const ich = vorname(u);
    let laeuft: any[] = [], erledigt: any[] = [];
    if (admin(u)) {
      const [liste, er] = await Promise.all([d.unterchatListe(u, false).catch(() => ({ zeilen: [] as any[] })), d.erledigtDaten(u, d.wienDatum()).catch(() => ({ straenge: [] as any[] }))]);
      const zm = new Map(liste.zeilen.map((z: any) => [String(z.id), z]));
      laeuft = liste.zeilen.filter((z: any) => arbeitGruppe(z) === 'laeuft').slice(0, 6).map(arbeitKarte);
      erledigt = erledigtSicht(er.straenge, zm, new Set(er.straenge.map((s: any) => String(s.id)).filter((id: string) => !zm.has(id))));
    }
    const prs = await d.livePrs().then((g) => prSicht([...g.map.values()] as LivePrLite[], ich, d.githubNames()).slice(0, 5)).catch(() => null);
    send(d, res, { zahl: inboxZahl(ib.eintraege), jetzt, laeuft, erledigt, prs, dokumente: dokumenteNeu(d, u, 5), ich: ich, admin: admin(u), at: new Date() });
  });

  // --- Die eine Zahl (Kopf jeder Seite): dieselbe wie überall — `inboxZahl` ---
  on('GET', /^\/api\/v2\/zahl$/, async (req, res) => {
    const u = await d.needUser(req);
    send(d, res, { zahl: inboxZahl((await d.inboxFuer(u)).eintraege) });
  });

  // --- Entscheidungen: alle offenen, wichtigste zuerst (dieselbe Zahl wie oben) ---
  on('GET', /^\/api\/v2\/entscheidungen$/, async (req, res) => {
    const u = await d.needUser(req);
    const ib = await d.inboxFuer(u);
    const { fragen } = fragenAus(ib.eintraege);
    const oben = jetztAuswahl(fragen);
    const obenIds = new Set(oben.map((x) => x.f.id));
    const rest = fragen.filter((f) => f.klasse !== 'aktion' && !obenIds.has(f.id)).map((f) => ({ f, grund: '' }));
    const alle = karten(d, fragen, ib.eintraege, [...oben, ...rest]);
    send(d, res, { zahl: inboxZahl(ib.eintraege), oben: alle.slice(0, oben.length), rest: alle.slice(oben.length), at: new Date() });
  });

  // --- Antwort an DIESER Karte: nur Entscheidungen; Freigaben nach außen nie (B4) ---
  on('POST', /^\/api\/v2\/antwort$/, async (req, res) => {
    const u = await d.needUser(req);
    const b = await d.body(req, 64 * 1024);
    const id = String(b.id ?? '');
    const antwort = String(b.antwort ?? '');
    if (!['ja', 'anders', 'nein', 'spaeter'].includes(antwort)) throw err(400, 'Antwort ist „Ja, so“, „Anders“, „Nein“ oder „Später“.');
    const ib = await d.inboxFuer(u);
    const f = fragenAus(ib.eintraege).fragen.find((x) => x.id === id);
    if (!f) throw err(409, 'Diese Frage ist schon beantwortet oder hat sich geändert — Seite neu laden.');
    if (antwortWeg(f) !== 'hier') throw err(403, 'Das gibst du in der alten Werkbank frei (Freigaben nach außen gehen in 2.0 nicht).');
    const r = await d.fragenAntwort(u, { id, antwort, text: String(b.text ?? '').slice(0, 4000) });
    d.log('v2 antwort', { user: u.id, id, antwort });
    send(d, res, { ok: true, ziel: r?.ziel ?? null, spaeter: !!r?.spaeter });
  });

  // --- Arbeit: Unter-Chats in drei Gruppen, Zustand in einem Satz (nur Admin — Unter-Chats gehören Knut) ---
  on('GET', /^\/api\/v2\/arbeit$/, async (req, res) => {
    const u = await d.needUser(req);
    if (!admin(u)) return send(d, res, { gruppen: { wartet: [], laeuft: [], fertig: [] }, nurAdmin: true });
    const liste = await d.unterchatListe(u, false);
    const k = liste.zeilen.map(arbeitKarte);
    send(d, res, { gruppen: { wartet: k.filter((x) => x.gruppe === 'wartet'), laeuft: k.filter((x) => x.gruppe === 'laeuft'), fertig: k.filter((x) => x.gruppe === 'fertig').slice(0, 30) }, at: new Date() });
  });
  on('GET', /^\/api\/v2\/arbeit\/([0-9a-f]{8})$/, async (req, res, m) => {
    const u = await d.needUser(req);
    if (!admin(u)) throw err(403, 'Unter-Chats sieht nur, wem sie gehören.');
    const doc = await d.strang(u, m[1]);
    if (!doc) throw err(404, 'Diesen Unter-Chat gibt es nicht (mehr).');
    const [liste, ib] = await Promise.all([d.unterchatListe(u, false).catch(() => ({ zeilen: [] as any[] })), d.inboxFuer(u)]);
    const z = liste.zeilen.find((x: any) => String(x.id) === m[1]);
    const alleFragen = fragenAus(ib.eintraege).fragen;
    const eigeneIds = new Set(fragenJeStrang(ib.eintraege, m[1]).map((f: any) => f.id));
    const fragen = karten(d, alleFragen, ib.eintraege, alleFragen.filter((f) => eigeneIds.has(f.id) && f.klasse !== 'aktion').map((f) => ({ f, grund: 'aus diesem Unter-Chat' })));
    const nachrichten = doc.conv ? await librechat.lesen(u, String(doc.conv), 20).catch(() => []) : [];
    const links = [
      ...(doc.paket ? [{ label: 'Bericht', url: `/v2/dokument?paket=${encodeURIComponent(doc.paket)}&datei=bericht.md` }] : []),
      ...(/^https?:\/\//.test(String(doc.url ?? '')) ? [{ label: 'In der alten Werkbank öffnen', url: String(doc.url), extern: true }] : []),
    ];
    send(d, res, { id: m[1], titel: String(doc.title ?? ''), satz: z ? zustandSatz(z) : 'Fertig und von dir abgenommen.', gruppe: z ? arbeitGruppe(z) : 'fertig', zuletzt: z?.zuletzt ?? doc.statusAt ?? null,
      stand: kurz(String(doc.lastExcerpt ?? ''), 4000), fragen, nachrichten, links, at: new Date() });
  });

  // --- PRs: „wartet auf: <Person>“, Vorgabe ich, umschaltbar ---
  on('GET', /^\/api\/v2\/prs$/, async (req, res, _m, url) => {
    const u = await d.needUser(req);
    const ich = vorname(u);
    const wer = (url.searchParams.get('wer') ?? ich).slice(0, 60) || ich;
    const g = await d.livePrs();
    const live = [...g.map.values()] as LivePrLite[];
    const names = d.githubNames();
    const rv = await d.letzteReviews().catch(() => []);
    const je = new Map<string, any>();
    for (const r of rv) { const k = `${String(r.repo).split('/').pop()}#${r.number}`; if (!je.has(k)) je.set(k, r); }
    const zeilen = prSicht(live, wer, names).map((p) => { const r = je.get(p.pr); return { ...p, review: r ? { empfehlung: r.empfehlung ?? null, status: r.status, at: r.doneAt ?? r.createdAt } : null }; });
    send(d, res, { wer, ich, personen: [...personen(live, ich, names), { name: 'alle', anzahl: live.length }], zeilen, stand: g.sync?.at ?? null, at: new Date() });
  });
  on('GET', /^\/api\/v2\/prs\/([\w.-]{1,80})\/(\d{1,6})$/, async (req, res, m) => {
    const u = await d.needUser(req);
    const key = `${m[1]}#${m[2]}`;
    const p: any = (await d.livePrs()).map.get(key);
    const rv = (await d.letzteReviews().catch(() => [])).filter((r) => String(r.repo).split('/').pop() === m[1] && Number(r.number) === Number(m[2]));
    if (!p && !rv.length) throw err(404, 'Diesen PR gibt es nicht in der Liste offener PRs.');
    const r = rv.find((x) => x.status === 'fertig' && x.paket) ?? rv[0] ?? null;
    const k = r?.paket && /^\d{1,4}-[a-z0-9][a-z0-9-]*$/.test(r.paket) ? d.reviewKommentar(r.paket) : null;
    const names = d.githubNames();
    const wa = p ? prSicht([p], 'alle', names)[0] : null;
    send(d, res, {
      pr: key, titel: p?.title ?? r?.title ?? key, url: p?.url ?? r?.url ?? null, autor: p ? (names[String(p.author ?? '').toLowerCase()] ?? p.author ?? null) : null,
      offen: !!p, merge: p?.turn?.role === 'merge', wartetAuf: wa?.wartetAuf ?? [], warum: wa?.warum ?? '', entscheidung: p?.reviewDecision ?? null, offeneThreads: p?.openThreads ?? 0,
      reviews: (p?.reviews ?? []).map((x: any) => ({ wer: names[String(x.author ?? '').toLowerCase()] ?? x.author, zustand: x.state, at: x.submittedAt })),
      agent: r ? { status: r.status, empfehlung: k?.empfehlung ?? r.empfehlung ?? null, text: k?.text ?? null, gepostet: r.posted?.url ?? null, at: r.doneAt ?? r.createdAt,
        bericht: admin(u) && r.paket ? `/v2/dokument?paket=${encodeURIComponent(r.paket)}&datei=bericht.md` : null } : null,
      at: new Date(),
    });
  });

  // --- Dokumente: Berichte (Admin) und Notizen (alle), Suche nach Titel/Pfad ---
  on('GET', /^\/api\/v2\/dokumente$/, async (req, res, _m, url) => {
    const u = await d.needUser(req);
    const q = String(url.searchParams.get('q') ?? '').trim().slice(0, 80);
    if (!q) return send(d, res, { q, treffer: dokumenteNeu(d, u, 12) });
    const ql = q.toLowerCase();
    const berichte = admin(u) ? d.pakete().filter((p) => p.status !== 'archiv' && (p.name.toLowerCase().includes(ql) || p.titel.toLowerCase().includes(ql))).sort((a, b) => b.at - a.at).slice(0, 10).map(paketDok) : [];
    const notizen = (await d.vaultSuche(q).catch(() => [])).slice(0, 20).map((h) => ({ art: 'notiz', titel: h.title || h.path, worum: h.snippet ? kurz(h.snippet.replace(/<[^>]+>/g, ''), 160) : h.path, url: `/v2/dokument?vault=${encodeURIComponent(h.path)}`, at: null }));
    send(d, res, { q, treffer: [...berichte, ...notizen] });
  });

  // --- Chat (Seitenleiste): Hauptchat (Admin, LibreChat-Adapter) oder eigene 2.0-Chats (direkt auf der Brücke) ---
  on('GET', /^\/api\/v2\/chat$/, async (req, res, _m, url) => {
    const u = await d.needUser(req);
    const ziel = url.searchParams.get('ziel') === 'eigen' ? 'eigen' : admin(u) ? 'hauptchat' : 'eigen';
    const zugang = !!(await d.claudeToken(u).catch(() => null));
    if (ziel === 'hauptchat') {
      const h = await d.hauptchat(u);
      if (!h) return send(d, res, { ziel, zugang, hauptchat: null, nachrichten: [], laeuft: false });
      const [nachrichten, laeuft] = await Promise.all([librechat.lesen(u, h.conv, 30).catch(() => []), d.laeuftChat(u, h.conv).catch(() => false)]);
      return send(d, res, { ziel, zugang, hauptchat: { url: h.url }, nachrichten, laeuft });
    }
    const conv = url.searchParams.get('conv');
    const liste = await eigen.meineChats(u);
    const nachrichten = conv ? await eigen.verlauf(u, conv, url.searchParams.get('seit') ?? undefined) : [];
    send(d, res, { ziel, zugang, chats: liste, conv: conv ?? null, nachrichten, laeuft: nachrichten.some((x) => x.status === 'laeuft') });
  });
  on('POST', /^\/api\/v2\/chat$/, async (req, res) => {
    const u = await d.needUser(req);
    const b = await d.body(req, 64 * 1024);
    if (b.ziel === 'hauptchat') {
      if (!admin(u)) throw err(403, 'Den Hauptchat führt nur Knut.');
      const text = eigen.pruefeText(b.text);
      const h = await d.hauptchat(u);
      if (!h) throw err(409, 'Kein Hauptchat aktiv — in der alten Werkbank „Hauptchat starten“.');
      if (await d.laeuftChat(u, h.conv).catch(() => false)) throw err(409, 'Der Hauptchat arbeitet gerade — dein Text bleibt stehen, schick ihn gleich noch einmal.');
      const at = await librechat.senden(u, h.conv, text);
      d.log('v2 hauptchat', { user: u.id });
      return send(d, res, { ok: true, ziel: 'hauptchat', at });
    }
    const r = await eigen.senden(u, b, { bridgeUrl: d.bridgeUrl, token: d.claudeToken, log: d.log });
    send(d, res, { ok: true, ziel: 'eigen', ...r });
  });
}

const send = (d: V2Deps, res: ServerResponse, body: unknown) => d.send(res, 200, body);
const paketDok = (p: { name: string; titel: string; at: number }) => ({ art: 'bericht', titel: p.titel || p.name.replace(/^\d+-/, '').replace(/-/g, ' '), worum: `Bericht ${p.name.split('-')[0]}`, url: `/v2/dokument?paket=${encodeURIComponent(p.name)}&datei=bericht.md`, at: new Date(p.at).toISOString() });

/** Neueste Dokumente: Berichte (nur Admin) und zuletzt geänderte Notizen. */
function dokumenteNeu(d: V2Deps, u: User, n: number) {
  const berichte = admin(u) ? d.pakete().filter((p) => p.status !== 'archiv').sort((a, b) => b.at - a.at).slice(0, n).map(paketDok) : [];
  const notizen = d.vaultNeu(n).map((x) => ({ art: 'notiz', titel: x.title || x.path, worum: x.path.split('/').slice(0, -1).join(' › '), url: `/v2/dokument?vault=${encodeURIComponent(x.path)}`, at: new Date(x.mtime).toISOString() }));
  return [...berichte, ...notizen].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, n);
}

/** Pfad im Repo der 2.0-App (Auslieferung unter /v2/). */
export const appDist = (webDir: string) => join(webDir, 'app', 'dist');
