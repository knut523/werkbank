// Werkbank 2.0 (Paket 436, Schritt 0): eine schmale API für die neue Oberfläche (web/app, /v2/) auf den bestehenden Funktionen.
// Nur lesen — einziger Schreibweg sind Antworten auf Fragen über die bestehende Antwortlogik (Council B4) und der Chat (v2chat.ts,
// Hauptchat über den Adapter v2librechat.ts). Alle Routen hinter der bestehenden Anmeldung (B3). Freigaben nach außen gibt es hier nicht.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { User } from './auth.ts';
import { fragenAus, empfohlenBeantwortbar, type Frage } from './entscheidungsseite.ts';
import { themaOf } from './themen.ts';
import { inboxZahl, type InboxEintrag } from './inbox.ts';
import { fragenJeStrang } from './chatstatus.ts';
import { v2FreigabeAn, auszugUm, knutOffenJe, strangZuPr, jetztSatz, schritteAus, standZeile, bezugIds, standVoll, verlangtVon, kurzurteil, themenUebersicht, themaVon, chatListe, rolle, jetztAuswahl, karteAusFrage, antwortWeg, zustandSatz, arbeitGruppe, erledigtSicht, prSicht, personen, uhrzeit, kurz, type ArbeitZeile, type LivePrLite, type V2Karte } from './v2kern.ts';
import * as eigen from './v2chat.ts';
import { dodAus, fastFertig, endenAus, hauptsitzungPunkte } from './dod.ts';
import { triageAn, councilWirkung, type Council, type CouncilUrteil } from './stufe.ts';
import { BEDARF_NAME } from './bedarf.ts';
import type { Abgleich } from './fragenbericht.ts';
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
  /** Nutzungs-Audit 437: Antwort an der 2.0-Karte zählen (feste Arten, kein Text). */
  antwortGezaehlt?: (art: string, weg: 'v2') => void;
  strang: (u: User, id: string) => Promise<any | null>;
  hauptchat: (u: User) => Promise<{ conv: string; url: string | null } | null>;
  laeuftChat: (u: User, conv: string) => Promise<boolean>;
  /** Chat-Bereich (Knut 06.11.): Datei als Anhang an einen Unter-Chat (ablegen und Pfad als Nachricht schicken). */
  anhang?: (u: User, id: string, name: string, buf: Buffer, text: string) => Promise<{ pfad: string }>;
  /** Chat-Bereich (Knut 06.11.): Unter-Chat steuern (Weiter/Fortsetzen, Anhalten, Abbrechen, Gründlich, Zurückholen). */
  steuern?: (u: User, id: string, aktion: SteuerAktion) => Promise<{ zustellung?: string | null; hinweis?: string }>;
  /** Bedarfskanal (Knut 06.11.): offene Bedarfe der Stränge und die Antwort darauf (erteilt / erledigt / abgelehnt). */
  bedarfListe?: (u: User) => Promise<any[]>;
  bedarfAntwort?: (u: User, id: string, b: { antwort: string; notiz: string; dauerMin?: number }) => Promise<unknown>;
  /** Audit 05.11. (4): Text für den Hauptchat einreihen, solange er arbeitet (Ergebnis: wie viele jetzt warten). */
  hauptchatEinreihen?: (u: User, text: string) => Promise<number>;
  hauptchatEingereiht?: (u: User) => Promise<{ text: string; at: Date }[]>;
  livePrs: () => Promise<{ map: Map<string, any>; sync?: any }>;
  githubNames: () => Record<string, string>;
  letzteReviews: () => Promise<any[]>;
  /** Audit 05.11. (6): aktueller Kopf je PR (pr_ticker_prs, Schlüssel „owner/repo#n“) — fürs Review-zu-Kopf. */
  prKoepfe?: () => Promise<{ _id: string; head: string }[]>;
  /** Paket 436 (Knut 04.11.): Prüfschritt vor dem Fix-Push — je Fix-Lauf die abgehakten offenen Punkte (pr_fixes.punkte), neueste zuerst. */
  fixPunkte?: () => Promise<any[]>;
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
  /** Abgleich (h): Volltextsuche in den eigenen Chat-Nachrichten (v2librechat.volltext). */
  lcVolltext?: (u: User, q: string) => Promise<{ conv: string; text: string; at: Date | string }[]>;
  /** Plan §23 T5: Entscheidungs-Log der Person (main.ts logListe), Umkehr über den bestehenden Widerruf (an den Unter-Chat). */
  entschiedenLog?: (u: User) => Promise<{ id: string; durch: string; at: string | Date; strand: { id: string; titel: string } | null; [k: string]: any }[]>;
  umkehren?: (u: User, id: string, text: string) => Promise<void>;
  /** Plan §23 T3: Council-Urteil des Hauptchats speichern und wirken lassen (main.ts councilAnwenden). */
  councilAnwenden?: (u: User, f: Frage, c: Council, w: ReturnType<typeof councilWirkung>) => Promise<void>;
  /** Plan §24 A4: Haken der „Braucht Hauptsitzung“-Punkte (main.ts, Sammlung hauptsitzung_haken). */
  hauptsitzungHaken?: { lesen: (u: User) => Promise<Set<string>>; setzen: (u: User, key: string, an: boolean) => Promise<void> };
  /** Knut 05.11. 19:00 „Zum Ansehen“: ausgeblendete Stränge („Später“) und die Antwort an den Strang (main.ts). */
  ansehenSpaeter?: (u: User) => Promise<Set<string>>;
  /** Knut 05.11. abends (2): offene Stränge mit PR-Bezug (Titel, Auftrag, prReview, Berichtskopf, Zustand). */
  prStraenge?: (u: User) => Promise<any[]>;
  /** Knut 05.11. abends (1): Aktion je PR — review/tief (Review-Schlange), fixen/auftrag (Fix-Schlange); nie Push/Merge. */
  prAktion?: (u: User, pr: string, art: 'review' | 'tief' | 'fixen' | 'auftrag', text: string) => Promise<{ hinweis: string }>;
  ansehenAntwort?: (u: User, id: string, art: 'passt' | 'aendern' | 'spaeter', notiz: string, titel: string) => Promise<void>;
  lcUrl: string;
  /** S20 (D8): Rolle der Besitzerin aus der Einrichtung (WERKBANK_ROLLE, von team-install gesetzt) — sonst abgeleitet. */
  rolleEinstellung?: string | null;
  /** S22: Vorlagen aus librechat.yaml (modelSpecs mit promptPrefix) für den 2.0-Chat. */
  vorlagen?: () => { name: string; label: string; beschreibung: string; prefix: string }[];
  /** Runde 4 (Knut B2): Abgleich deiner Liste mit Bericht und letztem Stand eines Unter-Chats (fragenbericht.ts). */
  abgleich?: (u: User, strandId: string, stand: string) => Promise<Abgleich | null>;
  /** Runde 5 (Knut B1): Paket und Fragen-Kopf des Berichts eines Unter-Chats (für Sammelkarten). */
  berichtVon?: (u: User, strandId: string) => Promise<{ paket: string; fragen: any[] } | null>;
  /** Runde 7: Roadmap-Items (Spec-Seiten im olaf-Vault, roadmapitems.ts), schon mit Thema. */
  /** Runde 7 (Knut: Unter-Chats transparent): Zustand der Stränge bei der Brücke, je Unterhaltung (strandStates). */
  zustaende?: (u: User) => Promise<Map<string, any>>;
  /** Runde 7 (Abgleich: Nachreichen fehlte, 148× genutzt): Nachricht an einen Unter-Chat — läuft er, wird sie nachgereicht. */
  nachreichen?: (u: User, strandId: string, text: string) => Promise<unknown>;
  /** Runde 7 (Abgleich): alle Dateien eines Review-Pakets, nicht nur bericht.md. */
  paketDateien?: (paket: string) => { rel: string; size: number }[];
  roadmap?: () => { thema: string; titel: string; path: string; stand: string; standNr: number; mtime: number }[];
}

/** Chat-Bereich (Knut 06.11.): Steuerknöpfe eines Unter-Chats. weiter/fortsetzen = Handnachricht „weiter“ (hebt Deckel und Stopp auf),
 *  anhalten = geprüft, läuft nicht weiter (wie „Anhalten“ der alten Werkbank), abbrechen = laufenden Zug in der Brücke beenden. */
export const STEUER_AKTIONEN = ['weiter', 'fortsetzen', 'anhalten', 'abbrechen', 'gruendlich', 'zurueckholen'] as const;
export type SteuerAktion = typeof STEUER_AKTIONEN[number];
/** Dateiname eines Anhangs: nur der letzte Teil, sichere Zeichen, höchstens 120 Zeichen. */
export const anhangName = (n: string) => (n.split(/[\\/]/).pop() || 'anhang').replace(/[^\w.-]+/g, '_').replace(/^\.+/, '').slice(0, 120) || 'anhang';

