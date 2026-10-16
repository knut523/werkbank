import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, fmtDate, fmtDateTime, type Config } from '../api.ts';
import { Err, Loading, useLoad, useConfirm, useToast, useJiraLive } from '../ui.tsx';
import { GoalSelect } from '../components.tsx';
import { SiteSwitch, useBoardSite, boardSites } from './Board.tsx';

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
  return <a className={`chip ${small ? 'tiny-chip' : ''} bad nogoal`} href="#/ziele/zuordnen" title="Kein Ziel (Workspace-Zuordnung oder Jira-Label), auch nicht vom Parent geerbt — einem Ziel zuordnen oder bewusst ohne Ziel (mit Grund)" onClick={(e) => e.stopPropagation()}>ohne Ziel – genauer anschauen</a>;
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
      if (!(await confirm({ title, confirmLabel: 'Speichern', body: <><pre className="small">{text}</pre><p className="tiny">Gespeichert im OLAF Workspace (mit Verlauf) — nichts wird nach Jira geschrieben.</p></> }))) return;
      await api(url, { body: { ...body, confirm: true } });
      toast('Gespeichert (OLAF Workspace)');
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
        {t.exempt && <span className="chip tiny-chip" title="bewusst ohne Ziel (OLAF Workspace, mit Begründung)">bewusst ohne Ziel</span>}
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
  const GoalPick = ({ t }: { t: any }) => <GoalSelect goals={g.goalIds} label={`Ziel für ${t.key}`} zuruecksetzen={t.goals?.length > 0} onPick={(id) => assign(t, id)} />;
  const inRow = (t: any) => <TicketRow key={t.key} t={t}><GoalPick t={t} /><button className="btn small" onClick={() => lc.member(t.key, false)}>rausnehmen</button></TicketRow>;
  return (
    <>

      <Err e={err} />
      <div className="card" data-testid="sprint-goals">
        <h3 style={{ marginTop: 0 }}>Sprintziele <span className="tiny">Sprint und Ziel werden im OLAF Workspace gespeichert (nicht in Jira); vorhandene Jira-Labels gelten als Fallback.</span></h3>
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
      <ul className="tlist card">{d.candidates.map((t: any) => <TicketRow key={t.key} t={t}><button className="btn small" onClick={() => lc.member(t.key, true)}>in Sprint nehmen</button></TicketRow>)}</ul>
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
          <p className="tiny">Ein Text wird beim nächsten Sprint-Sync zum Jira-Kommentar (erst nach deiner Zustimmung); „→ mitnehmen: …“ nie.</p>
        </>,
        confirmLabel: 'Schreiben',
      });
      if (!ok) return;
      await api(`/api/sprint/${cycle}/answer`, { body: { file, line: q.line, speaker: name, text, hash, confirm: true } });
      toast('Antwort gespeichert'); setText(''); onSaved();
    } catch (e: any) { setErr(/geändert/.test(String(e?.message)) ? new Error(`${e.message} Dein Text bleibt im Feld stehen.`) : e); }
  };
  const open = q.answers.filter((a: any) => a.kind === 'empty');
  const fid = `ans-${file}-${q.line}`;
  // Ohne vorgesehenes Antwortfeld ist das Eingabefeld eingeklappt (große Pakete bleiben lesbar).
  const [show, setShow] = useState(open.length > 0);
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
        {!show && <button className="btn small ghost" onClick={() => setShow(true)} aria-label={`Antwort zu ${q.ticket ?? q.key} ergänzen`}>+ Antwort</button>}
        {show && <div className="ans-form">
          <label htmlFor={fid} className="tiny">{open.length ? 'Antwort' : 'Weitere Antwort'} zu {q.ticket ?? q.key}</label>
          <textarea id={fid} rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Stand, nächster Schritt — oder status:Done, → mitnehmen: …" onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) save(); }} />
          <div className="row">
            <label className="tiny" htmlFor={`${fid}-n`}>Antwort als</label>
            <input id={`${fid}-n`} value={name} onChange={(e) => setName(e.target.value)} style={{ width: 110 }} />
            <button className="btn small" disabled={!text.trim()} onClick={save}>Antworten</button>
          </div>
        </div>}
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
        <div><h2 style={{ margin: 0 }}>Write-back vorbereiten <span className="chip">Trockenlauf — noch nichts in Jira</span></h2><p className="small muted" style={{ margin: 0 }}>Liest die Antwortzeilen aus Review und Planning (<code>jira-sync-plan.sh --sprint</code>) und zeigt die geplanten Jira-Aktionen. Geschrieben wird erst nach deiner Freigabe im Dialog (wie bei <code>/sprint-sync</code>); danach werden die Zeilen mit ✓ markiert.</p></div>
        <button className={plan ? 'btn' : 'btn primary'} onClick={prepare} disabled={busy}>{busy ? 'Erstelle …' : plan ? '↻ Trockenlauf neu' : 'Trockenlauf erstellen'}</button>
      </div>
      <Err e={err} />
      {plan && plan.length === 0 && <p className="okbox small" style={{ marginTop: 8 }}>Keine offenen Notizen — nichts nach Jira zu schreiben.</p>}
      {plan && plan.length > 0 && (
        <>
          <table className="t small stack-t" style={{ marginTop: 10 }}>
            <thead><tr><th></th><th>Ticket</th><th>Notiz</th><th>Aktion(en)</th><th>Hinweis</th></tr></thead>
            <tbody>
              {plan.map((p) => (
                <tr key={p.id}>
                  <td><input type="checkbox" aria-label={`Vorschlag ${p.id} übernehmen`} disabled={p.carry || !p.actions.length} checked={!!sel[p.id]} onChange={(e) => setSel({ ...sel, [p.id]: e.target.checked })} /></td>
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
                confirmLabel: 'Zustimmen und ausführen',
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

// ---------- Der Zyklus in fünf Schritten (docs/plan-sprint-werkbank.md) ----------
// Status je Schritt nur aus den Dateien abgeleitet (P4), kein gespeicherter Zustand.

const RATING_WORD: Record<string, string> = { '✅': 'erreicht', '🟡': 'teilweise', '❌': 'nicht erreicht' };
const Rating = ({ r }: { r?: string | null }) => r ? <span className="rating-w"><span aria-hidden="true">{r}</span> {RATING_WORD[r] ?? r}</span> : <span className="muted">noch nicht bewertet</span>;
const STEP_TITLES = ['Review vorbereiten', 'Updates sammeln', 'S1–S4 bewerten', 'Write-back vorbereiten', 'Mitnahme → Planning'];

const answered = (q: any) => !!q.inline || q.answers.some((a: any) => a.kind !== 'empty');

function stepState(d: any) {
  const review = d?.files.review;
  const qs: any[] = review?.questions ?? [];
  // Gezählt werden Pakete, die ein Antwortfeld haben können; Backlog-Blöcke haben ihre eigene Frage je Ticket.
  const pk: any[] = (review?.packages ?? []).filter((p: any) => !/^Backlog\b/i.test(p.name) && qs.some((q) => q.line > p.line && q.line <= p.end));
  const withAnswer = pk.filter((p) => qs.some((q) => q.line > p.line && q.line <= p.end && answered(q))).length;
  // Soll = S-Zeilen des Vorzyklus-Plannings; ohne sie zählen die Zeilen der Review-Notiz.
  const soll: any[] = d?.previous?.outcomes ?? [];
  const ist: any[] = review?.outcomes ?? [];
  const rows = soll.length ? soll.map((o) => ist.find((x) => x.id === o.id)) : ist;
  const rated = rows.filter((o) => o?.rating).length;
  const openNotes = (review?.openNotes ?? 0) + (d?.files.planning?.openNotes ?? 0);
  const anyNote = [review, d?.files.planning].some((f) => f?.questions.some(answered));
  return [
    { done: !!review, text: review ? 'Review da' : 'Review fehlt' },
    { done: !!pk.length && withAnswer === pk.length, text: pk.length ? `${withAnswer} von ${pk.length} Paketen mit Antwort` : 'keine Pakete' },
    { done: !!rows.length && rated === rows.length, text: rows.length ? `${rated} von ${rows.length} bewertet` : (d?.previous?.goal ? 'Ziel-Satz bewerten' : 'keine S-Zeilen') },
    { done: !!review && anyNote && openNotes === 0, text: openNotes ? `${openNotes} offene Notiz${openNotes === 1 ? '' : 'en'}` : anyNote ? 'alles übertragen' : 'noch keine Notizen' },
    { done: false, text: openNotes ? 'erst Write-back' : (!!review && anyNote) ? 'bereit' : 'nach dem Write-back' },
  ];
}

function Steps({ st, cur, id }: { st: { done: boolean; text: string }[]; cur: number; id: string }) {
  return (
    <nav aria-label="Sprint-Zyklus">
      <ol className="cycle-steps">
        {STEP_TITLES.map((t, i) => (
          <li key={t} className={`${i === cur ? 'on' : ''} ${st[i].done ? 'done' : ''}`}>
            <a href={`#/sprint/${id}/${i + 1}`} aria-current={i === cur ? 'step' : undefined}>
              <span className="n">{st[i].done ? '✓' : i + 1}</span>
              <span><b>{t}</b><span className="tiny">{st[i].done ? 'erledigt · ' : ''}{st[i].text}</span></span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function download(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function StepDraft({ d, id, suggest, onCreated }: { d: any; id: string; suggest: string; onCreated: (id: string) => void }) {
  const has = !!d.files.review;
  const [date, setDate] = useState(has ? suggest : id.replace('sprint-', ''));
  const [pre, setPre] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const prepare = async () => {
    setBusy(true); setErr(null); setPre(null);
    try { setPre(await api('/api/sprint/draft', { body: { date } })); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  const missing = pre?.preview.files.filter((f: any) => !f.exists) ?? [];
  const review = pre?.preview.files.find((f: any) => f.name.endsWith('-review.md'));
  return (
    <div className="card now" data-testid="step-1">
      <h2>Review vorbereiten</h2>
      <p className="small muted">Entwurf aus der Vorlage und den Daten: S-Zeilen des Vorzyklus wörtlich (ohne Bewertung), seine Arbeitspakete mit den To-Do-Tickets aus der Jira-Kopie und je Owner einem leeren Antwortfeld, je Domäne der Backlog mit „In diesen Sprint mitnehmen?“, laufende Aufgaben gesammelt, Tickets ohne Paket unter „Auffälligkeiten“. Die Notiz nennt den OLAF Workspace nicht. Keine Prosa — das bleibt bei dir oder beim Agenten im Chat. Alles Automatische ist <b>Board-Stand, nicht Arbeitsstand</b>.</p>
      {has && <p className="okbox small">Dieser Zyklus hat schon eine Review-Notiz (<a href={noteHref(d.files.review.path)}>{d.files.review.path.split('/').pop()}</a>) — sie wird nie überschrieben. Ein Entwurf für den nächsten Zyklus geht unten.</p>}
      <div className="row">
        <label className="small" htmlFor="draft-date">Zyklus ab</label>
        <input id="draft-date" type="date" value={date} onChange={(e) => { setDate(e.target.value); setPre(null); }} />
        <button className={has ? 'btn' : 'btn primary'} disabled={!date || busy} onClick={prepare}>{busy ? 'Erzeuge …' : 'Review-Entwurf erzeugen'}</button>
      </div>
      <Err e={err} />
      {pre && (
        <div className="draft-pre">
          <p className="small">
            <b>sprint-{date}</b> · Vorzyklus {pre.preview.previous ?? '—'}
            {pre.preview.stats && <> · {pre.preview.stats.packages} Pakete, {pre.preview.stats.tickets} To-Do-Zeilen, {pre.preview.stats.backlog} im Backlog (mit Frage „mitnehmen?“), {pre.preview.stats.ongoing} laufend, {pre.preview.stats.orphans} ohne Paket · {pre.preview.stats.fallback ? 'Vorzyklus ohne S-Zeilen → Ziel-Satz' : `${pre.preview.stats.outcomes} S-Zeilen`}</>}
            {pre.preview.stats?.skipped?.length > 0 && <span className="tiny"> · nicht übernommen (lokale Arbeit zählt erst nach Test → Dev → Prod): {pre.preview.stats.skipped.join(', ')}</span>}
          </p>
          <ul className="small">{pre.preview.files.map((f: any) => <li key={f.name}><code>{f.name}</code> — {f.exists ? 'gibt es schon, bleibt unverändert' : `neu (${f.lines} Zeilen)`}</li>)}</ul>
          <div className="row">
            {review && <button className="btn" onClick={() => download(review.name, review.content)}>Review-Entwurf herunterladen</button>}
            {missing.length > 0 && <button className="btn primary" onClick={async () => {
              const ok = await confirm({
                title: `${missing.length} Notiz${missing.length === 1 ? '' : 'en'} im Vault anlegen?`,
                body: <><p className="small">In <code>{pre.preview.dir}</code>:</p><ul className="small">{missing.map((f: any) => <li key={f.name}>{f.name}</li>)}</ul><p className="tiny">Nur neue Dateien; vorhandene werden nicht angefasst. Danach in Obsidian oder hier weiterschreiben.</p></>,
                confirmLabel: 'Anlegen',
              });
              if (!ok) return;
              try {
                const r: any = await api('/api/sprint/draft', { body: { date, confirm: true } });
                toast(r.dryRun ? 'Trockenlauf — nichts geschrieben' : `${r.written.length} angelegt`);
                if (!r.dryRun) onCreated(r.id);
              } catch (e) { setErr(e); }
            }}>Fehlende anlegen ({missing.length})</button>}
          </div>
          {review && <details><summary className="small">Review-Entwurf ansehen</summary><pre className="md-pre">{review.content}</pre></details>}
        </div>
      )}
    </div>
  );
}

function StepPackages({ d, id, me, reload }: { d: any; id: string; me: string; reload: () => void }) {
  const [mine, setMine] = useState(false);
  const [empty, setEmpty] = useState(false);
  const review = d.files.review;
  if (!review) return <div className="card now"><h2>Updates sammeln</h2><p className="small muted">Erst eine Review-Notiz anlegen (Schritt 1).</p></div>;
  const pk: any[] = review.packages ?? [];
  const lo = me.toLowerCase();
  const qsOf = (p: any) => review.questions.filter((q: any) => q.line > p.line && q.line <= p.end);
  const isMine = (p: any) => p.tickets.some((t: any) => (t.owner ?? '').toLowerCase() === lo) || qsOf(p).some((q: any) => q.answers.some((a: any) => a.speaker.toLowerCase() === lo));
  const shown = pk.filter((p) => (!mine || isMine(p)) && (!empty || qsOf(p).some((q: any) => q.answers.some((a: any) => a.kind === 'empty'))));
  const domains = [...new Set(pk.map((p) => p.domain))];
  const counted = pk.filter((p) => !/^Backlog\b/i.test(p.name) && qsOf(p).length);
  const withAnswer = counted.filter((p) => qsOf(p).some(answered)).length;
  return (
    <div className="card now" data-testid="step-2">
      <h2>Updates sammeln</h2>
      <p className="small muted">Je Arbeitspaket eine Antwort unter das passende Ticket — hier oder direkt in Obsidian, gezählt wird beides. Ein Text wird beim Write-back zum Jira-Kommentar, <code>status:Done</code> zur Statusänderung, <code>→ mitnehmen: …</code> nie nach Jira.</p>
      <div className="row">
        <span className="chip">{withAnswer} von {counted.length} Paketen mit Antwort</span>{(mine || empty) && <span className="tiny">{shown.length} von {pk.length} angezeigt</span>}
        <label className="row small"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> nur meine{me ? ` (${me})` : ''}</label>
        <label className="row small"><input type="checkbox" checked={empty} onChange={(e) => setEmpty(e.target.checked)} /> nur mit leerem Antwortfeld</label>
      </div>
      {!pk.length && <p className="small muted">Die Review-Notiz hat unter „## Die Updates“ keine Pakete (<code>####</code>).</p>}
      {pk.length > 0 && !shown.length && <p className="okbox small">Nichts offen in dieser Auswahl.</p>}
      {domains.map((dom) => {
        const ps = shown.filter((p) => p.domain === dom);
        if (!ps.length) return null;
        return (
          <section key={dom}>
            <h3>{dom}</h3>
            {ps.map((p) => {
              const qs = qsOf(p);
              const open = p.tickets.filter((t: any) => !t.done && !t.missing);
              const owners = [...new Set(open.map((t: any) => t.owner).filter(Boolean))];
              const over = open.filter((t: any) => t.overdue).length;
              const any = qs.some(answered);
              return (
                <details key={p.line} className="pkg card soft" data-pkg={p.name}>
                  <summary>
                    <span className="pkg-arrow" aria-hidden="true" />
                    <b>{p.name}</b>
                    <span className="row" style={{ gap: 4 }}>
                      <span className="chip tiny-chip">{p.tickets.length} Ticket{p.tickets.length === 1 ? '' : 's'}</span>
                      {owners.length > 0 && <span className="chip tiny-chip">{owners.join(', ')}</span>}
                      {over > 0 && <span className="chip tiny-chip bad">{over} überfällig</span>}
                      <span className={`chip tiny-chip ${any ? 'ok' : ''}`}>{any ? 'mit Antwort' : 'noch keine Antwort'}</span>
                    </span>
                  </summary>
                  {p.freeText.length > 0 && <p className="note small">Text ohne Antwortzeile — geht nicht nach Jira: „{p.freeText.join(' ').slice(0, 200)}“</p>}
                  {!qs.length && <p className="small muted">Keine Ticketzeile mit Anker in diesem Paket.</p>}
                  {qs.map((q: any) => <Question key={q.line} q={q} file="review" hash={review.hash} cycle={id} me={me} onSaved={reload} />)}
                </details>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function StepRating({ d }: { d: any }) {
  const review = d.files.review;
  const soll: any[] = d.previous?.outcomes ?? [];
  const ist: any[] = review?.outcomes ?? [];
  const rows = soll.length ? soll.map((o) => ({ id: o.id, title: o.title, dod: o.dod, ist: ist.find((x) => x.id === o.id) })) : ist.map((x) => ({ id: x.id, title: x.title, dod: undefined, ist: x }));
  return (
    <div className="card now" data-testid="step-3">
      <h2>S1–S4 bewerten</h2>
      <p className="small muted">Soll aus dem Planning des Vorzyklus, Ist aus der Review-Notiz. Bewertet wird in der Runde, in der Notiz — kein ✅ ohne Beleg, Board-Stand belegt nicht „fachlich fertig“.</p>
      {!rows.length && (d.previous?.goal
        ? <p className="small">Der Vorzyklus hatte keine S-Zeilen. Bewertet wird der Ziel-Satz: <i>„{d.previous.goal}“</i> — die S-Zeilen beginnen mit diesem Planning.</p>
        : <p className="small muted">Keine S-Zeilen im Vorzyklus und keine in der Review-Notiz.</p>)}
      {rows.length > 0 && (
        <table className="t small stack-t">
          <thead><tr><th>#</th><th>Ergebnis (Soll)</th><th>Bewertung</th><th>Beleg</th><th>Warum / was ändern wir</th></tr></thead>
          <tbody>{rows.map((r) => {
            const hint = r.ist?.rating === '✅' && !(r.ist?.evidence && r.ist.evidence !== '…') ? '✅ ohne Beleg' : (r.ist?.rating === '🟡' || r.ist?.rating === '❌') && !(r.ist?.why && r.ist.why !== '…' && r.ist.why !== '—') ? 'Warum fehlt' : !r.ist ? 'fehlt in der Review-Notiz' : '';
            return <tr key={r.id}><td><b>{r.id}</b></td><td>{r.title}{r.dod && <div className="tiny">DoD: {r.dod}</div>}</td><td data-label="Bewertung"><Rating r={r.ist?.rating} />{hint && <div><span className="chip tiny-chip warn">{hint}</span></div>}</td><td data-label="Beleg">{r.ist?.evidence ?? '—'}</td><td data-label="Warum">{r.ist?.why ?? '—'}</td></tr>;
          })}</tbody>
        </table>
      )}
      {review && <p className="small"><a href={noteHref(review.path)}>Review-Notiz öffnen</a> · <a href={`#/sprint/${d.cycle.id}/4`}>Weiter zu Schritt 4</a></p>}
    </div>
  );
}

function StepCarry({ d, id, onCandidates }: { d: any; id: string; onCandidates: () => void }) {
  const toast = useToast();
  const [r, setR] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const openNotes = (d.files.review?.openNotes ?? 0) + (d.files.planning?.openNotes ?? 0);
  if (!d.files.review) return <div className="card now"><h2>Mitnahme → Planning</h2><p className="small muted">Erst eine Review-Notiz anlegen (Schritt 1).</p></div>;
  return (
    <div className="card now" data-testid="step-5">
      <h2>Mitnahme → Planning</h2>
      <p className="small muted">Alles, was der Review berührt und nach dem Write-back noch offen ist — gerechnet aus der Jira-Kopie, wie <code>jira-sprint-carry.sh</code>. Nur lesend: in die Notiz schreibt den Abschnitt <code>/sprint-sync</code> im Chat. Ins Planning kommt es über die Kandidaten („in Sprint nehmen“).</p>
      {openNotes > 0 && <p className="note small">Erst der Write-back: {openNotes} Notiz{openNotes === 1 ? '' : 'en'} noch nicht in Jira. Sonst stünden Tickets in der Mitnahme, die gleich auf Done gehen. <a href={`#/sprint/${id}/4`}>Zu Schritt 4</a></p>}
      <div className="row">
        <button className="btn primary" disabled={openNotes > 0} onClick={async () => { setErr(null); try { setR(await api(`/api/sprint/${id}/carry`)); } catch (e) { setErr(e); } }}>Mitnahme berechnen</button>
        <button className="btn" onClick={onCandidates}>Zu den Kandidaten</button>
      </div>
      <Err e={err} />
      {r && (
        <>
          <p className="small">{r.keys} Tickets im Review erwähnt, <b>{r.open} offen</b> ({r.groups.overdue.length} überfällig, {r.groups.dated.length} mit Datum, {r.groups.undated.length} ohne) · {r.carry} „→ mitnehmen“ · Stand der Jira-Kopie {r.jiraSync ? fmtDateTime(r.jiraSync.at) : 'unbekannt'}{r.missing.length ? ` · ${r.missing.length} nicht in der Kopie` : ''}</p>
          <div className="row"><button className="btn" onClick={() => download(`${id}-mitnahme.md`, r.markdown)}>Als Markdown herunterladen</button><button className="btn" onClick={() => navigator.clipboard?.writeText(r.markdown).then(() => toast('Kopiert'), () => toast('Kopieren nicht möglich — bitte herunterladen'))}>Kopieren</button></div>
          <pre className="md-pre">{r.markdown}</pre>
        </>
      )}
    </div>
  );
}

// Zielbaum hier nur noch für Nutzer ohne Freigabe „ziele“ — sonst steht er unter Planen › Ziele (Paket 187, S6).
function GoalTree({ g }: { g: any }) {
  if (g.missing) return <div className="card soft" data-testid="goal-tree"><b>Stage Gate nicht definiert</b><p className="small muted" style={{ margin: 0 }}>Die Zieldatei <code>{g.file}</code> fehlt. Format: Tabelle unter <code>## Ziele</code> mit ID | Ebene | Ergebnis | Messgröße | Baseline | Ziel | Stichtag | Owner | Eltern-ID | Beleg (siehe README).</p></div>;
  return (
    <details className="card" open data-testid="goal-tree">
      <summary><b>Zielbaum</b> <span className="tiny">Gate → Ziel → KR → Monat → Sprint · aus <a href={noteHref(g.file)}>{g.file.split('/').pop()}</a> · Fortschritt = erledigte / zugeordnete Tickets (Zuordnung im OLAF Workspace, sonst Jira-Label, oder in der Zeile genannt)</span></summary>
      {!g.gate.length && <p className="note small">Stage Gate nicht definiert (keine Zeile mit Ebene „Gate“).</p>}
      <ul className="goal-tree root">{g.roots.map((n: any) => <GoalNodeView key={n.id} n={n} />)}</ul>
      {!g.monthGoals.length && <p className="tiny">Monatsziele für diesen Sprint noch nicht gesetzt (Ebene „Monat“, ID M&lt;MM&gt;-&lt;n&gt;).</p>}
    </details>
  );
}

// 17c: Sprint je Jira-Seite — PM = Workspace-Sprint aus dem Vault (wie bisher), OLAF = laufender Jira-Sprint (nur lesen).
export function Sprint({ cfg, hash }: { cfg: Config; hash: string }) {
  const [site, setSite] = useBoardSite(cfg, hash);
  const main = !boardSites(cfg).some((x) => x.prefix === site && !x.main);
  return (
    <>
      {boardSites(cfg).length > 1 && <div className="page" style={{ paddingBottom: 0 }}><SiteSwitch cfg={cfg} site={site} onPick={setSite} what="Sprint" /></div>}
      {main ? <PmSprint cfg={cfg} hash={hash} /> : <JiraSprint key={site} site={site} />}
    </>
  );
}

const jiraSprintState = new Map<string, { q: string; owner: string }>();
/** Laufender Jira-Sprint einer weiteren Seite: Tickets nach Status, Filter/Suche je Seite, Klick öffnet das Ticket am Board. */
function JiraSprint({ site }: { site: string }) {
  const st = jiraSprintState.get(site);
  const [q, setQ] = useState(st?.q ?? '');
  const [owner, setOwner] = useState(st?.owner ?? '');
  useEffect(() => { jiraSprintState.set(site, { q, owner }); }, [site, q, owner]);
  const url = `/api/board?site=${site}&sprint=1&done=1&q=${encodeURIComponent(q)}&owner=${encodeURIComponent(owner)}`;
  const b = useLoad(() => api(url), [url]);
  useJiraLive(() => { api(url).then(b.setData).catch(() => {}); });
  const d: any = b.data;
  const cards: any[] = d ? d.lanes.flatMap((l: any) => Object.values(l.columns).flat().map((c: any) => ({ ...c, lane: l.name }))) : [];
  return (
    <div className="page" data-testid="jira-sprint">
      <div className="head"><div>
        <h1>Sprint · {site} (Entwicklungs-Jira)</h1>
        <p className="muted" style={{ margin: 0 }}>Laufender Jira-Sprint aus der Kopie{d?.site ? ` von ${d.site.replace(/^https:\/\//, '')}` : ''} — <b>nur lesen</b>. Planung und Review laufen dort im Jira; der Workspace-Sprint (Vault) gehört zum PM-Board.</p>
      </div>{d?.sync && <span className="tiny">Stand {fmtDateTime(d.sync.at)} · {d.sprint?.count ?? 0} Tickets im Sprint</span>}</div>
      {b.error && <Err e={b.error} />}
      <div className="board-bar">
        <select value={owner} onChange={(e) => setOwner(e.target.value)} aria-label="Owner"><option value="">Alle Owner</option>{d?.owners.map((o: string) => <option key={o} value={o}>{o}</option>)}</select>
        <input type="search" placeholder="Suchen (Key, Titel, Owner)" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Tickets suchen" />
        <span className="tiny">{cards.length} Tickets</span>
      </div>
      {!d ? <Loading /> : !d.sync ? <div className="card soft"><p>Noch keine Kopie — am <a href={`#/board?site=${site}`}>{site}-Board</a> auf „Jetzt synchronisieren“ klicken.</p></div>
        : !cards.length ? <div className="card soft"><p>Kein Ticket im laufenden Jira-Sprint{q || owner ? ' für diesen Filter' : ' (oder das Projekt hat keinen offenen Sprint)'}.</p></div>
        : <div className="cols" style={{ '--ncol': d.statuses.length } as any}>
          {d.statuses.map((s: string) => { const xs = cards.filter((c) => c.status === s); return (
            <div key={s}><div className="colhead">{s} · {xs.length}</div><div className="col-cards">
              {xs.map((c) => <a key={c.key} className="tcard" href={`#/board?site=${site}&key=${c.key}`} data-key={c.key}><div className="k"><span>{c.key}</span></div><div className="s">{c.summary}</div>
                <div className="row" style={{ gap: 4 }}><span className="chip">{c.assignee ?? 'ohne Owner'}</span><span className="chip">{c.lane}</span>{c.subtasks?.length ? <span className="chip">{c.subtaskDone}/{c.subtasks.length} Sub</span> : null}</div></a>)}
            </div></div>); })}
        </div>}
    </div>
  );
}

function PmSprint({ cfg, hash }: { cfg: Config; hash: string }) {
  const cyc = useLoad(() => api('/api/sprint/cycles'));
  const hm = hash.match(/^#\/sprint\/(sprint-\d{4}-\d{2}-\d{2})(?:\/([1-5]))?/);
  const want = hm?.[1];
  const cycles: any[] = (cyc.data as any)?.cycles ?? [];
  const id = want ?? cycles.find((c) => !c.archived)?.id ?? cycles[0]?.id;
  const v = useLoad(() => (id ? api('/api/sprint/' + id) : Promise.resolve(null)), [id]);
  // Jira-Status der Tickets live nachziehen (Schreiben am Board, im Chat, Sprint-Sync, Abgleich).
  useJiraLive(() => { if (id) api('/api/sprint/' + id).then(v.setData).catch(() => {}); });
  const [tab, setTab] = useState<string>('planning');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [ctxOpen, setCtxOpen] = useState(false);
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
  const created = (nid: string) => { cyc.reload(); window.location.hash = `#/sprint/${nid}/2`; if (nid === id) v.reload(); };
  if (!id) return <div className="page"><h1>Sprint</h1><p className="muted">Kein Zyklus unter <code>{(cyc.data as any).root}</code>.</p><NewCycle suggest={suggest} onCreated={(nid) => { window.location.hash = '#/sprint/' + nid; cyc.reload(); }} /></div>;
  const planning = d?.files.planning, summary = d?.files.summary;
  const real = (g?: string) => (g && !g.startsWith('…') ? g : undefined);   // Platzhalter der Vorlage zählt nicht
  const goal = real(planning?.goal?.goal) ?? real(summary?.goal?.goal);
  const st = d ? stepState(d) : [];
  const first = st.findIndex((s) => !s.done);
  const step = hm?.[2] ? Number(hm[2]) - 1 : (first < 0 ? 4 : first);
  const cur = d?.files[tab];
  const sections = cur ? [...new Set<string>(cur.questions.map((q: any) => q.section))] : [];
  const showCandidates = () => { setCtxOpen(true); setTimeout(() => document.querySelector('[data-testid="ctx-plan"]')?.scrollIntoView({ behavior: 'smooth' }), 50); };
  return (
    <div className="page sprint-page">
      <div className="head">
        <div>
          <h1>Sprint {id.replace('sprint-', '')}</h1>
          <div className="row small">
            {d && Object.entries(d.files).map(([k, f]: any) => <a key={k} className="chip" href={noteHref(f.path)}>{FILE_LABEL[k]}{f.status ? ` · ${f.status}` : ''}</a>)}
            {d?.cycle.archived && <span className="chip warn">archiviert</span>}
            {d && !d.cycle.archived && d.cycle.date > new Date().toLocaleDateString('sv-SE') && <span className="chip" title="Board, Roadmap und Chat-Kontext zeigen noch den laufenden Zyklus">beginnt erst {fmtDate(d.cycle.date)}</span>}
          </div>
        </div>
        <select value={id} onChange={(e) => { window.location.hash = '#/sprint/' + e.target.value; }} aria-label="Zyklus wählen">
          {cycles.map((c) => <option key={c.id} value={c.id}>{c.id}{c.archived ? ' (Archiv)' : ''}</option>)}
        </select>
      </div>
      {v.error && <Err e={v.error} />}
      {!d ? <Loading /> : (
        <>
          <p className="sprint-goal"><span className="tiny">Sprint-Ziel</span> {goal ?? <span className="muted">— noch kein Sprint-Ziel in der Planning-Notiz —</span>}</p>
          <Steps st={st} cur={step} id={id} />

          {step === 0 && <StepDraft key={id} d={d} id={id} suggest={suggest} onCreated={created} />}
          {step === 1 && <StepPackages d={d} id={id} me={me} reload={() => v.reload()} />}
          {step === 2 && <StepRating d={d} />}
          {step === 3 && <div className="now" data-testid="step-4"><SyncPlan cycle={id} onDone={() => { v.reload(); toast('Write-back ausgeführt'); }} /></div>}
          {step === 4 && <StepCarry d={d} id={id} onCandidates={showCandidates} />}

          <h2 className="ctx-h">Kontext</h2>
          <details className="card ctx" data-testid="ctx-plan" open={ctxOpen} onToggle={(e) => setCtxOpen((e.target as HTMLDetailsElement).open)}>
            <summary><b>Sprintziele, im Sprint, Kandidaten</b> <span className="tiny">{d.inSprint?.count ?? 0} im Sprint · {d.candidates?.length ?? 0} Kandidaten</span></summary>
            {d.goals && <SprintPlan d={d} cycle={id} reload={() => v.reload()} />}
          </details>
          {d.goals && (cfg?.features?.ziele !== false
            ? <p className="small" data-testid="zielbaum-link">🎯 Der Zielbaum (Gate → Ziel → KR → Monat → Sprint) steht unter <a href="#/ziele">Planen › Ziele</a>.</p>
            : <details className="card ctx"><summary><b>Zielbaum</b> <span className="tiny">Gate → Ziel → KR → Monat → Sprint</span></summary><GoalTree g={d.goals} /></details>)}
          <details className="card ctx">
            <summary><b>Alle Fragen und Antwortzeilen</b> <span className="tiny">{Object.values(d.files).reduce((n: number, f: any) => n + f.questions.length, 0)} in Summary, Review, Planning</span></summary>
            <div className="tabs" role="tablist">
              {Object.keys(d.files).map((k) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{FILE_LABEL[k]} ({d.files[k].questions.length})</button>)}
              <label className="row small" style={{ marginLeft: 'auto' }}><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> nur mit leerem Antwortfeld</label>
            </div>
            {cur && cur.questions.length === 0 && <p className="muted small">Keine Anker <code>{'<!--k:…-->'}</code> in dieser Notiz.</p>}
            {cur && sections.map((sec) => {
              const qs = cur.questions.filter((q: any) => q.section === sec && (!onlyOpen || q.answers.some((a: any) => a.kind === 'empty')));
              if (!qs.length) return null;
              return (
                <details key={sec} open={/Unklar|entscheiden/i.test(sec)} className="card soft" style={{ marginBottom: 8 }}>
                  <summary><b>{sec}</b> <span className="tiny">{qs.length}</span></summary>
                  {qs.map((q: any) => <Question key={q.line} q={q} file={tab} hash={cur.hash} cycle={id} me={me} onSaved={() => v.reload()} />)}
                </details>
              );
            })}
          </details>
          <details className="card ctx">
            <summary><b>Tickets ohne Termin-Klarheit</b> <span className="tiny">{d.overdue.length} überfällig · {d.undated.length} ohne Datum</span></summary>
            <p className="small muted">Aus der Jira-Kopie{d.jiraSync ? ` (Stand ${fmtDateTime(d.jiraSync.at)})` : ' — noch nicht synchronisiert'}. Offenes Ticket heißt nicht unerledigte Arbeit — als Frage in die Runde.</p>
            <div className="grid2">
              <div className="card"><b>Überfällig ({d.overdue.length})</b>{d.overdue.length ? <ul className="small">{d.overdue.slice(0, 40).map((i: any) => <li key={i.key}><a href={`#/board?key=${i.key}`}>{i.key}</a> {i.summary} · {i.assignee ?? '—'} · <span className="chip bad">überfällig {fmtDate(i.duedate)}</span></li>)}</ul> : <p className="small muted">Keine.</p>}</div>
              <div className="card"><b>Ohne Datum ({d.undated.length})</b>{d.undated.length ? <ul className="small">{d.undated.slice(0, 40).map((i: any) => <li key={i.key}><a href={`#/board?key=${i.key}`}>{i.key}</a> {i.summary} · {i.assignee ?? '—'}</li>)}</ul> : <p className="small muted">Keine.</p>}</div>
            </div>
          </details>
          <details className="card ctx"><summary><b>Neuen Zyklus anlegen</b> <span className="tiny">alle drei Notizen auf einmal — sonst Schritt 1 „Review vorbereiten“</span></summary>
            <NewCycle suggest={suggest} onCreated={(nid) => { toast(`${nid} angelegt`); cyc.reload(); window.location.hash = '#/sprint/' + nid; }} />
          </details>
        </>
      )}
    </div>
  );
}
