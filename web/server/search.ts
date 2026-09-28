// Volltextsuche über den Vault mit dem Meilisearch, das LibreChat ohnehin nutzt (eigener Index).
// Nur lesend: Notizen werden gelesen und indiziert, nie verändert. Neu indiziert wird, was sich
// seit dem letzten Lauf geändert hat (mtime), gelöschte Notizen fallen heraus.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { cfg } from './config.ts';
import { parseFrontmatter, type VaultIndex } from './vault.ts';

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

let known = new Map<string, number>();   // path → mtime im Index
const SCHEMA = 2;                          // bei neuen Feldern erhöhen → einmal alles neu
let ready = false;
export const searchState = { lastRun: 0, docs: 0, error: '' as string };

export async function ensureIndex() {
  if (ready) return;
  if (!(await meili('GET', `/indexes/${cfg.meiliIndex}`))) await waitTask(await meili('POST', '/indexes', { uid: cfg.meiliIndex, primaryKey: 'id' }));
  await meili('PATCH', `/indexes/${cfg.meiliIndex}/settings`, {
    searchableAttributes: ['title', 'name', 'aliases', 'tags', 'path', 'body'],
    filterableAttributes: ['team', 'type', 'status', 'folder', 'folders', 'tags', 'area', 'topic', 'state', 'mtime'],
    sortableAttributes: ['mtime'],
    displayedAttributes: ['*'],
  });
  ready = true;
}

export async function reindex(idx: VaultIndex, full = false): Promise<{ added: number; removed: number }> {
  try {
    await ensureIndex();
    if (full || known.size === 0) {
      // Bestand aus Meilisearch holen, damit ein Neustart nicht alles neu schickt.
      known = new Map();
      for (let offset = 0; ; offset += 1000) {
        const r = await meili('GET', `/indexes/${cfg.meiliIndex}/documents?limit=1000&offset=${offset}&fields=path,mtime,schema`);
        for (const d of r?.results ?? []) if (d.schema === SCHEMA) known.set(d.path, d.mtime);
        if (!r || (r.results ?? []).length < 1000) break;
      }
    }
    const docs = [];
    for (const n of idx.notes.values()) {
      if (known.get(n.path) === n.mtime) continue;
      let body = '';
      try { body = parseFrontmatter(readFileSync(join(idx.root, n.path), 'utf8')).body; } catch { continue; }
      docs.push({
        id: idOf(n.path), path: n.path, name: n.name, title: n.title, team: n.team || 'wurzel',
        folder: n.path.split('/').slice(0, 2).join('/'),
        folders: n.path.split('/').slice(0, -1).map((_, k, a) => a.slice(0, k + 1).join('/')),
        area: typeof n.fm.area === 'string' ? n.fm.area : '',
        ...topicState(n.path),
        type: typeof n.fm.type === 'string' ? n.fm.type : '', status: typeof n.fm.status === 'string' ? n.fm.status : '',
        tags: Array.isArray(n.fm.tags) ? n.fm.tags.map(String) : [],
        aliases: Array.isArray(n.fm.aliases) ? n.fm.aliases.map(String) : [],
        body: body.replace(/<!--[\s\S]*?-->/g, '').slice(0, 60_000), mtime: n.mtime, schema: SCHEMA,
      });
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
    q, limit: opts.limit ?? 30,
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
