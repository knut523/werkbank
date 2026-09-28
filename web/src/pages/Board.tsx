import { useEffect, useState, type ReactNode } from 'react';
import { api, fmtDate, fmtDateTime, today, chatTarget, type Config } from '../api.ts';
import { Err, Loading, useLoad, useConfirm, useToast, StateChip } from '../ui.tsx';
import { HygienePanel } from '../components.tsx';

const overdue = (i: any) => i.duedate && i.duedate < today() && i.status !== 'Done';

function Card({ i, onOpen }: { i: any; onOpen: () => void }) {
  return (
    <button className="tcard" onClick={onOpen} data-key={i.key}>
      <div className="k"><span>{i.key}{i.type === 'Sub-task' ? ' · Sub' : ''}</span><span>{i.priority && i.priority !== 'Medium' ? i.priority : ''}</span></div>
      <div className="s">{i.summary}</div>
      <div className="row" style={{ gap: 4 }}>
        <span className="chip">{i.assignee ?? 'ohne Owner'}</span>
        {i.duedate ? <span className={`chip ${overdue(i) ? 'bad' : ''}`}>{overdue(i) ? 'über ' : ''}{fmtDate(i.duedate)}</span> : i.status !== 'Done' && <span className="chip warn">ohne Datum</span>}
        {i.comments > 0 && <span className="chip">💬 {i.comments}</span>}
        {i.hygiene?.length > 0 && <span className="badge-hyg" title={i.hygiene.join(', ')}>🧹 {i.hygiene.length}</span>}
      </div>
    </button>
  );
}

function AgentPanel({ issueKey, runs, onChange }: { issueKey: string; runs: any[]; onChange: () => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [runId, setRunId] = useState<string | null>(runs[0]?._id ?? null);
  const [run, setRun] = useState<any>(runs[0] ?? null);
  const [draft, setDraft] = useState<string>(runs[0]?.draft ?? '');
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
    <div className="card soft" style={{ marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>🤖 Agent ansetzen</h3>
      <p className="small muted">Startet eine Claude-Code-Sitzung mit deinem eigenen Claude, das Ticket als Kontext, <b>nur lesend</b>. Das Ergebnis kommt als Kommentarentwurf hierher — nach Jira geht er erst nach deinem Klick.</p>
      <Err e={err} />
      {(!run || run.status !== 'läuft') && (
        <div className="col">
          <textarea rows={2} placeholder="Optional: worauf soll der Agent achten?" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Hinweis für den Agenten" />
          <div><button className="btn primary" onClick={async () => {
            setErr(null);
            try { const r: any = await api(`/api/board/issue/${issueKey}/agent`, { body: { note } }); setDraft(''); setRunId(r.id); toast('Agent gestartet'); } catch (e) { setErr(e); }
          }}>Agent starten</button></div>
        </div>
      )}
      {run && (
        <div style={{ marginTop: 10 }}>
          <div className="row small"><StateChip state={run.status} /> <span className="muted">gestartet {fmtDateTime(run.startedAt)} von {run.userName}</span>{run.sentAt && <span className="chip ok">gesendet {fmtDateTime(run.sentAt)}</span>}</div>
          {run.error && <div className="err small" style={{ marginTop: 6 }}>{run.error}</div>}
          <details open={run.status === 'läuft'} style={{ marginTop: 6 }}><summary className="small">Verlauf</summary><div className="run-log">{run.output || '…'}</div></details>
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
    </div>
  );
}

function Detail({ k, onClose, onChanged, site }: { k: string; onClose: () => void; onChanged: () => void; site: string }) {
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
          {(d.data as any).children.length > 0 && <><b className="small">Sub-tasks</b><ul className="small">{(d.data as any).children.map((c: any) => <li key={c.key}>{c.key} {c.summary} · <i>{c.status}</i> · {c.assignee ?? '—'}</li>)}</ul></>}
          <div className="row"><a className="btn" href={(d.data as any).chatUrl} target={chatTarget} rel="noreferrer">💬 Im Chat besprechen</a></div>
          <Err e={err} />

          <h3>Aktionen <span className="tiny">(je mit Bestätigung, unter deinem Jira-Konto)</span></h3>
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
          <AgentPanel issueKey={k} runs={(d.data as any).runs} onChange={() => d.reload()} />
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
        {data && <span className="tiny">{data.totals.cards} Karten</span>}
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
                <div className="col-cards">{lane.columns[s].map((i: any) => <Card key={i.key} i={i} onOpen={() => setOpen(i.key)} />)}</div>
              </div>
            ))}
          </div>
        </section>
      ))}
      {open && <Detail k={open} site={data?.site ?? cfg.jiraSite} onClose={() => setOpen(null)} onChanged={() => b.reload()} />}
    </div>
  );
}
