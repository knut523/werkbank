// Geheimnisse aus Vaultwarden (Hauptsitzung 06.11., aus githubReadToken herausgelöst): `bw get item <Element>` mit der Sitzung aus
// ~/.config/vw/session, das Muster aus dem Passwortfeld. Nur im Speicher, 10 Minuten; nie ins Frontend, nie ins Log.
// WERKBANK_BW_BIN / WERKBANK_VW_SESSION_DATEI nur für Tests und abweichende Installationen.
import { execFile } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const cache = new Map<string, { wert: string; at: number }>();
export const vwSitzungsDatei = () => process.env.WERKBANK_VW_SESSION_DATEI || join(homedir(), '.config/vw/session');

/** Laufende Abfragen je Element+Muster: gleichzeitige Aufrufe (Einstellungen, Läufe, Preise) teilen sich einen `bw`-Prozess. */
const laufend = new Map<string, Promise<string | null>>();

/** Erster Treffer von `muster` im Passwortfeld des Elements `item`; null ohne Sitzung, bei Fehler oder ohne Treffer. Wirft nie. */
export function bwSecret(item: string, muster: RegExp): Promise<string | null> {
  const c = cache.get(item);
  if (c && Date.now() - c.at < 600_000) { const t = c.wert.match(muster)?.[0]; if (t) return Promise.resolve(t); }
  const k = `${item}\t${muster.source}`;
  const l = laufend.get(k);
  if (l) return l;
  const p = holen(item, muster).finally(() => laufend.delete(k));
  laufend.set(k, p);
  return p;
}

function holen(item: string, muster: RegExp): Promise<string | null> {
  const datei = vwSitzungsDatei();
  let session: string;
  // Phase 4: eine unlesbare Sitzungsdatei ist „keine Sitzung“, kein synchroner Wurf aus einer Promise-Funktion
  try { if (!existsSync(datei)) return Promise.resolve(null); session = readFileSync(datei, 'utf8').trim(); } catch { return Promise.resolve(null); }
  return new Promise((resolve) => {
    // Phase 4: bw bekommt nur, was es braucht — nicht die Schlüssel des Servers aus dessen Umgebung.
    const env: Record<string, string> = { BW_SESSION: session };
    for (const n of ['PATH', 'HOME', 'LANG', 'BITWARDENCLI_APPDATA_DIR', 'NODE_EXTRA_CA_CERTS']) { const v = process.env[n]; if (v) env[n] = v; }
    execFile(process.env.WERKBANK_BW_BIN || 'bw', ['get', 'item', item], { env, timeout: 20_000, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err) return resolve(null);
      let pw = '';
      // `bw get item` sucht auch nach Teilnamen — nur das Element mit genau diesem Namen zählt.
      try { const j = JSON.parse(String(stdout)); if (j.name !== item) return resolve(null); pw = String(j.login?.password ?? ''); } catch { return resolve(null); }
      const t = pw.match(muster)?.[0] ?? '';
      if (!t) return resolve(null);
      cache.set(item, { wert: t, at: Date.now() });
      resolve(t);
    });
  });
}
