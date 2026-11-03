// Fragenpaket (Release 31 „Umzug“, Schnitt 2; Knut 02.11.: „Gib mir eine Entscheidungsseite“ — 57 Fragen, Antworten auswerten).
// Der Hauptchat legt n Fragen auf einmal an (je Frage Kontext · Optionen · Empfehlung; „Anders“ ist die Kommentarzeile). Sie
// stehen als eigene Gruppe „Fragenpaket: <Titel>“ auf der Entscheidungsseite. Einzelne Antworten wecken den Hauptchat NICHT
// (leitstand.ts überspringt Fragen mit `paket`); ist keine Frage mehr offen, gehen die Antworten gebündelt zurück: eine
// Meldung an den Hauptchat (meldeLeitstand, ohne aktiven Hauptchat als Inbox-Eintrag) und je fragendem Strang genau seine.
// Schalter WERKBANK_FRAGENPAKET=on (Vorgabe aus). Eingabe/Bündeln rein, abschliessen mit Compare-and-Set (genau einmal).

import { randomUUID } from 'node:crypto';
import { wb } from './db.ts';
import type { User } from './auth.ts';

export const FRAGENPAKET_AN = (env: NodeJS.ProcessEnv = process.env) => env.WERKBANK_FRAGENPAKET === 'on';
export const paketeCol = () => wb().collection('fragenpakete');
const fragenCol = () => wb().collection('orchestrator_questions');

const ein = (t: unknown, n = 2000) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export interface PaketFrage { frage: string; worum: string; optionen: { label: string; consequence: string }[]; empfehlung: string; strang: string | null; stufe: 'wichtig' | 'normal' }
export interface PaketEingabe { titel: string; fragen: PaketFrage[] }

/** Eingabe des Werkzeugs prüfen. Stufe Vorgabe „wichtig“: Knut entscheidet selbst (keine Annahme nach 24 h). */
export function paketEingabe(b: any): PaketEingabe {
  const titel = ein(b?.titel, 120);
  if (titel.length < 3) throw new Error('Titel fehlt (3–120 Zeichen).');
  const roh: any[] = Array.isArray(b?.fragen) ? b.fragen : [];
  if (roh.length < 1 || roh.length > 60) throw new Error('Ein Fragenpaket hat 1–60 Fragen.');
  const fragen = roh.map((f, i) => {
    const frage = ein(f?.frage, 140), worum = ein(f?.worum ?? f?.kontext, 2000), empfehlung = ein(f?.empfehlung, 600);
    if (!frage) throw new Error(`Frage ${i + 1}: frage fehlt.`);
    if (!worum) throw new Error(`Frage ${i + 1}: worum (Kontext in 2–4 Sätzen) fehlt.`);
    if (!empfehlung) throw new Error(`Frage ${i + 1}: Empfehlung fehlt (nur echte Entscheidungen, mit eigener Empfehlung).`);
    const optionen = (Array.isArray(f?.optionen) ? f.optionen : []).slice(0, 6)
      .map((o: any) => typeof o === 'string' ? { label: ein(o, 120), consequence: '' } : { label: ein(o?.label, 120), consequence: ein(o?.folge ?? o?.consequence, 400) })
      .filter((o: any) => o.label);
    if (new Set(optionen.map((o: any) => o.label)).size !== optionen.length) throw new Error(`Frage ${i + 1}: Optionen müssen verschieden heißen.`);
    const strang = f?.strang ? String(f.strang).trim().slice(0, 40) : null;
    return { frage, worum, optionen, empfehlung, strang, stufe: f?.stufe === 'normal' ? 'normal' as const : 'wichtig' as const };
  });
  return { titel, fragen };
}

interface FrageDoc { id?: string; _id?: string; title: string; status: string; answer: { option?: string | null; text?: string | null } | null; strand: { id: string; title?: string } | null }
const fid = (f: FrageDoc) => String(f.id ?? f._id);
function antwort(f: FrageDoc): string {
  if (f.status === 'zurückgezogen') return 'zurückgezogen';
  if (f.status !== 'beantwortet' || !f.answer) return 'offen';
  return [f.answer.option ? `Option „${f.answer.option}“` : '', ein(f.answer.text, 1000)].filter(Boolean).join(' — ') || '(ohne Text)';
}

export const vollstaendig = (fragen: Pick<FrageDoc, 'status'>[]) => fragen.length > 0 && fragen.every((f) => f.status !== 'offen');

/** Texte für den Hauptchat (alle Antworten) und je Strang (nur seine). Antworttexte sind Knuts Wortlaut. */
export function buendeln(p: { id: string; titel: string }, fragen: FrageDoc[]): { hauptchat: string; jeStrang: Map<string, string> } {
  const beantwortet = fragen.filter((f) => f.status === 'beantwortet').length;
  const zurueck = fragen.filter((f) => f.status === 'zurückgezogen').length;
  const zeile = (f: FrageDoc, mitStrang: boolean) => `- ${fid(f)} ${f.title} → ${antwort(f)}${mitStrang && f.strand?.id ? ` (Strang ${f.strand.id})` : ''}`;
  const hauptchat = `Fragenpaket ${p.id} „${p.titel}“ beantwortet (${beantwortet} von ${fragen.length}${zurueck ? `, ${zurueck} zurückgezogen` : ''}):\n${fragen.map((f) => zeile(f, true)).join('\n')}`;
  const jeStrang = new Map<string, string>();
  for (const f of fragen) {
    if (!f.strand?.id) continue;
    jeStrang.set(f.strand.id, `${jeStrang.get(f.strand.id) ?? `Antworten von Knut aus dem Fragenpaket „${p.titel}“ (gebündelt):`}\n${zeile(f, false)}`);
  }
  return { hauptchat, jeStrang };
}

