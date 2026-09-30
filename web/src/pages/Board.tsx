import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, fmtDate, fmtDateTime, today, chatTarget, openChat, type Config } from '../api.ts';
import { Err, Loading, useLoad, useConfirm, useToast, StateChip, useJiraLive } from '../ui.tsx';
import { HygienePanel, LinkButton } from '../components.tsx';
import { NoGoal } from './Sprint.tsx';
import { moveActions, allowedStatuses, laneAllowed, moveCard, describeMove, type Transition } from '../boardMove.ts';

const overdue = (i: any) => i.duedate && i.duedate < today() && i.status !== 'Done' && i.status !== 'Ongoing';
/** Datums-Chip: überfällig / Datum / „wiederkehrend“ (Ongoing) / „ohne Datum“. */
function DueChip({ i, small }: { i: any; small?: boolean }) {
  const c = small ? 'chip tiny-chip' : 'chip';
  if (i.status === 'Ongoing') return <span className={c} title="Ongoing = wiederkehrende Arbeit, braucht kein Enddatum">↻ wiederkehrend</span>;
  if (i.duedate) return <span className={`${c} ${overdue(i) ? 'bad' : ''}`}>{overdue(i) ? 'über ' : ''}{fmtDate(i.duedate)}</span>;
  if (i.status === 'Done' || i.statusCategory === 'done') return null;
  return <span className={`${c} warn`}>ohne Datum</span>;
}
const daysSince = (s?: string | null) => (s ? Math.max(0, Math.floor((Date.now() - new Date(s).getTime()) / 864e5)) : null);
/** „seit X Tagen in Status“ — aus statuscategorychangedate (Kategoriewechsel). */
function Since({ i }: { i: any }) {
  const d = daysSince(i.statusSince);
  if (d === null || i.status === 'Done' || i.statusCategory === 'done') return null;
  return <span className={`chip ${d >= 14 && i.status === 'In Progress' ? 'warn' : ''}`} title={`Seit ${new Date(i.statusSince).toLocaleDateString('de-AT')} in dieser Statuskategorie`}>seit {d} {d === 1 ? 'Tag' : 'Tagen'} {i.status}</span>;
}
function Blocked({ i }: { i: any }) {
  if (!i.blockedBy?.length) return null;
  return <span className="chip bad" title="Offene Tickets, die dieses blockieren (Jira-Link „is blocked by“)">⛔ blockiert von {i.blockedBy.join(', ')}</span>;
}

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
        <DueChip i={s} small />
        {s.noGoal && <NoGoal />}
        {s.hygiene?.length > 0 && <span className="badge-hyg" title={'Braucht Pflege: ' + s.hygiene.join(', ')}>🧹 {s.hygiene.length}</span>}
      </span>
    </li>
  );
}

interface Mover { start: (i: any) => void; end: () => void; menu: (i: any) => void }

