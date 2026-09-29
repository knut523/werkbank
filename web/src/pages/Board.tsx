import { useEffect, useState, type ReactNode } from 'react';
import { api, fmtDate, fmtDateTime, today, chatTarget, openChat, type Config } from '../api.ts';
import { Err, Loading, useLoad, useConfirm, useToast, StateChip } from '../ui.tsx';
import { HygienePanel, LinkButton } from '../components.tsx';

const overdue = (i: any) => i.duedate && i.duedate < today() && i.status !== 'Done';

function SubRow({ s, onOpen }: { s: any; onOpen: (k: string) => void }) {
  const done = s.status === 'Done' || s.statusCategory === 'done';
  return (
    <li className={`sub ${done ? 'done' : ''} ${s.match === false ? 'dim' : ''}`} data-sub={s.key}>
      <button className="sublink" onClick={(e) => { e.stopPropagation(); onOpen(s.key); }} title={s.summary}>
        <span className="subk">{done ? '✓' : '○'} {s.key}</span> <span className="subs">{s.summary}</span>
      </button>
      <span className="row" style={{ gap: 3 }}>
        <span className="chip tiny-chip">{s.status}</span>
        <span className={`chip tiny-chip ${s.assignee ? '' : 'warn'}`}>{s.assignee ?? 'ohne Owner'}</span>
        {s.duedate ? <span className={`chip tiny-chip ${s.overdue ? 'bad' : ''}`}>{s.overdue ? 'über ' : ''}{fmtDate(s.duedate)}</span> : !done && <span className="chip tiny-chip warn">ohne Datum</span>}
        {s.hygiene?.length > 0 && <span className="badge-hyg" title={'Braucht Pflege: ' + s.hygiene.join(', ')}>🧹 {s.hygiene.length}</span>}
      </span>
    </li>
  );
}

function Card({ i, onOpen, expanded, onToggle }: { i: any; onOpen: (k: string) => void; expanded: boolean; onToggle: () => void }) {
  const subs: any[] = i.subtasks ?? [];
  const subHyg = subs.filter((s) => s.hygiene?.length).length;
  return (
    <div className={`tcard ${i.broken ? 'broken' : ''} ${i.onlyViaSubtask ? 'dim' : ''}`} role="button" tabIndex={0} onClick={() => onOpen(i.key)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(i.key); }} data-key={i.key}>
      <div className="k"><span>{i.key}{i.type === 'Sub-task' ? ' · Sub' : ''}</span><span>{i.priority && i.priority !== 'Medium' ? i.priority : ''}</span></div>
      <div className="s">{i.summary}</div>
      {i.broken && <div className="chip bad" style={{ marginBottom: 4 }} title="Sub-task ohne Parent-Ticket — in Jira einem Ticket zuordnen oder in einen Task umwandeln">⚠ kaputt: {i.broken}</div>}
      <div className="row" style={{ gap: 4 }}>
        <span className="chip">{i.assignee ?? 'ohne Owner'}</span>
        {i.duedate ? <span className={`chip ${overdue(i) ? 'bad' : ''}`}>{overdue(i) ? 'über ' : ''}{fmtDate(i.duedate)}</span> : i.status !== 'Done' && <span className="chip warn">ohne Datum</span>}
        {i.comments > 0 && <span className="chip">💬 {i.comments}</span>}
        {i.hygiene?.length > 0 && <span className="badge-hyg" title={i.hygiene.join(', ')}>🧹 {i.hygiene.length}</span>}
        {i.agent && <span className={`chip ${i.agent === 'wartet auf ja' ? 'bad' : 'warn'}`} title="Ein Agent arbeitet an dieser Karte (Chat)">🤖 {i.agent}</span>}
      </div>
      {subs.length > 0 && (
        <div className="subbox">
          <button className="subtoggle" aria-expanded={expanded} onClick={(e) => { e.stopPropagation(); onToggle(); }} data-testid={`subtoggle-${i.key}`}>
            {expanded ? '▾' : '▸'} Sub-tasks <b>{i.subtaskDone}/{subs.length}</b> erledigt
            <span className="subbar"><span style={{ width: `${Math.round((i.subtaskDone / subs.length) * 100)}%` }} /></span>
            {subHyg > 0 && <span className="badge-hyg" title="Sub-tasks, die Pflege brauchen">🧹 {subHyg}</span>}
          </button>
          {expanded && <ul className="sublist">{subs.map((s) => <SubRow key={s.key} s={s} onOpen={onOpen} />)}</ul>}
        </div>
      )}
    </div>
  );
}