/** Eine Zustellung an den Hauptchat je Person zur selben Zeit (Pass C: zwei schnelle Klicks). */
const hauptchatSendet = new Set<string>();
/** Audit 05.11. (6): passt das Review zum aktuellen Kopf? null = unbekannt (kein Kopf-Wissen oder Review ohne Commit). */
function zuKopf(r: { head?: unknown }, jetzt: string | null, bekannt: boolean): { aktuell: boolean | null; kopf: string | null; neuerKopf: string | null } {
  const h = typeof r.head === 'string' && r.head ? r.head : null;
  if (!bekannt || !h || !jetzt) return { aktuell: null, kopf: h?.slice(0, 7) ?? null, neuerKopf: null };
  return { aktuell: h === jetzt, kopf: h.slice(0, 7), neuerKopf: h === jetzt ? null : jetzt.slice(0, 7) };
}
/** Kopf je PR, geschlüsselt nach Kurznamen wie die PR-Liste („repo#n“). */
const koepfeVon = async (d: V2Deps) => (d.prKoepfe ? new Map((await d.prKoepfe().catch(() => [])).map((x) => [`${String(x._id).split('#')[0].split('/').pop()}#${String(x._id).split('#')[1]}`, String(x.head ?? '')] as [string, string]).filter(([, h]) => !!h)) : null);
/** Audit 05.11. (5): wie zustandSatz — „fertig“ zählt als Bericht nur mit Bericht UND Paket. */
const ohneBericht = (z: { zustand?: string; bericht?: unknown; paket?: unknown }) => z.zustand === 'fertig' && !(z.bericht && z.paket);

/** Audit 05.11. (4): Takt — Eingereihtes an den Hauptchat zustellen, sobald er frei ist (gebündelt, älteste zuerst; bei Fehler
 *  zurücklegen). Ergebnis: wie viele Texte zugestellt wurden. */
