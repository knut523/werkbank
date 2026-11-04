// Werkbank 2.0 (Paket 436): reine Regeln der neuen Oberfläche — welche fünf Dinge oben stehen, wie eine Karte aussieht,
// der Zustand eines Unter-Chats in einem Satz, „Heute erledigt“ nur mit Fertigem, „wartet auf“ je Person. Ohne Datenbank.
import { fangHierAn, type Frage } from './entscheidungsseite.ts';
import { ohneFachwort } from './woerterbuch.ts';
import { THEMEN, themaOf } from './themen.ts';

export type V2Antwort = 'ja' | 'nein' | 'anders' | 'spaeter';
export interface V2Link { label: string; url: string; extern?: boolean }
export interface V2Karte {
  id: string;
  /** Runde 5 (Knut B1): Sammelkarte („D1–D3 aus dem Bericht …“) — die gemeinten Entscheidungen aus dem Bericht und der Bericht selbst. */
  bezug?: { id: string; frage: string; empfehlung: string | null; antwort: string | null }[];
  bericht?: string | null;
  art: 'entscheidung' | 'freigabe';
  titel: string;
  /** Ein, zwei Sätze — passt aufs Handy; der volle Text steht in `erklaerung`. */
  worum: string;
  /** Warum die Karte oben steht („hält einen Unter-Chat an“). */
  grund: string;
  empfehlung: string | null;
  optionen: string[];
  alternativen: string[];
  /** Antwortknöpfe in 2.0; leer = hier nicht beantwortbar (Freigabe → `alt`). */
  antworten: V2Antwort[];
  form: string;
  wichtig: boolean;
  thema: string;
  quelle: string;
  links: V2Link[];
  /** „Was ist das?“ — Zeilen [Überschrift, Text], sofort aus den Daten. */
  erklaerung: [string, string][];
  /** Link in die alte Werkbank, wenn die Antwort dort gegeben wird (Freigaben). */
  alt: string | null;
  wartetSeit: string | null;
}

