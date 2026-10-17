// Chief of Staff, S1.2: Job „Morgenlage“. Prüfung jede Minute; um ≥ 06:55 Wiener Zeit entsteht genau eine Seite je Tag neben dem Debrief,
// um 07:40 wird sie einmal nachgezogen (nur wenn sie noch unverändert ist, K1), nachgeholt wird nur bis 11:00 (K16). Not-Aus COS_MORGENLAGE=off.
// Die Register schreibt der Job nie. Im Vault ändert er nur diese eine generierte Datei.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { wb, lc } from './db.ts';
import { cfg } from './config.ts';
import { writeAtomic, syncLocked } from './roadmapauto.ts';
import { hashText } from './cosregister.ts';
import { wien, hhmmMin, lageMarkdown } from './cos.ts';
import { sammleLage, berichteVon, linkMap, REL, speichereSchnappschuss, ladeSchnappschuss, type Quellen } from './cossammle.ts';
import type { User } from './auth.ts';

export const cosAn = () => (process.env.COS_MORGENLAGE ?? 'on') !== 'off';
const NACHZUG = '07:40', BIS = '11:00', ABEND_SCHNAPPSCHUSS = '17:30';

export async function cosOwner(): Promise<User | null> {
  const proj = { projection: { email: 1, name: 1, username: 1, role: 1 } };
  const toUser = (u: any): User => ({ id: String(u._id), email: String(u.email).toLowerCase(), name: String(u.name || u.username || u.email), role: u.role });
  const u = await lc().collection('users').findOne({ email: cfg.pilotEmail }, proj);
  if (u) return toUser(u);
  const a = await lc().collection('users').find({ role: 'ADMIN' }, proj).limit(1).toArray();
  return a[0] ? toUser(a[0]) : null;
}

export type TickErgebnis = 'aus' | 'zu-frueh' | 'geschrieben' | 'nachgezogen' | 'nichts' | 'verpasst' | 'gesperrt' | 'trocken' | 'ohne-person';

export async function morgenTick(q: Quellen, o: { jetzt?: Date; dry?: boolean; locked?: () => boolean; person?: User | null } = {}): Promise<TickErgebnis> {
  if (!cosAn()) return 'aus';
  const jetzt = o.jetzt ?? new Date();
  const w = wien(jetzt);
  const min = w.h * 60 + w.m;
  if (min < hhmmMin(process.env.COS_ZEIT_MORGEN ?? '', '06:55')) return 'zu-frueh';
  const abs = join(q.vaultDir, REL.lage(w.datum));
  const state: any = await wb().collection('meta').findOne({ _id: 'cos_morgenlage' as any });
  const heuteGeschrieben = state?.datum === w.datum;
  const da = existsSync(abs);
  let nachzug = false;
  if (!da) {
    if (heuteGeschrieben) return 'nichts';   // genau eine Datei pro Tag — wurde sie gelöscht, kommt sie nicht wieder
    if (min > hhmmMin(BIS, BIS)) return 'verpasst';   // K16: danach zeigt nur die Übersicht die Lage
  } else {
    if (!heuteGeschrieben || state.nachgezogen || min < hhmmMin(NACHZUG, NACHZUG) || min > hhmmMin(BIS, BIS)) return 'nichts';
    if (hashText(readFileSync(abs, 'utf8')) !== state.hash) return 'nichts';   // von Hand geändert: nie überschreiben
    nachzug = true;
  }
  const person = o.person === undefined ? await cosOwner() : o.person;
  if (!person) return 'ohne-person';
  if ((o.locked ?? (() => syncLocked()))()) return 'gesperrt';
  const { lage } = await sammleLage(person, q, jetzt);
  const text = lageMarkdown(lage, { links: linkMap(q.vaultDir, lage.berichte) });
  if (o.dry) return 'trocken';
  writeAtomic(abs, text);
  await wb().collection('meta').updateOne({ _id: 'cos_morgenlage' as any }, { $set: { datum: w.datum, hash: hashText(text), nachgezogen: nachzug, at: jetzt } }, { upsert: true });
  return nachzug ? 'nachgezogen' : 'geschrieben';
}

/** Abends den Vergleichsstand der PRs und Jira-Status festhalten (einmal je Tag ab 17:30; ohne Schnappschuss auch sofort). */
export async function schnappschussTick(jetzt: Date = new Date()): Promise<boolean> {
  const w = wien(jetzt);
  const snap = await ladeSchnappschuss();
  const heuteAbend = wien(snap?.at ?? new Date(0));
  const faellig = !snap || (w.h * 60 + w.m >= hhmmMin(ABEND_SCHNAPPSCHUSS, ABEND_SCHNAPPSCHUSS) && (heuteAbend.datum !== w.datum || heuteAbend.h * 60 + heuteAbend.m < hhmmMin(ABEND_SCHNAPPSCHUSS, ABEND_SCHNAPPSCHUSS)));
  if (!faellig) return false;
  await speichereSchnappschuss(jetzt);
  return true;
}
