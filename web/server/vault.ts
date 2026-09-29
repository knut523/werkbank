// Der Obsidian-Vault, nur lesend: Struktur, Notizen, Wikilinks, Backlinks, Darstellung.
// Konventionen (siehe /vault/_meta): Basenamen sind vault-weit eindeutig, Wikilinks lösen über
// den Basenamen auf; Frontmatter ist flaches YAML; Team-Wurzeln = oberste Ordner; PARA darunter.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, basename, sep } from 'node:path';
import MarkdownIt from 'markdown-it';
import YAML from 'yaml';
import { extractTicketRefs, type TicketRef } from './links.ts';

export interface NoteMeta {
  path: string;            // relativ zum Vault, mit "/"
  name: string;            // Basename ohne .md
  title: string;
  team: string;            // oberster Ordner ("" für Wurzel)
  fm: Record<string, unknown>;
  mtime: number;
  size: number;
  links: string[];         // aufgelöste Zielpfade
  unresolved: string[];
  tickets: string[];       // verknüpfte Jira-Keys (Frontmatter, Text, Jira-Link)
}

export interface VaultIndex {
  root: string;
  builtAt: number;
  notes: Map<string, NoteMeta>;
  byName: Map<string, string[]>;   // basename (klein) → Pfade
  backlinks: Map<string, Set<string>>;
  files: Map<string, string>;      // Nicht-Markdown-Dateien: basename (klein) → Pfad
  tickets: Map<string, { path: string; via: TicketRef['via']; prs: string[] }[]>;   // Jira-Key → Notizen
}

const SKIP_DIRS = new Set(['.git', '.obsidian', '.trash', 'node_modules', '.claude', '.stfolder', '.stversions']);

// ---------- reine Parser ----------

export function parseFrontmatter(text: string): { fm: Record<string, unknown>; body: string; bodyLine: number } {
  if (!text.startsWith('---')) return { fm: {}, body: text, bodyLine: 1 };
  const end = text.indexOf('\n---', 3);
  if (end < 0) return { fm: {}, body: text, bodyLine: 1 };
  const raw = text.slice(text.indexOf('\n') + 1, end);
  let fm: Record<string, unknown> = {};
  try {
    const v = YAML.parse(raw);
    if (v && typeof v === 'object' && !Array.isArray(v)) fm = v as Record<string, unknown>;
  } catch { /* kaputtes Frontmatter: als leer behandeln */ }
  const after = text.indexOf('\n', end + 4);
  const body = after < 0 ? '' : text.slice(after + 1);
  const bodyLine = text.slice(0, after < 0 ? text.length : after + 1).split('\n').length;
  return { fm, body, bodyLine };
}

/** Code-Blöcke und Code-Spans entfernen, damit Beispiele keine Links erzeugen. */
export function stripCode(md: string): string {
  return md.replace(/^(```|~~~)[\s\S]*?^\1/gm, '').replace(/`[^`\n]*`/g, '');
}

export interface Wikilink { target: string; heading?: string; alias?: string; embed: boolean }

export function extractWikilinks(md: string): Wikilink[] {
  const out: Wikilink[] = [];
  const re = /(!?)\[\[([^\]\n]+?)\]\]/g;
  for (const m of stripCode(md).matchAll(re)) {
    const inner = m[2].replace(/\\\|/g, '|');
    const [targetPart, alias] = inner.split('|');
    const [target, heading] = targetPart.split('#');
    if (!target.trim()) continue;
    out.push({ target: target.trim(), heading: heading?.trim(), alias: alias?.trim(), embed: m[1] === '!' });
  }
  return out;
}

export function titleOf(fm: Record<string, unknown>, body: string, name: string): string {
  if (typeof fm.title === 'string' && fm.title.trim()) return fm.title.trim();
  const h1 = body.match(/^# (.+)$/m);
  return h1 ? h1[1].trim() : name;
}

// ---------- Index ----------

function walk(root: string, dir: string, out: { md: string[]; other: string[] }) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(root, p, out);
    else if (e.isFile()) (e.name.endsWith('.md') ? out.md : out.other).push(p);
  }
}

