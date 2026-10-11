// Werkzeuge des MCP-Servers "vault-search" — nur lesend.
// Volltext über den Meilisearch-Index der Werkbank (Tippfehler-tolerant); fällt Meilisearch aus oder
// fehlt der Schlüssel, sucht er direkt im Dateisystem (mit einfacher Tippfehler-Toleranz).
// Filter (Ordner/Team, Domäne/Thema, Zustand, Frontmatter-Felder, Tags, geändert seit) werden auf dem
// Vault-Index angewandt, damit beide Wege dasselbe liefern.

import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { getIndex, parseFrontmatter, resolveLink, extractWikilinks, type VaultIndex, type NoteMeta } from '../server/vault.ts';
import { topicState, boostOf } from '../server/search.ts';
import { STOP_WORDS, alternativesOf, fold, loadVaultGlossary, wordsOf, hasTerm } from '../server/search-lexicon.ts';

export interface SearchArgs {
  query: string; folder?: string; team?: string; topic?: string; state?: string; type?: string; status?: string;
  tags?: string[]; fields?: Record<string, string>; modified_since?: string; limit?: number;
}

export interface Backend { meiliHost?: string; meiliKey?: string; meiliIndex?: string; vaultDir: string }


function lev1(a: string, b: string): boolean {   // Abstand ≤ 1
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

export function matchesFilters(n: NoteMeta, a: SearchArgs): boolean {
  if (a.folder && !(n.path === a.folder || n.path.startsWith(a.folder.replace(/\/$/, '') + '/'))) return false;
  if (a.team && n.team.toLowerCase() !== a.team.toLowerCase()) return false;
  const ts = topicState(n.path);
  if (a.topic && !ts.topic.some((t) => fold(t).includes(fold(a.topic!)))) return false;
  if (a.state) {
    const want = fold(a.state).replace(/^\d-/, '');
    const st = fold(ts.state).replace(/^\d-/, '');
    if (st !== want && fold(String(n.fm.status ?? '')) !== want) return false;
  }
  if (a.type && String(n.fm.type ?? '') !== a.type) return false;
  if (a.status && String(n.fm.status ?? '') !== a.status) return false;
  if (a.tags?.length) { const t = Array.isArray(n.fm.tags) ? n.fm.tags.map(String) : []; if (!a.tags.every((x) => t.includes(x))) return false; }
  for (const [k, v] of Object.entries(a.fields ?? {})) {
    const f = n.fm[k];
    const vals = Array.isArray(f) ? f.map(String) : f == null ? [] : [String(f)];
    if (!vals.some((x) => fold(x).includes(fold(String(v))))) return false;
  }
  if (a.modified_since) { const t = Date.parse(a.modified_since); if (!isNaN(t) && n.mtime < t) return false; }
  return true;
}

const STOP = new Set(STOP_WORDS.map(fold));
/** Suchbegriffe einer Anfrage: gefaltet, ohne Füllwörter (bleibt nichts übrig, alle). */
export function queryTerms(q: string): string[] {
  const all = fold(q).split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1);
  const kept = all.filter((t) => !STOP.has(t));
  return kept.length ? kept : all;
}

