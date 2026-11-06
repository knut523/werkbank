// Klickwerkzeug für jcode-Leser (Konzept J3, Hauptsitzung 06.11.: „Klickwerkzeug (Playwright) für jcode/OC2 nur gegen
// Test-Instanzen und Vorschau-Ports (localhost, 3436, 8110/8111, Test-Admin), nie Produktion, keine echten Logins außer
// Testkonten; Allowlist der Ziele im Code“). Der jcode-Wächter (jcode-bash-guard.ts) startet es nur, wenn die Brücke den Worker
// mit klick=true gestartet hat; Bilder landen nur im Arbeitsordner (WERKBANK_KLICK_AUS), jede Anfrage der Seite an ein anderes
// Ziel bricht ab.
//
//   klick <persona|-> <d|m> <url> [aktion …]
//   Aktionen: warte:<ms> · klick:<text> · rolle:<rolle>=<name> · tippe:<selektor>=<text> · text:<selektor> · bild:<name> · voll
// ponytail: OC2 hat keine Shell — Klick-Aufträge laufen deshalb immer über jcode (runWorkerJcode); ein eigenes OC2-Werkzeug erst,
// wenn Persona-Runden über ~5 parallel gebraucht werden.
import { readFileSync, mkdirSync, realpathSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Erlaubte Ziele — fest im Code, keine Umgebungsvariable erweitert sie. 3436: Werkbank-Test-Instanz; 8110/8111: Vorschau-Ports;
 *  dazu Test-Admin und Test-Bot (Hauptsitzung 06.11., nur lesend: nur GET/HEAD, Basic-Auth nur mit Testkonto). Live-Werkbank
 *  (3070/3080/3090) und alles andere sind ausgeschlossen. */
export interface KlickZiel { proto: 'http:' | 'https:'; host: string; port: number; nurLesen?: boolean }
export const KLICK_ZIELE: readonly KlickZiel[] = Object.freeze([
  ...['127.0.0.1', 'localhost'].flatMap((host) => [3436, 8110, 8111].map((port) => ({ proto: 'http:' as const, host, port }))),
  ...['olaf-bot-admin.konekto.energy', 'olaf-bot-test.konekto.energy'].map((host) => ({ proto: 'https:' as const, host, port: 443, nurLesen: true })),
].map((z) => Object.freeze(z)));
/** Nur Ziele mit Testkonten-Anmeldung (die Werkbank-Test-Instanz); auf den Vorschau-Ports meldet sich das Werkzeug nicht an. */
const ANMELDUNG_PORTS = new Set([3436]);

export function zielVon(url: string): KlickZiel | null {
  let u: URL; try { u = new URL(url); } catch { return null; }
  if (u.username || u.password) return null;
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  return KLICK_ZIELE.find((z) => z.proto === u.protocol && z.host === u.hostname && z.port === port) ?? null;
}
export const zielErlaubt = (url: string) => !!zielVon(url);
/** Anfrage erlaubt? Auf Nur-lesen-Zielen nur GET/HEAD (kein Absenden, kein Ändern). */
export const anfrageErlaubt = (url: string, methode: string) => { const z = zielVon(url); return !!z && (!z.nurLesen || ['GET', 'HEAD'].includes(methode.toUpperCase())); };

/** WebSocket-Ziele wie HTTP-Ziele (ws → http, wss → https). */
export const wsErlaubt = (url: string) => zielErlaubt(url.replace(/^ws/, 'http'));

export type Aktion = { art: 'warte' | 'klick' | 'rolle' | 'tippe' | 'text' | 'bild'; wert: string } | { art: 'voll'; wert: '' };
export function aktionen(roh: string[]): Aktion[] | string {
  const out: Aktion[] = [];
  for (const a of roh) {
    if (a === 'voll') { out.push({ art: 'voll', wert: '' }); continue; }
    const i = a.indexOf(':'), art = a.slice(0, i), wert = a.slice(i + 1);
    if (i < 1 || !['warte', 'klick', 'rolle', 'tippe', 'text', 'bild'].includes(art)) return `unbekannte Aktion „${a.slice(0, 40)}“`;
    if (art === 'bild' && !/^[\w-]{1,60}$/.test(wert)) return 'bild:<name> nur Buchstaben, Ziffern, - und _';
    if (art === 'warte' && !(Number(wert) >= 0 && Number(wert) <= 30_000)) return 'warte:<ms> zwischen 0 und 30000';
    out.push({ art: art as any, wert });
  }
  // Gegenprüfung 06.11.: der Wächter beendet klick nach 180 s — Wartezeiten zusammen deutlich darunter halten.
  if (out.reduce((s, a) => s + (a.art === 'warte' ? Number(a.wert) : 0), 0) > 60_000) return 'Wartezeiten zusammen höchstens 60000 ms';
  return out.length > 40 ? 'höchstens 40 Aktionen' : out;
}

/** Ausgabeordner: muss im Arbeitsordner liegen (die Brücke setzt WERKBANK_KLICK_AUS auf den Ordner des Workers). */
export function ausgabeOrdner(aus: string | undefined): string | null {
  if (!aus || !existsSync(aus)) return null;
  try {
    const d = join(realpathSync(aus), 'klick');
    mkdirSync(d, { recursive: true });
    return realpathSync(d).startsWith(realpathSync(aus) + sep) ? d : null;
  } catch { return null; }
}

/** Erste Tab-getrennte Zeile mit `schluessel` vorn und mindestens drei Feldern (Dateien, die Knut füllt; nie ausgegeben). */
function tabZeile(datei: string, schluessel: string): string[] | null {
  try { return readFileSync(datei, 'utf8').split('\n').map((l) => l.split('\t')).find((x) => x[0] === schluessel && x.length >= 3) ?? null; }
  catch { return null; }
}

/** Basic-Auth der Nur-lesen-Ziele (traefik): Testkonto je Host (Host, Nutzer, Passwort) — für jcode gesperrt wie die Testkonten
 *  (Pre-Tool-Hook, Dateiname testkonten*.txt). */
export function basicKonto(host: string, datei = join(homedir(), '.cache', 'p436', 'testkonten-basic.txt')): { username: string; password: string } | null {
  const z = tabZeile(datei, host);
  return z ? { username: z[1], password: z[2] } : null;
}

/** Testkonten der Test-Instanz (Datei der Persona-Abnahme: Name, E-Mail, Passwort). */
export function testkonto(name: string, datei = join(homedir(), '.cache', 'p436', 'testkonten.txt')): { email: string; pw: string } | null {
  const z = tabZeile(datei, name);
  return z ? { email: z[1], pw: z[2] } : null;
}

/** Namen der Testkonten (erste Spalte) für den Auftragshinweis — ohne E-Mail und Passwort. */
export function testkontoNamen(datei = join(homedir(), '.cache', 'p436', 'testkonten.txt')): string[] {
  try { return readFileSync(datei, 'utf8').split('\n').map((l) => l.split('\t')).filter((x) => x.length >= 3 && x[0]).map((x) => x[0]); }
  catch { return []; }
}

/** Ziele als Klartext für Fehlermeldung und Auftragshinweis — aus KLICK_ZIELE, damit beides nicht von der Liste abweicht (A-B6). */
export function zieleText(): string {
  const lokal = [...new Set(KLICK_ZIELE.filter((z) => !z.nurLesen).map((z) => z.port))].join(', ');
  const lesend = KLICK_ZIELE.filter((z) => z.nurLesen).map((z) => `${z.proto}//${z.host}`).join(', ');
  return `127.0.0.1/localhost auf ${lokal} (Test-Instanz 3436, Vorschau) sowie ${lesend} (nur lesend: nur ansehen, nicht klicken oder tippen)`;
}
/** Auf Nur-lesen-Zielen nur Aktionen, die nichts auslösen (A-B7): auch ein Klick auf einen Link kann ein GET mit Wirkung sein. */
const NUR_ANSEHEN = new Set(['warte', 'text', 'bild', 'voll']);
/** Obergrenze der Ausgabe (K9): sie landet im Kontext des Modells. */
const AUSGABE_MAX = 20_000;

const PLAYWRIGHT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'node_modules', 'playwright', 'index.mjs');

