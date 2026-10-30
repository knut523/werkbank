// Tiefe und ETA je Strang (docs/plan-eta-tiefe.md, Knut 16.10.2026: „je Task auch ein ETA … Aufgaben mit quick oder regular
// oder deep“). Rein (kein Mongo, keine Brücke) — der Orchestrator, die CLI und die Übersicht nutzen dieselben Bausteine.

// live (Plan 274, Knut 20.10.2026): UI-Feedback am laufenden Dev-Server — quick je Runde, einmal „jetzt gründlich“ vor dem Push.
export type Tiefe = 'quick' | 'regular' | 'deep' | 'live';
export const TIEFEN: Tiefe[] = ['quick', 'regular', 'deep', 'live'];
export const TIEFE_VORGABE: Tiefe = 'regular';
/** Vorgabe-Dauer in Minuten, solange es keine Agentenangabe und keinen Median gibt. */
export const ETA_VORGABE_MIN: Record<Tiefe, number> = { quick: 20, regular: 60, deep: 180, live: 30 };
/** Lead-Modell eines quick-Strangs ohne ausdrückliches --modell (klein; Unter-Stränge nie auf dem Lead-Modell glm-5.3). */
export const QUICK_MODELL = 'melious:glm-5.3-flash';

export const istTiefe = (x: unknown): x is Tiefe => TIEFEN.includes(x as Tiefe);
/** Tiefe eines gespeicherten Strangs; alte Stränge ohne Feld laufen wie heute = regular. */
export const tiefeOf = (x: unknown): Tiefe => (istTiefe(x) ? x : TIEFE_VORGABE);

/** Lead-Modell eines regular-Strangs mit niedrigem Risiko ohne ausdrückliches --modell (Knut 26.10.2026: Melious als Standard). */
export const REGULAR_MODELL = 'melious:glm-5.3';
/** Melious-Modelle im Coder-Abo: laufen über Energie statt Guthaben (Knut 26.10.: „beim Coder-Plan bleiben, Energie, kein Geld“). */
export const MELIOUS_ABO_MODELLE = ['glm-5.3', 'glm-5.3-flash', 'deepseek-v4.1-flash', 'deepseek-v4-flash-0731'];
/** Fehlertext für ein Melious-Modell außerhalb des Abos, sonst null. */
export function modellAusserhalbAbo(modell: string | null | undefined): string | null {
  const m = /^melious:(.+)$/.exec(String(modell ?? ''));
  if (!m || m[1] === 'auto' || MELIOUS_ABO_MODELLE.includes(m[1])) return null;
  return `„${m[1]}“ ist nicht im Melious-Abo und liefe auf Guthaben. Erlaubt: ${MELIOUS_ABO_MODELLE.join(', ')}.`;
}

/** Modell und Risiko beim Start: ausdrückliche Angaben schlagen die Vorgabe der Tiefe.
 *  Vorgabe (Knut 26.10., Paket 163): quick → glm-5.3-flash; regular ohne Risiko oder „niedrig“ → glm-5.3 (Risiko niedrig);
 *  regular „mittel“ und deep/„hoch“ → Claude der Brücke (nie herabstufen); live → Claude (Knut wartet davor). */
export function tiefeStart(t: Tiefe, o: { modell?: string | null; risiko?: string | null }): { modell: string | null; risiko: string | null } {
  // live: Risiko wie quick, Modell aber die Vorgabe der Brücke (Claude) — Knut sitzt davor und wartet (Bericht 274, D1).
  const risiko = o.risiko || (t === 'quick' || t === 'live' || t === 'regular' ? 'niedrig' : t === 'deep' ? 'hoch' : null);
  const modell = o.modell || (t === 'quick' ? QUICK_MODELL : t === 'regular' && risiko === 'niedrig' ? REGULAR_MODELL : null);
  return { modell, risiko };
}

/** Absatz für Stränge auf Claude: Zuarbeit an Melious (Abo-Modelle, Energie statt Geld). */
export const MELIOUS_ZUARBEIT_TEXT = 'Zuarbeit an Melious (Knut 26.10.): Lesen, Suchen, Ist-Stand belegen, Zweitmeinung und Logs auswerten per `mel-sub` abgeben — Standard glm-5.3-flash, Massenlesen deepseek-v4.1-flash, Anspruchsvolles `-m glm`. Nur Modelle aus dem Coder-Abo (Energie, kein Guthaben). Deine eigenen Züge nur für Entscheiden und Schreiben; Melious-Antworten gegen den Code prüfen.';

/** Deckel „automatisch weiter“ je Tiefe (Budget): quick ein Drittel, deep das Doppelte. */
export const autoMaxFuer = (t: Tiefe, max: number) => (t === 'quick' || t === 'live' ? Math.max(1, Math.ceil(max / 3)) : t === 'deep' ? max * 2 : max);