const rel = (root: string, p: string) => relative(root, p).split(sep).join('/');

export function resolveLink(idx: Pick<VaultIndex, 'byName' | 'notes'>, target: string, from?: string): string | undefined {
  const t = target.replace(/\.md$/, '');
  if (idx.notes.has(t + '.md')) return t + '.md';              // voller Pfad
  const cands = idx.byName.get(basename(t).toLowerCase());
  if (!cands?.length) return undefined;
  if (cands.length === 1 || !from) return cands[0];
  // Mehrdeutig (sollte es laut Konvention nicht geben): gleiches Team bevorzugen.
  const team = from.split('/')[0];
  return cands.find((c) => c.startsWith(team + '/')) ?? cands[0];
}

export function buildIndex(root: string): VaultIndex {
  const files = { md: [] as string[], other: [] as string[] };
  walk(root, root, files);
  const notes = new Map<string, NoteMeta>();
  const byName = new Map<string, string[]>();
  const bodies = new Map<string, string>();
  for (const abs of files.md) {
    const path = rel(root, abs);
    let st, text;
    try { st = statSync(abs); text = readFileSync(abs, 'utf8'); } catch { continue; }
    const { fm, body } = parseFrontmatter(text);
    const name = basename(path, '.md');
    const parts = path.split('/');
    notes.set(path, {
      path, name, title: titleOf(fm, body, name), team: parts.length > 1 ? parts[0] : '',
      fm, mtime: st.mtimeMs, size: st.size, links: [], unresolved: [], tickets: [],
    });
    bodies.set(path, body);
    const k = name.toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), path]);
  }
  const other = new Map<string, string>();
  for (const abs of files.other) other.set(basename(abs).toLowerCase(), rel(root, abs));
  const idx: VaultIndex = { root, builtAt: Date.now(), notes, byName, backlinks: new Map(), files: other, tickets: new Map() };
  for (const [path, meta] of notes) {
    for (const r of extractTicketRefs(meta.fm, bodies.get(path) ?? '')) {
      meta.tickets.push(r.key);
      idx.tickets.set(r.key, [...(idx.tickets.get(r.key) ?? []), { path, via: r.via, prs: r.prs }]);
    }
    const seen = new Set<string>();
    const fmLinks = [meta.fm.related, meta.fm.supersedes, meta.fm['superseded-by']].flat().filter((x) => typeof x === 'string').join(' ');
    for (const l of [...extractWikilinks(bodies.get(path) ?? ''), ...extractWikilinks(fmLinks)]) {
      const target = resolveLink(idx, l.target, path);
      if (!target) { if (!idx.files.has(basename(l.target).toLowerCase())) meta.unresolved.push(l.target); continue; }
      if (target === path || seen.has(target)) continue;
      seen.add(target);
      meta.links.push(target);
      if (!idx.backlinks.has(target)) idx.backlinks.set(target, new Set());
      idx.backlinks.get(target)!.add(path);
    }
  }
  return idx;
}

// ---------- Struktur ----------

export interface TreeNode { name: string; path: string; kind: 'dir' | 'note'; title?: string; children?: TreeNode[]; count?: number }