export async function klick(argv: string[], aus: string | undefined): Promise<{ code: number; text: string }> {
  const [persona, geraet, url, ...rest] = argv;
  if (!persona || !['d', 'm'].includes(geraet) || !url) return { code: 2, text: 'Aufruf: klick <persona|-> <d|m> <url> [aktion …]' };
  if (!zielErlaubt(url)) return { code: 3, text: `Ziel nicht erlaubt: nur ${zieleText()} — nie Produktion.` };
  const akt = aktionen(rest);
  if (typeof akt === 'string') return { code: 2, text: akt };
  if (zielVon(url)?.nurLesen && akt.some((a) => !NUR_ANSEHEN.has(a.art))) return { code: 2, text: 'Auf Nur-lesen-Zielen nur warte, text, bild und voll.' };
  const ordner = ausgabeOrdner(aus);
  if (!ordner) return { code: 4, text: 'Kein Ausgabeordner (das Klickwerkzeug läuft nur in einem Worker mit klick=true).' };
  const ziel = new URL(url);
  const konto = persona === '-' ? null : testkonto(persona);
  if (persona !== '-' && !konto) return { code: 5, text: `Kein Testkonto „${persona.slice(0, 30)}“ — nur Testkonten der Test-Instanz.` };
  if (konto && !(ziel.protocol === 'http:' && ANMELDUNG_PORTS.has(Number(ziel.port || 80)))) return { code: 5, text: 'Anmeldung nur an der Test-Instanz (3436); für Vorschau-Ports, Test-Admin und Test-Bot persona „-“.' };
  const basic = zielVon(url)?.nurLesen ? basicKonto(ziel.hostname) : null;
  const { chromium, devices } = await import(pathToFileURL(PLAYWRIGHT).href);
  const zeilen: string[] = [];
  // Gegenprüfung 06.11.: alles, was nicht über route läuft (WebSocket, IP-Adressen), geht an einen toten Proxy — nur Loopback
  // umgeht ihn; Loopback-Ziele prüfen route/routeWebSocket gegen die Liste.
  const b = await chromium.launch({ args: ['--disable-dev-shm-usage'], proxy: { server: 'http://127.0.0.1:9', bypass: ['127.0.0.1', 'localhost', ...KLICK_ZIELE.filter((z) => z.proto === 'https:').map((z) => z.host)].join(',') } });
  const zu = () => { void b.close().finally(() => process.exit(1)); };
  process.once('SIGTERM', zu);   // Zeitgrenze des Wächters: Browser nicht als Waise zurücklassen
  try {
    const ctx = await b.newContext({ ...(geraet === 'm' ? { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } : { viewport: { width: 1440, height: 900 } }), locale: 'de-DE', serviceWorkers: 'block', ...(basic ? { httpCredentials: { ...basic, origin: ziel.origin } } : {}) });
    let geblockt = 0;
    // Jede Anfrage der Seite (auch Weiterleitungen, Bilder, fetch) nur an erlaubte Ziele; WebSockets ebenso.
    await ctx.route('**/*', (r: any) => (anfrageErlaubt(r.request().url(), r.request().method()) ? r.continue() : (geblockt++, r.abort())));
    await ctx.routeWebSocket(() => true, (ws: any) => { if (wsErlaubt(String(ws.url()))) ws.connectToServer(); else { geblockt++; ws.close(); } });
    const p = await ctx.newPage();
    p.on('pageerror', (e: any) => zeilen.push(`SEITENFEHLER ${String(e).slice(0, 300)}`));
    if (konto) {
      await p.goto(`${ziel.origin}/v2/`);
      await p.fill('input[type=email]', konto.email); await p.fill('input[type=password]', konto.pw); await p.keyboard.press('Enter');
      await p.waitForTimeout(2500);
    }
    const t0 = Date.now();
    await p.goto(url);
    await p.waitForSelector('.karte, .leer, .zeile, main', { timeout: 20_000 }).catch(() => null);
    zeilen.push(`geladen in ${Date.now() - t0} ms: ${p.url()}`);
    let voll = false;
    for (const a of akt) {
      try {
        if (a.art === 'warte') await p.waitForTimeout(Number(a.wert));
        else if (a.art === 'klick') await p.getByText(a.wert, { exact: false }).first().click({ timeout: 10_000 });
        else if (a.art === 'rolle') { const [ro, name] = a.wert.split('='); await p.getByRole(ro as any, { name }).first().click({ timeout: 10_000 }); }
        else if (a.art === 'tippe') { const [sel, ...t] = a.wert.split('='); await p.fill(sel, t.join('='), { timeout: 10_000 }); }
        else if (a.art === 'text') zeilen.push(`text ${a.wert}:\n${(await p.locator(a.wert).first().innerText({ timeout: 10_000 })).slice(0, 4000)}`);
        else if (a.art === 'bild') { const f = join(ordner, `${a.wert}.png`); await p.screenshot({ path: f }); zeilen.push(`bild ${f}`); }
        else if (a.art === 'voll') voll = true;
      } catch (e: any) { zeilen.push(`FEHLER bei ${a.art}:${a.wert.slice(0, 60)} — ${String(e?.message ?? e).split('\n')[0].slice(0, 200)}`); }
      await p.waitForTimeout(300);
    }
    const f = join(ordner, `${Date.now()}-${geraet}.png`);
    await p.screenshot({ path: f, fullPage: voll });
    zeilen.push(`bild ${f}`, `seite ${p.url()}`, ...(geblockt ? [`${geblockt} Anfrage(n) an andere Ziele blockiert`] : []));
    const text = zeilen.join('\n');
    return { code: 0, text: text.length > AUSGABE_MAX ? `${text.slice(0, AUSGABE_MAX)}\n… gekürzt (${text.length} Zeichen)` : text };
  } finally { process.removeListener('SIGTERM', zu); await b.close(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  // Pass C (S4): Startfehler (Playwright fehlt, Browser startet nicht) als kurze Meldung statt unbehandelter Zurückweisung
  const r = await klick(process.argv.slice(2), process.env.WERKBANK_KLICK_AUS)
    .catch((e: any) => ({ code: 1, text: `klick fehlgeschlagen: ${String(e?.message ?? e).split('\n')[0].slice(0, 300)}` }));
  (r.code ? process.stderr : process.stdout).write(r.text + '\n');
  process.exit(r.code);
}
