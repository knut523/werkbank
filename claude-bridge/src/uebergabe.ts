// Automatische Übergabe bei großem Kontext (wb21 Paket G, Knut: „V2 ersetzt den Terminal-Chat“). Ist der Kontext der laufenden
// Sitzung ab BRIDGE_UEBERGABE_TOKENS (Vorgabe 150 000) gefüllt, beginnt der NÄCHSTE Zug in einer frischen Sitzung — mit einem
// Statusblock (Ziel, DoD wörtlich, Stand, offene Punkte, Dateien) statt des Verlaufs. Eine Implementierung für Hauptchat, Stränge
// und eigene Chats. Abschaltung: BRIDGE_UEBERGABE=aus. ponytail: der Block entsteht aus dem, was die Brücke ohnehin kennt
// (erste Nachricht, letzte Antwort, geschriebene Dateien) — kein zusätzlicher Modellaufruf.

import { readFileSync, writeFileSync, renameSync } from 'node:fs';

type Env = Record<string, string | undefined>;
export const uebergabeAn = (env: Env = process.env) => String(env.BRIDGE_UEBERGABE ?? '').trim().toLowerCase() !== 'aus';
export const uebergabeGrenze = (env: Env = process.env) => { const n = Number(env.BRIDGE_UEBERGABE_TOKENS); return Number.isFinite(n) && n >= 10_000 ? Math.floor(n) : 150_000; };

/** Kontextgröße einer Assistenten-Nachricht (Eingabe inkl. Cache-Lesen/-Schreiben) — das, was die Sitzung beim nächsten Zug mitträgt. */
export const kontextVon = (usage: any): number => (Number(usage?.input_tokens) || 0) + (Number(usage?.cache_read_input_tokens) || 0) + (Number(usage?.cache_creation_input_tokens) || 0);

export const sollUebergeben = (ctx: number | undefined, env: Env = process.env) => uebergabeAn(env) && !!ctx && ctx >= uebergabeGrenze(env);

/** DoD wörtlich: der Abschnitt „DoD“/„Definition of Done“/„Fertig heißt“ aus dem Auftrag (bis zur nächsten Überschrift), sonst null. */
export function dodWoertlich(auftrag: string): string | null {
  const lines = auftrag.split('\n');
  const i = lines.findIndex((l) => /^\s*(#{1,6}\s*|\*\*)?(DoD|Definition of Done|Fertig heißt|Fertig ist)\b/i.test(l));
  if (i < 0) return null;
  const out = [lines[i]];
  for (const l of lines.slice(i + 1)) { if (/^#{1,6}\s/.test(l) || (!l.trim() && out.length > 1 && /^\s*$/.test(out[out.length - 1]))) break; out.push(l); }
  return out.join('\n').trim().slice(0, 3000) || null;
}

/** Offene Punkte aus der letzten Antwort: Checkbox-Zeilen „- [ ]“ und Zeilen mit „offen“/„TODO“/„noch“. */
export function offenePunkte(antwort: string): string[] {
  return antwort.split('\n').map((l) => l.trim()).filter((l) => /^[-*]\s*\[ \]/.test(l) || /\b(offen|TODO|noch nicht|fehlt noch)\b/i.test(l)).slice(0, 15).map((l) => l.slice(0, 240));
}

export interface Stand { ctx: number; letzte: string; n?: number }
export type StandMap = Record<string, Stand & { erst: string }>;

/** Zähler (Kontextgröße, Zahl der Übergaben, letzte Antwort, erste Nachricht) liegen neben sessions.json und überleben den Neustart. */
export function ladeStand(file: string): StandMap {
  try { const j = JSON.parse(readFileSync(file, 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
}
export function speichereStand(file: string, m: StandMap): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(m));
  renameSync(tmp, file);
}
export function statusblock(o: { auftrag: string; letzte: string; dateien: string[]; ctx: number }): string {
  const dod = dodWoertlich(o.auftrag);
  const offen = offenePunkte(o.letzte);
  return [
    `Frische Sitzung: der Kontext der vorigen Sitzung war bei ${Math.round(o.ctx / 1000)}k Tokens (Grenze ${Math.round(uebergabeGrenze() / 1000)}k). Der Chatverlauf ist absichtlich nicht dabei; arbeite auf Grundlage dieses Statusblocks weiter und lies die genannten Dateien bei Bedarf selbst nach.`,
    '', '## Ziel', o.auftrag.slice(0, 4000).trim() || '(nicht gespeichert)',
    '', '## DoD (wörtlich)', dod ?? '(im Auftrag nicht ausdrücklich genannt — Ziel gilt)',
    '', '## Stand (letzte Antwort der vorigen Sitzung)', o.letzte.slice(-3000).trim() || '(keine)',
    '', '## Offene Punkte', offen.length ? offen.map((x) => `- ${x}`).join('\n') : '(keine ausdrücklich genannt)',
    '', '## Dateien (in der vorigen Sitzung geschrieben)', o.dateien.length ? o.dateien.slice(-30).map((x) => `- ${x}`).join('\n') : '(keine)',
  ].join('\n');
}

/** Hinweis im Chat (sichtbar, kursiv wie die anderen Statuszeilen). */
export const uebergabeHinweis = (ctx: number) => `🔀 Kontext bei ${Math.round(ctx / 1000)}k Tokens — neue Sitzung mit Statusblock (Ziel, DoD, Stand, offene Punkte, Dateien); der Verlauf ist nicht mehr dabei.`;
