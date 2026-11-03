// Werkbank 2.0 (Paket 436, Schritt 0): eine schmale API für die neue Oberfläche (web/app, /v2/) auf den bestehenden Funktionen.
// Nur lesen — einziger Schreibweg sind Antworten auf Fragen über die bestehende Antwortlogik (Council B4) und der Chat (v2chat.ts,
// Hauptchat über den Adapter v2librechat.ts). Alle Routen hinter der bestehenden Anmeldung (B3). Freigaben nach außen gibt es hier nicht.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { User } from './auth.ts';
import { fragenAus, empfohlenBeantwortbar, type Frage } from './entscheidungsseite.ts';
import { inboxZahl, type InboxEintrag } from './inbox.ts';
import { fragenJeStrang } from './chatstatus.ts';
import { chatListe, rolle, jetztAuswahl, karteAusFrage, antwortWeg, zustandSatz, arbeitGruppe, erledigtSicht, prSicht, personen, uhrzeit, kurz, type ArbeitZeile, type LivePrLite } from './v2kern.ts';
import * as eigen from './v2chat.ts';
import * as librechat from './v2librechat.ts';

type Handler = (req: IncomingMessage, res: ServerResponse, m: RegExpMatchArray, url: URL) => Promise<void>;
type On = (method: string, path: RegExp, h: Handler) => void;
const err = (status: number, msg: string) => Object.assign(new Error(msg), { status });

export interface V2Deps {
  needUser: (req: IncomingMessage) => Promise<User>;
  body: (req: IncomingMessage, max?: number) => Promise<any>;
  send: (res: ServerResponse, status: number, body: unknown) => void;
  inboxFuer: (u: User) => Promise<{ eintraege: InboxEintrag[]; ueberholt?: { id: string; titel: string; grund: string; beleg: string }[] }>;
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
  /** Bestehende Team-Freigabe je Funktion (features.ts): true = für diese Person gesperrt. 2.0 umgeht sie nie. */
  gesperrt: (u: User, funktion: 'wissen' | 'roadmap') => boolean;
  /** D5/C2: automatisch Geschlossenes der letzten 7 Tage (sichtbar) und wieder öffnen (nur eigene, nur automatisch geschlossene). */
  geschlossen: (u: User) => Promise<{ id: string; titel: string; grund: string; at: Date }[]>;
  wiederOeffnen: (u: User, id: string) => Promise<boolean>;
  /** S15: „Alle wie empfohlen“ — dieselbe Sammel-Logik wie die alte Werkbank (main.ts, POST /api/entscheidungen/fragen/alle). */
  alleEmpfohlen: (u: User, ids: string[], nur: (f: Frage) => boolean) => Promise<{ ok: number; fehler: string[] }>;
  /** S12: alle Unter-Chats und Hauptchats der Person (auch alte), Kopfdaten; LibreChat-Unterhaltungen über den Adapter; LibreChat-Adresse. */
  /** S21: Sammelposten schließen — derselbe Weg wie „Nein“ in der alten Werkbank (inboxAntworten). */
  sammelSchliessen: (u: User, id: string) => Promise<unknown>;
  alleRuns: (u: User) => Promise<any[]>;
  lcChats: (u: User) => Promise<any[]>;
  lcUrl: string;
  /** S20 (D8): Rolle der Besitzerin aus der Einrichtung (WERKBANK_ROLLE, von team-install gesetzt) — sonst abgeleitet. */
  rolleEinstellung?: string | null;
}

/** Eine Zustellung an den Hauptchat je Person zur selben Zeit (Pass C: zwei schnelle Klicks). */
const hauptchatSendet = new Set<string>();
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