const words = new Map<string, { mtime: number; set: Set<string>; text: string; head: string; textW: string; headW: string; body: string }>();
function noteText(idx: VaultIndex, n: NoteMeta) {
  const c = words.get(n.path);
  if (c && c.mtime === n.mtime) return c;
  let body = '';
  try { body = parseFrontmatter(readFileSync(join(idx.root, n.path), 'utf8')).body; } catch { /* weg */ }
  const aliases = Array.isArray(n.fm.aliases) ? n.fm.aliases.join(' ') : '';
  const heads = [...body.matchAll(/^#{1,4} +(.+)$/gm)].map((m) => m[1]).join('\n');
  const head = fold(`${n.title}\n${n.name.replace(/[-_]/g, ' ')}\n${aliases}\n${heads}\n${String(n.fm.domain ?? '')}\n${Array.isArray(n.fm.tags) ? n.fm.tags.join(' ') : ''}`);
  const text = `${head}\n${fold(body)}`;
  const entry = { mtime: n.mtime, set: new Set(text.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2)), text, head, textW: wordsOf(text), headW: wordsOf(head), body };
  words.set(n.path, entry);
  return entry;
}

/** Ausschnitt mit Überschriftenpfad: die ersten Zeilen, die einen Suchbegriff (oder ein Synonym) enthalten. */
export function lineSnippet(body: string, terms: string[], max = 2): string {
  const typed = new Set(terms);
  const alts = [...new Set(terms.flatMap(alternativesOf))].filter((t) => t.length > 1);
  if (!alts.length) return '';
  const path: string[] = [];
  const out: string[] = [];
  let inCode = false;
  for (const line of body.split('\n')) {
    if (/^(```|~~~)/.test(line)) { inCode = !inCode; continue; }
    if (inCode) continue;
    const h = line.match(/^(#{1,6}) +(.+)$/);
    if (h) { path.length = h[1].length - 1; path[h[1].length - 1] = h[2].trim(); }
    const f = fold(line), fw = wordsOf(line);
    if (!line.trim() || !alts.some((a) => hasTerm(f, fw, a, typed.has(a)))) continue;
    const where = path.filter(Boolean).slice(-2).join(' › ');
    const text = (h ? '' : line.replace(/^\s*[-*>|]+\s*/, '').replace(/\s+/g, ' ').trim()).slice(0, 180);
    out.push(where ? `§ ${where}${text ? ': ' + text : ''}` : text);
    if (out.length >= max) break;
  }
  return out.join(' ⏐ ');
}

export function fsSearch(idx: VaultIndex, a: SearchArgs) {
  const terms = queryTerms(a.query ?? '');
  const altsOf = new Map(terms.map((t) => [t, alternativesOf(t)]));   // einmal je Anfrage, nicht je Notiz
  const scored: { path: string; score: number; matched: number; snippet: string }[] = [];
  for (const n of idx.notes.values()) {
    if (!matchesFilters(n, a)) continue;
    if (!terms.length) { scored.push({ path: n.path, score: n.mtime, matched: 0, snippet: '' }); continue; }
    const t = noteText(idx, n);
    let score = 0, matched = 0;
    for (const term of terms) {
      let hit = altsOf.get(term)!.find((x) => hasTerm(t.text, t.textW, x, x === term));
      let typed = hit === term;
      if (!hit && term.length >= 5) {
        for (const w of t.set) if (w[0] === term[0] && lev1(w, term)) { hit = w; typed = true; break; }
      }
      if (!hit) continue;
      matched++;
      score += hasTerm(t.head, t.headW, hit, typed) ? 5 : 1;
    }
    if (matched) scored.push({ path: n.path, score: score + boostOf(n) * 0.1, matched, snippet: '' });
  }
  // Wie Meilisearch: erst Notizen mit allen Begriffen; nur wenn es die nicht gibt, die mit den meisten.
  const most = Math.max(0, ...scored.map((h) => h.matched));
  const hits = scored.filter((h) => !terms.length || h.matched === most)
    .sort((x, y) => y.score - x.score).slice(0, a.limit ?? 10);
  for (const h of hits) h.snippet = terms.length ? lineSnippet(noteText(idx, idx.notes.get(h.path)!).body, terms) : '';
  return hits;
}

/** Wie Meilisearch fehlende Wörter fallen lässt: 'frequency' hält die seltenen (aussagekräftigen) Begriffe —
 *  im Eval besser als 'last' (das Wörter vom Ende her streicht). Exportiert für den Eval-Lauf. */
export const tuning = { strategy: 'frequency' as 'last' | 'all' | 'frequency' };

async function meiliSearch(b: Backend, q: string): Promise<{ path: string; crop: string }[] | null> {
  if (!b.meiliHost || !b.meiliKey) return null;
  try {
    const r = await fetch(`${b.meiliHost}/indexes/${b.meiliIndex ?? 'werkbank_vault'}/search`, {
      method: 'POST',
      headers: { authorization: `Bearer ${b.meiliKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ q, limit: 200, attributesToRetrieve: ['path'], attributesToCrop: ['body'], cropLength: 30, matchingStrategy: tuning.strategy }),
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    return (j.hits ?? []).map((h: any) => ({ path: String(h.path), crop: String(h._formatted?.body ?? '').replace(/\s+/g, ' ').slice(0, 240) }));
  } catch { return null; }
}

const fmt = (idx: VaultIndex, rows: { path: string; snippet: string }[], via: string) => {
  if (!rows.length) return `Keine Treffer (${via}).`;
  return [`${rows.length} Treffer (${via}):`, ...rows.map((r, i) => {
    const n = idx.notes.get(r.path)!;
    const meta = [n.team, n.fm.type, n.fm.status, `geändert ${new Date(n.mtime).toISOString().slice(0, 10)}`].filter(Boolean).join(' · ');
    return `${i + 1}. ${n.title} — ${n.path} (${meta})${r.snippet ? `\n   …${r.snippet}…` : ''}`;
  })].join('\n');
};

export async function search(b: Backend, a: SearchArgs): Promise<string> {
  const idx = getIndex(b.vaultDir);
  const limit = Math.min(Math.max(a.limit ?? 10, 1), 50);
  loadVaultGlossary(idx);   // Synonyme für Ausschnitte und den Dateisystem-Weg
  if (a.query?.trim()) {
    const m = await meiliSearch(b, a.query);
    if (m) {
      const terms = queryTerms(a.query);
      const rows = m.filter((h) => idx.notes.has(h.path) && matchesFilters(idx.notes.get(h.path)!, a)).slice(0, limit)
        // Fundzeile mit Überschriftenpfad; traf Meilisearch nur über Tippfehler/Präfix, bleibt sein Ausschnitt.
        .map((h) => ({ path: h.path, snippet: lineSnippet(noteText(idx, idx.notes.get(h.path)!).body, terms) || h.crop }));
      if (rows.length || !m.length) return fmt(idx, rows, 'Meilisearch');
    }
  }
  return fmt(idx, fsSearch(idx, { ...a, limit }), 'Dateisystem');
}

export function findNote(idx: VaultIndex, note: string): NoteMeta {
  const direct = idx.notes.get(note) ?? idx.notes.get(note + '.md');
  const hit = direct ?? idx.notes.get(resolveLink(idx, note.replace(/^\[\[|\]\]$/g, '')) ?? '');
  if (!hit) throw new Error(`Notiz „${note}“ nicht gefunden (Pfad relativ zum Vault oder Basename).`);
  return hit;
}

/** Nur einen Abschnitt (Überschrift enthält `section`, bis zur nächsten gleich hohen Überschrift). */
export function sectionOf(body: string, section: string): string | null {
  const lines = body.split('\n');
  const want = fold(section);
  const i = lines.findIndex((l) => /^#{1,6} /.test(l) && fold(l).includes(want));
  if (i < 0) return null;
  const level = lines[i].match(/^#+/)![0].length;
  const j = lines.findIndex((l, k) => k > i && /^#{1,6} /.test(l) && l.match(/^#+/)![0].length <= level);
  return lines.slice(i, j < 0 ? undefined : j).join('\n');
}

/** Mittlere Ebene: Frontmatter + Gliederung (Überschriften mit Zeilenzahl) — billig, vor read_note. */
export function outline(b: Backend, note: string): string {
  const idx = getIndex(b.vaultDir);
  const n = findNote(idx, note);
  const { fm, body } = parseFrontmatter(readFileSync(join(idx.root, n.path), 'utf8'));
  const lines = body.split('\n');
  const heads = lines.map((l, k) => ({ l, k })).filter((x) => /^#{1,4} /.test(x.l));
  const rows = heads.map((h, i) => `${'  '.repeat(h.l.match(/^#+/)![0].length - 1)}${h.l.replace(/^#+ /, '')} (${(heads[i + 1]?.k ?? lines.length) - h.k} Zeilen)`);
  return [`# ${n.title}`, `Pfad: ${n.path} · ${lines.length} Zeilen · ${n.links.length} Links · ${idx.backlinks.get(n.path)?.size ?? 0} Backlinks`,
    `Frontmatter: ${JSON.stringify(fm)}`, 'Gliederung (mit read_note + section einen Abschnitt lesen):', ...rows.slice(0, 80)].join('\n');
}

export function readNote(b: Backend, note: string, maxChars = 12000, section?: string): string {
  const idx = getIndex(b.vaultDir);
  const n = findNote(idx, note);
  const raw = readFileSync(join(idx.root, n.path), 'utf8');
  const { fm } = parseFrontmatter(raw);
  let { body } = parseFrontmatter(raw);
  if (section) {
    const sec = sectionOf(body, section);
    if (sec === null) throw new Error(`Abschnitt „${section}“ nicht gefunden — outline zeigt die Überschriften.`);
    body = sec;
  }
  const links = extractWikilinks(body).map((l) => `[[${l.target}]] → ${resolveLink(idx, l.target, n.path) ?? 'nicht gefunden'}`);
  const uniq = [...new Set(links)];
  return [
    `# ${n.title}`, `Pfad: ${n.path}`, `Frontmatter: ${JSON.stringify(fm)}`,
    uniq.length ? `Wikilinks (${uniq.length}):\n${uniq.slice(0, 60).join('\n')}` : 'Wikilinks: keine',
    '---', body.length > maxChars ? body.slice(0, maxChars) + `\n… (gekürzt, ${body.length} Zeichen insgesamt)` : body,
  ].join('\n');
}

export function backlinks(b: Backend, note: string): string {
  const idx = getIndex(b.vaultDir);
  const n = findNote(idx, note);
  const bl = [...(idx.backlinks.get(n.path) ?? [])].sort();
  return bl.length ? `${bl.length} Backlinks auf ${n.path}:\n${bl.map((p) => `- ${idx.notes.get(p)?.title} — ${p}`).join('\n')}` : `Keine Backlinks auf ${n.path}.`;
}

export function links(b: Backend, note: string): string {
  const idx = getIndex(b.vaultDir);
  const n = findNote(idx, note);
  return [`${n.links.length} Links aus ${n.path}:`, ...n.links.map((p) => `- ${idx.notes.get(p)?.title} — ${p}`), ...(n.unresolved.length ? [`Nicht aufgelöst: ${n.unresolved.join(', ')}`] : [])].join('\n');
}

/** Verwandte Notizen über den Link-Graphen: direkte Links/Backlinks, dann gemeinsame Linkziele und gemeinsame Verweiser. */
export function related(b: Backend, note: string, limit = 15): string {
  const idx = getIndex(b.vaultDir);
  const n = findNote(idx, note);
  const out = new Set(n.links), inn = idx.backlinks.get(n.path) ?? new Set<string>();
  const score = new Map<string, { s: number; why: Set<string> }>();
  const add = (p: string, s: number, why: string) => {
    if (p === n.path || !idx.notes.has(p)) return;
    const e = score.get(p) ?? { s: 0, why: new Set<string>() };
    e.s += s; e.why.add(why); score.set(p, e);
  };
  for (const p of out) add(p, 3, 'verlinkt');
  for (const p of inn) add(p, 3, 'verweist hierher');
  // Hub-Notizen (MOCs, Übersichten mit sehr vielen Links) tragen wenig: Gewicht 1/Anzahl.
  for (const t of out) { const bl = idx.backlinks.get(t) ?? new Set<string>(); if (bl.size <= 40) for (const p of bl) add(p, 1 / Math.sqrt(bl.size), 'gleiches Linkziel'); }
  for (const s of inn) { const ln = idx.notes.get(s)?.links ?? []; if (ln.length <= 40) for (const p of ln) add(p, 1 / Math.sqrt(ln.length), 'gemeinsamer Verweiser'); }
  const rows = [...score.entries()].sort((x, y) => y[1].s - x[1].s || boostOf(idx.notes.get(y[0])!) - boostOf(idx.notes.get(x[0])!)).slice(0, Math.min(limit, 50));
  if (!rows.length) return `Keine verwandten Notizen zu ${n.path} (keine Links, keine Backlinks).`;
  return [`${rows.length} verwandte Notizen zu ${n.path}:`, ...rows.map(([p, e]) => `- ${idx.notes.get(p)!.title} — ${p} (${[...e.why].join(', ')})`)].join('\n');
}

export function listFolder(b: Backend, folder = ''): string {
  const idx = getIndex(b.vaultDir);
  const f = folder.replace(/^\/+|\/+$/g, '');
  const dirs = new Map<string, number>();
  const notes: NoteMeta[] = [];
  for (const n of idx.notes.values()) {
    if (f && !n.path.startsWith(f + '/')) continue;
    const rest = f ? n.path.slice(f.length + 1) : n.path;
    const i = rest.indexOf('/');
    if (i < 0) notes.push(n); else dirs.set(rest.slice(0, i), (dirs.get(rest.slice(0, i)) ?? 0) + 1);
  }
  if (!dirs.size && !notes.length) throw new Error(`Ordner „${folder}“ nicht gefunden.`);
  return [`Ordner ${f || '(Vault-Wurzel)'}:`,
    ...[...dirs.entries()].sort(([a], [b2]) => a.localeCompare(b2, 'de', { numeric: true })).map(([d, c]) => `📁 ${d}/ (${c} Notizen)`),
    ...notes.sort((a, b2) => a.name.localeCompare(b2.name, 'de', { numeric: true })).map((n) => `📄 ${basename(n.path)} — ${n.title}${n.fm.status ? ` [${n.fm.status}]` : ''}`)].join('\n');
}

export function recent(b: Backend, days = 7, folder?: string, limit = 20): string {
  const idx = getIndex(b.vaultDir);
  const since = Date.now() - days * 864e5;
  const rows = [...idx.notes.values()].filter((n) => n.mtime >= since && (!folder || n.path.startsWith(folder.replace(/\/$/, '') + '/')))
    .sort((a, b2) => b2.mtime - a.mtime).slice(0, Math.min(limit, 100));
  return rows.length ? [`${rows.length} Notizen geändert in den letzten ${days} Tagen:`, ...rows.map((n) => `- ${new Date(n.mtime).toISOString().slice(0, 16).replace('T', ' ')} ${n.title} — ${n.path}`)].join('\n') : `Nichts geändert in den letzten ${days} Tagen.`;
}

export function toolDefs(b: Backend) {
  const note = { type: 'string', description: 'Pfad relativ zum Vault (z. B. olaf/MOCs/Olaf-MOC.md) oder Basename (Olaf-MOC)' };
  return [
    {
      name: 'search',
      description: 'Volltextsuche im Obsidian-Vault (Tippfehler-tolerant). Filter: folder (Pfad-Präfix), team (olaf|konekto|amper|Intern|_meta), topic (Domäne unter 2-Areas oder Roadmap-Thema, z. B. Product, Service-View), state (Roadmap-Zustand wie Plan/Review oder Frontmatter-status), type, status, tags, fields (Frontmatter-Feld → Wert), modified_since (JJJJ-MM-TT).',
      inputSchema: { type: 'object', properties: {
        query: { type: 'string' }, folder: { type: 'string' }, team: { type: 'string' }, topic: { type: 'string' }, state: { type: 'string' },
        type: { type: 'string' }, status: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } },
        fields: { type: 'object', additionalProperties: { type: 'string' } }, modified_since: { type: 'string' }, limit: { type: 'number' },
      }, required: ['query'] },
      run: (a: SearchArgs) => search(b, a),
    },
    { name: 'outline', description: 'Gliederung einer Notiz (Frontmatter, Überschriften mit Länge) — erst das, dann gezielt read_note mit section.', inputSchema: { type: 'object', properties: { note }, required: ['note'] }, run: (a: any) => outline(b, a.note) },
    { name: 'read_note', description: 'Eine Notiz lesen: Frontmatter (geparst), aufgelöste Wikilinks, Inhalt. section = nur dieser Abschnitt; max_chars (Vorgabe 12000).', inputSchema: { type: 'object', properties: { note, section: { type: 'string' }, max_chars: { type: 'number' } }, required: ['note'] }, run: (a: any) => readNote(b, a.note, a.max_chars, a.section) },
    { name: 'backlinks', description: 'Welche Notizen verlinken auf diese Notiz?', inputSchema: { type: 'object', properties: { note }, required: ['note'] }, run: (a: any) => backlinks(b, a.note) },
    { name: 'links', description: 'Auf welche Notizen verweist diese Notiz?', inputSchema: { type: 'object', properties: { note }, required: ['note'] }, run: (a: any) => links(b, a.note) },
    { name: 'related', description: 'Verwandte Notizen über den Link-Graphen (Links, Backlinks, gemeinsame Linkziele/Verweiser) — wenn die Suche die richtige Notiz nur streift.', inputSchema: { type: 'object', properties: { note, limit: { type: 'number' } }, required: ['note'] }, run: (a: any) => related(b, a.note, a.limit ?? 15) },
    { name: 'list_folder', description: 'Ordner und Notizen eines Vault-Ordners (leer = Wurzel).', inputSchema: { type: 'object', properties: { folder: { type: 'string' } } }, run: (a: any) => listFolder(b, a.folder ?? '') },
    { name: 'recent', description: 'Zuletzt geänderte Notizen.', inputSchema: { type: 'object', properties: { days: { type: 'number' }, folder: { type: 'string' }, limit: { type: 'number' } } }, run: (a: any) => recent(b, a.days ?? 7, a.folder, a.limit ?? 20) },
  ];
}
