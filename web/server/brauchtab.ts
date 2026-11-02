// „Braucht dich“-Schließen, Bündelung und Archivierung (R30b Teil A, S2): braucht.ts klassifiziert eine Zeile rein,
// hier kommt der Tab ans Werk — Fakten aus den bestehenden Quellen (Entscheidungs-Log, releasestand, GitHub-Kopie,
// orchestrator_runs), (c) wird mit Log-Zeile und Nachricht an den Strang geschlossen, (b) läuft als Aufgabe an den
// Hauptchat (keine Frage an Knut, keine Knöpfe), (a) bleibt Knuts Frage. Schalter WERKBANK_BRAUCHT_DICH (Vorgabe aus),
// nie still: jede Schließung steht im Entscheidungs-Log und geht als Nachricht an den Strang.

import { wb } from './db.ts';
import { klassifiziere, BRAUCHT_AN, hauptchatAktionen, type BrauchtKontext, type NurKnut } from './braucht.ts';
import { logZeile as annahmeZeile, type LogZeile } from './annahme.ts';
import type { InboxEintrag } from './inbox.ts';
import type { LiveIndex } from './releasestand.ts';
import { paketInSubject } from './heutekarte.ts';

const runs = () => wb().collection('orchestrator_runs');

// ---- Rein: Fakten + Bündelung ------------------------------------------------------------

/** Eine Karte, wie die Übersicht sie liefert — nur was die Klassifikation braucht. */
export interface BrauchtKarte { strand: string; titel: string; zeile: string; paket?: number | null; pr?: string | null; lauf?: string | null; /** erster ```sql-Block aus Stand/PR-Text/Bericht (zum Kopieren) */ sql?: string | null;
  /** alle genannten PRs (repo#nr) und — falls angehalten/abgebrochen — warum (Nachtrag 02.11.) */ prs?: string[]; strangZu?: string | null; /** Titel + Auftragsanfang (Konflikt-Anlass?) */ anlassText?: string | null }
export const kartEingabe = (o: BrauchtKarte): BrauchtKarte => ({ ...o });

/** Fakten, wie der Server sie sammelt (leer = nichts belegt). */
export interface BrauchtFakten {
  /** Kennungen und D-Nummern, die schon beantwortet sind (Entscheidungs-Log, berichtskopf-antwort). */
  beantwortet: string[];
  /** Paketnummern im Live-Stand (Merge-Commit nach Nummer, releasestand.ts — nie nur Git-Abstammung). */
  paketeLive: number[];
  /** PRs (repo#nr), die geschlossen oder gemergt sind (github_prs / prCheck). */
  prsZu: string[];
  /** PRs (repo#nr), die offen und konfliktfrei sind (github_prs: mergeable MERGEABLE) — Nachtrag 02.11. */
  prsKonfliktfrei?: string[];
  /** Läufe, für die ein neuerer Strang mit gleichem Ziel existiert. */
  laeufeNeuer: string[];
  /** Hauptchat-Aktionen dieser Instanz (braucht.ts → hauptchatAktionen). */
  aktionen: string[];
}

/** (a) Frage an Knut (mit Knöpfen) oder (b) Aufgabe des Hauptchats (ohne Knöpfe — nichts für Knut zu entscheiden). */
export interface BrauchtPunkt { strand: string; titel: string; art: 'entscheidung' | 'aktion'; wasTun: string; frage: string; aktion?: string; antworten: string[]; kennung: string; nurKnut?: NurKnut; sql?: string | null }
/** (b): wie weit die Aufgabe beim Hauptchat ist — gemeldet (in seiner Warteschlange), zugestellt (er hat sie bekommen), kein-hauptchat. */
export type Zustellung = 'gemeldet' | 'zugestellt' | 'kein-hauptchat' | 'fehlgeschlagen';
/** (c): von der Knut-Sicht verschwunden, mit Begründung, die Knut wiedererkennt. */
export interface BrauchtGeschlossen { strand: string; titel: string; kennung: string; frage: string; grund: string }
export interface BrauchtErgebnis { punkte: BrauchtPunkt[]; geschlossen: BrauchtGeschlossen[]; aktionen: BrauchtPunkt[]; /** je (b)-Kennung */ zustellung?: Record<string, Zustellung> }

const kurz = (s: string) => s.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12) || 'x';

/**
 * Bündelt die offenen „Braucht Knut“-Zeilen: klassifiziert jede Zeile (braucht.ts), (c) sammelt die Begründungen,
 * (b) wird zur Hauptchat-Aufgabe, (a) bleibt die Frage an Knut. Rein — das Schreiben macht schliesseBraucht.
 */
