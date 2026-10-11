// „Wartet auf dich“ nur mit Fragen, die heute offen sind (Knut, 11.10.2026: „sind die auch aktuell?“ — 465 leere
// `- Knut:`-Zeilen, davon viele aus Live-Specs, überholt oder doppelt). Plan: docs/plan-heute-fragen-aktuell.md.
// Rein lesend: nichts wird im Vault geändert (Inbox-Entscheidung E3 offen). Die Roadmap-Seite „Entscheidungen“
// zeigt weiter alle Zeilen (collectDecisions); Heute bekommt die bereinigte Liste (todayQuestions).
import type { VaultIndex } from './vault.ts';
import { roadmap } from './vault.ts';
import { parseDecisions, type Decision } from './roadmap.ts';
import { hashText } from './sprint.ts';

export interface VaultDecision extends Decision { path: string; spec?: string; title: string; topic: string; state: string; hash: string }

/** Alle leeren `- Knut:`-Zeilen aus Specs (Thema/Zustand) und Übersichten — dieselbe Liste wie bisher in /api/roadmap. */
export function collectDecisions(idx: VaultIndex, read: (rel: string) => string, base: string) {
  const rm = roadmap(idx, base);
  const decisions: VaultDecision[] = [];
  const texts = new Map<string, string>();
  const take = (path: string, f: (d: Decision, hash: string) => VaultDecision) => {
    const text = read(path);
    texts.set(path, text);
    const hash = hashText(text);
    for (const d of parseDecisions(text)) if (d.open) decisions.push(f(d, hash));
  };
  for (const t of rm.topics) for (const [state, specs] of Object.entries(t.states)) for (const sp of specs) {
    take(sp.path, (d, hash) => ({ ...d, path: sp.path, spec: idx.notes.get(sp.path)!.name, title: sp.title, topic: t.name, state, hash }));
  }
  // Übersichtsseiten und Register haben auch „- Knut:“-Zeilen.
  for (const o of [...rm.overview, ...rm.topics.filter((t) => t.overview).map((t) => ({ path: t.overview!, title: idx.notes.get(t.overview!)?.title ?? t.overview! }))]) {
    take(o.path, (d, hash) => ({ ...d, path: o.path, spec: idx.notes.get(o.path)?.name, title: o.title, topic: o.path.includes('/0-Overview/') ? 'Übersicht' : o.path.split('/').at(-2)!, state: 'Übersicht', hash }));
  }
  return { decisions, texts };
}

// ---------- bereinigte Liste für „Heute“ ----------

export interface RegisterRef { id: string | null; head: string; path: string; line: number }
export interface TodayQuestion extends VaultDecision {
  kind: 'spec' | 'register' | 'overview';
  id: string | null;            // Register-ID (A1, F3, N12 …), sonst null
  head: string;                 // Kopfzeile des Eintrags (Register) bzw. die Frage
  since: string | null;         // „Neu am …“ (Register), sonst created (Register) bzw. last-verified/created der Datei
  sinceKind: 'neu' | 'eingetragen' | 'geprüft';
  age: number | null;           // Tage seit `since`
  old: boolean;                 // älter als 14 Tage
  first: boolean;               // zuerst zeigen: „Neu am …“ oder Spec in Plan/Review
  partly: boolean;              // „Entschieden (…, teilweise)“ darunter
  register: RegisterRef[];      // dieselbe Frage steht auch im Register (Spec gewinnt)
  reason?: string;              // nur in cleanup: warum vermutlich überholt
}

