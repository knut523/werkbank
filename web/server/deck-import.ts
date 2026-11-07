// Deck-Review (docs/plan-deck-review.md): die drei Nebenserver (~/work/knut/deck-review, -flex, -wirt) in die Werkbank übernehmen —
// Deck (Slug aus stand.json), gerenderte Fassungen (slides/<fassung>/s-*.png), Kommentare (kommentare.json) und den Unter-Chat
// aus weiterleiter.sh. Vorgabe ist der TROCKENLAUF: er zeigt nur, was übernommen würde, und schreibt nichts.
//
//   node server/deck-import.ts [--schreiben] [--owner E-Mail] [Ordner …]
//
// Ohne Ordner: die drei bekannten. Wiederholbar: Kommentare über feste Kennungen (nur neu einfügen, nie überschreiben — Status,
// die in der Werkbank schon geändert wurden, bleiben), Fassungen nur, wenn sie fehlen. Ein Deck, das in der Werkbank ohne Import
// angelegt wurde, bekommt nur fehlende Fassungen und die Kommentare dazu.
import { readFileSync, readdirSync, existsSync, mkdirSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import type { Collection } from 'mongodb';
import { dateiLesen, deckTitel, fassungOk, fassungVergleich, pgmHash, slugOk, type Fund, type Status } from './decks.ts';
import type { DeckDoc, KommentarDoc, DeckFassung } from './deckroutes.ts';

export interface AltDeck {
  ordner: string; slug: string; titel: string; strand: string | null; fassungen: { fassung: string; bilder: string[] }[];
  kommentare: KommentarDoc[]; warnungen: string[];
}

const STATUS_ALT: Record<string, Status> = { neu: 'offen', gesendet: 'gesendet', erledigt: 'umgesetzt', notiz: 'notiz' };
const lies = (p: string, vorgabe: any) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return vorgabe; } };

