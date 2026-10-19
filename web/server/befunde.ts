// Befunde mit fester Form (Plan 213, forge-Abgleich 172 §11, Knut 17.10.: „nutzen wir alles, was forge hatte?“):
//   #5  Sorgeklassen mit fester Taxonomie; `blocking` nur für sechs Klassen, Beratendes blockiert nie; Abdeckung je Klasse.
//   #4  BREAK → REFUTE: jeder Kandidat hat einen Widerlegungsschritt mit Vertrauensgrad; nur CONFIRMED/PLAUSIBLE überleben.
//   #9  Felder statt Prosa (Datei:Zeile, Schwere, Vertrauen, Klasse, Prüfzustand); Gruppierung „Spec vor Standards“.
//   #11 Der Entwurf hat einen Hash; gepostet wird nur genau dieser Entwurf, `incomplete` nie automatisch.
// Der Review-Strang schreibt `befunde.json`; daraus baut der Server `kommentar.md` — der Strang schreibt keine Prosa für GitHub.
// Alles hier ist rein (testbar).
import { createHash } from 'node:crypto';

export const BLOCKIERBAR = ['security', 'data_integrity', 'cross_file', 'idempotency', 'pii', 'access_control'] as const;
export const BERATEND = ['correctness', 'spec', 'tests', 'performance', 'maintainability', 'docs'] as const;
export const KLASSEN: readonly string[] = [...BLOCKIERBAR, ...BERATEND];
export const KLASSE_TEXT: Record<string, string> = {
  security: 'Security', data_integrity: 'Data integrity', cross_file: 'Cross-file breakage', idempotency: 'Idempotency', pii: 'Personal data',
  access_control: 'Access control', correctness: 'Correctness', spec: 'Spec / acceptance', tests: 'Tests', performance: 'Performance',
  maintainability: 'Maintainability', docs: 'Docs',
};
const ZUSTAND = ['CONFIRMED', 'PLAUSIBLE', 'REFUTED'] as const;
const VERTRAUEN = ['hoch', 'mittel', 'niedrig'] as const;

export interface Befund {
  datei: string; zeile: number; klasse: string; schwere: 'blocking' | 'advisory'; vertrauen: 'hoch' | 'mittel' | 'niedrig';
  pruefung: 'CONFIRMED' | 'PLAUSIBLE'; widerlegung: string; quelle: 'spec' | 'standard'; titel: string; fix: string; gedaechtnis: boolean;
}
export interface Gepruefte {
  befunde: Befund[];
  /** Klasse → geprüft | nicht geprüft | Befund */
  abdeckung: Record<string, 'geprüft' | 'nicht geprüft' | 'Befund'>;
  vollstaendig: boolean; gruende: string[];
  empfehlung: 'approve' | 'request-changes' | 'comment';
  statistik: { kandidaten: number; widerlegt: number; ohneBeleg: number; herabgestuft: number; ungueltig: number; gedaechtnis: number };
  tests: string;
}

const s = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, n) : '');

