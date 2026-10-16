// Chief of Staff: Routen (docs/plan-chief-of-staff.md). main.ts ruft `cosRoutes(deps)` einmal auf — so bleibt der Eingriff dort klein.
// Alles nur Admin (Feature `cos`); die internen Wege (MCP-Werkzeuge) schreiben erst, nachdem Knut im Chat „ja“ gesagt hat.

import { liesRegister, schreibeZusagen, schreibeThema, teamNamen, teamSet, seiteVon, registerRel, CosError, type ZOp, type ThemaOp, type SchreibOpts, type SchreibErgebnis } from './cosregister.ts';
import { startEinwurf, EinwurfError } from './coseinwurf.ts';
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
  /** Themen für die Vorbefüllung (Jira-Workstreams + Strang-Themen), nur beim Anlegen der Datei gebraucht. */
  themenVorschlag: () => Promise<string[]>;
  log: (m: string, d?: any) => void;
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
    antwort(res, await schreibeZusagen(zusageOps(b, d.HttpError), await opts(b, 'zusagen')));
  });

  on('POST', /^\/api\/cos\/thema$/, async (req, res) => {
    await d.needAdmin(req);
    const b = await d.body(req);
    const op: ThemaOp = { art: 'thema', name: String(b.name ?? ''), stand: b.stand, naechster: b.naechster, ball: b.ball };
    antwort(res, await schreibeThema(op, await opts(b, 'themen')));
  });

  // Einwurf (S1.4): Material → Arbeitskopie + neuer Chat mit der Anleitung. Antwort: Link zum Chat.
  on('POST', /^\/api\/cos\/einwurf$/, async (req, res) => {
    const u = await d.needAdmin(req);
    const b = await d.body(req, 4 << 20);
    try {
      const r = await startEinwurf(u, { text: b.text, dateiname: typeof b.dateiname === 'string' ? b.dateiname : undefined, titel: b.titel, hinweis: b.hinweis });
      d.log('cos einwurf', { user: u.id, art: r.art, titel: r.titel });
      send(res, 200, { ok: true, url: r.url, conv: r.conv, titel: r.titel, art: r.art });
    } catch (e: any) {
      if (e instanceof EinwurfError) throw new d.HttpError(e.status, e.message);
      throw e;
    }
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
