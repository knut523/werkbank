// Geheimnis-Vermittler (R31 S3, Abnahme 4 und 9; Paket 400 D2): Der Hauptchat darf einen Vaultwarden-Eintrag für einen BENANNTEN
// Zweck NUTZEN — die Web-App holt den Wert und führt genau den freigegebenen HTTP-Aufruf selbst aus. Der Wert geht nie ins Modell,
// nie ins Log, nie in die Antwort (zusätzlich geschwärzt: roh, URL- und Base64-kodiert). Jeder Aufruf ist vorher eine Karte mit
// Klick (Brücke) und verbraucht den Klick-Nachweis (Route). Schalter WERKBANK_GEHEIMNIS=on, Vorgabe aus.
//
// Positivliste ZWECKE im Code (Review + Release); Erweiterung nur über WERKBANK_GEHEIMNIS_ZWECKE (JSON in .env.local, das der
// Hauptchat weder lesen noch über werkbank_betrieb setzen kann). Je Zweck: Eintrag + Feld, Hosts (exakt, nur https), Methoden.

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const geheimnisAn = (env: Record<string, string | undefined> = process.env) => env.WERKBANK_GEHEIMNIS === 'on';

export interface Zweck {
  name: string;
  eintrag: string;              // Name des Vaultwarden-Eintrags
  feld: string;                 // Feld: Name eines eigenen Felds, „password“ (login.password) oder „notes“
  hosts: string[];              // erlaubte Ziel-Hosts (exakt)
  methoden: string[];           // erlaubte HTTP-Methoden
  header: string;               // Header-Name
  format: string;               // Header-Wert, {} = Geheimnis (z. B. „Bearer {}“)
  text: string;
}

/** Zwecke ab Werk (Knut 02.11.: Coolify-Bot, Token testen). */
export const ZWECKE: readonly Zweck[] = [
  { name: 'coolify', eintrag: 'Coolify API token (coder-workspaces)', feld: 'token', hosts: ['coolify.konekto.energy'], methoden: ['GET', 'POST', 'PATCH', 'DELETE'], header: 'Authorization', format: 'Bearer {}', text: 'Coolify-API (Variablen, Neustart, Deploy der freigegebenen Apps)' },
  { name: 'github-lesen', eintrag: 'View only github API', feld: 'password', hosts: ['api.github.com'], methoden: ['GET'], header: 'Authorization', format: 'Bearer {}', text: 'GitHub-Lesetoken testen (nur GET)' },
];

const NAME = /^[a-z][a-z0-9-]{1,40}$/;
const HOST = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const METHODEN = ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'];

/** Zusätzliche Zwecke aus WERKBANK_GEHEIMNIS_ZWECKE (JSON-Liste), streng geprüft; Ungültiges fällt still weg (Log beim Aufrufer). */
export function zweckeAus(env: Record<string, string | undefined> = process.env): Zweck[] {
  let extra: any[] = [];
  try { const j = JSON.parse(env.WERKBANK_GEHEIMNIS_ZWECKE || '[]'); extra = Array.isArray(j) ? j : []; } catch { extra = []; }
  const ok = extra.filter((z) => z && NAME.test(String(z.name)) && typeof z.eintrag === 'string' && z.eintrag.length <= 120 && /^[\w.-]{1,40}$/.test(String(z.feld ?? ''))
    && Array.isArray(z.hosts) && z.hosts.length && z.hosts.every((h: unknown) => typeof h === 'string' && HOST.test(h))
    && Array.isArray(z.methoden) && z.methoden.length && z.methoden.every((m: unknown) => METHODEN.includes(String(m)))
    && /^[A-Za-z][\w-]{0,40}$/.test(String(z.header ?? 'Authorization')) && String(z.format ?? '{}').includes('{}') && !/[\r\n]/.test(String(z.format ?? '')))
    .map((z) => ({ name: z.name, eintrag: z.eintrag, feld: z.feld, hosts: z.hosts, methoden: z.methoden, header: z.header ?? 'Authorization', format: z.format ?? '{}', text: String(z.text ?? '').slice(0, 200) }));
  return [...ZWECKE, ...ok.filter((z) => !ZWECKE.some((w) => w.name === z.name))];
}

export interface Aufruf { zweck: string; methode: string; url: string; body?: string; contentType?: string }

