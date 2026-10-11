// Eine Liste „bei mir“ (Council-Bedingung 11): was auf die Person wartet, an EINER Stelle — der Startseite „Heute“.
// Board, Sprint, Mein Tag und Roadmap verlinken mit BeiMirLink dorthin, statt eigene Listen zu führen.
// „Wartet auf dich“ ist das frühere „Für mich offen“ der Roadmap (Plan Roadmap-Automatik S3): Fragen des Vault-Syncs
// (✅ Ja führt der nächste Sync aus), Freigaben, Entwurf „Woran wir gerade arbeiten“, offene Entscheidungen, PRs.
import { useEffect, useState, type CSSProperties } from 'react';
import { api } from './api.ts';
import { Err, useConfirm, useToast } from './ui.tsx';

export const note = (p: string) => '#/wissen/' + p.split('/').map(encodeURIComponent).join('/');

/** Entscheidungstexte aus dem Vault sind Markdown: **fett** wird fett, `code` wird code, übrige Sternchen fallen weg
 *  (auch die, die beim Kürzen auf `max` Zeichen ein Paar verloren haben). */
export function Md({ text, max }: { text: unknown; max?: number }) {
  let t = String(text ?? '');
  if (max && t.length > max) t = t.slice(0, max).trimEnd() + ' …';
  return <>{t.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) =>
    /^\*\*[^*]+\*\*$/.test(part) ? <b key={i}>{part.slice(2, -2)}</b>
      : /^`[^`]+`$/.test(part) ? <code key={i}>{part.slice(1, -1)}</code>
      : part.replace(/\*\*|`/g, ''))}</>;
}

/** Zähler „bei mir“ (dieselbe Zahl wie „Heute (n)“ in der Navigation). */
export function useTodayCount(dep: unknown = null, enabled = true) {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => api<{ count: number }>('/api/today/count').then((r) => { if (alive) setN(r.count); }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [dep, enabled]);
  return n;
}

/** Eine Zeile statt einer eigenen Liste: „Bei mir: n offen → Heute“. */
export function BeiMirLink({ what = 'Pflegepunkte, Rückfragen und Reviews' }: { what?: string }) {
  const n = useTodayCount();
  if (n === null) return null;
  return (
    <a className="beimir-link card soft" href="#/" data-testid="beimir-link">
      <span>📋 <b>Bei mir: {n === 0 ? 'nichts offen' : `${n} offen`}</b> <span className="small muted">— {what} stehen gesammelt unter „Heute“</span></span>
      <span aria-hidden>→</span>
    </a>
  );
}

