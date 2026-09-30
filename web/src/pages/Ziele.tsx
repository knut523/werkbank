// Ziele (Runde 6): Zielbaum als Übersicht, Deep-Dive je Ziel (#/ziele/KR1 — teilbar) und Zuordnung „ohne Ziel“.
import { useMemo, useState } from 'react';
import { api, fmtDate, type Config } from '../api.ts';
import { Err, Loading, useLoad, useConfirm, useToast, useJiraLive } from '../ui.tsx';
import { Gap, Bar, GoalNodeView } from './Sprint.tsx';

const note = (p: string) => '#/wissen/' + p.split('/').map(encodeURIComponent).join('/');
const FIELDS: [string, string][] = [['metric', 'Messgröße'], ['baseline', 'Baseline'], ['target', 'Ziel'], ['due', 'Stichtag'], ['owner', 'Owner'], ['evidence', 'Beleg']];
const daysSince = (s?: string | null) => (s ? Math.max(0, Math.floor((Date.now() - new Date(s).getTime()) / 864e5)) : null);

function TicketLine({ t }: { t: any }) {
  const d = daysSince(t.statusSince);
  return (
    <li className="trow" data-ticket={t.key}>
      <a href={`#/board?key=${t.key}`}><b>{t.key}</b></a> <span className="trow-s">{t.summary}</span>
      <span className="row" style={{ gap: 3 }}>
        {t.via && <span className="chip tiny-chip goal-id" title="zugeordnet über">{t.via}</span>}
        <span className={`chip tiny-chip ${t.assignee ? '' : 'warn'}`}>{t.assignee ?? 'ohne Owner'}</span>
        {t.duedate ? <span className={`chip tiny-chip ${t.overdue ? 'bad' : ''}`}>{t.overdue ? 'über ' : ''}{fmtDate(t.duedate)}</span> : !t.recurring && t.status !== 'Done' && <span className="chip tiny-chip warn">ohne Datum</span>}
        {t.blockedBy?.length > 0 && <span className="chip tiny-chip bad">⛔ {t.blockedBy.join(', ')}</span>}
        {d !== null && t.status !== 'Done' && <span className="chip tiny-chip">seit {d} T. {t.status}</span>}
        <span className="tiny">{t.workstreamName}</span>
      </span>
    </li>
  );
}

