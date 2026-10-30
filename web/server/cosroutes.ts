// Chief of Staff: Routen (docs/plan-chief-of-staff.md). main.ts ruft `cosRoutes(deps)` einmal auf — so bleibt der Eingriff dort klein.
// Alles nur Admin (Feature `cos`); die internen Wege (MCP-Werkzeuge) schreiben erst, nachdem Knut im Chat „ja“ gesagt hat.

import { liesRegister, schreibeZusagen, schreibeThema, schreibe, hashText, themenEindeutig, teamNamen, teamSet, seiteVon, registerRel, CosError, type ZOp, type ThemaOp, type SchreibOpts, type SchreibErgebnis } from './cosregister.ts';
import { startEinwurf, EinwurfError } from './coseinwurf.ts';
import { sammleLage, sammleEingabe, meetingTeams, type Quellen } from './cossammle.ts';
import { triageUebernehmen, pruefeDatei, rueckstau, archiviereRueckstau, rueckgaengig, RUECKGAENGIG_TAGE, type ArchivStore } from './cosmeeting.ts';
import { sammleAbschluss, sammleWoche } from './cosabschluss.ts';
import { entscheide, wien, type ThemaVorschlag } from './cos.ts';
import { entwurfFuer, senden as nachfassSenden, type Senden } from './cosnachfassen.ts';
import { wienDatum } from './cosregister.ts';
import { buildICS, ICS_AN } from './cosics.ts';
import { cosAktion } from './nutzung.ts';
import { wb } from './db.ts';
import { randomBytes } from 'node:crypto';
import { teamInstanz } from './features.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface CosDeps {
  on: (method: string, path: RegExp, h: (req: any, res: any, m: RegExpMatchArray, url: URL) => Promise<void>) => void;
  needAdmin: (req: any) => Promise<any>;
  internalUser: (req: any, b: any) => Promise<any>;
  body: (req: any, max?: number) => Promise<any>;
  send: (res: any, status: number, body: unknown) => void;
  HttpError: new (status: number, msg: string) => Error;
  vaultDir: () => string;
  dry: () => boolean;
  invalidate: () => void;
  /** Basis für öffentliche Links (Kalender-Feed) — cfg.publicUrl in main.ts. */
  publicUrl: () => string;
  /** Themen für die Vorbefüllung (Jira-Workstreams + Strang-Themen), nur beim Anlegen der Datei gebraucht. */
  themenVorschlag: () => Promise<string[]>;
  /** Register einmal aus dem aktuellen Stand (Knut 19.10.): Themen mit Stand, nächstem Schritt und Ball. */
  registerVorschlag: (u: any) => Promise<ThemaVorschlag[]>;
  log: (m: string, d?: any) => void;
  quellen: () => Quellen;
  /** Nachfass-Kommentare schicken (GitHub-Kommentar / Jira-Kommentar); in Tests ein Mock. */
  nachfasser: (u: any) => Senden;
}

const OPS = new Set(['neu', 'aendern']);

function zusageOps(b: any, HttpError: CosDeps['HttpError']): ZOp[] {
  const raw: any[] = Array.isArray(b.ops) ? b.ops : [b];
  if (!raw.length || raw.length > 25) throw new HttpError(400, 'Eine bis 25 Zusagen je Aufruf.');
  return raw.map((o) => {
    const art = o.art ?? (o.id ? 'aendern' : 'neu');
    if (!OPS.has(art)) throw new HttpError(400, 'art: neu | aendern.');
    if (art === 'neu') return { art, wer: o.wer ?? null, an: o.an, was: String(o.was ?? ''), bis: o.bis || null, fristUnklar: !!o.fristUnklar, thema: o.thema, quelle: o.quelle, notiz: o.notiz } as ZOp;
    if (o.status && !['offen', 'erledigt', 'verworfen'].includes(o.status)) throw new HttpError(400, 'status: offen | erledigt | verworfen.');
    return { art, id: String(o.id ?? ''), status: o.status, bis: o.bis, notiz: o.notiz, was: o.was } as ZOp;
  });
}