export const REGISTER = 'offene-fragen-roadmap-produkt-olaf';
const OLD_DAYS = 14;
const STALE_HEAD = /Überholt|Zuletzt beantwortet|Davor beantwortet/i;
const ID = /^\*\*(?:~~)?([A-Z]\d{1,3}[a-z]?)\b/;
const isItem = (l: string) => /^\s*([-*]|\d+\.)\s/.test(l);
const ind = (l: string) => l.search(/\S/);
const deDate = (s: string) => { const m = s.match(/(\d{2})\.(\d{2})\.(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const days = (from: string, today: string) => Math.round((Date.parse(today + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 864e5);
const fmDate = (fm: Record<string, unknown> | undefined, k: string) => { const v = fm?.[k]; const s = v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null; };

/** Kontext einer Knut-Zeile: Überschriften (H2/H3), Eintragsblock darüber, Antwort-Zeilen darunter. */
function entryAt(lines: string[], line: number) {
  const i = line - 1;
  let h2 = '', h3 = '', code = false;
  for (let j = 0; j < i; j++) {
    if (/^(```|~~~)/.test(lines[j])) code = !code;
    const h = code ? null : lines[j].match(/^(#{2,4})\s+(.+)$/);
    if (h) { if (h[1] === '##') { h2 = h[2].trim(); h3 = ''; } else h3 = h[2].trim(); }
  }
  const kInd = ind(lines[i]);
  const block: string[] = [];
  for (let j = i - 1; j >= 0; j--) {
    const l = lines[j];
    if (!l.trim() || /^#{1,6}\s/.test(l)) break;
    if (/^\s*[-*]\s+Knut\b/.test(l) && ind(l) === kInd) break;   // die Antwortzeile der vorigen Frage
    if (isItem(l) && ind(l) === kInd) continue;                    // Geschwister (z. B. „- Entschieden“) der vorigen Frage
    block.unshift(l);
    if (isItem(l) && ind(l) < kInd) break;
  }
  let decided = false, partly = false;
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    if (!l.trim() || ind(l) < kInd || (isItem(l) && ind(l) === kInd && !/^\s*[-*]\s+(Entschieden|Beantwortet)\b/.test(l) && !/^\s*[-*]\s+Knut\b/.test(l))) break;
    const m = l.match(/^\s*[-*]\s+(Entschieden|Beantwortet)\b(.*)$/);
    if (m && ind(l) === kInd) { if (/teilweise/i.test(m[2].split(':')[0])) partly = true; else decided = true; }
  }
  const head = (block[0] ?? '').replace(/^\s*([-*]|\d+\.)\s+/, '').trim();
  const links = [...block.join('\n').matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim());
  return { h2, h3, head, links, decided, partly, struck: /^(\*\*)?~~/.test(head) };
}

/** IDs aus dem Absatz „**Überholt …**“ des Registers: `stale` = überholt, `keep` = ausdrücklich „bleibt offen“. */
export function staleIds(text: string) {
  const lines = text.split('\n');
  const stale = new Set<string>(), keep = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    if (!/^\*\*Überholt\b/.test(lines[i])) continue;
    for (let j = i + 1; j < lines.length && !/^#{1,6}\s/.test(lines[j]) && !/^\*\*/.test(lines[j]); j++) {
      for (const part of lines[j].split(';')) {
        const to = /bleibt offen/i.test(part) ? keep : stale;
        for (const m of part.matchAll(/(?<![\w#])([A-Z]\d{1,3}[a-z]?)(?![\w])/g)) to.add(m[1]);
      }
    }
  }
  return { stale, keep };
}

const FIRST_STATES = new Set(['3-Plan', '4-Review']);
// ponytail: Wortüberlappung statt Semantik. Grenze 0,3 an den echten Daten (11.10.): darüber dieselbe Frage
// (A1, A74, A81 …), darunter fragt das Register etwas anderes über die Spec (B2, D3, D7 …) und bleibt sichtbar.
// Mindestens zwei gemeinsame Wörter, sonst macht eine Ein-Wort-Spec-Frage jeden Register-Eintrag zur Dublette.
export const SAME = 0.3;
const words = (s: string) => new Set(s.toLowerCase().replace(/\[\[[^\]]*\]\]|`[^`]*`/g, ' ').match(/[a-zäöüß0-9]{4,}/g) ?? []);
export function similar(a: string, b: string) {
  const A = words(a), B = words(b);
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n < 2 ? 0 : n / Math.min(A.size, B.size);   // ein einzelnes gemeinsames Wort ist kein Beleg (kurze Spec-Fragen)
}
const GONE: Record<string, string> = { '5-Live': 'Spec ist live', '6-Archive': 'Spec ist archiviert' };

/**
 * Bereinigt die Knut-Zeilen für „Heute“: `open` = heute offen, jede einmal (zuerst „Neu am …“ und Plan/Review, darin
 * jüngere zuerst); `cleanup` = vermutlich überholt, mit Grund (wird gezeigt, nicht gelöscht); `duplicates` =
 * Register-Einträge, deren Spec selbst fragt (stehen als Etikett an der Spec-Frage).
 */
export function todayQuestions(decisions: VaultDecision[], ctx: { texts: Map<string, string>; fm: (path: string) => Record<string, unknown> | undefined; today: string }) {
  const lines = new Map<string, string[]>();
  const linesOf = (p: string) => { if (!lines.has(p)) lines.set(p, (ctx.texts.get(p) ?? '').split('\n')); return lines.get(p)!; };
  const specState = new Map(decisions.filter((d) => d.state !== 'Übersicht' && d.spec).map((d) => [d.spec!, d.state]));
  const regPath = decisions.find((d) => d.spec === REGISTER)?.path;
  const regIds = staleIds(regPath ? ctx.texts.get(regPath) ?? '' : '');

  // Eine Register-ID, die zweimal vergeben ist (A93/A94, 11.10.), sagt im „Überholt“-Absatz nicht, welche gemeint ist.
  const idCount = new Map<string, number>();
  for (const d of decisions) if (d.spec === REGISTER) { const id = entryAt(linesOf(d.path), d.line).head.match(ID)?.[1]; if (id) idCount.set(id, (idCount.get(id) ?? 0) + 1); }
  const all: (TodayQuestion & { links: string[] })[] = decisions.map((d) => {
    const kind = d.state !== 'Übersicht' ? 'spec' : d.spec === REGISTER ? 'register' : 'overview';
    const e = entryAt(linesOf(d.path), d.line);
    const id = kind === 'register' ? e.head.match(ID)?.[1] ?? null : null;
    const neu = /^Neu am\b/.test(e.h2) ? deDate(e.h2) : null;
    const fm = ctx.fm(d.path);
    // Das Register ist heute geprüft — für seine Einträge sagt das nichts; dort gilt „Neu am …“, sonst `created`.
    const since = neu ?? (kind === 'register' ? fmDate(fm, 'created') : fmDate(fm, 'last-verified') ?? fmDate(fm, 'created'));
    const sinceKind = neu ? 'neu' : kind === 'register' ? 'eingetragen' : 'geprüft';
    const age = since ? days(since, ctx.today) : null;
    let reason: string | undefined;
    if (GONE[d.state]) reason = GONE[d.state];
    else if (kind !== 'spec' && (STALE_HEAD.test(e.h2) || STALE_HEAD.test(e.h3))) reason = `steht unter „${STALE_HEAD.test(e.h3) ? e.h3 : e.h2}“`;
    else if (e.struck) reason = 'durchgestrichen';
    else if (e.decided) reason = 'darunter steht schon „Entschieden“';
    else if (id && regIds.stale.has(id) && idCount.get(id) === 1) reason = `im Register als überholt geführt (${id})`;
    else if (kind === 'register' && !(id && regIds.keep.has(id))) {
      const specs = e.links.filter((l) => specState.has(l));
      if (specs.length && specs.every((l) => GONE[specState.get(l)!])) reason = `verlinkte Spec ist live/archiviert (${specs.join(', ')})`;
    }
    return { ...d, kind, id, head: kind === 'spec' ? d.question : e.head || d.question, since, sinceKind, age, old: age != null && age > OLD_DAYS, first: !!neu || FIRST_STATES.has(d.state), partly: e.partly, register: [], reason, links: e.links };
  });

  const live = all.filter((q) => !q.reason);
  const bySpec = new Map<string, TodayQuestion[]>();
  for (const q of live) if (q.kind === 'spec') bySpec.set(q.spec!, [...(bySpec.get(q.spec!) ?? []), q]);
  const duplicates: TodayQuestion[] = [];
  const open: TodayQuestion[] = [];
  for (const q of live) {
    // Dublette nur, wenn eine verlinkte Spec dieselbe Frage selbst offen hat — dann gewinnt die Spec-Frage.
    const text = `${q.head} ${q.question}`;
    const best = q.kind !== 'register' ? null : [...new Set(q.links)].flatMap((l) => bySpec.get(l) ?? []).map((o) => ({ o, s: similar(text, o.question) })).sort((a, b) => b.s - a.s)[0];
    if (!best || best.s < SAME) { open.push(q); continue; }
    best.o.register.push({ id: q.id, head: q.head, path: q.path, line: q.line });
    duplicates.push(q);
  }
  const order = (a: TodayQuestion, b: TodayQuestion) => Number(b.first) - Number(a.first) || (a.age ?? 1e9) - (b.age ?? 1e9) || a.path.localeCompare(b.path, 'de') || a.line - b.line;
  const strip = ({ links: _l, ...q }: TodayQuestion & { links?: string[] }) => q;
  return {
    raw: decisions.length,
    open: open.sort(order).map(strip),
    cleanup: all.filter((q) => q.reason).sort(order).map(strip),
    duplicates: duplicates.map(strip),
  };
}

/** Für die Antwort an „Heute“: nur die Felder, die die Liste zeigt (die volle Liste steht in `decisions`). */
export function todayPayload(r: ReturnType<typeof todayQuestions>) {
  const slim = (q: TodayQuestion) => ({
    path: q.path, line: q.line, spec: q.spec, title: q.title, state: q.state, head: q.head.length > 200 ? q.head.slice(0, 200) + ' …' : q.head, id: q.id,
    since: q.since, sinceKind: q.sinceKind, age: q.age, old: q.old, partly: q.partly, reason: q.reason,
    register: q.register.map((x) => ({ id: x.id, line: x.line, head: x.head.slice(0, 160) })),
  });
  return { raw: r.raw, open: r.open.map(slim), cleanup: r.cleanup.map(slim), duplicates: r.duplicates.length };
}
