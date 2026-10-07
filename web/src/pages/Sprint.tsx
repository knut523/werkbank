import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, fmtDate, fmtDateTime, type Config } from '../api.ts';
import { Err, Loading, useLoad, useConfirm, useToast, useJiraLive } from '../ui.tsx';
import { HygienePanel } from '../components.tsx';

const noteHref = (p: string) => '#/wissen/' + p.split('/').map(encodeURIComponent).join('/');
const FILE_LABEL: Record<string, string> = { summary: 'Summary', review: 'Review', planning: 'Planning' };

function Md({ text }: { text: string }) {
  // Nur leichte Darstellung: **fett**, `code`, [Text](Link). Kein HTML aus der Notiz.
  const parts: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    parts.push(text.slice(last, m.index));
    if (m[1]) parts.push(<b key={m.index}>{m[1]}</b>);
    else if (m[2]) parts.push(<code key={m.index}>{m[2]}</code>);
    else parts.push(/^https?:/.test(m[4]) ? <a key={m.index} href={m[4]} target="_blank" rel="noreferrer">{m[3]}</a> : <span key={m.index}>{m[3]}</span>);
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}


// ---------- Ziele & Sprint (klassisch) ----------

/** Zelle mit Lücken „‹… fehlt – Quelle: …›“: Lücken grau/kursiv, zählen nicht als Wert. */
/** Hinweis „ohne Ziel – genauer anschauen“ (Board, Sprint, Mein Tag). */
export function NoGoal({ small = true }: { small?: boolean }) {
  return <a className={`chip ${small ? 'tiny-chip' : ''} bad nogoal`} href="#/ziele/zuordnen" title="Kein Ziel (Werkbank-Zuordnung oder Jira-Label), auch nicht vom Parent geerbt — einem Ziel zuordnen oder bewusst ohne Ziel (mit Grund)" onClick={(e) => e.stopPropagation()}>ohne Ziel – genauer anschauen</a>;
}

