// Eine Inbox für alles, was auf Knut wartet (Plan 213 S2, Council K4/K10/K12, P5): Rückfragen des Hauptchats und der
// Unter-Chats, Entscheidungen im Bericht, „Braucht Knut“ aus dem Stand, Push-Freigaben, Fragen des Vault-Syncs, Ticketpflege
// (gesammelt), eine stehende Schlange. Jede Unterbrechung ist ein Eintrag mit fester Kennung, Quelle, „wartet seit“,
// „blockiert n“, Empfehlung und erlaubten Antworten (Ja · Nein · Anders … · Später). Sortiert nach „blockiert am meisten“,
// dann „wartet am längsten“ (Paperclip Decisions, Linear Triage). Beantwortet wird immer an der Quelle — was hier oder im
// Chat beantwortet ist, verschwindet überall (209 K8). Stichtag: Einträge älter als 14 Tage erscheinen als ein Sammel-Eintrag
// „Altbestand“. Freitext im Hauptchat wird nie automatisch zugeordnet; die Chat-Knöpfe tragen die Kennung.

import { klartext, empfehlungAus } from './klartext.ts';
import { DECKEL_KIND } from './fragenaufraeumen.ts';
import { wienDatum, wienUm, naechsterTag } from './zustand.ts';
import { stufeVon, klasseVon, autoAb, autoFaehig, ANNAHME_MS, type Stufe } from './stufe.ts';

export type InboxArt ='rueckfrage' | 'entscheidung' | 'braucht' | 'push' | 'vault' | 'pflege' | 'schlange' | 'altbestand' | 'triage' | 'vaultfrage';
export type Antwort = 'ja' | 'nein' | 'anders' | 'spaeter';

export interface InboxEintrag {
  id: string;
  art: InboxArt;
  frage: string;
  empfehlung: string | null;
  /** Herkunft für die Zeile „Unter-Chat „…“ · Bericht 209 · Hauptchat · Vault-Sync · Pflege“. */
  quelle: { text: string; strand: string | null; url: string | null; paket?: string | null };
  wartetSeit: string | null;
  /** Wie viele Unter-Chats auf diese Antwort warten. */
  blockiert: number;
  antworten: Antwort[];
  /** Zusatz je Art (Optionen einer Rückfrage, Kennungen D1…, Kopf-SHA für den Push, Anzahl bei Sammel-Einträgen …). */
  daten: Record<string, unknown>;
  /** Wichtigkeit (Knut 17.10.): wichtig steht oben und bleibt offen; normal gilt ab `autoAb` als angenommen (stufe.ts). */
  stufe?: Stufe;
  stufeGrund?: string;
  autoAb?: string | null;
  /** Thema des Unter-Chats (Gruppe auf der Entscheidungsseite); fehlt bei Einträgen ohne Strang. */
  thema?: string | null;
}

export const ALTBESTAND_TAGE = 14;
/** Deckel-/Budget-Fragen, die älter sind als so viele Tage (und deren Strang nicht mehr läuft), stehen als ein Sammel-Eintrag. */
export const DECKEL_ALT_TAGE = 7;
export const ART_TEXT: Record<InboxArt, string> = { rueckfrage: 'Rückfrage', entscheidung: 'Entscheidung', braucht: 'Frage im Stand', push: 'Push', vault: 'Vault-Sync', pflege: 'Pflege', schlange: 'Schlange', altbestand: 'Altbestand', triage: 'Meeting', vaultfrage: 'Vault-Frage' };

/** Kennung bleibt gleich, solange sich die Frage nicht ändert (Chat-Knöpfe und „Später“ hängen daran). */
export const kennung = {
  rueckfrage: (qid: string) => (qid.startsWith('q-') ? qid : `q-${qid}`),   // Rückfragen heißen schon „q-…“
  entscheidung: (strand: string, hash: string | null) => `d-${strand}-${String(hash ?? '').slice(0, 8)}`,
  braucht: (strand: string, text: string) => `b-${strand}-${kurzHash(text)}`,
  push: (strand: string, head: string) => `p-${strand}-${String(head).slice(0, 12)}`,
  vault: (id: string) => `v-${kurzHash(id)}`,
  triage: (id: string) => `t-${kurzHash(id)}`,
  vaultfrage: (path: string, line: number) => `k-${kurzHash(`${path}:${line}`)}`,
};
export const KENNUNG_RE = /^(q|d|b|p|v|t|k|pflege|laeufe|schlange|altbestand)(-[A-Za-z0-9-]{1,80})?$/;

