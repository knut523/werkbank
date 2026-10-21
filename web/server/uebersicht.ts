// Übersicht „Was fertig ist“ mit direktem Handeln (docs/plan-uebersicht-handeln.md, Paket 184; Knut 15.10.2026: „nur Bearbeitung
// fehlt noch, um direkt agieren zu können“). Eine Karte je offenem Strang, gruppiert nach Thema wie die Chat-Seitenleiste.
// Nur lesen: gehandelt wird über die vorhandenen Routen (Freigabe, Entscheidungen, Rückfragen, Nacharbeit).
//
// Council (Plan, Bedingungen 1–7): Kopf-Links nur http(s); Entscheidungen aus Textblöcken und Kopf nach Kennung zusammengeführt;
// Ampel läuft > blockiert > bereit zum Push > dein Review; „freigegeben“/„gepusht“ nur aus der Freigabe der Werkbank.
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { readBericht, readPlan, reviewDir, paketDatei } from './bericht.ts';
import { readPaket, type PaketDatei } from './reviewpakete.ts';
import { berichtKopf, offeneFragen, type Kopf } from './berichtkopf.ts';
import { berichtHash, entscheidungen, dienstePfad } from './freigabe.ts';
import { worumGeht } from './heutekarte.ts';
import { themaOf } from './themen.ts';
import { etaFertig, etaFuer, istTiefe, QUELLE_TEXT, type Tiefe } from './tiefe.ts';
import { knutDone, statusWord, kopfFelder } from './leitstand.ts';
import { OPEN } from './orchestrator.ts';   // in der Abfrage, damit .limit() nicht Geprüfte zählt

export type Ampel = 'laeuft' | 'blockiert' | 'push' | 'review';
export const AMPEL_TEXT: Record<Ampel, string> = { push: 'bereit zum Push', review: 'dein Review', laeuft: 'läuft', blockiert: 'blockiert' };
const RANG: Record<Ampel, number> = { blockiert: 0, review: 0, push: 1, laeuft: 2 };

export interface OffeneEntscheidung { id: string; frage: string; empfehlung: string; optionen: string; quelle: 'bericht' | 'kopf'; stufe?: 'wichtig' | 'normal'; worum?: string; optionenListe?: string[]; alternativen?: string[] }
export interface Link { art: 'bericht' | 'folien' | 'bilder' | 'vorschau' | 'chat' | 'pr'; label: string; url: string }

const sicher = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(u);

/** „Worum es geht“ aus einem Textblock **D1 — …**: der Fließtext ohne Empfehlungs-, Knut- und Optionszeilen, höchstens 800 Zeichen. */
export function blockWorum(text: string): string {
  return text.split('\n').filter((l) => !/^\s*[-*]\s*\**(Empfehlung|Knut|Option(en)?\b)/i.test(l)).join(' ').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 800);
}

/** Offene Entscheidungen eines Berichts: Textblöcke **D1 — …** ohne „- Knut:“ und Kopf-`fragen` ohne `antwort`, je Kennung
 *  eine Zeile (Council 2). `schon` = über die Werkbank für genau diesen Bericht-Stand schon beantwortete Kennungen. */
export function offeneEntscheidungen(text: string | null, beantwortet: { berichtHash?: string; ids?: string[] } | null | undefined): OffeneEntscheidung[] {
  if (!text) return [];
  const hash = berichtHash(text);
  const schon = beantwortet && beantwortet.berichtHash === hash ? new Set(beantwortet.ids ?? []) : new Set<string>();
  const kopf = berichtKopf(text);
  const imKopf = kopf && 'status' in kopf ? kopf.fragen : [];
  const out: OffeneEntscheidung[] = [];
  const erledigt = new Set<string>();
  for (const e of entscheidungen(text)) {
    if (e.knut || schon.has(e.id)) { erledigt.add(e.id); continue; }
    out.push({ id: e.id, frage: e.titel, empfehlung: e.empfehlung, optionen: e.text, quelle: 'bericht', worum: blockWorum(e.text) });
  }
  for (const f of offeneFragen(kopf, beantwortet, hash)) {
    if (erledigt.has(f.id)) continue;
    const da = out.find((x) => x.id === f.id);
    if (da) { if (!da.empfehlung) da.empfehlung = f.empfehlung; if (f.stufe) da.stufe = f.stufe; if (f.worum) da.worum = f.worum; if (f.optionen) da.optionenListe = f.optionen; if (f.alternativen) da.alternativen = f.alternativen; continue; }
    out.push({ id: f.id, frage: f.frage, empfehlung: f.empfehlung, optionen: (f.optionen ?? []).join('; '), quelle: 'kopf', ...(f.stufe ? { stufe: f.stufe } : {}), ...(f.worum ? { worum: f.worum } : {}), ...(f.optionen ? { optionenListe: f.optionen } : {}), ...(f.alternativen ? { alternativen: f.alternativen } : {}) });
  }
  // Im Kopf beantwortet (antwort gesetzt) gilt auch für einen gleichnamigen Textblock.
  const kopfFertig = new Set(imKopf.filter((f) => f.antwort).map((f) => f.id));
  return out.filter((x) => !kopfFertig.has(x.id));
}