export function Gap({ text }: { text?: string | null }) {
  if (!text) return <span className="gap">—</span>;
  const parts = text.split(/(‹[^›]*›)/g).filter(Boolean);
  return <>{parts.map((p, i) => p.startsWith('‹') ? <span key={i} className="gap" title="Lücke — noch nicht festgelegt">{p}</span> : <Md key={i} text={p.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1')} />)}</>;
}

export function Bar({ p }: { p: { done: number; total: number } }) {
  if (!p?.total) return <span className="tiny">keine Tickets zugeordnet</span>;
  return <span className="progress" title={`${p.done} von ${p.total} Tickets erledigt`}><span className="subbar"><span style={{ width: `${Math.round((p.done / p.total) * 100)}%` }} /></span> <b>{p.done}/{p.total}</b></span>;
}

export function GoalNodeView({ n, depth = 0 }: { n: any; depth?: number }) {
  return (
    <li className={`goal lvl-${n.level}`} data-goal={n.id}>
      <div className="row" style={{ gap: 6, alignItems: 'baseline' }}>
        <a className="chip goal-id" href={`#/ziele/${n.id}`} title="Ziel im Detail">{n.id}</a><span className="tiny">{n.level}</span>
        <a href={`#/ziele/${n.id}`} className="goal-link" style={{ flex: 1, minWidth: 200 }}><Gap text={n.result} /></a>
        {n.rating && <span className="rating" title={`${n.rating.date}: ${n.rating.actual}`}>{n.rating.rating}</span>}
        <Bar p={n.subtree} />
      </div>
      <div className="tiny goal-meta">
        <span>Messgröße: <Gap text={n.metric} /></span> · <span>Baseline <Gap text={n.baseline} /> → Ziel <Gap text={n.target} /></span> · <span>Stichtag <Gap text={n.due} /></span> · <span>{n.owner || '—'}</span>
        {n.gaps?.length > 0 && <span className="chip warn tiny-chip" title={`Lücken: ${n.gaps.join(', ')}`}>{n.gaps.length} Lücke{n.gaps.length === 1 ? '' : 'n'}</span>}
        {n.orphan && <span className="chip bad tiny-chip">Eltern-ID {n.parent} unbekannt</span>}
        {n.source === 'planning' && <span className="chip tiny-chip">aus Planning</span>}
      </div>
      {n.children?.length > 0 && <ul className="goal-tree">{n.children.map((c: any) => <GoalNodeView key={c.id} n={c} depth={depth + 1} />)}</ul>}
    </li>
  );
}

function GoalTree({ g }: { g: any }) {
  if (g.missing) return <div className="card soft" data-testid="goal-tree"><b>Stage Gate nicht definiert</b><p className="small muted" style={{ margin: 0 }}>Die Zieldatei <code>{g.file}</code> fehlt. Format: Tabelle unter <code>## Ziele</code> mit ID | Ebene | Ergebnis | Messgröße | Baseline | Ziel | Stichtag | Owner | Eltern-ID | Beleg (siehe README).</p></div>;
  return (
    <details className="card" open data-testid="goal-tree">
      <summary><b>Zielbaum</b> <span className="tiny">Gate → Ziel → KR → Monat → Sprint · aus <a href={noteHref(g.file)}>{g.file.split('/').pop()}</a> · Fortschritt = erledigte / zugeordnete Tickets (Zuordnung in der Werkbank, sonst Jira-Label, oder in der Zeile genannt)</span></summary>
      {!g.gate.length && <p className="note small">Stage Gate nicht definiert (keine Zeile mit Ebene „Gate“).</p>}
      <ul className="goal-tree root">{g.roots.map((n: any) => <GoalNodeView key={n.id} n={n} />)}</ul>
      {!g.monthGoals.length && <p className="tiny">Monatsziele für diesen Sprint noch nicht gesetzt (Ebene „Monat“, ID M&lt;MM&gt;-&lt;n&gt;).</p>}
    </details>
  );
}

/** Sprint-Mitgliedschaft und Ziel werden in der Werkbank gespeichert (Runde 7), nicht als Jira-Label — mit Bestätigung. */
function useLocalChange(cycle: string, reload: () => void) {
  const confirm = useConfirm();
  const toast = useToast();
  const [err, setErr] = useState<unknown>(null);
  const run = async (url: string, body: any, title: string) => {
    setErr(null);
    try {
      const pre: any = await api(url, { body });
      const text = Array.isArray(pre.preview) ? pre.preview.join('\n') : pre.preview;
      if (!(await confirm({ title, confirmLabel: 'Speichern', body: <><pre className="small">{text}</pre><p className="tiny">Gespeichert in der Werkbank (mit Verlauf) — nichts wird nach Jira geschrieben.</p></> }))) return;
      await api(url, { body: { ...body, confirm: true } });
      toast('Gespeichert (Werkbank)');
      reload();
    } catch (e) { setErr(e); }
  };
  return {
    member: (key: string, inSprint: boolean) => run(`/api/sprint/${cycle}/member`, { key, in: inSprint }, inSprint ? `${key} in den Sprint nehmen?` : `${key} aus dem Sprint nehmen?`),
    goal: (key: string, id: string) => run('/api/goals/assign', { items: [{ key, goal: id }] }, id ? `${key} dem Ziel ${id} zuordnen?` : `Zielzuordnung von ${key} entfernen?`),
    err,
  };
}

function TicketRow({ t, children }: { t: any; children?: ReactNode }) {
  return (
    <li className="trow" data-ticket={t.key}>
      <a href={`#/board?key=${t.key}`}><b>{t.key}</b></a> <span className="trow-s">{t.summary}</span>
      <span className="row" style={{ gap: 3 }}>
        <span className={`chip tiny-chip ${t.status === 'Done' ? 'ok' : ''}`}>{t.status}</span>
        <span className="chip tiny-chip">{t.assignee ?? 'ohne Owner'}</span>
        {t.duedate && <span className={`chip tiny-chip ${t.overdue ? 'bad' : ''}`}>{fmtDate(t.duedate)}</span>}
        {t.goals?.map((g: string) => <a key={g} className="chip tiny-chip goal-id" href={`#/ziele/${g}`}>{g}</a>)}
        {t.noGoal && <NoGoal />}
        {t.exempt && <span className="chip tiny-chip" title="bewusst ohne Ziel (Werkbank, mit Begründung)">bewusst ohne Ziel</span>}
        {t.why?.map((w: string) => <span key={w} className="chip tiny-chip warn">{w}</span>)}
        {children}
      </span>
    </li>
  );
}

function SprintPlan({ d, cycle, reload }: { d: any; cycle: string; reload: () => void }) {
  const g = d.goals, s = d.inSprint;
  const lc = useLocalChange(cycle, reload);
  const err = lc.err;
  const assign = (t: any, id: string) => lc.goal(t.key, id);
  const GoalSelect = ({ t }: { t: any }) => (
    <select aria-label={`Ziel für ${t.key}`} value="" onChange={(e) => { if (e.target.value !== '') assign(t, e.target.value === '-' ? '' : e.target.value); }}>
      <option value="">Ziel zuordnen …</option>
      {g.goalIds.map((x: any) => <option key={x.id} value={x.id}>{x.id} · {String(x.result).slice(0, 40)}</option>)}
      {t.goals?.length > 0 && <option value="-">— Werkbank-Zuordnung zurücksetzen</option>}
    </select>
  );
  const inRow = (t: any) => <TicketRow key={t.key} t={t}><GoalSelect t={t} /><button className="btn small" onClick={() => lc.member(t.key, false)}>rausnehmen</button></TicketRow>;
  return (
    <>

      <Err e={err} />
      <div className="card" data-testid="sprint-goals">
        <h3 style={{ marginTop: 0 }}>Sprintziele <span className="tiny">Sprint und Ziel werden in der Werkbank gespeichert (nicht in Jira); vorhandene Jira-Labels gelten als Fallback.</span></h3>
        {g.sprintGoals.length ? <table className="t small goals-t"><tbody>{g.sprintGoals.map((x: any) => (
          <tr key={x.id} data-goal={x.id}><td><span className="chip goal-id">{x.id}</span></td><td><Gap text={x.result} />{x.parent && <div className="tiny">zahlt ein auf {x.parent}</div>}</td><td className="tiny">{x.owner || '—'}</td><td className="tiny">{x.due || '—'}</td><td><Bar p={x.progress} /></td></tr>
        ))}</tbody></table> : <p className="small muted">Keine Sprintziele im Planning (S1–S4 oder S&lt;MMTT&gt;-&lt;n&gt;).</p>}
      </div>
      <h2>Im Sprint <span className="chip">{s.count}</span></h2>
      {s.count === 0 && <p className="small muted">Noch kein Ticket im Sprint — unten bei den Kandidaten „in Sprint nehmen“.</p>}
      {s.groups.filter((gr: any) => gr.tickets.length).map((gr: any) => (
        <div className="card" key={gr.goal.id} style={{ marginBottom: 8 }}><b><span className="chip goal-id">{gr.goal.id}</span> <Gap text={gr.goal.result} /></b><ul className="tlist">{gr.tickets.map(inRow)}</ul></div>
      ))}
      {s.otherGoal.length > 0 && <div className="card" style={{ marginBottom: 8 }}><b>Anderes Ziel (KR/Monat)</b><ul className="tlist">{s.otherGoal.map(inRow)}</ul></div>}
      {s.noGoal.length > 0 && <div className="card warnbox" style={{ marginBottom: 8 }}><b>⚠ Ohne Ziel</b> <span className="tiny">im Sprint, aber keinem Ziel zugeordnet</span><ul className="tlist">{s.noGoal.map(inRow)}</ul></div>}
      <h2>Kandidaten – nicht im Sprint <span className="chip">{d.candidates.length}</span></h2>
      <p className="small muted">Mitnahme aus Review/Planning, Tickets der Sprint- und Monatsziele, überfällige und Tickets der Top-10-Specs der Rangliste.</p>
      <ul className="tlist card">{d.candidates.map((t: any) => <TicketRow key={t.key} t={t}><button className="btn small primary" onClick={() => lc.member(t.key, true)}>in Sprint nehmen</button></TicketRow>)}</ul>
    </>
  );
}

function Question({ q, file, hash, cycle, me, onSaved }: { q: any; file: string; hash: string; cycle: string; me: string; onSaved: () => void }) {
  const [text, setText] = useState('');
  const [name, setName] = useState(me);
  const [err, setErr] = useState<unknown>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const save = async () => {
    setErr(null);
    try {
      const pre: any = await api(`/api/sprint/${cycle}/answer`, { body: { file, line: q.line, speaker: name, text, hash } });
      const ok = await confirm({
        title: 'Antwort in den Vault schreiben?',
        body: <>
          <p className="small"><code>{pre.preview.file}</code>, Zeile {pre.preview.line} ({pre.preview.mode === 'filled' ? 'leeres Antwortfeld wird gefüllt' : 'neue Zeile'})</p>
          <div className="diff card soft">{pre.preview.before !== null && <div className="del">- {pre.preview.before}</div>}<div className="add">+ {pre.preview.after}</div></div>
          <p className="tiny">Ein Text wird beim nächsten Sprint-Sync zum Jira-Kommentar (erst nach Freigabe); „→ mitnehmen: …“ nie.</p>
        </>,
        confirmLabel: 'Schreiben',
      });
      if (!ok) return;
      await api(`/api/sprint/${cycle}/answer`, { body: { file, line: q.line, speaker: name, text, hash, confirm: true } });
      toast('Antwort gespeichert'); setText(''); onSaved();
    } catch (e) { setErr(e); }
  };
  const open = q.answers.filter((a: any) => a.kind === 'empty');
  return (
    <div className="q" data-line={q.line}>
      {q.context.length > 0 && <div className="small muted">{q.context.map((c: string, i: number) => <div key={i}><Md text={c.replace(/^\s*([-*]|\d+\.)\s+/, '')} /></div>)}</div>}
      <div className="row" style={{ alignItems: 'baseline' }}>
        <div style={{ flex: 1 }}><Md text={(q.text || q.key).replace(/^\s*([-*]|\d+\.)\s+/, '')} /></div>
        {q.ticket && <a className="chip" href={`#/board?key=${q.ticket}`}>{q.ticket}{q.issue ? ` · ${q.issue.status}` : ''}</a>}
        {q.key.startsWith('ZIEL:') && <span className="chip">Ziel</span>}
      </div>
      <div className="ans">
        {q.answers.map((a: any) => (
          <div key={a.line} className={a.kind === 'empty' ? 'empty' : ''}>
            {a.kind === 'empty' ? `${a.speaker || 'Name'}: (noch keine Antwort)`
              : a.kind === 'synced' ? <span className="muted">{a.text}</span>
              : a.kind === 'carry' ? <span>→ mitnehmen: {a.text}</span>
              : <span>{a.speaker && <b>{a.speaker}: </b>}{a.kind === 'status' ? `status:${a.text}` : a.text}</span>}
          </div>
        ))}
        <div className="row" style={{ marginTop: 6 }}>
          <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 110 }} />
          <input aria-label="Antwort" placeholder={open.length ? 'Antwort …' : 'Weitere Antwort …'} value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1, minWidth: 220 }} onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) save(); }} />
          <button className="btn small primary" disabled={!text.trim()} onClick={save}>Antworten</button>
        </div>
        <Err e={err} />
      </div>
    </div>
  );
}