function Detail({ id }: { id: string }) {
  const d = useLoad(() => api(`/api/goals/${encodeURIComponent(id)}`), [id]);
  useJiraLive(() => { api(`/api/goals/${encodeURIComponent(id)}`).then(d.setData).catch(() => {}); }, 'both');
  const x: any = d.data;
  if (!x) return d.error ? <Err e={d.error} /> : <Loading />;
  const g = x.goal;
  const byStatus = new Map<string, any[]>();
  for (const t of x.tickets) byStatus.set(t.status, [...(byStatus.get(t.status) ?? []), t]);
  const order = ['In Progress', 'To Do', 'Backlog', 'Ongoing', 'Done'];
  const statuses = [...byStatus.keys()].sort((a, b) => (order.indexOf(a) + 99) % 99 - (order.indexOf(b) + 99) % 99);
  const risk = x.risks;
  return (
    <div data-testid="goal-detail">
      <div className="row small" style={{ marginBottom: 6 }}>
        <a href="#/ziele">Zielbaum</a>{x.parent && <> › <a href={`#/ziele/${x.parent.id}`}>{x.parent.id}</a></>} › <b>{g.id}</b>
        <button className="btn ghost small" onClick={() => { try { navigator.clipboard.writeText(window.location.href); } catch { /* egal */ } }} title="Link auf dieses Ziel kopieren">🔗 Link</button>
      </div>
      <div className="card">
        <div className="row" style={{ alignItems: 'baseline', gap: 8 }}>
          <span className="chip goal-id">{g.id}</span><span className="tiny">{g.level}</span>
          <h2 style={{ margin: 0, flex: 1 }}><Gap text={g.result} /></h2>
          {g.rating && <span className="rating" title={g.rating.date}>{g.rating.rating}</span>}
        </div>
        <table className="t small" style={{ marginTop: 8 }}><tbody>
          {FIELDS.map(([k, l]) => <tr key={k}><th style={{ width: 120 }}>{l}</th><td><Gap text={g[k]} /></td></tr>)}
          <tr><th>Fortschritt</th><td><Bar p={x.progress} /> <span className="tiny">erledigte / zugeordnete Tickets (direkt und über Kindziele)</span></td></tr>
        </tbody></table>
        {g.gaps?.length > 0 && <p className="tiny">{g.gaps.length} Lücke{g.gaps.length === 1 ? '' : 'n'} (grau) — zählen nicht als Wert. Quelle: <a href={note(x.file)}>{x.file.split('/').pop()}</a></p>}
      </div>
      <div className="grid2" style={{ marginTop: 10 }}>
        <div className="card"><b>Risiken</b>
          <ul className="small">
            <li>überfällig: <b>{risk.overdue.length}</b> {risk.overdue.join(', ')}</li>
            <li>blockiert: <b>{risk.blocked.length}</b> {risk.blocked.join(', ')}</li>
            <li>ohne Owner: <b>{risk.noOwner.length}</b> {risk.noOwner.join(', ')}</li>
            <li>ohne Datum: <b>{risk.noDate.length}</b> {risk.noDate.join(', ')}</li>
          </ul>
        </div>
        <div className="card"><b>Tickets je Workstream</b>
          <table className="t small"><tbody>{x.perWorkstream.map((w: any) => <tr key={w.key}><td>{w.name}</td><td><Bar p={w} /></td></tr>)}</tbody></table>
          {!x.perWorkstream.length && <p className="tiny">Noch keine Tickets zugeordnet (Ziele → „Ziele zuordnen“).</p>}
        </div>
      </div>
      <div className="card" style={{ marginTop: 10 }}><b>Bewertungsverlauf</b> <span className="tiny">aus „## Bewertung“</span>
        {x.history.length ? <table className="t small"><thead><tr><th>Datum</th><th>Ist</th><th></th><th>Beleg</th><th>Warum / was ändern wir</th></tr></thead>
          <tbody>{x.history.map((h: any) => <tr key={h.line}><td>{h.date}</td><td><Gap text={h.actual} /></td><td className="rating">{h.rating ?? '—'}</td><td><Gap text={h.evidence} /></td><td><Gap text={h.why} /></td></tr>)}</tbody></table>
          : <p className="tiny">Noch keine Bewertung.</p>}
      </div>
      {x.children.length > 0 && <div className="card" style={{ marginTop: 10 }}><b>Kindziele</b>
        <ul className="tlist">{x.children.map((c: any) => <li key={c.id} className="trow"><a className="chip goal-id" href={`#/ziele/${c.id}`}>{c.id}</a> <span className="tiny">{c.level}</span> <span className="trow-s"><Gap text={c.result} /></span>{c.rating && <span className="rating">{c.rating.rating}</span>}<Bar p={c.subtree} /></li>)}</ul>
      </div>}
      <div className="card" style={{ marginTop: 10 }}><b>Tickets ({x.tickets.length})</b>
        {statuses.map((st) => <div key={st}><div className="small docs-h">{st} · {byStatus.get(st)!.length}</div><ul className="tlist">{byStatus.get(st)!.map((t: any) => <TicketLine key={t.key} t={t} />)}</ul></div>)}
        {!x.tickets.length && <p className="tiny">Keine Tickets — über „Ziele zuordnen“.</p>}
      </div>
      <div className="card" style={{ marginTop: 10 }}><b>Specs und PRs ({x.specs.length})</b>
        <ul className="tlist">{x.specs.map((sp: any) => <li key={sp.path} className="trow"><a href={note(sp.path)}>{sp.title}</a> <span className="tiny">{sp.topic} · {sp.state.replace(/^\d-/, '')} · über {sp.via}</span>
          <span className="row" style={{ gap: 3 }}>{sp.prs.map((p: any) => <a key={p.pr} href={p.url} target="_blank" rel="noreferrer" className={`chip tiny-chip ${p.live?.conflict ? 'bad' : p.live?.review === 'APPROVED' ? 'ok' : p.live ? 'warn' : ''}`}>{p.pr.replace('olaf-', '')}{p.live ? (p.live.conflict ? ' ⚠ Konflikt' : ` · ${p.live.turn}`) : ' · zu'}</a>)}</span></li>)}</ul>
        {!x.specs.length && <p className="tiny">Keine Spec diesem Ziel zugeordnet (Werkbank, Frontmatter <code>ziel:</code> oder über Tickets).</p>}
      </div>
    </div>
  );
}