export function kurzHash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/** Bis wann „Später“ gilt: morgen 07:00 Wiener Zeit (Council 1, UX-Befund 3). */
export function spaeterBis(now = Date.now()): Date {
  // Kalendertag in Wien + 1 (nicht +24 h: in der Nacht der Zeitumstellung wäre das sonst übermorgen — Pass C).
  return wienUm(naechsterTag(wienDatum(now)), 7);
}

export interface InboxQuellen {
  /** Karten der Übersicht (uebersicht.ts → karte), nur Admin. */
  karten: Array<{ id: string; titel: string; strangTitel?: string; thema?: string | null; running: boolean; entscheidungen: { id: string; frage: string; empfehlung: string | null; optionen?: string; stufe?: string | null; alternativen?: string[] }[]; berichtHash: string | null; rueckfragen: any[];
    braucht: string | null; kannFreigeben: boolean; freigabe: any; github: { repo: string; zweig: string; commit: string }[]; statusAt: any; chat: string | null; paket: string | null; seen?: string }>;
  /** Offene Rückfragen ohne Karte (Hauptchat, Drift, G0 …). */
  lose: Array<{ id: string; title: string; recommendation?: string | null; options?: { label: string }[]; createdAt: any; strand?: { id: string; title?: string; url?: string } | null; quelle?: string | null; key?: string | null; context?: string | null; kind?: string | null; stufe?: string | null; paket?: { id: string; titel: string } | null }>;
  /** Fragen des Vault-Syncs (mineFor → questions/pendingApprovals). */
  vault: Array<{ id: string; text: string; at?: any }>;
  /** Offene Ticketpflege (Hygiene) — nur die Zahl, als ein Sammel-Eintrag. */
  pflege: number;
  /** Unter-Chats in der Schlange (Platz, seit). */
  schlange: Array<{ id: string; titel: string; since: number }>;
  /** Berichte mit unlesbarem Kopf (K10: ein Sammel-Eintrag). */
  kopfFehler: Array<{ id: string; titel: string }>;
  /** Agentenläufe am Board, die auf die Person warten (eigene Karten in Arbeit) — ein Sammel-Eintrag (185 B8). */
  laeufe?: number;
  /** Meeting-Vorschläge der Morgenlage (cosmeeting.ts → vorschlaege), nur Admin mit Morgenlage — damit ① und der Zähler dieselbe Liste zählen (221). */
  triage?: Array<{ id: string; datei: string; titel: string; zusagen: number; entscheidungen: number; datum: string | null }>;
  /** F10 (Knut 19.10.: „muss halt viel einfacher sein“): aktuelle wichtige „- Knut:“-Zeilen aus dem Vault einzeln … */
  vaultFragen?: Array<{ path: string; line: number; hash: string; head: string; frage?: string; section: string; title: string; topic: string; since: string | null; grund: string; prio?: number | null; kurz?: string | null; beleg?: string | null }>;
  /** … der Rest als ein Sammeleintrag. */
  vaultRest?: number;
}

const iso = (v: unknown): string | null => { const t = v ? new Date(v as any).getTime() : NaN; return Number.isFinite(t) ? new Date(t).toISOString() : null; };

