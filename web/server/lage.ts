// Lage (Release 31 „Umzug“; Knut 02.11.: „Was ist offen?“ fragt er mehrmals täglich — die Ansicht soll das ohne Nachfrage
// beantworten). Eine Antwort aus den bestehenden Quellen, nichts Neues gespeichert:
//   Für dich zu tun   — Karten der Entscheidungsseite außer „aktion“ (die erledigt der Hauptchat), Approve-Bitten aus der
//                       PR-Lage (Review von Knut angefragt), eine Jira-Zeile (eigene Tickets überfällig/ohne Datum)
//   Läuft             — Stränge, die arbeiten oder warten, mit ETA
//   Fertig seit heute früh — Ergebnis-Satz (Titel des Berichtskopfs) + Link
//   Erledigt der Hauptchat — (b)-Aktionen aus „Braucht dich“
//   PR-Lage           — Kurzfassung aus prlage.ts (nur mit WERKBANK_PR_LAGE)
//   Themen            — je Thema ein Satz: Themen-Register vor Übersichtsnotiz im Vault, dazu laufende/fertige Stränge
// Schalter WERKBANK_LAGE=on (Vorgabe aus). baueLage/standSatz sind rein.

import { gruppen, type PrLage, type PrLageZeile } from './prlage.ts';

export const LAGE_AN = (env: NodeJS.ProcessEnv = process.env) => env.WERKBANK_LAGE === 'on';

const ROADMAP = 'olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap';
/** Die fünf Themen der Lage (Knut 02.11.): Notiz im Vault (Bau-Stand), Erkennung der Stränge, Name im Themen-Register. */
export const THEMEN_LAGE: { thema: string; notiz: string | null; strang: (k: { thema?: string | null; strangTitel?: string; titel?: string }) => boolean; register: RegExp }[] = [
  { thema: 'Flex', notiz: 'olaf/2-Areas/Neue-Geschaeftsfelder/Flexibilitaeten/0-flexibilitaeten-uebersicht.md', strang: (k) => k.thema === 'Flex', register: /^flex/i },
  { thema: 'Bot', notiz: `${ROADMAP}/Bot/0-bot-uebersicht.md`, strang: (k) => k.thema === 'Bot', register: /^bot\b/i },
  { thema: 'Werkbank', notiz: null, strang: (k) => k.thema === 'Workspace', register: /^(werkbank|workspace)/i },
  { thema: 'Service', notiz: `${ROADMAP}/Service-View/0-service-uebersicht.md`, strang: (k) => /\bservice/i.test(`${k.strangTitel ?? ''} ${k.titel ?? ''}`), register: /^service/i },
  { thema: 'Anmeldestrecke', notiz: `${ROADMAP}/Anmeldestrecke/0-anmeldestrecke-uebersicht.md`, strang: (k) => /anmelde/i.test(`${k.strangTitel ?? ''} ${k.titel ?? ''}`), register: /^anmelde/i },
];