function Card({ i, onOpen, expanded, onToggle, fresh, mover }: { i: any; onOpen: (k: string) => void; expanded: boolean; onToggle: () => void; fresh?: boolean; mover?: Mover }) {
  const subs: any[] = i.subtasks ?? [];
  const subHyg = subs.filter((s) => s.hygiene?.length).length;
  return (
    <div className={`tcard ${i.broken ? 'broken' : ''} ${i.onlyViaSubtask ? 'dim' : ''} ${fresh ? 'fresh' : ''} ${i.pending ? 'pending' : ''}`} role="button" tabIndex={0} onClick={() => onOpen(i.key)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(i.key); }} data-key={i.key}
      draggable={!!mover} onDragStart={(e) => { e.dataTransfer.setData('text/plain', i.key); e.dataTransfer.effectAllowed = 'move'; mover?.start(i); }} onDragEnd={() => mover?.end()}>
      <div className="k"><span>{i.key}{i.type === 'Sub-task' ? ' · Sub' : ''}</span><span className="row" style={{ gap: 4 }}>{i.priority && i.priority !== 'Medium' ? i.priority : ''}{mover && <button className="btn ghost small movebtn" aria-label={`${i.key} verschieben nach …`} title="Verschieben nach …" onClick={(e) => { e.stopPropagation(); mover.menu(i); }}>⇄</button>}</span></div>
      <div className="s">{i.summary}</div>
      {i.broken && (i.type === 'Sub-task'
        ? <div className="chip bad" style={{ marginBottom: 4 }} title="Sub-task ohne Parent-Ticket — in Jira einem Ticket zuordnen oder in einen Task umwandeln">⚠ kaputt: {i.broken}</div>
        : <div className="chip bad" style={{ marginBottom: 4 }} title="Jedes Ticket hängt an einem Workstream (olaf-jira). In Jira den Parent auf den passenden Workstream setzen — oder im Chat fragen, wohin es gehört.">⚠ {i.broken} — in Jira Parent setzen</div>)}
      <div className="row" style={{ gap: 4 }}>
        <span className="chip">{i.assignee ?? 'ohne Owner'}</span>
        <DueChip i={i} />
        {i.comments > 0 && <span className="chip">💬 {i.comments}</span>}
        {i.hygiene?.length > 0 && <span className="badge-hyg" title={i.hygiene.join(', ')}>🧹 {i.hygiene.length}</span>}
        {i.agent && <span className={`chip ${i.agent === 'wartet auf ja' ? 'bad' : 'warn'}`} title="Ein Agent arbeitet an dieser Karte (Chat)">🤖 {i.agent}</span>}
        <Since i={i} />
        <Blocked i={i} />
        {i.goals?.map((g: string) => <a key={g} className="chip goal-id" href={`#/ziele/${g}`} onClick={(e) => e.stopPropagation()} title="Ziel (Werkbank-Zuordnung, sonst Jira-Label)">🎯 {g}</a>)}
        {i.noGoal && <NoGoal small={false} />}
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


/** Priorität, Owner, Ziel-Label ändern — je mit Bestätigung; Trockenlauf in der Vorschau. */
function EditFields({ i, onDone }: { i: any; onDone: () => void }) {
  const meta = useLoad(() => api('/api/jira/meta'), []);
  const m: any = meta.data;
  const confirm = useConfirm();
  const toast = useToast();
  const [err, setErr] = useState<unknown>(null);
  const edit = async (body: any, title: string) => {
    setErr(null);
    try {
      const pre: any = await api(`/api/board/issue/${i.key}/edit`, { body });
      if (pre.nothing) return;
      const onlyGoal = body.goal !== undefined && body.priority === undefined && body.assignee === undefined;
      if (!(await confirm({ title, confirmLabel: onlyGoal ? 'In der Werkbank speichern' : pre.dryRun ? 'Trockenlauf ausführen' : 'In Jira schreiben', body: <><pre className="small">{pre.preview}</pre>{pre.dryRun && <p className="note small">Vorschau: <b>Trockenlauf</b> — nichts wird geschrieben.</p>}</> }))) return;
      const r: any = await api(`/api/board/issue/${i.key}/edit`, { body: { ...body, confirm: true } });
      toast(r.dryRun ? `Trockenlauf: würde schreiben — ${r.done.join(' · ')}` : onlyGoal ? `Gespeichert: ${r.done.join(' · ')}` : `In Jira: ${r.done.join(' · ')}`);
      onDone();
    } catch (e) { setErr(e); }
  };
  if (!m) return null;
  return (
    <div className="row" style={{ marginTop: 10, gap: 10 }} data-testid="edit-fields">
      <label className="small">Priorität <select aria-label="Jira-Priorität" value={i.priority ?? ''} onChange={(e) => e.target.value && edit({ priority: e.target.value }, `Priorität von ${i.key} ändern?`)}>{!i.priority && <option value="">— keine —</option>}{m.priorities.map((p: string) => <option key={p} value={p}>{p}</option>)}</select></label>
      <label className="small">Owner <select aria-label="Owner" value={i.assigneeId ?? ''} onChange={(e) => edit({ assignee: e.target.value || null }, `Owner von ${i.key} ändern?`)}><option value="">— niemand —</option>{m.people.map((p: any) => <option key={p.accountId} value={p.accountId}>{p.name}</option>)}</select></label>
      <label className="small">Ziel <select aria-label="Ziel zuordnen" value="" onChange={(e) => e.target.value && edit({ goal: e.target.value }, `${i.key} dem Ziel ${e.target.value} zuordnen (Werkbank)?`)}><option value="">{i.localGoal === 'KEINS' ? 'bewusst ohne' : i.localGoal || (i.labels ?? []).filter((l: string) => l.toLowerCase().startsWith(m.goalPrefix)).join(', ') || 'ohne Ziel'} → …</option>{m.goalIds.map((g: any) => <option key={g.id} value={g.id}>{g.id} · {String(g.result).slice(0, 40)}</option>)}</select></label>
      <Err e={err} />
    </div>
  );
}

export function Detail({ k, onClose, onChanged, site, forge, onOpenKey }: { k: string; onClose: () => void; onChanged: () => void; site: string; forge?: boolean; onOpenKey: (k: string) => void }) {
  const d = useLoad(() => api('/api/board/issue/' + k), [k]);
  // Jira-Änderung an genau diesem Ticket (z. B. aus einem Chat) → Details still nachladen.
  useJiraLive((e) => { if (e.all || e.keys.includes(k)) api('/api/board/issue/' + k).then(d.setData).catch(() => {}); });
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
    try { const r: any = await api(`/api/board/issue/${k}/${kind}`, { body: { ...payload, confirm: true } }); toast(r.dryRun ? 'Trockenlauf: nichts geschrieben (siehe Vorschau-Protokoll)' : 'In Jira geschrieben'); await d.reload(); onChanged(); return true; }
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
          <div className="row small"><Since i={i} /><Blocked i={i} /></div>
          {i.links?.length > 0 && <ul className="small" data-testid="detail-links">{i.links.map((l: any) => <li key={l.type + l.key}>{l.label} <button className="sublink" onClick={() => onOpenKey(l.key)}><b>{l.key}</b></button> {l.summary} {l.status && <span className={`chip tiny-chip ${l.done ? 'ok' : l.blocks === 'blocked-by' ? 'bad' : ''}`}>{l.status}</span>}</li>)}</ul>}
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

          <h3>Aktionen <span className="tiny">(je mit Bestätigung — geschrieben über den Atlassian-MCP, schneller Weg ohne Modell)</span></h3>
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
          <EditFields i={i} onDone={async () => { await d.reload(); onChanged(); }} />
          <ChatAgents issueKey={k} runs={(d.data as any).runs} onChange={d.reload} />
          <AgentPanel issueKey={k} runs={(d.data as any).runs} onChange={() => d.reload()} />
          <ForgePanel issueKey={k} enabled={!!forge} onStarted={() => d.reload()} />
          <p className="tiny" style={{ marginTop: 12 }}>Neue Tickets legt die Werkbank bewusst nicht an (olaf-jira: nur auf ausdrücklichen Auftrag, mit Duplikatsuche und Workstream) — dafür den Chat nutzen.</p>
        </>
      )}
    </div>
  );
}


