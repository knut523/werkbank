// „Braucht dich“-Schließen, Bündelung und Archivierung (R30b Teil A, S2): braucht.ts klassifiziert eine Zeile rein,
// hier kommt der Tab ans Werk — Fakten aus den bestehenden Quellen (Entscheidungs-Log, releasestand, GitHub-Kopie,
// orchestrator_runs), (c) wird mit Log-Zeile und Nachricht an den Strang geschlossen, (b) läuft als Aufgabe an den
// Hauptchat (keine Frage an Knut, keine Knöpfe), (a) bleibt Knuts Frage. Schalter WERKBANK_BRAUCHT_DICH (Vorgabe aus),
// nie still: jede Schließung steht im Entscheidungs-Log und geht als Nachricht an den Strang.

import { wb } from './db.ts';
import { klassifiziere, BRAUCHT_AN, hauptchatAktionen, type BrauchtKontext } from './braucht.ts';
import { logZeile as annahmeZeile, type LogZeile } from './annahme.ts';
import type { InboxEintrag } from './inbox.ts';
import type { LiveIndex } from './releasestand.ts';
import { paketInSubject } from './heutekarte.ts';

const runs = () => wb().collection('orchestrator_runs');

// ---- Rein: Fakten + Bündelung ------------------------------------------------------------

/** Eine Karte, wie die Übersicht sie liefert — nur was die Klassifikation braucht. */
export interface BrauchtKarte { strand: string; titel: string; zeile: string; paket?: number | null; pr?: string | null; lauf?: string | null }
export const kartEingabe = (o: BrauchtKarte): BrauchtKarte => ({ ...o });

/** Fakten, wie der Server sie sammelt (leer = nichts belegt). */
export interface BrauchtFakten {
  /** Kennungen und D-Nummern, die schon beantwortet sind (Entscheidungs-Log, berichtskopf-antwort). */
  beantwortet: string[];
  /** Paketnummern im Live-Stand (Merge-Commit nach Nummer, releasestand.ts — nie nur Git-Abstammung). */
  paketeLive: number[];
  /** PRs (repo#nr), die geschlossen oder gemergt sind (github_prs / prCheck). */
  prsZu: string[];
  /** Läufe, für die ein neuerer Strang mit gleichem Ziel existiert. */
  laeufeNeuer: string[];
  /** Hauptchat-Aktionen dieser Instanz (braucht.ts → hauptchatAktionen). */
  aktionen: string[];
}

/** (a) Frage an Knut (mit Knöpfen) oder (b) Aufgabe des Hauptchats (ohne Knöpfe — nichts für Knut zu entscheiden). */
export interface BrauchtPunkt { strand: string; titel: string; art: 'entscheidung' | 'aktion'; wasTun: string; frage: string; aktion?: string; antworten: string[]; kennung: string }
/** (c): von der Knut-Sicht verschwunden, mit Begründung, die Knut wiedererkennt. */
export interface BrauchtGeschlossen { strand: string; titel: string; kennung: string; frage: string; grund: string }
export interface BrauchtErgebnis { punkte: BrauchtPunkt[]; geschlossen: BrauchtGeschlossen[]; aktionen: BrauchtPunkt[] }

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
      beantwortet: (s) => fakten.beantwortet.includes(s),
      paketLive: (n) => fakten.paketeLive.includes(n),
      prZu: (pr) => (fakten.prsZu.includes(pr) ? true : null),
      laufNeuere: (l) => fakten.laeufeNeuer.includes(l),
      hauptchatAktionen: fakten.aktionen,
      paket: k.paket ?? null, pr: k.pr ?? null, lauf: k.lauf ?? null,
    };
    const r = klassifiziere(k.zeile, ctx);
    if (r.art === 'veraltet') out.geschlossen.push({ strand: k.strand, titel: k.titel, kennung: ken, frage: k.zeile, grund: r.grund ?? '' });
    else if (r.art === 'aktion') {
      const p = punkt(k, 'aktion', r.wasTun, r.aktion);
      out.punkte.push(p); out.aktionen.push(p);
    } else out.punkte.push(punkt(k, 'entscheidung', r.wasTun));
  }
  return out;
}

const punkt = (k: BrauchtKarte, art: BrauchtPunkt['art'], wasTun: string, aktion?: string): BrauchtPunkt => ({
  strand: k.strand, titel: k.titel, art, wasTun, frage: k.zeile, aktion, kennung: `b-${k.strand}-${kurz(k.zeile)}`,
  antworten: art === 'entscheidung' ? ['ja', 'nein', 'anders', 'spaeter'] : [],   // (b): kein Knopf — nichts für Knut zu entscheiden
});

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
    await wb().collection('entscheidungs_log').insertOne(logZeile(userId, g.strand, g.kennung, g.frage, { antwort: `automatisch geschlossen: ${g.grund}`, durch: 'auto', auto: true }) as any);
    await send(g.strand, `Braucht dich — automatisch geschlossen: ${g.grund}`);
    out.push(g);
  }
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