function Assign() {
  const d = useLoad(() => api('/api/goals/assign'));
  const x: any = d.data;
  const confirm = useConfirm();
  const toast = useToast();
  const [err, setErr] = useState<unknown>(null);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [goal, setGoal] = useState<Record<string, string>>({});
  const [why, setWhy] = useState<Record<string, string>>({});
  const [bulk, setBulk] = useState('');
  const [q, setQ] = useState('');
  // Vorschläge aus der Datei vorausgewählt
  const init = useMemo(() => { if (!x) return null; const g: Record<string, string> = {}, s: Record<string, boolean> = {}, w: Record<string, string> = {}; for (const t of x.tickets) if (t.proposal) { g[t.key] = t.proposal.ziel; s[t.key] = true; if (t.proposal.ziel === 'KEINS') w[t.key] = t.proposal.begruendung; } return { g, s, w }; }, [x]);
  if (!x) return d.error ? <Err e={d.error} /> : <Loading />;
  const G = { ...(init?.g ?? {}), ...goal }, S = { ...(init?.s ?? {}), ...sel }, W = { ...(init?.w ?? {}), ...why };
  const list = x.tickets.filter((t: any) => !q || `${t.key} ${t.summary} ${t.assignee ?? ''} ${t.workstreamName}`.toLowerCase().includes(q.toLowerCase()));
  const chosen = list.filter((t: any) => S[t.key] && G[t.key]);
  const importProp = async (body: any, title: string) => {
    setErr(null);
    try {
      const pre: any = await api('/api/goals/import', { body });
      if (!pre.items.length) { toast('Nichts zu übernehmen'); return; }
      if (!(await confirm({ title, confirmLabel: `${pre.items.length} übernehmen`, body: <><p className="small">Aus <code>{pre.file}</code>, gespeichert in der Werkbank (nicht Jira):</p><pre className="small" style={{ maxHeight: 280, overflow: 'auto' }}>{pre.items.map((i: any) => `${i.key} → ${i.goal}${i.begruendung ? ` — ${i.begruendung}` : ''}`).join('\n')}</pre></> }))) return;
      const r: any = await api('/api/goals/import', { body: { ...body, confirm: true } });
      toast(`${r.imported} übernommen`); setSel({}); setGoal({}); setWhy({}); d.reload();
    } catch (e) { setErr(e); }
  };
  const run = async () => {
    setErr(null);
    const items = chosen.map((t: any) => ({ key: t.key, goal: G[t.key], begruendung: W[t.key] }));
    try {
      const pre: any = await api('/api/goals/assign', { body: { items } });
      if (!(await confirm({ title: `${items.length} Tickets Zielen zuordnen?`, confirmLabel: 'In der Werkbank speichern', body: <><p className="small">Die Zuordnung wird <b>in der Werkbank</b> gespeichert (mit Verlauf), nicht in Jira{pre.toJira ? ' — zusätzlich Jira-Labels (WERKBANK_GOALS_TO_JIRA=labels)' : ''}:</p><pre className="small" style={{ maxHeight: 280, overflow: 'auto' }}>{pre.preview.join('\n')}</pre></> }))) return;
      const r: any = await api('/api/goals/assign', { body: { items, confirm: true } });
      const bad = r.results.filter((y: any) => !y.ok);
      toast(`${r.results.length - bad.length} zugeordnet (Werkbank)${bad.length ? `, ${bad.length} Fehler` : ''}`);
      if (bad.length) setErr(new Error(bad.map((y: any) => `${y.key}: ${y.error}`).join(' · ')));
      setSel({}); setGoal({}); setWhy({}); d.reload();
    } catch (e) { setErr(e); }
  };
  return (
    <>
      <p className="small muted">Offene Tickets ohne Ziel (Werkbank-Zuordnung oder Jira-Label, auch nicht vom Parent geerbt). Gespeichert wird <b>in der Werkbank</b>, nicht in Jira. „Bewusst ohne Ziel“ nur mit Begründung. {x.proposals > 0 ? <>Vorausgewählt: <b>{x.proposals}</b> Vorschläge aus <code>{x.proposalFile}</code>.</> : <>Keine Vorschlagsdatei unter <code>{x.proposalFile}</code>.</>}{x.proposalError && <span className="chip bad">{x.proposalError}</span>}</p>
      <div className="row" style={{ marginBottom: 8 }}>
        <input type="search" placeholder="Suchen …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tickets filtern" />
        <select value={bulk} onChange={(e) => setBulk(e.target.value)} aria-label="Ziel für Auswahl"><option value="">Ziel für alle gewählten …</option>{x.goalIds.map((g: any) => <option key={g.id} value={g.id}>{g.id} · {String(g.result).slice(0, 50)}</option>)}</select>
        <button className="btn small" disabled={!bulk} onClick={() => { const n = { ...goal }; for (const t of list) if (S[t.key]) n[t.key] = bulk; setGoal(n); }}>übernehmen</button>
        <button className="btn small" onClick={() => { const n: Record<string, boolean> = {}; for (const t of list) n[t.key] = true; setSel(n); }}>alle wählen</button>
        <button className="btn primary" disabled={!chosen.length} onClick={run}>Zuordnen ({chosen.length})</button>
        {x.proposals > 0 && <button className="btn" data-testid="import-high" onClick={() => importProp({ mode: 'hoch' }, 'Vorschlag übernehmen (alle mit Sicherheit hoch)?')}>Vorschlag übernehmen (alle mit Sicherheit hoch)</button>}
      </div>
      <Err e={err} />
      <table className="t small" data-testid="assign-table">
        <thead><tr><th></th><th>Ticket</th><th>Workstream</th><th>Owner · Status</th><th>Ziel</th><th>Vorschlag</th></tr></thead>
        <tbody>{list.map((t: any) => (
          <tr key={t.key} data-ticket={t.key} className={t.proposal ? 'proposed' : ''}>
            <td><input type="checkbox" aria-label={`${t.key} wählen`} checked={!!S[t.key]} onChange={(e) => setSel({ ...S, [t.key]: e.target.checked })} /></td>
            <td><a href={`#/board?key=${t.key}`}><b>{t.key}</b></a> {t.summary}{t.type === 'Sub-task' && <span className="tiny"> · Sub-task</span>}</td>
            <td className="tiny">{t.workstreamName}</td>
            <td className="tiny">{t.assignee ?? 'ohne Owner'} · {t.status}</td>
            <td>
              <select value={G[t.key] ?? ''} aria-label={`Ziel für ${t.key}`} onChange={(e) => { setGoal({ ...G, [t.key]: e.target.value }); setSel({ ...S, [t.key]: !!e.target.value }); }}>
                <option value="">— wählen —</option>
                {x.goalIds.map((g: any) => <option key={g.id} value={g.id}>{g.id} · {String(g.result).slice(0, 40)}</option>)}
                <option value="KEINS">bewusst ohne Ziel ({x.labels.exempt})</option>
              </select>
              {G[t.key] === 'KEINS' && <input placeholder="Begründung (Kommentar)" value={W[t.key] ?? ''} onChange={(e) => setWhy({ ...W, [t.key]: e.target.value })} aria-label={`Begründung ${t.key}`} style={{ marginTop: 4, width: '100%' }} />}
            </td>
            <td className="tiny">{t.proposal ? <><button className="btn ghost small" title="diesen Vorschlag einzeln übernehmen" onClick={() => importProp({ mode: 'keys', keys: [t.key] }, `Vorschlag für ${t.key} übernehmen?`)}>übernehmen</button> <b>{t.proposal.ziel}</b>{t.proposal.sicherheit != null && ` · ${typeof t.proposal.sicherheit === 'number' ? `${Math.round(t.proposal.sicherheit <= 1 ? t.proposal.sicherheit * 100 : t.proposal.sicherheit)} %` : `Sicherheit ${t.proposal.sicherheit}`}`}<div>{t.proposal.begruendung}</div></> : '—'}</td>
          </tr>
        ))}</tbody>
      </table>
      {!list.length && <p className="okbox small">Alle offenen Tickets haben ein Ziel.</p>}
    </>
  );
}

