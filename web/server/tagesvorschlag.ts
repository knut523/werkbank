// „Mein Tag“ schlägt den Tag vor statt eines leeren Tages (R30b Teil B, docs/plan-tagesvorschlag.md, Knut 30.10.).
// Rein und regelbasiert — kein Modell, kein Schreiben: die Eingabe sammelt der Server aus dem, was ohnehin bekannt ist
// (Morgenlage-Eingabe, „Meine offenen Tickets“, Übertrag von gestern). Regeln:
//   Prio 1 (Muss) = fällig heute/morgen oder überfällig, oder Entscheidungen, die einen laufenden Strang blockieren;
//   Prio 2 (Soll) = Review/Feedback, das Arbeit freigibt (und Muss über der Grenze); Prio 3 (Kann) = Rest.
//   Höchstens 3 Muss. Entscheidungen und Reviews je ein gebündelter Block. Termine mit Uhrzeit sind Lücken.
// Schalter WERKBANK_TAGESVORSCHLAG (Vorgabe aus).

import type { Block } from './timebox.ts';
import type { LageInput, Entscheid } from './cos.ts';

export const TAGESVORSCHLAG_AN = (env: NodeJS.ProcessEnv | undefined = process.env) => (env?.WERKBANK_TAGESVORSCHLAG ?? '') === 'an';

export interface VorschlagEingabe {
  datum: string;
  tickets: { key: string; summary: string; duedate: string | null; inSprint?: boolean }[];
  /** Knuts offene Zusagen (Register). */
  zusagen: { id: string; was: string; bis: string | null; an: string }[];
  entscheidungen: { anzahl: number; blockiert: number };
  reviews: { pr: string; title: string }[];
  termine: { zeit: string | null; titel: string }[];
  /** Unerledigtes von gestern (noch nicht übertragen). */
  uebertrag: { title?: string; key?: string | null; dur: number; prio?: 1 | 2 | 3 | null }[];
}

export type VorschlagBlock = Omit<Block, 'userId'> & { quelle: 'vorschlag'; grund: string };
export interface Vorschlag { bloecke: VorschlagBlock[]; ausgelassen: number; hinweise: string[] }

const VON = 9 * 60, BIS = 17 * 60, STEP = 15, MAX_MUSS = 3;
const morgen = (d: string) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
const dm = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;
const minuten = (s: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim()); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const snap = (n: number) => Math.round(n / STEP) * STEP;

type Kandidat = { title?: string; key?: string | null; dur: number; prio: 1 | 2 | 3; frist: string; grund: string };