export function WartetAufDich({ x, decisions, onChange }: { x: any; decisions: any[]; onChange: () => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const answer = async (q: any, a: 'ja' | 'nein' | 'widerruf') => {
    setBusy(q.id); setErr(null);
    try {
      const r: any = await api('/api/roadmap/question', { body: { id: q.id, answer: a } });
      toast(a === 'ja' ? (r.started ? 'Freigegeben — der Vault-Sync läuft jetzt' : 'Freigegeben — startet, sobald der laufende Sync fertig ist') : a === 'nein' ? 'Verworfen — wird nicht wieder vorgeschlagen' : 'Freigabe zurückgenommen');
      onChange();
    } catch (e) { setErr(e); } finally { setBusy(null); }
  };
  const draft = async (action: 'übernehmen' | 'verwerfen') => {
    if (action === 'übernehmen' && !(await confirm({ title: '„Woran wir gerade arbeiten“ ersetzen?', confirmLabel: 'In den Hub schreiben', body: <><p className="small">Der Block zwischen den Werkbank-Markern im Roadmap-Hub wird durch diesen Entwurf ersetzt. Alles andere auf der Seite bleibt.</p><pre className="small" style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflow: 'auto' }}>{x.draft.body}</pre></> }))) return;
    setBusy('draft'); setErr(null);
    try { await api('/api/roadmap/draft', { body: { action, hash: x.draft.hash } }); toast(action === 'übernehmen' ? 'Im Hub übernommen' : 'Entwurf verworfen'); onChange(); }
    catch (e) { setErr(e); } finally { setBusy(null); }
  };
  const pend = (x.pendingApprovals ?? []) as any[];
  const btn: CSSProperties = { minHeight: 44 };
  return (
    <div data-testid="for-me">
      {err ? <Err e={err} /> : null}
      {(x.queued?.length > 0 || x.syncRunning) && <p className="small">
        {x.queued?.length > 0 && <span className="chip warn" title="Roadmap-Nachzug nach Agentenlauf wartet (höchstens alle 20 min)">Nachzug wartet: {x.queued.join(', ')}</span>}
        {x.syncRunning && <span className="chip ok">Vault-Sync läuft</span>}
      </p>}
      {x.questions.length > 0 && <>
        <div className="small docs-h">Fragen des Vault-Syncs ({x.section}) — ✅ Ja: der Sync führt genau das aus</div>
        <ul className="small plain">{x.questions.map((q: any) => (
          <li key={q.id} className="item" data-testid="sync-question">
            <div>{q.text}</div>
            {q.failed !== null && q.failed !== undefined && <div className="chip bad">nicht erledigt{q.failed ? `: ${q.failed}` : ''}</div>}
            {q.answer === 'ja'
              ? <span><span className="chip ok">freigegeben — wird beim nächsten Sync erledigt</span>{x.admin && <button className="btn ghost small" style={{ marginLeft: 8 }} disabled={busy === q.id} onClick={() => answer(q, 'widerruf')}>Zurücknehmen</button>}</span>
              : x.admin && <div className="row" style={{ gap: 8, marginTop: 4 }}>
                  <button className="btn small yes" style={btn} disabled={busy === q.id} onClick={() => answer(q, 'ja')}>✅ Ja</button>
                  <button className="btn ghost small" style={btn} disabled={busy === q.id} onClick={() => answer(q, 'nein')}>✖️ Nein</button>
                </div>}
          </li>))}</ul>
      </>}
      {pend.length > 0 && <>
        <div className="small docs-h">Freigegeben, noch nicht erledigt ({pend.length})</div>
        <ul className="small plain">{pend.map((a: any) => (
          <li key={a.id} className="item">{a.text} <span className="tiny">· {a.by}, {String(a.at).slice(0, 10)}</span>
            {a.failed !== null && <span className="chip bad">nicht erledigt{a.failed ? `: ${a.failed}` : ''}</span>}
            {x.admin && <button className="btn ghost small" style={{ marginLeft: 8 }} disabled={busy === a.id} onClick={() => answer(a, 'widerruf')}>Zurücknehmen</button>}
          </li>))}</ul>
      </>}
      {x.draft && <>
        <div className="small docs-h">Entwurf „Woran wir gerade arbeiten“ (vom Morgenlauf)</div>
        <details className="small"><summary>ansehen</summary><pre className="small" style={{ whiteSpace: 'pre-wrap' }}>{x.draft.body}</pre></details>
        {!x.draft.hubHasMarkers && <p className="small warn">Im Hub fehlen die Werkbank-Marker — Übernehmen geht erst, wenn sie da sind.</p>}
        <div className="row" style={{ gap: 8, marginTop: 4 }}>
          <button className="btn small" style={btn} disabled={busy === 'draft' || !x.draft.hubHasMarkers} onClick={() => draft('übernehmen')}>Übernehmen</button>
          <button className="btn ghost small" style={btn} disabled={busy === 'draft'} onClick={() => draft('verwerfen')}>Verwerfen</button>
        </div>
      </>}
      {decisions.length > 0 && <>
        <div className="small docs-h">Offene Entscheidungen im Vault ({decisions.length}) — <a href="#/roadmap/entscheidungen">beantworten</a></div>
        <ul className="small plain">{decisions.slice(0, 5).map((q: any) => <li key={q.path + q.line} className="item"><a href={note(q.path)}>{q.title ?? q.spec}</a>: <Md text={q.question} max={140} /></li>)}</ul>
        {decisions.length > 5 && <a className="small" href="#/roadmap/entscheidungen">alle {decisions.length}</a>}
      </>}
      {x.prs.length > 0 && <>
        <div className="small docs-h">PRs, bei denen {x.me} dran ist ({x.prs.length})</div>
        <ul className="small plain">{x.prs.map((p: any) => <li key={p.pr} className="item"><a href={p.url} target="_blank" rel="noreferrer">{p.pr}</a> {p.title} <span className="tiny">· {p.why}</span></li>)}</ul>
      </>}
    </div>
  );
}

/** Hat „Wartet auf dich“ überhaupt etwas? (Leere Abschnitte lässt Heute weg.) */
export const mineCount = (x: any, decisions: any[]) => (x ? x.questions.length + (x.pendingApprovals?.length ?? 0) + (x.draft ? 1 : 0) + x.prs.length : 0) + decisions.length;
