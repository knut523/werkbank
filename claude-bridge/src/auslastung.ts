// Claude-Auslastung für den Lead (Knut 19.10.: „nativ mehr auf Melious und Claude verteilen“, „Auslastung im Lead sichtbar“).
// Quelle ist cswap auf der VM (`cswap list --json`, Knuts Claude-Konten): 5-Stunden- und Wochenfenster des aktiven Kontos.
// Die Stufen sind dieselben wie im Melious-Plugin (mel-last): grün < 60 %, gelb ≥ 60 % oder vor dem Wochenplan, rot ≥ 85 %.
// Gelesen wird höchstens alle 5 Minuten; ohne cswap oder bei Fehlern heißt die Stufe „unbekannt“ — die Sitzung wartet nie darauf.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type Stufe = 'gruen' | 'gelb' | 'rot' | 'unbekannt';
export interface Auslastung { stufe: Stufe; fuenfH: number | null; siebenT: number | null; vorPlan: boolean; reset: string | null; konto: string | null; freieKonten: number; grund: string | null }

const zahl = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);

/** Antwort von `cswap list --json` → Auslastung (rein). */
export function auslastungAus(d: any, o: { gelb?: number; rot?: number } = {}): Auslastung {
  const gelb = o.gelb ?? 60, rot = o.rot ?? 85;
  const accs: any[] = Array.isArray(d?.accounts) ? d.accounts : [];
  const act = accs.find((a) => a?.active);
  if (!act?.usage) return { stufe: 'unbekannt', fuenfH: null, siebenT: null, vorPlan: false, reset: null, konto: null, freieKonten: 0, grund: act ? 'aktives Konto ohne Nutzungsdaten' : 'kein aktives Konto' };
  const u = act.usage;
  const fuenfH = zahl(u.fiveHour?.pct), siebenT = zahl(u.sevenDay?.pct), vorPlan = !!u.sevenDay?.aheadOfPace;
  const freieKonten = accs.filter((a) => !a?.active && a?.usage && (zahl(a.usage.fiveHour?.pct) ?? 100) < gelb).length;
  const p = fuenfH ?? 0;
  const stufe: Stufe = p >= rot ? 'rot' : p >= gelb || vorPlan ? 'gelb' : 'gruen';
  return { stufe, fuenfH, siebenT, vorPlan, reset: typeof u.fiveHour?.clock === 'string' ? u.fiveHour.clock.slice(0, 20) : null, konto: String(act.alias ?? `Konto ${act.number ?? '?'}`).slice(0, 40), freieKonten, grund: null };
}

export const STUFE_TEXT: Record<Stufe, string> = { gruen: 'grün', gelb: 'gelb', rot: 'rot', unbekannt: 'unbekannt' };
/** Was die Stufe für die Verteilung heißt (wie mel-last), kurz. */
export const STUFE_REGEL: Record<Stufe, string> = {
  gruen: 'Lesen, Recherche und Gegenprüfen über Melious; Claude für Code, Entscheidungen und den Hauptfaden',
  gelb: 'alle Teilaufgaben über Melious; Claude nur für Hauptfaden, Code und Entscheidungen',
  rot: 'auch Entwürfe über Melious; Claude nur noch für Entscheidungen und Commits',
  unbekannt: 'Lesen, Recherche und Gegenprüfen trotzdem über Melious',
};

/** Statuszeile für den Lead. */
export function auslastungZeile(a: Auslastung, mel?: { rest?: number | null } | null): string {
  const claude = a.stufe === 'unbekannt' ? `Claude-Auslastung unbekannt (${a.grund ?? 'cswap'})`
    : `Claude 5 h ${a.fuenfH ?? '?'} %${a.reset ? ` (frei ab ${a.reset})` : ''} · Woche ${a.siebenT ?? '?'} %${a.vorPlan ? ' (vor Plan)' : ''}`;
  const rest = mel && typeof mel.rest === 'number' ? ` · Melious-Rest ${Math.round(mel.rest).toLocaleString('de-DE')}` : mel === null ? ' · Melious nicht verfügbar' : '';
  const wechsel = a.stufe === 'rot' && a.freieKonten ? ' · ein anderes Claude-Konto hat Luft (cswap switch)' : '';
  return `📊 ${claude} · Stufe ${STUFE_TEXT[a.stufe]}: ${STUFE_REGEL[a.stufe]}${rest}${wechsel}`;
}

const CSWAP = () => process.env.BRIDGE_CSWAP_BIN || join(homedir(), '.local', 'bin', 'cswap');
let cache: { at: number; wert: Auslastung } | null = null;

/** Auslastung, höchstens alle 5 Minuten neu gelesen. */
export async function auslastung(now = Date.now()): Promise<Auslastung> {
  if (cache && now - cache.at < 5 * 60_000) return cache.wert;
  const bin = CSWAP();
  const wert: Auslastung = !existsSync(bin)
    ? { stufe: 'unbekannt', fuenfH: null, siebenT: null, vorPlan: false, reset: null, konto: null, freieKonten: 0, grund: 'cswap nicht installiert' }
    : await new Promise<Auslastung>((res) => execFile(bin, ['list', '--json'], { timeout: 20_000, maxBuffer: 1 << 20 }, (err, out) => {
      if (err) return res({ stufe: 'unbekannt', fuenfH: null, siebenT: null, vorPlan: false, reset: null, konto: null, freieKonten: 0, grund: 'cswap ohne Antwort' });
      try { res(auslastungAus(JSON.parse(String(out)), { gelb: Number(process.env.MELIOUS_GELB) || 60, rot: Number(process.env.MELIOUS_ROT) || 85 })); }
      catch { res({ stufe: 'unbekannt', fuenfH: null, siebenT: null, vorPlan: false, reset: null, konto: null, freieKonten: 0, grund: 'cswap-Ausgabe unlesbar' }); }
    }));
  cache = { at: now, wert };
  return wert;
}
/** Nur für Tests. */
export const auslastungVergessen = () => { cache = null; };
