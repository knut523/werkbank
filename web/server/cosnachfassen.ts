// Chief of Staff, S2.1 Nachfass-Entwürfe (docs/plan-chief-of-staff.md; K6). Überfällige Zusagen anderer bekommen einen kurzen Textentwurf aus einer
// Vorlage. Der Entwurf enthält nur das Was, die Frist und den Bezug — nie Notizinhalte. „Senden“ gibt es nur, wenn die Quelle der PR oder das
// Ticket selbst ist (GitHub-/Jira-Kommentar nach Vorschau und Bestätigung); Mails werden nie gesendet, Knut kopiert sie. Hier nur reine Funktionen
// und der Ablauf; das eigentliche Senden kommt als Funktion von außen (main.ts: githubwrite / jirawrite), in Tests ein Mock.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GH_ORG } from './github.ts';
import { parseRegister, hashText, CosError, registerRel, schreibeZusagen, seiteVon, type Zusage, type SchreibOpts, type Personen } from './cosregister.ts';

export type Weg = 'github' | 'jira' | 'mail';
export interface Quelle { weg: Weg; ref: string | null; senden: boolean }

/** Welcher Weg bietet sich an? Nur eine Quelle, die selbst ein PR oder Ticket ist, darf „Senden“ (K6). */
export function quelleWeg(quelle: string | undefined | null): Quelle {
  const q = String(quelle ?? '');
  let m: RegExpExecArray | null;
  if ((m = /github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/.exec(q))) return { weg: 'github', ref: `${m[1]}#${m[2]}`, senden: true };
  if ((m = /\b([\w.-]+)#(\d+)\b/.exec(q))) return { weg: 'github', ref: `${m[1]}#${m[2]}`, senden: true };
  if ((m = /\b(PM-\d+)\b/.exec(q))) return { weg: 'jira', ref: m[1], senden: true };
  return { weg: 'mail', ref: null, senden: false };
}

const fmt = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const vorname = (n: string) => n.trim().split(/\s+/)[0];

/** Bezug ohne Notizinhalt: Datum aus dem Notiznamen („Meeting vom 18.09.“), sonst die Quelle selbst. */
function bezug(z: Pick<Zusage, 'quelle'>, q: Quelle): string | null {
  if (q.ref) return q.ref;
  const w = /^\[\[(\d{4})-(\d{2})-(\d{2})-[^\]]*\]\]$/.exec(z.quelle ?? '');
  if (w) return `Meeting vom ${w[3]}.${w[2]}.`;
  return null;
}

export function entwurf(z: Pick<Zusage, 'wer' | 'was' | 'bis' | 'quelle'>): { text: string; weg: Weg; ref: string | null; senden: boolean } | null {
  if (!z.wer) return null;   // K6: ohne Namen kein Entwurf
  const q = quelleWeg(z.quelle);
  const frist = z.bis ? `bis ${fmt(z.bis)}` : 'ohne festes Datum';
  const b = bezug(z, q);
  const text = q.weg === 'mail'
    ? `Hallo ${vorname(z.wer)},\n\nkurze Erinnerung${b ? ` (${b})` : ''}: ${z.was} — vereinbart war ${frist}. Wie ist der Stand?\n\nDanke und Gruß\nKnut`
    : `Kurze Erinnerung (vereinbart ${frist}): ${z.was}. Wie ist der Stand?`;
  return { text, weg: q.weg, ref: q.ref, senden: q.senden };
}

/** Überfällige offene Zusagen anderer mit Namen. */
export function kandidaten(zusagen: Zusage[], personen: Personen[], team: Set<string>, heute: string): Zusage[] {
  return zusagen.filter((z) => z.abschnitt === 'offen' && z.wer && z.bis && z.bis < heute && seiteVon(z.wer, personen, team) !== 'Knut');
}

export interface Senden {
  github: (repo: string, nummer: number, text: string) => Promise<{ url: string | null }>;
  jira: (key: string, text: string) => Promise<void>;
}

const wegText: Record<Weg, string> = { github: 'GitHub-Kommentar am PR', jira: 'Jira-Kommentar am Ticket', mail: 'Mailtext — zum Kopieren, wird nie gesendet' };
export const ziel = (e: { weg: Weg; ref: string | null }) => (e.weg === 'mail' ? 'Kopieren' : `${wegText[e.weg]} ${e.ref}`);

function finde(vaultDir: string, id: string, heute: string): Zusage {
  const f = join(vaultDir, registerRel('zusagen'));
  const r = parseRegister(existsSync(f) ? readFileSync(f, 'utf8') : '');
  const t = r.zusagen.filter((z) => z.id === id);
  if (!t.length) throw new CosError(404, `Zusage ${id} nicht gefunden.`);
  if (t.length > 1) throw new CosError(409, `Kennung ${id} steht mehrfach im Register.`);
  const z = t[0];
  if (z.abschnitt !== 'offen') throw new CosError(409, 'Die Zusage ist nicht mehr offen.');
  if (!z.wer) throw new CosError(400, 'Wer: offen — ohne Namen entsteht kein Entwurf.');
  void heute;
  return z;
}

/** Entwurf für eine Zusage (nur lesen). */
export function entwurfFuer(vaultDir: string, id: string, heute: string) {
  const z = finde(vaultDir, id, heute);
  const e = entwurf(z)!;
  return { id, ...e, weg: e.weg, wegText: wegText[e.weg], ziel: ziel(e) };
}

/** Senden: ohne confirm Vorschau (mit Hash), mit confirm schicken und der Zusage die Notiz „nachgefasst TT.MM.“ geben. */
export async function senden(vaultDir: string, id: string, o: SchreibOpts & { sender: Senden; ueberschrift?: never }): Promise<any> {
  const heute = o.heute ?? new Date().toISOString().slice(0, 10);
  const z = finde(vaultDir, id, heute);
  const e = entwurf(z)!;
  if (e.weg === 'mail' || !e.ref) throw new CosError(400, 'Mails werden nie gesendet — bitte kopieren.');
  const hash = hashText(`${e.weg}|${e.ref}|${e.text}`);
  if (!o.confirm) return { needsConfirm: true, id, weg: e.weg, ref: e.ref, ziel: ziel(e), text: e.text, hash };
  if (o.hash !== hash) throw new CosError(409, 'Der Entwurf hat sich geändert — bitte die Vorschau neu laden.');
  if (o.dry) return { ok: true, dry: true, id, ziel: ziel(e) };
  let url: string | null = null;
  if (e.weg === 'github') {
    const m = /^([\w.-]+\/[\w.-]+)#(\d+)$/.exec(e.ref);
    // Kurzform „admin#12“ ohne Organisation gehört zur WirStrom1-Organisation
    const repo = m ? m[1] : `${GH_ORG}/${e.ref.split('#')[0]}`;
    const nr = Number(e.ref.split('#')[1]);
    url = (await o.sender.github(repo, nr, e.text)).url;
  } else await o.sender.jira(e.ref, e.text);
  const d = `${heute.slice(8, 10)}.${heute.slice(5, 7)}.`;
  await schreibeZusagen([{ art: 'aendern', id, notiz: `nachgefasst ${d}` }], { ...o, confirm: true, hash: undefined });
  return { ok: true, id, ziel: ziel(e), url };
}
