// Agenten-Ergebnisse: Review-Pakete der Haupt-Sitzung und der Orchestrator-Stränge (`~/work/knut/review-pakete/NNN-slug/`,
// docs/plan-dateien-vollstaendig.md, S3). Nur lesen — nichts kommt ins Register, nichts wird verschoben.
//
// Ein Paket ist ein Ordner `^\d{1,4}-[a-z0-9-]+$`. Titel = erste `# `-Überschrift aus bericht.md (sonst aus der ersten
// Markdown-Datei, sonst der Ordnername), Datum = jüngste Änderung der gelisteten Dateien. Gelistet werden nur Ergebnisse
// (Text, Bilder, PDF …) bis Tiefe 3; ganze Repos/node_modules in einem Paket bleiben draußen.

import { closeSync, lstatSync, openSync, readdirSync, readSync, realpathSync } from 'node:fs';
import { extname, join, posix, resolve, sep } from 'node:path';
import MarkdownIt from 'markdown-it';

export const PAKET_RE = /^\d{1,4}-[a-z0-9][a-z0-9-]*$/;
export const PAKET_EXT = new Set(['.md', '.txt', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.csv', '.json', '.html', '.patch', '.diff']);
export const BILD_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const SKIP_DIR = new Set(['node_modules', '.git', '__pycache__', 'dist', 'build', '.next', 'coverage']);
const MAX_FILES = 60, MAX_VISIT = 3000, MAX_DEPTH = 3;

export interface PaketDatei { rel: string; size: number; mtimeMs: number }
export interface Paket { name: string; nr: number; title: string; at: number; files: PaketDatei[]; more: number }

const within = (p: string, dir: string) => p === dir || p.startsWith(dir.endsWith(sep) ? dir : dir + sep);

/** Erste `# `-Überschrift der ersten 8 KB (ohne die ganze Datei zu lesen). */
function heading(abs: string): string | null {
  let fd = -1;
  try {
    fd = openSync(abs, 'r');
    const buf = Buffer.alloc(8192);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const m = buf.subarray(0, n).toString('utf8').match(/^#\s+(.+?)\s*#*\s*$/m);
    return m ? m[1].slice(0, 160) : null;
  } catch { return null; } finally { if (fd >= 0) closeSync(fd); }
}

/** Ein Paket lesen: gelistete Dateien (neueste zuerst nach bericht/plan), Titel, Datum. */
export function readPaket(root: string, name: string): Paket | null {
  const dir = join(root, name);
  try { if (!lstatSync(dir).isDirectory()) return null; } catch { return null; }
  const files: PaketDatei[] = [];
  let visited = 0, more = 0;
  const walk = (abs: string, rel: string, depth: number) => {
    let ents;
    try { ents = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    ents.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of ents) {
      if (++visited > MAX_VISIT) return;
      if (e.name.startsWith('.')) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (depth < MAX_DEPTH && !SKIP_DIR.has(e.name)) walk(join(abs, e.name), r, depth + 1); continue; }
      if (!e.isFile() || !PAKET_EXT.has(extname(e.name).toLowerCase())) continue; // keine Symlinks
      if (files.length >= MAX_FILES) { more++; continue; }
      try { const st = lstatSync(join(abs, e.name)); files.push({ rel: r, size: st.size, mtimeMs: st.mtimeMs }); } catch { /* weg */ }
    }
  };
  walk(dir, '', 1);
  // bericht.md zuerst, dann übrige Markdown-Dateien oben, dann der Rest in Ordnerreihenfolge.
  const rank = (f: PaketDatei) => (f.rel === 'bericht.md' ? 0 : !f.rel.includes('/') && f.rel.endsWith('.md') ? 1 : 2);
  files.sort((a, b) => rank(a) - rank(b) || a.rel.localeCompare(b.rel));
  const md = files.find((f) => f.rel === 'bericht.md') ?? files.find((f) => f.rel.endsWith('.md'));
  const title = (md && heading(join(dir, md.rel))) || name.replace(/^\d+-/, '').replace(/-/g, ' ');
  let at = files.reduce((m, f) => Math.max(m, f.mtimeMs), 0);
  if (!at) try { at = lstatSync(dir).mtimeMs; } catch { /* bleibt 0 */ }
  return { name, nr: Number(name.split('-')[0]), title, at, files, more };
}

let cache: { root: string; at: number; list: Paket[] } | null = null;

/** Alle Pakete, neueste Nummer zuerst. 60 s im Speicher (135 Ordner, manche mit Tausenden Dateien). */
export function listPakete(root: string, now = Date.now()): Paket[] {
  if (cache && cache.root === root && now - cache.at < 60_000) return cache.list;
  let names: string[] = [];
  try { names = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && PAKET_RE.test(d.name)).map((d) => d.name); } catch { names = []; }
  const list = names.map((n) => readPaket(root, n)).filter((p): p is Paket => !!p).sort((a, b) => b.nr - a.nr || b.at - a.at);
  cache = { root, at: now, list };
  return list;
}
export const clearPaketCache = () => { cache = null; };

/** Absoluter Pfad einer Paket-Datei — nur, wenn sie wirklich gelistet würde (Name, Endung, Tiefe, keine Symlinks). */
export function paketFile(root: string, name: string, rel: string): string | null {
  if (!PAKET_RE.test(name)) return null;
  const parts = rel.split('/');
  if (!rel || parts.length > MAX_DEPTH || parts.some((p) => !p || p === '.' || p === '..' || p.startsWith('.') || SKIP_DIR.has(p) || p.includes('\\') || p.includes('\0'))) return null;
  if (!PAKET_EXT.has(extname(rel).toLowerCase())) return null;
  const base = resolve(root, name);
  const abs = resolve(base, rel);
  if (!within(abs, base) || abs === base) return null;
  try {
    // Kein Teil des Pfads darf ein Symlink sein (auch kein Ordner dazwischen) und das Ziel muss im Paket liegen.
    let p = base;
    for (const part of parts) { p = join(p, part); if (lstatSync(p).isSymbolicLink()) return null; }
    if (!lstatSync(abs).isFile()) return null;
    if (!within(realpathSync(abs), realpathSync(base))) return null;
  } catch { return null; }
  return abs;
}

/**
 * Strang zu einem Paket: der neueste Orchestrator-Lauf, dessen Titel, Auftrag oder review_ready-Angaben den
 * Paketnamen oder „Paket NNN“ nennen. Rein: die Läufe kommen herein.
 */
export function strandFor(p: Pick<Paket, 'name' | 'nr'>, runs: Array<{ _id: string; title?: string; url?: string | null; prompt?: string; startedAt?: any; review?: { artefakte?: string[]; gemacht?: string } }>) {
  const nameRe = new RegExp(`(^|[^0-9a-z-])${p.name.replace(/[-]/g, '\\-')}(?![0-9a-z-])`);
  const nrRe = new RegExp(`Paket\\s+${p.nr}(?!\\d)`, 'i');
  const hit = runs
    .filter((r) => {
      const text = [r.title ?? '', r.prompt ?? '', ...(r.review?.artefakte ?? []), r.review?.gemacht ?? ''].join('\n');
      return nameRe.test(text) || nrRe.test(r.title ?? '');
    })
    .sort((a, b) => +new Date(b.startedAt ?? 0) - +new Date(a.startedAt ?? 0))[0];
  return hit ? { id: hit._id, title: hit.title ?? '', url: hit.url ?? null } : null;
}

const md = new MarkdownIt({ html: false, linkify: true, breaks: false, typographer: false });
// Teil C (C2/H6): Mermaid-Blöcke nur als Text — der Client rendert sie (mermaid, securityLevel strict); nie ausführbares HTML.
const fenceDefault = md.renderer.rules.fence!;
md.renderer.rules.fence = (tokens, idx, options, env, self) => {
  const t = tokens[idx];
  if (t.info.trim().split(/\s+/)[0] === 'mermaid') return `<pre class="mermaid-src">${md.utils.escapeHtml(t.content.slice(0, 20_000))}</pre>\n`;
  return fenceDefault(tokens, idx, options, env, self);
};
const DOD: Record<string, string> = { ja: '✓', teilweise: '◐', nein: '✗' };
/** DoD-Zellen („ja | teilweise | nein“) als Häkchen (C3) — nur ganze Tabellenzellen, sonst bleibt alles wie geschrieben. */
export const dodHaken = (html: string) => html.replace(/<td>\s*(ja|teilweise|nein)\s*<\/td>/gi, (_m, w: string) => `<td class="dod dod-${w.toLowerCase()}" title="${w}">${DOD[w.toLowerCase()]} ${w}</td>`);

/**
 * Markdown einer Paket-Datei als HTML (ohne rohes HTML, wie im Wissen-Reiter). Relative Bilder und Links zeigen auf die
 * Paket-Datei in der Werkbank (`api/files/agenten/<paket>/<rel>`), Bilder inline — so stehen Screens im Bericht.
 */
export function renderPaketMd(src: string, paket: string, rel: string): string {
  const body = src.replace(/^---\n[\s\S]*?\n---\n/, '');
  const env = { paket, dir: posix.dirname(rel) };
  const tokens = md.parse(body, env);
  const fix = (url: string, image: boolean) => {
    if (!url || /^[a-z][a-z0-9+.-]*:|^#|^\//i.test(url)) return url;
    const clean = url.split('#')[0].split('?')[0];
    const target = posix.normalize(posix.join(env.dir === '.' ? '' : env.dir, decodeURIComponent(clean)));
    if (target.startsWith('..')) return url;
    return `api/files/agenten/${encodeURIComponent(paket)}/${target.split('/').map(encodeURIComponent).join('/')}${image ? '?inline=1' : ''}`;
  };
  const walk = (ts: any[]) => { for (const t of ts) {
    if (t.type === 'image') t.attrSet('src', fix(t.attrGet('src') ?? '', true));
    if (t.type === 'link_open') t.attrSet('href', fix(t.attrGet('href') ?? '', false));
    if (t.children) walk(t.children);
  } };
  walk(tokens);
  return dodHaken(md.renderer.render(tokens, md.options, env));
}
