// Deck-Review in der Werkbank 2.0 (docs/plan-deck-review.md): Routen, Datenbank, Rendern und Takt. Regeln in decks.ts.
//  - /api/v2/decks*        hinter der Anmeldung; Anlegen, Senden, Status, Einstellungen, Teil-Links, Rendern nur Admin
//  - /api/deck-teilen*     öffentlich, nur mit Teil-Token (Kopf x-deck-token, bei Bildern ?t=): ein Deck, lesen + kommentieren
//  - /internal/deck/rueckmeldung   Werkzeug deck_rueckmeldung — nur aus dem mit dem Deck verknüpften Unter-Chat
// Datenbank: decks (je Slug), deck_kommentare, deck_links (nur Hash des Tokens). Bilder: <wurzel>/<slug>/<fassung>/s-NN.png.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { Collection } from 'mongodb';
import type { User } from './auth.ts';
import {
  gruppieren, fassungVergleich, deckTitel, slugOk, fassungOk, folienPfad, fassungOrdner, pgmHash, geaendert, statusWechsel, rueckmeldungErlaubt,
  kommentarPruefen, neuesToken, tokenHash, tokenFormOk, linkGueltig, ablaufAus, Fenster, nachrichtAnUnterchat, STATUS_TEXT,
  type Fund, type FundFassung, type Status, type Markierung,
} from './decks.ts';

type Handler = (req: IncomingMessage, res: ServerResponse, m: RegExpMatchArray, url: URL) => Promise<void>;
type On = (method: string, path: RegExp, h: Handler) => void;
const err = (status: number, msg: string) => Object.assign(new Error(msg), { status });

export interface DeckFassung { fassung: string; datei: string; folien: number; hashes: string[]; at: Date }
export interface DeckDoc {
  _id: string; titel: string; owner: string; strand: string | null; auto: boolean; ordner: string | null;
  fassungen: DeckFassung[]; fehlgeschlagen?: string[]; renderFehler?: { fassung: string; text: string; at: Date } | null;
  erstellt: Date; letzterVersand?: Date | null; sendeFehler?: string | null; importiert?: string | null;
}
export interface KommentarDoc {
  _id: string; deck: string; folie: number; fassung: string; text: string; markierung: Markierung | null; autor: string; extern: boolean;
  userId: string | null; linkId: string | null; status: Status; grund: string | null; at: Date; gesendetAt?: Date | null; erledigtIn?: string | null;
  verlauf: { status: Status; at: Date; durch: string; grund?: string | null }[];
}
export interface LinkDoc { _id: string; deck: string; hash: string; name: string; ablauf: Date; widerrufen: Date | null; erstellt: Date; durch: string; genutzt: Date | null; kommentare: number }

export interface DeckDeps {
  needUser: (req: IncomingMessage) => Promise<User>;
  /** Interner Kanal (Werkzeuge der Brücke): Kopf mit WERKBANK_INTERNAL_TOKEN + userId im Körper. */
  intern: (req: IncomingMessage, b: any) => Promise<User>;
  body: (req: IncomingMessage, max?: number) => Promise<any>;
  send: (res: ServerResponse, status: number, body: unknown) => void;
  log: (msg: string, data: Record<string, unknown>) => void;
  col: { decks: () => Collection<DeckDoc>; kommentare: () => Collection<KommentarDoc>; links: () => Collection<LinkDoc> };
  /** Ordner der gerenderten Folien (WERKBANK_DECK_DIR). */
  wurzel: string;
  /** Ablage-Wurzeln, in denen Decks gefunden werden (WERKBANK_DECK_QUELLEN). */
  quellen: string[];
  /** Nachricht an einen Unter-Chat (derselbe Weg wie `orch send`). */
  senden: (u: User, strand: string, text: string) => Promise<unknown>;
  /** Unterhaltung eines Unter-Chats der Person (für die Rückmeldung: nur der verknüpfte darf). */
  strangConv: (u: User, strand: string) => Promise<string | null>;
  userById: (id: string) => Promise<User | null>;
  heute: () => string;
  /** Tests: Rendern und Fund ersetzen. */
  rendern?: (pdfOderPptx: { pdf: string | null; pptx: string | null }, ziel: string) => Promise<{ folien: number; hashes: string[] }>;
  funde?: () => Fund[];
  /** Abstand des automatischen Sendens (Vorgabe 10 min). */
  sendenMs?: number;
}

const admin = (u: User) => u.role === 'ADMIN';
const ALT = { bis: 5 };   // beim Anlegen: die neuesten 5 Fassungen rendern, ältere auf Wunsch
const KOMMENTAR_ID = /^[\w-]{1,40}$/;

