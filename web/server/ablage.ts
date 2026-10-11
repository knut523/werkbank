// Eine Ablage (Plan 81, Schnitte 1 und 2; Knut, 07.10.2026: „dieselbe Ablage wie ~/work/dokumente“).
//
// Die Datei selbst liegt in `WERKBANK_DOCS_DIR/<team>/<vorgang>/JJJJ-MM-TT_<art>_<slug>[_<version>].<ext>`, mit dem
// Dokumentdatum (nicht dem Upload-Tag). Mongo `files` hält weiter Besitzer, Freigaben, Personendaten-Markierung und
// Tickets, dazu `path` (relativ zur Ablage). Was sich nicht eindeutig zuordnen lässt, liegt in `_eingang/` und steht
// in „Noch einzusortieren“, bis jemand den Vorschlag bestätigt.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { cfg } from './config.ts';

export const ARTEN = ['sow', 'avv', 'vertrag', 'angebot', 'rechnung', 'deck', 'daten', 'notiz'] as const;
export type Art = (typeof ARTEN)[number];
export const EINGANG = '_eingang';
export const UNDATIERT = 'undatiert';

export interface Vorschlag { team: string; vorgang: string; art: Art; datum: string; slug: string; version: string; sicher: boolean }

const within = (p: string, dir: string) => p === dir || p.startsWith(dir.endsWith(sep) ? dir : dir + sep);
export const docsDir = () => resolve(cfg.docsDir);

/** „Rahmenvertrag Enlion (v2).pdf“ → „rahmenvertrag-enlion“ — ASCII, klein, Bindestriche. */
export function slugify(s: string, max = 60): string {
  return s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');
}

/** Dokumentdatum aus dem Dateinamen: 2026-10-01, 20261001, 01.10.2026. Sonst null. */
export function datumAusName(name: string): { datum: string; rest: string } | null {
  const ok = (y: number, m: number, d: number) => y >= 1990 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
  const pad = (n: number) => String(n).padStart(2, '0');
  const pats: Array<[RegExp, (m: RegExpMatchArray) => [number, number, number]]> = [
    [/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/, (m) => [+m[1], +m[2], +m[3]]],
    [/(?<!\d)(\d{2})\.(\d{2})\.(\d{4})(?!\d)/, (m) => [+m[3], +m[2], +m[1]]],
    [/(?<!\d)(\d{4})(\d{2})(\d{2})(?!\d)/, (m) => [+m[1], +m[2], +m[3]]],
  ];
  for (const [re, f] of pats) {
    const m = name.match(re);
    if (!m) continue;
    const [y, mo, d] = f(m);
    if (ok(y, mo, d)) return { datum: `${y}-${pad(mo)}-${pad(d)}`, rest: name.replace(m[0], ' ') };
  }
  return null;
}

const ART_WORTE: Array<[Art, RegExp]> = [
  ['sow', /\b(sow|statement[- ]of[- ]work|leistungsbeschreibung)\b/],
  ['avv', /\b(avv|auftragsverarbeitung\w*|dpa)\b/],
  ['rechnung', /\b(rechnung|invoice|re[- ]?nr)\b/],
  ['angebot', /\b(angebot|offer|quote|kostenvoranschlag)\b/],
  ['vertrag', /(vertrag|contract|vereinbarung|nda)/],
  ['deck', /\b(deck|praesentation|präsentation|pitch|folien|slides)\b/],
];

/** Art aus Schlüsselwörtern im Namen, sonst aus der Endung. */
export function artAus(name: string): Art {
  const n = name.toLowerCase().replace(/[_.]+/g, ' ');
  for (const [art, re] of ART_WORTE) if (re.test(n)) return art;
  const ext = extname(name).toLowerCase();
  if (['.pptx', '.key', '.odp'].includes(ext)) return 'deck';
  if (['.csv', '.tsv', '.xlsx', '.xls', '.ods', '.json'].includes(ext)) return 'daten';
  return 'notiz';
}

/** Vorhandene Vorgangsordner `<team>/<vorgang>` der Ablage (ohne `_eingang`, ohne versteckte). */
export function folders(root = docsDir()): Array<{ team: string; vorgang: string }> {
  const out: Array<{ team: string; vorgang: string }> = [];
  const dirs = (p: string) => { try { return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name); } catch { return []; } };
  for (const team of dirs(root)) {
    if (team.startsWith('_')) continue;
    for (const vorgang of dirs(join(root, team))) out.push({ team, vorgang });
  }
  return out.sort((a, b) => `${a.team}/${a.vorgang}`.localeCompare(`${b.team}/${b.vorgang}`));
}

/**
 * Vorschlag fürs Ablegen. Rein: alles, was er braucht, kommt herein.
 * `sicher` heißt: Team und Vorgang stehen fest — dann darf ein Agenten-Lauf ohne Klick ablegen (Schnitt 3).
 */