/** Was keine Frage ist (Pflege, Altbestand, Schlange …) zählt in die eine Zahl — also auch zeigen, mit Link in die alte Werkbank. */
/** S21: in 2.0 lässt sich nur dieser Sammelposten schließen — alte Deckel-Fragen nicht mehr laufender Unter-Chats (bestehender Weg). */
const SAMMEL_SCHLIESSBAR = 'altbestand-deckel';
function aufraeumen(d: V2Deps, sonstiges: InboxEintrag[]) {
  return sonstiges.map((e) => {
    const ziel = String(e.quelle?.url ?? '').match(/^#\/([\w/-]+)/)?.[1] ?? 'entscheidungen';
    const deckel = e.id === SAMMEL_SCHLIESSBAR;
    return { id: e.id, titel: kurz(String(e.frage ?? ''), 160), sammel: true, worum: deckel ? 'Fragen von Unter-Chats, die nicht mehr laufen („automatisch fortgesetzt“, Budget, Weckdeckel). Schließen geht hier mit einem Klick.' : e.art === 'altbestand' ? 'Alte Fragen, die niemand mehr braucht — durchsehen oder verwerfen.' : e.art === 'pflege' ? 'Aufräumen, damit Listen stimmen. Hält keinen Agenten an.' : 'Wartet auf dich, ist aber keine Entscheidung.',
      url: `${d.altUrl}/${ziel}`, ...(deckel ? { schliessbar: (e.daten?.eintraege ?? []).length } : {}) };
  });
}

const arbeitKarte = (z: any) => ({ id: String(z.id), titel: kurz(z.titel, 140), thema: z.thema ?? '', satz: zustandSatz(z as ArbeitZeile), gruppe: arbeitGruppe(z as ArbeitZeile), zuletzt: z.zuletzt ?? null, uhr: uhrzeit(z.zuletzt),
  offen: z.cs?.offen ?? 0, links: [...(z.paket && z.bericht ? [{ label: 'Bericht', url: `/v2/dokument?paket=${encodeURIComponent(z.paket)}&datei=bericht.md` }] : [])] });

export function registerV2(on: On, d: V2Deps) {
  // --- Startseite „Jetzt“: eine Zahl, ≤ 5 Karten, Läuft, Heute erledigt, PRs, Dokumente — ein Abruf ---
  // `?teil=oben`: nur Zahl und Karten (≈ 0,1 s) — der erste Bildschirm am Handy wartet nicht auf Unter-Chats und PRs (Persona „unterwegs“).
  on('GET', /^\/api\/v2\/start$/, async (req, res, _m, url) => {
    const u = await d.needUser(req);
    const ib = await d.inboxFuer(u);
    const { fragen, sonstiges } = fragenAus(ib.eintraege);
    const jetzt = karten(d, fragen, ib.eintraege, jetztAuswahl(fragen));
    const auf = aufraeumen(d, sonstiges);
    const ich = vorname(u);
    const r = rolle({ admin: admin(u), vorname: ich, zugang: admin(u) && !d.rolleEinstellung ? !!(await d.claudeToken(u).catch(() => null)) : undefined, einstellung: d.rolleEinstellung }, d.githubNames());
    if (url.searchParams.get('teil') === 'oben') return send(d, res, { teil: 'oben', zahl: inboxZahl(ib.eintraege), jetzt, aufraeumen: auf.slice(0, Math.max(0, 5 - jetzt.length)), ich, admin: admin(u), rolle: r, at: new Date() });
    let laeuft: any[] = [], erledigt: any[] = [];
    if (admin(u)) {
      const [liste, er] = await Promise.all([d.unterchatListe(u, false).catch(() => ({ zeilen: [] as any[] })), d.erledigtDaten(u, d.wienDatum()).catch(() => ({ straenge: [] as any[] }))]);
      const zm = new Map(liste.zeilen.map((z: any) => [String(z.id), z]));
      laeuft = liste.zeilen.filter((z: any) => arbeitGruppe(z) === 'laeuft').map(arbeitKarte);
      const offenJe = new Set(ib.eintraege.map((e) => (e.quelle?.strand ? String(e.quelle.strand) : '')).filter(Boolean));
      erledigt = erledigtSicht(er.straenge.filter((s: any) => !offenJe.has(String(s.id))), zm, new Set(er.straenge.map((s: any) => String(s.id)).filter((id: string) => !zm.has(id))));
    }
    const prFrei = !d.gesperrt(u, 'roadmap');
    const prs = prFrei ? await d.livePrs().then((g) => prSicht([...g.map.values()] as LivePrLite[], ich, d.githubNames()).filter((p) => !p.entwurf)).catch(() => null) : null;
    send(d, res, { zahl: inboxZahl(ib.eintraege), jetzt, aufraeumen: auf.slice(0, Math.max(0, 5 - jetzt.length)), aufraeumenGesamt: auf.length, laeuft: laeuft.slice(0, 3), laeuftGesamt: laeuft.length, erledigt, prs: prs ? prs.slice(0, r === 'reviewer' ? 5 : 3) : null, prsGesamt: prs?.length ?? 0, prFrei, notizenFrei: !d.gesperrt(u, 'wissen'), dokumente: dokumenteNeu(d, u, r === 'team' ? 5 : 3), ich: ich, admin: admin(u), rolle: r, at: new Date() });
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
    const { fragen, sonstiges } = fragenAus(ib.eintraege);
    const oben = jetztAuswahl(fragen);
    const obenIds = new Set(oben.map((x) => x.f.id));
    const rest = fragen.filter((f) => f.klasse !== 'aktion' && !obenIds.has(f.id)).map((f) => ({ f, grund: '' }));
    const alle = karten(d, fragen, ib.eintraege, [...oben, ...rest]);
    const geschlossen = (await d.geschlossen(u).catch((e) => { d.log('v2 geschlossen fehler', { user: u.id, error: String(e?.message ?? e).slice(0, 160) }); return []; })).map((g) => ({ id: g.id, titel: kurz(g.titel, 140), grund: kurz(g.grund, 240), wann: g.at }));
    send(d, res, { zahl: inboxZahl(ib.eintraege), oben: alle.slice(0, oben.length), rest: alle.slice(oben.length), aufraeumen: aufraeumen(d, sonstiges), geschlossen, ueberholt: (ib.ueberholt ?? []).map((x: any) => ({ id: x.id, titel: kurz(String(x.titel).replace(/^Push freigeben: /, ''), 140), grund: x.grund, beleg: x.beleg })), at: new Date() });   // zahl = oben + rest + aufraeumen (Test); geschlossen zählt nicht
  });

  // --- Alle wie empfohlen (S15): nur gesehene Entscheidungen mit Empfehlung, die hier beantwortet werden (nie Freigaben, B4) ---
  on('POST', /^\/api\/v2\/alle-empfohlen$/, async (req, res) => {
    const u = await d.needUser(req);
    const b = await d.body(req, 64 * 1024);
    const gesehen = new Set<string>((Array.isArray(b.ids) ? b.ids : []).map(String).slice(0, 100));
    if (!gesehen.size) throw err(400, 'Keine Fragen gewählt.');
    const fragen = fragenAus((await d.inboxFuer(u)).eintraege).fragen.filter((f) => gesehen.has(f.id) && antwortWeg(f) === 'hier' && empfohlenBeantwortbar(f));
    if (!fragen.length) throw err(400, 'Keine dieser Fragen lässt sich wie empfohlen beantworten — bitte einzeln.');
    const r = await d.alleEmpfohlen(u, fragen.map((f) => f.id), (f) => antwortWeg(f) === 'hier');   // innen nochmal geprüft (Pass C)
    d.log('v2 alle wie empfohlen', { user: u.id, n: r.ok, ids: fragen.map((f) => f.id) });
    send(d, res, { ok: r.ok, fehler: r.fehler, uebersprungen: gesehen.size - fragen.length });
  });

  // --- Alte Deckel-Fragen gesammelt schließen (S21) — nur dieser Sammelposten, nie der Altbestand ---
  on('POST', /^\/api\/v2\/sammel-schliessen$/, async (req, res) => {
    const u = await d.needUser(req);
    const id = String((await d.body(req, 4 * 1024)).id ?? '');
    if (id !== SAMMEL_SCHLIESSBAR) throw err(400, 'Das schließt du einzeln oder in der alten Werkbank.');
    await d.sammelSchliessen(u, id);
    d.log('v2 sammel geschlossen', { user: u.id, id });
    send(d, res, { ok: true });
  });

  // --- Wieder öffnen (C2): eine automatisch geschlossene Frage zurück in die Liste ---
  on('POST', /^\/api\/v2\/wieder-oeffnen$/, async (req, res) => {
    const u = await d.needUser(req);
    const id = String((await d.body(req, 4 * 1024)).id ?? '');
    if (!/^[\w-]{1,40}$/.test(id)) throw err(400, 'Unbekannte Frage.');
    if (!(await d.wiederOeffnen(u, id))) throw err(409, 'Diese Frage ist nicht (mehr) automatisch geschlossen.');
    d.log('v2 wieder geöffnet', { user: u.id, id });
    send(d, res, { ok: true });
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
    send(d, res, { ok: true, ziel: r?.ziel ? String(r.ziel).replace(/Unter-Chat Unter-Chat/g, 'Unter-Chat') : null, spaeter: !!r?.spaeter });
  });

  // --- Erledigt an einem Tag (S14, Abnahme „Heute erledigt mit Datumsauswahl“): wie „Heute erledigt“ auf Jetzt, für jeden Tag ---
  on('GET', /^\/api\/v2\/erledigt$/, async (req, res, _m, url) => {
    const u = await d.needUser(req);
    if (!admin(u)) return send(d, res, { nurAdmin: true, erledigt: [] });
    const tag = url.searchParams.get('tag') || d.wienDatum();
    const echt = /^\d{4}-\d{2}-\d{2}$/.test(tag) && new Date(`${tag}T12:00:00Z`).toISOString().slice(0, 10) === tag;   // auch 31.02. abweisen (Pass C)
    if (!echt) throw err(400, 'Datum bitte als JJJJ-MM-TT.');
    if (tag > d.wienDatum()) throw err(400, 'Für einen Tag in der Zukunft gibt es noch nichts Erledigtes.');
    const [liste, er] = await Promise.all([d.unterchatListe(u, false).catch(() => ({ zeilen: [] as any[] })), d.erledigtDaten(u, tag)]);
    const zm = new Map(liste.zeilen.map((z: any) => [String(z.id), z]));
    send(d, res, { tag, heute: d.wienDatum(), erledigt: erledigtSicht(er.straenge, zm, new Set(er.straenge.map((s: any) => String(s.id)).filter((id: string) => !zm.has(id)))) });
  });

  // --- Alle Chats (S12, C4): Unter-Chats, Hauptchats, LibreChat- und 2.0-Chats — Suche und Filter macht die Oberfläche ---
  on('GET', /^\/api\/v2\/chats$/, async (req, res) => {
    const u = await d.needUser(req);
    const fehlt: string[] = [];
    const [runs, convs, eigene] = await Promise.all([admin(u) ? d.alleRuns(u) : Promise.resolve([]), d.lcChats(u).catch(() => { fehlt.push('LibreChat'); return []; }), eigen.meineChats(u, 200).catch(() => { fehlt.push('neue Chats'); return []; })]);
    const zeilen = chatListe(runs, convs, eigene, { admin: admin(u), lcUrl: d.lcUrl });
    send(d, res, { zeilen, themen: [...new Set(zeilen.map((z) => z.thema).filter(Boolean))].sort(), fehlt, at: new Date() });   // fehlt: Quelle nicht erreichbar — sichtbar statt still (Pass C)
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
    if (d.gesperrt(u, 'roadmap')) return send(d, res, { gesperrt: true, wer, ich, personen: [], zeilen: [], stand: null });
    const g = await d.livePrs();
    const live = [...g.map.values()] as LivePrLite[];
    const names = d.githubNames();
    const rv = await d.letzteReviews().catch(() => []);
    const je = new Map<string, any>();
    for (const r of rv) { const k = `${String(r.repo).split('/').pop()}#${r.number}`; if (!je.has(k)) je.set(k, r); }
    const zeilen = prSicht(live, wer, names).sort((a, b) => Number(a.entwurf) - Number(b.entwurf)).map((p) => { const r = je.get(p.pr); return { ...p, review: r ? { empfehlung: r.empfehlung ?? null, status: r.status, at: r.doneAt ?? r.createdAt } : null }; });
    const ohneEntwurf = live.filter((p) => !p.isDraft);
    send(d, res, { wer, ich, personen: [...personen(ohneEntwurf, ich, names), { name: 'alle', anzahl: ohneEntwurf.length }], zeilen, stand: g.sync?.at ?? null, at: new Date() });
  });
  on('GET', /^\/api\/v2\/prs\/([\w.-]{1,80})\/(\d{1,6})$/, async (req, res, m) => {
    const u = await d.needUser(req);
    const key = `${m[1]}#${m[2]}`;
    if (d.gesperrt(u, 'roadmap')) throw err(403, 'PRs sind für dich noch nicht freigegeben — frag Knut.');
    const p: any = (await d.livePrs()).map.get(key);
    const rv = (await d.letzteReviews().catch(() => [])).filter((r) => String(r.repo).split('/').pop() === m[1] && Number(r.number) === Number(m[2]));
    if (!p && !rv.length) throw err(404, 'Diesen PR gibt es nicht in der Liste offener PRs.');
    const r = rv.find((x) => x.status === 'fertig' && x.paket) ?? rv[0] ?? null;
    // Der Text des Agenten: für alle, sobald er auf GitHub steht; ein nicht geposteter Entwurf nur für Admins (Freigabe bleibt bei Knut).
    const sichtbar = !!r && (admin(u) || !!r.posted?.url);
    const k = sichtbar && r.paket && /^\d{1,4}-[a-z0-9][a-z0-9-]*$/.test(r.paket) ? d.reviewKommentar(r.paket) : null;
    const names = d.githubNames();
    const wa = p ? prSicht([p], 'alle', names)[0] : null;
    send(d, res, {
      pr: key, titel: p?.title ?? r?.title ?? key, url: p?.url ?? r?.url ?? null, autor: p ? (names[String(p.author ?? '').toLowerCase()] ?? p.author ?? null) : null,
      offen: !!p, merge: p?.turn?.role === 'merge', wartetAuf: wa?.wartetAuf ?? [], warum: wa?.warum ?? '', entscheidung: p?.reviewDecision ?? null, offeneThreads: p?.openThreads ?? 0,
      reviews: (p?.reviews ?? []).map((x: any) => ({ wer: names[String(x.author ?? '').toLowerCase()] ?? x.author, zustand: x.state, at: x.submittedAt })),
      agent: r ? { status: r.status, empfehlung: sichtbar ? k?.empfehlung ?? r.empfehlung ?? null : null, text: k?.text ?? null, gepostet: r.posted?.url ?? null, entwurf: !r.posted?.url, at: r.doneAt ?? r.createdAt,
        bericht: admin(u) && r.paket ? `/v2/dokument?paket=${encodeURIComponent(r.paket)}&datei=bericht.md` : null } : null,
      at: new Date(),
    });
  });

  // --- Dokumente: Berichte (Admin) und Notizen (alle), Suche nach Titel/Pfad ---
  on('GET', /^\/api\/v2\/dokumente$/, async (req, res, _m, url) => {
    const u = await d.needUser(req);
    const q = String(url.searchParams.get('q') ?? '').trim().slice(0, 80);
    const frei = { notizen: !d.gesperrt(u, 'wissen'), berichte: admin(u) };
    if (!q) return send(d, res, { q, frei, treffer: dokumenteNeu(d, u, 12) });
    const ql = q.toLowerCase();
    const berichte = admin(u) ? d.pakete().filter((p) => p.status !== 'archiv' && (p.name.toLowerCase().includes(ql) || p.titel.toLowerCase().includes(ql))).sort((a, b) => b.at - a.at).slice(0, 10).map(paketDok) : [];
    const notizen = (d.gesperrt(u, 'wissen') ? [] : await d.vaultSuche(q).catch(() => [])).filter((h) => !ROH.test(h.path)).slice(0, 20).map((h) => ({ art: 'notiz', titel: h.title || h.path, worum: h.snippet ? kurz(h.snippet.replace(/<[^>]+>/g, ''), 160) : bereich(h.path), url: `/v2/dokument?vault=${encodeURIComponent(h.path)}`, at: null }));
    send(d, res, { q, frei, treffer: [...berichte, ...notizen] });
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
      if (hauptchatSendet.has(u.id) || (await d.laeuftChat(u, h.conv).catch(() => true))) throw err(409, 'Der Hauptchat arbeitet gerade — dein Text bleibt stehen, schick ihn gleich noch einmal.');
      hauptchatSendet.add(u.id);
      let at: Date;
      try { at = await librechat.senden(u, h.conv, text); } finally { hauptchatSendet.delete(u.id); }
      d.log('v2 hauptchat', { user: u.id });
      return send(d, res, { ok: true, ziel: 'hauptchat', at });
    }
    const r = await eigen.senden(u, b, { bridgeUrl: d.bridgeUrl, token: d.claudeToken, log: d.log });
    send(d, res, { ok: true, ziel: 'eigen', ...r });
  });
}

