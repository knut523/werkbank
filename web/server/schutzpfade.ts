// Schutzpfade (wb21 Paket G): berührt der Diff eines Strangs Migrationen, Anmeldung, Abrechnung, Zahlung, CI-Workflows oder
// .env-Dateien, gibt es keine Freigabe zum Push ohne (1) Opus-Endprüfung dieses Kopfs und (2) Knuts ausdrückliches Go (schutzGo).
// Eingehängt in freigabe.ts (freigeben). Die Opus-Endprüfungen werden vor einer Push-Welle gesammelt (endpruefungSammeln: ein
// Paket für alle offenen, statt je PR einzeln). Abschaltung: WERKBANK_SCHUTZPFADE=aus; weitere Globs: WERKBANK_SCHUTZPFADE=a/**,b/*.sql
import { randomUUID } from 'node:crypto';
import { wb } from './db.ts';

export const SCHUTZ_GLOBS = [
  '**/migrations/**', '**/migration/**', '**/auth/**', '**/billing/**', '**/abrechnung/**', '**/payment/**', '**/payments/**',
  '**/auth.*', '**/billing.*', '**/abrechnung.*', '**/payment.*', '.github/workflows/**', '**/.env', '**/.env.*',
];
type Env = Record<string, string | undefined>;
export const schutzAn = (env: Env = process.env) => String(env.WERKBANK_SCHUTZPFADE ?? '').trim().toLowerCase() !== 'aus';
const extra = (env: Env) => { const v = String(env.WERKBANK_SCHUTZPFADE ?? '').trim(); return !v || v.toLowerCase() === 'aus' ? [] : v.split(',').map((s) => s.trim()).filter(Boolean); };

/** Glob → RegExp: `**` über Ordner (auch null), `*` innerhalb eines Namens. Groß-/Kleinschreibung egal. */
export function globRegex(g: string): RegExp {
  let r = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { i++; if (g[i + 1] === '/') { i++; r += '(?:.*/)?'; } else r += '.*'; }
    else if (c === '*') r += '[^/]*';
    else r += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${r}$`, 'i');
}

/** git-Argumente für „geänderte Dateinamen base..head“. IMMER hierüber (Schutzpfad-Prüfungen): ohne `--no-renames` listet git bei einer
 *  Umbenennung nur den neuen Pfad, der geschützte Quellpfad (z. B. db/migrations/001.sql → archive/001.sql) bliebe unsichtbar. */
export const geaenderteDateienArgs = (base: string, head: string): string[] =>
  ['-c', 'core.quotepath=false', 'diff', '--name-only', '--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', base, head];

/** Welche der Dateien (Pfade relativ zum Repo) liegen in einem Schutzpfad? */
export function schutzTreffer(dateien: string[], env: Env = process.env): string[] {
  if (!schutzAn(env)) return [];
  const re = [...SCHUTZ_GLOBS, ...extra(env)].map(globRegex);
  return dateien.map((d) => d.replace(/^\.\//, '')).filter((d) => re.some((x) => x.test(d)));
}

// ---------- Opus-Endprüfung: anfordern, sammeln, Urteil ----------

export const endpruefungen = () => wb().collection('endpruefungen');
export interface Endpruefung { _id: string; strand: string; titel: string; key: string; head: string; treffer: string[]; status: 'offen' | 'ok' | 'maengel'; angefordertAt: Date; buendel?: string | null; urteilAt?: Date; urteilBy?: string; text?: string }

/** Pflicht anmelden (je Strang+Kopf genau einmal); liefert den Eintrag. */
export async function endpruefungAnfordern(a: { strand: string; titel: string; key: string; head: string; treffer: string[] }): Promise<Endpruefung> {
  const da = await endpruefungen().findOne({ strand: a.strand, head: a.head }) as unknown as Endpruefung | null;
  if (da) return da;
  const doc: Endpruefung = { _id: `e-${randomUUID().slice(0, 8)}`, ...a, treffer: a.treffer.slice(0, 50), status: 'offen', angefordertAt: new Date() };
  await endpruefungen().insertOne(doc as any);
  return doc;
}

export const endpruefungGruen = async (strand: string, head: string) => !!(await endpruefungen().findOne({ strand, head, status: 'ok' }));

/** Push-Welle: alle offenen Endprüfungen auf einmal (ein Opus-Lauf über alle), nicht je PR einzeln. Markiert sie mit der Bündel-Kennung. */
export async function endpruefungSammeln(): Promise<{ buendel: string; anzahl: number; ids: string[]; auftrag: string } | null> {
  const offen = await endpruefungen().find({ status: 'offen' }).sort({ angefordertAt: 1 }).limit(50).toArray() as unknown as Endpruefung[];
  if (!offen.length) return null;
  const buendel = `b-${randomUUID().slice(0, 8)}`;
  await endpruefungen().updateMany({ _id: { $in: offen.map((o) => o._id) } as any }, { $set: { buendel } });
  const auftrag = [
    `Opus-Endprüfung vor der Push-Welle (${offen.length} Strang/Stränge, ein Lauf). Prüfe je Eintrag den Diff Basis..Kopf auf die berührten Schutzpfade (Migrationen: umkehrbar, ohne Datenverlust; Anmeldung/Abrechnung/Zahlung: keine Rechte- oder Betragsfehler; Workflows/.env: keine Geheimnisse, keine erweiterten Rechte). Urteil je Eintrag: ok oder maengel (mit Datei:Zeile).`,
    ...offen.map((o) => `\n### ${o._id} — ${o.titel}\nRepo ${o.key}, Kopf ${o.head}\nBerührte Schutzpfade:\n${o.treffer.map((t) => `- ${t}`).join('\n')}`),
  ].join('\n');
  return { buendel, anzahl: offen.length, ids: offen.map((o) => o._id), auftrag };
}