/** Ampel mit fester Reihenfolge (Council 4). */
export function ampel(o: { running: boolean; wort: string; kopf: Kopf | null; offen: number; excerpt?: string | null }): Ampel {
  if (o.running) return 'laeuft';
  if (o.wort === 'gestoppt' || o.kopf?.status === 'blockiert' || (!o.kopf && /^Status:\s*blockiert\b/m.test(o.excerpt ?? ''))) return 'blockiert';
  if (o.kopf?.status === 'bereit_fuer_github' && o.offen === 0) return 'push';
  return 'review';
}

/** Zusatz zur Ampel aus der Freigabe der Werkbank (nie aus dem Kopf). */
export function freigabeZusatz(fg: { pushedAt?: unknown; veraltet?: boolean; head?: string; prNr?: number | null } | null | undefined): string | null {
  if (!fg) return null;
  if (fg.pushedAt) return `gepusht${fg.prNr ? ` · PR #${fg.prNr}` : ''}`;
  if (fg.veraltet) return `Freigabe veraltet (${String(fg.head ?? '').slice(0, 7)})`;
  return `freigegeben ${String(fg.head ?? '').slice(0, 7)} · wartet auf Push`;
}

/** „D1–D3“ bei lückenloser Folge, sonst „D1, D4“ (höchstens 4, dann „+n“). */
export function kennungen(ids: string[]): string {
  const m = ids.map((i) => /^D(\d+)$/.exec(i)?.[1]).map(Number);
  if (ids.length > 2 && m.every((n, i) => n && (i === 0 || n === m[i - 1] + 1))) return `${ids[0]}–${ids[ids.length - 1]}`;
  return ids.length > 4 ? `${ids.slice(0, 4).join(', ')} +${ids.length - 4}` : ids.join(', ');
}