const send = (d: V2Deps, res: ServerResponse, body: unknown) => d.send(res, 200, body);
const paketDok = (p: { name: string; titel: string; at: number }) => ({ art: 'bericht', titel: p.titel || p.name.replace(/^\d+-/, '').replace(/-/g, ' '), worum: `Bericht ${p.name.split('-')[0]}`, url: `/v2/dokument?paket=${encodeURIComponent(p.name)}&datei=bericht.md`, at: new Date(p.at).toISOString() });

/** Rohtranskripte und Agenten-Ablagen gehören nicht in die Dokumentliste für Menschen (Persona Lisa). */
const ROH = /\/(raw|00-Inbox)\/|\/_meta\//;
/** Statt Dateipfad ein Bereich in Klartext: „olaf · Product › Produkt-OLAF“. */
const bereich = (p: string) => { const t = p.split('/'); return [t[0], t.slice(1, -1).filter((x) => !/^\d-/.test(x) && x !== '2-Areas').slice(-2).join(' › ')].filter(Boolean).join(' · '); };

/** Neueste Dokumente: Berichte (nur Admin) und zuletzt geänderte Notizen. */
function dokumenteNeu(d: V2Deps, u: User, n: number) {
  const berichte = admin(u) ? d.pakete().filter((p) => p.status !== 'archiv').sort((a, b) => b.at - a.at).slice(0, n).map(paketDok) : [];
  const notizen = (d.gesperrt(u, 'wissen') ? [] : d.vaultNeu(n * 3).filter((x) => !ROH.test(x.path)).slice(0, n)).map((x) => ({ art: 'notiz', titel: x.title || x.path, worum: bereich(x.path), url: `/v2/dokument?vault=${encodeURIComponent(x.path)}`, at: new Date(x.mtime).toISOString() }));
  return [...berichte, ...notizen].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, n);
}

/** Pfad im Repo der 2.0-App (Auslieferung unter /v2/). */
export const appDist = (webDir: string) => join(webDir, 'app', 'dist');

// ---------- Auslieferung unter einem Präfix (S16, Council C3) ----------

/** Präfixe, unter denen die Werkbank erreichbar ist: direkt (:3070) und über den LibreChat-Proxy (/werkbank). Alles andere → direkt. */
export const PRAEFIXE = ['', '/werkbank'] as const;
export const praefix = (kopf: unknown): string => { const k = String(kopf ?? ''); return (PRAEFIXE as readonly string[]).includes(k) ? k : ''; };

/** index.html der App für ein Präfix: <base href> (die App nutzt nur relative Pfade) und Asset-Pfade mit Präfix. */
export function v2Index(html: string, kopf: unknown): string {
  const p = praefix(kopf);
  const basis = `<base href="${p}/" />`;
  const h = html.replace(/(src|href)="\/v2\//g, `$1="${p}/v2/`);
  return /<base\b[^>]*>/i.test(h) ? h.replace(/<base\b[^>]*>/i, basis) : h.replace(/<head>/i, `<head>\n    ${basis}`);
}
