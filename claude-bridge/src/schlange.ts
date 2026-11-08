import { readFileSync, writeFileSync, renameSync } from 'node:fs';
// Warteschlange statt Fehlschlag (Plan 213 S1a, Council K3): Ist die Parallelgrenze voll, wartet ein neuer Zug in einer
// Schlange je Person, statt sofort mit „busy“ zu enden und vom automatischen „weiter“ wiederholt zu werden (gemessen:
// 1 533 Wiederholungen in 14 Tagen). Reihenfolge: Vorrang (PR-Reviews) zuerst, sonst wer zuerst kam. Kein leer gehaltener
// Platz für Reviews — der Speicher der VM ist knapp; Vorrang heißt: als Nächster dran.
// Der Hauptchat zählt ohnehin nicht zur Grenze (Plan 132, E2), braucht also keinen eigenen Platz.

// Audit 05.11. (3): eigener Topf für jcode-Stränge (eigene Reihe — sie warten nicht hinter Claude-Zügen, die auf Speicher warten);
// Wartegrund am Platz (sichtbar in /orch/state); Schlange auf Platte (BRIDGE_STATE_DIR/schlange.json): nach Neustart oder
// Zeitdeckel bekommt ein Zug, der wiederkommt (automatisches Fortsetzen der Werkbank), seinen alten Platz zurück.
export interface Platz { key: string; userId: string; since: number; vorrang: boolean; topf?: string; grund?: string; gehalten?: boolean; rang?: number }

const schlange: Platz[] = [];
/** Gemerkte Plätze (key → since) von Zügen, die die Schlange ohne Start verlassen haben oder vor einem Neustart warteten. */
const frueher = new Map<string, { since: number; bis: number }>();
const MERKEN_MS = 24 * 3600_000;
let datei: string | null = null;
/** Schlange auf Platte halten (null = aus, Tests). Liest beim Aufruf, was ein voriger Prozess hinterließ. */
export function merkeIn(pfad: string | null): void {
  datei = pfad;
  if (!pfad) return;
  try {
    const j = JSON.parse(readFileSync(pfad, 'utf8'));
    const jetzt = Date.now();
    for (const p of [...(j.plaetze ?? []), ...(j.frueher ?? [])]) {
      const bis = Number(p?.bis ?? jetzt + MERKEN_MS);
      if (typeof p?.key === 'string' && Number.isFinite(p.since) && bis > jetzt && !((frueher.get(p.key)?.since ?? Infinity) <= p.since)) frueher.set(p.key, { since: p.since, bis });
    }
  } catch { /* keine oder kaputte Datei: leer anfangen */ }
}
function speichern(): void {
  if (!datei) return;
  try {
    writeFileSync(datei + '.tmp', JSON.stringify({ plaetze: schlange.map(({ key, userId, since, vorrang, topf, grund, rang }) => ({ key, userId, since, vorrang, topf, grund, rang })), frueher: [...frueher].filter(([, v]) => v.bis > Date.now()).slice(-200).map(([key, v]) => ({ key, ...v })) }));
    renameSync(datei + '.tmp', datei);
  } catch { /* Platte voll o. ä.: die Schlange im Speicher läuft weiter */ }
}
// Drain vor dem Neustart (Release-Blocker): ab SIGTERM/SIGINT keine neuen Plätze; Wartende bleiben in schlange.json.
let drainAb = false;
/** Läuft der Drain? (server.ts: neue Züge ablehnen, den Rest weiter bedienen.) */
export const drainLaeuft = () => drainAb;
/** Frist in Sekunden (BRIDGE_DRAIN_SEK, Vorgabe 120); BRIDGE_DRAIN=aus: sofort beenden wie bisher. */
export const drainSek = () => { if (String(process.env.BRIDGE_DRAIN ?? '').toLowerCase() === 'aus') return 0; const s = Number(process.env.BRIDGE_DRAIN_SEK ?? 120); return Number.isFinite(s) && s >= 0 ? s : 120; };
/** Keine neuen Plätze mehr vergeben, laufende Läufe bis zur Frist beenden lassen, Schlange sichern. Gibt zurück, ob alles leer lief. */
export async function drain(laufend: () => number, o: { fristSek?: number; takt?: number } = {}): Promise<boolean> {
  drainAb = true;
  const bis = Date.now() + (o.fristSek ?? drainSek()) * 1000;
  while (laufend() > 0 && Date.now() < bis) await new Promise((r) => setTimeout(r, o.takt ?? 1000));
  speichern();
  return laufend() === 0;
}
const wecker = new Set<() => void>();
// Nach einem Start bis zum nächsten Takt niemanden starten: der Gestartete ist erst danach als laufend eingetragen.
let startSperre = false;