/** Wienzeit HH:MM einer ISO-Zeit; leer, wenn keine. */
export function uhrzeit(iso: string | Date | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Text auf höchstens `max` Zeichen, am liebsten am Satzende; sonst am Wortende mit „…“. */
export function kurz(text: string | null | undefined, max = 220): string {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const satz = t.slice(0, max + 1).match(/^.*[.!?](?=\s|$)/);
  if (satz && satz[0].length >= Math.min(40, max / 2)) return satz[0];
  if (satz && max < 40) return satz[0];
  const wort = t.slice(0, max - 1).replace(/\s+\S*$/, '');
  return `${wort || t.slice(0, max - 1)}…`;
}

const istFreigabe = (f: Pick<Frage, 'art'>) => f.art === 'push';

/** Wird die Frage in 2.0 beantwortet? Freigaben nach außen, der Vault-Sync-Entwurf und Aufgaben des Hauptchats nicht (Council B4). */
export function antwortWeg(f: Pick<Frage, 'art' | 'klasse'>): 'hier' | 'alt' {
  if (istFreigabe(f) || f.art === 'vault' || f.klasse === 'aktion') return 'alt';
  return ['rueckfrage', 'braucht', 'entscheidung', 'vaultfrage'].includes(f.art) ? 'hier' : 'alt';
}

/**
 * „Was du jetzt tun musst“: höchstens 5, Entscheidungen zuerst (Rang wie „Fang hier an“: hält Arbeit an · Frist · Kund:innen ·
 * wichtig · wartet lange), darunter höchstens 2 Freigaben. Aufgaben des Hauptchats nie. Deterministisch.
 */
export function jetztAuswahl(fragen: Frage[], now = Date.now()): { f: Frage; grund: string }[] {
  const echt = fragen.filter((f) => f.klasse !== 'aktion');
  const byId = new Map(echt.map((f) => [f.id, f]));
  const entscheidungen = fangHierAn(echt.filter((f) => !istFreigabe(f)), now);
  const freigaben = fangHierAn(echt.filter(istFreigabe), now).slice(0, 2);
  const platz = 5 - freigaben.length;
  return [...entscheidungen.slice(0, platz), ...freigaben].map((x) => ({ f: byId.get(x.id)!, grund: x.grund }));
}

const ANTWORT_REIHE: V2Antwort[] = ['ja', 'anders', 'nein', 'spaeter'];

/** Eine Frage als Karte der 2.0. `strand` = Unter-Chat, aus dem sie kommt (Link auf seine Ansicht). */
export function karteAusFrage(f: Frage, o: { grund: string; strand: string | null; strandTitel: string | null; altUrl: string }): V2Karte {
  const weg = antwortWeg(f);
  const freigabe = istFreigabe(f);
  let antworten: V2Antwort[] = weg === 'hier' ? ANTWORT_REIHE.filter((a) => (f.antworten as string[]).includes(a) || a === 'anders') : [];
  if (weg === 'hier' && !f.empfehlung && f.form !== 'janein') antworten = antworten.filter((a) => a !== 'ja');
  // „Nein“ nur bei echten Ja/Nein-Fragen — sonst ist „Anders: …“ der Weg (Knut: Empfehlung + Ja + eigener Text).
  if (f.form !== 'janein') antworten = antworten.filter((a) => a !== 'nein');
  const links: V2Link[] = [];
  if (o.strand) links.push({ label: o.strandTitel ? `Unter-Chat „${kurz(o.strandTitel, 60)}“` : 'Unter-Chat ansehen', url: `/v2/arbeit/${o.strand}` });
  if (f.quelle?.url && /^https?:\/\//.test(f.quelle.url) && !o.strand) links.push({ label: f.quelle.text || 'Quelle', url: f.quelle.url, extern: true });
  if (f.quelle?.url?.startsWith('#/wissen/')) links.push({ label: f.quelle.text || 'Notiz', url: `/v2/dokument?vault=${encodeURIComponent(f.quelle.url.slice('#/wissen/'.length))}` });
  // Agenten schreiben oft Dateipfade mit Zeilen („…/x.md:51“, „Z.56-59“) — für Menschen in „(Notiz)“ übersetzen (Persona Knut R2).
  const ohnePfad = (t: string) => t.replace(/`?[\w./-]+\.(md|ts|tsx|json|ya?ml)(:\d+(-\d+)?)?`?/g, '(Notiz)').replace(/\bZ\.\s?\d+(-\d+)?/g, '').replace(/\(Notiz\)(\s*,?\s*\(Notiz\))+/g, '(Notiz)');
  // S13: Code-Namen und Abkürzungen in Klartext (woerterbuch.ts) — nur die Anzeige; die Antwort nimmt der Server aus der Frage selbst.
  const g = new Set<string>(), ge = new Set<string>();
  const voll = ohneFachwort(ohnePfad(String(f.worum ?? '').replace(/\s+/g, ' ').trim()), new Set());
  const titel = ohneFachwort(f.titel, g), worum = ohneFachwort(ohnePfad(String(f.worum ?? '').replace(/\s+/g, ' ').trim()), g);
  const empfehlung = f.empfehlung ? ohneFachwort(f.empfehlung, g) : f.empfehlung;
  const optionen = (f.optionen ?? []).map((x) => ohneFachwort(x, g));   // Alternativen bleiben roh: ihr Text geht beim Antippen als Antwort an den Agenten.
  const erklaerung: [string, string][] = [
    ...(worum && worum !== kurz(worum, 220) ? [['Worum es geht (ganz)', voll] as [string, string]] : []),   // gekürzt wird der übersetzte Text (Runde 3)
    ['Thema', themaVon(f.gruppe, `${f.titel} ${f.quelle?.text ?? ''}`)],
    ['Woher', f.quelle?.text || '—'],
    ...(f.empfehlung ? [['Empfehlung', ohneFachwort(f.empfehlung, ge)] as [string, string]] : []),
    ...(f.optionen?.length ? [['Möglichkeiten', f.optionen.map((x) => ohneFachwort(x, ge)).join(' · ')] as [string, string]] : []),
    ['Was passiert bei „Ja, so“', freigabe ? 'Hier nichts — Freigaben nach außen (z. B. auf GitHub) gibst du in der alten Werkbank, mit dem gesehenen Stand.'
      : f.empfehlung ? `Die Empfehlung geht als deine Antwort an ${o.strand ? 'den Unter-Chat' : f.quelle?.text || 'die Quelle'}; der Agent arbeitet damit weiter.`
        : 'Deine Antwort geht an die Quelle; der Agent arbeitet damit weiter.'],
    ['Warum oben', o.grund || 'wartet auf dich'],
    ...(f.blockiert > 0 ? [['Hält an', f.blockiert === 1 ? 'ein Unter-Chat wartet auf diese Antwort' : `${f.blockiert} Unter-Chats warten auf diese Antwort`] as [string, string]] : []),
    ...(f.wartetSeit ? [['Wartet seit', new Date(f.wartetSeit).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit' }) + ` ${uhrzeit(f.wartetSeit)}`] as [string, string]] : []),
  ];
  return {
    id: f.id, art: freigabe ? 'freigabe' : 'entscheidung', titel: kurz(titel, 160), worum: kurz(worum, 220), grund: o.grund, empfehlung,
    optionen, alternativen: f.alternativen ?? [], antworten, form: f.form, wichtig: f.stufe === 'wichtig', thema: themaVon(f.gruppe, `${f.titel} ${f.quelle?.text ?? ''}`), quelle: f.quelle?.text ?? '',
    links, erklaerung, alt: weg === 'alt' ? o.altUrl : null, wartetSeit: f.wartetSeit,
  };
}

/** Runde 5 (Knut B1): welche D-Fragen meint eine Karte? „D1–D3“, „D1 bis D8“, „D1, D2 und D4“ — erst ab zwei, sonst null. */
export function bezugIds(t: string): string[] | null {
  const ids = new Set<number>();
  const bereiche = [...String(t ?? '').matchAll(/\bD(\d{1,2})\s*(?:–|-|bis)\s*D(\d{1,2})\b/g)];
  for (const m of bereiche) { const [a, b] = [Number(m[1]), Number(m[2])]; if (a < b && b - a < 20) for (let i = a; i <= b; i++) ids.add(i); }
  if (!bereiche.length) for (const m of String(t ?? '').matchAll(/\bD(\d{1,2})\b/g)) ids.add(Number(m[1]));
  return ids.size >= 2 ? [...ids].sort((a, b) => a - b).map((i) => `D${i}`) : null;
}

// ---------- Arbeit (Unter-Chats) ----------

export interface ArbeitZeile { id?: string; zustand: string; zustandText?: string; grund?: string; eta?: { text: string; ueberfaellig: boolean } | null; cs?: { status: string; grund?: string; offen?: number } | null; paket?: string | null; bericht?: boolean }

/** Der Zustand eines Unter-Chats in einem Klartext-Satz (428 W12: kein rohes Markdown, keine ETA in der Vergangenheit). */
/** S22 (Knut B6): eine an der Quelle gekürzte Meldung („… (Empfehlung: b⋯“) an der letzten ganzen Stelle schneiden und auf den Stand verweisen. */
function ganzeStelle(g: string): string {
  if (!/[⋯…]$/.test(g)) return g;
  const roh = g.replace(/[⋯…]+$/, '').trimEnd();
  // Satzende nur nach einem Wort mit ≥ 3 Zeichen und vor einem Großbuchstaben/einer Ziffer (nicht an „z. B.“); Zeilenumbrüche zu Leerzeichen (Pass C).
  const satz = roh.match(/^([\s\S]*[\p{L}\d)]{3}[.!?])[ \t\n]+(?=[A-ZÄÖÜ0-9„«])/u)?.[1];
  const stelle = satz ?? roh.match(/^([\s\S]*?)\s*[(;—]/)?.[1];
  return `${(stelle && stelle.length >= 8 ? stelle.replace(/[.!?]$/, '') : `${roh} …`).replace(/\s+/g, ' ').trim()} — ganzer Text unten im Stand`;
}

export function zustandSatz(z: ArbeitZeile): string {
  const grund = ganzeStelle(String(z.cs?.grund ?? z.grund ?? '').trim());
  const eta = z.eta?.text ? (z.eta.ueberfaellig ? 'dauert länger als geschätzt' : z.eta.text) : '';
  const cs = z.cs?.status;
  if (z.zustand === 'laeuft') return `Läuft${eta ? ` — ${eta}` : ''}.`;
  if (z.zustand === 'schlange') return 'Wartet auf einen freien Platz und startet von selbst.';
  if (cs === 'hauptchat') return 'Wartet auf den Hauptchat — du musst nichts tun.';
  if (cs === 'braucht' || z.zustand === 'wartet') return `Wartet auf dich${grund ? `: ${grund}` : ''}.`;
  if (z.zustand === 'blockiert') return `Kommt nicht weiter${grund ? `: ${grund}` : ''} — schau dir die Frage an.`;
  if (z.zustand === 'haengt') return `Hängt${grund ? `: ${grund}` : ''} — der Agent antwortet nicht mehr.`;
  if (z.zustand === 'stand-fehlt') return 'Ist stehen geblieben, ohne einen Stand zu melden.';
  // Runde 4 (Knut B1): „Bericht liegt bereit“ nur, wenn es einen gibt — sonst ehrlich sagen, dass er fehlt.
  if (z.zustand === 'fertig') return z.bericht && z.paket ? 'Fertig — der Bericht liegt bereit, lies ihn, wenn du Zeit hast.' : 'Fertig gemeldet, aber ohne Bericht — schau in den Unter-Chat, ob noch etwas auf dich wartet.';
  return grund ? `${grund}.` : 'Stand unbekannt.';
}

/** Gruppe in der Arbeit-Ansicht. */
export function arbeitGruppe(z: ArbeitZeile): 'wartet' | 'laeuft' | 'fertig' {
  const cs = z.cs?.status;
  if (cs === 'hauptchat') return 'laeuft';   // wartet auf den Hauptchat, nicht auf dich
  if (cs === 'braucht' || ['wartet', 'blockiert', 'haengt', 'stand-fehlt'].includes(z.zustand)) return 'wartet';
  if (z.zustand === 'laeuft' || z.zustand === 'schlange') return 'laeuft';
  return 'fertig';
}

/** Runde 4 (Knut B3, „Stand an der Quelle auf 600 Zeichen gekürzt“): der ganze Stand-Abschnitt der letzten Antwort des Agenten —
 *  aus dem Verlauf, wie der Status-Takt ihn liest (orchestrator.ts `excerpt`), nur ohne die 600-Zeichen-Grenze. Ohne Verlauf: der
 *  gespeicherte Auszug. */
export function standVoll(nachrichten: { rolle: string; text: string }[], ersatz: string, n = 8000): string {
  const t = [...nachrichten].reverse().find((m) => m.rolle !== 'ich' && String(m.text ?? '').trim())?.text ?? '';
  if (!t) return kurz(ersatz, n);
  const i = t.lastIndexOf('### Stand');
  const s = (i >= 0 ? t.slice(i) : t.slice(-n)).replace(/^\s*\*[^*\n]*\*\s*$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// ---------- Heute erledigt ----------

export interface ErledigtZeile { id: string; titel: string; uhr: string; at: string; stand: 'abgenommen' | 'zum-lesen'; links: V2Link[] }

/**
 * Nur Fertiges (428 W11): was noch auf eine Antwort von dir wartet, steht unter „Wartet auf dich“, nicht hier. Was fertig ist, aber
 * dein Review noch nicht hat, ist als „zum Lesen“ markiert. `abgenommen` = von dir heute geprüft. Uhrzeit = Zeitpunkt des Fertigwerdens.
 */
export function erledigtSicht(straenge: { id: string; titel: string; at: string; link: string | null; dokumente: { label: string; url: string }[] }[], zeilen: Map<string, ArbeitZeile>, abgenommen: Set<string>): ErledigtZeile[] {
  const out: ErledigtZeile[] = [];
  for (const s of straenge) {
    const z = zeilen.get(s.id);
    const ab = abgenommen.has(s.id);
    if (!ab && z && arbeitGruppe(z) !== 'fertig') continue;
    const links: V2Link[] = [];
    if (z?.paket && z.bericht) links.push({ label: 'Bericht', url: `/v2/dokument?paket=${encodeURIComponent(z.paket)}&datei=bericht.md` });
    for (const d of s.dokumente ?? []) links.push({ label: d.label, url: d.url });
    links.push({ label: 'Unter-Chat', url: `/v2/arbeit/${s.id}` });
    out.push({ id: s.id, titel: kurz(s.titel, 160), uhr: uhrzeit(s.at), at: s.at, stand: ab ? 'abgenommen' : 'zum-lesen', links });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

// ---------- PRs ----------

export interface LivePrLite { pr: string; repo: string; number: number; title: string; url: string; isDraft?: boolean; turn?: { who: string; role: string; why: string } | null; requested?: string[]; updatedAt?: string; author?: string; reviewDecision?: string | null; mergeable?: string }

/** Auf wen wartet der PR? Personen aus „am Zug“ und den angefragten Reviewern — „Merge (Mensch)“ und „niemand angefragt“ sind keine. */
export function wartetAuf(p: LivePrLite, names: Record<string, string>): string[] {
  const out: string[] = [];
  const add = (n: string) => { const v = names[n.toLowerCase()] ?? n; if (v && !out.includes(v)) out.push(v); };
  if (p.turn?.role === 'merge') return [];   // freigegeben: wartet auf den Merge, nicht mehr auf angefragte Reviewer (Persona Christoph)
  const who = String(p.turn?.who ?? '').trim();
  if (who && !/\(/.test(who) && p.turn?.role !== 'merge') for (const n of who.split(/\s*,\s*/)) add(n);
  for (const r of p.requested ?? []) add(String(r));
  return out;
}

export interface PrZeile { pr: string; repo: string; number: number; titel: string; url: string | null; wartetAuf: string[]; warum: string; entwurf: boolean; geaendert: string | null; entscheidung: string | null }

/** PR-Liste für eine Person (`alle` = alle offenen), neueste Änderung zuerst. */
export function prSicht(prs: LivePrLite[], wer: string, names: Record<string, string>): PrZeile[] {
  const w = wer.toLowerCase();
  return prs.map((p) => ({ p, wa: wartetAuf(p, names) }))
    .filter(({ wa }) => w === 'alle' || wa.some((x) => x.toLowerCase() === w))
    .map(({ p, wa }) => ({ pr: p.pr, repo: p.repo, number: p.number, titel: p.title, url: /^https:\/\/github\.com\//.test(String(p.url)) ? p.url : null, wartetAuf: wa,
      warum: wa.length ? String(p.turn?.why ?? 'Review angefragt') : String(p.turn?.why ?? ''), entwurf: !!p.isDraft, geaendert: p.updatedAt ?? null, entscheidung: p.reviewDecision ?? null }))
    .sort((a, b) => String(b.geaendert ?? '').localeCompare(String(a.geaendert ?? '')));
}

/** Personen zur Auswahl „wartet auf ▾“: ich zuerst (auch mit 0), dann nach Anzahl. */
export function personen(prs: LivePrLite[], ich: string, names: Record<string, string>): { name: string; anzahl: number }[] {
  const n = new Map<string, number>([[ich, 0]]);
  for (const p of prs) for (const x of wartetAuf(p, names)) n.set(x, (n.get(x) ?? 0) + 1);
  const [mich, ...rest] = [...n.entries()].map(([name, anzahl]) => ({ name, anzahl }));
  return [mich, ...rest.sort((a, b) => b.anzahl - a.anzahl || a.name.localeCompare(b.name))];
}

// ---------- Rolle (S13, Council C6) ----------

export type Rolle = 'leitung' | 'reviewer' | 'team';
/** Startansicht je Rolle: Admin leitet; wer in der GitHub-Namensliste steht, prüft Code (Reviewer); alle anderen sind Team.
 *  Hängt am GitHub-Namen, nie an gerade offenen PRs (sonst wechselt die Startseite mit der PR-Lage).
 *  ponytail: Vergleich über den Vornamen, weil die Namensliste (github.ts) nur Vornamen kennt; zwei Personen mit gleichem Vornamen
 *  bekämen dieselbe Ansicht — nur Anordnung, keine Rechte. Upgrade: GitHub-Login am Konto speichern (E9, M3). */
export function rolle(u: { admin: boolean; vorname: string; zugang?: boolean; einstellung?: string | null }, names: Record<string, string>): Rolle {
  const v = u.vorname.trim().toLowerCase();
  const github = !!v && Object.values(names).some((n) => n.trim().toLowerCase() === v);
  // S20 (Knut 03.11., D8): jede Person hat ihre eigene Instanz und ist dort Admin — also nie bloß das Admin-Flag. Die Einrichtung
  // (WERKBANK_ROLLE, setzt team-install) gilt nur für die Besitzerin; sonst aus den Daten: mit eigenem Claude-Zugang leitet sie Agenten.
  if (u.admin) {
    if (u.einstellung === 'leitung' || u.einstellung === 'reviewer' || u.einstellung === 'team') return u.einstellung;
    if (u.zugang ?? true) return 'leitung';
  }
  return github ? 'reviewer' : 'team';
}

// ---------- Alle Chats (S12, Council C4) ----------

export interface ChatZeile { id: string; art: 'hauptchat' | 'unterchat' | 'chat' | 'chat2'; titel: string; thema: string | null; status: string; zuletzt: string | null; url: string | null; conv: string | null }
const iso = (d: unknown) => { if (!d) return null; const t = new Date(d as any); return Number.isNaN(t.getTime()) ? null : t.toISOString(); };   // kaputtes Datum ≠ 500 (Pass C)
const convOk = (c: string) => /^[\w-]{1,80}$/.test(c);   // nur saubere IDs in Links (Pass C)
/** Status eines Unter-Chats in einem Wort (abgenommen · fertig · läuft · wartet · abgebrochen). */
function strangStatus(r: any): string {
  if (r.knutReviewedAt || r.reviewedAt) return 'abgenommen';
  if (r.startError) return 'abgebrochen';
  return ({ fertig: 'fertig', laeuft: 'läuft', wartet: 'wartet', blockiert: 'wartet', haengt: 'wartet', 'stand-fehlt': 'wartet' } as Record<string, string>)[String(r.zustand ?? '')] ?? 'offen';
}
/** Eine Liste aus drei Quellen: Unter-Chats/Hauptchats (orchestrator_runs, nur Admin), LibreChat-Unterhaltungen (über den Adapter)
 *  und 2.0-Chats. Jede Unterhaltung genau einmal — die LibreChat-Unterhaltung eines Unter-Chats erscheint als Unter-Chat. Neueste zuerst. */
export function chatListe(runs: any[], convs: any[], eigene: { conv: string; titel: string; at: unknown }[], o: { admin: boolean; lcUrl: string }): ChatZeile[] {
  const out: ChatZeile[] = [];
  const belegt = new Set<string>();
  for (const r of o.admin ? runs : []) {
    if (r.conv) { if (belegt.has(String(r.conv))) continue; belegt.add(String(r.conv)); }   // zwei Runs, eine Unterhaltung: einmal (Pass C)
    const haupt = r.kind === 'leitstand';
    out.push({ id: String(r._id), art: haupt ? 'hauptchat' : 'unterchat', titel: kurz(String(r.title || (haupt ? 'Hauptchat' : 'Unter-Chat')), 140), thema: haupt ? null : themaVon(themaOf(r), String(r.title ?? '')),
      status: haupt ? (r.endedAt ? 'beendet' : 'aktiv') : strangStatus(r), zuletzt: iso(r.lastActivity ?? r.doneAt ?? r.startedAt),
      url: haupt ? (r.conv && convOk(String(r.conv)) ? `${o.lcUrl}/c/${r.conv}` : null) : `v2/arbeit/${r._id}`, conv: r.conv ? String(r.conv) : null });
  }
  for (const c of convs) {
    const id = String(c.conversationId);
    if (belegt.has(id)) continue;
    belegt.add(id);
    out.push({ id, art: 'chat', titel: kurz(String(c.title || 'Chat'), 140), thema: null, status: c.isArchived ? 'archiviert' : 'offen', zuletzt: iso(c.updatedAt ?? c.createdAt), url: convOk(id) ? `${o.lcUrl}/c/${id}` : null, conv: id });
  }
  for (const e of eigene) if (!belegt.has(e.conv)) out.push({ id: e.conv, art: 'chat2', titel: kurz(e.titel, 140), thema: null, status: 'offen', zuletzt: iso(e.at), url: null, conv: e.conv });
  return out.sort((a, b) => String(b.zuletzt ?? '').localeCompare(String(a.zuletzt ?? '')));
}

// ---------- Themen quer über alles (S11, Knut 03.11. Punkt 2) ----------

/** Namen, die nur sagen, woher etwas kommt — kein Thema; dann wird das Thema aus dem Text erkannt. */
const HILFSNAME = /^(Hauptchat|Unter-Chats?|Push-Freigaben|Vault-Sync|Vault|Übersicht|Sonstiges|Inbox)$/i;
const SYNONYM: Record<string, string> = { Workspace: 'Werkbank', 'Service-View': 'Service' };
/** Zusätzlich zu den Regeln der Seitenleiste (themen.ts): die Lage-Themen und Datenschutz. */
const EXTRA_THEMEN: { thema: string; re: RegExp }[] = [
  { thema: 'Anmeldestrecke', re: /anmelde/i },
  { thema: 'Service', re: /\bservice/i },
  { thema: 'Datenschutz', re: /datenschutz|dsgvo|einwilligung|\bdsb\b/i },
];
/** Ein Thema für alles (Entscheidungen, Unter-Chats, Dokumente, PRs): ein gesetztes Thema gilt, Hilfsnamen nicht; sonst die erste
 *  passende Regel (themen.ts, dann Lage-Themen) über den Text. Eine Quelle — dieselbe Zuordnung auf jeder Seite. */
export function themaVon(roh: string | null | undefined, text: string): string {
  let r = String(roh ?? '').trim();
  let t = String(text ?? '');
  if (/^Fragenpaket:/i.test(r)) { t = `${r} ${t}`; r = ''; }
  if (r && !HILFSNAME.test(r)) return SYNONYM[r] ?? r;
  const hit = THEMEN.find((x) => x.re.test(t)) ?? EXTRA_THEMEN.find((x) => x.re.test(t));
  return hit ? SYNONYM[hit.thema] ?? hit.thema : 'Sonstiges';
}

export interface ThemaZeile { thema: string; entscheidungen: number; unterchats: number; dokumente: number; prs: number; summe: number }
/** Je Thema, was dazu da ist — größte zuerst, „Sonstiges“ zuletzt. */
export function themenUebersicht(q: { karten: { titel: string; thema?: string | null }[]; runs: any[]; notizen: { path: string; title: string }[]; prs: { repo: string; title: string }[] }): ThemaZeile[] {
  const m = new Map<string, ThemaZeile>();
  const zu = (th: string, f: 'entscheidungen' | 'unterchats' | 'dokumente' | 'prs') => { const z = m.get(th) ?? { thema: th, entscheidungen: 0, unterchats: 0, dokumente: 0, prs: 0, summe: 0 }; z[f]++; z.summe++; m.set(th, z); };
  for (const k of q.karten) zu(themaVon(k.thema, k.titel), 'entscheidungen');
  for (const r of q.runs) if (r.kind !== 'leitstand') zu(themaVon(themaOf(r), String(r.title ?? '')), 'unterchats');
  for (const n of q.notizen) zu(themaVon(null, `${n.path} ${n.title}`), 'dokumente');
  for (const p of q.prs) zu(themaVon(null, `${p.repo} ${p.title}`), 'prs');
  return [...m.values()].sort((a, b) => (a.thema === 'Sonstiges' ? 1 : 0) - (b.thema === 'Sonstiges' ? 1 : 0) || b.summe - a.summe || a.thema.localeCompare(b.thema, 'de'));
}

// ---------- PR-Seite (S22, Christoph Runde 3 B2/B4) ----------

/** Wer hat „Änderungen verlangt“? Je Person zählt ihr letztes Review; steht es noch auf CHANGES_REQUESTED, ist sie es.
 *  `unbekannt`: GitHub meldet „Änderungen verlangt“, aber die Kopie kennt den Urheber nicht (z. B. älteres Review). */
export function verlangtVon(entscheidung: string | null | undefined, reviews: { author?: string; state?: string; submittedAt?: string }[], names: Record<string, string>): { wer: string[]; unbekannt: boolean } {
  const letzte = new Map<string, { state: string; at: string }>();
  for (const r of reviews ?? []) {
    const a = String(r.author ?? ''); if (!a || r.state === 'COMMENTED') continue;
    const at = String(r.submittedAt ?? '');
    if (!at) continue;   // ohne Zeitstempel kein Vergleich möglich — überschreibt nichts (Pass C)
    if (!letzte.has(a) || at >= letzte.get(a)!.at) letzte.set(a, { state: String(r.state), at });
  }
  const wer = [...letzte].filter(([, v]) => v.state === 'CHANGES_REQUESTED').map(([a]) => names[a.toLowerCase()] ?? a);
  return { wer, unbekannt: entscheidung === 'CHANGES_REQUESTED' && !wer.length };
}

/** Kurzurteil aus dem Agenten-Text: erster Satz/Absatz ohne Überschriften und Markdown, dazu die Zahl der Befundzeilen (Tabelle). */
export function kurzurteil(text: string | null | undefined): { satz: string; befunde: number } {
  const t = String(text ?? '');
  const absatz = t.split(/\n\s*\n/).map((x) => x.trim()).find((x) => x && !/^#/.test(x) && !/^\|/.test(x)) ?? '';
  const satz = kurz(absatz.replace(/\*\*|__|`/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ').trim(), 240);
  const zeilen = t.split('\n').filter((l) => /^\s*\|/.test(l));
  const befunde = Math.max(0, zeilen.filter((l) => !/^\s*\|[\s|:-]*$/.test(l)).length - 1);
  return { satz, befunde };
}

// ---------- Titel alter Chats (S22, Knut Runde 3 B7) ----------

/** Sagt der Titel nichts (LibreChat nimmt oft die erste kurze Antwort: „ja“, „Ok?“)? */
export function schwacherTitel(t: string | null | undefined): boolean {
  const s = String(t ?? '').trim();
  return s.length < 12 || /^(new chat|neuer chat|chat|ja|nein|ok|okay|weiter|danke|passt)\W*$/i.test(s);
}
/** Schwacher Titel → Anfang der ersten eigenen Nachricht (ohne Markdown), sonst der Titel. */
export function besserTitel(titel: string, ersteNachricht: string | null | undefined): string {
  const m = String(ersteNachricht ?? '').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
  return schwacherTitel(titel) && m.length >= 8 ? kurz(m, 72) : titel;
}