export function suggest(x: { name: string; tickets?: string[]; projectName?: string | null; folders: Array<{ team: string; vorgang: string }>; today: string }): Vorschlag {
  const ext = extname(x.name);
  const stem = basename(x.name, ext);
  const d = datumAusName(stem);
  const art = artAus(x.name);
  // Version am Ende: v2, V3, _v1.2, „final“ zählt nicht.
  const vm = (d?.rest ?? stem).match(/(?:^|[\s_-])v(\d+(?:\.\d+)?)\s*\)?\s*$/i);
  const version = vm ? `v${vm[1]}` : '';
  let rest = (d?.rest ?? stem);
  if (vm) rest = rest.slice(0, vm.index);
  // Art-Wort am Anfang nicht doppelt („2026-10-01_vertrag_vertrag-enlion“) — nur wenn danach noch etwas bleibt.
  const s0 = slugify(rest);
  const slug = (s0.startsWith(art + '-') ? s0.slice(art.length + 1) : s0) || s0 || 'dokument';
  // Vorgang: ein vorhandener Ordner, dessen Name als Wort im Dateinamen oder Projektnamen vorkommt (längster gewinnt).
  const hay = ` ${slugify(stem, 200).replace(/-/g, ' ')} ${slugify(x.projectName ?? '', 200).replace(/-/g, ' ')} `;
  const pmTicket = (x.tickets ?? []).some((t) => /^PM-\d+$/.test(t));
  const hit = x.folders
    .filter((f) => !f.vorgang.startsWith('_') && f.vorgang.length >= 3 && hay.includes(` ${f.vorgang.replace(/-/g, ' ')} `))
    .filter((f) => !pmTicket || f.team === 'olaf')
    .sort((a, b) => b.vorgang.length - a.vorgang.length)[0];
  let team = hit?.team ?? (pmTicket ? 'olaf' : '');
  let vorgang = hit?.vorgang ?? '';
  if (!vorgang && team && x.projectName) vorgang = slugify(x.projectName, 40);
  if (!team) vorgang = '';
  return { team, vorgang, art, datum: d?.datum ?? UNDATIERT, slug, version, sicher: !!(team && vorgang) };
}

/** `JJJJ-MM-TT_<art>_<slug>[_<version>].<ext>` */
export function schemaName(v: Pick<Vorschlag, 'datum' | 'art' | 'slug' | 'version'>, ext: string): string {
  return `${v.datum}_${v.art}_${v.slug}${v.version ? `_${v.version}` : ''}${ext.toLowerCase()}`;
}

/**
 * Schema-Name zerlegen (Gegenstück zu `schemaName`): `2026-10-01_vertrag_rahmenvertrag-enlion_v2.pdf` →
 * Datum, Art, Kurzname, Version. Passt der Name nicht (Art unbekannt, kein Datum), bleibt das jeweilige Feld leer.
 */
export function parseSchemaName(name: string): { datum: string | null; art: Art | null; slug: string; version: string } {
  const stem = basename(name, extname(name));
  const m = stem.match(/^(\d{4}-\d{2}-\d{2}|undatiert)_([a-z]+)_(.+)$/);
  if (!m || !ARTEN.includes(m[2] as Art)) return { datum: null, art: null, slug: stem, version: '' };
  let rest = m[3].replace(/_\d+$/, ''); // freeName-Zähler „_2“
  const vm = rest.match(/_(v\d+(?:\.\d+)?)$/);
  if (vm) rest = rest.slice(0, vm.index);
  return { datum: m[1] === UNDATIERT ? null : m[1], art: m[2] as Art, slug: rest, version: vm?.[1] ?? '' };
}

/** Ort und Schema-Angaben einer abgelegten Datei aus ihrem Pfad: `olaf/flex/pilot/shots/x.png` → Team, Vorgang, Unterordner. */
export function ortAus(path: string) {
  const parts = path.split('/');
  const inVorgang = parts.length >= 3;
  return { team: parts.length >= 2 ? parts[0] : '', vorgang: inVorgang ? parts[1] : '', sub: inVorgang ? parts.slice(2, -1).join('/') : '', ...parseSchemaName(parts[parts.length - 1]) };
}

/** Angaben fürs „Verschieben“ einer abgelegten Datei ohne gespeicherte Wahl — aus Pfad und Namen, ohne Mongo. */
export function vorschlagAusPfad(path: string): Vorschlag | null {
  const o = ortAus(path);
  if (!o.team || !o.vorgang || o.team.startsWith('_')) return null;
  const name = path.split('/').pop()!;
  const slug = slugify(o.art ? o.slug : basename(name, extname(name))) || 'dokument';
  return { team: o.team, vorgang: o.vorgang, art: o.art ?? artAus(name), datum: o.datum ?? UNDATIERT, slug, version: o.version, sicher: true };
}