export function tree(idx: VaultIndex): TreeNode {
  const rootNode: TreeNode = { name: 'Vault', path: '', kind: 'dir', children: [] };
  const dirs = new Map<string, TreeNode>([['', rootNode]]);
  const ensure = (dirPath: string): TreeNode => {
    if (dirs.has(dirPath)) return dirs.get(dirPath)!;
    const parentPath = dirPath.includes('/') ? dirPath.slice(0, dirPath.lastIndexOf('/')) : '';
    const node: TreeNode = { name: dirPath.split('/').pop()!, path: dirPath, kind: 'dir', children: [] };
    ensure(parentPath).children!.push(node);
    dirs.set(dirPath, node);
    return node;
  };
  for (const n of idx.notes.values()) {
    const d = n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : '';
    ensure(d).children!.push({ name: n.name, path: n.path, kind: 'note', title: n.title });
  }
  const sortRec = (t: TreeNode): number => {
    if (t.kind === 'note') return 1;
    // Ordner zuerst, beide nach Namen (Obsidian-Sortierung; PARA-Präfixe 0-…4- ordnen sich so selbst).
    t.children!.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'de', { numeric: true }) : a.kind === 'dir' ? -1 : 1));
    t.count = t.children!.reduce((s, c) => s + sortRec(c), 0);
    return t.count;
  };
  sortRec(rootNode);
  return rootNode;
}

/** Produkt-OLAF-Roadmap: Thema × Zustand (1-Backlog … 6-Archive). */
export function roadmap(idx: VaultIndex, base = 'olaf/2-Areas/Product/Produkt-OLAF/1-Roadmap') {
  const topics = new Map<string, { overview?: string; states: Record<string, { path: string; title: string; status?: string }[]> }>();
  const overview: { path: string; title: string }[] = [];
  const states = new Set<string>();
  for (const n of idx.notes.values()) {
    if (!n.path.startsWith(base + '/')) continue;
    const parts = n.path.slice(base.length + 1).split('/');
    if (parts[0] === '0-Overview') { overview.push({ path: n.path, title: n.title }); continue; }
    const topic = parts[0];
    if (!topics.has(topic)) topics.set(topic, { states: {} });
    const t = topics.get(topic)!;
    if (parts.length === 2 && /^0-/.test(parts[1])) { t.overview = n.path; continue; }
    if (parts.length >= 3) {
      const st = parts[1];
      states.add(st);
      (t.states[st] ??= []).push({ path: n.path, title: n.title, status: typeof n.fm.status === 'string' ? n.fm.status : undefined });
    }
  }
  const order = [...states].sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));
  return {
    base,
    states: order,
    overview: overview.sort((a, b) => a.path.localeCompare(b.path, 'de', { numeric: true })),
    topics: [...topics.entries()].sort(([a], [b]) => a.localeCompare(b, 'de')).map(([name, v]) => ({ name, ...v })),
  };
}

/** Einstiegspunkte je Team: Home, Open-Questions, MOCs, Timeline, PARA-Ordner. */
export function teams(idx: VaultIndex) {
  const out: Record<string, { home?: string; openQuestions?: string; mocs: string[]; timeline: string[]; para: string[] }> = {};
  for (const n of idx.notes.values()) {
    if (!n.team) continue;
    const t = (out[n.team] ??= { mocs: [], timeline: [], para: [] });
    const parts = n.path.split('/');
    if (parts.length === 2 && /-Home$/.test(n.name)) t.home = n.path;
    if (parts.length === 2 && /-Open-Questions$/.test(n.name)) t.openQuestions = n.path;
    if (parts[1] === 'MOCs') t.mocs.push(n.path);
    if (parts[1] === 'Timeline') t.timeline.push(n.path);
    if (parts.length > 2 && !t.para.includes(parts[1])) t.para.push(parts[1]);
  }
  for (const t of Object.values(out)) {
    t.para.sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));
    t.timeline.sort().reverse();
    t.mocs.sort();
  }
  return out;
}

// ---------- Darstellung ----------

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const CALLOUT = /^\[!([A-Za-z-]+)\]([+-]?)\s*(.*)$/;

