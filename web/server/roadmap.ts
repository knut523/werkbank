// Roadmap-Sektion (Knut, 29.09.: „Produkt-Roadmap in einer eigenen Sektion besser aufbereiten —
// Priorisierung und PR-Review …“). Quellen nur im Vault (lesend), Regeln aus dem Skill olaf-produkt-roadmap:
//   0-Overview/priorisierung-roadmap-produkt-olaf.md   Rangliste (WSJF-leicht, erzeugt von scripts/rank.py)
//   0-Overview/pr-stand-produkt-olaf.md                PR-Register
//   <Thema>/<n-Zustand>/*.md                           Specs, darin offene Entscheidungen „- Knut:“
//   scripts/roadmap_check.py                           Konsistenz (nur lesend)
// Geschrieben wird nur nach Bestätigung: eine Antwort in eine leere „- Knut:“-Zeile oder ein Rang-Vorschlag
// als Zeile auf der Priorisierungsseite (die Rangliste selbst rechnet rank.py in der Hauptsitzung neu).

import { hashText } from './sprint.ts';

// ---------- offene Entscheidungen ----------

export interface Decision { line: number; question: string; section: string; open: boolean; answer: string }

const KNUT = /^((?:> ?)*)(\s*)[-*]\s+Knut:\s*(.*)$/;