export function braucheBraucht(karten: BrauchtKarte[], fakten: BrauchtFakten, o: { an: boolean }): BrauchtErgebnis {
  const brauchts = karten.filter((k) => k.zeile && k.zeile.trim());   // kaputte Karten überspringen
  if (!o.an) return { punkte: brauchts.map((k) => punkt(k, 'entscheidung', k.zeile)), geschlossen: [], aktionen: [] };
  const out: BrauchtErgebnis = { punkte: [], geschlossen: [], aktionen: [] };
  for (const k of brauchts) {
    const ken = `b-${k.strand}-${kurz(k.zeile)}`;
    const ctx: BrauchtKontext = {
      kennung: ken,
      // D-Nummern gelten je Strang („strang:D1“); Kennungen tragen den Strang schon (b-<strang>-…).
      beantwortet: (s) => (/^D\d+$/.test(s) ? fakten.beantwortet.includes(`${k.strand}:${s}`) || fakten.beantwortet.includes(s) : fakten.beantwortet.includes(s)),
      paketLive: (n) => fakten.paketeLive.includes(n),
      prZu: (pr) => (fakten.prsZu.includes(pr) ? true : null),
      laufNeuere: (l) => fakten.laeufeNeuer.includes(l),
      hauptchatAktionen: fakten.aktionen,
      paket: k.paket ?? null, pr: k.pr ?? null, lauf: k.lauf ?? null,
      prs: k.prs ?? [], prKonfliktfrei: (pr) => (fakten.prsKonfliktfrei ?? []).includes(pr), strangZu: k.strangZu ?? null, anlassText: k.anlassText ?? null,
    };
    const r = klassifiziere(k.zeile, ctx);
    if (r.art === 'veraltet') out.geschlossen.push({ strand: k.strand, titel: k.titel, kennung: ken, frage: k.zeile, grund: r.grund ?? '' });
    else if (r.art === 'aktion') {
      const p = punkt(k, 'aktion', r.wasTun, r.aktion);
      out.punkte.push(p); out.aktionen.push(p);
    } else out.punkte.push({ ...punkt(k, 'entscheidung', r.wasTun), nurKnut: r.nurKnut, sql: r.nurKnut === 'datenbank' ? k.sql ?? null : null });
  }
  return out;
}

const punkt = (k: BrauchtKarte, art: BrauchtPunkt['art'], wasTun: string, aktion?: string): BrauchtPunkt => ({
  strand: k.strand, titel: k.titel, art, wasTun, frage: k.zeile, aktion, kennung: `b-${k.strand}-${kurz(k.zeile)}`,
  antworten: art === 'entscheidung' ? ['ja', 'nein', 'anders', 'spaeter'] : [],   // (b): kein Knopf — nichts für Knut zu entscheiden
});

/**
 * S5: die Klassifikation auf die Inbox legen (Einträge der Art „braucht“, Zuordnung je Strang — die Inbox-Kennung
 * bleibt, damit Antworten weiter an der Quelle landen). (c) verschwindet, (b) wird eine Statuszeile ohne Knöpfe
 * („Nichts für dich — der Hauptchat …“, blockiert Knut nicht), (a) trägt „Was du tun musst“ als Frage. Andere Arten
 * und Schalter aus: unverändert.
 */
export function wendeAufInbox<E extends { art: string; frage: string; antworten: string[]; blockiert: number; daten: any }>(eintraege: E[], r: BrauchtErgebnis, o: { an: boolean }): E[] {
  if (!o.an) return eintraege;
  const zu = new Set(r.geschlossen.map((g) => g.strand));
  const punkt = new Map(r.punkte.map((p) => [p.strand, p]));
  const out: E[] = [];
  for (const e of eintraege) {
    const s = e.art === 'braucht' ? String(e.daten?.strand ?? '') : '';
    if (!s) { out.push(e); continue; }
    if (zu.has(s)) continue;
    const p = punkt.get(s);
    if (!p) { out.push(e); continue; }
    // (b) trägt nie die Marke „wichtig“ und gilt nie „automatisch angenommen“ — es ist keine Frage an Knut (Nachbesserung 02.11.).
    out.push(p.art === 'aktion'
      ? { ...e, frage: p.wasTun, antworten: [], blockiert: 0, stufe: 'normal', stufeGrund: 'Aufgabe des Hauptchats', autoAb: null,
          daten: { ...e.daten, klasse: 'aktion', aktion: p.aktion, zeile: p.frage, hauptchat: r.zustellung?.[p.kennung] ?? 'kein-hauptchat' } } as E
      : { ...e, frage: p.wasTun || e.frage, daten: { ...e.daten, klasse: 'entscheidung', zeile: p.frage, nurKnut: p.nurKnut ?? null, sql: p.sql ?? null } });
  }
  return out;
}

// ---- Schreiben: (c) schließen ------------------------------------------------------------

