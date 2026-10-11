// Wortschatz der Vault-Suche ohne Modell: Füllwörter (fallen aus Anfrage und Index) und Synonymgruppen
// (Deutsch/Englisch, Abkürzungen, Komposita). Gepflegt in search-synonyms.json; dieselben Listen nutzt
// der Dateisystem-Weg im MCP-Server, damit beide Wege gleich suchen.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Füllwörter natürlicher Fragen ("wo steht der Bot", "was wurde zu X entschieden"). Nur Wörter ohne Sachbedeutung. */
export const STOP_WORDS = [
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'eines',
  'und', 'oder', 'zu', 'zum', 'zur', 'im', 'in', 'am', 'an', 'auf', 'für', 'fuer', 'mit', 'von', 'vom', 'bei', 'beim', 'über', 'ueber', 'aus', 'nach',
  'ist', 'sind', 'war', 'wird', 'wurde', 'wurden', 'werden', 'hat', 'haben', 'gibt', 'es', 'wir', 'man', 'ich', 'uns', 'unser', 'unsere',
  'wo', 'was', 'wer', 'wie', 'wann', 'warum', 'welche', 'welcher', 'welches', 'steht', 'stehen', 'finde', 'finden', 'gerade', 'eigentlich',
  'the', 'a', 'of', 'to', 'and', 'or', 'for', 'is', 'are', 'where', 'what', 'how', 'who',
];

export const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

let curated: string[][] | undefined;
let glossary: string[][] = [];
const norm = (g: string[]) => [...new Set(g.map((w) => w.toLowerCase().replace(/\s+/g, ' ').trim()).filter((w) => w.length > 1 && w.length <= 40))];

function curatedGroups(): string[][] {
  if (!curated) {
    try {
      const j = JSON.parse(readFileSync(new URL('./search-synonyms.json', import.meta.url), 'utf8'));
      curated = (j.groups as string[][]).map(norm).filter((g) => g.length > 1);
    } catch { curated = []; }
  }
  return curated;
}

/** Synonymgruppen (alle Begriffe einer Gruppe gelten als gleichwertig), klein geschrieben: gepflegt + aus Vault-Glossaren.
 *  Nicht als Meilisearch-`synonyms`: die Anfrage-Synonyme brachten im Eval nichts; der Index trägt sie je Notiz (expandText). */
export function synonymGroups(): string[][] { return [...curatedGroups(), ...glossary]; }

const GLOSSARY_HEAD = /^#{1,4} .*(glossar|begriffe|abkürzungen|abkuerzungen|glossary|abbreviations)/i;
/** Synonyme aus Glossar-Tabellen einer Notiz: | **Zählpunkt (ZP), Zählpunktnummer** | … | oder | **Retrigger / Resubmit** | … |. */
export function glossaryPairs(body: string): string[][] {
  const out: string[][] = [];
  let inGloss = false;
  for (const line of body.split('\n')) {
    if (/^#{1,4} /.test(line)) { inGloss = GLOSSARY_HEAD.test(line); continue; }
    if (!inGloss) continue;
    const m = line.match(/^\|\s*\*\*([^*|]+)\*\*\s*(?:\(([^)|]+)\))?([^|]*)\|([^|]*)\|/);
    if (!m) continue;
    const [, bold, paren, rest, meaning] = m;
    if (/\bvs\.?\b/.test(rest)) continue;
    const terms: string[] = [];
    let b = bold.trim();
    const inner = b.match(/^(.+?)\s*\(([^)]+)\)(.*)$/);
    if (inner) { terms.push(inner[2]); b = (inner[1] + inner[3]).trim(); }
    if (paren) terms.push(paren);
    const slash = b.split(/\s+\/\s+/);
    if (slash.length > 2 || (slash.length === 2 && /\s\/\s/.test(meaning))) continue;   // Aufzählung, keine Synonyme
    terms.push(...slash.flatMap((t) => t.split(/,\s+/)));
    const g = norm(terms.map((t) => t.replace(/^(früher|engl\.|auch|kurz)\s+/i, '').replace(/[`"„“]/g, '')));
    if (g.length > 1 && g.length <= 4 && !g.some((t) => /\d{2,}/.test(t))) out.push(g);
  }
  return out;
}

const glossCache = new Map<string, { mtime: number; groups: string[][] }>();
/** Glossare des Vaults einlesen (nur geänderte Notizen neu). */
export function loadVaultGlossary(idx: { root: string; notes: Map<string, { path: string; mtime: number }> }): void {
  for (const n of idx.notes.values()) {
    if (glossCache.get(n.path)?.mtime === n.mtime) continue;
    let groups: string[][] = [];
    try { const t = readFileSync(join(idx.root, n.path), 'utf8'); if (/glossar|begriffe|abk(ü|ue)rzungen|glossary|abbreviations/i.test(t)) groups = glossaryPairs(t); } catch { /* weg */ }
    glossCache.set(n.path, { mtime: n.mtime, groups });
  }
  for (const p of glossCache.keys()) if (!idx.notes.has(p)) glossCache.delete(p);
  glossary = [...glossCache.values()].flatMap((e) => e.groups);
}

/** Für den Dateisystem-Weg: Begriff (gefaltet) → Alternativen (gefaltet), inkl. sich selbst. */
export function alternativesOf(term: string): string[] {
  const t = fold(term);
  const alts = new Set([t]);
  for (const g of synonymGroups()) if (g.some((w) => fold(w) === t)) for (const w of g) alts.add(fold(w));
  return [...alts];
}

/** Dokumentseitige Synonyme: für Begriffe, die im Text vorkommen, die anderen ihrer Gruppe (ohne sie selbst).
 *  Wirkt auch, wo Meilisearchs Anfrage-Synonyme an der deutschen Wortzerlegung scheitern. */
export function expandText(text: string): string[] {
  const t = ` ${fold(text).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  const out = new Set<string>();
  for (const g of synonymGroups()) {
    const hit = g.filter((w) => t.includes(` ${fold(w).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `));
    if (hit.length) for (const w of g) if (!hit.includes(w)) out.add(w);
  }
  return [...out];
}