// ---------- Fund in der Ablage ----------

const UEBERSPRINGEN = new Set(['node_modules', '.git', '_build', '.cache', '.scratch']);
/** Alle Deck-Dateien unter den Wurzeln (höchstens 4 Ebenen tief, ohne Bau-Ordner); Symlinks, die aus der Wurzel führen, zählen nicht. */
export function ablageScan(wurzeln: string[]): { pfad: string; mtime: number }[] {
  const aus: { pfad: string; mtime: number }[] = [];
  for (const w0 of wurzeln) {
    let w: string; try { w = realpathSync(w0); } catch { continue; }
    const geh = (d: string, tiefe: number) => {
      let l: import('node:fs').Dirent[]; try { l = readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of l) {
        const p = join(d, e.name);
        if (e.isDirectory()) { if (tiefe < 4 && !UEBERSPRINGEN.has(e.name) && !e.name.startsWith('.')) geh(p, tiefe + 1); continue; }
        if (!/_deck_.+\.(pdf|pptx)$/i.test(e.name)) continue;
        try { const r = realpathSync(p); if (!r.startsWith(w + sep)) continue; aus.push({ pfad: r, mtime: statSync(r).mtimeMs }); } catch { /* weg */ }
      }
    };
    geh(w, 0);
  }
  return aus;
}

// ---------- Rendern: pptx → pdf → png (wie render.sh), Hash je Folie aus einem kleinen Graustufenbild ----------

/** Werkzeug finden: Umgebung (WERKBANK_PDFTOPPM / WERKBANK_SOFFICE), dann PATH, dann ~/.local/bin. */
export function werkzeug(name: 'pdftoppm' | 'soffice'): string {
  const env = process.env[`WERKBANK_${name.toUpperCase()}`];
  if (env) return env;
  for (const d of [...String(process.env.PATH ?? '').split(':'), join(homedir(), '.local', 'bin')]) if (d && existsSync(join(d, name))) return join(d, name);
  return name;
}
const lauf = (bin: string, args: string[], ms: number) => new Promise<void>((ok, nein) => execFile(bin, args, { timeout: ms, maxBuffer: 4 << 20 }, (e, _o, se) => (e ? nein(new Error(`${basename(bin)}: ${String(se || e.message).trim().slice(0, 300)}`)) : ok())));