/** Aufruf prüfen: Zweck bekannt, https, Host exakt erlaubt, kein Port/Nutzer in der URL, Methode erlaubt, Body ≤ 100 kB. */
export function pruefeAufruf(a: Record<string, unknown>, zwecke: Zweck[]): { aufruf: Aufruf; zweck: Zweck } | { fehler: string } {
  const z = zwecke.find((x) => x.name === String(a.zweck ?? ''));
  if (!z) return { fehler: `zweck: unbekannt. Freigegeben: ${zwecke.map((x) => x.name).join(', ')}.` };
  const methode = String(a.methode ?? 'GET').toUpperCase();
  if (!z.methoden.includes(methode)) return { fehler: `methode: für „${z.name}“ nur ${z.methoden.join(', ')}.` };
  let u: URL;
  try { u = new URL(String(a.url ?? '')); } catch { return { fehler: 'url: keine gültige Adresse.' }; }
  if (u.protocol !== 'https:') return { fehler: 'url: nur https.' };
  if (u.username || u.password || u.port) return { fehler: 'url: ohne Port und ohne Zugangsdaten.' };
  if (!z.hosts.includes(u.hostname)) return { fehler: `url: Host ${u.hostname} ist für „${z.name}“ nicht freigegeben (${z.hosts.join(', ')}).` };
  const body = a.body === undefined || a.body === null || a.body === '' ? undefined : typeof a.body === 'string' ? a.body : JSON.stringify(a.body);
  if (body !== undefined && (methode === 'GET' || body.length > 100_000)) return { fehler: 'body: nicht bei GET, höchstens 100 000 Zeichen.' };
  const contentType = body === undefined ? undefined : /^[\w.+-]+\/[\w.+-]+$/.test(String(a.contentType ?? '')) ? String(a.contentType) : 'application/json';
  return { aufruf: { zweck: z.name, methode, url: u.toString(), ...(body !== undefined ? { body, contentType } : {}) }, zweck: z };
}

/** Den Wert (roh, URL-kodiert, Base64) aus einem Text entfernen. Kurze Werte (< 6) werden nicht gesucht — dort gibt es nichts zu schwärzen, was nicht ohnehin überall stünde. */
export function schwaerze(text: string, wert: string): string {
  if (!wert || wert.length < 6) return text;
  let t = text;
  for (const v of new Set([wert, encodeURIComponent(wert), Buffer.from(wert).toString('base64'), Buffer.from(wert).toString('base64url'), Buffer.from(wert).toString('hex')]))
    t = t.split(v).join('«geschwärzt»');
  return t;
}

/** Feld aus der JSON-Antwort von `bw get item` (rein). */
export function feldAus(item: any, feld: string): string | null {
  if (!item || typeof item !== 'object') return null;
  if (feld === 'password') return typeof item.login?.password === 'string' && item.login.password ? item.login.password : null;
  if (feld === 'notes') return typeof item.notes === 'string' && item.notes ? item.notes : null;
  const f = (Array.isArray(item.fields) ? item.fields : []).find((x: any) => x?.name === feld);
  return typeof f?.value === 'string' && f.value ? f.value : null;
}

/** Wert aus dem Vaultwarden der VM (Sitzung aus ~/.config/vw/session, wie creds.ts). Nur im Speicher, kein Cache. */
export function vaultwardenWert(eintrag: string, feld: string): Promise<string | null> {
  const sessionFile = join(homedir(), '.config/vw/session');
  if (!existsSync(sessionFile)) return Promise.resolve(null);
  const session = readFileSync(sessionFile, 'utf8').trim();
  return new Promise((resolve) => {
    execFile('bw', ['get', 'item', eintrag], { env: { ...process.env, BW_SESSION: session }, timeout: 20_000, maxBuffer: 1 << 20 }, (err, stdout) => {
      if (err) return resolve(null);
      try { resolve(feldAus(JSON.parse(String(stdout)), feld)); } catch { resolve(null); }
    });
  });
}

export interface Antwort { status: number; text: string }

/** Den geprüften Aufruf ausführen: Wert holen, genau diese URL, keine Weiterleitung, Antwort geschwärzt und gekürzt. */
export async function fuehreAus(p: { aufruf: Aufruf; zweck: Zweck }, deps: { wert: (eintrag: string, feld: string) => Promise<string | null>; fetch?: typeof fetch } = { wert: vaultwardenWert }): Promise<Antwort> {
  const wert = await deps.wert(p.zweck.eintrag, p.zweck.feld);
  if (!wert) throw new Error(`Kein Wert für „${p.zweck.name}“ (Vaultwarden-Sitzung abgelaufen oder Eintrag/Feld fehlt) — Knut: bw unlock auf der VM.`);
  // Gegenprüfung R31: zu kurze Werte ließen sich nicht verlässlich schwärzen — dann lieber gar nicht senden.
  if (wert.length < 8) throw new Error(`Wert für „${p.zweck.name}“ ist kürzer als 8 Zeichen — nicht gesendet (Schwärzen wäre unsicher).`);
  const f = deps.fetch ?? fetch;
  const r = await f(p.aufruf.url, {
    method: p.aufruf.methode, redirect: 'manual', signal: AbortSignal.timeout(30_000),
    headers: { [p.zweck.header]: p.zweck.format.replace('{}', wert), accept: 'application/json', ...(p.aufruf.body !== undefined ? { 'content-type': p.aufruf.contentType ?? 'application/json' } : {}) },
    ...(p.aufruf.body !== undefined ? { body: p.aufruf.body } : {}),
  });
  const roh = await r.text().catch(() => '');
  const text = schwaerze(roh, wert);
  return { status: r.status, text: text.length > 20_000 ? `${text.slice(0, 20_000)}\n… (gekürzt, ${text.length} Zeichen)` : text };
}
