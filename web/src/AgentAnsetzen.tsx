// „Agent ansetzen“ an einer Spec (docs/plan-agent-ansetzen.md): Vorschau → eine Primäraktion → Ticket, Spec-Link, Agent.
// Eine Primäraktion je Zustand; bei Dublette ist „An PM-xxx ansetzen“ die Hauptaktion, „Trotzdem neues Ticket“ sekundär.
import { useEffect, useRef, useState } from 'react';
import { api, fmtDate, chatTarget } from './api';
import { Err } from './ui';

const ws = (k: string) => `#/board?key=${k}`;

/** Knopf für Admins an Specs in 3-Plan; bei offenen Entscheidungen „Entscheiden“ statt „Agent ansetzen“. */
export function AnsetzenButton({ path, state, open, admin, wide }: { path: string; state?: string | null; open?: number; admin: boolean; wide?: boolean }) {
  const [show, setShow] = useState(false);
  if (!admin || (state && state !== '3-Plan')) return null;
  if (open && open > 0) return <a className={`btn small${wide ? ' wide' : ''}`} href="#/roadmap/entscheidungen" title="Erst die offenen „- Knut:“-Zeilen beantworten">Entscheiden ({open})</a>;
  return (
    <>
      <button className={wide ? 'btn wide' : 'btn small'} onClick={() => setShow(true)} data-testid="ansetzen-open">🤖 Agent ansetzen</button>
      {show && <AnsetzenDialog path={path} onClose={() => setShow(false)} />}
    </>
  );
}

function Step({ n, done, bad, children }: { n: number; done?: boolean; bad?: boolean; children: React.ReactNode }) {
  return (
    <div className={`step${done ? ' done' : ''}`}>
      <div className={`num${bad ? ' bad' : ''}`} aria-hidden>{bad ? '✗' : done ? '✓' : n}</div>
      <div>{children}</div>
    </div>
  );
}