/** Log-Zeile einer Schließung (annahme.ts-Form; Quelle = der Strang). */
export function logZeile(userId: string, strand: string, kennung: string, frage: string, teile: { antwort: string; durch: string; auto: boolean }): LogZeile {
  const e: InboxEintrag = { id: kennung, art: 'braucht', frage, empfehlung: null,
    quelle: { text: 'Unter-Chat', strand, url: null, paket: null }, wartetSeit: null, blockiert: 1, antworten: ['ja', 'nein', 'anders', 'spaeter'], daten: { strand, seen: null } };
  return annahmeZeile(userId, e, { antwort: teile.antwort, durch: teile.durch, auto: teile.auto });
}

/**
 * Schließt (c)-Punkte: Log-Zeile ins Entscheidungs-Log (nachvollziehbar, nie still) und eine Nachricht an den Strang
 * („Braucht dich — automatisch geschlossen: <Grund>“), die im Verlauf erscheint. Vorgabe aus (WERKBANK_BRAUCHT_DICH):
 * nichts, wie aufraeumen.ts. `send` ist austauschbar (Test).
 */
export async function schliesseBraucht(userId: string, geschlossen: BrauchtGeschlossen[], o: { env?: NodeJS.ProcessEnv; send?: (strand: string, text: string) => Promise<unknown>; now?: number } = {}): Promise<BrauchtGeschlossen[]> {
  if (!BRAUCHT_AN(o.env ?? process.env)) return [];
  const now = o.now ?? Date.now();
  const send = o.send ?? ((strand, text) => runs().updateOne({ _id: strand as any }, { $push: { meldungen: { at: new Date(now), art: 'braucht-geschlossen', text } } }));
  const out: BrauchtGeschlossen[] = [];
  for (const g of geschlossen) {
    // Idempotent (Pass C): feste _id je Kennung — der 10-min-Takt und gleichzeitige Läufe schreiben Log und Nachricht nur einmal.
    const zeile = { ...logZeile(userId, g.strand, g.kennung, g.frage, { antwort: `automatisch geschlossen: ${g.grund}`, durch: 'auto', auto: true }), _id: `${userId}-${g.kennung}-auto` };
    try { await wb().collection('entscheidungs_log').insertOne(zeile as any); }
    catch (e: any) { if (e?.code === 11000) continue; throw e; }
    await send(g.strand, `Braucht dich — automatisch geschlossen: ${g.grund}`);
    out.push(g);
  }
  return out;
}

// ---- (b) an den Hauptchat melden (Nachbesserung 02.11.: „(b)-Karten müssen auch WIRKLICH beim Hauptchat ankommen“) ----

const events = () => wb().collection('leitstand_events');
const aktiverHauptchat = (userId: string) => runs().findOne({ userId, kind: 'leitstand', endedAt: null }, { sort: { startedAt: -1 } }) as Promise<any>;

/** Text der Meldung — Werkbank-eigen; die Zeile des Strangs geht nur als eingezäunter Auszug mit (Daten, keine Anweisung). */
export const aktionText = (p: Pick<BrauchtPunkt, 'aktion'>) =>
  `„Braucht dich“ (b) — Aufgabe für dich als Hauptchat (${p.aktion}), keine Frage an Knut. Nur über die bestehenden Freigabewege ausführen (Push erst nach Gate und Knuts Ja); danach dem Strang antworten. Kannst du es nicht, sag es Knut.`;

/**
 * Meldet jede (b)-Aufgabe genau einmal je aktivem Hauptchat in dessen Warteschlange (leitstand_events, wie meldeLeitstand) —
 * feste _id je Hauptchat und Kennung: der 10-min-Takt meldet nicht doppelt, ein neuer Hauptchat bekommt sie wieder.
 * Ohne aktiven Hauptchat: nichts (die Karte sagt „kein Hauptchat aktiv“). Nur mit Schalter. Gibt die Zustellung je Kennung zurück.
 */
export async function meldeAktionen(userId: string, aktionen: BrauchtPunkt[], o: { env?: NodeJS.ProcessEnv; now?: number } = {}): Promise<Record<string, Zustellung>> {
  if (!BRAUCHT_AN(o.env ?? process.env) || !aktionen.length) return {};
  const leit = await aktiverHauptchat(userId);
  if (!leit) return Object.fromEntries(aktionen.map((p) => [p.kennung, 'kein-hauptchat' as const]));
  const at = new Date(o.now ?? Date.now());
  for (const p of aktionen) {
    await events().updateOne({ _id: `${userId}:braucht-aktion:${leit._id}:${p.kennung}` as any }, { $setOnInsert: {
      userId, leit: leit._id, kind: 'meldung', text: aktionText(p), excerpt: p.frage, strand: { id: p.strand, title: p.titel }, brauchtKennung: p.kennung,
      at, createdAt: at, status: 'offen', retries: 0, urgent: false } }, { upsert: true });
  }
  return zustellStand(userId, aktionen.map((p) => p.kennung));
}