export async function endpruefungUrteil(id: string, urteil: 'ok' | 'maengel', by: string, text = ''): Promise<boolean> {
  const r = await endpruefungen().updateOne({ _id: id as any, status: 'offen' }, { $set: { status: urteil, urteilAt: new Date(), urteilBy: by, text: text.slice(0, 4000) } });
  return r.modifiedCount === 1;
}

// ---------- Gemeinsame Prüfung für ALLE Freigabe-/Push-Wege ----------

export interface SchutzGate { ok: boolean; treffer: string[]; grund?: string; endpruefung?: string }
/**
 * Eine Funktion für jeden Weg, der etwas freigibt oder pusht (freigabe.ts freigeben = Freigabe-Seite UND Inbox-„Ja“,
 * prfix.ts freigabeSetzen + beide Push-Stellen): berührt der Diff einen Schutzpfad, geht es nur mit grünem Opus-Urteil für
 * genau diesen Kopf UND ausdrücklichem Go (schutzGo). Sonst ok:false mit Grund; die Endprüfung wird dabei angemeldet.
 */
export async function schutzpfadGate(a: { strand: string; titel: string; key: string; head: string; dateien: string[]; schutzGo?: boolean }, env: Env = process.env): Promise<SchutzGate> {
  const treffer = schutzTreffer(a.dateien, env);
  if (!treffer.length) return { ok: true, treffer };
  const ep = await endpruefungAnfordern({ strand: a.strand, titel: a.titel, key: a.key, head: a.head, treffer });
  const liste = `${treffer.slice(0, 5).join(', ')}${treffer.length > 5 ? ` (+${treffer.length - 5})` : ''}`;
  if (!(await endpruefungGruen(a.strand, a.head))) return { ok: false, treffer, endpruefung: ep._id, grund: `Schutzpfade berührt (${liste}) — erst die Opus-Endprüfung (${ep._id}, wird mit den anderen vor der Push-Welle gesammelt), dann dein Go.` };
  if (a.schutzGo !== true) return { ok: false, treffer, endpruefung: ep._id, grund: `Schutzpfade berührt (${liste}) — die Opus-Endprüfung ist grün; jetzt brauche ich dein ausdrückliches Go für genau diese Dateien (schutzGo).` };
  return { ok: true, treffer, endpruefung: ep._id };
}