/** „Verschieben nach …“ — Tastatur-/Mobil-Alternative zum Ziehen. */
function MoveMenu({ i, lanes, ts, onMove, onClose }: { i: any; lanes: any[]; ts: Transition[] | null; onMove: (lane: string, status: string) => void; onClose: () => void }) {
  const [status, setStatus] = useState(i.status);
  const [lane, setLane] = useState(i.workstream ?? '—');
  const wsLanes = lanes.filter((l) => l.workstream);
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={`${i.key} verschieben`} onClick={(e) => e.stopPropagation()}>
        <h3>{i.key} verschieben nach …</h3>
        <label className="small">Status</label>
        {ts === null ? <p className="tiny">Lade Übergänge aus Jira …</p> : (
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Neuer Status">
            <option value={i.status}>{i.status} (bleibt)</option>
            {ts.map((t) => <option key={t.id} value={t.to}>→ {t.to}</option>)}
          </select>
        )}
        <label className="small" style={{ marginTop: 8 }}>Workstream</label>
        {i.type === 'Sub-task' ? <p className="tiny">Sub-tasks bleiben an ihrem Task.</p> : (
          <select value={lane} onChange={(e) => setLane(e.target.value)} aria-label="Neuer Workstream">
            {(i.workstream ?? '—') === '—' && <option value="—">Ohne Workstream (bleibt)</option>}
            {wsLanes.map((l) => <option key={l.key} value={l.key}>{l.name}{l.key === i.workstream ? ' (bleibt)' : ''}</option>)}
          </select>
        )}
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn primary" disabled={status === i.status && lane === (i.workstream ?? '—')} onClick={() => { onMove(lane, status); onClose(); }}>Verschieben</button>
        </div>
      </div>
    </div>
  );
}