/** befunde.json (vom Review-Strang) → geprüfte, normierte Befunde. Wirft nur bei völlig unbrauchbarer Eingabe. */
export function pruefeBefunde(roh: unknown): Gepruefte {
  if (!roh || typeof roh !== 'object' || Array.isArray(roh)) throw new Error('befunde.json ist kein Objekt.');
  const j: any = roh;
  const stat = { kandidaten: 0, widerlegt: 0, ohneBeleg: 0, herabgestuft: 0, ungueltig: 0, gedaechtnis: 0 };
  const befunde: Befund[] = [];
  for (const b of Array.isArray(j.befunde) ? j.befunde.slice(0, 100) : []) {
    stat.kandidaten++;
    if (!b || typeof b !== 'object') { stat.ungueltig++; continue; }
    const klasse = s(b.klasse, 40);
    const pruefung = s(b.pruefung, 12).toUpperCase();
    if (!KLASSEN.includes(klasse) || !(ZUSTAND as readonly string[]).includes(pruefung)) { stat.ungueltig++; continue; }
    // #4: ohne Widerlegungsversuch oder widerlegt → fällt raus.
    const widerlegung = s(b.widerlegung, 600);
    if (pruefung === 'REFUTED' || !widerlegung) { stat.widerlegt++; continue; }
    // Grounding: Datei:Zeile ist Pflicht.
    const datei = s(b.datei, 300), zeile = Number(b.zeile);
    if (!datei || !Number.isInteger(zeile) || zeile < 1 || /^[\/~]|(^|\/)\.\.(\/|$)|[`<>|\s]/.test(datei)) { stat.ohneBeleg++; continue; }
    // #5: blockieren dürfen nur die sechs Klassen; beratend blockiert nie.
    let schwere: Befund['schwere'] = b.schwere === 'blocking' ? 'blocking' : 'advisory';
    if (schwere === 'blocking' && !(BLOCKIERBAR as readonly string[]).includes(klasse)) { schwere = 'advisory'; stat.herabgestuft++; }
    const vertrauen = (VERTRAUEN as readonly string[]).includes(b.vertrauen) ? b.vertrauen : 'niedrig';
    const gedaechtnis = b.gedaechtnis === true;
    if (gedaechtnis) stat.gedaechtnis++;
    befunde.push({ datei, zeile, klasse, schwere, vertrauen, pruefung: pruefung as Befund['pruefung'], widerlegung, quelle: b.quelle === 'spec' ? 'spec' : 'standard',
      titel: s(b.titel, 200) || '(ohne Titel)', fix: s(b.fix, 600), gedaechtnis });
  }
  const abdeckung: Gepruefte['abdeckung'] = {};
  const ab = j.abdeckung && typeof j.abdeckung === 'object' ? j.abdeckung : {};
  for (const k of KLASSEN) abdeckung[k] = befunde.some((b) => b.klasse === k) ? 'Befund' : ab[k] === 'geprüft' ? 'geprüft' : 'nicht geprüft';
  const gruende = Array.isArray(j.gruende) ? j.gruende.map((x: unknown) => s(x, 300).replace(/\s+/g, ' ')).filter(Boolean).slice(0, 10) : [];
  const offen = BLOCKIERBAR.filter((k) => abdeckung[k] === 'nicht geprüft');
  if (offen.length) gruende.push(`not checked: ${offen.map((k) => KLASSE_TEXT[k]).join(', ')}`);
  const vollstaendig = j.vollstaendig === true && offen.length === 0 && gruende.length === 0;
  // Empfehlung folgt den Befunden (nie „approve“, solange etwas blockiert oder fehlt).
  const empfehlung = befunde.some((b) => b.schwere === 'blocking') ? 'request-changes' : !vollstaendig || befunde.length ? 'comment' : 'approve';
  return { befunde, abdeckung, vollstaendig, gruende, empfehlung, statistik: stat, tests: s(j.tests, 2000) };
}

// Tabellenzelle: Pipes und Zeilen entschärft; @-Erwähnungen gebrochen (ein Befundtext soll niemanden auf GitHub anpingen — Pass C).
const zelle = (t: string) => t.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').replace(/@(?=[\w-])/g, '@\u200b');
const RANG: Record<string, number> = { blocking: 0, advisory: 1 };

/** kommentar.md (englisch, für GitHub) aus den geprüften Befunden — Spec vor Standards, Felder als Tabelle, Abdeckung je Klasse. */
export function kommentarAusBefunden(g: Gepruefte): string {
  const z: string[] = [`Empfehlung: ${g.empfehlung}`, ''];
  if (!g.vollstaendig) z.push(`> **Incomplete review.** ${g.gruende.length ? zelle(g.gruende.join('; ')) : 'The reviewer did not confirm full coverage.'} A missing finding is not evidence of safety.`, '');
  const gruppe = (quelle: 'spec' | 'standard', titel: string) => {
    const l = g.befunde.filter((b) => b.quelle === quelle).sort((a, b) => RANG[a.schwere] - RANG[b.schwere] || a.datei.localeCompare(b.datei) || a.zeile - b.zeile);
    if (!l.length) return;
    z.push(`### ${titel}`, '', '| Severity | Class | Confidence | Check | Location | Finding | Fix |', '|---|---|---|---|---|---|---|');
    for (const b of l) z.push(`| ${b.schwere} | ${KLASSE_TEXT[b.klasse]} | ${b.vertrauen === 'hoch' ? 'high' : b.vertrauen === 'mittel' ? 'medium' : 'low'} | ${b.pruefung.toLowerCase()} | \`${zelle(b.datei)}:${b.zeile}\` | ${zelle(b.titel)}${b.gedaechtnis ? ' (raised on this file before)' : ''} | ${zelle(b.fix) || '–'} |`);
    z.push('');
  };
  gruppe('spec', 'Spec / acceptance');
  gruppe('standard', 'Standards');
  if (!g.befunde.length) z.push('No findings survived verification.', '');
  z.push('### Coverage', '', '| Class | Status |', '|---|---|');
  for (const k of KLASSEN) z.push(`| ${KLASSE_TEXT[k]}${(BLOCKIERBAR as readonly string[]).includes(k) ? '' : ' (advisory)'} | ${g.abdeckung[k] === 'Befund' ? 'finding' : g.abdeckung[k] === 'geprüft' ? 'checked' : 'not checked'} |`);
  z.push('');
  if (g.tests) z.push('### Tests', '', g.tests.replace(/@(?=[\w-])/g, '@\u200b'), '');
  return z.join('\n').trim() + '\n';
}

/** Hash des Entwurfs (#11): gebunden wird an genau diesen Text. */
export const entwurfHash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 16);

/** Darf dieser Entwurf gepostet werden? `incomplete` nur von Hand mit Hinweis, nie automatisch. */
export function postenErlaubt(o: { hashGespeichert: string | null; hashJetzt: string; hashGesehen: string; vollstaendig: boolean | null; auto: boolean; hinweis?: string | null }): { ok: boolean; grund?: string } {
  if (o.hashGespeichert && o.hashJetzt !== o.hashGespeichert) return { ok: false, grund: 'Der Entwurf wurde nach dem Review geändert — neu reviewen.' };
  if (o.hashGesehen !== o.hashJetzt) return { ok: false, grund: 'Der Entwurf hat sich geändert — Seite neu laden.' };
  if (o.vollstaendig === false) {
    if (o.auto) return { ok: false, grund: 'Review unvollständig — nie automatisch gepostet.' };
    if (!String(o.hinweis ?? '').trim()) return { ok: false, grund: 'Review unvollständig — nur mit einem Hinweis von Hand posten.' };
  }
  return { ok: true };
}