/** „Agent ansetzen“ als echter Chat: Status je Lauf (läuft / wartet auf ja / fertig), Link in den Chat. */
function ChatAgents({ issueKey, runs, onChange }: { issueKey: string; runs: any[]; onChange: () => void }) {
  const [note, setNote] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const chats = runs.filter((r) => r.mode === 'chat');
  const active = chats.some((r) => r.status === 'läuft' || r.status === 'wartet auf ja');
  useEffect(() => {
    if (!active) return;
    const t = setInterval(onChange, 2500);
    return () => clearInterval(t);
  }, [active, onChange]);
  return (
    <div className="card soft" style={{ marginTop: 12 }} data-testid="agent-chat">
      <h3 style={{ marginTop: 0 }}>🤖 Agent ansetzen</h3>
      <p className="small muted">Startet einen <b>neuen Chat „{issueKey} · …“</b> mit dem Ticket als Kontext, unter deinem Claude. Der Agent arbeitet wirklich — auch ohne offenen Tab; jede Schreibaktion (Vault, Dateien, Jira) wartet im Chat auf dein <b>„ja“</b>. GitHub schreiben ist gesperrt.</p>
      <div className="col">
        <textarea rows={2} placeholder="Optional: was genau soll der Agent tun / worauf achten?" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Auftrag für den Agenten" />
        <div className="row">
          <button className="btn primary" disabled={busy || active} onClick={async () => {
            setErr(null); setBusy(true);
            try { await api(`/api/board/issue/${issueKey}/agent`, { body: { note } }); setNote(''); toast('Agent arbeitet im Chat'); onChange(); } catch (e) { setErr(e); } finally { setBusy(false); }
          }}>{busy ? 'Lege Chat an …' : 'Agent im Chat starten'}</button>
          {active && <span className="tiny">Auf dieser Karte arbeitet schon ein Agent — im Chat weitermachen.</span>}
        </div>
      </div>
      <Err e={err} />
      {chats.length > 0 && (
        <table className="t small" style={{ marginTop: 10 }} data-testid="agent-chats">
          <tbody>{chats.map((r) => (
            <tr key={r._id}>
              <td><StateChip state={r.status} />{r.kind === 'discuss' ? <span className="tiny"> besprechen</span> : null}</td>
              <td className="tiny">{fmtDateTime(r.startedAt)} · {r.userName}{r.written?.length ? <> · schrieb {r.written.map((f: string) => f.replace(/^\/vault\//, '')).join(', ')}</> : null}</td>
              <td><a className="btn small" href={r.url} target={chatTarget} rel="noreferrer">Im Chat öffnen</a></td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

function AgentPanel({ issueKey, runs, onChange }: { issueKey: string; runs: any[]; onChange: () => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [note, setNote] = useState('');
  const drafts = runs.filter((r) => r.mode !== 'chat');
  const [runId, setRunId] = useState<string | null>(drafts[0]?._id ?? null);
  const [run, setRun] = useState<any>(drafts[0] ?? null);
  const [draft, setDraft] = useState<string>(drafts[0]?.draft ?? '');
  const [follow, setFollow] = useState('');
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    if (!runId) return;
    let stop = false;
    const tick = async () => {
      try {
        const r: any = await api('/api/board/runs/' + runId);
        if (stop) return;
        setRun(r);
        if (r.status !== 'läuft') { setDraft((d) => d || r.draft || ''); return; }
        setTimeout(tick, 1500);
      } catch (e) { setErr(e); }
    };
    tick();
    return () => { stop = true; };
  }, [runId]);
  return (
    <details className="card soft" style={{ marginTop: 12 }} open={!!run}>
      <summary><b>📝 Nur Entwurf</b> <span className="small muted">— lesend im Hintergrund, Ergebnis als Kommentarentwurf an der Karte</span></summary>
      <p className="small muted">Startet eine Claude-Code-Sitzung mit deinem eigenen Claude, das Ticket als Kontext, <b>nur lesend</b>. Das Ergebnis kommt als Kommentarentwurf hierher — nach Jira geht er erst nach deinem Klick.</p>
      <Err e={err} />
      {(!run || run.status !== 'läuft') && (
        <div className="col">
          <textarea rows={2} placeholder="Optional: worauf soll der Agent achten?" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Hinweis für den Agenten" />
          <div><button className="btn primary" onClick={async () => {
            setErr(null);
            try { const r: any = await api(`/api/board/issue/${issueKey}/agent`, { body: { note, mode: 'draft' } }); setDraft(''); setRunId(r.id); toast('Agent gestartet'); } catch (e) { setErr(e); }
          }}>Entwurf erstellen</button></div>
        </div>
      )}
      {run && (
        <div style={{ marginTop: 10 }}>
          <div className="row small"><StateChip state={run.status} /> <span className="muted">gestartet {fmtDateTime(run.startedAt)} von {run.userName}</span>{run.sentAt && <span className="chip ok">gesendet {fmtDateTime(run.sentAt)}</span>}</div>
          {run.error && <div className="err small" style={{ marginTop: 6 }}>{run.error}</div>}
          <details open={run.status === 'läuft'} style={{ marginTop: 6 }}><summary className="small">Verlauf</summary><div className="run-log">{run.output || '…'}</div></details>
          {run.status === 'fertig' && (
            <div className="row" style={{ marginTop: 8 }}>
              <input aria-label="Nachfrage an den Agenten" placeholder="Nachfrage an den Agenten (setzt dieselbe Sitzung fort) …" value={follow} onChange={(e) => setFollow(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
              <button className="btn small" disabled={!follow.trim()} onClick={async () => {
                try { const r: any = await api(`/api/board/runs/${runId}/followup`, { body: { text: follow } }); setFollow(''); setDraft(''); setRunId(r.id); } catch (e) { setErr(e); }
              }}>Nachfragen</button>
            </div>
          )}
          {run.status === 'fertig' && !run.sentAt && (
            <div className="col" style={{ marginTop: 8 }}>
              <label htmlFor="draft">Kommentarentwurf (bearbeitbar)</label>
              <textarea id="draft" rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} />
              <div><button className="btn primary" disabled={!draft.trim()} onClick={async () => {
                const ok = await confirm({ title: `Kommentar an ${issueKey} senden?`, body: <><p>Dieser Text wird unter deinem Jira-Konto als Kommentar gepostet:</p><pre style={{ whiteSpace: 'pre-wrap' }}>{draft}</pre></>, confirmLabel: 'An Jira senden' });
                if (!ok) return;
                try { await api(`/api/board/runs/${runId}/send`, { body: { text: draft, confirm: true } }); toast('Kommentar gesendet'); onChange(); setRunId(runId); } catch (e) { setErr(e); }
              }}>An Jira senden</button></div>
            </div>
          )}
        </div>
      )}
    </details>
  );
}

/** Dokumente am Ticket: Vault-Notizen mit dem Key, Dateien, Chats von der Karte, PRs, Vorschläge. */
function Docs({ k, docs, runs, onChange }: { k: string; docs: any; runs: any[]; onChange: () => void }) {
  const [more, setMore] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const files = useLoad(() => api('/api/files'), []);
  const toast = useToast();
  const chats = runs.filter((r) => r.mode === 'chat');
  const mine: any[] = ((files.data as any)?.mine ?? []).filter((f: any) => !(f.tickets ?? []).includes(k));
  const notes = more ? docs.notes : docs.notes.slice(0, 6);
  return (
    <div className="card soft" style={{ marginTop: 10 }} data-testid="ticket-docs">
      <h3 style={{ marginTop: 0 }}>📎 Dokumente <span className="tiny">Vault-Notizen mit {k}, angehängte Dateien, Chats von dieser Karte</span></h3>
      <div className="small docs-h">Vault ({docs.notesTotal})</div>
      {docs.notes.length ? <ul className="small">{notes.map((n: any) => <li key={n.path}><a href={`#/wissen/${n.path.split('/').map(encodeURIComponent).join('/')}`} title={n.path}>{n.title}</a> <span className="tiny">{n.via === 'frontmatter' ? 'Frontmatter' : n.via === 'link' ? 'Jira-Link' : 'im Text'}</span></li>)}</ul> : <p className="tiny">Keine Notiz nennt {k}.</p>}
      {docs.notes.length > 6 && <button className="btn ghost small" onClick={() => setMore(!more)}>{more ? 'weniger' : `alle ${docs.notes.length}`}</button>}
      {docs.agentFiles?.length > 0 && <><div className="small docs-h">Vom Agenten geschrieben</div><ul className="small">{docs.agentFiles.map((w: any) => <li key={w.file}>{w.path ? <a href={`#/wissen/${w.path.split('/').map(encodeURIComponent).join('/')}`}>{w.path}</a> : <code>{w.file}</code>}</li>)}</ul></>}
      {docs.prs?.length > 0 && <><div className="small docs-h">PRs (aus dem Vault)</div><ul className="small">{docs.prs.map((p: string) => <li key={p}><a href={p} target="_blank" rel="noreferrer">{p.replace('https://github.com/', '')}</a></li>)}</ul></>}
      <div className="small docs-h">Dateien ({docs.files.length})</div>
      {docs.files.length > 0 && <ul className="small">{docs.files.map((f: any) => <li key={f.id}><a href={`api/files/${f.id}/download`}>{f.name}</a> <span className="tiny">{f.ownerName}</span></li>)}</ul>}
      {mine.length > 0 && (
        <div className="row small">
          <select aria-label="Datei an Ticket hängen" defaultValue="" onChange={async (e) => {
            const id = e.target.value; if (!id) return;
            try { await api(`/api/files/${id}/ticket`, { body: { key: k } }); toast('An Ticket gehängt'); files.reload(); onChange(); } catch (x) { setErr(x); }
            e.target.value = '';
          }}><option value="">Eigene Datei an {k} hängen …</option>{mine.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        </div>
      )}
      {chats.length > 0 && <><div className="small docs-h">Chats von dieser Karte ({chats.length})</div><ul className="small">{chats.map((r: any) => <li key={r._id}><a href={r.url} target={chatTarget}>{r.kind === 'discuss' ? 'Besprechung' : 'Agent'} · {fmtDateTime(r.startedAt)}</a> <span className="tiny">{r.status}</span></li>)}</ul></>}
      {docs.suggestions?.length > 0 && <>
        <div className="small docs-h">Passt vielleicht (ohne Key)</div>
        <ul className="small">{docs.suggestions.map((s: any) => <li key={s.path}><a href={`#/wissen/${s.path.split('/').map(encodeURIComponent).join('/')}`}>{s.title}</a> <span className="tiny">{s.why}</span> <LinkButton path={s.path} ticket={k} onDone={onChange} /> <button className="btn ghost small" onClick={async () => { await api('/api/links/dismiss', { body: { key: k, path: s.path } }); onChange(); }}>passt nicht</button></li>)}</ul>
      </>}
      <Err e={err} />
    </div>
  );
}

function ForgePanel({ issueKey, enabled, onStarted }: { issueKey: string; enabled: boolean; onStarted: () => void }) {
  const [pr, setPr] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const toast = useToast();
  return (
    <div className="card soft" style={{ marginTop: 12 }} data-testid="forge-panel">
      <h3 style={{ marginTop: 0 }}>🔍 PR prüfen (forge)</h3>
      {!enabled && <p className="small muted" style={{ margin: 0 }}>Kommt bald: forge-review wird gerade abgesichert und danach hier und im Chat angebunden. Ergebnis immer als Entwurf, nichts wird auf GitHub gepostet.</p>}
      <div className="row" style={{ marginTop: 6 }}>
        <input aria-label="Pull Request" placeholder="olaf-admin#171 oder GitHub-Link" value={pr} onChange={(e) => setPr(e.target.value)} disabled={!enabled} style={{ flex: 1, minWidth: 200 }} />
        <button className="btn small" disabled={!enabled || !pr.trim()} onClick={async () => {
          try { await api(`/api/board/issue/${issueKey}/forge`, { body: { pr } }); toast('Review gestartet'); onStarted(); } catch (e) { setErr(e); }
        }}>Review PR</button>
      </div>
      <Err e={err} />
    </div>
  );
}

function Detail({ k, onClose, onChanged, site, forge, onOpenKey }: { k: string; onClose: () => void; onChanged: () => void; site: string; forge?: boolean; onOpenKey: (k: string) => void }) {
  const d = useLoad(() => api('/api/board/issue/' + k), [k]);
  const confirm = useConfirm();
  const toast = useToast();
  const [comment, setComment] = useState('');
  const [trans, setTrans] = useState<any[] | null>(null);
  const [due, setDue] = useState('');
  const [err, setErr] = useState<unknown>(null);
  useEffect(() => { const e = (ev: KeyboardEvent) => ev.key === 'Escape' && onClose(); window.addEventListener('keydown', e); return () => window.removeEventListener('keydown', e); }, [onClose]);
  const write = async (kind: 'comment' | 'status' | 'due', payload: any, title: string, body: ReactNode) => {
    setErr(null);
    if (!(await confirm({ title, body, confirmLabel: 'In Jira schreiben' }))) return false;
    toast('Schreibe über den Jira-MCP …');
    try { await api(`/api/board/issue/${k}/${kind}`, { body: { ...payload, confirm: true } }); toast('In Jira geschrieben'); await d.reload(); onChanged(); return true; }
    catch (e) { setErr(e); return false; }
  };
  const i: any = (d.data as any)?.issue;
  return (
    <div className="drawer" role="dialog" aria-label={`Ticket ${k}`}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <a href={`${site}/browse/${k}`} target="_blank" rel="noreferrer"><b>{k}</b> ↗</a>
        <button className="btn small" onClick={onClose} aria-label="Schließen">✕</button>
      </div>
      {!i ? (d.error ? <Err e={d.error} /> : <Loading />) : (
        <>
          <h2 style={{ marginTop: 6 }}>{i.summary}</h2>
          <div className="row small">
            <StateChip state={i.status} /><span className="chip">{i.type}</span><span className="chip">{i.assignee ?? 'ohne Owner'}</span>
            <span className={`chip ${overdue(i) ? 'bad' : i.duedate ? '' : 'warn'}`}>fällig {fmtDate(i.duedate)}</span>
            {i.priority && <span className="chip">{i.priority}</span>}
          </div>
          {(d.data as any).parent && <p className="small">Übergeordnet: <b>{(d.data as any).parent.key}</b> {(d.data as any).parent.summary}</p>}
          {i.description && <div className="card soft small" style={{ whiteSpace: 'pre-wrap' }}>{i.description}</div>}
          {i.lastComment && <p className="small"><b>Letzter Kommentar</b> ({i.lastComment.author}, {fmtDate(i.lastComment.created)}): {i.lastComment.text}</p>}
          {(d.data as any).children.length > 0 && (() => { const ch = (d.data as any).children; const dn = ch.filter((c: any) => c.status === 'Done' || c.statusCategory === 'done').length; return (
            <div className="card soft" style={{ marginTop: 8 }} data-testid="detail-subtasks">
              <b className="small">Sub-tasks · {dn}/{ch.length} erledigt</b>
              <ul className="sublist">{ch.map((c: any) => <SubRow key={c.key} s={c} onOpen={onOpenKey} />)}</ul>
            </div>); })()}
          {i.type === 'Sub-task' && !i.parent && <p className="err small">⚠ Kaputter Sub-task: kein Parent-Ticket. In Jira einem Ticket zuordnen oder in einen Task umwandeln.</p>}
          <Docs k={k} docs={(d.data as any).docs} runs={(d.data as any).runs} onChange={d.reload} />
          <div className="row"><button className="btn" onClick={async () => {
            setErr(null);
            try { const r: any = await api(`/api/board/issue/${k}/discuss`, { method: 'POST' }); openChat(r.url); } catch (e) { setErr(e); }
          }}>💬 Im Chat besprechen</button></div>
          <Err e={err} />

          <h3>Aktionen <span className="tiny">(je mit Bestätigung — geschrieben über den Atlassian-MCP in deiner Claude-Sitzung, dauert einige Sekunden)</span></h3>
          <div className="col">
            <textarea rows={3} placeholder="Kommentar …" value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Kommentar" />
            <div><button className="btn" disabled={!comment.trim()} onClick={async () => { if (await write('comment', { text: comment }, `Kommentar an ${k}?`, <pre style={{ whiteSpace: 'pre-wrap' }}>{comment}</pre>)) setComment(''); }}>Kommentar senden</button></div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <label>Status</label>
            {trans === null
              ? <button className="btn small" onClick={async () => { try { setTrans(((await api(`/api/board/issue/${k}/transitions`)) as any).transitions); } catch (e) { setErr(e); } }}>Übergänge laden</button>
              : trans.map((t) => <button key={t.id} className="btn small" onClick={() => write('status', { to: t.to }, `Status von ${k} ändern?`, <p>{i.status} → <b>{t.to}</b></p>)}>→ {t.to}</button>)}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <label htmlFor="due">Fälligkeit</label>
            <input id="due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            <button className="btn small" disabled={!due} onClick={() => write('due', { date: due }, `Fälligkeit von ${k} setzen?`, <p>{fmtDate(i.duedate)} → <b>{fmtDate(due)}</b></p>)}>Setzen</button>
            {i.duedate && <button className="btn small" onClick={() => write('due', { date: null }, `Fälligkeit von ${k} entfernen?`, <p>{fmtDate(i.duedate)} → ohne Datum</p>)}>Entfernen</button>}
          </div>
          <ChatAgents issueKey={k} runs={(d.data as any).runs} onChange={d.reload} />
          <AgentPanel issueKey={k} runs={(d.data as any).runs} onChange={() => d.reload()} />
          <ForgePanel issueKey={k} enabled={!!forge} onStarted={() => d.reload()} />
          <p className="tiny" style={{ marginTop: 12 }}>Neue Tickets legt die Werkbank bewusst nicht an (olaf-jira: nur auf ausdrücklichen Auftrag, mit Duplikatsuche und Workstream) — dafür den Chat nutzen.</p>
        </>
      )}
    </div>
  );
}

export function Board({ cfg, hash }: { cfg: Config; hash: string }) {
  const params = new URLSearchParams(hash.split('?')[1] ?? '');
  const [owner, setOwner] = useState(params.get('owner') ?? '');
  const [filter, setFilter] = useState(params.get('filter') ?? '');
  const [q, setQ] = useState('');
  const [done, setDone] = useState(false);
  const [open, setOpen] = useState<string | null>(params.get('key'));
  const hashKey = params.get('key');
  useEffect(() => { if (hashKey) setOpen(hashKey); }, [hashKey]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [allOpen, setAllOpen] = useState(false);
  const toggle = (k: string) => setExpanded((x) => { const n = new Set(x); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const toast = useToast();
  const b = useLoad(() => api(`/api/board?owner=${encodeURIComponent(owner)}&filter=${filter}&q=${encodeURIComponent(q)}&done=${done ? 1 : 0}`), [owner, filter, q, done]);
  const data: any = b.data;
  return (
    <div className="page wide">
      <div className="head">
        <div>
          <h1>Board · {cfg.project}</h1>
          <p className="muted" style={{ margin: 0 }}>Jira-Kopie des Projekts „OLAF“ (Schlüssel {cfg.project}). Spalten = Status, Bahnen = Workstreams. Board-Stand ist nicht Arbeitsstand — im Zweifel fragen.</p>
        </div>
        <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
          <button className="btn" disabled={syncing} onClick={async () => {
            setSyncing(true); setErr(null);
            try { const r: any = await api('/api/board/sync', { method: 'POST' }); toast(`${r.count} Tickets synchronisiert`); await b.reload(); } catch (e) { setErr(e); } finally { setSyncing(false); }
          }}>{syncing ? 'Synchronisiere …' : '↻ Jetzt synchronisieren'}</button>
          {data?.sync && <span className="tiny">Stand {fmtDateTime(data.sync.at)} · {data.sync.count} Tickets · {data.sync.source}{data.sync.error ? ` · letzter Fehler: ${data.sync.error}` : ''}</span>}
        </div>
      </div>
      <Err e={err} />
      <HygienePanel onChange={() => b.reload()} />
      <div className="board-bar">
        <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner">
          <option value="">Alle Owner</option>
          {data?.owners.map((o: string) => <option key={o} value={o}>{o}{data.hygiene.perOwner[o] ? ` · 🧹 ${data.hygiene.perOwner[o]}` : ''}</option>)}
        </select>
        <div className="row" role="group" aria-label="Filter">
          {[['', 'Alle'], ['overdue', `Überfällig${data ? ` (${data.totals.overdue})` : ''}`], ['undated', `Ohne Datum${data ? ` (${data.totals.undated})` : ''}`], ['pflege', `Braucht Pflege${data ? ` (${data.hygiene.total})` : ''}`]].map(([v, l]) => (
            <button key={v} className={`btn small ${filter === v ? 'primary' : ''}`} onClick={() => setFilter(v)}>{l}</button>
          ))}
        </div>
        <input type="search" placeholder="Suchen (Key, Titel, Owner)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tickets suchen" />
        <label className="row small"><input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} /> ältere erledigte zeigen</label>
        <label className="row small"><input type="checkbox" checked={allOpen} onChange={(e) => { setAllOpen(e.target.checked); setExpanded(new Set()); }} /> Sub-tasks aufklappen</label>
        {data && <span className="tiny">{data.totals.cards} Karten · {data.totals.subtasks} Sub-tasks{data.totals.broken ? <> · <span className="chip bad">⚠ {data.totals.broken} kaputt</span></> : null}</span>}
      </div>
      {b.error && <Err e={b.error} />}
      {!data ? <Loading /> : data.lanes.length === 0 ? (
        <div className="card soft"><p>Keine Tickets in der Kopie{filter || owner || q ? ' für diesen Filter' : ''}.</p>{!data.sync && <p className="small">Noch nie synchronisiert — oben auf „Jetzt synchronisieren“ klicken (braucht deinen Jira-Zugang aus der Einrichtung).</p>}</div>
      ) : data.lanes.map((lane: any) => (
        <section className="lane" key={lane.key}>
          <h3>{lane.name} <span className="chip">{lane.count}</span>{lane.hygiene > 0 && <span className="badge-hyg" title="Karten, die Pflege brauchen">🧹 {lane.hygiene}</span>}{lane.workstream && <span className="tiny">{lane.key}{lane.workstream.assignee ? ` · ${lane.workstream.assignee}` : ''}</span>}</h3>
          <div className="cols" style={{ gridTemplateColumns: `repeat(${data.statuses.length}, minmax(180px, 1fr))` }}>
            {data.statuses.map((s: string) => (
              <div key={s}>
                <div className="colhead">{s} · {lane.columns[s].length}</div>
                <div className="col-cards">{lane.columns[s].map((i: any) => <Card key={i.key} i={i} onOpen={setOpen} expanded={allOpen !== expanded.has(i.key)} onToggle={() => toggle(i.key)} />)}</div>
              </div>
            ))}
          </div>
        </section>
      ))}
      {open && <Detail k={open} onOpenKey={setOpen} site={data?.site ?? cfg.jiraSite} forge={cfg.forge} onClose={() => { setOpen(null); b.reload(); }} onChanged={() => b.reload()} />}
    </div>
  );
}
