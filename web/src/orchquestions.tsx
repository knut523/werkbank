// Rückfragen des Orchestrators (docs/plan-orchestrator-agents.md). Stehen auf „Heute“ unter „Wartet auf dich“ und zählen
// in „Heute (n)“ mit (Release 11.10.2026: der frühere Roadmap-Kasten „Für mich offen“ ist mit der Heute-Seite entfallen).
import { useState } from 'react';
import { api } from './api.ts';
import { Err, useLoad, useToast, useJiraLive } from './ui.tsx';

// Rückfragen des Orchestrators (docs/plan-orchestrator-agents.md): die Haupt-Sitzung fragt nur, wo Knuts Entscheidung
// wirklich nötig ist; Antwort = Option und/oder Freitext, der Orchestrator liest sie über `orch questions get`.
export function OrchQuestions({ onChange }: { onChange?: () => void }) {
  const q = useLoad(() => api('/api/orchestrator/questions'));
  const reload = () => api('/api/orchestrator/questions').then(q.setData).catch(() => {});
  useJiraLive(() => { reload(); }, 'github');
  const toast = useToast();
  const [text, setText] = useState<Record<string, string>>({});
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const x: any = q.data;
  const open = (x?.open ?? []) as any[];
  if (!x || (!open.length && !(x.answered ?? []).length)) return null;
  const answer = async (it: any) => {
    setBusy(it.id); setErr(null);
    try {
      await api(`/api/orchestrator/questions/${it.id}/answer`, { body: { option: pick[it.id] || null, text: text[it.id] || '' } });
      toast('Antwort gespeichert — der Orchestrator liest sie beim nächsten Abruf');
      window.dispatchEvent(new Event('werkbank-questions'));
      await reload();
      onChange?.();
    } catch (e) { setErr(e); } finally { setBusy(null); }
  };
  return (
    <div className="card" data-testid="orch-questions">
      <h3 style={{ marginTop: 0 }}>Rückfragen des Orchestrators <span className={`chip${open.length ? ' warn' : ''}`}>{open.length}</span></h3>
      {err ? <Err e={err} /> : null}
      {!open.length && <p className="small muted">Keine offenen Rückfragen.</p>}
      {open.map((it) => (
        <div key={it.id} data-testid="orch-question" style={{ borderTop: '1px solid var(--line, #ddd)', paddingTop: 8, marginTop: 8 }}>
          <div><b>{it.title}</b> <span className="tiny">· {String(it.createdAt).slice(0, 16).replace('T', ' ')} · {it.id}</span></div>
          <p className="small" style={{ whiteSpace: 'pre-wrap', margin: '4px 0' }}>{it.context}</p>
          {(it.strand || it.link || it.plan) && <div className="small row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {it.strand && <a href={it.strand.url} target="_top">💬 Strang: {it.strand.title}</a>}
            {it.link && <a href={it.link} target="_blank" rel="noreferrer">🔗 Link</a>}
            {it.plan && <code className="tiny">{it.plan}</code>}
          </div>}
          {it.options.length > 0 && <div className="col" style={{ gap: 4, marginTop: 6 }}>{it.options.map((o: any) => (
            <label key={o.label} className="small" style={{ display: 'flex', gap: 6, alignItems: 'baseline', cursor: 'pointer' }}>
              <input type="radio" name={`q-${it.id}`} checked={pick[it.id] === o.label} onChange={() => setPick({ ...pick, [it.id]: o.label })} />
              <span><b>{o.label}</b>{o.consequence ? ` — ${o.consequence}` : ''}</span>
            </label>))}</div>}
          <div className="small" style={{ marginTop: 6 }}>⭐ Empfehlung: {it.recommendation}</div>
          <textarea aria-label={`Antwort auf ${it.title}`} rows={2} style={{ width: '100%', marginTop: 6 }} placeholder="Antwort / Ergänzung (optional, wenn eine Option gewählt ist)" value={text[it.id] ?? ''} onChange={(e) => setText({ ...text, [it.id]: e.target.value })} />
          <button className="btn small" style={{ minHeight: 36, marginTop: 4 }} disabled={busy === it.id || (!pick[it.id] && !(text[it.id] ?? '').trim())} onClick={() => answer(it)}>Antworten</button>
        </div>))}
      {(x.answered ?? []).length > 0 && <details className="small" style={{ marginTop: 8 }}><summary>zuletzt beantwortet ({x.answered.length})</summary>
        <ul style={{ paddingLeft: 18 }}>{x.answered.map((a: any) => <li key={a.id}>{a.title} — {a.status === 'beantwortet' ? [a.answer?.option, a.answer?.text].filter(Boolean).join(' — ') : 'zurückgezogen'}</li>)}</ul>
      </details>}
    </div>
  );
}