/** Einträge aus allen Quellen (rein). `spaeter`: Kennung → bis; `now` für Altbestand und Schlange. */
export function baueInbox(q: InboxQuellen, o: { spaeter?: Map<string, number>; now?: number; schlangeAlarmMs?: number; annahmeMs?: number; triage?: boolean } = {}): { eintraege: InboxEintrag[]; zurueckgestellt: number } {
  const now = o.now ?? Date.now();
  const out: InboxEintrag[] = [];
  const kartenIds = new Set(q.karten.map((k) => k.id));
  for (const k of q.karten) {
    const quelle = { text: `Unter-Chat „${k.strangTitel || k.titel}“`, strand: k.id, url: k.chat, paket: k.paket };
    const seit = iso(k.statusAt);
    const vorher = out.length;
    if (k.entscheidungen.length) {
      const ids = k.entscheidungen.map((e) => e.id);
      out.push({ id: kennung.entscheidung(k.id, k.berichtHash), art: 'entscheidung', frage: k.entscheidungen.length === 1 ? `${ids[0]}: ${k.entscheidungen[0].frage}` : `${k.titel} — ${ids.length} Entscheidungen im Bericht (${ids.join(', ')})`,
        empfehlung: k.entscheidungen.length === 1 ? k.entscheidungen[0].empfehlung : (k.entscheidungen.every((e) => e.empfehlung) ? 'alle Empfehlungen übernehmen' : null),
        quelle: { ...quelle, text: k.paket ? `Bericht ${k.paket.split('-')[0]}` : quelle.text }, wartetSeit: seit, blockiert: 1, antworten: ['ja', 'nein', 'anders', 'spaeter'],
        daten: { berichtHash: k.berichtHash, entscheidungen: k.entscheidungen, strand: k.id, strangTitel: k.strangTitel || k.titel } });
    }
    for (const r of k.rueckfragen ?? []) out.push(rueckfrageEintrag(r, quelle));
    if (k.braucht && !k.entscheidungen.length && !(k.rueckfragen ?? []).length && !k.running) {
      out.push({ id: kennung.braucht(k.id, k.braucht), art: 'braucht', frage: k.braucht, empfehlung: null, quelle, wartetSeit: seit, blockiert: 1, antworten: ['ja', 'nein', 'anders', 'spaeter'], daten: { strand: k.id, seen: k.seen ?? null } });
    }
    if (k.kannFreigeben && !k.entscheidungen.length && (k.github?.length ?? 0) > 0) {
      const g = k.github[0];
      out.push({ id: kennung.push(k.id, g.commit), art: 'push', frage: `Push freigeben: ${k.titel}`, empfehlung: null,
        quelle: { ...quelle, text: `${g.repo.split('/').pop()}${k.github.length > 1 ? ` + ${k.github.length - 1}` : ''}` }, wartetSeit: seit, blockiert: 1, antworten: ['ja', 'spaeter'],
        daten: { strand: k.id, repo: g.repo, zweig: g.zweig, commit: g.commit } });
    }
    for (const e of out.slice(vorher)) e.thema = e.thema ?? k.thema ?? null;   // Fragenpaket (R31) behält seine Gruppe
  }
  for (const r of q.lose) {
    if (r.strand && kartenIds.has(String(r.strand.id))) continue;   // steht schon bei seiner Karte
    out.push(rueckfrageEintrag(r, r.strand ? { text: `Unter-Chat „${r.strand.title ?? ''}“`, strand: String(r.strand.id), url: r.strand.url ?? null } : { text: r.quelle === 'drift' ? 'Abgleich Vault ↔ Jira' : 'Hauptchat', strand: null, url: null }));
  }
  for (const v of q.vault) {
    out.push({ id: kennung.vault(v.id), art: 'vault', frage: v.text, empfehlung: null, quelle: { text: 'Vault-Sync', strand: null, url: null }, wartetSeit: iso(v.at), blockiert: 0, antworten: ['ja', 'nein', 'spaeter'], daten: { vaultId: v.id } });
  }
  for (const t of q.triage ?? []) {
    out.push({ id: kennung.triage(t.id), art: 'triage', frage: `Meeting „${t.titel}“: ${t.zusagen} ${t.zusagen === 1 ? 'Zusage' : 'Zusagen'}, ${t.entscheidungen} ${t.entscheidungen === 1 ? 'Entscheidung' : 'Entscheidungen'} übernehmen?`,
      empfehlung: t.entscheidungen ? 'Zusagen eintragen, Entscheidungen als ADR im Chat' : 'Zusagen ins Register eintragen', quelle: { text: 'Meeting-Notiz', strand: null, url: '#/wissen/' + t.datei.split('/').map(encodeURIComponent).join('/') },
      wartetSeit: iso(t.datum), blockiert: 0, antworten: ['spaeter'], daten: { triageId: t.id, datei: t.datei, zusagen: t.zusagen, entscheidungen: t.entscheidungen } });
  }
  for (const v of q.vaultFragen ?? []) {
    out.push({ id: kennung.vaultfrage(v.path, v.line), art: 'vaultfrage', frage: klartext(v.frage || v.head), empfehlung: empfehlungAus(klartext(v.frage || v.head)),
      quelle: { text: `Spec „${v.title}“`, strand: null, url: '#/wissen/' + v.path.split('/').map(encodeURIComponent).join('/') }, wartetSeit: iso(v.since),
      blockiert: v.prio === 1 ? 1 : 0,   // Priorität 1 aus der Sichtung (U6) = hält Arbeit an → steht unter „Heute“
      antworten: ['ja', 'nein', 'anders', 'spaeter'], daten: { path: v.path, line: v.line, hash: v.hash, section: v.section, markiert: 'wichtig', grund: v.grund, prio: v.prio ?? null, kurz: v.kurz ?? null, beleg: v.beleg ?? null }, thema: v.topic });
  }
  if ((q.vaultRest ?? 0) > 0) out.push({ id: 'pflege-vault', art: 'pflege', frage: `${q.vaultRest} weitere offene Vault-Fragen (nicht dringend) — in Ruhe durchsehen`, empfehlung: null,
    quelle: { text: 'Roadmap › Entscheidungen', strand: null, url: '#/roadmap/entscheidungen' }, wartetSeit: null, blockiert: 0, antworten: ['spaeter'], daten: { n: q.vaultRest } });
  if (q.pflege > 0) out.push({ id: 'pflege', art: 'pflege', frage: `${q.pflege} ${q.pflege === 1 ? 'Ticket braucht' : 'Tickets brauchen'} Pflege`, empfehlung: null, quelle: { text: 'Pflege', strand: null, url: '#/board' }, wartetSeit: null, blockiert: 0, antworten: ['spaeter'], daten: { n: q.pflege } });
  if ((q.laeufe ?? 0) > 0) out.push({ id: 'laeufe', art: 'pflege', frage: `${q.laeufe} ${q.laeufe === 1 ? 'Agentenlauf am Board wartet' : 'Agentenläufe am Board warten'} auf dich`, empfehlung: null, quelle: { text: 'Board-Agenten', strand: null, url: '#/arbeit' }, wartetSeit: null, blockiert: 0, antworten: ['spaeter'], daten: { n: q.laeufe } });
  if (q.kopfFehler.length) out.push({ id: 'pflege-kopf', art: 'pflege', frage: `${q.kopfFehler.length} ${q.kopfFehler.length === 1 ? 'Bericht hat' : 'Berichte haben'} einen unlesbaren Kopf`, empfehlung: 'im Unter-Chat reparieren lassen', quelle: { text: 'Pflege', strand: null, url: null }, wartetSeit: null, blockiert: 0, antworten: ['spaeter'], daten: { berichte: q.kopfFehler } });
  // Schlange steht (K3): wartet der Erste länger als 30 min, genau ein Eintrag.
  const alarm = o.schlangeAlarmMs ?? 30 * 60_000;
  const lang = q.schlange.filter((s) => now - s.since > alarm);
  if (lang.length) {
    const aelteste = Math.min(...lang.map((s) => s.since));
    out.push({ id: 'schlange', art: 'schlange', frage: `Die Schlange steht: ${lang.length} Unter-Chat${lang.length > 1 ? 's warten' : ' wartet'} seit ${Math.round((now - aelteste) / 60_000)} min auf einen freien Platz`,
      empfehlung: 'einen laufenden Unter-Chat anhalten oder abwarten', quelle: { text: 'Brücke', strand: null, url: null }, wartetSeit: new Date(aelteste).toISOString(), blockiert: lang.length, antworten: ['spaeter'], daten: { unterchats: lang } });
  }
  for (const e of out) mitStufe(e, o.annahmeMs ?? ANNAHME_MS, !!o.triage);
  // Später zurückgestellt
  const spaeter = o.spaeter ?? new Map<string, number>();
  let sichtbar = out.filter((e) => !((spaeter.get(e.id) ?? 0) > now));
  // R32 (Nachtrag C): alte Deckel-/Budget-Fragen (> 7 Tage, der Strang läuft nicht mehr) sind EIN Eintrag mit einem Knopf „alle schließen“
  // (nur Knut darf Deckel-Fragen schließen). Sie zählen einmal, nicht je Frage — sonst stünden 20 Fragen von vor drei Wochen in der Zahl.
  const laufend = new Set(q.karten.filter((k) => k.running).map((k) => k.id));
  const deckelAlt = sichtbar.filter((e) => e.art === 'rueckfrage' && DECKEL_KIND.test(String(e.daten.kind ?? '')) && e.wartetSeit && now - new Date(e.wartetSeit).getTime() > DECKEL_ALT_TAGE * 86400_000
    && !(e.quelle.strand && laufend.has(e.quelle.strand)));
  const sichtbar0 = sichtbar;
  sichtbar = sichtbar.filter((e) => !deckelAlt.includes(e));
  // Altbestand (Stichtag): älter als 14 Tage → ein Sammel-Eintrag (Push und Schlange nie).
  const grenze = now - ALTBESTAND_TAGE * 86400_000;
  const alt = sichtbar.filter((e) => e.art !== 'push' && e.art !== 'schlange' && e.wartetSeit && new Date(e.wartetSeit).getTime() < grenze);
  const frisch = sichtbar.filter((e) => !alt.includes(e));
  if (alt.length) frisch.push({ id: 'altbestand', art: 'altbestand', frage: `Altbestand: ${alt.length} ${alt.length === 1 ? 'Frage ist' : 'Fragen sind'} älter als ${ALTBESTAND_TAGE} Tage — durchsehen oder alle verwerfen`, empfehlung: 'alle verwerfen',
    quelle: { text: 'Inbox', strand: null, url: null }, wartetSeit: alt.map((e) => e.wartetSeit!).sort()[0], blockiert: alt.reduce((s, e) => s + e.blockiert, 0), antworten: ['nein', 'spaeter'], daten: { eintraege: alt },
    stufe: alt.some((e) => e.stufe === 'wichtig') ? 'wichtig' : 'normal', stufeGrund: 'Sammel-Eintrag', autoAb: null });
  if (deckelAlt.length) frisch.push({ id: 'altbestand-deckel', art: 'altbestand', frage: `${deckelAlt.length} alte Deckel-Fragen („automatisch fortgesetzt“, Budget, Weckdeckel) — älter als ${DECKEL_ALT_TAGE} Tage, der Strang läuft nicht mehr`, empfehlung: 'alle schließen',
    quelle: { text: 'Deckel-Fragen', strand: null, url: null }, wartetSeit: deckelAlt.map((e) => e.wartetSeit!).sort()[0], blockiert: 0, antworten: ['nein', 'spaeter'], daten: { eintraege: deckelAlt, deckel: true },
    stufe: 'normal', stufeGrund: 'Sammel-Eintrag', autoAb: null });
  void sichtbar0;
  // Wichtige oben (Knut 17.10.), darin wie bisher: blockiert am meisten, dann wartet am längsten.
  const rang = (e: InboxEintrag) => (e.stufe === 'wichtig' ? 0 : 1);
  frisch.sort((a, b) => rang(a) - rang(b) || b.blockiert - a.blockiert || (a.wartetSeit ?? '9').localeCompare(b.wartetSeit ?? '9'));
  return { eintraege: frisch, zurueckgestellt: out.length - sichtbar.length };
}