function SyncPlan({ cycle, onDone }: { cycle: string; onDone: () => void }) {
  const [plan, setPlan] = useState<any[] | null>(null);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [result, setResult] = useState<any>(null);
  const confirm = useConfirm();
  const prepare = async () => {
    setBusy(true); setErr(null); setResult(null);
    try {
      const r: any = await api(`/api/sprint/${cycle}/syncplan`, { method: 'POST' });
      setPlan(r.proposals);
      setSel(Object.fromEntries(r.proposals.map((p: any) => [p.id, !p.carry && !p.conflict && !p.question && p.actions.length > 0])));
      setEdits({});
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const actionsOf = (p: any) => p.actions.map((a: any) => a.type === 'comment' && edits[p.id] !== undefined ? { ...a, text: edits[p.id] } : a);
  const approved = (plan ?? []).filter((p) => sel[p.id]);
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div><h3 style={{ margin: 0 }}>Sprint-Sync vorbereiten</h3><p className="small muted" style={{ margin: 0 }}>Liest die Antwortzeilen aus Review und Planning (<code>jira-sync-plan.sh --sprint</code>) und schlägt Jira-Aktionen vor. Geschrieben wird erst nach deiner Freigabe; danach werden die Zeilen mit ✓ markiert.</p></div>
        <button className="btn" onClick={prepare} disabled={busy}>{busy ? 'Bereite vor …' : plan ? '↻ Neu vorbereiten' : 'Vorbereiten'}</button>
      </div>
      <Err e={err} />
      {plan && plan.length === 0 && <p className="okbox small" style={{ marginTop: 8 }}>Keine offenen Notizen — nichts nach Jira zu schreiben.</p>}
      {plan && plan.length > 0 && (
        <>
          <table className="t small" style={{ marginTop: 10 }}>
            <thead><tr><th></th><th>Ticket</th><th>Notiz</th><th>Aktion(en)</th><th>Hinweis</th></tr></thead>
            <tbody>
              {plan.map((p) => (
                <tr key={p.id}>
                  <td><input type="checkbox" aria-label={`Vorschlag ${p.id} freigeben`} disabled={p.carry || !p.actions.length} checked={!!sel[p.id]} onChange={(e) => setSel({ ...sel, [p.id]: e.target.checked })} /></td>
                  <td>{p.ticket ?? p.row.key}</td>
                  <td>{p.row.speaker !== '-' && <b>{p.row.speaker}: </b>}{p.row.payload}<div className="tiny">{p.row.file.split('/').pop()}:{p.row.line}</div></td>
                  <td>{p.carry ? <span className="chip">→ Mitnahme, nie Jira</span> : p.actions.map((a: any, k: number) => (
                    <div key={k}>
                      {a.type === 'status' && <>Status: {a.from ?? '?'} → <b>{a.to}</b></>}
                      {a.type === 'due' && <>Fällig: {fmtDate(a.from)} → <b>{a.date ? fmtDate(a.date) : 'ohne'}</b></>}
                      {a.type === 'comment' && <textarea rows={2} aria-label="Kommentartext" value={edits[p.id] ?? a.text} onChange={(e) => setEdits({ ...edits, [p.id]: e.target.value })} />}
                    </div>
                  ))}</td>
                  <td>{p.conflict && <span className="chip warn">{p.conflict}</span>}{p.question && <span className="chip bad">{p.question}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn primary" disabled={!approved.length || busy} onClick={async () => {
              const ok = await confirm({
                title: `${approved.length} Vorschläge in Jira ausführen?`,
                body: <><p>Unter deinem Jira-Konto, genau diese Liste:</p><ul className="small">{approved.map((p) => <li key={p.id}><b>{p.ticket}</b>: {actionsOf(p).map((a: any) => a.type === 'comment' ? `Kommentar „${a.text.slice(0, 80)}…“` : a.type === 'status' ? `Status → ${a.to}` : `Fällig → ${a.date ?? 'ohne'}`).join(' · ')}</li>)}</ul><p className="tiny">Danach werden die umgesetzten Zeilen in der Notiz mit „✓ Datum → Jira“ markiert (jira-sync-mark.sh).</p></>,
                confirmLabel: 'Freigeben und ausführen',
              });
              if (!ok) return;
              setBusy(true); setErr(null);
              try {
                const r: any = await api(`/api/sprint/${cycle}/apply`, { body: { confirm: true, approved: Object.fromEntries(approved.map((p) => [p.id, { payload: p.row.payload, actions: actionsOf(p) }])) } });
                setResult(r); onDone();
              } catch (e) { setErr(e); } finally { setBusy(false); }
            }}>Freigegebene ausführen ({approved.length})</button>
            <span className="tiny">Tickets anlegen gehört nicht dazu — das entscheidet die Runde (Chat, olaf-jira).</span>
          </div>
        </>
      )}
      {result && (
        <div style={{ marginTop: 10 }} className="small">
          <p className={result.results.every((r: any) => r.ok) ? 'okbox' : 'note'}>{result.results.filter((r: any) => r.ok).length} ausgeführt, {result.results.filter((r: any) => !r.ok).length} fehlgeschlagen{result.marked.length ? ` · markiert in ${result.marked.join(', ')}` : ''}.</p>
          <ul>{result.results.filter((r: any) => !r.ok).map((r: any) => <li key={r.id}>{r.id}: {r.error}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function NewCycle({ onCreated, suggest }: { onCreated: (id: string) => void; suggest: string }) {
  const [date, setDate] = useState(suggest);
  const [err, setErr] = useState<unknown>(null);
  const confirm = useConfirm();
  return (
    <div className="card soft">
      <h3 style={{ marginTop: 0 }}>Neuen Zyklus anlegen</h3>
      <p className="small muted">Legt <code>olaf/1-Projects/sprint-JJJJ-MM-TT/</code> mit Summary, Review und Planning aus den Vorlagen an (Sprint-Ziel, Ergebnisse S1–S4, Review-Bewertung ✅/🟡/❌). Der alte Zyklus bleibt, wo er ist — Archivieren macht die Runde.</p>
      <div className="row">
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Startdatum des Zyklus" />
        <button className="btn" disabled={!date} onClick={async () => {
          setErr(null);
          try {
            const pre: any = await api('/api/sprint/new', { body: { date } });
            const ok = await confirm({
              title: `Zyklus sprint-${date} anlegen?`,
              body: <><p className="small">Ordner <code>{pre.preview.dir}</code> mit:</p>{pre.preview.files.map((f: any) => <details key={f.name}><summary className="small">{f.name} ({f.lines} Zeilen)</summary><pre style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>{f.head}…</pre></details>)}</>,
              confirmLabel: 'Anlegen',
            });
            if (!ok) return;
            const r: any = await api('/api/sprint/new', { body: { date, confirm: true } });
            onCreated(r.id);
          } catch (e) { setErr(e); }
        }}>Vorschau & anlegen</button>
      </div>
      <Err e={err} />
    </div>
  );
}

export function Sprint({ cfg, hash }: { cfg: Config; hash: string }) {
  const cyc = useLoad(() => api('/api/sprint/cycles'));
  const want = hash.match(/^#\/sprint\/(sprint-\d{4}-\d{2}-\d{2})/)?.[1];
  const cycles: any[] = (cyc.data as any)?.cycles ?? [];
  const id = want ?? cycles.find((c) => !c.archived)?.id ?? cycles[0]?.id;
  const v = useLoad(() => (id ? api('/api/sprint/' + id) : Promise.resolve(null)), [id]);
  // Jira-Status der Tickets live nachziehen (Schreiben am Board, im Chat, Sprint-Sync, Abgleich).
  useJiraLive(() => { if (id) api('/api/sprint/' + id).then(v.setData).catch(() => {}); });
  const [tab, setTab] = useState<string>('review');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const toast = useToast();
  const me = (cfg.user?.name ?? '').split(' ')[0];
  const d: any = v.data;
  useEffect(() => { if (d && !d.files[tab]) setTab(Object.keys(d.files)[0] ?? 'review'); }, [d, tab]);
  const suggest = useMemo(() => {
    if (!cycles[0]) return '';
    const x = new Date(cycles[0].date + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + 14); return x.toISOString().slice(0, 10);
  }, [cycles]);
  if (cyc.error) return <div className="page"><Err e={cyc.error} /></div>;
  if (!cyc.data) return <div className="page"><Loading /></div>;
  if (!id) return <div className="page"><h1>Sprint</h1><p className="muted">Kein Zyklus unter <code>{(cyc.data as any).root}</code>.</p><NewCycle suggest={suggest} onCreated={(nid) => { window.location.hash = '#/sprint/' + nid; cyc.reload(); }} /></div>;
  const planning = d?.files.planning, review = d?.files.review, summary = d?.files.summary;
  const goal = planning?.goal?.goal ?? summary?.goal?.goal;
  const cur = d?.files[tab];
  const sections = cur ? [...new Set<string>(cur.questions.map((q: any) => q.section))] : [];
  return (
    <div className="page">
      <div className="head">
        <div>
          <h1>Sprint {id.replace('sprint-', '')}</h1>
          <div className="row small">
            {d && Object.entries(d.files).map(([k, f]: any) => <a key={k} className="chip" href={noteHref(f.path)}>{FILE_LABEL[k]}{f.status ? ` · ${f.status}` : ''}</a>)}
            {d?.cycle.archived && <span className="chip warn">archiviert</span>}
          </div>
        </div>
        <select value={id} onChange={(e) => { window.location.hash = '#/sprint/' + e.target.value; }} aria-label="Zyklus wählen">
          {cycles.map((c) => <option key={c.id} value={c.id}>{c.id}{c.archived ? ' (Archiv)' : ''}</option>)}
        </select>
      </div>
      {v.error && <Err e={v.error} />}
      {!d ? <Loading /> : (
        <>
          <div className="card">
            <div className="tiny">Sprint-Ziel</div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>{goal ?? <span className="muted">— noch kein Sprint-Ziel in der Planning-Notiz —</span>}</div>
          </div>

          {d.goals && <GoalTree g={d.goals} />}
          {d.goals && <SprintPlan d={d} cycle={id} reload={() => v.reload()} />}

          <h2>Ergebnisse (Planning-Tabelle)</h2>
          {planning?.outcomes.length ? (
            <table className="t small stack-t">
              <thead><tr><th>#</th><th>Ergebnis</th><th>DoD</th><th>Owner</th><th>Datum</th><th>Review</th></tr></thead>
              <tbody>{planning.outcomes.map((o: any) => {
                const r = review?.outcomes.find((x: any) => x.id === o.id);
                return <tr key={o.id}><td><b>{o.id}</b></td><td>{o.title}</td><td data-label="DoD">{o.dod ?? '—'}</td><td data-label="Owner">{o.owner ?? '—'}</td><td data-label="Datum">{o.date ?? '—'}</td><td data-label="Review">{r?.rating ? <span className="rating" title={r.evidence}>{r.rating}</span> : '—'}</td></tr>;
              })}</tbody>
            </table>
          ) : <p className="small muted">Die Planning-Notiz hat noch keine Ergebniszeilen S1–S4 (Sprint-Ziel + Ergebnisse mit DoD/Owner/Datum). Neue Zyklen aus der Werkbank bringen die Tabelle mit.</p>}
          {review?.outcomes.length > 0 && (
            <>
              <h3>Review-Bewertung (Soll-Ist)</h3>
              <table className="t small stack-t">
                <thead><tr><th>#</th><th>Ergebnis</th><th>Bewertung</th><th>Beleg</th><th>Warum / was ändern wir</th></tr></thead>
                <tbody>{review.outcomes.map((o: any) => <tr key={o.id}><td><b>{o.id}</b></td><td>{o.title}</td><td className="rating" data-label="Bewertung">{o.rating ?? '—'}</td><td data-label="Beleg">{o.evidence ?? '—'}</td><td data-label="Warum">{o.why ?? '—'}</td></tr>)}</tbody>
              </table>
            </>
          )}

          <h2>Fragen und Antwortzeilen</h2>
          <div className="tabs">
            {Object.keys(d.files).map((k) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{FILE_LABEL[k]} ({d.files[k].questions.length})</button>)}
            <label className="row small" style={{ marginLeft: 'auto' }}><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> nur mit leerem Antwortfeld</label>
          </div>
          {cur && cur.questions.length === 0 && <p className="muted small">Keine Anker <code>{'<!--k:…-->'}</code> in dieser Notiz.</p>}
          {cur && sections.map((sec) => {
            const qs = cur.questions.filter((q: any) => q.section === sec && (!onlyOpen || q.answers.some((a: any) => a.kind === 'empty')));
            if (!qs.length) return null;
            return (
              <details key={sec} open={sections.length < 6 || /Unklar|entscheiden/i.test(sec)} className="card" style={{ marginBottom: 8 }}>
                <summary><b>{sec}</b> <span className="tiny">{qs.length}</span></summary>
                {qs.map((q: any) => <Question key={q.line} q={q} file={tab} hash={cur.hash} cycle={id} me={me} onSaved={() => v.reload()} />)}
              </details>
            );
          })}

          <h2>Sprint-Sync</h2>
          <SyncPlan cycle={id} onDone={() => { v.reload(); toast('Sprint-Sync ausgeführt'); }} />

          <h2>Deine offenen Pflegepunkte</h2>
          <HygienePanel max={50} title="Eigene PM-Tickets" />
          <h2>Tickets ohne Termin-Klarheit</h2>
          <p className="small muted">Aus der Jira-Kopie{d.jiraSync ? ` (Stand ${fmtDateTime(d.jiraSync.at)})` : ' — noch nicht synchronisiert'}. Offenes Ticket heißt nicht unerledigte Arbeit — als Frage in die Runde.</p>
          <div className="grid2">
            <div className="card"><b>Überfällig ({d.overdue.length})</b><ul className="small">{d.overdue.slice(0, 40).map((i: any) => <li key={i.key}><a href={`#/board?key=${i.key}`}>{i.key}</a> {i.summary} · {i.assignee ?? '—'} · <span className="chip bad">{fmtDate(i.duedate)}</span></li>)}</ul></div>
            <div className="card"><b>Ohne Datum ({d.undated.length})</b><ul className="small">{d.undated.slice(0, 40).map((i: any) => <li key={i.key}><a href={`#/board?key=${i.key}`}>{i.key}</a> {i.summary} · {i.assignee ?? '—'}</li>)}</ul></div>
          </div>

          <h2>Nächster Zyklus</h2>
          <NewCycle suggest={suggest} onCreated={(nid) => { toast(`${nid} angelegt`); cyc.reload(); window.location.hash = '#/sprint/' + nid; }} />
        </>
      )}
    </div>
  );
}
