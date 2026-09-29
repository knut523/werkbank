import { LinkButton } from '../components.tsx';
import { useEffect, useMemo, useState } from 'react';
import { api, fmtDateTime, chatTarget, type Config } from '../api.ts';
import { Err, Loading, useLoad, useToast } from '../ui.tsx';

interface TreeNode { name: string; path: string; kind: 'dir' | 'note'; title?: string; children?: TreeNode[]; count?: number }
const hrefOf = (p: string) => '#/wissen/' + p.split('/').map(encodeURIComponent).join('/');

function parseHash(hash: string) {
  const rest = hash.replace(/^#\/wissen\/?/, '');
  const [path, qs] = rest.split('?');
  const params = new URLSearchParams(qs ?? '');
  return { path: decodeURIComponent(path ?? ''), params };
}

function Tree({ node, current, depth = 0 }: { node: TreeNode; current: string; depth?: number }) {
  if (node.kind === 'note') {
    return <a href={hrefOf(node.path)} className={current === node.path ? 'active' : ''} title={node.path}>{node.title ?? node.name}</a>;
  }
  const open = depth === 0 || (current && current.startsWith(node.path + '/'));
  const label = node.name;
  return (
    <details open={!!open}>
      <summary>{label} <span className="tiny">{node.count}</span></summary>
      {node.children!.map((c) => <Tree key={c.path} node={c} current={current} depth={depth + 1} />)}
    </details>
  );
}

function MiniGraph({ center, links, backlinks }: { center: string; links: any[]; backlinks: any[] }) {
  const nodes = [...backlinks.map((b) => ({ ...b, dir: 'in' })), ...links.filter((l) => !backlinks.some((b) => b.path === l.path)).map((l) => ({ ...l, dir: 'out' }))].slice(0, 18);
  if (!nodes.length) return null;
  const W = 240, H = 220, cx = W / 2, cy = H / 2, r = 86;
  return (
    <svg className="graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Verknüpfte Notizen">
      {nodes.map((n, i) => {
        const a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        return (
          <g key={n.path}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke="var(--border-medium)" strokeDasharray={n.dir === 'in' ? '3 3' : undefined} />
            <a href={hrefOf(n.path)}>
              <circle cx={x} cy={y} r={6} fill={n.dir === 'in' ? 'var(--amber-500)' : 'var(--green-600)'}><title>{n.title}</title></circle>
            </a>
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={9} fill="var(--text-primary)"><title>{center}</title></circle>
    </svg>
  );
}

function NoteView({ path }: { path: string }) {
  const n = useLoad(() => api('/api/vault/note?path=' + encodeURIComponent(path)), [path]);
  useEffect(() => { document.querySelector('.main')?.scrollTo(0, 0); }, [path]);
  if (n.loading && !n.data) return <Loading what="Lade Notiz" />;
  if (n.error) return <Err e={n.error} />;
  const d: any = n.data;
  const fm = d.fm ?? {};
  const chips = ['type', 'team', 'area', 'status', 'owner', 'project'].filter((k) => fm[k]);
  return (
    <>
      <article className="note-body">
        <div className="tiny" style={{ marginBottom: 6 }}>{path.split('/').slice(0, -1).map((p: string, i: number, arr: string[]) => <span key={i}>{p}{i < arr.length - 1 ? ' › ' : ''}</span>)}</div>
        <div className="row" style={{ marginBottom: 8 }}>
          {chips.map((k) => <span key={k} className={`chip ${k === 'status' ? (fm[k] === 'current' ? 'ok' : fm[k] === 'draft' ? 'warn' : '') : ''}`}>{k}: {String(fm[k])}</span>)}
          {Array.isArray(fm.tags) && fm.tags.map((t: string) => <span key={t} className="chip">#{t}</span>)}
          {fm['last-verified'] && <span className="chip">geprüft {String(fm['last-verified'])}</span>}
        </div>
        <div dangerouslySetInnerHTML={{ __html: d.html }} />
      </article>
      <aside className="side-panel">
        <a className="btn primary" href={d.chatUrl} target={chatTarget} rel="noreferrer" style={{ width: '100%', justifyContent: 'center' }}>💬 Im Chat öffnen</a>
        <p className="tiny" style={{ marginTop: 6 }}>Startet einen neuen Chat mit dieser Notiz als Kontext. Hier wird nur gelesen; Änderungen macht Claude im Chat nach deinem „ja“.</p>
        <div data-testid="note-tickets" style={{ margin: '10px 0' }}>
          <b>Verknüpfte Tickets ({d.tickets.length})</b>
          {d.tickets.length ? <ul>{d.tickets.map((t: any) => <li key={t.key}><a href={`#/board?key=${t.key}`}><b>{t.key}</b></a> {t.summary ?? <span className="tiny">(nicht in der Kopie)</span>} {t.status && <span className="chip">{t.status}</span>} <span className="tiny">{t.via === 'frontmatter' ? 'Frontmatter' : t.via === 'link' ? 'Jira-Link' : 'im Text'}</span></li>)}</ul>
            : <p className="tiny" style={{ margin: '2px 0' }}>Keine — kein Ticket-Key in Frontmatter oder Text.</p>}
          {d.suggestedTickets?.length > 0 && <>
            <b className="small">Passt vielleicht zu</b>
            <ul>{d.suggestedTickets.map((t: any) => <li key={t.key} className="small"><b>{t.key}</b> {t.summary} <span className="tiny">({t.why})</span> <LinkButton path={path} ticket={t.key} onDone={() => n.reload()} /></li>)}</ul>
          </>}
        </div>
        <MiniGraph center={d.title} links={d.links} backlinks={d.backlinks} />
        <b>Backlinks ({d.backlinks.length})</b>
        <ul>{d.backlinks.map((b: any) => <li key={b.path}><a href={hrefOf(b.path)} title={b.path}>{b.title}</a></li>)}</ul>
        <b>Verweist auf ({d.links.length})</b>
        <ul>{d.links.map((b: any) => <li key={b.path}><a href={hrefOf(b.path)} title={b.path}>{b.title}</a></li>)}</ul>
        {d.unresolved.length > 0 && <><b>Nicht aufgelöst</b><ul>{d.unresolved.map((u: string) => <li key={u} className="tiny">{u}</li>)}</ul></>}
        <p className="tiny">Stand der Datei: {fmtDateTime(d.mtime)} · <code>{path}</code></p>
      </aside>
    </>
  );
}

function Overview({ ov }: { ov: any }) {
  const order = ['olaf', 'konekto', 'amper', 'Intern', '_meta'];
  const teams = Object.entries(ov.teams as Record<string, any>).sort(([a], [b]) => (order.indexOf(a) + 99) % 100 - (order.indexOf(b) + 99) % 100);
  return (
    <div>
      <h1>Wissen</h1>
      <p className="muted">Der Obsidian-Vault, nur lesend: {ov.notes} Notizen. Struktur nach Team → PARA (Projects, Areas, Resources, Archive), dazu MOCs und Timeline. Links funktionieren wie in Obsidian.</p>
      <div className="grid2">
        {teams.map(([name, t]) => (
          <div className="card" key={name}>
            <h3 style={{ marginTop: 0 }}>{name}</h3>
            <div className="small col" style={{ gap: 4 }}>
              {t.home && <a href={hrefOf(t.home)}>🏠 Start ({t.home.split('/').pop()})</a>}
              {t.openQuestions && <a href={hrefOf(t.openQuestions)}>❓ Offene Fragen</a>}
              {t.mocs.map((m: string) => <a key={m} href={hrefOf(m)}>🗺️ {m.split('/').pop()!.replace(/\.md$/, '')}</a>)}
              {t.timeline[0] && <a href={hrefOf(t.timeline[0])}>🕒 Timeline {t.timeline[0].split('/').pop()!.replace(/\.md$/, '')}</a>}
              <div className="row" style={{ marginTop: 4 }}>{t.para.map((p: string) => <span key={p} className="chip">{p}</span>)}</div>
            </div>
          </div>
        ))}
      </div>
      <h2>Produkt-OLAF-Roadmap</h2>
      <Roadmap rm={ov.roadmap} />
    </div>
  );
}

function Roadmap({ rm }: { rm: any }) {
  return (
    <div className="roadmap">
      <div className="row small" style={{ marginBottom: 8 }}>
        {rm.overview.map((o: any) => <a key={o.path} className="chip" href={hrefOf(o.path)}>{o.path.split('/').pop().replace(/\.md$/, '')}</a>)}
      </div>
      <table className="t small">
        <thead><tr><th>Thema</th>{rm.states.map((s: string) => <th key={s}>{s}</th>)}</tr></thead>
        <tbody>
          {rm.topics.map((t: any) => (
            <tr key={t.name}>
              <td><b>{t.overview ? <a href={hrefOf(t.overview)}>{t.name}</a> : t.name}</b></td>
              {rm.states.map((s: string) => (
                <td key={s}><ul>{(t.states[s] ?? []).map((n: any) => <li key={n.path}><a href={hrefOf(n.path)} title={n.path}>{n.title}</a></li>)}</ul></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SearchResults({ q }: { q: string }) {
  const r = useLoad(() => api('/api/vault/search?q=' + encodeURIComponent(q)), [q]);
  if (r.loading && !r.data) return <Loading what="Suche" />;
  if (r.error) return <Err e={r.error} />;
  const hits: any[] = (r.data as any).hits;
  const mark = (s: string) => s.split('\u0001').map((part, i) => {
    if (i === 0) return <span key={i}>{part}</span>;
    const [m, rest] = part.split('\u0002');
    return <span key={i}><mark>{m}</mark>{rest}</span>;
  });
  return (
    <div className="hits">
      <h1>Suche: „{q}“</h1>
      <p className="muted">{hits.length} Treffer</p>
      {hits.map((h) => (
        <div className="hit" key={h.path}>
          <a href={hrefOf(h.path)}><b>{h.title}</b></a> <span className="tiny">{h.path}</span>
          <div className="small muted">{mark(h.snippet)}</div>
        </div>
      ))}
    </div>
  );
}

export function Wissen({ hash }: { cfg: Config; hash: string }) {
  const { path, params } = parseHash(hash);
  const ov = useLoad(() => api('/api/vault/overview'));
  const [q, setQ] = useState(params.get('q') ?? '');
  const toast = useToast();
  const [tab, setTab] = useState<'struktur' | 'olaf'>('struktur');
  const tree = useMemo(() => (ov.data as any)?.tree as TreeNode | undefined, [ov.data]);
  const sub = useMemo(() => {
    if (!tree) return undefined;
    return tab === 'olaf' ? tree.children?.find((c) => c.name === 'olaf') : tree;
  }, [tree, tab]);
  if (ov.error) return <div className="page"><Err e={ov.error} /></div>;
  const view = path === '~roadmap' ? 'roadmap' : params.get('q') ? 'search' : params.get('fehlt') ? 'missing' : path ? 'note' : 'overview';
  return (
    <div className="page wide">
      <div className="wissen">
        <nav className="wtree" aria-label="Vault-Struktur">
          <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) window.location.hash = '#/wissen/?q=' + encodeURIComponent(q.trim()); }} className="row" style={{ marginBottom: 10 }}>
            <input type="search" placeholder="Im Vault suchen …" aria-label="Im Vault suchen" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
          </form>
          <div className="row small" style={{ marginBottom: 8 }}>
            <a href="#/wissen">Übersicht</a> · <a href="#/wissen/~roadmap">Roadmap</a> ·
            <button className="btn ghost small" onClick={async () => { const r: any = await api('/api/vault/reindex', { method: 'POST' }); toast(`Suche aktualisiert (${r.added} neu, ${r.removed} entfernt)`); }}>↻ Index</button>
          </div>
          <div className="tabs" style={{ marginBottom: 6 }}>
            <button className={tab === 'struktur' ? 'on' : ''} onClick={() => setTab('struktur')}>Alle Teams</button>
            <button className={tab === 'olaf' ? 'on' : ''} onClick={() => setTab('olaf')}>olaf</button>
          </div>
          {!sub ? <Loading /> : sub.children!.map((c) => <Tree key={c.path} node={c} current={path} depth={1} />)}
        </nav>
        {view === 'note' ? <NoteView path={path} />
          : view === 'search' ? <div style={{ gridColumn: 'span 2' }}><SearchResults q={params.get('q')!} /></div>
          : view === 'missing' ? <div><h1>Notiz nicht gefunden</h1><p className="muted">Der Link „{params.get('fehlt')}“ zeigt auf keine Notiz im Vault.</p></div>
          : !ov.data ? <Loading />
          : view === 'roadmap' ? <div style={{ gridColumn: 'span 2' }}><h1>Produkt-OLAF-Roadmap</h1><p className="muted">Thema × Zustand, aus <code>{(ov.data as any).roadmap.base}</code>. Eine Spec-Seite je geplantem PR (Skill <code>olaf-produkt-roadmap</code>).</p><Roadmap rm={(ov.data as any).roadmap} /></div>
          : <div style={{ gridColumn: 'span 2' }}><Overview ov={ov.data} /></div>}
      </div>
    </div>
  );
}
