// Werkbank-Betrieb aus dem Hauptchat (R31 S3, Abnahme 10 und 16; Knut 02.11.2026): Schalter aus einer Positivliste setzen,
// Neustart mit Drain (ohne den eigenen Hauptchat-Zug), danach laufen Stränge von selbst weiter (orchestrator.ts autoWeiter) —
// und der Stand Soll/Ist ohne Geheimniswerte. Schalter WERKBANK_HAUPTCHAT_BETRIEB=on (Vorgabe aus). Jede schreibende Aktion zeigt
// die Brücke vorher als Karte (Klick); die Route hier verbraucht zusätzlich den Klick-Nachweis.
//
// Sicherheit: Es gibt nur Namen aus SCHALTER und nur aufgezählte Werte (kein Zeilenumbruch, keine Einschleusung). Die Rechte-
// Schalter dieser Werkzeuge selbst (Betrieb, Geheimnis, Coolify) stehen bewusst NICHT auf der Liste — der Hauptchat kann sich keine
// Rechte freischalten. Aus `.env.local` wird nie etwas anderes zurückgegeben als die Werte der Liste.

import { MELIOUS_ABO } from './tiefe.ts';

export const betriebAn = (env: Record<string, string | undefined> = process.env) => env.WERKBANK_HAUPTCHAT_BETRIEB === 'on';

export type Prozess = 'web' | 'bruecke' | 'beide';
export interface Schalter { name: string; werte: readonly string[] | 'prozent'; prozess: Prozess; vorgabe: string; text: string }

const ONOFF = ['on', 'off'] as const;
const MODELLE = ['claude', 'auto', ...MELIOUS_ABO.map((m) => `melious:${m}`)];

/** Positivliste (Paket 400, Schnitt 1 + Nachträge). Neue Einträge nur per Review/Release. */
export const SCHALTER: readonly Schalter[] = [
  { name: 'WERKBANK_HAUPTCHAT_GITHUB', werte: ONOFF, prozess: 'beide', vorgabe: 'off', text: 'GitHub schreiben aus dem Hauptchat (Karte + Klick)' },
  { name: 'WERKBANK_FIX_FREIGABE', werte: ['off', 'on', 'auto'], prozess: 'web', vorgabe: 'off', text: '@fix: Freigabe durch den Hauptchat; auto = Push bei grünem Gate' },
  { name: 'WERKBANK_BRAUCHT_DICH', werte: ['an', 'aus'], prozess: 'web', vorgabe: 'aus', text: '„Braucht dich“ klassifizieren und veraltete Karten schließen' },
  { name: 'WERKBANK_UEBERGABE_LESBAR', werte: ONOFF, prozess: 'web', vorgabe: 'off', text: 'Lesbare Übergabe beim Hauptchat-Neustart' },
  { name: 'WERKBANK_PR_TICKER', werte: ONOFF, prozess: 'web', vorgabe: 'on', text: 'PR-Ticker (@review/@fix-Tags)' },
  { name: 'BRIDGE_LEIT_VAULT_COMMIT', werte: ONOFF, prozess: 'bruecke', vorgabe: 'off', text: 'Vault-Commit aus dem Hauptchat (Karte + Klick)' },
  { name: 'BRIDGE_LESER_ERWEITERT', werte: ONOFF, prozess: 'bruecke', vorgabe: 'off', text: 'Leser-Stränge mit erweiterter Erlaubnisliste' },
  { name: 'BRIDGE_MEL_SUB', werte: ONOFF, prozess: 'bruecke', vorgabe: 'on', text: 'melious_sub (Zuarbeit über jcode)' },
  { name: 'WERKBANK_REGULAR_MODELL', werte: MODELLE, prozess: 'web', vorgabe: 'melious:glm-5.3', text: 'Lead-Modell regular/niedrig (claude | auto | melious:<Abo>)' },
  { name: 'WERKBANK_QUICK_MODELL', werte: MODELLE, prozess: 'web', vorgabe: 'melious:glm-5.3-flash', text: 'Lead-Modell quick (claude | auto | melious:<Abo>)' },
  { name: 'WERKBANK_ZUARBEIT', werte: ['melious', 'claude', 'auto'], prozess: 'web', vorgabe: 'melious', text: 'Zuarbeit/lesende Teilagenten' },
  { name: 'WERKBANK_KONTINGENT_SCHWELLE', werte: 'prozent', prozess: 'web', vorgabe: '20', text: 'auto: Melious-Rest in %, ab dem auf Claude gewechselt wird' },
  { name: 'WERKBANK_DATEIEN_CHAT', werte: ONOFF, prozess: 'web', vorgabe: 'off', text: 'datei_teilen und screenshot im Hauptchat' },
];

/** Nie über werkbank_betrieb setzbar (Rechte dieser Werkzeuge, Zugangsdaten). Prüfung zusätzlich zur Liste — falls jemand sie erweitert. */
const NIE = /^(WERKBANK_HAUPTCHAT_BETRIEB|WERKBANK_GEHEIMNIS.*|WERKBANK_COOLIFY.*|.*(TOKEN|KEY|SECRET|PASS|CREDS|AUTH).*)$/;