const ohneMd = (t: string) => t.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .replace(/\*\*|__|`/g, '').replace(/^\s*[-*]\s+/, '').replace(/\s+/g, ' ').trim();

/** Erster Satz im Abschnitt „Aktueller Stand“ bzw. „Stand…“ einer Übersichtsnotiz; Tabellen als „Spalte: Wert“ der ersten Zeile. */
export function standSatz(md: string): { satz: string; geprueft: string | null; abschnitt: string } | null {
  const geprueft = /^last-verified:\s*(\d{4}-\d{2}-\d{2})/m.exec(md)?.[1] ?? null;
  const ls = md.split('\n');
  const i = ls.findIndex((l) => /^##\s+(Aktueller\s+)?Stand\b/i.test(l));
  if (i < 0) return null;
  const abschnitt = ls[i].replace(/^##\s+/, '').trim();
  const body: string[] = [];
  for (const l of ls.slice(i + 1)) { if (/^##?\s/.test(l)) break; body.push(l); }
  // Tabelle: erste Datenzeile nach dem Trenner.
  const sep = body.findIndex((l) => /^\s*\|?\s*:?-{3,}/.test(l));
  const ersteText = body.findIndex((l) => l.trim() && !l.trim().startsWith('>') && !l.trim().startsWith('|'));
  if (sep > 0 && (ersteText < 0 || sep < ersteText)) {
    const row = body.slice(sep + 1).find((l) => l.trim().startsWith('|'));
    if (row) { const c = row.split('|').map((x) => ohneMd(x)).filter(Boolean); if (c.length) return { satz: kuerze(c.length > 1 ? `${c[0]}: ${c.slice(1).join(' · ')}` : c[0]), geprueft, abschnitt }; }
  }
  if (ersteText < 0) return null;
  const absatz: string[] = [];
  for (const l of body.slice(ersteText)) { if (!l.trim() || (absatz.length && /^\s*[-*]\s/.test(l))) break; absatz.push(l); }
  const t = ohneMd(absatz.join(' '));
  const m = /^(.{12,240}?[.!?])(\s|$)/.exec(t);
  return { satz: kuerze(m ? m[1] : t), geprueft, abschnitt };
}
const kuerze = (s: string, n = 240) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

export interface LageFrage { id: string; art: string; gruppe: string; titel: string; empfehlung: string | null; stufe: string; wartetSeit: string | null; quelle: { text: string; url: string | null }; klasse?: string | null; blockiert: number }
export interface LageKarte { id: string; titel: string; strangTitel: string; thema: string; ampel: string; running: boolean; wartet: boolean; eta: { text: string; ueberfaellig: boolean } | null; statusAt: any; chat: string | null; links: { art: string; label: string; url: string }[] }
export interface LageEingabe {
  seit: string; now: string;
  fragen: LageFrage[]; karten: LageKarte[];
  aktionen: { kennung: string; strand: string; titel?: string | null; aktion?: string; wasTun: string }[];
  erledigtHeute?: { id: string; titel: string; at: any; chat: string | null }[];
  prLage: PrLage | null;
  themen: { thema: string; register: string | null; notiz: { satz: string; geprueft: string | null; abschnitt: string } | null; link: string | null }[];
  jira: { ueberfaellig: number; ohneDatum: number } | null;
}

const iso = (d: any) => (d ? new Date(d).toISOString() : '');
const istLaufend = (k: LageKarte) => k.running || k.ampel === 'laeuft' || k.ampel === 'blockiert';
const istFertig = (k: LageKarte, seit: string) => !istLaufend(k) && (k.ampel === 'review' || k.ampel === 'push') && iso(k.statusAt) >= seit;
const kurzPr = (pr: string) => pr.replace(/^[^/]+\//, '');


/** „Heute fertig“ (R32, Befund 6): Karten, die seit heute früh fertig gemeldet wurden (dein Review / bereit zum Push), plus die heute von dir
 *  geprüften — je mit Ergebnis-Satz (Titel aus dem Bericht-Kopf) und Link zum Bericht, neueste zuerst. Eine Quelle für Lage und Übersicht. */
export function fertigHeute(karten: LageKarte[], erledigtHeute: { id: string; titel: string; at: any; chat: string | null }[], seit: string) {
  const bekannt = new Set<string>();
  return [
    ...karten.filter((k) => istFertig(k, seit)).map((k) => ({ id: k.id, satz: k.titel, strang: k.strangTitel, thema: k.thema, at: iso(k.statusAt), link: k.links.find((l) => l.art === 'bericht')?.url ?? k.chat ?? null, ampel: k.ampel })),
    ...erledigtHeute.filter((x) => iso(x.at) >= seit).map((x) => ({ id: x.id, satz: x.titel, strang: x.titel, thema: '', at: iso(x.at), link: x.chat, ampel: 'geprüft' })),
  ].filter((f) => (bekannt.has(f.id) ? false : (bekannt.add(f.id), true))).sort((a, b) => b.at.localeCompare(a.at));
}

export function baueLage(e: LageEingabe) {
  // ---- Für dich zu tun ----
  const fragen = e.fragen.filter((f) => f.klasse !== 'aktion')
    .map((f, i) => ({ f, i })).sort((a, b) => (a.f.stufe === 'wichtig' ? 0 : 1) - (b.f.stufe === 'wichtig' ? 0 : 1) || a.i - b.i).map((x) => x.f);
  const fuerDich: { id: string; art: 'frage' | 'approve' | 'jira'; titel: string; empfehlung: string | null; quelle: string; link: string; stufe: string | null; seit: string | null }[] = [
    ...fragen.map((f) => ({ id: f.id, art: 'frage' as const, titel: f.titel, empfehlung: f.empfehlung, quelle: `${f.gruppe} · ${f.quelle.text}`, link: '#/entscheidungen', stufe: f.stufe, seit: f.wartetSeit })),
    ...(e.prLage?.zeilen ?? []).filter((z) => z.knutAngefragt).map((z) => ({ id: `pr:${z.pr}`, art: 'approve' as const, titel: `Review von dir angefragt: ${kurzPr(z.pr)} „${z.title}“ von ${z.author ?? '?'}`,
      empfehlung: z.mergeState ? `merge: ${z.mergeHinweis}` : null, quelle: 'GitHub', link: z.url, stufe: null, seit: z.updatedAt || null })),
    ...(e.jira && e.jira.ueberfaellig + e.jira.ohneDatum > 0 ? [{ id: 'jira', art: 'jira' as const, titel: `Deine Jira-Tickets: ${e.jira.ueberfaellig} überfällig, ${e.jira.ohneDatum} ohne Datum`, empfehlung: 'im Tagesabschluss nachziehen (jira_update_many)', quelle: 'Jira PM', link: '#/board', stufe: null, seit: null }] : []),
  ];

  // ---- Läuft / Fertig ----
  const laeuft = e.karten.filter(istLaufend).map((k) => ({ id: k.id, titel: k.strangTitel || k.titel, thema: k.thema, eta: k.eta?.text ?? null, ueberfaellig: !!k.eta?.ueberfaellig, blockiert: k.ampel === 'blockiert', chat: k.chat }));
  const fertig = fertigHeute(e.karten, e.erledigtHeute ?? [], e.seit);
  const hauptchat = e.aktionen.map((a) => ({ kennung: a.kennung, strand: a.strand, titel: a.titel ?? a.strand, aktion: a.aktion ?? '', wasTun: a.wasTun }));

  // ---- PR-Lage ----
  const prs = e.prLage ? (() => {
    const zs = e.prLage!.zeilen;
    const chris = zs.flatMap((z) => z.chris.map((c) => ({ pr: z.pr, url: c.url ?? z.url, wann: c.wann, text: c.text }))).sort((a, b) => b.wann.localeCompare(a.wann)).slice(0, 5);
    const kompakt = (z: PrLageZeile) => ({ pr: z.pr, titel: z.title, url: z.url, autor: z.author, entscheidung: z.entscheidung, merge: z.mergeState ?? z.mergeable ?? null, mergeHinweis: z.mergeHinweis,
      reviews: z.reviews.slice(0, 3), tags: z.tags.slice(0, 2), ticker: z.ticker ?? null, gepusht: z.gepusht });
    return { offen: zs.length, quelle: e.prLage!.quelle, hinweis: e.prLage!.hinweis ?? null, ticker: e.prLage!.ticker, at: e.prLage!.at,
      gruppen: gruppen(zs).map((g) => ({ titel: g.titel, zeilen: g.zeilen.map(kompakt) })), gepusht: zs.filter((z) => z.gepusht).map(kompakt), chris };
  })() : null;

  // ---- Themen ----
  const themen = THEMEN_LAGE.map((t) => {
    const ein = e.themen.find((x) => x.thema === t.thema);
    const ks = e.karten.filter(t.strang);
    const lauf = ks.filter(istLaufend), fe = ks.filter((k) => istFertig(k, e.seit));
    const ausStraengen = `${lauf.length} ${lauf.length === 1 ? 'Unter-Chat läuft' : 'Unter-Chats laufen'}, ${fe.length} fertig seit heute früh${lauf[0] ? ` — zuletzt „${lauf[0].strangTitel || lauf[0].titel}“` : fe[0] ? ` — zuletzt „${fe[0].titel}“` : ''}.`;
    const satz = ein?.register || ein?.notiz?.satz || ausStraengen;
    const quelle = ein?.register ? 'Themen-Register' : ein?.notiz ? `Vault, geprüft ${ein.notiz.geprueft ?? '—'} (${ein.notiz.abschnitt})` : 'aus den Unter-Chats';
    return { thema: t.thema, satz, quelle, link: ein?.link ?? null, laufen: lauf.length, fertigHeute: fe.length };
  });

  return {
    at: e.now, seit: e.seit, fuerDich, laeuft, fertig, hauptchat, prs, themen,
    zahlen: { fuerDich: fuerDich.length, laeuft: laeuft.length, fertig: fertig.length, hauptchat: hauptchat.length, prsOffen: prs?.offen ?? null },
  };
}
export type Lage = ReturnType<typeof baueLage>;