export function cosRoutes(d: CosDeps) {
  const { on, send } = d;
  const opts = async (b: any, kind: 'zusagen' | 'themen', forceConfirm = false): Promise<SchreibOpts> => {
    const vaultDir = d.vaultDir();
    const fehlt = !existsSync(join(vaultDir, registerRel(kind)));
    const themen = kind === 'themen' && fehlt && (b.confirm || forceConfirm) ? await d.themenVorschlag().catch(() => []) : [];
    return { vaultDir, dry: d.dry(), confirm: forceConfirm || b.confirm === true, hash: typeof b.hash === 'string' ? b.hash : undefined, vorbefuellung: () => ({ personen: teamNamen(vaultDir), themen }), danach: d.invalidate };
  };
  const admin = async (req: any, b: any) => { const u = await d.internalUser(req, b); if (u.role !== 'ADMIN') throw new d.HttpError(403, 'Das dürfen nur Admins.'); return u; };
  const antwort = (res: any, r: SchreibErgebnis) => send(res, 200, r);

  on('GET', /^\/api\/cos\/register$/, async (req, res) => {
    await d.needAdmin(req);
    const r = liesRegister(d.vaultDir());
    const team = teamSet(teamNamen(d.vaultDir()));
    send(res, 200, { ...r, zusagen: r.zusagen.map((z) => ({ ...z, seite: seiteVon(z.wer, r.personen, team), anSeite: seiteVon(z.an, r.personen, team) })), dateien: { zusagen: registerRel('zusagen'), themen: registerRel('themen') } });
  });

  on('POST', /^\/api\/cos\/zusage$/, async (req, res) => {
    await d.needAdmin(req);
    const b = await d.body(req);
    const r = await schreibeZusagen(zusageOps(b, d.HttpError), await opts(b, 'zusagen'));
    cosAktion('zusage');   // nach Erfolg gezählt (Pass C): Validierungsfehler und Trockenlauf sind keine Nutzung
    antwort(res, r);
  });

  on('POST', /^\/api\/cos\/thema$/, async (req, res) => {
    await d.needAdmin(req);
    const b = await d.body(req);
    const op: ThemaOp = { art: 'thema', name: String(b.name ?? ''), stand: b.stand, naechster: b.naechster, ball: b.ball };
    const r = await schreibeThema(op, await opts(b, 'themen'));
    cosAktion('thema');
    antwort(res, r);
  });

  // Register einmal anlegen (K9 sah das beim ersten Schreiben vor — das kam nie; Knut 19.10.: „Vorschlag mit Knuts Ja“).
  // Ohne confirm: Vorschau beider neuen Dateien. Mit confirm: genau die gezeigten Themen (vom Client zurück), sonst neu berechnet.
  on('POST', /^\/api\/cos\/register\/anlegen$/, async (req, res) => {
    const u = await d.needAdmin(req);
    const b = await d.body(req, 1 << 20);
    const vaultDir = d.vaultDir();
    // Je Datei: fehlt nur eine (abgebrochenes Anlegen), wird nur sie angelegt — kein 409-Sackgasse.
    const fehlt = { zusagen: !existsSync(join(vaultDir, registerRel('zusagen'))), themen: !existsSync(join(vaultDir, registerRel('themen'))) };
    if (!fehlt.zusagen && !fehlt.themen) throw new d.HttpError(409, 'Die Register gibt es schon — sie wachsen über Einwurf und Morgenlage.');
    const gezeigt = Array.isArray(b.themen) && b.confirm === true ? b.themen.filter((t: any) => t && typeof t.name === 'string' && t.name.trim())
      .map((t: any) => ({ name: String(t.name), stand: String(t.stand ?? ''), naechster: String(t.naechster ?? ''), ball: String(t.ball ?? '') })) : null;
    const themen: ThemaVorschlag[] = themenEindeutig(gezeigt ?? await d.registerVorschlag(u));
    const alle = (t: string) => ({ text: t, zeilen: t.split('\n').filter((l) => l.startsWith('- ')).map((l) => ({ vorher: null, nachher: l })) });
    const o = (): SchreibOpts => ({ vaultDir, dry: d.dry(), confirm: b.confirm === true, hash: b.confirm === true ? hashText('') : undefined, vorbefuellung: () => ({ personen: teamNamen(vaultDir), themen }), danach: d.invalidate });
    const zusagen = fehlt.zusagen ? await schreibe('zusagen', alle, o()) : null;
    const th = fehlt.themen ? await schreibe('themen', alle, o()) : null;
    if (b.confirm === true) { cosAktion('register-anlegen'); d.log('cos register angelegt', { themen: themen.length, dry: d.dry() }); }
    send(res, 200, { zusagen, themen: th, vorschlag: themen });
  });

  // Morgenlage (S1.2): immer live berechnet, die Karte zeigt ihre eigene Uhrzeit (K19).
  on('GET', /^\/api\/cos\/lage$/, async (req, res) => {
    const u = await d.needAdmin(req);
    if (process.env.COS_MORGENLAGE === 'off') return send(res, 200, { aus: true });
    const { lage } = await sammleLage(u, d.quellen());
    send(res, 200, { ...lage, zusagenDatei: existsSync(join(d.vaultDir(), registerRel('zusagen'))) ? registerRel('zusagen') : null });
  });

  // Freigabe-Inbox (S3.1): alle Entscheidungen statt der ersten sieben, mit „wartet seit“ und „blockiert: Unter-Chat X“.
  on('GET', /^\/api\/cos\/inbox$/, async (req, res) => {
    const u = await d.needAdmin(req);
    const e = await sammleEingabe(u, d.quellen(), new Date());
    const items = entscheide(e);
    send(res, 200, { items, gesamt: items.length, blockierend: items.filter((x) => x.wartet).length });
  });

  // Tagesabschluss / Wochendurchsicht (S3.4): live berechnet, die Vault-Seiten schreibt nur der Takt.
  on('GET', /^\/api\/cos\/abschluss$/, async (req, res) => {
    const u = await d.needAdmin(req);
    send(res, 200, await sammleAbschluss(u, d.quellen(), new Date()));
  });
  on('GET', /^\/api\/cos\/woche$/, async (req, res) => {
    const u = await d.needAdmin(req);
    const jetzt = new Date();
    const st = rueckstau(d.vaultDir(), meetingTeams(), wien(jetzt).datum);
    const { woche } = await sammleWoche(u, d.quellen(), jetzt, st.length);
    send(res, 200, { ...woche, rueckstauListe: st });
  });
  // Rückstau (K14/K21): Vorschau mit allen Notizen (alle vorausgewählt), Bestätigung für die abgehakten, Rückgängig 7 Tage.
  const archivStore = (): ArchivStore => ({
    put: async (datei, doc) => { await wb().collection('cos_archiv').updateOne({ _id: datei as any }, { $set: doc }, { upsert: true }); },
    get: async (datei) => (await wb().collection('cos_archiv').findOne({ _id: datei as any })) as any,
    del: async (datei) => { await wb().collection('cos_archiv').deleteOne({ _id: datei as any }); },
  });
  on('POST', /^\/api\/cos\/rueckstau$/, async (req, res) => {
    await d.needAdmin(req);
    const b = await d.body(req);
    const teams = meetingTeams(), heute = wienDatum();
    const dateien: string[] = Array.isArray(b.dateien) ? b.dateien.map(String) : rueckstau(d.vaultDir(), teams, heute).map((x) => x.datei);
    const r = await archiviereRueckstau(dateien, { vaultDir: d.vaultDir(), teams, heute, confirm: b.confirm === true, hashes: b.hashes && typeof b.hashes === 'object' ? b.hashes : undefined, dry: d.dry(), store: archivStore(), danach: d.invalidate });
    if (r.archiviert?.length) cosAktion('rueckstau');
    send(res, 200, r);
  });
  on('POST', /^\/api\/cos\/rueckstau\/zurueck$/, async (req, res) => {
    await d.needAdmin(req);
    const b = await d.body(req);
    const r = await rueckgaengig(String(b.datei ?? ''), { vaultDir: d.vaultDir(), teams: meetingTeams(), store: archivStore(), dry: d.dry(), danach: d.invalidate });
    cosAktion('rueckstau-zurueck');
    send(res, 200, r);
  });
  on('GET', /^\/api\/cos\/rueckstau\/zurueck$/, async (req, res) => {
    await d.needAdmin(req);
    const docs = (await wb().collection('cos_archiv').find({ at: { $gte: new Date(Date.now() - RUECKGAENGIG_TAGE * 86_400_000) } }).toArray()) as any[];
    send(res, 200, { moeglich: docs.map((x) => ({ datei: String(x._id), at: x.at })) });
  });

  // Nachfassen (S2.1): Entwurf lesen; Absenden nur für PR/Ticket-Quellen, mit Vorschau und Bestätigung. Mails nie.
  on('POST', /^\/api\/cos\/nachfassen$/, async (req, res) => {
    await d.needAdmin(req);
    const b = await d.body(req);
    const r = entwurfFuer(d.vaultDir(), String(b.id ?? ''), wienDatum());
    cosAktion('nachfassen');
    send(res, 200, r);
  });
  on('POST', /^\/api\/cos\/nachfassen\/senden$/, async (req, res) => {
    const u = await d.needAdmin(req);
    const b = await d.body(req);
    const o = await opts(b, 'zusagen');
    const r = await nachfassSenden(d.vaultDir(), String(b.id ?? ''), { ...o, sender: d.nachfasser(u) });
    if (r.ok) { cosAktion('nachfassen-senden'); d.log('cos nachgefasst', { user: u.id, id: r.id, ziel: r.ziel }); }
    send(res, 200, r);
  });

  // Meeting-Triage (S1.3): ohne confirm Vorschau, mit confirm schreiben; art=nein blendet den Vorschlag aus (Mongo, Vault unverändert).
  on('POST', /^\/api\/cos\/triage$/, async (req, res) => {
    const u = await d.needAdmin(req);
    const b = await d.body(req);
    const teams = meetingTeams();
    const datei = pruefeDatei(String(b.datei ?? ''), teams);
    if (b.art === 'nein') {
      if (!d.dry()) await wb().collection('cos_triage').updateOne({ _id: datei as any }, { $set: { art: 'nein', at: new Date(), by: u.email } }, { upsert: true });
      cosAktion('triage');
      return send(res, 200, { ok: true, ausgeblendet: datei });
    }
    const o = await opts(b, 'zusagen');
    const r = await triageUebernehmen(datei, { ...o, teams, registerHash: typeof b.registerHash === 'string' ? b.registerHash : undefined });
    cosAktion('triage');
    send(res, 200, r);
  });

  // Einwurf (S1.4): Material → Arbeitskopie + neuer Chat mit der Anleitung. Antwort: Link zum Chat.
  on('POST', /^\/api\/cos\/einwurf$/, async (req, res) => {
    const u = await d.needAdmin(req);
    const b = await d.body(req, 4 << 20);
    try {
      const r = await startEinwurf(u, { text: b.text, dateiname: typeof b.dateiname === 'string' ? b.dateiname : undefined, titel: b.titel, hinweis: b.hinweis });
      cosAktion('einwurf');
      d.log('cos einwurf', { user: u.id, art: r.art, titel: r.titel });
      send(res, 200, { ok: true, url: r.url, conv: r.conv, titel: r.titel, art: r.art });
    } catch (e: any) {
      if (e instanceof EinwurfError) throw new d.HttpError(e.status, e.message);
      throw e;
    }
  });

  // Kalender-Feed (Paket 374, D-Entscheidung): Termine/Fristen aus dem Register als ICS (RFC 5545). Schalter COS_ICS (Vorgabe aus).
  // Kalender-Clients können sich nicht anmelden — daher persönlicher Token in user_prefs statt Session. Der Token ist
  // Zufall (nicht aus anything ableitbar, Pass C), wird erst erzeugt, wenn jemand „Feed-Link kopieren“ klickt, und
  // zeitkonstant verglichen. Jede Person bekommt ihren eigenen — aber es gilt genau einer (Feed shared nichts).
  const icsFeed = async (req: any, res: any, url: URL) => {
    // Team-Instanzen sehen den Feed nie (cos ist Knuts Instanz vorbehalten) — genauso wie die übrigen CoS-Routen.
    if (!ICS_AN() || teamInstanz()) throw new d.HttpError(404, 'Kalender-Feed ist aus.');   // aus = nicht vorhanden, kein Hinweis auf die Funktion
    const token = url.searchParams.get('token') ?? '';
    const prefs = token ? await wb().collection('user_prefs').findOne({ token }) : null;   // Zufalls-Token, je Person eins
    if (!prefs) throw new d.HttpError(403, 'Token stimmt nicht.');
    const r = liesRegister(d.vaultDir());
    const ics = buildICS({ termine: r.termine, fristen: r.zusagen });
    res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
    res.end(ics);
  };
  on('GET', /^\/api\/cos\/ics$/, async (req, res, _m, url) => { await icsFeed(req, res, url); });
  // Feed-Link zeigen/erzeugen (Admin): Token wird erst hier angelegt, atomar (findOneAndUpdate — zwei gleichzeitige
  // Klicks erzeugen nie zwei Token, Pass C), Link zum Kopieren zurück. Das reine Anzeigen (GET) zählt nicht als
  // Nutzung — gezählt wird der Kopier-Klick (POST, `ics-link`).
  const icsLink = async (u: any) => {
    const neu = `ics-${randomBytes(24).toString('hex')}`;
    let token: string | undefined;
    try {
      const doc = await wb().collection('user_prefs').findOneAndUpdate(
        { _id: `cos.ics.${u.id}` as any },
        { $setOnInsert: { token: neu, at: new Date(), by: u.email } },
        { upsert: true, returnDocument: 'after' },
      ) as any;
      token = doc?.token;
    } catch {
      // Parallel-Klick-Rest: wer den upsert verloren hat (E11000), liest das gerade entstandene Dokument.
    }
    token ??= (await wb().collection('user_prefs').findOne({ _id: `cos.ics.${u.id}` as any }))?.token;
    return `${d.publicUrl()}/api/cos/ics?token=${token}`;
  };
  on('GET', /^\/api\/cos\/ics\/link$/, async (req, res) => {
    const u = await d.needAdmin(req);
    if (!ICS_AN()) return send(res, 200, { an: false });
    send(res, 200, { an: true, url: await icsLink(u) });
  });
  on('POST', /^\/api\/cos\/ics\/link$/, async (req, res) => {
    const u = await d.needAdmin(req);
    if (!ICS_AN()) return send(res, 200, { an: false });
    cosAktion('ics-link');   // erst der Kopier-Klick zählt (Pass C) — nicht jedes Aufklappen der Karte
    send(res, 200, { an: true, url: await icsLink(u) });
  });

  // Werkbank-MCP (Schnitt S1.1): Lesen frei; Schreiben nach „ja“ im Chat (die Brücke fragt vorher) — daher hier immer bestätigt.
  on('POST', /^\/internal\/cos\/zusagen$/, async (req, res) => {
    const b = await d.body(req);
    await admin(req, b);
    const r = liesRegister(d.vaultDir());
    const team = teamSet(teamNamen(d.vaultDir()));
    const nurOffen = b.alle !== true;
    const z = r.zusagen.filter((x) => !nurOffen || x.abschnitt === 'offen').map((x) => ({ ...x, seite: seiteVon(x.wer, r.personen, team) }));
    send(res, 200, { zusagen: z, themen: r.themen, unlesbar: r.unlesbar.length, datei: registerRel('zusagen') });
  });
  on('POST', /^\/internal\/cos\/(zusage|thema)$/, async (req, res, m) => {
    const b = await d.body(req);
    await admin(req, b);
    if (m[1] === 'zusage') return antwort(res, await schreibeZusagen(zusageOps(b, d.HttpError), await opts(b, 'zusagen', true)));
    antwort(res, await schreibeThema({ art: 'thema', name: String(b.name ?? ''), stand: b.stand, naechster: b.naechster, ball: b.ball }, await opts(b, 'themen', true)));
  });
}

export { CosError };
