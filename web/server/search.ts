// Volltextsuche über den Vault mit dem Meilisearch, das LibreChat ohnehin nutzt (eigener Index).
// Nur lesend: Notizen werden gelesen und indiziert, nie verändert. Neu indiziert wird, was sich
// seit dem letzten Lauf geändert hat (mtime), gelöschte Notizen fallen heraus.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { cfg } from './config.ts';
import { parseFrontmatter, type NoteMeta, type VaultIndex } from './vault.ts';
import { STOP_WORDS, synonymGroups, loadVaultGlossary, expandText } from './search-lexicon.ts';

/** Domäne/Thema und Zustand aus dem Pfad: 2-Areas/<Domäne>/…, 1-Roadmap/<Thema>/<n-Zustand>/… */
export function topicState(path: string): { topic: string[]; state: string } {
  const p = path.split('/');
  const topic: string[] = [];
  const a = p.indexOf('2-Areas');
  if (a >= 0 && p[a + 1] && p.length > a + 2) topic.push(p[a + 1]);
  if (a >= 0 && p[a + 2] && p.length > a + 3) topic.push(p[a + 2]);
  const r = p.indexOf('1-Roadmap');
  if (r >= 0 && p[r + 1] && p.length > r + 2) topic.push(p[r + 1]);
  const st = r >= 0 && /^\d-/.test(p[r + 2] ?? '') && p.length > r + 3 ? p[r + 2] : '';
  return { topic, state: st };
}

const idOf = (path: string) => createHash('sha1').update(path).digest('hex');