/** Eine alte Instanz lesen (nur lesen). funde: Ablage-Funde — für das Datum der Fassung (Uhrzeit steht im Kommentar). */
export function altLesen(ordner: string, funde: Fund[] = []): AltDeck | { ordner: string; fehler: string } {
  const stand = lies(join(ordner, 'stand.json'), null);
  if (!stand?.datei) return { ordner, fehler: 'stand.json fehlt oder ohne Datei' };
  const info = dateiLesen(String(stand.datei));
  if (!info) return { ordner, fehler: `Dateiname nicht nach Ablage-Konvention: ${stand.datei}` };
  const slug = info.slug;
  const warnungen: string[] = [];
  const strand = /orch['"]?\s*,\s*['"]send['"]\s*,\s*['"]([0-9a-f]{8})['"]/.exec(existsSync(join(ordner, 'weiterleiter.sh')) ? readFileSync(join(ordner, 'weiterleiter.sh'), 'utf8') : '')?.[1] ?? null;
  if (!strand) warnungen.push('kein Unter-Chat in weiterleiter.sh gefunden');
  const fassungen: AltDeck['fassungen'] = [];
  const slides = join(ordner, 'slides');
  for (const f of existsSync(slides) ? readdirSync(slides) : []) {
    if (!fassungOk(f)) { warnungen.push(`Fassung „${f}“ übersprungen (Name)`); continue; }
    const bilder = readdirSync(join(slides, f)).filter((n) => /^s-\d+\.png$/.test(n)).sort((a, b) => Number(/\d+/.exec(a)![0]) - Number(/\d+/.exec(b)![0]));
    if (bilder.length) fassungen.push({ fassung: f, bilder: bilder.map((n) => join(slides, f, n)) });
  }
  fassungen.sort((a, b) => fassungVergleich(a.fassung, b.fassung));
  const fund = funde.find((x) => x.slug === slug);
  const tagVon = (f: string) => fund?.fassungen.find((x) => x.fassung === f)?.datum ?? info.datum;
  const kurz = createHash('md5').update(slug).digest('hex').slice(0, 6);
  const kommentare: KommentarDoc[] = (lies(join(ordner, 'kommentare.json'), []) as any[]).filter((x) => x && x.text).map((x) => {
    const status = STATUS_ALT[String(x.status)] ?? 'offen';
    const fassung = fassungOk(x.fassung) ? x.fassung : info.fassung;
    const zeit = /^\d{2}:\d{2}$/.test(String(x.zeit)) ? x.zeit : '12:00';
    const at = new Date(`${tagVon(fassung)}T${zeit}:00+01:00`);   // Wiener Zeit (November: MEZ)
    const autor = String(x.autor || 'Knut').slice(0, 40);
    return {
      _id: `k-alt-${kurz}-${Number(x.id) || 0}`, deck: slug, folie: Number.isInteger(x.folie) && x.folie >= 0 ? x.folie : 0, fassung, text: String(x.text).slice(0, 4000),
      markierung: null, autor, extern: autor !== 'Knut', userId: null, linkId: null, status, grund: null, at,
      gesendetAt: status === 'gesendet' || status === 'umgesetzt' ? at : null, erledigtIn: status === 'umgesetzt' && fassungOk(x.umgesetzt_in) ? x.umgesetzt_in : null,
      verlauf: [{ status, at, durch: 'Import' }],
    };
  });
  if (new Set(kommentare.map((k) => k._id)).size !== kommentare.length) warnungen.push('doppelte Kommentar-Nummern — nur der erste je Nummer wird übernommen');
  return { ordner, slug, titel: deckTitel(slug), strand, fassungen, kommentare, warnungen };
}

/** Trockenlauf-Text: was übernommen würde (und was schon da ist). */
export function planText(alt: (AltDeck | { ordner: string; fehler: string })[], vorhanden: Map<string, { fassungen: string[]; kommentare: Set<string> }>): string {
  const z: string[] = [];
  for (const a of alt) {
    if ('fehler' in a) { z.push(`✗ ${a.ordner}: ${a.fehler} — übersprungen`); continue; }
    const v = vorhanden.get(a.slug);
    const neueF = a.fassungen.filter((f) => !v?.fassungen.includes(f.fassung));
    const neueK = a.kommentare.filter((k) => !v?.kommentare.has(k._id));
    const je = new Map<string, number>(); for (const k of neueK) je.set(k.status, (je.get(k.status) ?? 0) + 1);
    z.push(`${v ? '↻' : '+'} ${a.slug} („${a.titel}“) aus ${a.ordner}`);
    z.push(`    Unter-Chat: ${a.strand ?? '—'} · ${v ? 'schon angelegt' : 'neu'}`);
    z.push(`    Fassungen: ${neueF.length} neu (${neueF.map((f) => `${f.fassung}:${f.bilder.length}`).join(', ') || '—'})${v ? `, ${a.fassungen.length - neueF.length} schon da` : ''}`);
    z.push(`    Kommentare: ${neueK.length} neu${neueK.length ? ` (${[...je].map(([s, n]) => `${n} ${s}`).join(', ')})` : ''}${v ? `, ${a.kommentare.length - neueK.length} schon da` : ''}`);
    for (const w of a.warnungen) z.push(`    ! ${w}`);
  }
  return z.join('\n');
}

const pdfHashes = (pdf: string): Promise<string[]> => new Promise((ok) => {
  const tmp = mkdtempSync(join(tmpdir(), 'deckimport-'));
  execFile(process.env.WERKBANK_PDFTOPPM || (existsSync(join(homedir(), '.local/bin/pdftoppm')) ? join(homedir(), '.local/bin/pdftoppm') : 'pdftoppm'), ['-r', '12', '-gray', pdf, join(tmp, 'h')], { timeout: 60_000 }, (e) => {
    try { ok(e ? [] : readdirSync(tmp).filter((n) => n.endsWith('.pgm')).sort((a, b) => Number(/(\d+)\.pgm$/.exec(a)![1]) - Number(/(\d+)\.pgm$/.exec(b)![1])).map((n) => pgmHash(readFileSync(join(tmp, n))) ?? '')); }
    finally { rmSync(tmp, { recursive: true, force: true }); }
  });
});

/** Übernehmen: Bilder kopieren (s-NN.png), Fassungen mit Hash (aus dem PDF der Ablage, falls da), Deck anlegen/ergänzen, Kommentare einfügen. */
export async function schreiben(a: AltDeck, d: { col: { decks: () => Collection<DeckDoc>; kommentare: () => Collection<KommentarDoc> }; wurzel: string; owner: string; funde: Fund[]; hashes?: (pdf: string) => Promise<string[]> }) {
  if (!slugOk(a.slug)) throw new Error(`Slug ungültig: ${a.slug}`);
  const vorhanden = await d.col.decks().findOne({ _id: a.slug });
  const da = new Set((vorhanden?.fassungen ?? []).map((f) => f.fassung));
  const fund = d.funde.find((x) => x.slug === a.slug);
  const neu: DeckFassung[] = [];
  for (const f of a.fassungen.filter((x) => !da.has(x.fassung))) {
    const ziel = join(resolve(d.wurzel), a.slug, f.fassung);
    mkdirSync(ziel, { recursive: true });
    f.bilder.forEach((p, i) => copyFileSync(p, join(ziel, `s-${String(i + 1).padStart(2, '0')}.png`)));
    const quelle = fund?.fassungen.find((x) => x.fassung === f.fassung);
    const hashes = quelle?.pdf ? await (d.hashes ?? pdfHashes)(quelle.pdf) : [];
    neu.push({ fassung: f.fassung, datei: basename(quelle?.pdf ?? quelle?.pptx ?? `${a.slug}_${f.fassung}`), folien: f.bilder.length, hashes: hashes.length === f.bilder.length ? hashes : [], at: new Date() });
  }
  const neuste = fund?.fassungen.at(-1);
  if (!vorhanden) {
    await d.col.decks().insertOne({ _id: a.slug, titel: a.titel, owner: d.owner, strand: a.strand, auto: !!a.strand, ordner: neuste ? dirname(neuste.pdf ?? neuste.pptx!) : null, fassungen: neu, fehlgeschlagen: [], renderFehler: null, erstellt: new Date(), letzterVersand: null, sendeFehler: null, importiert: a.ordner });
  } else if (neu.length) {
    await d.col.decks().updateOne({ _id: a.slug }, { $push: { fassungen: { $each: neu } } });
  }
  let kommentare = 0;
  for (const k of a.kommentare) {
    const r = await d.col.kommentare().updateOne({ _id: k._id }, { $setOnInsert: k }, { upsert: true });
    kommentare += r.upsertedCount;
  }
  return { slug: a.slug, angelegt: !vorhanden, fassungen: neu.length, kommentare };
}

export const ALTE_ORDNER = ['deck-review', 'deck-review-flex', 'deck-review-wirt'].map((n) => join(homedir(), 'work', 'knut', n));

// ---------- Aufruf von der Kommandozeile ----------

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const schreib = args.includes('--schreiben');
  const oi = args.indexOf('--owner');
  const ownerMail = oi >= 0 ? String(args[oi + 1] ?? '') : '';
  const ordner = args.filter((x, i) => !x.startsWith('--') && (oi < 0 || i !== oi + 1));
  const { cfg } = await import('./config.ts');
  const { ablageScan } = await import('./deckroutes.ts');
  const { gruppieren } = await import('./decks.ts');
  const quellen = cfg.deckQuellen.length ? cfg.deckQuellen : [cfg.docsDir, cfg.reviewDir, join(homedir(), 'work', 'knut', 'downloads', 'teilen')];
  const funde = gruppieren(ablageScan(quellen));
  const alt = (ordner.length ? ordner : ALTE_ORDNER).map((o) => altLesen(resolve(o), funde));
  const db = await import('./db.ts');
  let vorhanden = new Map<string, { fassungen: string[]; kommentare: Set<string> }>();
  let verbunden = false;
  try {
    await db.connect(); verbunden = true;
    for (const a of alt) {
      if ('fehler' in a) continue;
      const x = await db.wb().collection<DeckDoc>('decks').findOne({ _id: a.slug });
      const ks = await db.wb().collection<KommentarDoc>('deck_kommentare').find({ _id: { $in: a.kommentare.map((k) => k._id) } }, { projection: { _id: 1 } }).toArray();
      if (x || ks.length) vorhanden.set(a.slug, { fassungen: (x?.fassungen ?? []).map((f) => f.fassung), kommentare: new Set(ks.map((k) => k._id)) });
    }
  } catch (e: any) { console.log(`(Datenbank nicht erreichbar: ${String(e?.message ?? e).slice(0, 120)} — Trockenlauf ohne Abgleich)`); vorhanden = new Map(); }
  console.log(`${schreib ? 'ÜBERNEHMEN' : 'TROCKENLAUF (nichts wird geschrieben; mit --schreiben übernehmen)'} → Folien nach ${cfg.deckDir}, Datenbank ${cfg.db}\n`);
  console.log(planText(alt, vorhanden));
  if (schreib) {
    if (!verbunden) { console.error('\nAbbruch: keine Datenbank.'); process.exit(2); }
    const mail = (ownerMail || cfg.pilotEmail).toLowerCase();
    const u: any = await db.lc().collection('users').findOne({ email: mail }, { projection: { _id: 1 } });
    if (!u) { console.error(`\nAbbruch: kein Konto ${mail} (--owner E-Mail).`); process.exit(2); }
    const col = { decks: () => db.wb().collection<DeckDoc>('decks'), kommentare: () => db.wb().collection<KommentarDoc>('deck_kommentare') };
    console.log('');
    for (const a of alt) if (!('fehler' in a)) { const r = await schreiben(a, { col, wurzel: cfg.deckDir, owner: String(u._id), funde }); console.log(`✓ ${r.slug}: ${r.angelegt ? 'angelegt' : 'ergänzt'}, ${r.fassungen} Fassungen, ${r.kommentare} Kommentare`); }
  }
  process.exit(0);
}
