// Chief of Staff, Schnitt S1.1 (docs/plan-chief-of-staff.md): Zusagen-Register und Themen-Register als Vault-Dateien.
// Reine Funktionen (Parser, Zeilen-Schnitte, Personen/Seite) + die Schreib-Pipeline (Warteschlange je Datei, Vorschau → confirm,
// Hash-Prüfung, Vault-Sync-Sperre). Auflagen: K2 (Sperre + Hash direkt vor dem Schreiben), K3 (nur gezielte Zeilen-Änderungen,
// Datei wird nie aus dem Parse neu erzeugt), K11/K12 (Personen, „Wer: offen“), K18 (Kennung in der Warteschlange).
//
// Zeilenformat (Vault-Regel: keine breiten Tabellen):
//   - **Z-007** · Christoph Bitzner → Knut · Belieferungsstatus in den Report · bis 2026-10-23 · Thema: Cockpit · Quelle: [[notiz]]
//   - **Flex** · Stand: … · Nächster Schritt: … · Ball bei: Knut · geändert 2026-10-16
// Abschnitt = Status (`## Offen`, `## Erledigt`, `## Verworfen`). Fremde Zeilen bleiben, wie sie sind.

import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { parseFrontmatter } from './vault.ts';
import { writeAtomic, syncLocked } from './roadmapauto.ts';

export const hashText = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

export class CosError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }

export const cosDir = () => {
  const d = (process.env.COS_DIR || 'olaf/1-Projects/chief-of-staff').replace(/^\/+|\/+$/g, '');
  if (!d || d.split('/').some((s) => s === '..' || s === '.' || !s)) throw new CosError(500, 'COS_DIR ungültig.');
  return d;
};
export const FILES = { zusagen: 'zusagen-register.md', themen: 'themen-register.md' } as const;
export type Kind = keyof typeof FILES;
export const registerRel = (k: Kind) => `${cosDir()}/${FILES[k]}`;