/** „Braucht Knut: …“ aus dem Stand-Abschnitt der letzten Antwort (ohne „nichts“). */
export function brauchtKnut(excerpt: string | null | undefined): string | null {
  const m = /^\s*-\s*Braucht Knut:\s*(.+)$/im.exec(excerpt ?? '');
  const t = m?.[1]?.trim().replace(/^\*+|\*+$/g, '').trim() ?? '';
  // „nichts“, „„nichts““, „keine“, „-“, „—“ (Pass C, Befund 3: \b greift nach „-“ nicht).
  return !t || /^[„"“]?(nichts|keins?|keine|n\/a|[-–—]+)[“"”]?\s*([.!(].*)?$/i.test(t) ? null : t.slice(0, 400);
}

/** Eine Zeile „Von dir: …“. */
export function vonDir(o: { ampel: Ampel; freigabeOffen: boolean; kannFreigeben: boolean; entscheidungen: string[]; rueckfragen: number; braucht: string | null; gepusht?: boolean }): string {
  if (o.ampel === 'laeuft') return 'nichts — läuft noch';
  const teile: string[] = [];
  if (o.ampel === 'push' && o.kannFreigeben && !o.freigabeOffen) teile.push('Push-Go');
  if (o.entscheidungen.length) teile.push(`${o.entscheidungen.length === 1 ? 'Entscheidung' : 'Entscheidungen'} ${kennungen(o.entscheidungen)}`);
  if (o.rueckfragen) teile.push(o.rueckfragen === 1 ? 'eine Rückfrage' : `${o.rueckfragen} Rückfragen`);
  if (o.braucht && !o.entscheidungen.length && !o.rueckfragen) teile.push('Antwort auf die Rückfrage');   // die Frage steht darunter auf der Karte
  if (!teile.length) return o.ampel === 'blockiert' ? 'Blocker ansehen (Bericht/Chat)' : o.gepusht ? 'nichts — gepusht, PR-Review auf GitHub' : o.ampel === 'push' && o.freigabeOffen ? 'nichts — freigegeben, der Hauptchat pusht' : 'Review';
  return teile.join(' und ');
}

/** Basis-URL des Review-Pakete-Dienstes: WERKBANK_PAKETE_URL, sonst der Eintrag „Review-Pakete“ im Dienste-Register. */
export function paketBasis(env = process.env, read: () => string | null = () => { try { return readFileSync(dienstePfad(), 'utf8'); } catch { return null; } }): string | null {
  const e = (env.WERKBANK_PAKETE_URL ?? '').trim();
  if (e) return sicher(e) ? e.replace(/\/+$/, '') : null;
  const y = read();
  if (!y) return null;
  try {
    const list = parseYaml(y);
    const hit = (Array.isArray(list) ? list : []).find((x: any) => x && /review-pakete/i.test(String(x.was ?? '')) && sicher(x.link));
    return hit ? String(hit.link).replace(/\/+$/, '') : null;
  } catch { return null; }
}

const enc = (rel: string) => rel.split('/').map(encodeURIComponent).join('/');
const BILD = /\.(png|jpe?g|gif|webp)$/i;

/** Links einer Karte: Bericht · Folien · Bilder · Vorschau/Bot (Kopf, nur http(s)) · Chat. */
export function kartenLinks(o: { id: string; bericht: boolean; paket: string | null; dateien: PaketDatei[]; basis: string | null; kopf: Kopf | null; chat?: string | null }): Link[] {
  const out: Link[] = [];
  if (o.bericht) out.push({ art: 'bericht', label: 'Bericht', url: `#/leitstand?bericht=${o.id}` });
  if (o.paket && o.basis) {
    const folien = o.dateien.filter((f) => /\.html$/i.test(f.rel) && !/(^|\/)index\.html$/i.test(f.rel) && !/^vorbild/i.test(f.rel.split('/').pop()!))
      .sort((a, b) => Number(/bericht/i.test(b.rel)) - Number(/bericht/i.test(a.rel)) || b.mtimeMs - a.mtimeMs);
    if (folien[0]) out.push({ art: 'folien', label: 'Folien', url: `${o.basis}/${encodeURIComponent(o.paket)}/${enc(folien[0].rel)}` });
    const bilder = o.dateien.filter((f) => BILD.test(f.rel));
    if (bilder.length) {
      const ordner = bilder.every((f) => f.rel.includes('/')) && new Set(bilder.map((f) => f.rel.split('/')[0])).size === 1 ? bilder[0].rel.split('/')[0] : null;   // Pass C, 10
      out.push({ art: 'bilder', label: `Bilder (${bilder.length})`, url: `${o.basis}/${encodeURIComponent(o.paket)}/${ordner ? enc(ordner) + '/' : enc(bilder[0].rel)}` });
    }
  }
  for (const r of o.kopf?.review ?? []) {
    const url = sicher(r.login) ? r.login : sicher(r.url) ? r.url : null;
    if (url && !out.some((x) => x.url === url)) out.push({ art: 'vorschau', label: r.titel || 'Vorschau', url });
  }
  if (sicher(o.chat)) out.push({ art: 'chat', label: 'Chat', url: o.chat });
  return out.slice(0, 10);
}

/** Karte eines Strangs (rein bis auf das Lesen von Bericht, Plan und Paketliste). */
export function karte(d: any, fgs: any[], qs: any[], basis: string | null, med: Record<Tiefe, number | null> | null = null, now = Date.now()) {
  const felder: any = kopfFelder(d, fgs);
  const running = d.lastStatus === 'running';
  const pfad = paketDatei(d, 'bericht');
  const text = readBericht(pfad);
  // Der Status-Takt schreibt den Kopf nur für fertig gemeldete Stränge fest; sonst (blockiert, braucht Antwort) direkt aus dem Bericht.
  const roh = felder.kopf ? null : berichtKopf(text);
  const kopf: Kopf | null = felder.kopf ?? (roh && 'status' in roh ? roh : null);
  const offen = offeneEntscheidungen(text, d.entscheidungenAntwort ?? null);
  const fg = felder.freigabe;
  const aufGithub = (felder.prs ?? []).some((z: any) => z.stand === 'offen' || z.stand === 'gemergt');
  const a = ampel({ running, wort: statusWord(d), kopf, offen: offen.length + qs.length, excerpt: d.lastExcerpt });
  const kannFreigeben = !running && (kopf?.github?.length ?? 0) > 0 && (!fg || !!fg.veraltet) && !aufGithub;
  const braucht = kopf ? null : brauchtKnut(d.lastExcerpt);
  const paket = felder.paket ?? (d.paket || null);
  const p = paket ? readPaket(reviewDir(), paket) : null;
  const kurz = (kopf?.worum || worumGeht({ title: d.title, prompt: [d.zielLine, d.prompt].filter(Boolean).join('\n'), planText: readPlan(d.plan), berichtText: text })).slice(0, 600);
  // Plan 205: ETA nur für nicht fertige Stränge; überfällig = gedämpft markiert, kein Alarm. Fertig = keine ETA (null), auch wenn
  // der Agent trotzdem eine meldet (Knut 20.10.2026).
  const wort = statusWord(d);
  const fertig = etaFertig(d, wort === 'fertig');
  const eta = etaFuer(d, { fertig: fertig || wort === 'gestoppt', mediane: med, now });
  const seen = String(new Date(d.reviewReadyAt ?? d.doneAt ?? 0).getTime()) + ':' + String(new Date(d.lastSentAt ?? d.startedAt).getTime());
  return {
    id: String(d._id), titel: kopf?.titel || d.title || '(ohne Titel)', strangTitel: d.title ?? '', thema: themaOf(d), ampel: a, ampelText: a === 'push' && fg?.pushedAt ? 'gepusht' : AMPEL_TEXT[a],
    zusatz: freigabeZusatz(fg), kurz, anders: (kopf?.anders ?? []).slice(0, 4),
    github: (kopf?.github ?? []).map((g) => ({ repo: String(g.repo ?? ''), zweig: String(g.zweig ?? ''), commit: String(g.commit ?? '').slice(0, 7), pr: sicher(g.pr) ? g.pr : null })),
    prs: (felder.prs ?? []).filter((z: any) => sicher(z.url)).map((z: any) => ({ label: z.label, url: z.url, stand: z.stand })),
    links: kartenLinks({ id: String(d._id), bericht: !!text, paket, dateien: p?.files ?? [], basis, kopf, chat: d.url }),
    vonDir: vonDir({ ampel: a, freigabeOffen: !!fg && !fg.pushedAt && !fg.veraltet, kannFreigeben, entscheidungen: offen.map((e) => e.id), rueckfragen: qs.length, braucht, gepusht: !!fg?.pushedAt }),
    entscheidungen: offen, berichtHash: text ? berichtHash(text) : null, rueckfragen: qs, braucht,
    kannFreigeben, freigabe: fg, weitereRepos: felder.weitereRepos ?? [], commitWarnung: felder.commitWarnung ?? null,
    kopfFehler: kopf ? null : felder.kopfFehler ?? (roh && 'fehler' in roh ? roh.fehler : null),   // wie Heute: unlesbaren Kopf zeigen
    modell: d.lastModell ?? null, modellPlan: d.modell ?? null, gegenpruefung: d.gegenpruefung?.n ?? 0, reviewReady: !!d.reviewReadyAt,   // Karte › Technische Details (Paket 187, S4)
    tiefe: istTiefe(d.tiefe) ? d.tiefe : null, eta: fertig ? null : { text: eta.text, ueberfaellig: eta.ueberfaellig, at: eta.at, quelle: eta.quelle ? QUELLE_TEXT[eta.quelle] : null },
    running, wartet: wort === 'wartet', seen, paket, chat: sicher(d.url) ? d.url : null, statusAt: d.statusAt ?? d.lastActivity ?? d.startedAt,
  };
}
export type Karte = ReturnType<typeof karte>;

/** Karten je Thema; Themen mit „dein Review“/„blockiert“ zuerst, dann Push, dann läuft; Rückfragen ohne Strang als eigene Gruppe. */
export function gruppieren(karten: Karte[], lose: any[]) {
  const by = new Map<string, Karte[]>();
  for (const k of karten) by.set(k.thema, [...(by.get(k.thema) ?? []), k]);
  const themen = [...by.entries()].map(([thema, ks]) => {
    ks.sort((a, b) => RANG[a.ampel] - RANG[b.ampel] || +new Date(b.statusAt) - +new Date(a.statusAt));
    const zahl = (x: Ampel) => ks.filter((k) => k.ampel === x).length;
    return { thema, zahlen: { push: zahl('push'), review: zahl('review'), laeuft: zahl('laeuft'), blockiert: zahl('blockiert') }, rang: Math.min(...ks.map((k) => RANG[k.ampel])), karten: ks };
  }).sort((a, b) => a.rang - b.rang || a.thema.localeCompare(b.thema, 'de'));
  const vonDir = karten.filter((k) => !k.vonDir.startsWith('nichts')).length + lose.length;
  return { themen, lose, vonDir };
}

/** Welche Stränge auf die Übersicht kommen (Mongo-Filter): nicht von Knut geprüft (OPEN), nicht der Leitstand, ohne Startfehler, ≤ 30 Tage alt. */
export const AUF_UEBERSICHT = (now = Date.now()) => ({ kind: { $ne: 'leitstand' }, startError: null, startedAt: { $gt: new Date(now - 30 * 86400_000) }, ...OPEN });
export const offenFuerKnut = (d: any) => !knutDone(d);

/** Text an den Strang (S2): „antwort“ auf eine Rückfrage aus „Braucht Knut“, sonst Nacharbeit nach Review (wie bisher). */
export const replyText = (kind: unknown, text: string) => kind === 'antwort' ? `Antwort von Knut auf deine Rückfrage: ${text}` : `Nacharbeit nach Review: ${text}`;

/**
 * Antworten auf Kopf-Fragen in den YAML-Kopf schreiben (Teil B, S2): je `- id: D1` unter `fragen:` die Zeile `antwort:` setzen
 * (fehlt sie, kommt sie ans Ende des Eintrags). Wert als JSON-String (gültiges YAML in doppelten Anführungszeichen).
 * Ergebnis wird neu gelesen; stimmt eine Antwort danach nicht oder ist der Kopf unlesbar → null (dann nichts schreiben).
 */
export function kopfAntwortEintragen(md: string, antworten: { id: string; text: string }[]): string | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(md);
  if (!m || !antworten.length) return null;
  const nl = m[1].includes('\r\n') ? '\r\n' : '\n';
  const lines = m[1].split(/\r?\n/);
  const start = lines.findIndex((l) => /^fragen:\s*$/.test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && (lines[end].trim() === '' || /^\s/.test(lines[end]))) end++;   // Block bis zum nächsten Schlüssel ohne Einrückung
  for (const a of antworten) {
    let item = -1, dash = 0;
    for (let i = start + 1; i < end; i++) {
      const h = /^(\s*)-\s+id:\s*["']?([\w-]+)["']?\s*$/.exec(lines[i]);
      if (h && h[2] === a.id) { item = i; dash = h[1].length; break; }
    }
    if (item < 0) return null;
    let stop = item + 1;
    while (stop < end && !new RegExp(`^\\s{${dash}}-\\s`).test(lines[stop]) && (lines[stop].trim() === '' || lines[stop].search(/\S/) > dash)) stop++;
    // An einer Zeichengrenze kürzen (Pass C: kein halbes Surrogatpaar im YAML).
    const zeile = `${' '.repeat(dash + 2)}antwort: ${JSON.stringify(Array.from(a.text.replace(/\s+/g, ' ').trim()).slice(0, 600).join(''))}`;
    const hit = lines.slice(item + 1, stop).findIndex((l) => new RegExp(`^\\s{${dash + 2}}antwort:`).test(l));
    if (hit >= 0) {
      const at = item + 1 + hit;
      // Ein früheres mehrzeiliges `antwort: |` samt eingerückter Folgezeilen ganz ersetzen (Pass C, Befund 4).
      let n = 1;
      while (at + n < stop && (lines[at + n].trim() === '' ? at + n + 1 < stop : lines[at + n].search(/\S/) > dash + 2)) n++;
      lines.splice(at, n, zeile); end -= n - 1;
    } else { lines.splice(stop, 0, zeile); end++; }
  }
  const neu = md.slice(0, m.index) + `---${nl}${lines.join(nl)}${nl}---` + md.slice(m.index + m[0].length);
  const k = berichtKopf(neu);
  if (!k || !('status' in k)) return null;
  for (const a of antworten) if (!k.fragen.find((f) => f.id === a.id)?.antwort) return null;
  return neu;
}

/** Text einer Ja/Nein-Antwort auf eine Rückfrage ohne feste Optionen (q-… ohne Optionen, „Braucht Knut“). */
export const janein = (art: 'ja' | 'nein', empfehlung?: string | null) => art === 'ja' ? `Ja${empfehlung ? ` (wie empfohlen: ${empfehlung.slice(0, 300)})` : ''}.` : `Nein${empfehlung ? ` (Empfehlung „${empfehlung.slice(0, 200)}“ abgelehnt)` : ''}.`;