export function AnsetzenDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const [pre, setPre] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [summary, setSummary] = useState('');
  const [parent, setParent] = useState('');
  const [mode, setMode] = useState<'review' | 'plan'>('review');
  const [note, setNote] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);

  const load = async (p = parent, m = mode) => {
    setErr(null);
    try {
      const r = await api('/api/roadmap/ansetzen', { body: { path, parent: p || undefined, mode: m } });
      setPre(r);
      if (!summary && r.draft) setSummary(r.draft.summary);
      if (!parent && r.draft) setParent(r.draft.parent);
      if (r.state?.key) setRes(r.state);
    } catch (e) { setErr(e); }
  };
  useEffect(() => { load(); }, [path]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { titleRef.current?.focus(); }, [pre?.draft]);
  // Escape schließt — aber nicht während des Laufs und nicht mit getippter Notiz (nichts geht verloren).
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy && !note.trim()) onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [busy, note, onClose]);

  const go = async (extra: Record<string, unknown> = {}) => {
    setBusy(true); setErr(null);
    try {
      const r = await api('/api/roadmap/ansetzen', { body: { path, confirm: true, hash: pre.hash, summary, parent, mode, note, ...extra } });
      setRes(r);
      if (r.link?.state === 'ok') { const fresh = await api('/api/roadmap/ansetzen', { body: { path, parent, mode } }).catch(() => null); if (fresh) setPre(fresh); }
    } catch (e) { setErr(e); }
    setBusy(false);
  };

  const sim = pre?.mode === 'sim';
  const dups: any[] = res?.needsChoice ? res.candidates ?? [] : pre?.duplicates ?? [];
  const firstDup = dups[0];
  const half = res?.key && (res.readback?.ok === false || (res.link && res.link.state === 'offen') || res.agent?.state === 'offen' || !res.agent);
  const doneAll = res?.key && res.readback?.ok && res.agent?.state === 'gestartet';
  const label = (s: string) => (sim ? `Simulieren: ${s}` : s);

  return (
    <div className="backdrop">
      <div className="dialog ansetzen" role="dialog" aria-modal="true" aria-label="Agent ansetzen" data-testid="ansetzen-dialog">
        <h3 className="row" style={{ gap: 8 }}>Agent ansetzen{sim && <span className="chip warn" data-testid="sim-chip">SIMULIERT — kein echtes Jira</span>}</h3>
        <p className="tiny" style={{ marginTop: -6 }}>{(pre?.spec?.title ?? path.split('/').pop()).replace(/^olaf — Spec:\s*/i, '')} · {pre?.spec?.topic}</p>
        {!pre && !err && <p className="muted">Lade Vorschau …</p>}
        <Err e={err} />
        {pre && pre.mode === 'aus' && <div className="err" role="alert">„Agent ansetzen“ ist ausgeschaltet{pre.problem ? `: ${pre.problem}` : ' (WERKBANK_ANSETZEN).'}</div>}
        {pre && pre.mode !== 'aus' && !pre.gate.ok && (
          <div className="card soft" data-testid="ansetzen-gate">
            <b>{pre.gate.why}</b>
            {pre.gate.open?.length > 0 && <ul className="small">{pre.gate.open.map((q: string) => <li key={q}>{q}</li>)}</ul>}
            <a className="btn primary" href="#/roadmap/entscheidungen" onClick={onClose}>Entscheiden</a>
          </div>
        )}
        {pre && pre.mode !== 'aus' && pre.gate.ok && (
          <>
            {pre.jiraProblem && <div className="err" role="alert">{pre.jiraProblem}</div>}
            {pre.liveProblem && <div className="err" role="alert">{pre.liveProblem} — ohne Dublettenprüfung wird nichts angelegt.</div>}
            {pre.dryRun && <div className="err" role="alert">Trockenlauf (Vorschau-Instanz): hier wird nichts angelegt.</div>}
            {dups.length > 0 && !res?.key && (
              <div className="card soft" data-testid="ansetzen-dups" style={{ marginBottom: 10 }}>
                <b>{res?.needsChoice === 'unklar' ? 'Das letzte Anlegen hatte kein klares Ergebnis. Gefunden:' : 'Gibt es schon? Passende Tickets:'}</b>
                <ul className="small" style={{ paddingLeft: 18, margin: '6px 0' }}>{dups.map((d) => <li key={d.key}><span className="chip warn">{d.key}</span> {d.summary} <span className="tiny">{d.status} · {d.why}</span></li>)}</ul>
              </div>
            )}
            {res?.needsChoice === 'unklar' && !dups.length && <div className="err" role="alert">Das letzte Anlegen hatte kein klares Ergebnis, und die Suche findet nichts. Bitte erst in Jira nachsehen; „Trotzdem neues Ticket“ legt bewusst eines an.</div>}

            {!res?.key && pre.draft && (
              <div className="col" style={{ gap: 6 }}>
                <label className="small" htmlFor="ans-title">Ticket-Titel</label>
                <input id="ans-title" ref={titleRef} value={summary} onChange={(e) => setSummary(e.target.value)} />
                <label className="small" htmlFor="ans-ws">Workstream (Parent)</label>
                <select id="ans-ws" value={parent} onChange={(e) => { setParent(e.target.value); load(e.target.value); }}>
                  {!pre.workstreams.some((w: any) => w.key === parent) && <option value={parent}>{parent}</option>}
                  {pre.workstreams.map((w: any) => <option key={w.key} value={w.key}>{w.key} · {w.summary}</option>)}
                </select>
                <p className="small" style={{ margin: '4px 0' }}>Owner <b>{pre.draft.ownerName}</b> · Priorität <b>{pre.draft.priority}</b> · fällig <b>{fmtDate(pre.draft.duedate)}</b> <span className="tiny">({pre.draft.dueHow})</span></p>
                <details className="small"><summary>Beschreibung ansehen</summary><pre className="tiny" style={{ whiteSpace: 'pre-wrap' }}>{pre.draft.description}</pre></details>
                <fieldset className="small" style={{ border: 0, padding: 0, margin: '6px 0' }}>
                  <legend className="small">Was der Agent tun soll</legend>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}><input type="radio" name="ans-mode" checked={mode === 'review'} onChange={() => setMode('review')} /> bis Review (Agent baut auf lokalem Branch, wartet vor GitHub)</label>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}><input type="radio" name="ans-mode" checked={mode === 'plan'} onChange={() => setMode('plan')} /> nur Plan (Agent schreibt den Plan, kein Code)</label>
                </fieldset>
                <label className="small" htmlFor="ans-note">Notiz an den Agenten (optional)</label>
                <textarea id="ans-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                <p className="tiny">Der Agent arbeitet im Chat; jede Schreibaktion wartet dort auf dein „ja“.</p>
              </div>
            )}

            {res?.key && (
              <div className="steps" aria-live="polite" data-testid="ansetzen-steps" style={{ margin: '8px 0' }}>
                <p className="small" style={{ margin: 0 }}>{res.key} existiert — es wird kein zweites Ticket angelegt.</p>
                <Step n={1} done>Ticket {res.ticket?.created ? 'angelegt' : 'übernommen'} · {res.ticket?.url ? <a href={res.ticket.url} target="_blank" rel="noreferrer">{res.key}</a> : res.ticket?.sim ? <b>{res.key}</b> : <a href={ws(res.key)}>{res.key}</a>}</Step>
                <Step n={2} done={res.readback?.ok} bad={res.readback?.ok === false}>Zurückgelesen{res.readback?.fixed?.length ? ` · nachgezogen: ${res.readback.fixed.join(', ')}` : ''}{res.readback?.ok === false && <div className="err">Weicht ab: {res.readback.problems.join(', ')} — Spec und Agent warten.</div>}</Step>
                <Step n={3} done={res.link?.state === 'ok' || res.link?.state === 'schon'} bad={res.link?.state === 'offen'}>Spec verlinkt ({res.link?.field ?? 'jira'}:){res.link?.state === 'offen' && <div className="tiny">{res.link.why}</div>}{res.link?.state === 'trocken' && <div className="tiny">Trockenlauf: nicht geschrieben.</div>}</Step>
                <Step n={4} done={res.agent?.state === 'gestartet'} bad={res.agent?.state === 'offen'}>Agent {res.agent?.state === 'gestartet' ? <>gestartet · <a href={res.agent.url} target={chatTarget} rel="noreferrer">Im Chat öffnen</a></> : 'noch nicht gestartet'}{res.agent?.state === 'offen' && <div className="tiny">{res.agent.why}</div>}</Step>
              </div>
            )}
          </>
        )}
        <div className="row ansetzen-actions" style={{ justifyContent: 'flex-end', marginTop: 14, flexWrap: 'wrap', gap: 8 }}>
          <button className="btn" onClick={onClose} disabled={busy}>{doneAll ? 'Schließen' : 'Abbrechen'}</button>
          {pre?.gate?.ok && pre.mode !== 'aus' && !doneAll && (() => {
            if (res?.key) return half ? <button className="btn primary" disabled={busy || pre.dryRun} onClick={() => go()}>{busy ? 'Setze fort …' : label('Fortsetzen')}</button> : null;
            if (firstDup) return <>
              <button className="btn ghost" disabled={busy || !pre.ready && !res?.needsChoice} onClick={() => go({ newTicket: true })}>Trotzdem neues Ticket</button>
              <button className="btn primary" disabled={busy || pre.dryRun} onClick={() => go({ useKey: firstDup.key })}>{busy ? 'Setze an …' : label(`An ${firstDup.key} ansetzen`)}</button>
            </>;
            if (res?.needsChoice === 'unklar') return <button className="btn ghost" disabled={busy} onClick={() => go({ newTicket: true })}>Trotzdem neues Ticket</button>;
            return <button className="btn primary" data-testid="ansetzen-go" disabled={busy || !pre.ready || !summary.trim()} onClick={() => go()}>{busy ? 'Lege Ticket an …' : label('Ticket anlegen und Agent starten')}</button>;
          })()}
        </div>
      </div>
    </div>
  );
}