export function Ziele({ hash }: { cfg: Config; hash: string }) {
  const sub = decodeURIComponent(hash.match(/^#\/ziele\/([^?]+)/)?.[1] ?? '');
  const tree = useLoad(() => api('/api/goals'), []);
  const t: any = tree.data;
  return (
    <div className="page wide">
      <div className="head">
        <div>
          <h1>Ziele</h1>
          <p className="muted" style={{ margin: 0 }}>Gate → Ziel → KR → Monat → Sprint → Tickets, aus <code>{t?.file ?? 'ziele-olaf.md'}</code>. Klick auf ein Ziel = Deep-Dive (eigene URL).</p>
        </div>
        {t && <a className={`btn ${t.noGoal ? 'danger' : ''}`} href="#/ziele/zuordnen" data-testid="nogoal-count">{t.noGoal} Tickets ohne Ziel</a>}
      </div>
      <div className="tabs" role="tablist">
        <a role="tab" className={!sub ? 'active' : ''} href="#/ziele">Zielbaum</a>
        <a role="tab" className={sub === 'zuordnen' ? 'active' : ''} href="#/ziele/zuordnen">Ziele zuordnen{t ? ` (${t.noGoal})` : ''}</a>
        {sub && sub !== 'zuordnen' && <a role="tab" className="active" href={`#/ziele/${sub}`}>{sub.toUpperCase()}</a>}
      </div>
      {tree.error && <Err e={tree.error} />}
      {sub === 'zuordnen' ? <Assign /> : sub ? <Detail id={sub} /> : !t ? <Loading /> : t.missing
        ? <div className="card soft"><b>Stage Gate nicht definiert</b><p className="small muted">Die Zieldatei fehlt.</p></div>
        : <div className="card"><ul className="goal-tree root">{t.roots.map((n: any) => <GoalNodeView key={n.id} n={n} />)}</ul></div>}
    </div>
  );
}