/** Kompakter Bestätigungs-Toast nach dem Ziehen: bestätigen / rückgängig / nicht mehr fragen. */
function MoveToast({ text, dry, onConfirm, onUndo, busy }: { text: string; dry: boolean; onConfirm: (noAsk: boolean) => void; onUndo: () => void; busy: boolean }) {
  const [noAsk, setNoAsk] = useState(false);
  return (
    <div className="movetoast" role="alertdialog" aria-label="Verschieben bestätigen" data-testid="move-toast">
      <span className="small"><b>{text}</b>{dry ? ' · Trockenlauf' : ''}</span>
      <button className="btn small primary" disabled={busy} autoFocus onClick={() => onConfirm(noAsk)}>{busy ? 'schreibe …' : 'bestätigen'}</button>
      <button className="btn small" disabled={busy} onClick={onUndo}>rückgängig</button>
      <label className="tiny row" style={{ gap: 4 }}><input type="checkbox" checked={noAsk} onChange={(e) => setNoAsk(e.target.checked)} /> nicht mehr fragen</label>
    </div>
  );
}

export function Board({ cfg, hash }: { cfg: Config; hash: string }) {
  const params = new URLSearchParams(hash.split('?')[1] ?? '');
  const [owner, setOwner] = useState(params.get('owner') ?? '');
  const [filter, setFilter] = useState(params.get('filter') ?? '');
  const [q, setQ] = useState('');
  const [done, setDone] = useState(false);
  const [sprint, setSprint] = useState(params.get('sprint') === '1');
  const [open, setOpen] = useState<string | null>(params.get('key'));
  const hashKey = params.get('key');
  useEffect(() => { if (hashKey) setOpen(hashKey); }, [hashKey]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [allOpen, setAllOpen] = useState(false);
  const toggle = (k: string) => setExpanded((x) => { const n = new Set(x); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const boardUrl = `/api/board?owner=${encodeURIComponent(owner)}&filter=${filter}&q=${encodeURIComponent(q)}&done=${done ? 1 : 0}&sprint=${sprint ? 1 : 0}`;
  const b = useLoad(() => api(boardUrl), [owner, filter, q, done, sprint]);
  const data: any = b.data;
  // Live: jede Jira-Änderung (Board, Sprint, Chat, Abgleich) lädt das Board still nach; geänderte Karten leuchten kurz auf.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlRef = useRef(boardUrl);
  urlRef.current = boardUrl;
  useJiraLive((e) => {
    if (pending || moving) return;   // nicht die optimistisch verschobene Karte überschreiben
    if (liveTimer.current) clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => {
      api(urlRef.current).then((x) => { b.setData(x); if (e.keys.length) { setFresh(new Set(e.keys)); setTimeout(() => setFresh(new Set()), 2500); } }).catch(() => {});
    }, 200);
  });
  // ---------- Ziehen / Verschieben ----------
  const prefs = useLoad(() => api('/api/prefs'), []);
  const confirmMove = (prefs.data as any)?.confirmMove ?? true;
  const tsCache = useRef(new Map<string, Transition[]>());
  const [drag, setDrag] = useState<any>(null);
  const [dragTs, setDragTs] = useState<Transition[] | null>(null);
  const [menuFor, setMenuFor] = useState<any>(null);
  const [pending, setPending] = useState<{ i: any; prev: any; lane: string; status: string; text: string } | null>(null);
  const [moving, setMoving] = useState(false);
  const loadTs = async (k: string) => {
    if (tsCache.current.has(k)) return tsCache.current.get(k)!;
    const r: any = await api(`/api/board/issue/${k}/transitions`);
    tsCache.current.set(k, r.transitions);
    return r.transitions as Transition[];
  };
  const isWs = (k: string) => !!data?.lanes.find((l: any) => l.key === k)?.workstream;
  const laneName = (k: string) => data?.lanes.find((l: any) => l.key === k)?.name ?? k;
  const commit = async (p: NonNullable<typeof pending>) => {
    setMoving(true); setErr(null);
    try {
      const r: any = await api(`/api/board/issue/${p.i.key}/move`, { body: { status: p.status, lane: p.lane, confirm: true } });
      tsCache.current.delete(p.i.key);
      if (r.dryRun) { b.setData(p.prev); toast(`Trockenlauf: würde schreiben — ${r.done.join(' · ')}`); }
      else { toast(`In Jira: ${p.text}`); api(urlRef.current).then(b.setData).catch(() => {}); }
    } catch (e) { b.setData(p.prev); setErr(e); }   // Jira lehnt ab → Karte springt zurück
    finally { setMoving(false); setPending(null); }
  };
  const doMove = async (i: any, lane: string, status: string) => {
    setErr(null);
    let ts: Transition[] | null = null;
    try { ts = status !== i.status ? await loadTs(i.key) : []; } catch (e) { setErr(e); return; }
    const r = moveActions(i, { status, lane }, ts, isWs);
    if ('error' in r) { setErr(new Error(r.error)); return; }
    if (!r.actions.length) return;
    const prev = data;
    b.setData(moveCard(data, i.key, lane, status));
    const p = { i, prev, lane, status, text: describeMove(i, r.actions, laneName) };
    if (confirmMove) setPending(p); else commit(p);
  };
  const mover: Mover = {
    start: (i) => { if (busy) { setErr(new Error('Erst die offene Verschiebung bestätigen oder rückgängig machen.')); return; } setDrag(i); setDragTs(tsCache.current.get(i.key) ?? null); loadTs(i.key).then((t) => setDragTs(t)).catch(() => setDragTs([])); },
    end: () => { setDrag(null); setDragTs(null); },
    menu: (i) => { if (busy) { setErr(new Error('Erst die offene Verschiebung bestätigen oder rückgängig machen.')); return; } setMenuFor(i); setDragTs(null); loadTs(i.key).then(setDragTs).catch((e) => { setErr(e); setDragTs([]); }); },
  };
  const busy = !!pending || moving;   // ein offener Toast / laufendes Schreiben: erst bestätigen oder rückgängig
  const dropOk = (lane: string, status: string) => {
    if (!drag || busy) return false;
    if (!laneAllowed(drag, lane, isWs)) return false;
    if (status === drag.status) return true;
    return !!dragTs && allowedStatuses(drag.status, dragTs).has(status);
  };

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
          {data?.sync && <span className="tiny">Voll {fmtDateTime(data.sync.at)} · {data.sync.count} Tickets · {data.sync.source}{data.sync.incAt ? ` · zuletzt nachgezogen ${fmtDateTime(data.sync.incAt)}` : ''}</span>}
        </div>
      </div>
      {data?.sync?.error && <div className="err" role="alert" data-testid="sync-error"><b>Jira-Abgleich gestört{data.sync.errorKind ? ` (${data.sync.errorKind})` : ''}:</b> {data.sync.error} <span className="tiny">seit {fmtDateTime(data.sync.errorAt)}</span>
        {data.sync.errorKind === 'löschschutz' && <button className="btn small danger" style={{ marginLeft: 8 }} onClick={async () => {
          if (!(await confirm({ title: 'Trotzdem abgleichen und löschen?', danger: true, confirmLabel: 'Abgleichen, Löschen erlauben', body: <p className="small">Nur wenn Jira wirklich weniger Tickets hat (z. B. nach dem Verschieben in ein anderes Projekt). Was Jira nicht mehr liefert, fällt aus der Kopie. Vollständiges Blättern bleibt Pflicht.</p> }))) return;
          setSyncing(true); setErr(null);
          try { const r: any = await api('/api/board/sync', { body: { force: true, confirm: true } }); toast(`${r.count} Tickets, ${r.removed} entfernt`); await b.reload(); } catch (e) { setErr(e); } finally { setSyncing(false); }
        }}>Trotzdem abgleichen …</button>}</div>}
      <Err e={err} />
      <HygienePanel onChange={() => b.reload()} />
      <div className="board-bar">
        <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner">
          <option value="">Alle Owner</option>
          {data?.owners.map((o: string) => <option key={o} value={o}>{o}{data.hygiene.perOwner[o] ? ` · 🧹 ${data.hygiene.perOwner[o]}` : ''}</option>)}
        </select>
        <div className="row" role="group" aria-label="Filter">
          {[['', 'Alle'], ['overdue', `Überfällig${data ? ` (${data.totals.overdue})` : ''}`], ['undated', `Ohne Datum${data ? ` (${data.totals.undated})` : ''}`], ['pflege', `Braucht Pflege${data ? ` (${data.hygiene.total})` : ''}`], ['ohneziel', `Ohne Ziel${data ? ` (${data.totals.noGoal})` : ''}`]].map(([v, l]) => (
            <button key={v} className={`btn small ${filter === v ? 'primary' : ''}`} onClick={() => setFilter(v)}>{l}</button>
          ))}
        </div>
        {data?.sprint && <button className={`btn small ${sprint ? 'primary' : ''}`} onClick={() => setSprint(!sprint)} title="Nur Tickets im aktuellen Sprint (Werkbank-Zuordnung)" aria-pressed={sprint}>🎯 nur aktueller Sprint ({data.sprint.count})</button>}
        <input type="search" placeholder="Suchen (Key, Titel, Owner)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tickets suchen" />
        <label className="row small"><input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} /> ältere erledigte zeigen</label>
        <label className="row small" title="Beim Ziehen einer Karte erst bestätigen (Einstellung je Person)"><input type="checkbox" checked={confirmMove} onChange={async (e) => { await api('/api/prefs', { body: { confirmMove: e.target.checked } }); prefs.reload(); }} /> Verschieben bestätigen</label>
        <label className="row small"><input type="checkbox" checked={allOpen} onChange={(e) => { setAllOpen(e.target.checked); setExpanded(new Set()); }} /> Sub-tasks aufklappen</label>
        {data && <span className="tiny">{data.totals.cards} Karten · {data.totals.subtasks} Sub-tasks{data.totals.broken ? <> · <span className="chip bad">⚠ {data.totals.broken} kaputt</span></> : null}{data.totals.orphans ? <> · <span className="chip bad" title="Tickets ohne Parent (kein Workstream)">⚠ {data.totals.orphans} ohne Parent</span></> : null}</span>}
      </div>
      {b.error && <Err e={b.error} />}
      {!data ? <Loading /> : data.lanes.length === 0 ? (
        <div className="card soft"><p>Keine Tickets in der Kopie{filter || owner || q ? ' für diesen Filter' : ''}.</p>{!data.sync && <p className="small">Noch nie synchronisiert — oben auf „Jetzt synchronisieren“ klicken (braucht deinen Jira-Zugang aus der Einrichtung).</p>}</div>
      ) : data.lanes.map((lane: any) => (
        <section className="lane" key={lane.key}>
          <h3 className="lane-head">
            {lane.workstream ? <button className="sublink" onClick={() => setOpen(lane.key)} title="Workstream öffnen"><b>{lane.name}</b></button> : lane.name} <span className="chip">{lane.count}</span>
            {lane.hygiene > 0 && <span className="badge-hyg" title="Karten, die Pflege brauchen">🧹 {lane.hygiene}</span>}
            {lane.head && <>
              <span className="tiny">{lane.key}</span>
              <StateChip state={lane.head.status} />
              <span className={`chip ${lane.head.owner ? '' : 'warn'}`}>{lane.head.owner ?? 'ohne Owner'}</span>
              {lane.head.duedate ? <span className={`chip ${lane.head.overdue ? 'bad' : ''}`}>{lane.head.overdue ? 'über ' : 'bis '}{fmtDate(lane.head.duedate)}</span> : <span className="chip">ohne Datum</span>}
            </>}
            {lane.key === '—' && <span className="tiny">Tickets ohne Parent — in Jira einem Workstream zuordnen</span>}
          </h3>
          {lane.count === 0 && <p className="tiny" style={{ margin: '2px 0 4px' }}>Keine sichtbaren Tickets in diesem Workstream{lane.workstream ? ' — Tasks lassen sich hierher ziehen.' : '.'}</p>}
          {(lane.count > 0 || (drag && lane.workstream)) &&
          <div className="cols" style={{ gridTemplateColumns: `repeat(${data.statuses.length}, minmax(180px, 1fr))` }}>
            {data.statuses.map((s: string) => (
              <div key={s}>
                <div className="colhead">{s} · {lane.columns[s].length}</div>
                <div className={`col-cards ${drag ? (dropOk(lane.key, s) ? 'drop-ok' : 'drop-no') : ''}`} data-drop={`${lane.key}|${s}`}
                  onDragOver={(e) => { if (dropOk(lane.key, s)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
                  onDrop={(e) => { e.preventDefault(); const i = drag; mover.end(); if (i && dropOk(lane.key, s)) doMove(i, lane.key, s); }}>
                  {lane.columns[s].map((i: any) => <Card key={i.key} i={i} fresh={fresh.has(i.key)} onOpen={setOpen} expanded={allOpen !== expanded.has(i.key)} onToggle={() => toggle(i.key)} mover={mover} />)}
                </div>
              </div>
            ))}
          </div>}
        </section>
      ))}
      {menuFor && <MoveMenu i={menuFor} lanes={data?.lanes ?? []} ts={dragTs} onClose={() => setMenuFor(null)} onMove={(lane, status) => doMove(menuFor, lane, status)} />}
      {pending && <MoveToast text={pending.text} dry={!!data?.dryRun} busy={moving} onUndo={() => { b.setData(pending.prev); setPending(null); }}
        onConfirm={async (noAsk) => { if (noAsk) { await api('/api/prefs', { body: { confirmMove: false } }).catch(() => {}); prefs.reload(); } commit(pending); }} />}
      {open && <Detail k={open} onOpenKey={setOpen} site={data?.site ?? cfg.jiraSite} forge={cfg.forge} onClose={() => { setOpen(null); b.reload(); }} onChanged={() => b.reload()} />}
    </div>
  );
}