/** Absatz im Auftrag: welche Schritte bei dieser Tiefe Pflicht sind. */
export function tiefeText(t: Tiefe): string {
  const kopf = `Tiefe: **${t}** (gewählt beim Start; quick | regular | deep | live).`;
  if (t === 'live') return `${kopf} Live-Modus für UI-Feedback: Knut schaut am laufenden Dev-Server zu und schreibt Rückmeldungen in Runden. Je Runde wie quick: Änderung klein und sofort sichtbar machen (Dev-Server mit Hot Reload laufen lassen, nicht neu bauen, Vorschau-Link nennen), nur die Tests, die die Änderung betreffen, lokal committen — kein Council, kein Pass C, keine Gegenprüfung (challenge), kein Grillen, kurze Antworten. Erst wenn die Nachricht „jetzt gründlich“ kommt: einmal der volle Durchlauf (alle Tests des Repos, Pass A/B/C mit \`challenge\` art=diff, Screenshots, Bericht vollständig), danach „Status: fertig“. Bis dahin endet jede Runde mit „Status: braucht Antwort“.`;
  if (t === 'quick') return `${kopf} Schnell und schlank: kein Council, keine Gegenprüfung (challenge), kein Grillen; nur die Tests des Repos, die deine Änderung betreffen, müssen grün sein. Bericht kurz (Kopf + ein Diagramm + Prüfausgaben). Wird die Aufgabe größer als gedacht, sag das unter „Offen“, statt still auf deep zu gehen.`;
  if (t === 'deep') return `${kopf} Voller plan-to-pr: Plan, Council mit Advocatus Diaboli (zusätzlich \`challenge\` art=council), Pass A/B/C, in Pass C \`challenge\` art=diff mit hoch=true (GLM 5.3), alle Tests des Repos, Visual-Check mit Screenshots bei allem Sichtbaren. Lieber gründlich als schnell.`;
  return `${kopf} plan-to-pr wie gewohnt: kurz planen, bauen, Tests des Repos, Pass A/B/C; in Pass C zusätzlich \`challenge\` art=diff (Gegenprüfung). Council nur bei riskanten oder schwer umkehrbaren Entscheidungen.`;
}

/** „jetzt gründlich“ (Live-Modus): der eine volle Durchlauf vor dem Push — als Nachricht an den Strang (CLI, MCP, Knopf). */
export const GRUENDLICH_TEXT = 'Jetzt gründlich (Live-Modus, Knopf/Befehl „jetzt gründlich“): Die Runden sind durch. Mach jetzt einmal den vollen Durchlauf vor dem Push — alle Tests des Repos und den Build grün, Pass A/B/C, in Pass C zusätzlich `challenge` art=diff (Gegenprüfung gegen die Basis), Visual Review mit Screenshots der geänderten Seiten, Bericht vollständig (Kopf, Diagramm, Prüfausgaben, offene Fragen). Danach „Status: fertig“.';

/** Pflichtzeile im Stand-Block (steht vor „Status:“). */
export const ETA_ZEILE = 'ETA: HH:MM | ~N min   (deine Schätzung, wann du fertig bist; bei jeder Antwort nachziehen — bei „Status: fertig“ keine ETA-Zeile)';

// ---------- Zeit in Wien ----------

const teile = (at: number) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at)).map((p) => [p.type, p.value]));
/** Abstand Wien − UTC in ms zum Zeitpunkt at. */
const versatz = (at: number) => { const p = teile(at); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(at / 60_000) * 60_000; };
/** Uhrzeit HH:MM in Wien. */
export const uhrzeit = (at: number) => { const p = teile(at); return `${p.hour}:${p.minute}`; };

/** Wiener Wanduhr hh:mm am Tag von `bezug` → Zeitpunkt; liegt er > 1 h vor `bezug`, der nächste Tag. */
export function wienUm(hh: number, mm: number, bezug: number): number {
  const p = teile(bezug);
  const roh = Date.UTC(+p.year, +p.month - 1, +p.day, hh, mm);
  let at = roh - versatz(roh);
  if (at < bezug - 3600_000) at = roh + 86400_000 - versatz(roh + 86400_000);
  return at;
}

// ---------- ETA ----------

/**
 * ETA-Zeile einer Antwort (die letzte zählt, wie bei „Status:“): `ETA: 17:30`, `ETA: ~45 min`, `ETA: ca. 2 h`. `at` = Zeitpunkt
 * der Antwort (Bezug für „~N min“ und den Tag). null = keine lesbare Angabe.
 */
