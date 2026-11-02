// R31 S3+S4: interne Wege für die Hauptchat-Werkzeuge werkbank_betrieb, werkbank_stand, geheimnis_nutzen, coolify, datei_teilen,
// screenshot und die Kontingent-Anzeige. main.ts ruft `betriebRoutes(deps)` einmal auf (Muster cosroutes.ts).
// Jeder Weg: Schalter (Vorgabe aus) → nur Admins → schreibende Aktionen nur mit Klick-Nachweis der Brücke (einmalig, 15 min).
// Geloggt werden nur Namen und Arten, nie Werte (Schalterwerte der Positivliste ausgenommen — sie sind aufgezählt).

import { execFile, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { cfg, WB_ROOT } from './config.ts';
import { internalHeaders } from './orchestrator.ts';
import { betriebAn, pruefeBetrieb, envSetzen, envWert, neustartFuer, liveAus, schalterStand, standText, schalterVon, type StandEingabe } from './betrieb.ts';
import { geheimnisAn, zweckeAus, pruefeAufruf, fuehreAus as geheimnisAusfuehren, vaultwardenWert } from './geheimnis.ts';
import { coolifyAn, coolifyBasis, appMuster, pruefeCoolify, fuehreAus as coolifyAusfuehren, type Api } from './coolify.ts';
import { dateienChatAn, downloadLink, paketLink, screenshotZiel, aufnehmen, type Geraet } from './chatdateien.ts';
import { kontingent, standardDeps } from './kontingent.ts';
import { ingestOne } from './agentfiles.ts';
import { scratchDir, fileFor } from './sharing.ts';
import { leitDir, meldeLeitstand } from './leitstand.ts';
import { kurzSitzung, type User } from './auth.ts';
import { wb } from './db.ts';

export interface BetriebDeps {
  on: (method: string, path: RegExp, h: (req: any, res: any, m: RegExpMatchArray, url: URL) => Promise<void>) => void;
  needUser: (req: any) => Promise<User>;
  orchPerson: (req: any, b: any) => Promise<User>;
  body: (req: any, max?: number) => Promise<any>;
  send: (res: any, status: number, body: unknown) => void;
  HttpError: new (status: number, msg: string) => Error;
  log: (m: string, d?: any) => void;
}

const git = promisify(execFile);
const envDatei = () => process.env.WERKBANK_ENV_FILE || join(WB_ROOT, '.env.local');
const markeDatei = () => join(cfg.dataDir, 'betrieb-neustart.json');
const echt = (p: string) => { try { return realpathSync(p); } catch { return p; } };

/** Klick-Nachweis bei der Brücke verbrauchen (dort hat Knut die Karte bestätigt). Brücke weg = kein Nachweis. */
async function nachweis(u: User, aktion: unknown): Promise<boolean> {
  try {
    const r = await fetch(`${cfg.bridgeUrl}/internal/aktion-freigabe`, { method: 'POST', headers: internalHeaders(), body: JSON.stringify({ userId: u.id, aktion }), signal: AbortSignal.timeout(5000) });
    return r.ok && (await r.json().catch(() => ({})))?.ok === true;
  } catch { return false; }
}

async function bruecke(): Promise<{ health: any; schalter: Record<string, string> | null }> {
  const health = await fetch(`${cfg.bridgeUrl}/health`, { signal: AbortSignal.timeout(3000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const schalter = await fetch(`${cfg.bridgeUrl}/internal/schalter`, { headers: internalHeaders(), signal: AbortSignal.timeout(3000) }).then((r) => (r.ok ? r.json() : null)).then((j: any) => j?.werte ?? null).catch(() => null);
  return { health, schalter };
}

/** Stand ermitteln (Git der Live-Instanz, .env.local, laufende Prozesse) → Text ohne Geheimniswerte. */
export async function standErmitteln(): Promise<string> {
  const g = async (args: string[], cwd: string) => { try { return (await git('git', ['-C', cwd, ...args], { timeout: 5000, encoding: 'utf8' })).stdout.trim(); } catch { return null; } };
  const log = await g(['log', '--format=%s', '-n', '300'], cfg.liveRoot);
  const live = (log ?? '').split('\n').map(liveAus).find(Boolean) ?? null;
  const instanzKopf = await g(['rev-parse', 'HEAD'], cfg.liveRoot);
  let releaseKopf: string | null = null, releaseVoraus: number | null = null;
  if (live) {
    releaseKopf = (await g(['rev-parse', '--verify', '--quiet', `refs/heads/${live.release}`], cfg.sourceRepo)) || (await g(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${live.release}`], cfg.sourceRepo));
    const n = releaseKopf ? await g(['rev-list', '--count', `${live.sha}..${releaseKopf}`], cfg.sourceRepo) : null;
    releaseVoraus = n === null ? null : Number(n);
  }
  const porcelain = await g(['status', '--porcelain', '--untracked-files=no'], cfg.liveRoot);
  let envText: string | null = null;
  try { envText = readFileSync(envDatei(), 'utf8'); } catch { envText = null; }
  const b = await bruecke();
  const e: StandEingabe = {
    live, instanzKopf, releaseKopf, releaseVoraus, schmutzig: porcelain === null ? null : porcelain.split('\n').filter(Boolean).length,
    schalter: schalterStand(envText, process.env, b.schalter), web: { seitS: Math.round(process.uptime()) },
    bruecke: b.health ? { erreichbar: true, laufend: b.health.drainLaufend, schlange: b.health.schlange, ...(b.health.startedAt ? { seitS: Math.round((Date.now() - Number(b.health.startedAt)) / 1000) } : {}) } : { erreichbar: false },
  };
  return standText(e);
}

/** Schalter in .env.local schreiben (atomar, Rechte bleiben) → „NAME: alt → neu“ je Schalter. */
function schalterSchreiben(schalter: Record<string, string>): string[] {
  const datei = envDatei();
  let text = '';
  try { text = readFileSync(datei, 'utf8'); } catch { throw new Error(`${datei} fehlt.`); }
  const mode = statSync(datei).mode & 0o777;
  const zeilen: string[] = [];
  for (const [n, w] of Object.entries(schalter)) {
    const alt = envWert(text, n) ?? `— (Vorgabe ${schalterVon(n)!.vorgabe})`;
    text = envSetzen(text, n, w);
    zeilen.push(`${n}: ${alt} → ${w}`);
  }
  const tmp = `${datei}.betrieb-${process.pid}`;
  writeFileSync(tmp, text, { mode });
  renameSync(tmp, datei);
  return zeilen;
}

/** Neustart abgelöst starten (die Antwort geht vorher noch raus); Drain zählt den Hauptchat nicht (drainOhneLeit). */
function neustartStarten(u: User, art: 'restart-web' | 'restart', was: string[]): void {
  const skript = process.env.WERKBANK_BETRIEB_SKRIPT || join(WB_ROOT, 'scripts', 'werkbank.sh');
  if (!existsSync(skript)) throw new Error('werkbank.sh nicht gefunden.');
  mkdirSync(dirname(markeDatei()), { recursive: true });
  writeFileSync(markeDatei(), JSON.stringify({ userId: u.id, art, was, at: Date.now() }));
  const logDatei = join(WB_ROOT, '.runtime', 'logs', 'betrieb-neustart.log');
  mkdirSync(dirname(logDatei), { recursive: true });
  const fd = openSync(logDatei, 'a');
  const c = spawn('setsid', ['bash', '-c', 'sleep 3; exec "$0" "$1"', skript, art], { detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, WB_DRAIN_FELD: 'drainOhneLeit' } });
  // Gegenprüfung R31: ohne Handler risse ein fehlgeschlagener Start (setsid fehlt) die Web-App mit.
  c.on('error', () => { rmSync(markeDatei(), { force: true }); });
  c.unref();
  closeSync(fd);
}

/** Nach dem Start der Web-App: offene Neustart-Marke → Meldung an den Hauptchat („fertig“), Marke weg. */
export async function neustartMelden(personVon: (id: string) => Promise<User | null>, log: (m: string, d?: any) => void, now = Date.now()): Promise<void> {
  let roh: string;
  try { roh = readFileSync(markeDatei(), 'utf8'); } catch { return; }
  rmSync(markeDatei(), { force: true });   // auch eine kaputte Marke weg (Gegenprüfung R31)
  let m: any;
  try { m = JSON.parse(roh); } catch { return; }
  if (!m?.userId || now - Number(m.at) > 60 * 60_000) return;
  const u = await personVon(String(m.userId));
  if (!u) return;
  const text = `Werkbank neu gestartet (${m.art}${Array.isArray(m.was) && m.was.length ? `; ${m.was.join('; ')}` : ''}). Unterbrochene Stränge laufen automatisch weiter; Stand mit werkbank_stand prüfen.`;
  await meldeLeitstand(u, { _id: 'betrieb', title: 'Werkbank-Betrieb' }, text).catch(() => {});
  log('betrieb neustart gemeldet', { user: u.id, art: m.art });
}

/** Coolify-API über den Geheimnis-Vermittler (Zweck „coolify“) — der Klick der Coolify-Karte deckt das Holen des Tokens. */
const coolifyApi: Api = async (methode, pfad, body) => {
  const p = pruefeAufruf({ zweck: 'coolify', methode, url: `${coolifyBasis()}${pfad}`, ...(body !== undefined ? { body } : {}) }, zweckeAus());
  if ('fehler' in p) throw new Error(p.fehler);
  const r = await geheimnisAusfuehren(p, { wert: vaultwardenWert });
  let json: any = null;
  try { json = JSON.parse(r.text); } catch { json = null; }
  return { status: r.status, json, text: r.text };
};

export function betriebRoutes(d: BetriebDeps) {
  const { on, body, send, HttpError, log } = d;
  const admin = async (req: any, b: any) => {
    const u = await d.orchPerson(req, b);
    if (u.role !== 'ADMIN') throw new HttpError(403, 'Nur für Admins.');
    return u;
  };
  const geklickt = async (u: User, aktion: unknown) => {
    if (!(await nachweis(u, aktion))) throw new HttpError(403, 'Kein Klick-Nachweis: Knut hat genau diese Aktion nicht auf der Karte bestätigt (oder die Bestätigung ist älter als 15 min).');
  };

  // ---------- werkbank_betrieb / werkbank_stand ----------
  on('POST', /^\/internal\/lead\/betrieb$/, async (req, res) => {
    const b = await body(req);
    const u = await admin(req, b);
    if (!betriebAn()) throw new HttpError(403, 'werkbank_betrieb ist aus (WERKBANK_HAUPTCHAT_BETRIEB).');
    const a = pruefeBetrieb(b.aktion ?? {});
    if ('fehler' in a) throw new HttpError(400, a.fehler);
    await geklickt(u, b.aktion);
    if (a.art === 'schalter_setzen') {
      const zeilen = schalterSchreiben(a.schalter);
      const art = neustartFuer(Object.keys(a.schalter));
      log('betrieb schalter', { user: u.id, schalter: zeilen, neustart: a.neustart ? art : null });
      if (a.neustart) neustartStarten(u, art, zeilen);
      return send(res, 200, { text: `Gesetzt in .env.local:\n- ${zeilen.join('\n- ')}\n\n${a.neustart ? `Neustart (${art}) startet in 3 s; laufende Stränge werden nicht abgewartet, wenn sie länger als WB_DRAIN_S brauchen, und laufen danach automatisch weiter. Beende jetzt deinen Zug — nach dem Neustart kommt eine Meldung.` : 'Ohne Neustart — wirkt erst beim nächsten Neustart (werkbank_betrieb art=neustart_web bzw. neustart).'}` });
    }
    const art = a.art === 'neustart' ? 'restart' : 'restart-web';
    log('betrieb neustart', { user: u.id, art });
    neustartStarten(u, art, []);
    send(res, 200, { text: `Neustart (${art}) startet in 3 s (Drain ohne den Hauptchat). Beende jetzt deinen Zug — danach kommt eine Meldung, Stränge laufen automatisch weiter.` });
  });
  on('POST', /^\/internal\/lead\/stand$/, async (req, res) => {
    const b = await body(req);
    await admin(req, b);
    if (!betriebAn()) throw new HttpError(403, 'werkbank_stand ist aus (WERKBANK_HAUPTCHAT_BETRIEB).');
    send(res, 200, { text: await standErmitteln() });
  });

  // ---------- Geheimnis-Vermittler ----------
  on('POST', /^\/internal\/lead\/geheimnis$/, async (req, res) => {
    const b = await body(req, 256 * 1024);
    const u = await admin(req, b);
    if (!geheimnisAn()) throw new HttpError(403, 'geheimnis_nutzen ist aus (WERKBANK_GEHEIMNIS).');
    const p = pruefeAufruf(b.aktion ?? {}, zweckeAus());
    if ('fehler' in p) throw new HttpError(400, p.fehler);
    await geklickt(u, b.aktion);
    try {
      const r = await geheimnisAusfuehren(p);
      log('geheimnis genutzt', { user: u.id, zweck: p.zweck.name, methode: p.aufruf.methode, host: new URL(p.aufruf.url).hostname, status: r.status });
      send(res, 200, { text: `HTTP ${r.status} (Zweck ${p.zweck.name}, Wert geschwärzt)\n${r.text}` });
    } catch (e: any) {
      log('geheimnis fehler', { user: u.id, zweck: p.zweck.name, grund: String(e?.message ?? e).slice(0, 160) });
      throw new HttpError(502, String(e?.message ?? e));
    }
  });

  // ---------- Coolify ----------
  on('POST', /^\/internal\/lead\/coolify$/, async (req, res) => {
    const b = await body(req, 64 * 1024);
    const u = await admin(req, b);
    if (!coolifyAn()) throw new HttpError(403, 'coolify ist aus (WERKBANK_COOLIFY).');
    const a = pruefeCoolify(b.aktion ?? {}, appMuster());
    if ('fehler' in a) throw new HttpError(400, a.fehler);
    if (a.art !== 'status') await geklickt(u, b.aktion);
    try {
      const text = await coolifyAusfuehren(a, coolifyApi);
      log('coolify', { user: u.id, art: a.art, app: a.app, ...(a.art === 'variable_setzen' ? { key: a.key } : {}) });
      send(res, 200, { text });
    } catch (e: any) {
      log('coolify fehler', { user: u.id, art: a.art, app: a.app, grund: String(e?.message ?? e).slice(0, 160) });
      throw new HttpError(502, String(e?.message ?? e));
    }
  });

  // ---------- Dateien und Bilder im Chat ----------
  on('POST', /^\/internal\/lead\/datei-teilen$/, async (req, res) => {
    const b = await body(req);
    const u = await admin(req, b);
    if (!dateienChatAn()) throw new HttpError(403, 'datei_teilen ist aus (WERKBANK_DATEIEN_CHAT).');
    if (b.id) {
      const f = await fileFor(u, String(b.id));
      if (!f) throw new HttpError(404, 'Datei nicht in „Meine Dateien“.');
      return send(res, 200, { text: `[${f.name}](${downloadLink(f._id)})` });
    }
    const pfad = String(b.pfad ?? '');
    if (!pfad.startsWith('/')) throw new HttpError(400, 'pfad: absoluter Pfad oder id aus „Meine Dateien“.');
    const pl = paketLink(pfad, cfg.reviewDir);
    if (pl && existsSync(pfad)) return send(res, 200, { text: `[${pfad.split('/').pop()}](${pl})` });
    // Ausdrücklich geteilt: eine frühere Löschung gilt nicht mehr (sonst bliebe die Datei unsichtbar).
    await wb().collection('files_ignored').deleteMany({ owner: u.id, sourcePath: pfad }).catch(() => {});
    const r = await ingestOne(u, pfad, { conv: String(b.conv ?? 'hauptchat') }, [scratchDir(u), leitDir()]);
    const f: any = await wb().collection('files').findOne({ owner: u.id, 'source.path': echt(pfad) });
    if (!f) throw new HttpError(400, `Nicht geteilt: ${r}. Erlaubt sind Dateien (pdf, Bilder, Text, Office) im Arbeitsordner, im Hauptchat-Ordner und in Review-Paketen.`);
    log('datei geteilt', { user: u.id, id: f._id, ergebnis: r });
    send(res, 200, { text: `[${f.name}](${downloadLink(f._id)}) — liegt in „Meine Dateien“.` });
  });
  on('POST', /^\/internal\/lead\/screenshot$/, async (req, res) => {
    const b = await body(req);
    const u = await admin(req, b);
    if (!dateienChatAn()) throw new HttpError(403, 'screenshot ist aus (WERKBANK_DATEIEN_CHAT).');
    const z = screenshotZiel(String(b.url ?? ''), cfg.publicUrl);
    if ('fehler' in z) throw new HttpError(400, z.fehler);
    const geraete: Geraet[] = b.geraet === 'handy' ? ['handy'] : b.geraet === 'beide' ? ['desktop', 'handy'] : ['desktop'];
    const s = z.werkbank ? await kurzSitzung(u) : null;
    let pfade: string[];
    try { pfade = await aufnehmen(z, geraete, join(scratchDir(u), 'screenshots'), { ganz: b.ganz === true, cookie: s }); }
    catch (e: any) { throw new HttpError(502, `Screenshot fehlgeschlagen: ${String(e?.message ?? e).slice(0, 200)}`); }
    finally { await s?.weg(); }
    const zeilen: string[] = [];
    for (const p of pfade) {
      await ingestOne(u, p, { conv: String(b.conv ?? 'hauptchat') });
      const f: any = await wb().collection('files').findOne({ owner: u.id, 'source.path': echt(p) });
      zeilen.push(f ? `![${f.name}](${downloadLink(f._id, true)})\nDatei: \`${p}\` (mit Read ansehen)` : `Datei: \`${p}\``);
    }
    log('screenshot', { user: u.id, werkbank: z.werkbank, geraete, n: pfade.length });
    send(res, 200, { text: zeilen.join('\n\n') || 'Kein Bild entstanden.' });
  });

  // ---------- Kontingent (Anzeige + Werkzeug auslastung) ----------
  on('GET', /^\/api\/kontingent$/, async (req, res) => send(res, 200, await kontingent(await d.needUser(req), standardDeps())));
  on('POST', /^\/internal\/kontingent$/, async (req, res) => {
    const b = await body(req);
    const u = await d.orchPerson(req, b);
    send(res, 200, { text: (await kontingent(u, standardDeps())).zeile });
  });
}
