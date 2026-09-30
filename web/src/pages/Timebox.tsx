// Mein Tag / Timebox (Knut, 30.09.): Tagesplan im Zeitraster 07–20 Uhr, Wochenansicht, Blöcke per Ziehen anlegen,
// verschieben und in der Länge ändern; Tickets aus „Meine offenen Tickets“ auf den Tag ziehen. Privat je Person,
// ohne Kalender, ohne Jira-Schreiben (dafür bleiben die Knöpfe am Board mit Bestätigung).
import { useRef, useState, type PointerEvent as RPE } from 'react';
import { api, fmtDate, type Config } from '../api.ts';
import { Err, Loading, useLoad, useToast, useConfirm } from '../ui.tsx';
import { Detail } from './Board.tsx';
import { NoGoal } from './Sprint.tsx';

const SLOT = 16;           // px je 15 Minuten
const STEP = 15;
const pad = (n: number) => String(n).padStart(2, '0');
const hm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s: string, n: number) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const monday = (s: string) => { const d = new Date(s + 'T12:00:00'); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return iso(d); };
const WD = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const PRIO: Record<number, string> = { 1: 'Muss', 2: 'Soll', 3: 'Kann' };
const nextPrio = (p?: number | null) => (p ? (p < 3 ? p + 1 : null) : 1);
const hours = (m: number) => (m / 60).toLocaleString('de-AT', { maximumFractionDigits: 1 });

type Op = { kind: 'create'; date: string; from: number; to: number }
  | { kind: 'move'; id: string; date: string; start: number; dur: number; grab: number; moved: boolean }
  | { kind: 'resize'; id: string; date: string; start: number; dur: number };