/** Datum in Wiener Zeit als JJJJ-MM-TT. */
export const wienDatum = (d: Date = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(d);

// ---------- Zeilen ----------

const SEP = ' · ';
/** Nutzertext in ein Zeilenfeld: eine Zeile, kein Trennzeichen. */
export const feld = (s: unknown) => String(s ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s*·\s*/g, ' – ').replace(/\s+/g, ' ').trim();
const nl = (text: string) => (text.includes('\r\n') ? '\r\n' : '\n');
/** Zeilen mit Zeilenende; letzte Zeile ohne Ende bleibt erkennbar (Rundlauf byteweise gleich). */
const zeilen = (text: string): string[] => text.split(/(?<=\n)/);
const ohneEnde = (z: string) => z.replace(/\r?\n$/, '');
const endeVon = (z: string) => z.slice(ohneEnde(z).length);

export type Abschnitt = 'offen' | 'erledigt' | 'verworfen';
const abschnittVon = (h: string): Abschnitt | 'personen' | 'termine' | 'andere' => {
  const t = h.toLowerCase().replace(/^#+\s*/, '').trim();
  if (t.startsWith('offen')) return 'offen';
  if (t.startsWith('erledigt')) return 'erledigt';
  if (t.startsWith('verworfen')) return 'verworfen';
  if (t.startsWith('personen')) return 'personen';
  if (t.startsWith('termine')) return 'termine';
  return 'andere';
};

interface Sec { name: ReturnType<typeof abschnittVon>; heading: number; start: number; end: number }   // Zeilenindizes: end exklusiv
function sektionen(ls: string[]): Sec[] {
  const out: Sec[] = [];
  let inCode = false, fm = ls[0] && ohneEnde(ls[0]) === '---';
  for (let i = 0; i < ls.length; i++) {
    const l = ohneEnde(ls[i]);
    if (fm) { if (i > 0 && l === '---') fm = false; continue; }
    if (/^(```|~~~)/.test(l)) inCode = !inCode;
    if (inCode) continue;
    if (/^##\s+\S/.test(l) && !/^###/.test(l)) {
      if (out.length) out[out.length - 1].end = i;
      out.push({ name: abschnittVon(l), heading: i, start: i + 1, end: ls.length });
    }
  }
  return out;
}

// ---------- Zusagen ----------

export interface Zusage {
  id: string; wer: string | null; an: string; was: string; bis: string | null; fristUnklar: boolean;
  thema?: string; quelle?: string; notizen: string[]; erledigtAm?: string; abschnitt: Abschnitt; zeile: number;
}
export interface Unlesbar { zeile: number; text: string; abschnitt: string }
export interface Personen { name: string; seite: 'Knut' | 'Team' | 'Partner'; auch: string[] }
export interface Termin { zeile: number; text: string; datum: string | null; zeit: string | null; titel: string; mit: string[] }
export interface Register { zusagen: Zusage[]; unlesbar: Unlesbar[]; personen: Personen[]; termine: Termin[]; doppelt: string[] }

const ID_RE = /^\*\*(Z-\d+)\*\*$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function zusageZeile(l: string): Omit<Zusage, 'abschnitt' | 'zeile'> | null {
  const m = /^\s*[-*]\s+(.*)$/.exec(l);
  if (!m) return null;
  const p = m[1].split(SEP).map((s) => s.trim());
  const id = ID_RE.exec(p[0] ?? '')?.[1];
  if (!id || p.length < 3) return null;
  const pm = /^(.+?)\s+→\s+(.+)$/.exec(p[1]);
  let wer: string | null, an = 'Knut';
  if (/^Wer: offen$/i.test(p[1])) wer = null;
  else if (pm) { wer = /^Wer: offen$/i.test(pm[1]) ? null : pm[1]; an = pm[2]; }
  else return null;
  const was = p[2];
  if (!was) return null;
  const z: Omit<Zusage, 'abschnitt' | 'zeile'> = { id, wer, an, was, bis: null, fristUnklar: false, notizen: [] };
  for (const f of p.slice(3)) {
    let x: RegExpExecArray | null;
    if ((x = /^bis (\d{4}-\d{2}-\d{2})$/.exec(f))) z.bis = x[1];
    else if (/^Frist unklar$/i.test(f)) z.fristUnklar = true;
    else if ((x = /^Thema: (.+)$/.exec(f))) z.thema = x[1];
    else if ((x = /^Quelle: (.+)$/.exec(f))) z.quelle = x[1];
    else if ((x = /^Notiz: (.+)$/.exec(f))) z.notizen.push(x[1]);
    else if ((x = /^(?:erledigt|verworfen) (\d{4}-\d{2}-\d{2})$/.exec(f))) z.erledigtAm = x[1];
  }
  return z;
}

export function parseRegister(text: string): Register {
  const ls = zeilen(text);
  const r: Register = { zusagen: [], unlesbar: [], personen: [], termine: [], doppelt: [] };
  const seen = new Map<string, number>();
  for (const s of sektionen(ls)) {
    for (let i = s.start; i < s.end; i++) {
      const l = ohneEnde(ls[i]);
      if (!/^\s*[-*]\s+\S/.test(l)) continue;
      if (s.name === 'offen' || s.name === 'erledigt' || s.name === 'verworfen') {
        const z = zusageZeile(l);
        if (!z) { r.unlesbar.push({ zeile: i + 1, text: l.trim(), abschnitt: s.name }); continue; }
        seen.set(z.id, (seen.get(z.id) ?? 0) + 1);
        r.zusagen.push({ ...z, abschnitt: s.name, zeile: i + 1 });
      } else if (s.name === 'personen') {
        const p = l.replace(/^\s*[-*]\s+/, '').split(SEP).map((x) => x.trim());
        const seite = /^knut$/i.test(p[1] ?? '') ? 'Knut' : /^team$/i.test(p[1] ?? '') ? 'Team' : /^partner$/i.test(p[1] ?? '') ? 'Partner' : null;
        if (!p[0] || !seite) { r.unlesbar.push({ zeile: i + 1, text: l.trim(), abschnitt: 'personen' }); continue; }
        const auch = p.slice(2).map((x) => /^auch:\s*(.*)$/i.exec(x)?.[1]).filter((x): x is string => x != null).flatMap((x) => x.split(',')).map((x) => x.trim()).filter(Boolean);
        r.personen.push({ name: p[0], seite, auch });
      } else if (s.name === 'termine') {
        r.termine.push(parseTermin(l, i + 1));
      }
    }
  }
  r.doppelt = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  return r;
}

/** `- Termin Fr 23.10. 10:00 Rogue: Vertrag · mit: Christoph, Knut` oder `- 2026-10-23 10:00 Titel · mit: …` */
export function parseTermin(l: string, zeile: number): Termin {
  const body = l.replace(/^\s*[-*]\s+/, '').trim();
  const p = body.split(SEP).map((x) => x.trim());
  const mit = p.slice(1).map((x) => /^mit:\s*(.*)$/i.exec(x)?.[1]).filter((x): x is string => x != null).flatMap((x) => x.split(',')).map((x) => x.trim()).filter(Boolean);
  let rest = p[0].replace(/^Termin\s+/i, '');
  let datum: string | null = null, zeit: string | null = null;
  let m = /^(\d{4}-\d{2}-\d{2})\s*/.exec(rest);
  if (m) { datum = m[1]; rest = rest.slice(m[0].length); }
  else if ((m = /^(?:(?:Mo|Di|Mi|Do|Fr|Sa|So)\.?\s+)?(\d{1,2})\.(\d{1,2})\.(?:(\d{4}))?\s*/i.exec(rest))) {
    const j = m[3] ?? String(new Date().getFullYear());
    datum = `${j}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; rest = rest.slice(m[0].length);
  }
  const t = /^(\d{1,2}):(\d{2})\s*/.exec(rest);
  if (t) { zeit = `${t[1].padStart(2, '0')}:${t[2]}`; rest = rest.slice(t[0].length); }
  return { zeile, text: body, datum, zeit, titel: rest.trim(), mit };
}

// ---------- Personen und Seite (K11, K12) ----------

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
export const KNUT_NAMEN = ['knut', 'knut peters', 'knut p', 'knut p97'];

export function seiteVon(name: string | null | undefined, personen: Personen[], team: Set<string>): 'Knut' | 'Team' | 'Partner' | 'Seite?' | 'offen' {
  if (!name || !feld(name) || /^offen$/i.test(name)) return 'offen';
  const n = norm(name);
  for (const p of personen) if ([p.name, ...p.auch].some((a) => norm(a) === n)) return p.seite;
  if (KNUT_NAMEN.includes(n)) return 'Knut';
  if (team.has(n)) return 'Team';
  // „Michael N.“ ≙ „Michael Nachname“: Vorname + Initial gegen volle Namen
  const m = /^(\S+) (\w)$/.exec(n);
  if (m) {
    const hits = personen.filter((p) => [p.name, ...p.auch].some((a) => { const x = norm(a); return x.startsWith(m[1] + ' ') && x.split(' ')[1]?.startsWith(m[2]); }));
    if (hits.length === 1) return hits[0].seite;
    const t = [...team].filter((x) => x.startsWith(m[1] + ' ') && x.split(' ')[1]?.startsWith(m[2]));
    if (t.length === 1) return 'Team';
  }
  return 'Seite?';
}

/** Namen und Aliasse aus `Intern/2-Areas/People/*.md` (nur Dateien, nicht Unterordner). */
export function teamNamen(vaultDir: string): { name: string; aliase: string[] }[] {
  const dir = join(vaultDir, 'Intern', '2-Areas', 'People');
  if (!existsSync(dir)) return [];
  const out: { name: string; aliase: string[] }[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    let fm: Record<string, unknown> = {};
    try { fm = parseFrontmatter(readFileSync(join(dir, e.name), 'utf8')).fm; } catch { /* Datei weg */ }
    const name = String(fm.title ?? e.name.replace(/\.md$/, ''));
    const al = Array.isArray(fm.aliases) ? fm.aliases.map(String) : [];
    out.push({ name, aliase: al });
  }
  return out;
}
export function teamSet(namen: { name: string; aliase: string[] }[]): Set<string> {
  return new Set(namen.flatMap((n) => [n.name, ...n.aliase]).map(norm));
}

// ---------- Neue Datei ----------

function kopf(kind: Kind, heute: string): string {
  const titel = kind === 'zusagen' ? 'Zusagen-Register' : 'Themen-Register';
  const fm = `---\ntitle: "${titel}"\ntype: reference\nteam: olaf\narea: operations\nstatus: current\ncreated: ${heute}\nlast-verified: ${heute}\ntags: [chief-of-staff, register]\nsources: ["Werkbank: docs/plan-chief-of-staff.md"]\n---\n\n# ${titel}\n\n`;
  if (kind === 'themen') return fm + 'Eine Zeile je Thema: Stand · Nächster Schritt · Ball bei · geändert. Die Werkbank liest und schreibt diese Datei nach Knuts Ja; von Hand bearbeiten ist erlaubt.\n\n## Themen\n';
  return fm + 'Wer schuldet wem was. Eine Zeile je Zusage: Kennung · Wer → An · Was · bis Datum · Thema · Quelle. Der Status ergibt sich aus dem Abschnitt. Die Werkbank schreibt nur nach Knuts Ja; von Hand bearbeiten ist erlaubt.\n\n## Offen\n\n## Erledigt\n\n## Verworfen\n\n## Termine\n\n## Personen\n';
}

/** Leere Datei mit Kopf; Personen vorbefüllt (K11), Themen vorbefüllt aus Jira-Workstreams/Strängen (K9). */
export type ThemaVor = string | { name: string; stand?: string; naechster?: string; ball?: string };
export function neueDatei(kind: Kind, heute: string, vor: { personen?: { name: string; aliase: string[] }[]; themen?: ThemaVor[] } = {}): string {
  let t = kopf(kind, heute);
  if (kind === 'zusagen') {
    t = t.replace(/\n$/, '\n') + `- Knut · Knut · auch: ${KNUT_NAMEN.filter((x) => x !== 'knut').map((x) => x.replace(/\b\w/g, (c) => c.toUpperCase())).join(', ')}\n`;
    for (const p of vor.personen ?? []) {
      if (norm(p.name) === 'knut') continue;
      t += `- ${feld(p.name)} · Team${p.aliase.length ? SEP + 'auch: ' + p.aliase.map(feld).join(', ') : ''}\n`;
    }
  } else {
    const th = new Map<string, Exclude<ThemaVor, string>>();
    for (const x of vor.themen ?? []) { const o = typeof x === 'string' ? { name: x } : x; if (!th.has(norm(o.name))) th.set(norm(o.name), o); }
    // Strings (alte Vorbefüllung) alphabetisch; Vorschläge aus dem Stand behalten ihre Reihenfolge (Überfälliges zuerst).
    const liste = (vor.themen ?? []).every((x) => typeof x === 'string') ? [...th.values()].sort((a, b) => a.name.localeCompare(b.name)) : [...th.values()];
    for (const o of liste) t += `- **${feld(o.name)}**${SEP}Stand: ${feld(o.stand) || '–'}${SEP}Nächster Schritt: ${feld(o.naechster) || '–'}${SEP}Ball bei: ${feld(o.ball) || '–'}${SEP}geändert ${heute}\n`;
  }
  return t;
}

// ---------- Zeilen-Schnitte (K3) ----------

/** Ende des Abschnitts: Index, hinter dem eine neue Zeile eingefügt wird (nach der letzten nicht-leeren Zeile). */
function einfuegeIndex(ls: string[], s: Sec): number {
  let i = s.end;
  while (i > s.start && ohneEnde(ls[i - 1]).trim() === '') i--;
  return i;
}

function fuegeEin(text: string, name: ReturnType<typeof abschnittVon>, heading: string, zeile: string): string {
  const e = nl(text);
  let ls = zeilen(text);
  let s = sektionen(ls).find((x) => x.name === name);
  if (!s) {   // Abschnitt fehlt (von Hand gelöscht): am Dateiende neu anlegen
    if (ls.length && !/\n$/.test(ls[ls.length - 1])) ls[ls.length - 1] += e;
    ls.push(e, `## ${heading}${e}`, e);
    s = sektionen(ls).find((x) => x.name === name)!;
  }
  const at = einfuegeIndex(ls, s);
  if (at > 0 && !/\n$/.test(ls[at - 1])) ls[at - 1] += e;
  if (at === s.start) {   // leerer Abschnitt: Leerzeile nach der Überschrift, Eintrag, Leerzeile vor der nächsten
    const danach = ls[at] != null && ohneEnde(ls[at]).trim() !== '';
    ls.splice(at, 0, e, zeile + e, ...(danach ? [e] : []));
  } else ls.splice(at, 0, zeile + e);
  return ls.join('');
}

/** Teile einer Zeile ändern: `key` (Präfix) ersetzen oder anhängen. */
const NIE = /(?!)/;   // trifft nie: Teil wird angehängt
function setzeTeil(zeile: string, pruefe: RegExp, neu: string | null, ab = 1): string {
  const e = endeVon(zeile), body = ohneEnde(zeile);
  const p = body.split(SEP);
  const i = p.findIndex((x, k) => k >= ab && pruefe.test(x.trim()));
  if (neu == null) { if (i > 0) p.splice(i, 1); }
  else if (i > 0) p[i] = neu;
  else p.push(neu);
  return p.join(SEP) + e;
}

export interface Op {
  art: 'neu' | 'aendern' | 'thema';
}
export interface ZNeu { art: 'neu'; wer?: string | null; an?: string; was: string; bis?: string | null; fristUnklar?: boolean; thema?: string; quelle?: string; notiz?: string }
export interface ZAendern { art: 'aendern'; id: string; status?: Abschnitt; bis?: string | null; notiz?: string; was?: string }
export interface ThemaOp { art: 'thema'; name: string; stand?: string; naechster?: string; ball?: string }
export type ZOp = ZNeu | ZAendern;

export function naechsteId(text: string): string {
  let max = 0;
  for (const m of text.matchAll(/\*\*Z-(\d+)\*\*/g)) max = Math.max(max, Number(m[1]));
  return 'Z-' + String(max + 1).padStart(3, '0');
}

function pruefeDatum(d: string | null | undefined) { if (d != null && d !== '' && !ISO.test(d)) throw new CosError(400, 'Datum als JJJJ-MM-TT.'); }

export function zusageNeuZeile(id: string, o: ZNeu): string {
  const was = feld(o.was);
  if (!was) throw new CosError(400, 'Was fehlt.');
  pruefeDatum(o.bis);
  const name = (x: unknown) => feld(x).replace(/\s*→\s*/g, ' – ');   // „→“ trennt Wer und An
  const wer = name(o.wer);
  const party = `${wer ? wer : 'Wer: offen'} → ${name(o.an) || 'Knut'}`;
  const teile = [`- **${id}**`, party, was];
  if (o.bis) teile.push(`bis ${o.bis}`); else if (o.fristUnklar) teile.push('Frist unklar');
  if (o.thema) teile.push(`Thema: ${feld(o.thema)}`);
  if (o.quelle) teile.push(`Quelle: ${feld(o.quelle)}`);
  if (o.notiz) teile.push(`Notiz: ${feld(o.notiz)}`);
  return teile.join(SEP);
}

/** Wendet Zusage-Ops auf den Text an. Kennung wird hier vergeben (confirm). */
export function wendeZusagenAn(text: string, ops: ZOp[], heute: string): { text: string; zeilen: { vorher: string | null; nachher: string }[]; ids: string[] } {
  let t = text;
  const out: { vorher: string | null; nachher: string }[] = [];
  const ids: string[] = [];
  for (const o of ops) {
    if (o.art === 'neu') {
      const id = naechsteId(t);
      const z = zusageNeuZeile(id, o);
      t = fuegeEin(t, 'offen', 'Offen', z);
      out.push({ vorher: null, nachher: z }); ids.push(id);
    } else {
      const r = parseRegister(t);
      const treffer = r.zusagen.filter((z) => z.id === o.id);
      if (!treffer.length) throw new CosError(404, `Zusage ${o.id} nicht gefunden.`);
      if (treffer.length > 1) throw new CosError(409, `Kennung ${o.id} steht mehrfach im Register — bitte von Hand bereinigen.`);
      const z = treffer[0];
      let ls = zeilen(t);
      const alt = ohneEnde(ls[z.zeile - 1]);
      let zeile = ls[z.zeile - 1];
      if (o.was != null && !feld(o.was)) throw new CosError(400, 'Was fehlt.');
      if (o.was != null) { const p = ohneEnde(zeile).split(SEP); p[2] = feld(o.was); zeile = p.join(SEP) + endeVon(zeile); }
      if (o.bis !== undefined) {
        pruefeDatum(o.bis);
        zeile = setzeTeil(zeile, /^(bis \d{4}-\d{2}-\d{2}|Frist unklar)$/i, o.bis ? `bis ${o.bis}` : 'Frist unklar', 3);
      }
      if (o.notiz) zeile = setzeTeil(zeile, NIE, `Notiz: ${feld(o.notiz)}`, 3);
      let ziel: Abschnitt | null = null;
      if (o.status && o.status !== z.abschnitt) {
        ziel = o.status;
        zeile = setzeTeil(zeile, /^(erledigt|verworfen) \d{4}-\d{2}-\d{2}$/, o.status === 'offen' ? null : `${o.status} ${heute}`, 3);
      }
      if (ziel) {
        ls.splice(z.zeile - 1, 1);
        t = ls.join('');
        t = fuegeEin(t, ziel, ziel[0].toUpperCase() + ziel.slice(1), ohneEnde(zeile));
      } else {
        ls[z.zeile - 1] = zeile;
        t = ls.join('');
      }
      out.push({ vorher: alt, nachher: ohneEnde(zeile) }); ids.push(o.id);
    }
  }
  return { text: t, zeilen: out, ids };
}

// ---------- Themen ----------

export interface ThemaZeile { name: string; stand: string; naechster: string; ball: string; geaendert: string | null; zeile: number }
export function parseThemen(text: string): { themen: ThemaZeile[]; unlesbar: Unlesbar[] } {
  const ls = zeilen(text);
  const themen: ThemaZeile[] = [], unlesbar: Unlesbar[] = [];
  const secs = sektionen(ls);
  for (const s of secs) {
    if (s.name !== 'andere') continue;
    for (let i = s.start; i < s.end; i++) {
      const l = ohneEnde(ls[i]);
      if (!/^\s*[-*]\s+\S/.test(l)) continue;
      const p = l.replace(/^\s*[-*]\s+/, '').split(SEP).map((x) => x.trim());
      const m = /^\*\*(.+)\*\*$/.exec(p[0]);
      if (!m) { unlesbar.push({ zeile: i + 1, text: l.trim(), abschnitt: 'themen' }); continue; }
      const get = (re: RegExp) => p.map((x) => re.exec(x)?.[1]).find((x) => x != null) ?? '';
      themen.push({ name: m[1], stand: get(/^Stand:\s*(.*)$/), naechster: get(/^Nächster Schritt:\s*(.*)$/), ball: get(/^Ball bei:\s*(.*)$/), geaendert: get(/^geändert (\d{4}-\d{2}-\d{2})$/) || null, zeile: i + 1 });
    }
  }
  return { themen, unlesbar };
}

export function wendeThemaAn(text: string, o: ThemaOp, heute: string): { text: string; zeilen: { vorher: string | null; nachher: string }[] } {
  const name = feld(o.name);
  if (!name) throw new CosError(400, 'Thema fehlt.');
  const { themen } = parseThemen(text);
  const vorhanden = themen.filter((t) => norm(t.name) === norm(name));
  if (vorhanden.length > 1) throw new CosError(409, `Thema „${name}“ steht mehrfach im Register.`);
  const set = (z: string) => {
    if (o.stand != null) z = setzeTeil(z, /^Stand:/, `Stand: ${feld(o.stand)}`);
    if (o.naechster != null) z = setzeTeil(z, /^Nächster Schritt:/, `Nächster Schritt: ${feld(o.naechster)}`);
    if (o.ball != null) z = setzeTeil(z, /^Ball bei:/, `Ball bei: ${feld(o.ball)}`);
    return setzeTeil(z, /^geändert \d{4}-\d{2}-\d{2}$/, `geändert ${heute}`);
  };
  if (vorhanden.length) {
    const ls = zeilen(text);
    const alt = ohneEnde(ls[vorhanden[0].zeile - 1]);
    ls[vorhanden[0].zeile - 1] = set(ls[vorhanden[0].zeile - 1]);
    return { text: ls.join(''), zeilen: [{ vorher: alt, nachher: ohneEnde(ls[vorhanden[0].zeile - 1]) }] };
  }
  const neu = ohneEnde(set(`- **${name}**${SEP}Stand: –${SEP}Nächster Schritt: –${SEP}Ball bei: –${SEP}geändert ${heute}`));
  return { text: fuegeEin(text, 'andere', 'Themen', neu), zeilen: [{ vorher: null, nachher: neu }] };
}

// ---------- Schreib-Pipeline (K2, K18) ----------

const queues = new Map<string, Promise<unknown>>();
/** Schreib-Aufträge je Datei nacheinander. */
function inReihe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(fn);
  queues.set(key, next.catch(() => undefined));
  return next;
}

export interface SchreibOpts {
  vaultDir: string; dry?: boolean; confirm?: boolean; hash?: string; heute?: string;
  vorbefuellung?: () => { personen?: { name: string; aliase: string[] }[]; themen?: ThemaVor[] };
  /** Sperre des Vault-Syncs (Tests ersetzen sie). */
  locked?: () => boolean;
  /** Nach erfolgreichem Schreiben (Index verwerfen). */
  danach?: () => void;
}
export type SchreibErgebnis =
  | { needsConfirm: true; preview: { datei: string; neu: boolean; zeilen: { vorher: string | null; nachher: string }[] }; hash: string }
  | { ok: true; dry?: boolean; datei: string; zeilen: { vorher: string | null; nachher: string }[]; ids: string[]; hash: string };

/** Gemeinsame Pipeline: Vorschau ohne confirm, mit confirm Sperre prüfen → anwenden → Hash direkt vor dem Schreiben erneut prüfen. */
export function schreibe(kind: Kind, apply: (text: string, heute: string) => { text: string; zeilen: { vorher: string | null; nachher: string }[]; ids?: string[] }, o: SchreibOpts): Promise<SchreibErgebnis> {
  const rel = registerRel(kind);
  const abs = join(o.vaultDir, rel);
  return inReihe(abs, async () => {
    const heute = o.heute ?? wienDatum();
    const lies = () => { try { return readFileSync(abs, 'utf8'); } catch (e: any) { if (e?.code === 'ENOENT') return null; throw e; } };
    const alt = lies();
    const neuAngelegt = alt == null;
    const basis = alt ?? neueDatei(kind, heute, o.vorbefuellung?.() ?? {});
    const hashAlt = hashText(alt ?? '');
    if (!o.confirm) {
      // Vorschau: Kennung provisorisch, nichts wird geschrieben.
      const r = apply(basis, heute);
      return { needsConfirm: true as const, preview: { datei: rel, neu: neuAngelegt, zeilen: r.zeilen }, hash: hashAlt };
    }
    if ((o.locked ?? (() => syncLocked()))()) throw new CosError(409, 'Vault-Sync läuft gerade — bitte gleich noch einmal bestätigen.');
    if (o.hash != null && o.hash !== hashAlt) throw new CosError(409, 'Das Register wurde inzwischen geändert — bitte die Vorschau neu laden.');
    const r = apply(basis, heute);
    if (o.dry) return { ok: true as const, dry: true, datei: rel, zeilen: r.zeilen, ids: r.ids ?? [], hash: hashAlt };
    // K2: unmittelbar vor dem Schreiben noch einmal gegen die Platte prüfen.
    if (hashText(lies() ?? '') !== hashAlt) throw new CosError(409, 'Das Register wurde inzwischen geändert — bitte die Vorschau neu laden.');
    mkdirSync(dirname(abs), { recursive: true });
    writeAtomic(abs, r.text);
    try { o.danach?.(); } catch { /* Index wird beim nächsten Takt neu gebaut; geschrieben ist geschrieben */ }
    return { ok: true as const, datei: rel, zeilen: r.zeilen, ids: r.ids ?? [], hash: hashText(r.text) };
  });
}

export const schreibeZusagen = (ops: ZOp[], o: SchreibOpts) => schreibe('zusagen', (t, h) => wendeZusagenAn(t, ops, h), o);
export const schreibeThema = (op: ThemaOp, o: SchreibOpts) => schreibe('themen', (t, h) => wendeThemaAn(t, op, h), o);

/** Lesen: beide Register (fehlende Datei = leer). */
export function liesRegister(vaultDir: string) {
  const z = join(vaultDir, registerRel('zusagen')), t = join(vaultDir, registerRel('themen'));
  const zt = existsSync(z) ? readFileSync(z, 'utf8') : null, tt = existsSync(t) ? readFileSync(t, 'utf8') : null;
  const reg = parseRegister(zt ?? '');
  const th = parseThemen(tt ?? '');
  return { vorhanden: { zusagen: zt != null, themen: tt != null }, ...reg, themen: th.themen, themenUnlesbar: th.unlesbar, hash: { zusagen: hashText(zt ?? ''), themen: hashText(tt ?? '') } };
}