export const schalterVon = (name: string) => (NIE.test(name) ? undefined : SCHALTER.find((s) => s.name === name));

/** Wert prüfen: geprüfter Wert oder Fehlertext. */
export function pruefeWert(name: string, wert: unknown): { wert: string } | { fehler: string } {
  const s = schalterVon(String(name ?? ''));
  if (!s) return { fehler: `${String(name ?? '') || 'Schalter'} ist nicht freigegeben. Erlaubt: ${SCHALTER.map((x) => x.name).join(', ')}.` };
  const w = String(wert ?? '').trim();
  if (s.werte === 'prozent') return /^\d{1,3}$/.test(w) && Number(w) <= 100 ? { wert: String(Number(w)) } : { fehler: `${s.name}: Zahl 0–100.` };
  return s.werte.includes(w) ? { wert: w } : { fehler: `${s.name}: nur ${s.werte.join(' | ')}.` };
}

const zeileVon = (name: string) => new RegExp(String.raw`^[ \t]*(?:export[ \t]+)?${name}[ \t]*=.*$`, 'gm');

/** Wert eines Namens in einer `.env`-Datei (letzte Zeile gewinnt wie beim `source`), Anführungszeichen entfernt; null = nicht gesetzt. */
export function envWert(text: string, name: string): string | null {
  const alle = [...text.matchAll(zeileVon(name))];
  if (!alle.length) return null;
  const roh = alle[alle.length - 1][0].replace(/^[^=]*=/, '').trim();
  const q = roh.match(/^(['"])(.*)\1$/);
  return q ? q[2] : roh.replace(/[ \t]+#.*$/, '');
}

/** Eine Zeile setzen: alle bisherigen Zeilen des Namens fallen weg, die neue steht an der Stelle der ersten (sonst am Ende). */
export function envSetzen(text: string, name: string, wert: string): string {
  // Eigene Prüfung unabhängig vom Aufrufer (Gegenprüfung R31): nur Variablennamen, Werte einzeilig.
  if (!/^[A-Z][A-Z0-9_]{0,80}$/.test(name) || /[\r\n\0]/.test(wert)) throw new Error('envSetzen: ungültiger Name oder Wert.');
  const neu = `${name}=${wert}`;
  let gesetzt = false;
  const aus = text.replace(zeileVon(name), () => (gesetzt ? '\u0000' : ((gesetzt = true), neu))).split('\n').filter((l) => l !== '\u0000');
  let t = aus.join('\n');
  if (!gesetzt) t = `${t.replace(/\n*$/, '')}${t.trim() ? '\n' : ''}${neu}\n`;
  return t.endsWith('\n') ? t : `${t}\n`;
}

/** Welcher Neustart nötig ist, wenn diese Schalter geändert werden. */
export function neustartFuer(namen: string[]): 'restart-web' | 'restart' {
  return namen.some((n) => schalterVon(n)?.prozess !== 'web') ? 'restart' : 'restart-web';
}

export type BetriebAktion =
  | { art: 'schalter_setzen'; schalter: Record<string, string>; neustart: boolean }
  | { art: 'neustart_web' }
  | { art: 'neustart' };

/** Aktion aus dem Werkzeugaufruf prüfen (höchstens 8 Schalter je Aufruf). */
export function pruefeBetrieb(a: Record<string, unknown>): BetriebAktion | { fehler: string } {
  if (a.art === 'neustart_web' || a.art === 'neustart') return { art: a.art };
  if (a.art !== 'schalter_setzen') return { fehler: 'art: schalter_setzen, neustart_web oder neustart.' };
  const roh = a.schalter && typeof a.schalter === 'object' && !Array.isArray(a.schalter) ? Object.entries(a.schalter as Record<string, unknown>) : [];
  if (!roh.length || roh.length > 8) return { fehler: 'schalter: 1–8 Einträge { NAME: wert }.' };
  const schalter: Record<string, string> = {};
  for (const [n, w] of roh) {
    const p = pruefeWert(n, w);
    if ('fehler' in p) return p;
    schalter[n] = p.wert;
  }
  return { art: 'schalter_setzen', schalter, neustart: a.neustart !== false };
}

// ---------- Stand ----------

/** Live-Commit-Betreff (beide Formate: „Live = release/… (werkbank-… sha)“ und „Live = Release 30 (release/… sha): …“). */
export function liveAus(betreff: string): { release: string; sha: string; titel: string } | null {
  const m = betreff.match(/^Live = (?:(Release [^(]+?) )?\(?(release\/[\w./-]+)[ (]+(?:werkbank-[\w-]+ )?([0-9a-f]{7,40})\)/);
  return m ? { release: m[2], sha: m[3], titel: (m[1] ?? m[2]).trim() } : null;
}

/** Wertklasse für die Anzeige eines Prozess-Werts: aufgezählte Werte bleiben, alles andere heißt „gesetzt“. */
export const wertKlasse = (v: string | undefined | null): string => (v === undefined || v === null || v === '' ? '—'
  : /^(on|off|an|aus|auto|0|1|claude|melious(:[\w.-]{1,40})?|\d{1,3})$/.test(v) ? v : 'gesetzt');

export interface SchalterStand { name: string; vorgabe: string; soll: string | null; ist: string; prozess: Prozess; neustart: boolean }

/** Je Schalter der Liste: Soll (.env.local), Ist (laufender Prozess), ob ein Neustart nötig ist (rein). */
export function schalterStand(envText: string | null, istWeb: Record<string, string | undefined>, istBruecke: Record<string, string> | null): SchalterStand[] {
  return SCHALTER.map((s) => {
    // Gegenprüfung R31: auch der Soll-Wert nur als Wertklasse — ein Geheimnis unter einem Schalternamen bleibt verborgen.
    const roh = envText === null ? null : envWert(envText, s.name);
    const soll = roh === null ? null : wertKlasse(roh);
    const effSoll = soll ?? s.vorgabe;
    const istW = wertKlasse(istWeb[s.name]);
    const istB = istBruecke ? wertKlasse(istBruecke[s.name]) : '?';
    const ist = s.prozess === 'web' ? istW : s.prozess === 'bruecke' ? istB : istW === istB || istB === '?' ? istW : `Web ${istW} · Brücke ${istB}`;
    const eff = (x: string) => (x === '—' ? s.vorgabe : x);
    const neustart = envText !== null && ((s.prozess !== 'bruecke' && eff(istW) !== effSoll) || (s.prozess !== 'web' && istBruecke !== null && eff(istB) !== effSoll));
    return { name: s.name, vorgabe: s.vorgabe, soll, ist, prozess: s.prozess, neustart };
  });
}

export interface StandEingabe {
  live: { release: string; sha: string; titel: string } | null;
  instanzKopf: string | null;
  releaseKopf: string | null;     // Kopf des Release-Zweigs im Quell-Repo
  releaseVoraus: number | null;   // Commits im Release-Zweig, die nicht live sind
  schmutzig: number | null;       // geänderte Dateien in der Live-Instanz (Anzahl, keine Namen)
  schalter: SchalterStand[];
  web: { seitS: number };
  bruecke: { erreichbar: boolean; laufend?: number; schlange?: number; seitS?: number } | null;
}

const dauer = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${Math.round(s / 360) / 10} h` : `${Math.round(s / 8640) / 10} d`);

/** Text für den Hauptchat (rein): Live vs. Release, Schalter Soll/Ist, Prozesse. Nie Werte außerhalb der Liste. */
export function standText(e: StandEingabe): string {
  const z: string[] = ['**Werkbank-Stand (Soll/Ist, ohne Geheimniswerte)**', ''];
  if (!e.live) z.push('- Live: kein „Live = …“-Commit in der Instanz gefunden.');
  else {
    const gleich = e.releaseKopf && e.releaseKopf.startsWith(e.live.sha);
    z.push(`- Live: ${e.live.titel} = \`${e.live.release}\` @ \`${e.live.sha}\`${e.instanzKopf ? ` (Instanz-Kopf \`${e.instanzKopf.slice(0, 7)}\`)` : ''}`);
    z.push(`- Release-Zweig: ${e.releaseKopf ? `Kopf \`${e.releaseKopf.slice(0, 7)}\` — ${gleich ? 'live = Release-Kopf ✅' : `${e.releaseVoraus ?? '?'} Commit(s) noch nicht live ⚠️`}` : 'im Quell-Repo nicht gefunden'}`);
  }
  if (e.schmutzig) z.push(`- ⚠️ Live-Instanz hat ${e.schmutzig} geänderte Datei(en) außerhalb von Git.`);
  z.push(`- Web: läuft seit ${dauer(e.web.seitS)} · Brücke: ${!e.bruecke ? 'unbekannt' : e.bruecke.erreichbar ? `erreichbar, ${e.bruecke.laufend ?? '?'} laufende Züge, Schlange ${e.bruecke.schlange ?? '?'}${e.bruecke.seitS !== undefined ? `, seit ${dauer(e.bruecke.seitS)}` : ''}` : 'NICHT erreichbar ❌'}`);
  z.push('', '| Schalter | Vorgabe | Soll (.env.local) | Ist (läuft) | |', '|---|---|---|---|---|');
  for (const s of e.schalter) z.push(`| \`${s.name}\` | ${s.vorgabe} | ${s.soll ?? '— (Vorgabe)'} | ${s.ist} | ${s.neustart ? `Neustart nötig (${s.prozess === 'web' ? 'restart-web' : 'restart'})` : ''} |`);
  const n = e.schalter.filter((s) => s.neustart);
  if (n.length) z.push('', `Neustart nötig für: ${n.map((s) => s.name).join(', ')} → werkbank_betrieb art=${neustartFuer(n.map((s) => s.name)) === 'restart' ? 'neustart' : 'neustart_web'}.`);
  return z.join('\n');
}