export function etaMark(text: string, at: number): number | null {
  const all = [...String(text ?? '').matchAll(/^[\s>*_#-]*ETA[*_]*\s*:\s*[*_]*\s*(.+)$/gim)];
  const v = all.at(-1)?.[1]?.replace(/[*_`]/g, '').trim();
  if (!v) return null;
  // „1.30 h“ ist eine Dauer, keine Uhrzeit (Gegenprüfung Pass C): hinter der Zahl keine Einheit.
  const uhr = v.match(/^(?:ca\.?\s*|~\s*)?([01]?\d|2[0-3])[:.]([0-5]\d)(?!\s*(?:h|std|stunden?|min|minuten)\b)(?:\s*uhr)?\b/i);
  if (uhr) return wienUm(+uhr[1], +uhr[2], at);
  const dauer = v.match(/^(?:ca\.?\s*|~\s*|in\s+)?(\d{1,4}(?:[.,]\d{1,2})?)\s*(min|minuten|m|h|std|stunden?)\b/i);
  if (dauer) {
    const n = Number(dauer[1].replace(',', '.'));
    const min = /^(h|std|stunde)/i.test(dauer[2]) ? n * 60 : n;
    if (min > 0 && min <= 7 * 24 * 60) return at + Math.round(min) * 60_000;
  }
  return null;
}

export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export const MEDIAN_MIN = 3;
const DAUER_MAX = 3 * 86400_000;

/** Median-Dauer (ms) je Tiefe aus erledigten Strängen ({tiefe, startedAt, doneAt}); null = zu wenige Daten. */
export function mediane(docs: { tiefe?: unknown; startedAt?: unknown; doneAt?: unknown }[]): Record<Tiefe, number | null> {
  const by: Record<Tiefe, number[]> = { quick: [], regular: [], deep: [], live: [] };
  for (const d of docs) {
    const ms = new Date(d.doneAt as any).getTime() - new Date(d.startedAt as any).getTime();
    if (ms > 0 && ms <= DAUER_MAX) by[tiefeOf(d.tiefe)].push(ms);
  }
  return Object.fromEntries(TIEFEN.map((t) => [t, by[t].length >= MEDIAN_MIN ? median(by[t]) : null])) as Record<Tiefe, number | null>;
}

export type EtaQuelle = 'agent' | 'median' | 'vorgabe';
export interface Eta { at: number | null; quelle: EtaQuelle | null; text: string; ueberfaellig: boolean }

/** Ist der Strang fertig, gibt es keine ETA (Knut 20.10.2026: „warum gibst du ein ETA mit, wenn Status fertig? weird“) — auch
 *  wenn erst der Agent „Status: fertig“ gemeldet hat (`marke`) oder der Status-Takt den Zustand fertig/erledigt gesetzt hat. */
export const etaFertig = (d: { marke?: unknown; zustand?: unknown }, fertig = false) =>
  fertig || d.marke === 'fertig' || d.zustand === 'fertig' || d.zustand === 'erledigt';

/**
 * ETA eines Strangs: die zuletzt gemeldete des Agenten, sonst Start + Median gleicher Tiefe, sonst Vorgabe. Fertige Stränge
 * (siehe etaFertig) haben keine ETA. Alte Stränge ohne Tiefe und ohne gemeldete ETA: „–“ (keine Migration).
 */
export function etaFuer(d: { tiefe?: unknown; startedAt?: unknown; eta?: { at?: unknown } | null; marke?: unknown; zustand?: unknown }, o: { fertig: boolean; mediane?: Record<Tiefe, number | null> | null; now?: number }): Eta {
  const now = o.now ?? Date.now();
  if (etaFertig(d, o.fertig)) return { at: null, quelle: null, text: '–', ueberfaellig: false };
  let at: number | null = null, quelle: EtaQuelle | null = null;
  const gemeldet = d.eta?.at ? new Date(d.eta.at as any).getTime() : NaN;
  if (Number.isFinite(gemeldet)) { at = gemeldet; quelle = 'agent'; }
  else if (istTiefe(d.tiefe)) {
    const start = new Date(d.startedAt as any).getTime();
    const m = o.mediane?.[d.tiefe] ?? null;
    if (Number.isFinite(start)) { at = start + (m ?? ETA_VORGABE_MIN[d.tiefe] * 60_000); quelle = m ? 'median' : 'vorgabe'; }
  }
  if (at === null) return { at: null, quelle: null, text: '–', ueberfaellig: false };
  return { at, quelle, ...etaAnzeige(at, now) };
}

/** „fertig ca. 17:30“ bzw. „überfällig seit 12 min“ (ab 120 min in Stunden). */
export function etaAnzeige(at: number, now = Date.now()): { text: string; ueberfaellig: boolean } {
  if (now <= at) {
    const heute = teile(now), dann = teile(at);
    const tag = heute.year === dann.year && heute.month === dann.month && heute.day === dann.day ? '' : `${dann.day}.${dann.month}. `;
    return { text: `fertig ca. ${tag}${uhrzeit(at)}`, ueberfaellig: false };
  }
  const min = Math.max(1, Math.round((now - at) / 60_000));
  return { text: `überfällig seit ${min < 120 ? `${min} min` : `${Math.round(min / 60)} h`}`, ueberfaellig: true };
}

export const QUELLE_TEXT: Record<EtaQuelle, string> = { agent: 'Schätzung des Agenten', median: 'Median vergleichbarer Stränge', vorgabe: 'Vorgabe der Tiefe' };