/** Zustellung je (b)-Kennung beim aktiven Hauptchat: zugestellt (er hat die Meldung bekommen) · gemeldet (wartet in seiner Schlange). */
export async function zustellStand(userId: string, kennungen: string[]): Promise<Record<string, Zustellung>> {
  const out: Record<string, Zustellung> = Object.fromEntries(kennungen.map((k) => [k, 'kein-hauptchat' as const]));
  if (!kennungen.length) return out;
  const leit = await aktiverHauptchat(userId);
  if (!leit) return out;
  const ev: any[] = await events().find({ userId, leit: leit._id, brauchtKennung: { $in: kennungen } }, { projection: { brauchtKennung: 1, status: 1 } }).toArray();
  // verworfen = der Hauptchat hat sie nach allen Versuchen nicht angenommen (leitstand.ts retryMax) — sichtbar, nicht „kein Hauptchat“ (Pass C).
  const st = (k: string) => ev.find((e) => e.brauchtKennung === k)?.status;
  for (const k of kennungen) { const s = st(k); out[k] = s === 'zugestellt' ? 'zugestellt' : s === 'verworfen' ? 'fehlgeschlagen' : s ? 'gemeldet' : 'kein-hauptchat'; }
  return out;
}

// ---- Strang archivieren (gab es in orch nicht) --------------------------------------------

/** Strang auf erledigt setzen, ohne zu löschen (aufraeumen.ts-Muster, Compare-and-Set; nur mit Schalter). */
export async function archiviere(userId: string, strand: string, grund: string, o: { env?: NodeJS.ProcessEnv; now?: number } = {}): Promise<boolean> {
  if (!BRAUCHT_AN(o.env ?? process.env)) return false;
  const now = new Date(o.now ?? Date.now());
  const r = await runs().updateOne({ _id: strand as any, userId, reviewedBy: null, knutReviewedAt: null, nichtAutoSchliessen: { $ne: true } },
    { $set: { reviewedAt: now, reviewedBy: 'auto', autoGeschlossenAt: now, zustand: 'erledigt', zustandGrund: grund.slice(0, 300) } });
  return r.modifiedCount === 1;
}

/** Zurückholen wie aufraeumen.ts: nur automatisch Weggeräumtes, danach nie wieder automatisch. */
export async function zurueckholen(userId: string, strand: string, o: { now?: number } = {}): Promise<boolean> {
  const now = new Date(o.now ?? Date.now());
  const r = await runs().updateOne({ _id: strand as any, userId, reviewedBy: 'auto' },
    { $set: { reviewedAt: null, reviewedBy: null, autoGeschlossenAt: null, zustand: 'fertig', zustandGrund: 'zurückgeholt', nichtAutoSchliessen: true } });
  return r.modifiedCount === 1;
}

// ---- Fakten aus den bestehenden Quellen (Server) ------------------------------------------

/** Beleg aus dem Live-Index: liegt ein Merge-Commit mit dieser Paketnummer im Live-Zweig (Inhalt, nicht Abstammung). */
export function paketLiveFakten(idx: LiveIndex | null): { live: (nr: number) => Promise<boolean> } {
  const cache = new Map<number, boolean>();
  return { live: async (nr: number) => {
    if (cache.has(nr)) return cache.get(nr)!;
    let v = false;
    if (idx) {
      const m = idx.merges.find((x) => paketInSubject(x.subject, nr));
      if (m) v = (await idx.ancestor(m.sha, idx.liveSha)) === true;
    }
    cache.set(nr, v);
    return v;
  } };
}

/** Nur für Tests: ein LiveIndex aus rohen Teilen (der echte kommt aus releasestand.buildIndex über git). */
export function testIndex(roh: { entries: { branch: string; sha: string }[]; merges: { sha: string; at: number; subject: string }[] }): LiveIndex {
  const memo = new Map<string, boolean | null>();
  return {
    entries: roh.entries, liveSha: roh.entries[roh.entries.length - 1]?.sha ?? '', numbers: new Map(), releases: [], merges: roh.merges,
    ancestor: async (a: string, b: string) => {
      const k = `${a}..${b}`;
      if (memo.has(k)) return memo.get(k)!;
      // Test-Annahme: der Live-Zweig enthält alle Merges der Liste; die echte Abstammung prüft buildIndex über git.
      const v = roh.merges.some((m) => m.sha === a) && roh.entries.some((e) => e.sha === b);
      memo.set(k, v as boolean);
      return v as boolean;
    },
  } as unknown as LiveIndex;
}

// Re-Exports für main.ts
export { hauptchatAktionen, BRAUCHT_AN };
export type { BrauchtKontext };
