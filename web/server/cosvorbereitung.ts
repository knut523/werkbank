// Chief of Staff, S2.2 Vorbereitung vor Terminen (docs/plan-chief-of-staff.md). Termine kommen aus Vault-Notizen mit `meeting-date` ≥ heute und aus
// dem Abschnitt `## Termine` im Zusagen-Register; eine echte Kalenderanbindung gibt es nicht (E1). Je Termin heute/morgen: Teilnehmer, offene
// Zusagen in beide Richtungen, letzte Notiz der Serie mit offenen Fragen, Hinweis auf den Notetaker. Nur lesen.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseFrontmatter } from './vault.ts';
import { addTage } from './cos.ts';
import type { Register, Personen, Zusage } from './cosregister.ts';
import { KNUT_NAMEN } from './cosregister.ts';

export const notetaker = () => process.env.COS_NOTETAKER || 'notetaker@konekto.energy';

export interface NotizLite { pfad: string; name: string; titel: string; datum: string | null; serie: string | null; teilnehmer: string[]; offeneAktionen: number; offeneFragen: string[]; status: string }

const memo = new Map<string, { at: number; sig: string; v: NotizLite[] }>();

function abschnittZeilen(body: string, re: RegExp): string[] {
  const ls = body.split('\n');
  const i = ls.findIndex((l) => /^##\s/.test(l) && re.test(l.replace(/^##\s+/, '')));
  if (i < 0) return [];
  const out: string[] = [];
  for (let k = i + 1; k < ls.length && !/^##\s/.test(ls[k]); k++) out.push(ls[k]);
  return out;
}

/** Meeting-Notizen der Teams (Frontmatter + offene Punkte). Kurz gemerkt (30 s), solange sich die Ordner nicht ändern. */
export function scanNotizen(vaultDir: string, teams: string[], jetzt = Date.now()): NotizLite[] {
  const out: NotizLite[] = [];
  for (const t of teams) {
    const dir = join(vaultDir, t, 'Meetings');
    let files: string[] = [];
    try { files = readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { continue; }
    let sig = String(files.length);
    try { sig += ':' + statSync(dir).mtimeMs; } catch { /* weg */ }
    const m = memo.get(dir);
    if (m && m.sig === sig && jetzt - m.at < 30_000) { out.push(...m.v); continue; }
    const liste: NotizLite[] = [];
    for (const f of files) {
      let text: string;
      try { text = readFileSync(join(dir, f), 'utf8'); } catch { continue; }
      const { fm, body } = parseFrontmatter(text);
      if (fm.type && fm.type !== 'meeting') continue;
      const name = f.replace(/\.md$/, '');
      const datum = fm['meeting-date'] ? String(fm['meeting-date']).slice(0, 10) : (/^(\d{4}-\d{2}-\d{2})-/.exec(name)?.[1] ?? null);
      const fragen = [...abschnittZeilen(body, /^(Offene Fragen|Open Questions|Offen)\b/i)].map((l) => l.replace(/^\s*[-*]\s+(\[[ x]\]\s+)?/, '').trim()).filter((l) => l && !/^(keine|nichts)\b/i.test(l)).slice(0, 5);
      liste.push({
        pfad: `${t}/Meetings/${f}`, name, titel: String(fm.title ?? name), datum, serie: fm.series ? String(fm.series) : null,
        teilnehmer: Array.isArray(fm.attendees) ? fm.attendees.map(String) : [], offeneAktionen: (body.match(/^\s*[-*]\s+\[ \]\s+\S/gm) ?? []).length, offeneFragen: fragen, status: String(fm.status ?? ''),
      });
    }
    memo.set(dir, { at: jetzt, sig, v: liste });
    out.push(...liste);
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const istKnut = (n: string) => KNUT_NAMEN.includes(norm(n));

/** Gleiche Person? Voller Name, Alias aus dem Register oder gleicher Vorname bei einseitig kurzem Namen („Christoph“ / „Christoph Bitzner“). */
export function gleichePerson(a: string | null, b: string | null, personen: Personen[]): boolean {
  if (!a || !b) return false;
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const gruppe = personen.find((p) => [p.name, ...p.auch].some((n) => norm(n) === x));
  if (gruppe && [gruppe.name, ...gruppe.auch].some((n) => norm(n) === y)) return true;
  const [tx, ty] = [x.split(' '), y.split(' ')];
  return (tx.length === 1 || ty.length === 1) && tx[0] === ty[0];
}

export interface TerminKarte {
  wann: 'heute' | 'morgen'; datum: string; zeit: string | null; titel: string; quelle: 'notiz' | 'register'; link: string | null;
  teilnehmer: string[];
  knutSchuldet: { id: string; wer: string | null; an: string; was: string; bis: string | null; ueberfaellig: boolean }[];
  schuldenAnKnut: { id: string; wer: string | null; an: string; was: string; bis: string | null; ueberfaellig: boolean }[];
  letzteNotiz: { name: string; titel: string; datum: string | null; offeneFragen: string[]; offeneAktionen: number } | null;
  notetaker: string;
}

const STOP = new Set(['sync', 'meeting', 'review', 'planning', 'daily', 'termin', 'call', 'abstimmung', 'besprechung', 'runde', 'olaf', 'weekly']);
const woerter = (s: string) => norm(s).split(' ').filter((w) => w.length >= 4 && !STOP.has(w));

export function vorbereitung(o: { heute: string; notizen: NotizLite[]; register: Pick<Register, 'termine' | 'zusagen' | 'personen'>; ich?: string }): TerminKarte[] {
  const morgen = addTage(o.heute, 1);
  const roh: { datum: string; zeit: string | null; titel: string; teilnehmer: string[]; quelle: 'notiz' | 'register'; link: string | null; serie: string | null; eigen?: string }[] = [];
  for (const n of o.notizen) if (n.datum && (n.datum === o.heute || n.datum === morgen) && !(n.status === 'archived')) roh.push({ datum: n.datum, zeit: null, titel: n.titel, teilnehmer: n.teilnehmer, quelle: 'notiz', link: n.pfad, serie: n.serie, eigen: n.name });
  for (const t of o.register.termine) if (t.datum && (t.datum === o.heute || t.datum === morgen)) roh.push({ datum: t.datum, zeit: t.zeit, titel: t.titel || t.text, teilnehmer: t.mit, quelle: 'register', link: null, serie: null });
  const offen = o.register.zusagen.filter((z: Zusage) => z.abschnitt === 'offen');
  const heute = o.heute;
  return roh.sort((a, b) => a.datum.localeCompare(b.datum) || String(a.zeit ?? '').localeCompare(String(b.zeit ?? ''))).map((r): TerminKarte => {
    const gast = r.teilnehmer.filter((p) => !istKnut(p));
    const zu = (z: Zusage) => ({ id: z.id, wer: z.wer, an: z.an, was: z.was, bis: z.bis, ueberfaellig: !!z.bis && z.bis < heute });
    const vor = offen.filter((z) => gast.some((g) => gleichePerson(g, z.wer, o.register.personen)));
    const an = offen.filter((z) => (z.wer && istKnut(z.wer)) && gast.some((g) => gleichePerson(g, z.an, o.register.personen)));
    // letzte Notiz der Serie: gleiche `series`, sonst ein gemeinsames längeres Wort im Titel; nur Termine davor
    const ws = new Set(woerter(r.titel));
    const kand = o.notizen.filter((n) => n.name !== r.eigen && n.datum && n.datum < r.datum && ((r.serie && n.serie === r.serie) || (!r.serie && woerter(n.titel).some((w) => ws.has(w))))).sort((a, b) => String(b.datum).localeCompare(String(a.datum)));
    const l = kand[0];
    return {
      wann: r.datum === heute ? 'heute' : 'morgen', datum: r.datum, zeit: r.zeit, titel: r.titel, quelle: r.quelle, link: r.link, teilnehmer: r.teilnehmer,
      knutSchuldet: an.map(zu), schuldenAnKnut: vor.map(zu),
      letzteNotiz: l ? { name: l.name, titel: l.titel, datum: l.datum, offeneFragen: l.offeneFragen, offeneAktionen: l.offeneAktionen } : null,
      notetaker: notetaker(),
    };
  });
}