export function Timebox({ cfg }: { cfg: Config }) {
  const [date, setDate] = useState(() => iso(new Date()));
  const [week, setWeek] = useState(false);
  const from = week ? monday(date) : date;
  const days = week ? 7 : 1;
  const d = useLoad(() => api(`/api/timebox?from=${from}&days=${days}&day=${date}`), [from, days, date]);
  const data: any = d.data;
  const toast = useToast();
  const confirm = useConfirm();
  const [err, setErr] = useState<unknown>(null);
  const [op, setOp] = useState<Op | null>(null);
  const opRef = useRef<Op | null>(null);
  const [ask, setAsk] = useState<{ date: string; start: number; dur: number } | null>(null);
  const [title, setTitle] = useState('');
  const [askKey, setAskKey] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const g = data?.grid ?? { start: 420, end: 1200, step: 15 };
  const H = ((g.end - g.start) / STEP) * SLOT;
  const minuteAt = (el: HTMLElement, clientY: number) => {
    const r = el.getBoundingClientRect();
    return Math.max(g.start, Math.min(g.end - STEP, g.start + Math.floor((clientY - r.top) / SLOT) * STEP));
  };
  const colAt = (x: number, y: number) => (document.elementsFromPoint(x, y).find((e) => (e as HTMLElement).dataset?.col) as HTMLElement | undefined);
  const set = (o: Op | null) => { opRef.current = o; setOp(o); };
  const call = async (fn: () => Promise<any>, msg?: string) => { setErr(null); try { await fn(); if (msg) toast(msg); await d.reload(); } catch (e) { setErr(e); d.reload(); } };

  // ---------- Zeiger: anlegen / verschieben / Länge ----------
  const onColDown = (e: RPE<HTMLDivElement>, day: string) => {
    if (e.target !== e.currentTarget || e.button > 0) return;
    const m = minuteAt(e.currentTarget, e.clientY);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    set({ kind: 'create', date: day, from: m, to: m + STEP });
  };
  const onBlockDown = (e: RPE<HTMLDivElement>, b: any, kind: 'move' | 'resize') => {
    if ((e.target as HTMLElement).closest('button') || e.button > 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const col = colAt(e.clientX, e.clientY);
    const grab = col ? minuteAt(col, e.clientY) - b.start : 0;
    set(kind === 'move' ? { kind, id: b.id, date: b.date, start: b.start, dur: b.dur, grab, moved: false } : { kind, id: b.id, date: b.date, start: b.start, dur: b.dur });
  };
  const onMove = (e: RPE<HTMLDivElement>) => {
    const o = opRef.current;
    if (!o) return;
    const col = colAt(e.clientX, e.clientY);
    if (!col) return;
    const m = minuteAt(col, e.clientY);
    if (o.kind === 'create') set({ ...o, to: Math.max(o.from + STEP, m + STEP) });
    if (o.kind === 'resize') set({ ...o, dur: Math.max(STEP, Math.min(g.end - o.start, m + STEP - o.start)) });
    if (o.kind === 'move') {
      const start = Math.max(g.start, Math.min(g.end - o.dur, m - o.grab));
      const day = col.dataset.col!;
      if (start !== o.start || day !== o.date) set({ ...o, start, date: day, moved: true });
    }
  };
  const onUp = async () => {
    const o = opRef.current;
    set(null);
    if (!o) return;
    if (o.kind === 'create') { setAsk({ date: o.date, start: o.from, dur: o.to - o.from }); setTitle(''); setAskKey(''); }
    if (o.kind === 'resize') call(() => api(`/api/timebox/${o.id}`, { method: 'PATCH', body: { dur: o.dur } }));
    if (o.kind === 'move' && o.moved) call(() => api(`/api/timebox/${o.id}`, { method: 'PATCH', body: { start: o.start, date: o.date } }));
  };

  // ---------- Ticket aus der Seitenleiste auf den Tag ziehen ----------
  const onDrop = (e: React.DragEvent<HTMLDivElement>, day: string) => {
    const key = e.dataTransfer.getData('application/x-ticket');
    if (!key) return;
    e.preventDefault();
    const start = minuteAt(e.currentTarget, e.clientY);
    call(() => api('/api/timebox', { body: { date: day, start, dur: Math.min(60, g.end - start), key } }), `${key} eingeplant ${hm(start)}`);
  };
  const addToday = (key: string) => {
    // Mobil/Tastatur: nächster freier Platz ab jetzt (bzw. 09:00) am gewählten Tag.
    const bs = (data?.blocks ?? []).filter((b: any) => b.date === date && b.state !== 'verschoben');
    const now = new Date(); const nowM = date === iso(now) ? Math.ceil((now.getHours() * 60 + now.getMinutes()) / STEP) * STEP : 9 * 60;
    let s = Math.max(g.start, nowM);
    for (let guard = 0; guard < 60 && bs.some((b: any) => s < b.start + b.dur && s + 60 > b.start); guard++) s += STEP;
    if (s + STEP > g.end) { setErr(new Error('Heute ist kein Platz mehr frei.')); return; }
    call(() => api('/api/timebox', { body: { date, start: s, dur: Math.min(60, g.end - s), key } }), `${key} eingeplant ${hm(s)}`);
  };

  const dates: string[] = data?.dates ?? [from];
  const blocksOf = (day: string) => (data?.blocks ?? []).filter((b: any) => b.date === day);
  // Beim Ziehen auf einen anderen Tag erscheint der Block in der Zielspalte (nicht unsichtbar).
  const shownIn = (day: string) => (data?.blocks ?? []).filter((b: any) => { const o = op && op.kind !== 'create' && op.id === b.id ? op : null; return (o ? o.date : b.date) === day; });
  const sum = (data?.summary ?? {})[date] ?? null;
  const wsum = week && data ? Object.values(data.summary as Record<string, any>).reduce((a: any, s: any) => ({ planned: a.planned + s.planned, done: a.done + s.done, goal: a.goal + s.goal }), { planned: 0, done: 0, goal: 0 }) : null;
  return (
    <div className="page wide timebox" onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => set(null)}>
      <div className="head">
        <div>
          <h1>Mein Tag</h1>
          <p className="muted small" style={{ margin: 0 }}>Timebox für {cfg.user?.name.split(' ')[0]} — privat, ohne Kalender, schreibt nichts nach Jira. Im Raster ziehen = Block anlegen; Block ziehen = verschieben; unterer Rand = Länge.</p>
        </div>
        <div className="row tb-nav">
          <button className="btn small" onClick={() => setDate(addDays(date, week ? -7 : -1))} aria-label="zurück">‹</button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Tag" />
          <button className="btn small" onClick={() => setDate(addDays(date, week ? 7 : 1))} aria-label="vor">›</button>
          <button className="btn small" onClick={() => setDate(iso(new Date()))}>Heute</button>
          <div className="row" role="group" aria-label="Ansicht"><button className={`btn small ${!week ? 'primary' : ''}`} onClick={() => setWeek(false)}>Tag</button><button className={`btn small ${week ? 'primary' : ''}`} onClick={() => setWeek(true)}>Woche</button></div>
        </div>
      </div>
      <Err e={err} />
      {sum && (
        <div className="tb-sum card soft" data-testid="tb-summary">
          <span><b>{fmtDate(date)}</b></span>
          <span>geplant <b>{hours(sum.planned)} h</b></span>
          <span>erledigt <b>{hours(sum.done)} h</b> ({sum.doneShare} %)</span>
          <span className="tb-share" title="Anteil der geplanten Zeit auf Tickets mit Ziel (Werkbank-Zuordnung)"><span className="subbar"><span style={{ width: `${sum.goalShare}%` }} /></span> Ziele <b>{sum.goalShare} %</b> · ohne Ziel {hours(sum.noGoal)} h</span>
          {sum.moved > 0 && <span className="tiny">verschoben {hours(sum.moved)} h</span>}
          {wsum && <span className="tiny">Woche: {hours(wsum.planned)} h geplant · {hours(wsum.done)} h erledigt</span>}
          <button className="btn small" disabled={!blocksOf(date).some((b: any) => b.state !== 'erledigt' && !b.carriedTo)} onClick={async () => {
            if (!(await confirm({ title: 'Unerledigtes auf morgen übertragen?', body: <p className="small">Offene und verschobene Blöcke vom {fmtDate(date)} kommen zur selben Uhrzeit auf den {fmtDate(addDays(date, 1))}; hier bleiben sie als „verschoben“ stehen.</p>, confirmLabel: 'Übertragen' }))) return;
            call(async () => { const r: any = await api('/api/timebox/carry', { body: { date } }); toast(`${r.carried} Blöcke auf morgen übertragen`); });
          }}>↷ Unerledigtes auf morgen</button>
        </div>
      )}
      {!data ? (d.error ? <Err e={d.error} /> : <Loading />) : (
        <div className="tb-wrap">
          <div className="tb-scroll">
            <div className="tb-grid" style={{ gridTemplateColumns: `44px repeat(${dates.length}, minmax(${week ? 120 : 200}px, 1fr))` }}>
              <div />
              {dates.map((day, i) => <div key={day} className={`tb-dayhead ${day === iso(new Date()) ? 'today' : ''}`}><button className="sublink" onClick={() => { setDate(day); setWeek(false); }}>{week ? `${WD[i]} ${day.slice(8)}.${day.slice(5, 7)}.` : fmtDate(day)}</button>{week && data.summary[day]?.planned > 0 && <span className="tiny"> {hours(data.summary[day].done)}/{hours(data.summary[day].planned)} h</span>}</div>)}
              <div className="tb-times" style={{ height: H }}>
                {Array.from({ length: (g.end - g.start) / 60 + 1 }, (_, i) => <div key={i} className="tb-time" style={{ top: i * 4 * SLOT }}>{pad(g.start / 60 + i)}:00</div>)}
              </div>
              {dates.map((day) => (
                <div key={day} className="tb-col" data-col={day} style={{ height: H }} onPointerDown={(e) => onColDown(e, day)}
                  onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-ticket')) e.preventDefault(); }} onDrop={(e) => onDrop(e, day)} data-testid={`tb-col-${day}`}>
                  {op?.kind === 'create' && op.date === day && <div className="tb-ghost" style={{ top: ((op.from - g.start) / STEP) * SLOT, height: ((op.to - op.from) / STEP) * SLOT }}>{hm(op.from)}–{hm(op.to)}</div>}
                  {shownIn(day).map((b: any) => {
                    const live = op && op.kind !== 'create' && op.id === b.id ? op : null;
                    const start = live ? live.start : b.start, dur = live ? live.dur : b.dur;
                    return (
                      <div key={b.id} className={`tb-block st-${b.state} bp${b.prio ?? 0} ${b.ticket?.goals?.length ? "has-goal" : ""} ${live ? "dragging" : ""}`} data-block={b.id}
                        style={{ top: ((start - g.start) / STEP) * SLOT, height: Math.max(SLOT, (dur / STEP) * SLOT - 2) }} onPointerDown={(e) => onBlockDown(e, b, 'move')}>
                        <div className="tb-bhead">
                          <span className="tiny row" style={{ gap: 4 }}>{hm(start)}–{hm(start + dur)}
                            <button className={`prio-chip p${b.prio ?? 0}`} title="Tagespriorität (Muss/Soll/Kann) — klicken zum Wechseln" aria-label="Tagespriorität" onClick={() => call(() => api(`/api/timebox/${b.id}`, { method: 'PATCH', body: { prio: nextPrio(b.prio) } }))}>{b.prio ? PRIO[b.prio] : '·'}</button></span>
                          <span className="tb-actions">
                            <button className="btn ghost small" title={b.state === 'erledigt' ? 'wieder offen' : 'erledigt'} aria-label="erledigt" onClick={() => call(() => api(`/api/timebox/${b.id}`, { method: 'PATCH', body: { state: b.state === 'erledigt' ? 'geplant' : 'erledigt' } }))}>✓</button>
                            <button className="btn ghost small" title={b.state === 'verschoben' ? 'wieder geplant' : 'verschoben'} aria-label="verschoben" onClick={() => call(() => api(`/api/timebox/${b.id}`, { method: 'PATCH', body: { state: b.state === 'verschoben' ? 'geplant' : 'verschoben' } }))}>↷</button>
                            <button className="btn ghost small" title="löschen" aria-label="löschen" onClick={() => call(() => api(`/api/timebox/${b.id}`, { method: 'DELETE' }))}>✕</button>
                          </span>
                        </div>
                        {b.ticket ? <div className="tb-btitle"><button className="sublink" onPointerDown={(e) => e.stopPropagation()} onClick={() => setOpenKey(b.ticket.key)} title="Ticket öffnen und bearbeiten"><b>{b.ticket.key}</b> {b.ticket.summary}</button></div> : <div className="tb-btitle">{b.title || b.key}</div>}
                        {b.ticket && <div className="row" style={{ gap: 3 }}>{b.ticket.goals.map((x: string) => <span key={x} className="chip tiny-chip goal-id">🎯 {x}</span>)}{b.ticket.noGoal && <NoGoal />}<span className="chip tiny-chip">{b.ticket.status}</span>{b.ticket.priority && b.ticket.priority !== 'Medium' && <span className="chip tiny-chip">{b.ticket.priority}</span>}</div>}
                        {b.state !== 'geplant' && <span className="chip tiny-chip">{b.state}</span>}
                        <div className="tb-resize" onPointerDown={(e) => onBlockDown(e, b, 'resize')} aria-label="Länge ändern" />
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
          <aside className="tb-side card soft" aria-label="Meine offenen Tickets">
            <b>Meine offenen Tickets</b> <span className="tiny">({data.tickets.length}) · Tagesprio → Sprint → Fälligkeit → Ziel · auf den Tag ziehen, Klick öffnet</span>
            <ul className="tlist">{data.tickets.map((t: any) => (
              <li key={t.key} className="trow tb-ticket" draggable onDragStart={(e) => { e.dataTransfer.setData('application/x-ticket', t.key); e.dataTransfer.effectAllowed = 'copy'; }} data-ticket={t.key}>
                <span className="trow-s"><button className="sublink" onClick={() => setOpenKey(t.key)} title="Ticket öffnen und bearbeiten"><b>{t.key}</b> {t.summary}</button></span>
                <span className="row" style={{ gap: 3 }}>
                  <select className={`prio-sel p${t.dayPrio ?? 0}`} aria-label={`Tagespriorität ${t.key}`} value={t.dayPrio ?? ''} onChange={(e) => call(() => api('/api/timebox/prio', { body: { date, key: t.key, prio: e.target.value ? Number(e.target.value) : null } }))}>
                    <option value="">Prio –</option><option value="1">Muss</option><option value="2">Soll</option><option value="3">Kann</option>
                  </select>
                  {t.priority && <span className="chip tiny-chip" title="Jira-Priorität">{t.priority}</span>}
                  {t.noGoal && <NoGoal />}
                  {t.inSprint && <span className="chip tiny-chip ok">Sprint</span>}
                  {t.goals.map((x: string) => <span key={x} className="chip tiny-chip goal-id">🎯 {x}</span>)}
                  {t.duedate && <span className={`chip tiny-chip ${t.overdue ? 'bad' : ''}`}>{fmtDate(t.duedate)}</span>}
                  <button className="btn small" onClick={() => addToday(t.key)} aria-label={`${t.key} einplanen`}>+ {date === iso(new Date()) ? 'heute' : fmtDate(date).slice(0, 6)}</button>
                </span>
              </li>
            ))}</ul>
            {!data.tickets.length && <p className="tiny">Keine offenen Tickets auf deinen Namen in der Jira-Kopie.</p>}
          </aside>
        </div>
      )}
      {openKey && <Detail k={openKey} site={cfg.jiraSite} forge={cfg.forge} onOpenKey={setOpenKey} onClose={() => { setOpenKey(null); d.reload(); }} onChanged={() => d.reload()} />}
      {ask && (
        <div className="backdrop" onClick={() => setAsk(null)}>
          <form className="dialog" role="dialog" aria-modal="true" aria-label="Block anlegen" onClick={(e) => e.stopPropagation()} onSubmit={(e) => {
            e.preventDefault();
            const a = ask; setAsk(null);
            call(() => api('/api/timebox', { body: { ...a, title: title || undefined, key: askKey || undefined } }), 'Block angelegt');
          }}>
            <h3>Block {fmtDate(ask.date)} · {hm(ask.start)}–{hm(ask.start + ask.dur)}</h3>
            <input autoFocus placeholder="Titel (frei) …" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Titel" />
            <select value={askKey} onChange={(e) => setAskKey(e.target.value)} aria-label="oder Ticket" style={{ marginTop: 8 }}>
              <option value="">— oder an ein Ticket binden —</option>
              {data?.tickets.map((t: any) => <option key={t.key} value={t.key}>{t.key} · {t.summary.slice(0, 50)}</option>)}
            </select>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
              <button type="button" className="btn" onClick={() => setAsk(null)}>Abbrechen</button>
              <button className="btn primary" disabled={!title.trim() && !askKey}>Anlegen</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
