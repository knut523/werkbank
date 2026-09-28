import { useState } from 'react';
import { api, fmtDate, chatTarget } from './api.ts';
import { Err, useConfirm, useLoad, useToast } from './ui.tsx';

/**
 * Task-Hygiene der eigenen PM-Tickets: je Punkt eine Frage, einzeilige Antwort → vorgeschlagene
 * Jira-Aktion → Bestätigen → mit dem eigenen Jira-Zugang schreiben. "später" = heute nicht mehr fragen.
 */
export function HygienePanel({ max = 3, title = 'Deine Tickets brauchen Pflege', onChange }: { max?: number; title?: string; onChange?: () => void }) {
  const h = useLoad(() => api('/api/hygiene'));
  const [all, setAll] = useState(false);
  if (!h.data) return null;
  const d: any = h.data;
  const open = d.items.filter((i: any) => !d.snoozed.includes(i.key));
  if (!d.items.length) return null;
  const shown = all ? open : open.slice(0, max);
  return (
    <div className="card hyg" style={{ marginBottom: 14 }} data-testid="hygiene">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <b>🧹 {title} ({open.length}{d.snoozed.length ? ` · ${d.snoozed.length} später` : ''})</b>
        <span className="row">
          {open.length > max && <button className="btn small ghost" onClick={() => setAll(!all)}>{all ? 'weniger' : `alle ${open.length}`}</button>}
          <a className="btn small" href={d.eodUrl} target={chatTarget} title="Chat, der zusammenfasst, was du heute angefasst hast, und nach Stand und Daten fragt">🌙 Tagesabschluss</a>
        </span>
      </div>
      {!open.length && <p className="small muted">Für heute alles auf „später“. </p>}
      {shown.map((i: any) => <HygieneItem key={i.key + i.rule} i={i} onDone={() => { h.reload(); onChange?.(); }} />)}
      <p className="tiny" style={{ margin: '6px 0 0' }}>Eine Zeile reicht: „erledigt“, „neues Datum 15.10.“, „läuft, warte auf Rogue“ oder „später“. Geschrieben wird erst nach Bestätigung, mit deinem Jira-Zugang.</p>
    </div>
  );
}

function HygieneItem({ i, onDone }: { i: any; onDone: () => void }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const send = async (answer: string) => {
    setErr(null);
    try {
      const p: any = await api(`/api/hygiene/${i.key}/answer`, { body: { text: answer } });
      if (p.snoozed) { toast(`${i.key}: heute nicht mehr`); onDone(); return; }
      if (p.question) { setErr(new Error(p.question)); return; }
      if (!p.actions.length) { setErr(new Error('Daraus ergibt sich keine Jira-Aktion.')); return; }
      const ok = await confirm({
        title: `${i.key} in Jira nachziehen?`,
        body: <ul className="small">{p.actions.map((a: any, k: number) => <li key={k}>{a.type === 'status' ? <>Status: {a.from ?? '?'} → <b>{a.to}</b></> : a.type === 'due' ? <>Fällig: {fmtDate(a.from)} → <b>{a.date ? fmtDate(a.date) : 'ohne'}</b></> : <>Kommentar: „{a.text}“</>}</li>)}</ul>,
        confirmLabel: 'In Jira schreiben',
      });
      if (!ok) return;
      await api(`/api/hygiene/${i.key}/answer`, { body: { confirm: true, actions: p.actions } });
      toast(`${i.key} nachgezogen`); setText(''); onDone();
    } catch (e) { setErr(e); }
  };
  return (
    <div className="item" data-hygiene={i.key}>
      <div className="small"><span className="chip warn">{i.rule}</span> {i.question}</div>
      <div className="row" style={{ marginTop: 4 }}>
        <input aria-label={`Antwort zu ${i.key}`} placeholder="Antwort …" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1, minWidth: 200 }} onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) send(text); }} />
        <button className="btn small primary" disabled={!text.trim()} onClick={() => send(text)}>Vorschlagen</button>
        <button className="btn small" onClick={() => send('später')}>später</button>
      </div>
      <Err e={err} />
    </div>
  );
}