export async function hauptchatZustellen(z: { hauptchat: V2Deps['hauptchat']; laeuftChat: V2Deps['laeuftChat']; nehmen: (u: User) => Promise<{ id: string; text: string; at: Date }[]>; zuruecklegen: (u: User, l: { id: string; text: string; at: Date }[]) => Promise<void>; quittieren?: (u: User, ids: string[]) => Promise<void>; senden: (u: User, conv: string, text: string) => Promise<Date>; log: V2Deps['log'] }, u: User): Promise<number> {
  const h = await z.hauptchat(u);
  if (!h || hauptchatSendet.has(u.id) || (await z.laeuftChat(u, h.conv).catch(() => true))) return 0;
  hauptchatSendet.add(u.id);
  try {
    const l = await z.nehmen(u);
    if (!l.length) return 0;
    const s = [...l].sort((a, b) => +new Date(a.at) - +new Date(b.at));
    const text = s.length === 1 ? s[0].text : `(Werkbank: ${s.length} Nachrichten aus der Werkbank 2.0 kamen, während du gearbeitet hast — hier gesammelt, älteste zuerst.)\n\n${s.map((x) => x.text).join('\n\n---\n\n')}`;
    try { await z.senden(u, h.conv, text); } catch (e: any) {
      await z.zuruecklegen(u, l);
      z.log('v2 hauptchat eingereiht fehler', { user: u.id, n: l.length, error: String(e?.message ?? e).slice(0, 160) });
      return 0;
    }
    await z.quittieren?.(u, l.map((x) => x.id)).catch(() => {});
    z.log('v2 hauptchat eingereiht zugestellt', { user: u.id, n: l.length });
    return l.length;
  } finally { hauptchatSendet.delete(u.id); }
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

/** Uhrzeit (Wien) für Sätze. */
const wann2 = (iso: string) => new Date(iso).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Plan §23 T4 („Für dich“): mit Triage nur Knut-Fragen — technische entscheidet Claude, gewichtige der Hauptchat nach Council. */
const fuerKnut = (fragen: Frage[]) => (triageAn() ? fragen.filter((f) => f.triage?.klasse === 'knut') : fragen);
const beiClaude = (fragen: Frage[]) => (triageAn() ? { technisch: fragen.filter((f) => f.triage?.klasse === 'technisch').length, gewichtig: fragen.filter((f) => f.triage?.klasse === 'gewichtig').length } : null);
/** Die eine Zahl: mit Triage die Zahl der Knut-Fragen, sonst wie bisher. */
const zahlVon = (eintraege: InboxEintrag[]) => (triageAn() ? fuerKnut(fragenAus(eintraege).fragen).length : inboxZahl(eintraege));

function karten(d: V2Deps, fragen: Frage[], eintraege: InboxEintrag[], liste: { f: Frage; grund: string }[]) {
  const sj = strangJe(eintraege);
  return liste.map(({ f, grund }) => { const s = sj.get(f.eintrag); return karteAusFrage(f, { grund, strand: s?.id ?? null, strandTitel: s?.titel ?? null, altUrl: `${d.altUrl}/entscheidungen`, v2Freigabe: v2FreigabeAn() }); });
}

/** Runde 5 (Knut B1): Sammelkarten tragen die gemeinten D-Fragen (Frage, Empfehlung, schon entschieden?) und den Bericht — sonst
 *  bestätigt „Ja, so“ Entscheidungen, die man nicht sieht. Nur für Karten mit mindestens zwei D-Kennungen und einem Unter-Chat mit Bericht. */
async function mitBezug(d: V2Deps, u: User, ks: V2Karte[]): Promise<V2Karte[]> {
  if (!d.berichtVon) return ks;
  const je = new Map<string, Promise<{ paket: string; fragen: any[] } | null>>();
  ks = ks.map((k) => ({ ...k, links: [...k.links] }));   // nie geteilte Kartenobjekte verändern (Pass C)
  for (const k of ks) {
    const ids = bezugIds(`${k.titel} ${k.worum}`);
    const strand = k.links.map((l) => /\/v2\/arbeit\/([0-9a-f]{8})$/.exec(l.url)?.[1]).find(Boolean);
    if (!ids || !strand) continue;
    if (!je.has(strand)) je.set(strand, d.berichtVon(u, strand).catch(() => null));
    const b = await je.get(strand)!;
    if (!b) continue;
    const bezug = ids.map((id) => b.fragen.find((f) => String(f?.id ?? '').trim().toUpperCase() === id)).filter(Boolean)
      .map((f: any) => ({ id: String(f.id), frage: kurz(String(f.frage ?? ''), 200), empfehlung: f.empfehlung ? kurz(String(f.empfehlung), 200) : null, antwort: String(f.antwort ?? '').trim() ? kurz(String(f.antwort), 160) : null }));
    k.bericht = `/v2/dokument?paket=${encodeURIComponent(b.paket)}&datei=bericht.md`;
    if (bezug.length === ids.length) k.bezug = bezug;   // nur vollständig — sonst bestätigt „Ja, so“ mehr, als die Karte zeigt (Pass C); dann Hinweis + Bericht
    if (!k.links.some((l) => l.url === k.bericht)) k.links = [{ label: 'Bericht', url: k.bericht }, ...k.links];
  }
  return ks;
}

/** Runde 7 (Knut: DoD): fertig gemeldete Unter-Chats mit offener DoD-Zeile oder Folge-Aufgabe sind „fast fertig“ — je id der Satz. */
async function fastFertigJe(d: V2Deps, u: User, ids: string[], max = 40): Promise<Map<string, { satz: string; stand: string; titel: string }>> {
  const out = new Map<string, { satz: string; stand: string; titel: string }>();
  await Promise.all(ids.slice(0, max).map(async (id) => {
    const doc = await d.strang(u, id).catch(() => null);
    const stand = String(doc?.standVoll || doc?.lastExcerpt || '');
    const f = doc ? fastFertig(dodAus(stand)) : null;
    if (f) out.set(id, { satz: `Fast fertig — fehlt: ${f.fehlt.slice(0, 3).join('; ')}${f.fehlt.length > 3 ? ' …' : ''}${f.wartetAuf.length ? `; wartet auf: ${f.wartetAuf.join(', ')}` : ''}.`, stand, titel: String(doc.title ?? '') });
  }));
  return out;
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

const arbeitKarte = (z: any) => ({ id: String(z.id), titel: kurz(z.titel, 140), thema: themaVon(z.thema ?? null, String(z.titel ?? '')), satz: zustandSatz(z as ArbeitZeile), gruppe: arbeitGruppe(z as ArbeitZeile), zuletzt: z.zuletzt ?? null, uhr: uhrzeit(z.zuletzt),
  offen: z.cs?.offen ?? 0, links: [...(z.paket && z.bericht ? [{ label: 'Bericht', url: `/v2/dokument?paket=${encodeURIComponent(z.paket)}&datei=bericht.md` }] : [])] });

export function registerV2(on: On, d: V2Deps) {
  // Plan §23 T6: mit Triage trägt jede Zeile die Zahl ihrer offenen Knut-Fragen — „wartet“ nur, wenn Knut gebraucht wird.
  const ucListe = async (u: User) => {
    const l = await d.unterchatListe(u, false);
    if (!triageAn()) return l;
    const m = knutOffenJe(fragenAus((await d.inboxFuer(u)).eintraege).fragen);
    for (const z of l.zeilen as any[]) z.knutOffen = m.get(String(z.id)) ?? 0;
    return l;
  };
  // --- Startseite „Jetzt“: eine Zahl, ≤ 5 Karten, Läuft, Heute erledigt, PRs, Dokumente — ein Abruf ---
  // `?teil=oben`: nur Zahl und Karten (≈ 0,1 s) — der erste Bildschirm am Handy wartet nicht auf Unter-Chats und PRs (Persona „unterwegs“).
  on('GET', /^\/api\/v2\/start$/, async (req, res, _m, url) => {
    const u = await d.needUser(req);
    const ib = await d.inboxFuer(u);
    const { fragen: alleFragen, sonstiges } = fragenAus(ib.eintraege);
    const fragen = fuerKnut(alleFragen);
    const jetzt = await mitBezug(d, u, karten(d, fragen, ib.eintraege, jetztAuswahl(fragen)));
    const auf = aufraeumen(d, sonstiges);
    const ich = vorname(u);
    const r = rolle({ admin: admin(u), vorname: ich, zugang: admin(u) && !d.rolleEinstellung ? !!(await d.claudeToken(u).catch(() => null)) : undefined, einstellung: d.rolleEinstellung }, d.githubNames());
    if (url.searchParams.get('teil') === 'oben') return send(d, res, { teil: 'oben', zahl: zahlVon(ib.eintraege), jetzt, aufraeumen: auf.slice(0, Math.max(0, 5 - jetzt.length)), ich, admin: admin(u), rolle: r, at: new Date() });
    let laeuft: any[] = [], erledigt: any[] = [];
    if (admin(u)) {
      const [liste, er] = await Promise.all([ucListe(u).catch(() => ({ zeilen: [] as any[] })), d.erledigtDaten(u, d.wienDatum()).catch(() => ({ straenge: [] as any[] }))]);
      const zm = new Map(liste.zeilen.map((z: any) => [String(z.id), z]));
      laeuft = liste.zeilen.filter((z: any) => arbeitGruppe(z) === 'laeuft').map(arbeitKarte);
      const offenJe = new Set(ib.eintraege.map((e) => (e.quelle?.strand ? String(e.quelle.strand) : '')).filter(Boolean));
      erledigt = erledigtSicht(er.straenge.filter((s: any) => !offenJe.has(String(s.id))), zm, new Set(er.straenge.map((s: any) => String(s.id)).filter((id: string) => !zm.has(id))));
    }
    const prFrei = !d.gesperrt(u, 'roadmap');
    const live = prFrei ? await d.livePrs().then((g) => [...g.map.values()] as LivePrLite[]).catch(() => null) : null;
    const rv = live ? await d.letzteReviews().catch(() => []) : [];
    // Pass Runde 4: auch die Zeilen auf „Jetzt“ tragen das Agenten-Review (sonst stand dort immer „noch kein Agenten-Review“).
    const prs = live ? mitReview(prSicht(live, ich, d.githubNames()).filter((p) => !p.entwurf), rv, admin(u)) : null;
    // Runde 4 (Christoph B1): Reviewer sehen die neuesten veröffentlichten Agenten-Reviews offener PRs — der Weg zum Review-Stand in einem Klick.
    const reviews = r === 'reviewer' && live ? mitReview(prSicht(live, 'alle', d.githubNames()).filter((p) => !p.entwurf), rv, false)
      .filter((p) => p.review?.gepostet && p.review.status === 'fertig').sort((a, b) => new Date(b.review!.at ?? 0).getTime() - new Date(a.review!.at ?? 0).getTime()).slice(0, 3) : [];   // at kann ein Date sein (Pass C)
    send(d, res, { reviews, zahl: zahlVon(ib.eintraege), jetzt, aufraeumen: auf.slice(0, Math.max(0, 5 - jetzt.length)), aufraeumenGesamt: auf.length, laeuft: laeuft.slice(0, 3), laeuftGesamt: laeuft.length, erledigt, prs: prs ? prs.slice(0, r === 'reviewer' ? 5 : 3) : null, prsGesamt: prs?.length ?? 0, prFrei, notizenFrei: !d.gesperrt(u, 'wissen'), dokumente: dokumenteNeu(d, u, r === 'team' ? 5 : 3), ich: ich, admin: admin(u), rolle: r, at: new Date() });
  });

  /** Je PR das neueste Agenten-Review (letzteReviews ist neueste zuerst). Entwurfs-Urteil nur für Admins (wie auf der PR-Seite). */
  function mitReview<T extends { pr: string }>(zeilen: T[], rv: any[], istAdmin: boolean, fx: any[] = [], koepfe: Map<string, string> | null = null): (T & { review: { empfehlung: string | null; status: string; gepostet: boolean; at: any } | null; fix: { offen: number; gesamt: number; at: any } | null })[] {
    const je = new Map<string, any>(), fixJe = new Map<string, any>();
    for (const r of rv) { const k = `${String(r.repo).split('/').pop()}#${r.number}`; if (!je.has(k)) je.set(k, r); }
    for (const f of fx) { const k = `${String(f.repo).split('/').pop()}#${f.number}`; if (!fixJe.has(k) && f.punkte) fixJe.set(k, f); }
    return zeilen.map((p) => { const r = je.get(p.pr), f = fixJe.get(p.pr); return { ...p, review: r ? { empfehlung: istAdmin || r.posted?.url ? r.empfehlung ?? null : null, status: r.status, gepostet: !!r.posted?.url, at: r.doneAt ?? r.createdAt, ...zuKopf(r, koepfe?.get(p.pr) ?? null, !!koepfe) } : null,
      fix: f ? { offen: Number(f.punkte.offen ?? 0), gesamt: Number(f.punkte.gesamt ?? 0), at: f.punkte.at ?? null, lesbar: f.punkte.lesbar !== false } : null }; });
  }

  // --- Die eine Zahl (Kopf jeder Seite): dieselbe wie überall — `inboxZahl` ---
  on('GET', /^\/api\/v2\/zahl$/, async (req, res) => {
    const u = await d.needUser(req);
    send(d, res, { zahl: zahlVon((await d.inboxFuer(u)).eintraege) });
  });

  // --- Entscheidungen: alle offenen, wichtigste zuerst (dieselbe Zahl wie oben) ---
  on('GET', /^\/api\/v2\/entscheidungen$/, async (req, res) => {
    const u = await d.needUser(req);
    const ib = await d.inboxFuer(u);
    const { fragen: alleFragen, sonstiges } = fragenAus(ib.eintraege);
    const fragen = fuerKnut(alleFragen);
    const oben = jetztAuswahl(fragen);
    const obenIds = new Set(oben.map((x) => x.f.id));
    const rest = fragen.filter((f) => f.klasse !== 'aktion' && !obenIds.has(f.id)).map((f) => ({ f, grund: '' }));
    const alle = await mitBezug(d, u, karten(d, fragen, ib.eintraege, [...oben, ...rest]));
    const geschlossen = (await d.geschlossen(u).catch((e) => { d.log('v2 geschlossen fehler', { user: u.id, error: String(e?.message ?? e).slice(0, 160) }); return []; })).map((g) => ({ id: g.id, titel: kurz(g.titel, 140), grund: kurz(g.grund, 240), wann: g.at }));
    send(d, res, { zahl: zahlVon(ib.eintraege), beiClaude: beiClaude(alleFragen), oben: alle.slice(0, oben.length), rest: alle.slice(oben.length), aufraeumen: aufraeumen(d, sonstiges), geschlossen, ueberholt: (ib.ueberholt ?? []).map((x: any) => ({ id: x.id, titel: kurz(String(x.titel).replace(/^Push freigeben: /, ''), 140), grund: x.grund, beleg: x.beleg })), at: new Date() });   // zahl = oben + rest + aufraeumen (Test); geschlossen zählt nicht
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
    d.antwortGezaehlt?.(f.art === 'rueckfrage' ? 'rueckfrage' : f.art === 'braucht' ? 'braucht' : 'inbox', 'v2');
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
    const [liste, er] = await Promise.all([ucListe(u).catch(() => ({ zeilen: [] as any[] })), d.erledigtDaten(u, tag)]);
    const zm = new Map(liste.zeilen.map((z: any) => [String(z.id), z]));
    send(d, res, { tag, heute: d.wienDatum(), erledigt: erledigtSicht(er.straenge, zm, new Set(er.straenge.map((s: any) => String(s.id)).filter((id: string) => !zm.has(id)))) });
  });

  // --- Themen quer über Entscheidungen, Unter-Chats, Dokumente, PRs (S11) — Team-Freigaben gelten wie überall ---
  const themenQuellen = async (u: User) => {
    const ib = await d.inboxFuer(u);
    const { fragen } = fragenAus(ib.eintraege);
    const auswahl = jetztAuswahl(fragen), obenIds = new Set(auswahl.map((x) => x.f.id));
    const kartenAlle = karten(d, fragen, ib.eintraege, [...auswahl, ...fragen.filter((f) => f.klasse !== 'aktion' && !obenIds.has(f.id)).map((f) => ({ f, grund: '' }))]);
    const runs = admin(u) ? await d.alleRuns(u).catch(() => []) : [];
    const notizen = d.gesperrt(u, 'wissen') ? [] : d.vaultNeu(5000).filter((n) => !ROH.test(`/${n.path}`));
    const prs = d.gesperrt(u, 'roadmap') ? [] : await d.livePrs().then((g) => [...g.map.values()] as any[]).catch(() => []);
    const roadmap = d.gesperrt(u, 'wissen') || !d.roadmap ? [] : d.roadmap();
    return { kartenAlle, runs, notizen, prs, roadmap };
  };
  on('GET', /^\/api\/v2\/themen$/, async (req, res) => {
    const u = await d.needUser(req);
    const q = await themenQuellen(u);
    send(d, res, { themen: themenUebersicht({ karten: q.kartenAlle, runs: q.runs, notizen: q.notizen, prs: q.prs.map((p) => ({ repo: String(p.repo ?? ''), title: String(p.title ?? '') })), roadmap: q.roadmap }) });
  });
  on('GET', /^\/api\/v2\/thema$/, async (req, res, _m, url) => {
    const u = await d.needUser(req);
    const name = String(url.searchParams.get('name') ?? '');
    if (!name || name.length > 200) throw err(400, 'Welches Thema?');
    const [q, liste, st] = await Promise.all([themenQuellen(u), admin(u) ? ucListe(u).catch(() => ({ zeilen: [] as any[] })) : Promise.resolve({ zeilen: [] as any[] }), admin(u) && d.zustaende ? d.zustaende(u).catch(() => null) : Promise.resolve(null)]);
    const zm = new Map(liste.zeilen.map((z: any) => [String(z.id), z]));
    const ffThema = await fastFertigJe(d, u, liste.zeilen.filter((z: any) => arbeitGruppe(z) === 'fertig' && themaVon(themaOf(z), String(z.titel ?? '')) === name).map((z: any) => String(z.id)));
    const runs = q.runs.filter((r) => r.kind !== 'leitstand' && themaVon(themaOf(r), String(r.title ?? '')) === name)
      .sort((a, b) => String(b.lastActivity ?? b.startedAt ?? '').localeCompare(String(a.lastActivity ?? a.startedAt ?? '')));
    send(d, res, {
      thema: name,
      entscheidungen: await mitBezug(d, u, q.kartenAlle.filter((k) => k.thema === name)),
      // Runde 7 (Knut): je Unter-Chat sein Zustand — wartet · läuft · fertig · abgenommen — mit dem Satz wie unter „Arbeit“.
      unterchats: runs.slice(0, 40).map((r) => { const z = zm.get(String(r._id)); const lauf = st?.get(String(r.conv ?? '')); const jetzt = lauf?.running ? jetztSatz(lauf.jetzt) : null;   // Runde 7: auch in der Themenansicht, was er gerade tut
        return { id: String(r._id), titel: kurz(String(r.title ?? ''), 140), zuletzt: r.lastActivity ?? r.startedAt ?? null, offen: !(r.knutReviewedAt || r.reviewedAt), gruppe: z ? arbeitGruppe(z) : 'abgenommen', satz: jetzt ? `Jetzt: ${jetzt}` : ffThema.get(String(r._id))?.satz ?? (z ? zustandSatz(z) : 'Abgenommen.') }; }),
      unterchatsGesamt: runs.length,
      dokumenteGesamt: q.notizen.filter((n) => themaVon(null, `${n.path} ${n.title}`) === name).length,
      dokumente: q.notizen.filter((n) => themaVon(null, `${n.path} ${n.title}`) === name).slice(0, 20).map((n) => ({ art: 'notiz', titel: n.title, worum: bereich(n.path), url: `/v2/dokument?vault=${encodeURIComponent(n.path)}`, at: n.mtime ? new Date(n.mtime).toISOString() : null })),
      prs: q.prs.filter((p) => themaVon(null, `${p.repo} ${p.title}`) === name).slice(0, 20).map((p) => { const s = prSicht([p], 'alle', d.githubNames())[0]; return { pr: String(p.pr), titel: kurz(String(p.title ?? ''), 140), url: `/v2/prs/${encodeURIComponent(String(p.repo))}/${p.number}`, satz: s ? (s.wartetAuf.length ? `wartet auf ${s.wartetAuf.join(', ')} — ${s.warum}` : s.warum) : '' }; }),
      roadmap: q.roadmap.filter((x) => x.thema === name).map((x) => ({ titel: x.titel, stand: x.stand, url: `/v2/dokument?vault=${encodeURIComponent(x.path)}` })),
      notizenFrei: !d.gesperrt(u, 'wissen'), prFrei: !d.gesperrt(u, 'roadmap'),
    });
  });

  // --- Alle Chats (S12, C4): Unter-Chats, Hauptchats, LibreChat- und 2.0-Chats — Suche und Filter macht die Oberfläche ---
  // Plan §23 T5: „Von Claude entschieden“ — gesamt und je Unter-Chat (?strand=), neueste zuerst; mit Council-Urteil, wenn es eines gab.
  on('GET', /^\/api\/v2\/entschieden$/, async (req, res, _m, url) => {
    const u = await d.needUser(req);
    if (!d.entschiedenLog) return send(d, res, { zeilen: [] });
    const strand = url.searchParams.get('strand');
    const zeilen = (await d.entschiedenLog(u)).filter((z) => z.durch === 'auto' && (!strand || z.strand?.id === strand))
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    send(d, res, { zeilen });
  });
  // Umkehren mit einem Klick: ohne eigenen Text ein fester Satz; geht über den bestehenden Widerruf an den Unter-Chat (bzw. den Hauptchat).
  on('POST', /^\/api\/v2\/entschieden\/([\w:.-]{1,200})\/umkehren$/, async (req, res, m) => {
    const u = await d.needUser(req);
    if (!admin(u)) throw err(403, 'Umkehren kann nur, wer die Unter-Chats führt.');
    if (!d.umkehren) throw err(501, 'Umkehren ist hier nicht eingerichtet.');
    const b = await d.body(req, 16 * 1024);
    const eigen = String(b.text ?? '').trim().slice(0, 2000);
    await d.umkehren(u, m[1], eigen ? `Umkehren: ${eigen}` : 'Umkehren: Knut nimmt diese Entscheidung zurück — nicht so umsetzen; schon Gebautes zurücknehmen und die Frage an Knut stellen.');
    d.log('v2 umgekehrt', { user: u.id, id: m[1] });
    send(d, res, { ok: true });
  });

  // Knut 05.11. 19:00: „Eine Seite, auf der ich zu jedem Punkt etwas schreiben kann“ — je fertigem Strang eine Karte „Zum Ansehen“.
  on('GET', /^\/api\/v2\/ansehen$/, async (req, res) => {
    const u = await d.needUser(req);
    if (!admin(u)) return send(d, res, { karten: [] });
    const [liste, weg] = await Promise.all([ucListe(u).catch(() => ({ zeilen: [] as any[] })), d.ansehenSpaeter ? d.ansehenSpaeter(u).catch(() => new Set<string>()) : Promise.resolve(new Set<string>())]);
    const fertig = liste.zeilen.filter((z: any) => arbeitGruppe(z) === 'fertig' && !weg.has(String(z.id))).slice(0, 20);
    const karten = await Promise.all(fertig.map(async (z: any) => {
      const k = arbeitKarte(z);
      const doc: any = await d.strang(u, String(z.id)).catch(() => null);
      const kopf = doc?.berichtKopf ?? {};
      const prs = (Array.isArray(kopf.github) ? kopf.github : []).filter((g: any) => g?.pr || /\/pull\/\d+/.test(String(g?.url ?? '')))
        .map((g: any) => { const pr = String(g.pr ?? `${g.repo}#${String(g.url).match(/\/pull\/(\d+)/)?.[1]}`); return { label: `PR ${pr.split('/').pop()}`, url: /^https:\/\/github\.com\//.test(String(g.url ?? '')) ? g.url : `https://github.com/${pr.replace('#', '/pull/')}` }; });
      const weitere = (Array.isArray(kopf.review) ? kopf.review : []).filter((r: any) => r?.url && /^https:\/\//.test(String(r.url))).slice(0, 4).map((r: any) => ({ label: kurz(String(r.titel ?? 'Link'), 40), url: String(r.url) }));
      const f = doc ? fastFertig(dodAus(String(doc.standVoll || doc.lastExcerpt || ''))) : null;
      return { id: k.id, titel: k.titel, thema: k.thema, uhr: k.uhr, satz: f ? `Fast fertig — fehlt: ${f.fehlt.slice(0, 3).join('; ')}.` : k.satz, links: [...k.links, ...prs, ...weitere], ohneBericht: ohneBericht(z) };
    }));
    send(d, res, { karten });
  });
  on('POST', /^\/api\/v2\/ansehen\/([\w-]{1,40})$/, async (req, res, m) => {
    const u = await d.needUser(req);
    if (!admin(u)) throw err(403, 'Nur wer die Unter-Chats führt.');
    if (!d.ansehenAntwort) throw err(501, 'Antworten ist hier nicht eingerichtet.');
    const b = await d.body(req, 16 * 1024);
    const art = String(b?.art ?? '');
    if (!['passt', 'aendern', 'spaeter'].includes(art)) throw err(400, 'Antwort ist Passt, Ändern oder Später.');
    const notiz = String(b?.notiz ?? '').trim().slice(0, 4000);
    if (art === 'aendern' && !notiz) throw err(400, 'Bei „Ändern“ bitte kurz schreiben, was.');
    const z = (await ucListe(u).catch(() => ({ zeilen: [] as any[] }))).zeilen.find((x: any) => String(x.id) === m[1]);
    if (!z) throw err(404, 'Diesen Unter-Chat gibt es nicht (mehr).');
    // Audit 05.11. (5): „fertig“ ohne Bericht ist kein abnehmbarer Stand — nur, wenn Knut es ausdrücklich trotzdem will.
    if (art === 'passt' && ohneBericht(z) && b?.ohneBericht !== true) throw err(409, 'Fertig gemeldet, aber ohne Bericht — erst „Bericht anfordern“, oder ausdrücklich „Trotzdem abnehmen“.');
    await d.ansehenAntwort(u, m[1], art as any, notiz, String(z.titel ?? ''));
    d.log('v2 ansehen', { user: u.id, strand: m[1], art, notiz: notiz.length });
    send(d, res, { ok: true });
  });

  // Plan §24 A4: „Braucht Hauptsitzung“ (Live-Gang nach Commit, Deploy-Go …) als abhakbare Liste aus den Stand-Blöcken.
  on('GET', /^\/api\/v2\/hauptsitzung$/, async (req, res) => {
    const u = await d.needUser(req);
    if (!admin(u)) return send(d, res, { punkte: [] });
    const liste = await ucListe(u).catch(() => ({ zeilen: [] as any[] }));
    const docs = (await Promise.all(liste.zeilen.slice(0, 80).map((z: any) => d.strang(u, String(z.id)).catch(() => null)))).filter(Boolean) as any[];
    const haken = d.hauptsitzungHaken ? await d.hauptsitzungHaken.lesen(u).catch(() => new Set<string>()) : new Set<string>();
    const punkte = hauptsitzungPunkte(docs.map((x) => ({ id: String(x._id), titel: String(x.title ?? ''), stand: String(x.standVoll || x.lastExcerpt || '') })))
      .map((p) => ({ ...p, erledigt: haken.has(p.key) }));
    // Bedarfskanal (Knut 06.11.): was Stränge mit bedarf_melden brauchen — oben, mit Erteilen/Erledigt/Ablehnen.
    const bedarf = d.bedarfListe ? (await d.bedarfListe(u).catch(() => [])).map((x: any) => ({ id: String(x._id), art: x.art, artName: BEDARF_NAME[x.art as keyof typeof BEDARF_NAME] ?? x.art, text: String(x.text ?? ''), pfad: x.pfad ?? null, strang: { id: String(x.strand?.id ?? ''), titel: String(x.strand?.title ?? '') }, at: x.at })) : [];
    send(d, res, { punkte, bedarf });
  });
  on('POST', /^\/api\/v2\/bedarf\/(b-[0-9a-f]{8})$/, async (req, res, m) => {
    const u = await d.needUser(req);
    if (!admin(u)) throw err(403, 'Nur wer die Unter-Chats führt.');
    if (!d.bedarfAntwort) throw err(501, 'Bedarfe beantworten ist hier nicht eingerichtet.');
    const b = await d.body(req, 8 * 1024);
    const antwort = String(b?.antwort ?? '');
    if (!['erteilt', 'erledigt', 'abgelehnt'].includes(antwort)) throw err(400, 'Antwort ist Erteilen, Erledigt oder Ablehnen.');
    const r = await d.bedarfAntwort(u, m[1], { antwort, notiz: String(b?.notiz ?? '').trim().slice(0, 1000), dauerMin: b?.dauerMin != null ? Number(b.dauerMin) : undefined });
    d.log('v2 bedarf', { user: u.id, id: m[1], antwort });
    send(d, res, { ok: true, ...(r as any) });
  });
  on('POST', /^\/api\/v2\/hauptsitzung\/([\w:.%-]{1,160})$/, async (req, res, m) => {
    const u = await d.needUser(req);
    if (!admin(u)) throw err(403, 'Nur wer die Unter-Chats führt.');
    if (!d.hauptsitzungHaken) throw err(501, 'Abhaken ist hier nicht eingerichtet.');
    const b = await d.body(req, 4 * 1024);
    // Gegenprüfung: nur Kennungen der Form <strang>:<hash>, kaputte Kodierung → 400 statt 500.
    let key = '';
    try { key = decodeURIComponent(m[1]); } catch { throw err(400, 'Unbekannte Kennung.'); }
    if (!/^[\w-]{1,40}:[0-9a-z]{1,13}$/.test(key)) throw err(400, 'Unbekannte Kennung.');
    await d.hauptsitzungHaken.setzen(u, key, b?.erledigt !== false);
    send(d, res, { ok: true });
  });

  // Plan §23 T3: der Hauptchat meldet das Ergebnis seines Council-Checks zu einer gewichtigen Frage (CLI `orch council …` ruft das).
  on('POST', /^\/api\/v2\/council$/, async (req, res) => {
    const u = await d.needUser(req);
    if (!admin(u)) throw err(403, 'Nur wer die Unter-Chats führt.');
    if (!d.councilAnwenden) throw err(501, 'Council-Check ist hier nicht eingerichtet.');
    const b = await d.body(req, 16 * 1024);
    const f = fragenAus((await d.inboxFuer(u)).eintraege).fragen.find((x) => x.id === String(b.frage ?? ''));
    if (!f) throw err(404, 'Diese Frage ist nicht (mehr) offen.');
    if (f.triage?.klasse !== 'gewichtig') throw err(409, `Council nur für gewichtige Fragen — diese ist ${f.triage?.klasse ?? 'ohne Klasse'} (${f.triage?.grund ?? ''}).`);
    const c: Council = { urteil: String(b.urteil ?? '') as CouncilUrteil, grund: String(b.grund ?? '').slice(0, 2000), bedingung: b.bedingung ? String(b.bedingung).slice(0, 2000) : null, at: new Date().toISOString() };
    let w: ReturnType<typeof councilWirkung>;
    try { w = councilWirkung({ ...c, empfehlung: f.empfehlung }); } catch (e: any) { throw err(400, String(e?.message ?? e)); }
    await d.councilAnwenden(u, f, c, w);
    d.log('v2 council', { user: u.id, frage: f.id, urteil: c.urteil });
    send(d, res, { ok: true, anzeige: w.anzeige, geschlossen: w.schliessen });
  });

  // Abgleich (h): Volltext über die eigenen Chats — die Seite verbindet die Treffer über `conv` mit „Alle Chats“ (Titel, Link).
  on('GET', /^\/api\/v2\/chats\/suche$/, async (req, res, _m, url) => {
    const u = await d.needUser(req);
    const q = String(url.searchParams.get('q') ?? '').trim().slice(0, 100);
    if (q.length < 3 || !d.lcVolltext) return send(d, res, { treffer: [] });
    const l = await d.lcVolltext(u, q).catch(() => null);
    if (!l) return send(d, res, { treffer: [], fehlt: ['LibreChat'] });
    send(d, res, { treffer: l.map((t) => ({ conv: t.conv, auszug: auszugUm(t.text, q), at: new Date(t.at).toISOString() })) });
  });
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
    const [liste, st, runs] = await Promise.all([ucListe(u), d.zustaende ? d.zustaende(u).catch(() => null) : Promise.resolve(null), d.zustaende ? d.alleRuns(u).catch(() => []) : Promise.resolve([])]);
    const convVon = new Map(runs.map((r: any) => [String(r._id), String(r.conv ?? '')]));
    // Runde 7: was ein laufender Unter-Chat gerade tut, in Klartext — ohne den Chat zu öffnen.
    const k = liste.zeilen.map(arbeitKarte).map((x) => { const s = st?.get(convVon.get(x.id) ?? ''); const j = s?.running ? jetztSatz(s.jetzt) : null; return j ? { ...x, satz: `Jetzt: ${j}` } : s?.queued ? { ...x, satz: `Wartet in der Schlange (Platz ${s.queued.pos}) und startet von selbst.` } : x; });
    const fertig = k.filter((x) => x.gruppe === 'fertig').slice(0, 30);
    const ff = await fastFertigJe(d, u, fertig.map((x) => x.id));   // Runde 7: „fertig“ nur mit DoD-Beleg, sonst „fast fertig“
    send(d, res, { gruppen: { wartet: k.filter((x) => x.gruppe === 'wartet'), laeuft: k.filter((x) => x.gruppe === 'laeuft'), fertig: fertig.map((x) => (ff.has(x.id) ? { ...x, satz: ff.get(x.id)!.satz, fast: true } : x)) }, at: new Date() });
  });

  // --- Runde 7 (Knut: DoD): liegen gebliebene Enden — offene DoD-Zeilen und Folge-Aufgaben fertig gemeldeter Unter-Chats, mit Besitzer ---
  on('GET', /^\/api\/v2\/enden$/, async (req, res) => {
    const u = await d.needUser(req);
    if (!admin(u)) return send(d, res, { enden: [] });
    const liste = await ucListe(u).catch(() => ({ zeilen: [] as any[] }));
    const ids = liste.zeilen.filter((z: any) => arbeitGruppe(z) === 'fertig').map((z: any) => String(z.id));
    const ff = await fastFertigJe(d, u, ids, 200);   // Enden: nicht bei 40 abschneiden (Gegenprüfung R7)
    send(d, res, { enden: endenAus([...ff].map(([id, x]) => ({ id, titel: x.titel, stand: x.stand, fertig: true }))) });
  });
  on('GET', /^\/api\/v2\/arbeit\/([0-9a-f]{8})$/, async (req, res, m) => {
    const u = await d.needUser(req);
    if (!admin(u)) throw err(403, 'Unter-Chats sieht nur, wem sie gehören.');
    const doc = await d.strang(u, m[1]);
    if (!doc) throw err(404, 'Diesen Unter-Chat gibt es nicht (mehr).');
    const [liste, ib] = await Promise.all([ucListe(u).catch(() => ({ zeilen: [] as any[] })), d.inboxFuer(u)]);
    const z = liste.zeilen.find((x: any) => String(x.id) === m[1]);
    const alleFragen = fragenAus(ib.eintraege).fragen;
    const eigeneIds = new Set(fragenJeStrang(ib.eintraege, m[1]).map((f: any) => f.id));
    // Chat-Bereich (Knut 06.11.: „wirklich der normale Chatverlauf“): bis 100 Nachrichten statt 20.
    const nachrichten = doc.conv ? await librechat.lesen(u, String(doc.conv), 100).catch(() => []) : [];
    const stand = standVoll(nachrichten, String(doc.standVoll || doc.lastExcerpt || ''));
    const abgleich = d.abgleich ? await d.abgleich(u, m[1], stand).catch(() => null) : null;
    const jeFrage = new Map((abgleich?.zeilen ?? []).map((z) => [z.qid, `${z.d} · ${z.bericht ? (z.wiederOffen ? 'im Bericht schon entschieden, von dir wieder geöffnet' : 'im Bericht schon entschieden') : 'auch im Bericht offen'}`]));
    const fragen = await mitBezug(d, u, karten(d, alleFragen, ib.eintraege, alleFragen.filter((f) => eigeneIds.has(f.id) && f.klasse !== 'aktion').map((f) => ({ f, grund: jeFrage.get(f.id) ?? 'aus diesem Unter-Chat' }))));
    const links = [
      ...(doc.paket ? [{ label: 'Bericht', url: `/v2/dokument?paket=${encodeURIComponent(doc.paket)}&datei=bericht.md` }] : []),
      ...(/^https?:\/\//.test(String(doc.url ?? '')) ? [{ label: 'Chat in LibreChat öffnen', url: String(doc.url), extern: true }] : []),
    ];
    // Runde 7 (Knut: „Unterchats sind halt etwas intransparent“): der Steckbrief — wofür, jetzt gerade, Fortschritt, wartet auf,
    // Ergebnisse, berührt, Modell/Laufzeit. Quelle: was Brücke und Strang schon melden (Zustand, Stand-Block, Bericht-Kopf).
    const s = d.zustaende && doc.conv ? (await d.zustaende(u).catch(() => null))?.get(String(doc.conv)) ?? null : null;
    const kopf: any = doc.berichtKopf ?? null;
    const auftrag = String(doc.zielLine || String(doc.prompt ?? '').split('\n').map((l: string) => l.replace(/^[#>*\s-]+/, '').trim()).find((l: string) => l.length > 15) || doc.title || '');
    const gh: any[] = Array.isArray(kopf?.github) ? kopf.github : [];
    const steckbrief = {
      wofuer: kurz(auftrag.replace(/\s+/g, ' '), 220), gestartet: doc.startedAt ?? null, ueber: doc.lauf ?? null,
      // Konzept J, J1: wer den Unter-Chat ausführt und warum (sichtbar); fiel jcode auf Claude zurück, steht das hier.
      laeufer: doc.laeufer === 'jcode' ? { wer: s?.laeuferFallback ? 'Claude (jcode lieferte nichts)' : 'jcode (Melious)', grund: s?.laeuferFallback?.grund ?? doc.laeuferGrund ?? null } : null,
      jetzt: s?.running ? (jetztSatz(s.jetzt) ?? standZeile(stand, 'Jetzt') ?? 'arbeitet gerade') : s?.queued ? `wartet in der Schlange (Platz ${s.queued.pos}) und startet von selbst` : standZeile(stand, 'Jetzt'),
      laeuft: !!s?.running, seit: s?.running ? s?.turn?.start ?? null : null,
      schritte: schritteAus(stand), eta: z?.eta ?? null,
      wartetAuf: [...(standZeile(stand, 'Braucht Knut') ? [{ wer: 'dich', was: standZeile(stand, 'Braucht Knut')! }] : []), ...(s?.queued ? [{ wer: 'einen freien Platz', was: `Platz ${s.queued.pos} in der Schlange` }] : [])],
      ergebnisse: [
        ...(doc.paket ? [{ label: 'Bericht', url: `/v2/dokument?paket=${encodeURIComponent(doc.paket)}&datei=bericht.md` }] : []),
        ...(Array.isArray(kopf?.review) ? kopf.review.filter((r: any) => r?.screenshot).slice(0, 6).map((r: any) => ({ label: `Bild: ${String(r.screenshot).split('/').pop()}`, url: doc.paket ? `/api/files/agenten/${encodeURIComponent(doc.paket)}/${String(r.screenshot).split('/').map(encodeURIComponent).join('/')}` : '' })).filter((x: any) => x.url) : []),
        ...gh.filter((g) => /^https:\/\/github\.com\//.test(String(g?.pr ?? ''))).map((g) => ({ label: `PR ${String(g.pr).split('/').slice(-3).join(' ').replace(' pull ', '#')}`, url: String(g.pr), extern: true })),
        ...gh.filter((g) => g?.commit).map((g) => ({ label: `Commit ${String(g.commit).slice(0, 7)} (${String(g.repo ?? '').split('/').pop()})`, url: '' })),
        // Runde 7 (Abgleich): alle Dateien des Pakets — Markdown in der Leseansicht, der Rest als Datei.
        ...(doc.paket && d.paketDateien ? d.paketDateien(String(doc.paket)).filter((f) => f.rel !== 'bericht.md' && !/(^|\/)\./.test(f.rel)).slice(0, 15).map((f) => ({ label: f.rel, url: /\.md$/i.test(f.rel) ? `/v2/dokument?paket=${encodeURIComponent(doc.paket)}&datei=${encodeURIComponent(f.rel)}` : `/api/files/agenten/${encodeURIComponent(doc.paket)}/${f.rel.split('/').map(encodeURIComponent).join('/')}` })) : []),
      ].slice(0, 30),
      beruehrt: { repos: gh.map((g) => `${String(g.repo ?? '').split('/').pop()}${g.zweig ? ` · ${g.zweig}` : ''}`).filter(Boolean), text: standZeile(stand, 'Berührt'), ordner: doc.cwd ? String(doc.cwd).split('/').filter(Boolean).slice(-2).join('/') : null, dateien: (Array.isArray(s?.written) ? s.written as string[] : []).slice(-6).map((f) => f.split('/').pop()) },
      dod: dodAus(stand), fast: z && arbeitGruppe(z) === 'fertig' ? fastFertig(dodAus(stand)) : null,
      modell: s?.turn?.modell ?? doc.lastModell ?? doc.modell ?? null, laufzeitMin: doc.startedAt ? Math.round((Date.now() - new Date(doc.startedAt).getTime()) / 60000) : null, ruhtMin: !s?.running && doc.lastActivity ? Math.max(0, Math.round((Date.now() - new Date(doc.lastActivity).getTime()) / 60000)) : null, zugTokens: s?.zugTokens ?? null,
      // Plan §24 A1: eingereihte Nachrichten — „kommt beim nächsten freien Zug an“.
      eingereiht: (Array.isArray(doc.ausstehend) ? doc.ausstehend : []).map((x: any) => ({ at: x.at, grund: kurz(String(x.grund ?? ''), 160) })),
    };
    // Runde 5 (Knut B1): ist deine Nachricht die letzte im Verlauf, wartet der Unter-Chat auf den Agenten, nicht auf dich.
    const zuletztIch = nachrichten.length > 0 && nachrichten[nachrichten.length - 1].rolle === 'ich' && (!z || !['laeuft', 'schlange'].includes(z.zustand));
    send(d, res, { id: m[1], titel: String(doc.title ?? ''), satz: zuletztIch ? `Deine Nachricht ist zugestellt (${wann2(nachrichten[nachrichten.length - 1].at)}) — der Agent hat noch nicht geantwortet. Du musst nichts tun.` : steckbrief.fast ? `Fast fertig — fehlt: ${steckbrief.fast.fehlt.join('; ')}${steckbrief.fast.wartetAuf.length ? `; wartet auf: ${steckbrief.fast.wartetAuf.join(', ')}` : ''}.` : z ? zustandSatz(z) : 'Fertig und von dir abgenommen.', gruppe: z ? arbeitGruppe(z) : 'fertig', zuletzt: z?.zuletzt ?? doc.statusAt ?? null,
      // Chat-Bereich (Knut 06.11.): was die Steuerknöpfe brauchen — läuft, Schlange mit Grund, Deckel, abgenommen, weggeräumt.
      steuer: { laeuft: !!s?.running, schlange: s?.queued ? { pos: s.queued.pos, grund: String(s.queued.grund ?? '') } : null, gedeckelt: doc.autoStopped ? String(doc.autoStopped.reason ?? 'Deckel erreicht') : null, abgenommen: !!doc.knutReviewedAt, weggeraeumt: doc.reviewedBy === 'auto', ohneBericht: z?.zustand === 'fertig' && !(doc.paket && doc.bericht), modell: doc.lastModell ?? doc.modell ?? null, laeufer: doc.laeufer ?? 'claude' },
      stand, steckbrief, abgleich: abgleich?.widerspruch ? abgleich : null, fragen, nachrichten, links, at: new Date() });
  });

  // --- Runde 7: Nachricht an einen Unter-Chat (nur eigene, nur Admin) — läuft er gerade, wird sie in den Zug nachgereicht ---
  on('POST', /^\/api\/v2\/arbeit\/([0-9a-f]{8})\/nachricht$/, async (req, res, m) => {
    const u = await d.needUser(req);
    if (!admin(u)) throw err(403, 'Unter-Chats sieht nur, wem sie gehören.');
    const b = await d.body(req, 64 * 1024);
    const text = String(b.text ?? '').trim();
    if (!text) throw err(400, 'Was soll der Unter-Chat bekommen?');
    if (text.length > 8000) throw err(400, 'Höchstens 8000 Zeichen.');
    if (!d.nachreichen) throw err(501, 'Nachreichen ist hier nicht eingerichtet.');
    if (!(await d.strang(u, m[1]).catch(() => null))) throw err(404, 'Diesen Unter-Chat gibt es nicht (mehr).');
    await d.nachreichen(u, m[1], text);
    d.log('v2 nachricht', { user: u.id, strand: m[1], zeichen: text.length });
    send(d, res, { ok: true });
  });

  // Chat-Bereich (Knut 06.11.: „die Möglichkeit, den Unterchat zu steuern“): dieselben Wege wie die alte Werkbank (Heute/Lead).
  on('POST', /^\/api\/v2\/arbeit\/([0-9a-f]{8})\/steuern$/, async (req, res, m) => {
    const u = await d.needUser(req);
    if (!admin(u)) throw err(403, 'Unter-Chats steuern nur Admins.');
    if (!d.steuern) throw err(501, 'Steuern ist hier nicht eingerichtet.');
    const aktion = String((await d.body(req, 4 * 1024))?.aktion ?? '');
    if (!STEUER_AKTIONEN.includes(aktion as any)) throw err(400, `Aktion ist eine von: ${STEUER_AKTIONEN.join(', ')}.`);
    if (!(await d.strang(u, m[1]).catch(() => null))) throw err(404, 'Diesen Unter-Chat gibt es nicht (mehr).');
    const r = await d.steuern(u, m[1], aktion as SteuerAktion);
    d.log('v2 steuern', { user: u.id, strand: m[1], aktion });
    send(d, res, { ok: true, ...r });
  });

  // Chat-Bereich (Knut 06.11.: „Anhänge/Datei“): Datei ins Paket des Unter-Chats, der Pfad geht als Nachricht an ihn.
  on('POST', /^\/api\/v2\/arbeit\/([0-9a-f]{8})\/anhang$/, async (req, res, m) => {
    const u = await d.needUser(req);
    if (!admin(u)) throw err(403, 'Unter-Chats bekommen Dateien nur von dem, dem sie gehören.');
    if (!d.anhang) throw err(501, 'Anhänge sind hier nicht eingerichtet.');
    const b = await d.body(req, 12 * 1024 * 1024);
    const buf = Buffer.from(String(b?.inhalt ?? ''), 'base64');
    if (!buf.length) throw err(400, 'Die Datei ist leer.');
    if (buf.length > 8 * 1024 * 1024) throw err(413, 'Höchstens 8 MB je Anhang — größere Dateien in „Meine Dateien“ hochladen.');
    const name = anhangName(String(b?.name ?? ''));
    if (!(await d.strang(u, m[1]).catch(() => null))) throw err(404, 'Diesen Unter-Chat gibt es nicht (mehr).');
    const r = await d.anhang(u, m[1], name, buf, String(b?.text ?? '').trim().slice(0, 4000));
    d.log('v2 anhang', { user: u.id, strand: m[1], name, bytes: buf.length });
    send(d, res, { ok: true, ...r });
  });

  // --- Letzter Stand eines Unter-Chats für „Was ist das?“ (S22, Knut B1) — beim Aufklappen nachgeladen, nicht für jede Karte ---
  on('GET', /^\/api\/v2\/stand\/([0-9a-f]{8})$/, async (req, res, m) => {
    const u = await d.needUser(req);
    if (!admin(u)) throw err(403, 'Unter-Chats sieht nur, wem sie gehören.');
    const doc = await d.strang(u, m[1]);
    if (!doc) throw err(404, 'Diesen Unter-Chat gibt es nicht (mehr).');
    const nachrichten = doc.conv ? await librechat.lesen(u, String(doc.conv), 6).catch(() => []) : [];
    send(d, res, { id: m[1], titel: String(doc.title ?? ''), stand: standVoll(nachrichten, String(doc.standVoll || doc.lastExcerpt || ''), 6000) });
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
    const [rv, fx] = await Promise.all([d.letzteReviews().catch(() => []), d.fixPunkte ? d.fixPunkte().catch(() => []) : Promise.resolve([])]);
    // Knut 05.11. abends (2): „Strang … arbeitet daran“ je PR (nur Admin — Stränge sind Knuts).
    const straenge = admin(u) && d.prStraenge ? await d.prStraenge(u).catch(() => []) : null;
    const zeilen = mitReview(prSicht(live, wer, names).sort((a, b) => Number(a.entwurf) - Number(b.entwurf)), rv, admin(u), fx, await koepfeVon(d)).map((p) => ({ ...p, thema: themaVon(null, `${p.repo} ${p.titel}`),   // Runde 7: jedes Ding trägt sein Thema
      ...(straenge ? { straenge: strangZuPr(straenge, p.repo, p.number) } : {}) }));
    const ohneEntwurf = live.filter((p) => !p.isDraft);
    send(d, res, { wer, ich, personen: [...personen(ohneEntwurf, ich, names), { name: 'alle', anzahl: ohneEntwurf.length }], zeilen, stand: g.sync?.at ?? null, at: new Date() });
  });
  // Knut 05.11. abends (1): Aktion an einem offenen PR — reiht in die Review- bzw. Fix-Schlange ein (Strang startet von selbst).
  // Nie Push/Merge: es gibt nur diese vier Arten; der Fix-Strang pusht wie bisher nur über Prüfung und Freigabe.
  on('POST', /^\/api\/v2\/pr-aktion$/, async (req, res) => {
    const u = await d.needUser(req);
    if (!admin(u)) throw err(403, 'Nur wer die Unter-Chats führt.');
    if (!d.prAktion) throw err(501, 'PR-Aktionen sind hier nicht eingerichtet.');
    const b = await d.body(req, 16 * 1024);
    const art = String(b?.art ?? '');
    if (!['review', 'tief', 'fixen', 'auftrag'].includes(art)) throw err(400, 'Aktion ist Review, Tiefes Review, Fixen oder Auftrag.');
    const text = String(b?.text ?? '').trim().slice(0, 4000);
    if (art === 'auftrag' && !text) throw err(400, 'Schreib kurz, was an diesem PR gemacht werden soll.');
    const pr = String(b?.pr ?? '');
    if (!(await d.livePrs()).map.has(pr)) throw err(404, 'Diesen PR gibt es nicht (mehr) in der Liste offener PRs.');
    const r = await d.prAktion(u, pr, art as any, text);
    d.log('v2 pr-aktion', { user: u.id, pr, art });
    send(d, res, { ok: true, ...r });
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
    // Paket 436 (Knut 04.11.): was nach dem letzten Fix offen geblieben ist — von jedem Reviewer, mit Grund.
    const fx = d.fixPunkte ? (await d.fixPunkte().catch(() => [])).find((f) => String(f.repo).split('/').pop() === m[1] && Number(f.number) === Number(m[2]) && f.punkte) : null;
    send(d, res, {
      fix: fx ? { at: fx.punkte.at ?? null, lesbar: fx.punkte.lesbar !== false, gesamt: Number(fx.punkte.gesamt ?? 0), status: fx.status ?? null,
        offen: (fx.punkte.liste ?? []).filter((x: any) => x.stand === 'offen').map((x: any) => ({ wer: names[String(x.wer ?? '').toLowerCase()] ?? x.wer, art: x.art, wo: x.wo ?? null, text: kurz(String(x.text ?? ''), 300), grund: x.grund ?? null, notiz: x.notiz ?? null })) } : null,
      pr: key, titel: p?.title ?? r?.title ?? key, url: p?.url ?? r?.url ?? null, autor: p ? (names[String(p.author ?? '').toLowerCase()] ?? p.author ?? null) : null,
      offen: !!p, merge: p?.turn?.role === 'merge', wartetAuf: wa?.wartetAuf ?? [], warum: wa?.warum ?? '', entscheidung: p?.reviewDecision ?? null, offeneThreads: p?.openThreads ?? 0,
      verlangt: verlangtVon(p?.reviewDecision, p?.reviews ?? [], names),   // S22 (Christoph B2): wer hat Änderungen verlangt
      reviews: (p?.reviews ?? []).map((x: any) => ({ wer: names[String(x.author ?? '').toLowerCase()] ?? x.author, zustand: x.state, at: x.submittedAt })),
      agent: r ? { ...zuKopf(r, (await koepfeVon(d))?.get(key) ?? null, !!d.prKoepfe), status: r.status, empfehlung: sichtbar ? k?.empfehlung ?? r.empfehlung ?? null : null, text: k?.text ?? null, kurz: k?.text ? kurzurteil(k.text) : null, gepostet: r.posted?.url ?? null, entwurf: !r.posted?.url, at: r.doneAt ?? r.createdAt,
        bericht: admin(u) && r.paket ? `/v2/dokument?paket=${encodeURIComponent(r.paket)}&datei=bericht.md` : null } : null,
      // Knut 05.11. abends (2): „Unter-Chat arbeitet daran“ auch auf der Detailseite (nur Admin).
      ...(admin(u) && d.prStraenge ? { straenge: strangZuPr(await d.prStraenge(u).catch(() => []), String(p?.repo ?? m[1]), Number(m[2])) } : {}),
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
    const notizen = (d.gesperrt(u, 'wissen') ? [] : await d.vaultSuche(q).catch(() => [])).filter((h) => !ROH.test(h.path)).slice(0, 20).map((h) => ({ art: 'notiz', thema: themaVon(null, `${h.path} ${h.title}`), titel: h.title || h.path, worum: h.snippet ? kurz(h.snippet.replace(/<[^>]+>/g, ''), 160) : bereich(h.path), url: `/v2/dokument?vault=${encodeURIComponent(h.path)}`, at: null }));
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
      const [nachrichten, laeuft, eingereiht] = await Promise.all([librechat.lesen(u, h.conv, 30).catch(() => []), d.laeuftChat(u, h.conv).catch(() => false), d.hauptchatEingereiht?.(u).catch(() => []) ?? []]);
      return send(d, res, { ziel, zugang, hauptchat: { url: h.url }, nachrichten, laeuft, eingereiht: eingereiht.map((x) => ({ text: x.text.slice(0, 300), at: x.at })) });
    }
    const conv = url.searchParams.get('conv');
    const liste = await eigen.meineChats(u);
    const nachrichten = conv ? await eigen.verlauf(u, conv, url.searchParams.get('seit') ?? undefined) : [];
    send(d, res, { ziel, zugang, chats: liste, conv: conv ?? null, nachrichten, laeuft: nachrichten.some((x) => x.status === 'laeuft'), vorlagen: (d.vorlagen?.() ?? []).map((v) => ({ name: v.name, label: v.label, beschreibung: v.beschreibung })) });
  });
  on('POST', /^\/api\/v2\/chat$/, async (req, res) => {
    const u = await d.needUser(req);
    const b = await d.body(req, 64 * 1024);
    if (b.ziel === 'hauptchat') {
      if (!admin(u)) throw err(403, 'Den Hauptchat führt nur Knut.');
      const text = eigen.pruefeText(b.text);
      const h = await d.hauptchat(u);
      if (!h) throw err(409, 'Kein Hauptchat aktiv — in der alten Werkbank „Hauptchat starten“.');
      if (hauptchatSendet.has(u.id) || (await d.laeuftChat(u, h.conv).catch(() => true))) {
        // Audit 05.11. (4): einreihen statt 409 — der Takt stellt zu, sobald der Hauptchat frei ist.
        if (!d.hauptchatEinreihen) throw err(409, 'Der Hauptchat arbeitet gerade — dein Text bleibt stehen, schick ihn gleich noch einmal.');
        const wartend = await d.hauptchatEinreihen(u, text);
        d.log('v2 hauptchat eingereiht', { user: u.id, wartend });
        return send(d, res, { ok: true, ziel: 'hauptchat', eingereiht: true, wartend });
      }
      hauptchatSendet.add(u.id);
      let at: Date;
      try { at = await librechat.senden(u, h.conv, text); } finally { hauptchatSendet.delete(u.id); }
      d.log('v2 hauptchat', { user: u.id });
      return send(d, res, { ok: true, ziel: 'hauptchat', at });
    }
    // S22: Vorlage nur per Name — der Text kommt vom Server (librechat.yaml), nie vom Client.
    const v = b.vorlage ? (d.vorlagen?.() ?? []).find((x) => x.name === String(b.vorlage)) : null;
    if (b.vorlage && !v) throw err(400, 'Diese Vorlage gibt es nicht.');
    const r = await eigen.senden(u, { text: b.text, conv: b.conv, vorlage: v ? { name: v.name, prefix: v.prefix } : null }, { bridgeUrl: d.bridgeUrl, token: d.claudeToken, log: d.log });
    send(d, res, { ok: true, ziel: 'eigen', ...r });
  });
}

const send = (d: V2Deps, res: ServerResponse, body: unknown) => d.send(res, 200, body);
const paketDok = (p: { name: string; titel: string; at: number }) => ({ art: 'bericht', thema: themaVon(null, `${p.name} ${p.titel}`), titel: p.titel || p.name.replace(/^\d+-/, '').replace(/-/g, ' '), worum: `Bericht ${p.name.split('-')[0]}`, url: `/v2/dokument?paket=${encodeURIComponent(p.name)}&datei=bericht.md`, at: new Date(p.at).toISOString() });

/** Rohtranskripte und Agenten-Ablagen gehören nicht in die Dokumentliste für Menschen (Persona Lisa). */
const ROH = /\/(raw|00-Inbox)\/|\/_meta\//;
/** Statt Dateipfad ein Bereich in Klartext: „olaf · Product › Produkt-OLAF“. */
const bereich = (p: string) => { const t = p.split('/'); return [t[0], t.slice(1, -1).filter((x) => !/^\d-/.test(x) && x !== '2-Areas').slice(-2).join(' › ')].filter(Boolean).join(' · '); };

/** Neueste Dokumente: Berichte (nur Admin) und zuletzt geänderte Notizen. */
function dokumenteNeu(d: V2Deps, u: User, n: number) {
  const berichte = admin(u) ? d.pakete().filter((p) => p.status !== 'archiv').sort((a, b) => b.at - a.at).slice(0, n).map(paketDok) : [];
  const notizen = (d.gesperrt(u, 'wissen') ? [] : d.vaultNeu(n * 3).filter((x) => !ROH.test(x.path)).slice(0, n)).map((x) => ({ art: 'notiz', thema: themaVon(null, `${x.path} ${x.title}`), titel: x.title || x.path, worum: bereich(x.path), url: `/v2/dokument?vault=${encodeURIComponent(x.path)}`, at: new Date(x.mtime).toISOString() }));
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