/** Alterungszeit (Fehlervariante 2, 06.11.2026, aus Strang e1ea43fa übernommen): ab hier rückt ein normaler Zug vor die
 *  Vorrang-Züge, damit Vorrang (PR-Reviews) nichts verhungern lässt — 83021050 rutschte hinter Reviews von Platz 2 auf 4 und
 *  endete nach dem Zeitdeckel mit „busy“. Vorgabe 20 min, mit `BRIDGE_QUEUE_ALTER_MIN` einstellbar. */
export const alterMs = () => { const m = Number(process.env.BRIDGE_QUEUE_ALTER_MIN || 20); return Number.isFinite(m) && m > 0 ? m * 60_000 : 20 * 60_000; };

/** Reihenfolge einer Person je Topf: gealterte Züge zuerst (ältester zuerst), sonst Vorrang, dann Ankunft. `jetzt` für Tests. */
export function reihe(q: readonly Platz[], userId: string, topf?: string, jetzt: number = Date.now()): Platz[] {
  const altertAb = jetzt - alterMs();
  return q.filter((p) => p.userId === userId && (p.topf ?? '') === (topf ?? '')).sort((a, b) =>
    // Pass B (07.11.): wer nur aus eigenem Grund wartet (PR-Stau, Energie, Kontingent — kapazitaet.ts), hält die anderen nicht auf.
    Number(!!a.gehalten) - Number(!!b.gehalten) ||
    // Paket D: Melious-Rangfolge 0 dringend … 5 Kosmetik (kapazitaet.ts RANG); ohne Rang gleich — innerhalb eines Rangs gilt Alter/Vorrang wie bisher. BRIDGE_MELIOUS_BUDGET=aus: kein Rang.
    (rangAn() ? (a.rang ?? 1) - (b.rang ?? 1) : 0) ||
    Number(b.since <= altertAb) - Number(a.since <= altertAb)   // gealterte Züge zuerst (negativ = a vorn)
    || (a.since <= altertAb ? 0 : Number(b.vorrang) - Number(a.vorrang))   // sonst Vorrang
    || a.since - b.since);
}

/** Platz in der Schlange (1 = als Nächster dran), 0 = nicht in der Schlange. */
export function position(q: readonly Platz[], key: string, jetzt: number = Date.now()): number {
  const p = q.find((x) => x.key === key);
  if (!p) return 0;
  return reihe(q, p.userId, p.topf, jetzt).findIndex((x) => x.key === key) + 1;
}

const rangAn = () => String(process.env.BRIDGE_MELIOUS_BUDGET ?? '').trim().toLowerCase() !== 'aus';
export const schlangeAn = () => process.env.BRIDGE_QUEUE !== '0';
export const maxWarteMs = () => { const m = Number(process.env.BRIDGE_QUEUE_MAX_MIN || 45); return Number.isFinite(m) ? Math.max(60_000, m * 60_000) : 45 * 60_000; };

/** Lebenszeichen in der Schlange (Schlangen-Fehler 06.11.2026): LibreChat räumt eine Antwort ab, die 20 min keinen Chunk
 *  geschickt hat (InMemoryJobStore, staleJobTimeout) — dann schloss die Senke und der wartende Zug endete „aborted“.
 *  Darum spätestens alle 10 min eine Zeile, auch wenn sich der Platz nicht ändert. `BRIDGE_QUEUE_LEBENSZEICHEN_S`. */
export const lebenszeichenMs = () => { const s = Number(process.env.BRIDGE_QUEUE_LEBENSZEICHEN_S || 600); return Number.isFinite(s) && s > 0 ? s * 1000 : 600_000; };

export function inSchlange(key: string): { pos: number; since: number; grund: string } | null {
  const p = schlange.find((x) => x.key === key);
  return p ? { pos: position(schlange, key), since: p.since, grund: p.grund ?? '' } : null;
}

export function laenge(userId?: string): number {
  return userId ? schlange.filter((p) => p.userId === userId).length : schlange.length;
}