async function meili(method: string, path: string, body?: unknown): Promise<any> {
  const r = await fetch(cfg.meiliHost + path, {
    method,
    headers: { authorization: `Bearer ${cfg.meiliKey}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!r.ok && r.status !== 404) throw new Error(`Meilisearch ${r.status}`);
  return r.status === 404 ? null : r.json();
}

async function waitTask(t: any, ms = 60_000) {
  const uid = t?.taskUid ?? t?.uid;
  if (uid === undefined) return;
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await meili('GET', `/tasks/${uid}`);
    if (!r || r.status === 'succeeded' || r.status === 'failed' || r.status === 'canceled') return;
    await new Promise((res) => setTimeout(res, 150));
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : []);

/** Gewicht für die Rangfolge (Gleichstand-Brecher nach Relevanz): Archiv/Rohmitschrift unten, Gültiges oben. */
export function boostOf(n: Pick<NoteMeta, 'path' | 'fm'>): number {
  const st = str(n.fm.status).toLowerCase(), lc = str(n.fm.lifecycle).toLowerCase();
  if (/(^|\/)(archiv|archive|4-archive|_archive)[^/]*\//i.test(n.path) || /\/raw\//.test(n.path) || ['archived', 'superseded', 'deprecated'].includes(st)) return 0;
  if (st === 'current' || st === 'accepted' || lc === 'live' || lc === 'plan' || lc === 'review') return 2;
  return 1;
}

/** Ein Meilisearch-Dokument für eine Notiz. `synonyms`: die Synonyme der Begriffe aus Titel, Aliasen, Dateiname
 *  und Überschriften (dokumentseitig — im Eval wirksamer als Meilisearchs Anfrage-Synonyme). */
export function docOf(n: NoteMeta, body: string) {
  const clean = body.replace(/<!--[\s\S]*?-->/g, '');
  const headings = [...clean.matchAll(/^#{1,4} +(.+)$/gm)].map((m) => m[1]);
  const aliases = list(n.fm.aliases);
  return {
    id: idOf(n.path), path: n.path, name: n.name, title: n.title, team: n.team || 'wurzel',
    folder: n.path.split('/').slice(0, 2).join('/'),
    folders: n.path.split('/').slice(0, -1).map((_, k, a) => a.slice(0, k + 1).join('/')),
    area: str(n.fm.area),
    ...topicState(n.path),
    type: str(n.fm.type), status: str(n.fm.status),
    tags: list(n.fm.tags), aliases,
    synonyms: expandText([n.title, n.name.replace(/[-_]/g, ' '), ...aliases, ...headings].join('\n')),
    boost: boostOf(n),
    body: clean.slice(0, 60_000), mtime: Math.floor(n.mtime), schema: schemaTag,
  };
}

// Reihenfolge = Gewicht. 'attribute' vor 'proximity': ein Treffer im Titel schlägt nah beieinander stehende
// Wörter im Fließtext (im Eval der größte Einzelgewinn). boost bricht Gleichstände zugunsten gültiger Notizen.
export const SETTINGS = {
  searchableAttributes: ['title', 'aliases', 'name', 'synonyms', 'tags', 'path', 'body'],
  filterableAttributes: ['team', 'type', 'status', 'folder', 'folders', 'tags', 'area', 'topic', 'state', 'mtime'],
  sortableAttributes: ['mtime'],
  rankingRules: ['words', 'typo', 'attribute', 'proximity', 'sort', 'exactness', 'boost:desc'],
  stopWords: STOP_WORDS,
  displayedAttributes: ['*'],
};

let known = new Map<string, number>();   // path → mtime im Index
const SCHEMA = 4;                          // bei neuen Feldern erhöhen → einmal alles neu
let ready = false;
export const searchState = { lastRun: 0, docs: 0, error: '' as string };

export async function ensureIndex() {
  if (ready) return;
  if (!(await meili('GET', `/indexes/${cfg.meiliIndex}`))) await waitTask(await meili('POST', '/indexes', { uid: cfg.meiliIndex, primaryKey: 'id' }));
  await meili('PATCH', `/indexes/${cfg.meiliIndex}/settings`, SETTINGS);
  ready = true;
}

let schemaTag = String(SCHEMA);   // Schema + Wortschatz-Stand: ändert sich ein Glossar, werden alle Notizen neu erweitert
function syncLexicon(idx: VaultIndex) {
  loadVaultGlossary(idx);
  const tag = `${SCHEMA}.${createHash('sha1').update(JSON.stringify(synonymGroups())).digest('hex').slice(0, 8)}`;
  if (tag !== schemaTag) { schemaTag = tag; for (const p of known.keys()) known.set(p, -1); }   // alle neu, Gelöschte fallen trotzdem raus
}

export async function reindex(idx: VaultIndex, full = false): Promise<{ added: number; removed: number }> {
  try {
    await ensureIndex();
    syncLexicon(idx);
    if (full || known.size === 0) {
      // Bestand aus Meilisearch holen, damit ein Neustart nicht alles neu schickt.
      known = new Map();
      for (let offset = 0; ; offset += 1000) {
        const r = await meili('GET', `/indexes/${cfg.meiliIndex}/documents?limit=1000&offset=${offset}&fields=path,mtime,schema`);
        // Auch Dokumente mit altem Schema merken (mtime -1 = neu schicken), sonst fänden Gelöschte nie in `gone`.
        for (const d of r?.results ?? []) known.set(d.path, d.schema === schemaTag ? d.mtime : -1);
        if (!r || (r.results ?? []).length < 1000) break;
      }
    }
    const docs = [];
    for (const n of idx.notes.values()) {
      if (known.get(n.path) === Math.floor(n.mtime)) continue;   // ganze ms: Meilisearch rundet Bruchteile
      let body = '';
      try { body = parseFrontmatter(readFileSync(join(idx.root, n.path), 'utf8')).body; } catch { continue; }
      docs.push(docOf(n, body));
    }
    let last: any;
    for (let i = 0; i < docs.length; i += 200) last = await meili('POST', `/indexes/${cfg.meiliIndex}/documents`, docs.slice(i, i + 200));
    for (const d of docs) known.set(d.path, d.mtime);
    const gone = [...known.keys()].filter((p) => !idx.notes.has(p));
    if (gone.length) last = await meili('POST', `/indexes/${cfg.meiliIndex}/documents/delete-batch`, gone.map(idOf));
    await waitTask(last);   // erst melden, wenn Meilisearch fertig ist
    for (const p of gone) known.delete(p);
    Object.assign(searchState, { lastRun: Date.now(), docs: known.size, error: '' });
    return { added: docs.length, removed: gone.length };
  } catch (e: any) {
    searchState.error = String(e.message ?? e);
    throw e;
  }
}

export async function search(q: string, opts: { team?: string; limit?: number } = {}) {
  await ensureIndex();
  const r = await meili('POST', `/indexes/${cfg.meiliIndex}/search`, {
    q, limit: opts.limit ?? 30, matchingStrategy: 'frequency',   // wie der MCP-Server: seltene Begriffe halten
    filter: opts.team ? `team = "${opts.team.replace(/"/g, '')}"` : undefined,
    attributesToCrop: ['body'], cropLength: 28, attributesToHighlight: ['title', 'body'],
    highlightPreTag: '\u0001', highlightPostTag: '\u0002',
    attributesToRetrieve: ['path', 'title', 'team', 'type', 'status'],
    showMatchesPosition: false,
  });
  return (r?.hits ?? []).map((h: any) => ({
    path: h.path, title: h.title, team: h.team, type: h.type, status: h.status,
    snippet: String(h._formatted?.body ?? '').replace(/\s+/g, ' ').slice(0, 300),
  }));
}
