// Werkzeuge des MCP-Servers "vault-search" — nur lesend.
// Volltext über den Meilisearch-Index der Werkbank (Tippfehler-tolerant); fällt Meilisearch aus oder
// fehlt der Schlüssel, sucht er direkt im Dateisystem (mit einfacher Tippfehler-Toleranz).
// Filter (Ordner/Team, Domäne/Thema, Zustand, Frontmatter-Felder, Tags, geändert seit) werden auf dem
// Vault-Index angewandt, damit beide Wege dasselbe liefern.

import { readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { getIndex, parseFrontmatter, resolveLink, extractWikilinks, type VaultIndex, type NoteMeta } from '../server/vault.ts';
import { topicState } from '../server/search.ts';

export interface SearchArgs {
  query: string; folder?: string; team?: string; topic?: string; state?: string; type?: string; status?: string;
  tags?: string[]; fields?: Record<string, string>; modified_since?: string; limit?: number;
}

export interface Backend { meiliHost?: string; meiliKey?: string; meiliIndex?: string; vaultDir: string }

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss');

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

const words = new Map<string, { mtime: number; set: Set<string>; text: string }>();
function noteText(idx: VaultIndex, n: NoteMeta) {
  const c = words.get(n.path);
  if (c && c.mtime === n.mtime) return c;
  let body = '';
  try { body = parseFrontmatter(readFileSync(join(idx.root, n.path), 'utf8')).body; } catch { /* weg */ }
  const text = fold(`${n.title}\n${n.name}\n${body}`);
  const entry = { mtime: n.mtime, set: new Set(text.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2)), text };
  words.set(n.path, entry);
  return entry;
}

function snippet(text: string, term: string) {
  const i = text.indexOf(term);
  const s = text.slice(Math.max(0, i - 80), i + 160).replace(/\s+/g, ' ').trim();
  return i < 0 ? '' : s;
}

export function fsSearch(idx: VaultIndex, a: SearchArgs) {
  const terms = fold(a.query).split(/\s+/).filter((t) => t.length > 1);
  const hits: { path: string; score: number; snippet: string }[] = [];
  for (const n of idx.notes.values()) {
    if (!matchesFilters(n, a)) continue;
    if (!terms.length) { hits.push({ path: n.path, score: n.mtime, snippet: '' }); continue; }
    const t = noteText(idx, n);
    let score = 0, first = '';
    for (const term of terms) {
      let hit = t.text.includes(term);
      let found = term;
      if (!hit && term.length >= 5) {
        for (const w of t.set) if (w[0] === term[0] && lev1(w, term)) { hit = true; found = w; break; }
      }
      if (!hit) { score = 0; break; }
      score += (fold(n.title).includes(term) ? 5 : 1);
      if (!first) first = snippet(t.text, found);
    }
    if (score) hits.push({ path: n.path, score, snippet: first });
  }
  return hits.sort((x, y) => y.score - x.score).slice(0, a.limit ?? 10);
}

async function meiliSearch(b: Backend, a: SearchArgs): Promise<{ path: string; snippet: string }[] | null> {
  if (!b.meiliHost || !b.meiliKey) return null;
  try {
    const r = await fetch(`${b.meiliHost}/indexes/${b.meiliIndex ?? 'werkbank_vault'}/search`, {
      method: 'POST',
      headers: { authorization: `Bearer ${b.meiliKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ q: a.query, limit: 200, attributesToRetrieve: ['path'], attributesToCrop: ['body'], cropLength: 30 }),
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    return (j.hits ?? []).map((h: any) => ({ path: h.path, snippet: String(h._formatted?.body ?? '').replace(/\s+/g, ' ').slice(0, 240) }));
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
  if (a.query?.trim()) {
    const m = await meiliSearch(b, a);
    if (m) {
      const rows = m.filter((h) => idx.notes.has(h.path) && matchesFilters(idx.notes.get(h.path)!, a)).slice(0, limit);
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
    { name: 'list_folder', description: 'Ordner und Notizen eines Vault-Ordners (leer = Wurzel).', inputSchema: { type: 'object', properties: { folder: { type: 'string' } } }, run: (a: any) => listFolder(b, a.folder ?? '') },
    { name: 'recent', description: 'Zuletzt geänderte Notizen.', inputSchema: { type: 'object', properties: { days: { type: 'number' }, folder: { type: 'string' }, limit: { type: 'number' } } }, run: (a: any) => recent(b, a.days ?? 7, a.folder, a.limit ?? 20) },
  ];
}