/** Ein Platz ist frei geworden (Zugende, Rückfrage offen, …): alle Wartenden prüfen erneut. */
export function wecke(): void {
  for (const f of [...wecker]) f();
}

/**
 * Wartet, bis dieser Zug dran ist und `frei()` einen Platz meldet. Ergebnis: 'start' | 'zu' (Verbindung weg) | 'zeit'
 * (länger als maxWarteMs). `melde(pos)` wird bei jeder Positionsänderung aufgerufen (Statuszeile im Chat); ändert sich der
 * Platz lebenszeichenMs() lang nicht, kommt `melde(pos, minuten)` erneut (Lebenszeichen, siehe dort).
 * `ohneDeckel`: Strang- und Worker-Züge enden nie mit 'zeit' (Fehlervariante 2, 06.11.2026) — sie warten, bis sie dran sind;
 * die Verbindungskontrolle (`geschlossen`) bleibt die einzige Abbruchbedingung.
 */
export async function warte(p: Omit<Platz, 'since' | 'grund'>, o: { frei: () => boolean; grund?: () => string; gehalten?: () => boolean; geschlossen: () => boolean; melde: (pos: number, minuten?: number) => void; now?: () => number; takt?: number; ohneDeckel?: boolean }): Promise<'start' | 'zu' | 'zeit'> {
  const now = o.now ?? Date.now;
  const alt = frueher.get(p.key);
  const ankunft = now();
  const platz: Platz = { ...p, since: alt && alt.bis > Date.now() ? alt.since : ankunft };
  frueher.delete(p.key);
  schlange.push(platz);
  speichern();
  let zuletzt = -1, gemeldet = now();
  let gestartet = false;
  try {
    for (;;) {
      if (o.geschlossen()) return 'zu';
      const h = !!o.gehalten?.();
      if (h !== !!platz.gehalten) { platz.gehalten = h; if (!h) wecke(); }
      const pos = position(schlange, p.key, now());
      if (pos === 1 && !startSperre && !drainAb && o.frei()) { gestartet = true; startSperre = true; return 'start'; }
      const g = o.grund?.() ?? platz.grund;
      if (g !== platz.grund) { platz.grund = g; speichern(); }
      if (!o.ohneDeckel && now() - ankunft > maxWarteMs()) return 'zeit';   // Deckel je Verbindung, nicht ab dem gemerkten Platz (Gegenprüfung 05.11.)
      if (pos !== zuletzt) { zuletzt = pos; gemeldet = now(); o.melde(pos); }
      else if (now() - gemeldet >= lebenszeichenMs()) { gemeldet = now(); o.melde(pos, Math.floor((now() - platz.since) / 60_000)); }
      await new Promise<void>((r) => {
        const f = () => { clearTimeout(t); wecker.delete(f); r(); };
        const t = setTimeout(f, Math.min(o.takt ?? 5_000, Math.max(1, gemeldet + lebenszeichenMs() - now())));
        wecker.add(f);
      });
    }
  } finally {
    const i = schlange.indexOf(platz);
    if (i >= 0) schlange.splice(i, 1);
    if (!gestartet) frueher.set(p.key, { since: platz.since, bis: Date.now() + MERKEN_MS });   // wer ohne Start ging (Zeitdeckel, Verbindung weg), behält den Platz
    speichern();
    // Die Nächsten rücken auf. Nach einem Start erst im nächsten Takt: der gestartete Zug muss zuerst als laufend
    // eingetragen sein, sonst hält der Nächste den Platz noch für frei und die Grenze wird überschritten.
    // Gelöst wird die Sperre von angemeldet() (gleich nach dem Eintrag als laufend); die Uhr ist nur der Rückfall.
    if (gestartet) { const t = setTimeout(angemeldet, 2_000); t.unref?.(); } else wecke();
  }
}

/** Abbruch durch Knut (A8/K6): kein gemerkter Platz — wer später neu schreibt, stellt sich hinten an. */
export function vergiss(key: string): void { if (frueher.delete(key)) speichern(); }   // auch auf Platte (Pass B, Fix-Runde 2)

/** Der gestartete Zug ist als laufend eingetragen: Sperre lösen, die Nächsten prüfen erneut. */
export function angemeldet(): void {
  if (!startSperre) return;
  startSperre = false;
  wecke();
}

/** Nur für Tests. */
export function _leeren(): void { schlange.length = 0; wecker.clear(); startSperre = false; frueher.clear(); datei = null; drainAb = false; }