const TEAM_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const VORGANG_RE = /^[a-z0-9_][a-z0-9_-]{0,59}$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const VERSION_RE = /^(v\d+(\.\d+)?)?$/;

/** Eingaben aus dem Formular prüfen; wirft mit lesbarer Meldung. */
export function checkVorschlag(v: any): Vorschlag {
  const fail = (m: string) => { throw Object.assign(new Error(m), { status: 400 }); };
  const team = String(v?.team ?? '').trim(), vorgang = String(v?.vorgang ?? '').trim(), art = String(v?.art ?? '') as Art;
  const datum = String(v?.datum ?? '').trim(), slug = String(v?.slug ?? '').trim(), version = String(v?.version ?? '').trim();
  if (!TEAM_RE.test(team) || team.startsWith('_')) fail('Team: nur Kleinbuchstaben, Ziffern und Bindestriche (z. B. olaf).');
  if (!VORGANG_RE.test(vorgang) || vorgang === EINGANG) fail('Vorgang: nur Kleinbuchstaben, Ziffern, Binde- und Unterstriche (z. B. enlion).');
  if (!ARTEN.includes(art)) fail(`Art: eine von ${ARTEN.join(', ')}.`);
  if (datum !== UNDATIERT && !(/^\d{4}-\d{2}-\d{2}$/.test(datum) && !Number.isNaN(Date.parse(datum + 'T00:00:00Z')))) fail('Datum: JJJJ-MM-TT oder leer für „undatiert“.');
  if (!SLUG_RE.test(slug)) fail('Kurzname: Kleinbuchstaben, Ziffern und Bindestriche.');
  if (!VERSION_RE.test(version)) fail('Version: leer oder z. B. v2.');
  return { team, vorgang, art, datum, slug, version, sicher: true };
}

/** Freier Name im Zielordner: `x.pdf`, sonst `x_2.pdf`, `x_3.pdf` … — nie überschreiben. */
export function freeName(dir: string, name: string, self?: string): string {
  const ext = extname(name), stem = basename(name, ext);
  for (let i = 1; i < 1000; i++) {
    const n = i === 1 ? name : `${stem}_${i}${ext}`;
    const p = join(dir, n);
    if (self && resolve(p) === resolve(self)) return n;
    if (!existsSync(p)) return n;
  }
  throw new Error('Kein freier Dateiname.');
}

/** Absoluter Pfad zu `rel` in der Ablage — nur, wenn er wirklich darin liegt (auch nach Auflösen von Symlinks). */
export function inDocs(rel: string): string {
  const root = docsDir();
  const abs = resolve(root, rel);
  if (!within(abs, root) || abs === root) throw Object.assign(new Error('Pfad außerhalb der Ablage.'), { status: 400 });
  // Der vorhandene Teil des Pfads darf nicht per Symlink hinausführen.
  let p = abs;
  while (!existsSync(p) && p !== root) p = dirname(p);
  const realRoot = (() => { try { return realpathSync(root); } catch { return root; } })();
  if (existsSync(p) && !within(realpathSync(p), realRoot)) throw Object.assign(new Error('Pfad außerhalb der Ablage.'), { status: 400 });
  return abs;
}

export const sha256File = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');

/**
 * Datei an ihren Platz bringen: `src` (absolut) → `<relDir>/<name>` in der Ablage. Verschieben, über Dateisysteme
 * hinweg als Kopie mit Prüfsumme und erst danach Löschen. Liefert den Pfad relativ zur Ablage.
 */
export function moveInto(src: string, relDir: string, name: string, opts: { copy?: boolean } = {}): string {
  const dir = inDocs(relDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const n = freeName(dir, name, src);
  const dest = inDocs(join(relDir, n));
  if (resolve(dest) !== resolve(src)) {
    if (opts.copy) copyFileSync(src, dest);
    else {
      try { linkSync(src, dest); unlinkSync(src); } catch {
        try { renameSync(src, dest); } catch {
          copyFileSync(src, dest);
          if (sha256File(src) !== sha256File(dest)) { rmSync(dest, { force: true }); throw new Error('Kopie stimmt nicht mit dem Original überein.'); }
          unlinkSync(src);
        }
      }
    }
  }
  return relative(docsDir(), dest).split(sep).join('/');
}

/** Ordner `<team>/<vorgang>` einer abgelegten Datei bzw. `_eingang`. */
export const placeOf = (path?: string | null) => (path ? path.split('/').slice(0, -1).join('/') : '');
export const isEingang = (path?: string | null) => !!path && path.split('/')[0] === EINGANG;

/** Größe/Typ prüfen, ohne Symlinks zu folgen (eine Ablage-Datei ist immer eine echte Datei). */
export const isPlainFile = (abs: string) => { try { return lstatSync(abs).isFile(); } catch { return false; } };
export const statOrNull = (abs: string) => { try { return statSync(abs); } catch { return null; } };
