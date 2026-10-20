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
  /** Delta-Review (Live 17c): Freitext zu den Punkten aus dem letzten Review, englisch (alter Weg; neu: `vorige`). */
  delta: string;
  /** Delta-Review (Release 20b): je Punkt aus unserem letzten Review oder offen beim Autor — erledigt/offen/teilweise mit Beleg. */
  vorige: Voriger[];
  /** Ein, zwei Sätze vorweg (englisch), optional. */
  kurz: string;
}
export interface Voriger { punkt: string; quelle: 'review' | 'autor'; stand: 'erledigt' | 'offen' | 'teilweise'; beleg: string }

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
  const vorige: Voriger[] = (Array.isArray(j.vorige) ? j.vorige.slice(0, 40) : []).map((v: any) => ({
    punkt: s(v?.punkt, 200), quelle: v?.quelle === 'autor' ? 'autor' : 'review',
    stand: v?.stand === 'erledigt' || v?.stand === 'teilweise' ? v.stand : 'offen', beleg: s(v?.beleg, 300) })).filter((v: Voriger) => v.punkt) as Voriger[];
  return { befunde, abdeckung, vollstaendig, gruende, empfehlung, statistik: stat, tests: s(j.tests, 2000), delta: s(j.delta, 4000), vorige, kurz: s(j.kurz, 600) };
}

// Ein Format für alle Reviews (Release 20b, Knut 20.10.2026: „heute Tabellen vs. Fließtext“): Liste statt breiter Tabellen —
// Must fix (blockierend) / Should fix (beratend), je Befund Titel, Datei:Zeile, Fix und in einer Klammer Klasse, Vertrauen,
// Prüfzustand; „Spec vor Standards“ innerhalb jeder Gruppe. Abdeckung in einer Zeile. Beim Delta-Review zuerst die vorigen Punkte.
// Text entschärft: keine Zeilenumbrüche in einer Zeile, @-Erwähnungen gebrochen (ein Befundtext soll niemanden anpingen — Pass C).
const zeile1 = (t: string) => t.replace(/\r?\n/g, ' ').replace(/@(?=[\w-])/g, '@\u200b');
const block = (t: string) => t.replace(/@(?=[\w-])/g, '@\u200b');
const RANG: Record<string, number> = { blocking: 0, advisory: 1 };
const STAND_TEXT: Record<Voriger['stand'], string> = { erledigt: '✅ fixed', teilweise: '◐ partly', offen: '❌ open' };
const kurzSha = (h: string) => String(h).slice(0, 7);

/** Formvorgabe für einen selbst geschriebenen kommentar.md (Weg ohne Motor) — dieselbe Form, die der Server aus befunde.json baut. */
export const KOMMENTAR_FORM = [
  'Form von kommentar.md (dieselbe wie bei automatisch gebauten Kommentaren; englisch; keine Tabellen):',
  '```markdown',
  'Empfehlung: request-changes',
  '',
  'Automated review of `<sha7>`.   (Delta: „Delta review of `<sha7>` — changes since our review of `<sha7>` (<link>).“)',
  '<one or two sentences, optional>',
  '',
  '**Previous review items**   (nur beim Delta-Review)',
  '- ✅ fixed — <item> (our review). Evidence: <file:line>',
  '- ❌ open — <item> (author). Evidence: <file:line or why>',
  '',
  '**Must fix**',
  '1. **<one-line finding>** — `<file:line>`',
  '   Fix: <fix> _(<Class> · <high|medium|low> confidence · <confirmed|plausible>)_',
  '',
  '**Should fix**',
  '2. **<one-line finding>** (spec) — `<file:line>`',
  '   Fix: <fix> _(…)_',
  '',
  '**Coverage:** checked — <classes>; not checked — <classes>.',
  '',
  '**Tests:** <what ran / static only>',
  '```',
].join('\n');

/** kommentar.md (englisch, für GitHub) aus den geprüften Befunden — ein Format für alle Reviews (siehe KOMMENTAR_FORM). */
export function kommentarAusBefunden(g: Gepruefte, o: { head?: string | null; vorher?: { head: string; url?: string | null } | null } = {}): string {
  const z: string[] = [`Empfehlung: ${g.empfehlung}`, ''];
  if (o.head) z.push(o.vorher ? `Delta review of \`${kurzSha(o.head)}\` — changes since our review of \`${kurzSha(o.vorher.head)}\`${o.vorher.url ? ` (${o.vorher.url})` : ''}.` : `Automated review of \`${kurzSha(o.head)}\`.`);
  if (g.kurz) z.push(zeile1(g.kurz));
  if (o.head || g.kurz) z.push('');
  if (!g.vollstaendig) z.push(`> **Incomplete review.** ${g.gruende.length ? zeile1(g.gruende.join('; ')) : 'The reviewer did not confirm full coverage.'} A missing finding is not evidence of safety.`, '');
  if (g.vorige.length) {
    z.push('**Previous review items**');
    for (const v of g.vorige) z.push(`- ${STAND_TEXT[v.stand]} — ${zeile1(v.punkt)} (${v.quelle === 'autor' ? 'author' : 'our review'})${v.beleg ? `. Evidence: ${zeile1(v.beleg)}` : ''}`);
    z.push('');
  } else if (g.delta) z.push('**Previous review items**', '', block(g.delta), '');
  let n = 0;
  const gruppe = (schwere: 'blocking' | 'advisory', titel: string) => {
    const l = g.befunde.filter((b) => b.schwere === schwere).sort((a, b) => (a.quelle === 'spec' ? 0 : 1) - (b.quelle === 'spec' ? 0 : 1) || a.datei.localeCompare(b.datei) || a.zeile - b.zeile);
    if (!l.length) return;
    z.push(`**${titel}**`);
    for (const b of l) {
      const meta = `${KLASSE_TEXT[b.klasse]} · ${b.vertrauen === 'hoch' ? 'high' : b.vertrauen === 'mittel' ? 'medium' : 'low'} confidence · ${b.pruefung === 'CONFIRMED' ? 'confirmed' : 'plausible'}${b.gedaechtnis ? ' · raised on this file before' : ''}`;
      z.push(`${++n}. **${zeile1(b.titel)}**${b.quelle === 'spec' ? ' (spec)' : ''} — \`${zeile1(b.datei)}:${b.zeile}\``, `   ${b.fix ? `Fix: ${zeile1(b.fix)} ` : ''}_(${meta})_`);
    }
    z.push('');
  };
  gruppe('blocking', 'Must fix');
  gruppe('advisory', 'Should fix');
  if (!g.befunde.length) z.push(g.vorige.length || g.delta ? 'No new findings in the delta survived verification.' : 'No findings survived verification.', '');
  const geprueft = KLASSEN.filter((k) => g.abdeckung[k] !== 'nicht geprüft').map((k) => KLASSE_TEXT[k]);
  const offen = KLASSEN.filter((k) => g.abdeckung[k] === 'nicht geprüft').map((k) => KLASSE_TEXT[k]);
  z.push(`**Coverage:** checked — ${geprueft.join(', ') || 'nothing'}${offen.length ? `; not checked — ${offen.join(', ')}` : ''}.`, '');
  if (g.tests) z.push(`**Tests:** ${block(g.tests)}`, '');
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
