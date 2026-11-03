// Strangzustand = Wahrheit (R32, Nachtrag 5, Knut 03.11.: „die Werkbank zeigt oft ‚läuft‘, obwohl nichts mehr läuft“). Rein.
// Die Karte las `lastStatus === 'running'` aus der Datenbank (vom Status-Takt, womöglich Minuten alt). Hier gilt der Zustand der Brücke: kein laufender
// Zug (und nicht in der Schlange) = nicht „läuft“ — mit Grund. Ist die Brücke nicht erreichbar, behaupten wir nichts.
import type { StrandState } from './orchestrator.ts';

export interface Korrektur { zustand: 'wartet' | 'abgebrochen'; grund: string }

export function wahrerLauf(d: { lastStatus?: string | null }, s: Pick<StrandState, 'running' | 'interrupted' | 'queued' | 'turn'> | undefined, bridgeOk: boolean): { running: boolean; korrektur: Korrektur | null } {
  const behauptet = d.lastStatus === 'running';
  if (!behauptet) return { running: false, korrektur: null };
  if (!bridgeOk) return { running: true, korrektur: null };
  if (s?.running || s?.queued) return { running: true, korrektur: null };
  if (s?.interrupted) return { running: false, korrektur: { zustand: 'abgebrochen', grund: 'Der Zug wurde abgebrochen (Neustart der Brücke oder Unterbrechung) — kein laufender Zug.' } };
  if (s?.turn) return { running: false, korrektur: { zustand: 'wartet', grund: `Zug beendet${s.turn.outcome ? ` (${s.turn.outcome})` : ''} — kein laufender Zug in der Brücke.` } };
  return { running: false, korrektur: { zustand: 'abgebrochen', grund: 'Kein laufender Zug in der Brücke (Neustart oder Absturz) — der Unter-Chat arbeitet nicht mehr.' } };
}

/** Übergabe an den Hauptchat/eine Person aus dem Stand: „- Übergeben an: Hauptchat — was“ oder „Status: übergeben an …“. */
export function uebergabeAus(excerpt: string | null | undefined): { an: string; was: string } | null {
  const t = String(excerpt ?? '');
  const m = /^[\s>*_-]*[ÜU]e?bergeben an[*_]*\s*:\s*[*_]*\s*(.+)$/im.exec(t) ?? /^[\s>*_-]*Status[*_]*\s*:\s*[*_]*\s*übergeben(?:\s+an\s+(.+))?\s*$/im.exec(t);
  if (!m) return null;
  const [an, ...rest] = String(m[1] ?? 'Hauptchat').split(/\s+[—–-]\s+/);
  return { an: an.replace(/[*_.]+$/g, '').trim() || 'Hauptchat', was: rest.join(' — ').replace(/[*_]+$/g, '').trim() };
}