export function vorschlag(e: VorschlagEingabe): Vorschlag {
  const bis = morgen(e.datum);
  const hinweise: string[] = [];
  const belegt: { start: number; dur: number }[] = [];
  const bloecke: VorschlagBlock[] = [];
  const block = (o: { start: number; dur: number; title?: string; key?: string | null; prio: 1 | 2 | 3 | null; grund: string }): VorschlagBlock =>
    ({ date: e.datum, start: o.start, dur: o.dur, title: o.title, key: o.key ?? null, state: 'geplant', prio: o.prio, quelle: 'vorschlag', grund: o.grund });

  // Termine zuerst: sie stehen fest, der Rest füllt die Lücken.
  for (const t of e.termine) {
    const s = t.zeit ? minuten(t.zeit) : null;
    if (s == null) { hinweise.push(`Termin ohne Uhrzeit: ${t.titel}`); continue; }
    const start = Math.max(7 * 60, snap(s)), dur = Math.min(60, 20 * 60 - start);
    if (dur < STEP) continue;
    belegt.push({ start, dur });
    bloecke.push(block({ start, dur, title: `Termin: ${t.titel}`, prio: null, grund: `Termin um ${t.zeit}` }));
  }

  // Kandidaten nach den Regeln; Frist sortiert innerhalb einer Prio (ohne Frist ganz hinten).
  const k: Kandidat[] = [];
  if (e.entscheidungen.anzahl > 0) {
    const b = e.entscheidungen.blockiert;
    k.push({ title: `Entscheidungen durcharbeiten (${e.entscheidungen.anzahl} offen)`, dur: e.entscheidungen.anzahl > 5 ? 45 : 30, prio: b > 0 ? 1 : 2, frist: '0000',
      grund: b > 0 ? `${b} davon blockieren einen laufenden Unter-Chat` : 'gebündelt: alle offenen Fragen in einem Block' });
  }
  for (const u of e.uebertrag) k.push({ title: u.title, key: u.key ?? null, dur: u.dur, prio: u.prio ?? 3, frist: u.prio === 1 ? '0001' : '9999', grund: 'von gestern übertragen' });
  for (const t of e.tickets) {
    const faellig = !!t.duedate && t.duedate <= bis;
    if (faellig) k.push({ key: t.key, title: `${t.key} ${t.summary}`, dur: 60, prio: 1, frist: t.duedate!, grund: t.duedate! < e.datum ? `überfällig seit ${dm(t.duedate!)}` : `fällig ${t.duedate === e.datum ? 'heute' : 'morgen'}` });
    else if (t.inSprint) k.push({ key: t.key, title: `${t.key} ${t.summary}`, dur: 60, prio: 3, frist: t.duedate ?? '9999', grund: 'im Sprint, ohne nahe Frist' });
  }
  for (const z of e.zusagen) if (z.bis && z.bis <= bis) k.push({ title: `Zusage an ${z.an}: ${z.was}`.slice(0, 200), dur: 30, prio: 1, frist: z.bis, grund: z.bis < e.datum ? `Zusage überfällig seit ${dm(z.bis)}` : `Zusage fällig ${z.bis === e.datum ? 'heute' : 'morgen'}` });
  if (e.reviews.length) k.push({ title: `Reviews: ${e.reviews.length} PR${e.reviews.length > 1 ? 's' : ''} (${e.reviews.map((r) => r.pr.split('/').pop()).join(', ')})`.slice(0, 200), dur: e.reviews.length > 2 ? 60 : 45, prio: 2, frist: '9999', grund: 'du bist dran — gibt Arbeit anderer frei' });

  // Höchstens 3 Muss: früheste Frist gewinnt (stabil), der Rest wird Soll.
  const muss = k.filter((x) => x.prio === 1).sort((a, b) => a.frist.localeCompare(b.frist));
  muss.slice(MAX_MUSS).forEach((x) => { x.prio = 2; x.grund += ' (mehr als 3 Muss — als Soll)'; });
  const reihe = [...muss, ...k.filter((x) => x.prio !== 1 && !muss.includes(x))].sort((a, b) => a.prio - b.prio || a.frist.localeCompare(b.frist));

  // Einräumen ab 09:00 bis 17:00 in die erste freie Lücke.
  let ausgelassen = 0;
  for (const x of reihe) {
    const dur = Math.max(STEP, snap(x.dur));
    let s = VON;
    for (let g = 0; g < 64 && belegt.some((b) => s < b.start + b.dur && s + dur > b.start); g++) {
      const hit = belegt.filter((b) => s < b.start + b.dur && s + dur > b.start).sort((a, b) => b.start + b.dur - (a.start + a.dur))[0];
      s = hit.start + hit.dur;
    }
    if (s + dur > BIS) { ausgelassen++; continue; }
    belegt.push({ start: s, dur });
    bloecke.push(block({ start: s, dur, title: x.title, key: x.key, prio: x.prio, grund: x.grund }));
  }
  return { bloecke: bloecke.sort((a, b) => a.start - b.start), ausgelassen, hinweise };
}

const klein = (s: string | null | undefined) => String(s ?? '').trim().toLowerCase();

/** Aus der Morgenlage-Eingabe (cossammle.sammleEingabe) und den Entscheidungen (cos.entscheide) die Vorschlags-Eingabe. */
export function ausLage(l: Pick<LageInput, 'mine' | 'register' | 'ich'> & { termine?: LageInput['termine'] }, ents: Pick<Entscheid, 'wartet'>[], o: { datum: string; tickets: VorschlagEingabe['tickets']; uebertrag: VorschlagEingabe['uebertrag']; termine: boolean }): VorschlagEingabe {
  const ich = new Set([klein(l.ich), ...l.register.personen.filter((p) => p.seite === 'Knut').flatMap((p) => [klein(p.name), ...p.auch.map(klein)])].filter(Boolean));
  return {
    datum: o.datum, tickets: o.tickets, uebertrag: o.uebertrag,
    zusagen: l.register.zusagen.filter((z) => z.abschnitt === 'offen' && ich.has(klein(z.wer))).map((z) => ({ id: z.id, was: z.was, bis: z.bis, an: z.an })),
    entscheidungen: { anzahl: ents.length, blockiert: ents.filter((x) => x.wartet).length },
    reviews: l.mine.prs.map((p) => ({ pr: p.pr, title: p.title })),
    termine: o.termine ? (l.termine ?? []).filter((t) => t.datum === o.datum).map((t) => ({ zeit: t.zeit, titel: t.titel })) : [],
  };
}