function calloutPlugin(md: MarkdownIt) {
  md.core.ruler.after('block', 'obsidian-callout', (state) => {
    const toks = state.tokens;
    for (let i = 0; i < toks.length; i++) {
      if (toks[i].type !== 'blockquote_open') continue;
      const inline = toks[i + 2];
      if (toks[i + 1]?.type !== 'paragraph_open' || inline?.type !== 'inline') continue;
      const first = inline.content.split('\n')[0];
      const m = first.match(CALLOUT);
      if (!m) continue;
      // passendes blockquote_close finden
      let depth = 0, j = i;
      for (; j < toks.length; j++) {
        if (toks[j].type === 'blockquote_open') depth++;
        if (toks[j].type === 'blockquote_close' && --depth === 0) break;
      }
      const kind = m[1].toLowerCase();
      const title = m[3] || kind.charAt(0).toUpperCase() + kind.slice(1);
      const open = new state.Token('html_block', '', 0);
      // Titel ist Markdown; einfach als Text dargestellt (Links darin bleiben im Rumpf erreichbar).
      open.content = `<details class="callout callout-${esc(kind)}"${m[2] === '-' ? '' : ' open'}><summary>${esc(title.replace(/<!--[\s\S]*?-->/g, ''))}</summary>\n`;
      const close = new state.Token('html_block', '', 0);
      close.content = '</details>\n';
      toks[i] = open;
      toks[j] = close;
      const rest = inline.content.split('\n').slice(1).join('\n');
      inline.content = rest; // Inline-Parsing läuft erst danach
      if (!rest.trim()) { toks[i + 1].hidden = true; toks[i + 3].hidden = true; }
    }
  });
}

const md = new MarkdownIt({ html: false, linkify: true, breaks: false, typographer: false });
md.use(calloutPlugin);
// Links: extern in neuem Tab, sicher.
const defaultLinkOpen = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') ?? '';
  if (/^https?:/i.test(href)) { tokens[idx].attrSet('target', '_blank'); tokens[idx].attrSet('rel', 'noopener noreferrer'); }
  return defaultLinkOpen(tokens, idx, options, env, self);
};

export function noteHref(path: string) { return '#/wissen/' + path.split('/').map(encodeURIComponent).join('/'); }

/** Obsidian-Markdown → sicheres HTML (kein Roh-HTML aus der Notiz). */
export function renderNote(idx: Pick<VaultIndex, 'byName' | 'notes' | 'files'>, body: string, from?: string): string {
  // Unsichtbare Kommentaranker entfernen (sie tragen die Sync-Logik, nicht den Inhalt).
  let src = body.replace(/<!--k:[^>]*-->/g, '').replace(/<!--[\s\S]*?-->/g, '');
  // Wikilinks und Einbettungen → Markdown-Links (in Tabellen ist das Trennzeichen "\|").
  src = src.replace(/(!?)\[\[([^\]\n]+?)\]\]/g, (_m, bang: string, inner: string) => {
    const [targetPart, alias] = inner.replace(/\\\|/g, '|').split('|');
    const [target, heading] = targetPart.split('#');
    const label = (alias || (heading ? `${target} › ${heading}` : target)).replace(/[[\]]/g, '');
    const hit = resolveLink(idx, target.trim(), from);
    if (hit) return `[${bang ? '📎 ' : ''}${label}](${noteHref(hit)})`;
    return `[${label} ⚠︎](#/wissen/?fehlt=${encodeURIComponent(target.trim())})`;
  });
  return md.render(src);
}

export function readNote(idx: VaultIndex, path: string): { meta: NoteMeta; body: string; html: string; raw: string } | undefined {
  const meta = idx.notes.get(path);
  if (!meta) return undefined;
  const raw = readFileSync(join(idx.root, path), 'utf8');
  const { body } = parseFrontmatter(raw);
  return { meta, body, raw, html: renderNote(idx, body, path) };
}

// ---------- geteilter, sich selbst aktualisierender Index ----------

let current: VaultIndex | undefined;
let building = false;
export function getIndex(root: string, maxAgeMs = 60_000): VaultIndex {
  if (!current || current.root !== root) current = buildIndex(root);
  else if (!building && Date.now() - current.builtAt > maxAgeMs) {
    building = true;
    try { current = buildIndex(root); } finally { building = false; }
  }
  return current;
}
export function invalidateIndex() { if (current) current.builtAt = 0; }