function rueckfrageEintrag(r: InboxQuellen['lose'][number], quelle: InboxEintrag['quelle']): InboxEintrag {
  const opts = r.options ?? [];
  const g0 = /#G0$/.test(String(r.key ?? ''));
  return { id: kennung.rueckfrage(r.id), art: 'rueckfrage', frage: r.title, empfehlung: r.recommendation ?? null, quelle, wartetSeit: iso(r.createdAt), blockiert: quelle.strand || g0 ? 1 : 0,
    antworten: ['ja', 'nein', 'anders', 'spaeter'], daten: { qid: r.id, kind: r.kind ?? null, optionen: opts.map((o) => o.label), kontext: r.context ?? null,
      // Deckel- und G0-Fragen entscheidet immer Knut selbst (Bau-Tor, Fortsetzen) — nie automatisch.
      markiert: g0 || /^(auto-weiter|leitstand-)/.test(String(r.kind ?? '')) ? 'wichtig' : r.stufe ?? null },
    // Release 31: Fragen eines Fragenpakets stehen als eigene Gruppe auf der Entscheidungsseite.
    ...(r.paket?.titel ? { thema: `Fragenpaket: ${r.paket.titel}` } : {}) };
}

/** Stufe, Grund und „gilt ab … als angenommen“ je Eintrag. Automatisch nur Rückfragen und Bericht-Entscheidungen. */
// Plan §23 T2 (Triage an): automatisch nur noch Klasse „technisch“ — und zwar sofort (Frist 0); „knut“ nie, „gewichtig“
// entscheidet der Hauptchat nach dem Council-Check (T3). Die Stufe bleibt für Sortierung und Anzeige.
function mitStufe(e: InboxEintrag, ms: number, triage = false) {
  if (e.art === 'entscheidung') {
    const liste = (e.daten.entscheidungen as any[]) ?? [];
    for (const x of liste) {
      const s = stufeVon({ text: `${x.frage} ${x.empfehlung ?? ''} ${x.optionen ?? ''}`, markiert: x.stufe ?? null });
      x.stufe = s.stufe; x.stufeGrund = s.grund;
      x.auto = triage
        ? klasseVon({ text: `${x.frage} ${x.optionen ?? ''}`, markiert: x.stufe === 'wichtig' && /markiert/.test(s.grund) ? 'wichtig' : null, empfehlung: x.empfehlung }).klasse === 'technisch'
        : autoFaehig({ stufe: s.stufe, empfehlung: x.empfehlung, text: `${x.frage} ${x.optionen ?? ''}` });
    }
    const wichtig = liste.find((x) => x.stufe === 'wichtig');
    e.stufe = wichtig ? 'wichtig' : 'normal';
    e.stufeGrund = wichtig ? `${liste.length > 1 ? `${wichtig.id}: ` : ''}${wichtig.stufeGrund}` : 'normal: Empfehlung gilt nach 24 h';
    const auto = liste.filter((x) => x.auto).map((x) => x.id);
    e.daten.autoIds = auto;
    e.autoAb = auto.length && e.wartetSeit ? new Date(new Date(e.wartetSeit).getTime() + (triage ? 0 : ms)).toISOString() : null;
    return;
  }
  const text = `${e.frage} ${e.empfehlung ?? ''} ${(e.daten.kontext as string) ?? ''} ${((e.daten.optionen as string[]) ?? []).join(' ')}`;
  const s = stufeVon({ text, markiert: (e.daten.markiert as string) ?? null, art: e.art });
  e.stufe = s.stufe; e.stufeGrund = s.grund;
  if (triage) {
    const k = klasseVon({ text, markiert: (e.daten.markiert as string) ?? null, art: e.art, empfehlung: e.empfehlung });
    e.autoAb = e.art === 'rueckfrage' && k.klasse === 'technisch' ? e.wartetSeit : null;
    return;
  }
  e.autoAb = e.art === 'rueckfrage' ? autoAb({ stufe: s.stufe, empfehlung: e.empfehlung, text, seit: e.wartetSeit }, ms) : null;
}

/** Zähler für Leiste und Heute-Kopf (K11): nur sichtbare, nicht zurückgestellte Einträge; der Altbestand zählt als einer. */
// Entscheidungsseite (19.10.): ein Bericht mit D1–D3 sind drei Fragen — Leiste, Kopf, ① und Seite zählen gleich.
// R30b S5: (b)-Einträge (Aufgabe des Hauptchats, daten.klasse 'aktion') sind nichts für Knut — sie zählen nicht.
export const inboxZahl = (eintraege: InboxEintrag[]) => eintraege.reduce((n, e) => n + (e.daten?.klasse === 'aktion' ? 0 : e.art === 'entscheidung' ? Math.max(1, ((e.daten.entscheidungen as any[]) ?? []).length) : 1), 0);