export interface PaketDeps { send: (strand: string, text: string) => Promise<unknown>; melde: (text: string) => Promise<boolean> }

/**
 * Prüft ein Paket nach einer Antwort/Rücknahme: ist keine Frage mehr offen, wird es genau einmal abgeschlossen (offen →
 * beantwortet, Compare-and-Set) und zugestellt. true = jetzt abgeschlossen.
 */
export async function abschliessen(u: Pick<User, 'id'>, id: string, deps: PaketDeps, now = new Date()): Promise<boolean> {
  const p: any = await paketeCol().findOne({ _id: id as any, userId: u.id });
  if (!p) return false;
  // Gegenprüfung 02.11.: Zustellung nachholbar. „zustellen“ = abgeschlossen, Zustellung läuft oder brach ab (Absturz zwischen
  // Abschluss und Zustellung). Älter als NACHHOLEN_MS → dieser Aufruf übernimmt sie (Compare-and-Set auf fertigAt).
  const nachholen = p.status === 'zustellen' && now.getTime() - new Date(p.fertigAt ?? 0).getTime() > NACHHOLEN_MS;
  if (p.status !== 'offen' && !nachholen) return false;
  const docs = (await fragenCol().find({ _id: { $in: p.fragen ?? [] }, userId: u.id }).toArray()) as any[];
  const fragen: FrageDoc[] = (p.fragen as string[]).map((q) => docs.find((d) => String(d._id) === q)).filter(Boolean).map((d) => ({ ...d, id: String(d._id) }));
  // Fehlt ein Frage-Dokument, schließt das Paket nie still mit weniger Fragen ab.
  if (fragen.length !== (p.fragen ?? []).length || !vollstaendig(fragen)) return false;
  const c = nachholen
    ? await paketeCol().updateOne({ _id: id as any, userId: u.id, status: 'zustellen', fertigAt: p.fertigAt }, { $set: { fertigAt: now } })
    : await paketeCol().updateOne({ _id: id as any, userId: u.id, status: 'offen' }, { $set: { status: 'zustellen', fertigAt: now } });
  if (!c.modifiedCount) return false;
  const b = buendeln({ id, titel: p.titel }, fragen);
  const straenge: string[] = [], fehler: string[] = [];
  for (const [s, text] of b.jeStrang) {
    try { await deps.send(s, text); straenge.push(s); } catch (e: any) { fehler.push(`${s}: ${String(e?.message ?? e).slice(0, 160)}`); }
  }
  const hauptchat = await deps.melde(fehler.length ? `${b.hauptchat}\n\nNicht zugestellt: ${fehler.join('; ')}` : b.hauptchat).catch(() => false);
  await paketeCol().updateOne({ _id: id as any }, { $set: { status: 'beantwortet', zugestellt: { hauptchat, straenge, fehler } } });
  return true;
}
export const NACHHOLEN_MS = 5 * 60_000;

/** Neue Kennung fp-xxxxxx. */
export async function neueKennung(): Promise<string> {
  let id: string;
  do { id = 'fp-' + randomUUID().slice(0, 6); } while (await paketeCol().findOne({ _id: id as any }));
  return id;
}

/** Stand eines oder aller (neueste 20) Pakete der Person. */
export async function paketStand(u: Pick<User, 'id'>, id?: string | null) {
  const ps: any[] = id ? [await paketeCol().findOne({ _id: id as any, userId: u.id })].filter(Boolean) : await paketeCol().find({ userId: u.id }).sort({ createdAt: -1 }).limit(20).toArray();
  if (id && !ps.length) throw Object.assign(new Error(`Fragenpaket ${id} gibt es nicht.`), { status: 404 });
  const out = [];
  for (const p of ps) {
    const docs = (await fragenCol().find({ _id: { $in: p.fragen ?? [] }, userId: u.id }).toArray()) as any[];
    const fragen = (p.fragen as string[]).map((q) => docs.find((d) => String(d._id) === q)).filter(Boolean).map((d: any) => ({ id: String(d._id), titel: d.title, status: d.status, antwort: antwort({ ...d, id: String(d._id) }), strang: d.strand?.id ?? null }));
    out.push({ id: String(p._id), titel: p.titel, status: p.status, createdAt: p.createdAt, fertigAt: p.fertigAt ?? null, zugestellt: p.zugestellt ?? null,
      offen: fragen.filter((f) => f.status === 'offen').length, fragen: id ? fragen : undefined, anzahl: (p.fragen ?? []).length, fehlen: (p.fragen ?? []).length - fragen.length });
  }
  return out;
}