export async function rendernEcht(q: { pdf: string | null; pptx: string | null }, ziel: string): Promise<{ folien: number; hashes: string[] }> {
  mkdirSync(dirname(ziel), { recursive: true });
  const tmp = mkdtempSync(join(dirname(ziel), '.r-'));
  try {
    let pdf = q.pdf;
    if (!pdf && q.pptx) {
      // Eigenes LibreOffice-Profil je Lauf: ein offenes soffice der Person sperrt sonst das Standardprofil.
      await lauf(werkzeug('soffice'), [`-env:UserInstallation=file://${tmp}/lo`, '--headless', '--convert-to', 'pdf', '--outdir', tmp, q.pptx], 180_000);
      pdf = join(tmp, basename(q.pptx).replace(/\.pptx$/i, '.pdf'));
      if (!existsSync(pdf)) throw new Error('LibreOffice hat kein PDF erzeugt.');
    }
    if (!pdf) throw new Error('Keine Quelle.');
    mkdirSync(join(tmp, 'png')); mkdirSync(join(tmp, 'pgm'));
    await lauf(werkzeug('pdftoppm'), ['-r', '110', '-png', pdf, join(tmp, 'png', 's')], 180_000);
    await lauf(werkzeug('pdftoppm'), ['-r', '12', '-gray', pdf, join(tmp, 'pgm', 'h')], 60_000);
    const nr = (n: string) => Number(/-(\d+)\.\w+$/.exec(n)?.[1] ?? 0);
    const pngs = readdirSync(join(tmp, 'png')).filter((n) => n.endsWith('.png')).sort((a, b) => nr(a) - nr(b));
    const pgms = readdirSync(join(tmp, 'pgm')).filter((n) => n.endsWith('.pgm')).sort((a, b) => nr(a) - nr(b));
    if (!pngs.length) throw new Error('Keine Folien im PDF.');
    const aus = join(tmp, 'aus'); mkdirSync(aus);
    for (const n of pngs) renameSync(join(tmp, 'png', n), join(aus, `s-${String(nr(n)).padStart(2, '0')}.png`));
    const hashes = pgms.map((n) => pgmHash(readFileSync(join(tmp, 'pgm', n))) ?? '');
    rmSync(ziel, { recursive: true, force: true });
    renameSync(aus, ziel);
    return { folien: pngs.length, hashes };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

// ---------- Sichten ----------

export const fassungenSortiert = (d: Pick<DeckDoc, 'fassungen'>) => [...(d.fassungen ?? [])].sort((a, b) => fassungVergleich(a.fassung, b.fassung));
const aktuellVon = (d: DeckDoc) => fassungenSortiert(d).at(-1) ?? null;
function kommentarSicht(k: KommentarDoc) {
  return { id: k._id, folie: k.folie, fassung: k.fassung, text: k.text, markierung: k.markierung, autor: k.autor, extern: k.extern, status: k.status, statusText: STATUS_TEXT[k.status], grund: k.grund, at: k.at, gesendetAt: k.gesendetAt ?? null, erledigtIn: k.erledigtIn ?? null };
}
function fassungenSicht(d: DeckDoc) {
  const l = fassungenSortiert(d);
  return l.map((f, i) => ({ fassung: f.fassung, datei: f.datei, folien: f.folien, at: f.at, geaendert: i ? geaendert(l[i - 1].hashes, f.hashes) : null, hashes: f.hashes }));
}

// ---------- Registrierung ----------

export function registerDecks(on: On, d: DeckDeps) {
  const C = d.col;
  const sendenMs = d.sendenMs ?? 10 * 60_000;
  let fundCache: { at: number; l: Fund[] } | null = null;
  const funde = (frisch = false): Fund[] => {
    if (d.funde) return d.funde();
    if (frisch || !fundCache || Date.now() - fundCache.at > 60_000) fundCache = { at: Date.now(), l: gruppieren(ablageScan(d.quellen)) };
    return fundCache.l;
  };
  const fundVon = (slug: string, frisch = false) => funde(frisch).find((f) => f.slug === slug) ?? null;
  const deckOder404 = async (slug: string) => { if (!slugOk(slug)) throw err(404, 'Deck nicht gefunden.'); const x = await C.decks().findOne({ _id: slug }); if (!x) throw err(404, 'Deck nicht gefunden.'); return x; };

  // --- Render-Schlange: ein Lauf zur Zeit (Box schonen), je Deck+Fassung höchstens einmal eingereiht ---
  const schlange: { slug: string; f: FundFassung }[] = [];
  let laeuft: string | null = null;
  const eingereiht = (slug: string) => schlange.filter((x) => x.slug === slug).map((x) => x.f.fassung).concat(laeuft?.startsWith(slug + '/') ? [laeuft.slice(slug.length + 1)] : []);
  const rendern = d.rendern ?? rendernEcht;
  let leer: Promise<void> = Promise.resolve();
  const abarbeiten = async () => {
    while (schlange.length) {
      const { slug, f } = schlange.shift()!;
      laeuft = `${slug}/${f.fassung}`;
      try {
        const r = await rendern({ pdf: f.pdf, pptx: f.pptx }, fassungOrdner(d.wurzel, slug, f.fassung));
        const eintrag: DeckFassung = { fassung: f.fassung, datei: basename(f.pdf ?? f.pptx ?? ''), folien: r.folien, hashes: r.hashes, at: new Date() };
        await C.decks().updateOne({ _id: slug }, { $pull: { fassungen: { fassung: f.fassung } as any, fehlgeschlagen: f.fassung } });
        await C.decks().updateOne({ _id: slug }, { $push: { fassungen: eintrag }, $set: { renderFehler: null } });
        d.log('deck gerendert', { deck: slug, fassung: f.fassung, folien: r.folien });
      } catch (e: any) {
        await C.decks().updateOne({ _id: slug }, { $addToSet: { fehlgeschlagen: f.fassung }, $set: { renderFehler: { fassung: f.fassung, text: String(e?.message ?? e).slice(0, 300), at: new Date() } } }).catch(() => {});
        d.log('deck rendern fehler', { deck: slug, fassung: f.fassung, error: String(e?.message ?? e).slice(0, 200) });
      } finally { laeuft = null; }
    }
  };
  const einreihen = (slug: string, l: FundFassung[]) => {
    const schon = new Set(eingereiht(slug));
    const neu = l.filter((f) => (f.pdf || f.pptx) && !schon.has(f.fassung));
    if (!neu.length) return 0;
    schlange.push(...neu.map((f) => ({ slug, f })));
    if (!laeuft) leer = abarbeiten();
    return neu.length;
  };

  // --- Senden an den Deck-Unter-Chat (Knopf und Takt); je Deck nie zwei Sendungen gleichzeitig ---
  const sendet = new Set<string>();
  const sendeDeck = async (deck: DeckDoc, durch: string): Promise<number> => {
    if (!deck.strand) throw err(409, 'Mit dem Deck ist kein Unter-Chat verknüpft.');
    if (sendet.has(deck._id)) return 0;
    sendet.add(deck._id);
    try {
      const offen = await C.kommentare().find({ deck: deck._id, status: 'offen' }).sort({ at: 1 }).limit(60).toArray();
      if (!offen.length) return 0;
      const u = await d.userById(deck.owner);
      if (!u) throw err(409, 'Die Besitzerin des Decks gibt es nicht mehr.');
      const akt = aktuellVon(deck);
      const text = nachrichtAnUnterchat({ slug: deck._id, titel: deck.titel, fassung: akt?.fassung ?? '?', ordner: deck.ordner ?? '(Ordner der letzten Fassung)', heute: d.heute(), kommentare: offen.map((k) => ({ id: k._id, folie: k.folie, fassung: k.fassung, text: k.text, autor: k.autor, extern: k.extern, markierung: k.markierung })) });
      try { await d.senden(u, deck.strand, text); }
      catch (e: any) { await C.decks().updateOne({ _id: deck._id }, { $set: { sendeFehler: String(e?.message ?? e).slice(0, 200) } }); throw e; }
      const jetzt = new Date();
      await C.kommentare().updateMany({ _id: { $in: offen.map((k) => k._id) }, status: 'offen' }, { $set: { status: 'gesendet', gesendetAt: jetzt }, $push: { verlauf: { status: 'gesendet', at: jetzt, durch } } });
      await C.decks().updateOne({ _id: deck._id }, { $set: { letzterVersand: jetzt, sendeFehler: null } });
      d.log('deck gesendet', { deck: deck._id, strand: deck.strand, n: offen.length, durch });
      return offen.length;
    } finally { sendet.delete(deck._id); }
  };

  // --- Takt (alle 60 s): neue Fassungen in der Ablage rendern; offene Kommentare automatisch senden (höchstens alle 10 min) ---
  const takt = async () => {
    const decks = await C.decks().find({}).toArray();
    const l = decks.length ? funde(true) : [];
    for (const deck of decks) {
      const fund = l.find((f) => f.slug === deck._id);
      const akt = aktuellVon(deck);
      const da = new Set([...(deck.fassungen ?? []).map((f) => f.fassung), ...(deck.fehlgeschlagen ?? [])]);
      // nur NEUERE Fassungen als die aktuelle — ältere aus der Ablage rendert man auf Wunsch (Knopf), nicht von selbst
      const neu = (fund?.fassungen ?? []).filter((f) => !da.has(f.fassung) && (!akt || fassungVergleich(f.fassung, akt.fassung) > 0));
      if (neu.length) einreihen(deck._id, neu);
      if (deck.auto && deck.strand && (!deck.letzterVersand || Date.now() - new Date(deck.letzterVersand).getTime() >= sendenMs)) {
        await sendeDeck(deck, 'automatisch').catch((e) => d.log('deck senden fehler', { deck: deck._id, error: String(e?.message ?? e).slice(0, 200) }));
      }
    }
  };

  // ======== Routen mit Anmeldung ========

  on('GET', /^\/api\/v2\/decks$/, async (req, res) => {
    const u = await d.needUser(req);
    const decks = await C.decks().find({}).toArray();
    const zahlen = new Map<string, Record<string, number>>();
    for (const z of await C.kommentare().aggregate<{ _id: { deck: string; status: string }; n: number }>([{ $group: { _id: { deck: '$deck', status: '$status' }, n: { $sum: 1 } } }]).toArray()) {
      const m = zahlen.get(z._id.deck) ?? {}; m[z._id.status] = z.n; zahlen.set(z._id.deck, m);
    }
    const l = funde();
    const angelegt = decks.map((x) => {
      const akt = aktuellVon(x);
      const fund = l.find((f) => f.slug === x._id);
      return { slug: x._id, titel: x.titel, angelegt: true, aktuell: akt?.fassung ?? null, fassungen: fassungenSortiert(x).map((f) => f.fassung), folien: akt?.folien ?? 0, zahlen: zahlen.get(x._id) ?? {}, auto: x.auto, unterchat: !!x.strand, at: akt?.at ?? x.erstellt, inAblage: fund?.fassungen.map((f) => f.fassung) ?? [] };
    }).sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const da = new Set(decks.map((x) => x._id));
    const ablage = l.filter((f) => !da.has(f.slug)).sort((a, b) => b.mtime - a.mtime).slice(0, 80)
      .map((f) => ({ slug: f.slug, titel: deckTitel(f.slug), angelegt: false, fassungen: f.fassungen.map((x) => x.fassung), aktuell: f.fassungen.at(-1)?.fassung ?? null, at: new Date(f.mtime) }));
    d.send(res, 200, { decks: angelegt, ablage, admin: admin(u) });
  });

  on('POST', /^\/api\/v2\/decks$/, async (req, res) => {
    const u = await d.needUser(req);
    if (!admin(u)) throw err(403, 'Nur für Admins.');
    const b = await d.body(req, 4096);
    const slug = String(b.slug ?? '');
    const strand = b.unterchat ? String(b.unterchat) : null;
    if (strand && !/^[0-9a-f]{8}$/.test(strand)) throw err(400, 'Unter-Chat: 8-stellige Kennung.');
    const fund = slugOk(slug) ? fundVon(slug, true) : null;
    if (!fund) throw err(404, 'Kein Deck mit diesem Namen in der Ablage.');
    const neueste = fund.fassungen.at(-1)!;
    const doc: DeckDoc = { _id: slug, titel: deckTitel(slug), owner: u.id, strand, auto: !!strand, ordner: dirname(neueste.pdf ?? neueste.pptx!), fassungen: [], fehlgeschlagen: [], renderFehler: null, erstellt: new Date(), letzterVersand: null, sendeFehler: null };
    const r = await C.decks().updateOne({ _id: slug }, { $setOnInsert: doc }, { upsert: true });
    if (!r.upsertedCount) throw err(409, 'Das Deck ist schon angelegt.');
    const n = einreihen(slug, fund.fassungen.slice(-ALT.bis));
    d.log('deck angelegt', { deck: slug, user: u.id, strand, rendern: n });
    d.send(res, 200, { ok: true, slug, rendern: n });
  });

  on('GET', /^\/api\/v2\/decks\/([a-z0-9-]{1,81})$/, async (req, res, m) => {
    const u = await d.needUser(req);
    const deck = await deckOder404(m[1]);
    const kommentare = await C.kommentare().find({ deck: deck._id }).sort({ at: 1 }).limit(2000).toArray();
    const fund = fundVon(deck._id);
    const da = new Set(deck.fassungen.map((f) => f.fassung));
    const basis = { slug: deck._id, titel: deck.titel, aktuell: aktuellVon(deck)?.fassung ?? null, fassungen: fassungenSicht(deck), kommentare: kommentare.map(kommentarSicht), rendern: eingereiht(deck._id), renderFehler: deck.renderFehler ?? null, admin: admin(u) };
    if (!admin(u)) return d.send(res, 200, basis);
    const links = await C.links().find({ deck: deck._id }).sort({ erstellt: -1 }).limit(50).toArray();
    d.send(res, 200, {
      ...basis, unterchat: deck.strand, auto: deck.auto, ordner: deck.ordner, letzterVersand: deck.letzterVersand ?? null, sendeFehler: deck.sendeFehler ?? null,
      naechsterVersand: deck.auto && deck.strand ? new Date(Math.max(Date.now(), new Date(deck.letzterVersand ?? 0).getTime() + sendenMs)) : null,
      weitereInAblage: (fund?.fassungen ?? []).filter((f) => !da.has(f.fassung)).map((f) => f.fassung),
      links: links.map((l) => ({ id: l._id, name: l.name, ablauf: l.ablauf, widerrufen: l.widerrufen, erstellt: l.erstellt, genutzt: l.genutzt, kommentare: l.kommentare, gueltig: linkGueltig(l) })),
    });
  });

  const bildSenden = (res: ServerResponse, p: string | null) => {
    if (!p || !existsSync(p)) throw err(404, 'Folie nicht gefunden.');
    res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' });
    createReadStream(p).pipe(res);
  };
  on('GET', /^\/api\/v2\/decks\/([a-z0-9-]{1,81})\/bild\/([\w.-]{1,40})\/(\d{1,3})$/, async (req, res, m) => {
    await d.needUser(req);
    const deck = await deckOder404(m[1]);
    if (!deck.fassungen.some((f) => f.fassung === m[2])) throw err(404, 'Folie nicht gefunden.');
    bildSenden(res, folienPfad(d.wurzel, deck._id, m[2], Number(m[3])));
  });

  /** Kommentar anlegen (angemeldet oder extern) — gemeinsame Prüfung. */
  const kommentarAnlegen = async (deck: DeckDoc, b: any, wer: { autor: string; extern: boolean; userId: string | null; linkId: string | null; notiz: boolean }) => {
    const k = kommentarPruefen(b);
    if ('fehler' in k) throw err(400, k.fehler);
    const fassungen = fassungenSortiert(deck);
    const fassung = fassungOk(b.fassung) && fassungen.some((f) => f.fassung === b.fassung) ? b.fassung : fassungen.at(-1)?.fassung ?? '?';
    const n = fassungen.find((f) => f.fassung === fassung)?.folien ?? 0;
    if (k.folie > n) throw err(400, 'Diese Folie gibt es in der Fassung nicht.');
    const jetzt = new Date();
    const status: Status = wer.notiz ? 'notiz' : 'offen';
    const doc: KommentarDoc = { _id: `k-${randomBytes(4).toString('hex')}`, deck: deck._id, folie: k.folie, fassung, text: k.text, markierung: k.markierung, autor: wer.autor, extern: wer.extern, userId: wer.userId, linkId: wer.linkId, status, grund: null, at: jetzt, verlauf: [{ status, at: jetzt, durch: wer.autor }] };
    await C.kommentare().insertOne(doc);
    return doc;
  };

  on('POST', /^\/api\/v2\/decks\/([a-z0-9-]{1,81})\/kommentar$/, async (req, res, m) => {
    const u = await d.needUser(req);
    const deck = await deckOder404(m[1]);
    const b = await d.body(req, 20_000);
    const k = await kommentarAnlegen(deck, b, { autor: String(u.name || u.email).split(/\s+/)[0].slice(0, 40), extern: false, userId: u.id, linkId: null, notiz: b.notiz === true });
    d.send(res, 200, { ok: true, kommentar: kommentarSicht(k) });
  });

  on('POST', /^\/api\/v2\/decks\/([a-z0-9-]{1,81})\/kommentar\/([\w-]{1,40})$/, async (req, res, m) => {
    const u = await d.needUser(req);
    if (!admin(u)) throw err(403, 'Nur für Admins.');
    const deck = await deckOder404(m[1]);
    const b = await d.body(req, 4096);
    const k = await C.kommentare().findOne({ _id: m[2], deck: deck._id });
    if (!k) throw err(404, 'Kommentar nicht gefunden.');
    const neu = String(b.status ?? '') as Status, grund = String(b.grund ?? '').trim().slice(0, 500);
    const f = statusWechsel(k.status, neu, grund);
    if (f) throw err(400, f);
    const jetzt = new Date();
    // Compare-and-Set auf den alten Status: zwei Klicks (oder Klick + Rückmeldung) überschreiben sich nicht still
    const r = await C.kommentare().updateOne({ _id: k._id, status: k.status }, { $set: { status: neu, grund: neu === 'abgelehnt' ? grund : neu === 'umgesetzt' ? grund || null : null, ...(neu === 'offen' ? { gesendetAt: null, erledigtIn: null } : {}) }, $push: { verlauf: { status: neu, at: jetzt, durch: String(u.name || u.email).split(/\s+/)[0], grund: grund || null } } });
    if (!r.modifiedCount && k.status !== neu) throw err(409, 'Der Kommentar wurde gerade geändert — Seite neu laden.');
    d.send(res, 200, { ok: true });
  });

  on('POST', /^\/api\/v2\/decks\/([a-z0-9-]{1,81})\/senden$/, async (req, res, m) => {
    const u = await d.needUser(req);
    if (!admin(u)) throw err(403, 'Nur für Admins.');
    const deck = await deckOder404(m[1]);
    const n = await sendeDeck(deck, String(u.name || u.email).split(/\s+/)[0]);
    d.send(res, 200, { ok: true, gesendet: n });
  });

  on('POST', /^\/api\/v2\/decks\/([a-z0-9-]{1,81})\/einstellungen$/, async (req, res, m) => {
    const u = await d.needUser(req);
    if (!admin(u)) throw err(403, 'Nur für Admins.');
    const deck = await deckOder404(m[1]);
    const b = await d.body(req, 4096);
    const set: Partial<DeckDoc> = {};
    if (typeof b.auto === 'boolean') set.auto = b.auto;
    if ('unterchat' in b) {
      const s = b.unterchat ? String(b.unterchat) : null;
      if (s && !/^[0-9a-f]{8}$/.test(s)) throw err(400, 'Unter-Chat: 8-stellige Kennung.');
      set.strand = s;
    }
    await C.decks().updateOne({ _id: deck._id }, { $set: set });
    d.send(res, 200, { ok: true });
  });

  on('POST', /^\/api\/v2\/decks\/([a-z0-9-]{1,81})\/rendern$/, async (req, res, m) => {
    const u = await d.needUser(req);
    if (!admin(u)) throw err(403, 'Nur für Admins.');
    const deck = await deckOder404(m[1]);
    const b = await d.body(req, 4096);
    const fund = fundVon(deck._id, true);
    if (!fund) throw err(404, 'Das Deck liegt nicht mehr in der Ablage.');
    // ohne Angabe: alles, was in der Ablage liegt und noch nicht gerendert ist; mit fassung: genau diese (auch erneut)
    const l = fassungOk(b.fassung) ? fund.fassungen.filter((f) => f.fassung === b.fassung) : fund.fassungen.filter((f) => !deck.fassungen.some((x) => x.fassung === f.fassung));
    if (fassungOk(b.fassung) && !l.length) throw err(404, 'Diese Fassung liegt nicht in der Ablage.');
    const n = einreihen(deck._id, l);
    d.send(res, 200, { ok: true, rendern: n });
  });

  on('POST', /^\/api\/v2\/decks\/([a-z0-9-]{1,81})\/links$/, async (req, res, m) => {
    const u = await d.needUser(req);
    if (!admin(u)) throw err(403, 'Nur für Admins.');
    const deck = await deckOder404(m[1]);
    const b = await d.body(req, 4096);
    const token = neuesToken();
    const l: LinkDoc = { _id: `l-${randomBytes(4).toString('hex')}`, deck: deck._id, hash: tokenHash(token), name: String(b.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40), ablauf: ablaufAus(b.tage), widerrufen: null, erstellt: new Date(), durch: u.id, genutzt: null, kommentare: 0 };
    await C.links().insertOne(l);
    d.log('deck link angelegt', { deck: deck._id, link: l._id, ablauf: l.ablauf.toISOString() });
    // das Token gibt es nur in dieser Antwort — gespeichert ist nur sein Hash
    d.send(res, 200, { ok: true, id: l._id, token, ablauf: l.ablauf });
  });

  on('POST', /^\/api\/v2\/decks\/([a-z0-9-]{1,81})\/links\/(l-[0-9a-f]{8})\/widerrufen$/, async (req, res, m) => {
    const u = await d.needUser(req);
    if (!admin(u)) throw err(403, 'Nur für Admins.');
    const r = await C.links().updateOne({ _id: m[2], deck: m[1], widerrufen: null }, { $set: { widerrufen: new Date() } });
    d.log('deck link widerrufen', { deck: m[1], link: m[2], n: r.modifiedCount });
    d.send(res, 200, { ok: true, widerrufen: r.modifiedCount });
  });

  // ======== Öffentlich: Teil-Link ========

  const fehlversuche = new Fenster(60, 10 * 60_000);
  const kommentarFenster = new Fenster(30, 10 * 60_000);
  const abrufFenster = new Fenster(1500, 10 * 60_000);
  const adresse = (req: IncomingMessage) => String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress || '?';
  /** Link zum Token — nur gültige; Fehlversuche je Adresse gedeckelt. Immer dieselbe Antwort, egal ob unbekannt, abgelaufen oder widerrufen. */
  const linkVon = async (req: IncomingMessage, token: unknown): Promise<{ link: LinkDoc; deck: DeckDoc }> => {
    const ip = adresse(req);
    const nein = () => { if (!fehlversuche.erlaubt(ip)) throw err(429, 'Zu viele Versuche — bitte später noch einmal.'); return err(404, 'Dieser Link gilt nicht (mehr). Bitte frag nach einem neuen.'); };
    if (!tokenFormOk(token)) throw nein();
    const link = await C.links().findOne({ hash: tokenHash(token) });
    if (!link || !linkGueltig(link)) throw nein();
    if (!abrufFenster.erlaubt(link._id)) throw err(429, 'Zu viele Abrufe — bitte kurz warten.');
    const deck = await C.decks().findOne({ _id: link.deck });
    if (!deck) throw nein();
    return { link, deck };
  };

  on('GET', /^\/api\/deck-teilen$/, async (req, res) => {
    const { link, deck } = await linkVon(req, req.headers['x-deck-token']);
    const kommentare = await C.kommentare().find({ deck: deck._id }).sort({ at: 1 }).limit(2000).toArray();
    // extern: keine Kennungen der Personen/Links, kein Unter-Chat, keine Links
    d.send(res, 200, { slug: deck._id, titel: deck.titel, aktuell: aktuellVon(deck)?.fassung ?? null, fassungen: fassungenSicht(deck).map(({ hashes: _h, datei: _d, ...f }) => f), kommentare: kommentare.map(kommentarSicht), name: link.name, ablauf: link.ablauf });
  });

  on('GET', /^\/api\/deck-teilen\/bild\/([\w.-]{1,40})\/(\d{1,3})$/, async (req, res, m, url) => {
    const { deck } = await linkVon(req, url.searchParams.get('t'));
    if (!deck.fassungen.some((f) => f.fassung === m[1])) throw err(404, 'Folie nicht gefunden.');
    bildSenden(res, folienPfad(d.wurzel, deck._id, m[1], Number(m[2])));
  });

  on('POST', /^\/api\/deck-teilen\/kommentar$/, async (req, res) => {
    if (req.headers['x-werkbank'] !== '1') throw err(403, 'Fehlender Kopf.');
    const { link, deck } = await linkVon(req, req.headers['x-deck-token']);
    if (!kommentarFenster.erlaubt(link._id)) throw err(429, 'Zu viele Kommentare in kurzer Zeit — bitte in ein paar Minuten noch einmal.');
    const b = await d.body(req, 20_000);
    const name = String(b.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (name.length < 2) throw err(400, 'Bitte gib deinen Namen an.');
    const k = await kommentarAnlegen(deck, b, { autor: name, extern: true, userId: null, linkId: link._id, notiz: false });
    await C.links().updateOne({ _id: link._id }, { $set: { genutzt: new Date() }, $inc: { kommentare: 1 } });
    d.log('deck kommentar extern', { deck: deck._id, link: link._id, folie: k.folie });
    d.send(res, 200, { ok: true, kommentar: kommentarSicht(k) });
  });

  // ======== Intern: Rückmeldung des Deck-Unter-Chats (Werkzeug deck_rueckmeldung) ========

  on('POST', /^\/internal\/deck\/rueckmeldung$/, async (req, res) => {
    const b = await d.body(req, 1 << 16);
    const u = await d.intern(req, b);
    const deck = await deckOder404(String(b.deck ?? ''));
    if (!deck.strand) throw err(409, 'Mit dem Deck ist kein Unter-Chat verknüpft.');
    // nur der verknüpfte Unter-Chat (seine Unterhaltung) — nicht irgendein anderer Chat derselben Person
    const conv = await d.strangConv(u, deck.strand);
    if (!conv || String(b.conv ?? '') !== conv) throw err(403, 'Nur der mit dem Deck verknüpfte Unter-Chat darf zurückmelden.');
    const eintraege: any[] = Array.isArray(b.eintraege) ? b.eintraege.slice(0, 60) : [b];
    const ergebnis: { id: string; ok: boolean; fehler?: string }[] = [];
    for (const e of eintraege) {
      const id = String(e?.id ?? '').replace(/^\[|\]$/g, ''), status = String(e?.status ?? ''), grund = String(e?.grund ?? '').trim().slice(0, 500);
      const fassung = fassungOk(e?.fassung) ? e.fassung : null;
      if (!KOMMENTAR_ID.test(id)) { ergebnis.push({ id, ok: false, fehler: 'Kennung ungültig.' }); continue; }
      const k = await C.kommentare().findOne({ _id: id, deck: deck._id });
      if (!k) { ergebnis.push({ id, ok: false, fehler: 'Kommentar nicht gefunden.' }); continue; }
      if (!rueckmeldungErlaubt(k.status, status)) { ergebnis.push({ id, ok: false, fehler: `Kommentar ist „${STATUS_TEXT[k.status]}“ — Rückmeldung nur zu gesendeten, nur umgesetzt/abgelehnt.` }); continue; }
      const f = statusWechsel(k.status, status as Status, grund);
      if (f) { ergebnis.push({ id, ok: false, fehler: f }); continue; }
      const jetzt = new Date();
      await C.kommentare().updateOne({ _id: k._id, status: k.status }, { $set: { status: status as Status, grund: grund || null, erledigtIn: fassung }, $push: { verlauf: { status: status as Status, at: jetzt, durch: 'Unter-Chat', grund: grund || null } } });
      ergebnis.push({ id, ok: true });
    }
    d.log('deck rueckmeldung', { deck: deck._id, n: ergebnis.length, ok: ergebnis.filter((x) => x.ok).length });
    d.send(res, 200, { ok: ergebnis.every((x) => x.ok), ergebnis });
  });

  return { takt, sendeDeck, einreihen, warten: () => leer, funde };
}

/** Indizes (beim Start; idempotent). */
export async function deckIndizes(c: DeckDeps['col']) {
  await Promise.all([
    c.kommentare().createIndex({ deck: 1, at: 1 }),
    c.kommentare().createIndex({ deck: 1, status: 1 }),
    c.links().createIndex({ hash: 1 }, { unique: true }),
    c.links().createIndex({ deck: 1, erstellt: -1 }),
  ]);
}