export function parseDecisions(text: string): Decision[] {
  const lines = text.split('\n');
  const out: Decision[] = [];
  let section = '';
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^(```|~~~)/.test(l)) { inCode = !inCode; continue; }
    if (inCode) continue;
    const h = l.match(/^#{2,4}\s+(.+)$/);
    if (h) { section = h[1].trim(); continue; }
    const m = l.match(KNUT);
    if (!m) continue;
    const prefix = m[1];
    const indent = m[2].length;
    // Frage = der übergeordnete Listenpunkt (weniger eingerückt) samt Folgezeilen bis zur Knut-Zeile.
    const q: string[] = [];
    for (let j = i - 1; j >= 0; j--) {
      const raw = lines[j].replace(/^(?:> ?)*/, '');
      if (!raw.trim() || /^#{1,6}\s/.test(raw) || /^\[!/.test(raw.trim())) break;
      if (KNUT.test(lines[j]) || /^\s*[-*]\s+[A-ZÄÖÜ][\wäöüß]+:\s/.test(raw) && raw.search(/\S/) >= indent) { if (q.length) break; continue; }
      q.unshift(raw.trim());
      const ind = raw.search(/\S/);
      if (/^\s*([-*]|\d+\.)\s/.test(raw) && ind < indent) break;
      if (!/^\s/.test(raw) && !/^\s*([-*]|\d+\.)\s/.test(raw)) break;   // Absatzanfang
    }
    const question = q.join(' ').replace(/^([-*]|\d+\.)\s+/, '').replace(/\s+/g, ' ').trim();
    out.push({ line: i + 1, question, section, open: !m[3].trim(), answer: m[3].trim() });
    void prefix;
  }
  return out;
}

export function fillDecision(text: string, line: number, answer: string, expectHash: string) {
  if (hashText(text) !== expectHash) throw new Error('Die Notiz hat sich inzwischen geändert — bitte neu laden.');
  const clean = answer.replace(/\s*\n\s*/g, ' ').replace(/<!--/g, '').trim();
  if (!clean) throw new Error('Leere Antwort.');
  const lines = text.split('\n');
  const m = lines[line - 1]?.match(KNUT);
  if (!m) throw new Error('Zeile nicht gefunden — die Notiz hat sich geändert.');
  if (m[3].trim()) throw new Error('Diese Entscheidung ist schon beantwortet.');
  const before = lines[line - 1];
  const after = `${m[1]}${m[2]}- Knut: ${clean}`;
  lines[line - 1] = after;
  return { text: lines.join('\n'), before, after, line };
}

// ---------- Rangliste ----------

export interface RankRow { rank: number; spec: string; topic: string; state: string; gw: number; zk: number; rr: number; cod: number; size: number; wsjf: number; cat: string; blocked: string; next: string; line?: number }

const cells = (row: string) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((c) => c.trim());

export function parseRankTable(text: string): RankRow[] {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^\|\s*Rang\s*\|\s*Spec\s*\|/.test(l));
  if (start < 0) return [];
  const out: RankRow[] = [];
  for (let i = start + 2; i < lines.length && lines[i].startsWith('|'); i++) {
    const c = cells(lines[i]);
    if (c.length < 13) continue;
    const n = (s: string) => Number(s.replace(',', '.')) || 0;
    out.push({ rank: n(c[0]), spec: c[1].replace(/^\[\[|\]\]$/g, '').split('|')[0], topic: c[2], state: c[3], gw: n(c[4]), zk: n(c[5]), rr: n(c[6]), cod: n(c[7]), size: n(c[8]), wsjf: n(c[9]), cat: c[10], blocked: c[11], next: c[12], line: i + 1 });
  }
  return out;
}

/** „N. **kurzname** — Begründung“ (auch mehrzeilig) → kurzname → Text. */
export function parseReasons(text: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /^\d+\.\s+\*\*([^*]+)\*\*\s+—\s+([\s\S]*?)(?=\n\d+\.\s+\*\*|\n#{2,4}\s|\n\n|$)/gm;
  for (const m of text.matchAll(re)) out.set(m[1].trim(), m[2].replace(/\s+/g, ' ').trim());
  return out;
}

export function addRankProposal(text: string, p: { spec: string; from: number; to: number; why: string; who: string; date: string }): string {
  const line = `- ${p.who} (${p.date}): [[${p.spec}]] Rang ${p.from} → ${p.to}${p.why.trim() ? ` — ${p.why.replace(/\s+/g, ' ').trim()}` : ''}`;
  const head = '## Vorschläge aus der Werkbank';
  if (!text.includes(`\n${head}\n`)) return `${text.replace(/\n*$/, '')}\n\n${head}\n\n${line}\n`;
  return `${text.replace(/\n*$/, '')}\n${line}\n`;
}

// ---------- PRs ----------

const REPO: Record<string, string> = { admin: 'olaf-admin', 'tariff-app': 'olaf-tariff-app', 'calc-api': 'olaf-calc-api', 'durable-func': 'olaf-durable-func', umbrella: 'olaf-umbrella', docs: 'olaf-docs' };

export function prRefs(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/github\.com\/[\w.-]+\/([\w.-]+)\/pull\/(\d+)/g)) out.add(`${m[1]}#${m[2]}`);
  for (const m of text.matchAll(/\b(admin|tariff-app|calc-api|durable-func|umbrella|docs)\s?#(\d+)/g)) out.add(`${REPO[m[1]]}#${m[2]}`);
  return [...out];
}

/** Zeilen des PR-Registers, deren erste Spalte einen PR nennt (Tabellen), mit den Spaltenköpfen. */
export function parsePrRegister(text: string): { pr: string; section: string; cols: Record<string, string> }[] {
  const lines = text.split('\n');
  const out: { pr: string; section: string; cols: Record<string, string> }[] = [];
  let section = '';
  let head: string[] | null = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const h = l.match(/^#{2,4}\s+(.+)$/);
    if (h) { section = h[1].trim(); head = null; continue; }
    if (!l.startsWith('|')) { head = null; continue; }
    if (!head) { head = cells(l); i++; continue; }
    const c = cells(l);
    const refs = prRefs(c[0].replace(/\*\*/g, '')) ;
    const bare = c[0].match(/^\*{0,2}#(\d+)/);
    const repoFromSection = Object.values(REPO).find((r) => section.includes(r));
    const pr = refs[0] ?? (bare && repoFromSection ? `${repoFromSection}#${bare[1]}` : null);
    if (!pr) continue;
    out.push({ pr, section, cols: Object.fromEntries(head.map((k, j) => [k, c[j] ?? ''])) });
  }
  return out;
}

// ---------- Konsistenz ----------

export function parseCheck(out: string) {
  const findings: { check: string; level: 'ERROR' | 'WARN'; text: string }[] = [];
  let check = '';
  for (const l of out.split('\n')) {
    const h = l.match(/^\[(\w+)\]\s+\d+ finding/);
    if (h) { check = h[1]; continue; }
    const f = l.match(/^\s+(ERROR|WARN)\s+(.*)$/);
    if (f && check) findings.push({ check, level: f[1] as 'ERROR' | 'WARN', text: f[2].trim() });
  }
  const sum = out.match(/(\d+) error\(s\), (\d+) warning\(s\)/);
  return { findings, errors: sum ? Number(sum[1]) : findings.filter((f) => f.level === 'ERROR').length, warnings: sum ? Number(sum[2]) : findings.filter((f) => f.level === 'WARN').length };
}
