// Startseite „Heute“ (Council-Bedingung 11, docs/plan-heute-review-schlange.md): Review-Schlange → Wartet auf dich →
// Dein Tag → Tickets, die Pflege brauchen. Eine Liste „bei mir“ statt vier verstreuter.
import { useEffect, useState, type CSSProperties } from 'react';
import { api, chatTarget, fmtDateTime, type Config } from '../api.ts';
import { Err, Loading, useConfirm, useLoad, useToast, useJiraLive } from '../ui.tsx';
import { HygienePanel } from '../components.tsx';
import { WartetAufDich, Md, mineCount, note } from '../beimir.tsx';
import { OrchQuestions } from '../orchquestions.tsx';

const BIG: CSSProperties = { minHeight: 44 };
const STAND: Record<string, [string, string]> = { ja: ['✓', 'ok'], teilweise: ['◐', 'warn'], nein: ['✗', 'bad'] };
const nothing = (t?: string) => !t || /^(nichts|keins?|keine|—|-|n\/a|entfällt)\.?$/i.test(t.trim());

/** Nachtbau: von G0 vor dem Bau gestoppte Stränge (blocked_g0) mit Belegen; entschieden wird in der Rückfrage darunter. */
function G0Blocked({ items }: { items: any[] }) {
  return (
    <div className="card" data-testid="g0-blocked">
      <h3 style={{ marginTop: 0 }}>Vor dem Bau gestoppt <span className="chip warn">{items.length}</span></h3>
      <p className="small muted" style={{ marginTop: -6 }}>Der Nachtbau hat diese Aufträge nicht gestartet: die Prüfung vor dem Bau hat vorhandene Arbeit gefunden.</p>
      {items.map((it) => (
        <div key={it.id} data-testid="g0-blocked-item" style={{ borderTop: '1px solid var(--line, #ddd)', paddingTop: 8, marginTop: 8 }}>
          <div><b>{it.title}</b> <span className="chip tiny-chip warn" title="Strang-Zustand blocked_g0: von der Prüfung vor dem Bau (G0) angehalten">angehalten (blocked_g0)</span> <span className="tiny">· {it.slug} · {fmtDateTime(it.startedAt)}</span></div>
          {it.g0?.belege?.length > 0 && <ul className="small" style={{ paddingLeft: 18, margin: '4px 0' }}>{it.g0.belege.map((b: any, i: number) => <li key={i}>{b.text}{b.pr && <> · <a href={b.pr} target="_blank" rel="noreferrer">PR ansehen</a></>}</li>)}</ul>}
          <div className="small">{!it.question ? 'Keine Rückfrage angelegt — Orchestrator fragen.'
            : it.question.status === 'offen' ? <>Entscheidung offen: unten bei den Rückfragen ({it.question.id}).</>
            : it.question.status === 'beantwortet' ? <>Deine Wahl: <b>{it.question.option ?? 'Antwort als Text'}</b> — gilt ab dem nächsten Nachtbau.</>
            : 'Rückfrage zurückgezogen.'}</div>
        </div>))}
    </div>
  );
}

function Head({ it }: { it: any }) {
  return (
    <div className="rq-head">
      {it.kind === 'strand' ? <a href="#/leitstand" className="rq-key">{it.key}</a> : <a href={`#/board?key=${it.key}`} className="rq-key">{it.key}</a>}
      <span className="rq-title">{it.summary ?? ''}</span>
      <span className="tiny muted">{it.kind === 'strand' && it.running ? <span className="chip">läuft wieder</span> : null} {fmtDateTime(it.reviewReadyAt ?? it.endedAt ?? it.startedAt)}{it.kind === 'strand' && it.statusAt ? ` · Stand ${fmtDateTime(it.statusAt)}` : ''}</span>
    </div>
  );
}

function ReviewBody({ it }: { it: any }) {
  const r = it.review;
  // Strang ohne review_ready (Teil B, E10): der „### Stand“-Auszug der letzten Antwort.
  if (!r) return it.kind === 'strand' && it.excerpt ? <div className="rq-body small" style={{ whiteSpace: 'pre-wrap' }}><Md text={it.excerpt} /></div> : null;
  return (
    <div className="rq-body">
      {it.reviewOld && <p className="tiny muted">Älterer Stand (vor der letzten Nachricht an den Strang).</p>}
      <p className="small"><b>Gemacht:</b> <Md text={r.gemacht} /></p>
      {!nothing(r.nichtGemacht) && <p className="small rq-warn"><b>Nicht gemacht:</b> <Md text={r.nichtGemacht} /></p>}
      {!nothing(r.risiko) && <p className="small rq-risk"><b>Risiko:</b> <Md text={r.risiko} /></p>}
      <details open={r.dod.length <= 4} className="small">
        <summary>DoD: {r.dod.filter((d: any) => d.stand === 'ja').length} von {r.dod.length} erfüllt</summary>
        <ul className="plain dod">{r.dod.map((d: any, i: number) => <li key={i}><span className={`chip tiny-chip ${STAND[d.stand][1]}`} aria-label={d.stand}>{STAND[d.stand][0]}</span><span className="dod-text"><Md text={d.punkt} />{d.beleg && <span className="tiny muted dod-beleg"> · <Md text={d.beleg} /></span>}</span></li>)}</ul>
      </details>
      {(r.artefakte.length > 0 || it.written.length > 0) && <div className="tiny rq-files">
        {r.artefakte.map((a: string) => <span key={a} className="chip tiny-chip">{a}</span>)}
        {it.written.filter((w: any) => w.vault).map((w: any) => <a key={w.vault} className="chip tiny-chip" href={note(w.vault)}>📄 {w.vault.split('/').pop()}</a>)}
      </div>}
    </div>
  );
}

function RunCard({ it, onDone }: { it: any; onDone: () => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [rework, setRework] = useState<string | null>(null);
  const [comment, setComment] = useState(false);
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); try { await fn(); onDone(); } catch (e) { setErr(e); } finally { setBusy(false); } };
  // Strang-Karten (Teil B, F4): eigener Pfad, gesehener Stand mit, kein Jira.
  const base = it.kind === 'strand' ? `/api/leitstand/strands/${it.id}` : `/api/runs/${it.id}`;
  const extra = it.kind === 'strand' ? { seen: it.seen } : {};
  const reply = (kind: 'antwort' | 'nacharbeit' | 'weiter', text = '') => run(async () => {
    await api(`${base}/reply`, { body: { kind, text, ...extra } });
    toast(kind === 'nacharbeit' ? 'Zurück an den Agenten' : kind === 'weiter' ? 'Agent macht weiter' : 'Antwort im Chat');
    setRework(null);
  });
  const passt = () => run(async () => {
    if (comment) {
      const p: any = await api(`/api/runs/${it.id}/passt`, { body: { comment: true } });
      if (!(await confirm({ title: `Kommentar auf ${it.key} schreiben?`, confirmLabel: 'In Jira schreiben', body: <><p className="small">Der Lauf wird als geprüft markiert, und dieser Kommentar geht mit deinem Jira-Zugang an {it.key}. Den Status setzt du selbst.</p><pre className="small" style={{ whiteSpace: 'pre-wrap' }}>{p.text}</pre></> }))) return;
      await api(`/api/runs/${it.id}/passt`, { body: { comment: true, confirm: true } });
    } else await api(`${base}/passt`, { body: { ...extra } });
    toast(`${it.kind === 'strand' ? it.summary : it.key} geprüft`);
  });
  const open = <>{it.url && <a className="btn small ghost" style={BIG} href={it.url} target={chatTarget}>Chat öffnen</a>}{it.bericht && <a className="btn small ghost" style={BIG} href={`#/leitstand?bericht=${it.id}`}>Bericht</a>}</>;

  return (
    <article className={`card rq rq-${it.bucket}`} data-run={it.id} data-bucket={it.bucket}>
      <Head it={it} />
      {it.bucket === 'frage' && <div className="rq-q">
        <p className="small"><b>Der Agent fragt:</b> {it.question ?? 'Freigabe im Chat (Text dort)'}</p>
        <div className="row rq-actions">
          <button className="btn small yes" style={BIG} disabled={busy} onClick={() => reply('antwort', 'ja')}>✅ Ja</button>
          <button className="btn small ghost" style={BIG} disabled={busy} onClick={() => reply('antwort', 'nein')}>✖️ Nein</button>
          {open}
        </div>
        <p className="tiny muted">Die Antwort geht in denselben Chat. Ist er gerade in einem Tab offen, dort neu laden.</p>
      </div>}
      {(it.bucket === 'haengt' || it.bucket === 'still') && <div className="rq-q">
        <p className="small">{it.bucket === 'haengt' ? <><span className="chip bad">hängt</span> {it.endText}.</> : <>Hat ohne „bereit zum Review“ aufgehört — meist steht eine Frage im Chat.</>}</p>
        <div className="row rq-actions">
          {open}
          {it.bucket === 'haengt' && <button className="btn small" style={BIG} disabled={busy} onClick={() => reply('weiter')}>Weiter</button>}
          <button className="btn small ghost" style={BIG} disabled={busy} onClick={() => run(async () => { await api(`/api/runs/${it.id}/passt`, { body: {} }); toast('Ausgeblendet'); })}>Erledigt</button>
        </div>
      </div>}
      <ReviewBody it={it} />
      {it.bucket === 'review' && <>
        <div className="row rq-actions">
          <button className="btn primary" style={BIG} disabled={busy || it.running} onClick={passt}>Passt</button>
          <button className="btn" style={BIG} disabled={busy || it.running} aria-expanded={rework !== null} onClick={() => setRework(rework === null ? '' : null)}>Nacharbeit</button>
          {open}
          {it.kind !== 'strand' && <label className="small row" style={{ gap: 6 }}><input type="checkbox" checked={comment} onChange={(e) => setComment(e.target.checked)} /> mit Jira-Kommentar</label>}
          {it.kind === 'strand' && it.reviewedBy === 'leitstand' && <span className="tiny muted">vom Leitstand abgelegt</span>}
        </div>
        {rework !== null && <div className="rq-rework">
          <label className="small" htmlFor={`rw-${it.id}`}>Was soll der Agent nacharbeiten?</label>
          <textarea id={`rw-${it.id}`} rows={3} value={rework} onChange={(e) => setRework(e.target.value)} placeholder="z. B. Test für den Fehlerfall ergänzen" />
          <div className="row"><button className="btn primary small" style={BIG} disabled={busy || !rework.trim()} onClick={() => reply('nacharbeit', rework)}>Zurück an den Agenten</button><button className="btn ghost small" style={BIG} onClick={() => setRework(null)}>Abbrechen</button></div>
        </div>}
      </>}
      {it.rework && it.bucket !== 'review' && <p className="tiny muted">Nacharbeit {fmtDateTime(it.rework.at)}: {it.rework.text}</p>}
      <Err e={err} />
    </article>
  );
}

export function Heute({ cfg }: { cfg: Config }) {
  const t = useLoad(() => api('/api/today'));
  const d: any = t.data;
  const admin = cfg.user?.role === 'ADMIN';
  // Offene Entscheidungen sind Knuts Zeilen im Vault („- Knut:“) → nur für Admins, nachgeladen (liest alle Specs).
  // Bereinigt (docs/plan-heute-fragen-aktuell.md): ohne Live/Archiv, Überholtes und Dubletten — die stehen unter „Aufräumen“.
  const [vq, setVq] = useState<{ open: any[]; cleanup: any[]; raw: number; duplicates: number } | null>(null);
  useEffect(() => { if (admin) api('/api/roadmap/heute').then((r: any) => setVq(r)).catch(() => {}); }, [admin]);
  const decisions = vq?.open ?? [];
  useJiraLive(() => { api('/api/today').then(t.setData).catch(() => {}); }, 'both');
  // Solange ein Agent arbeitet oder fragt: alle 20 s nachsehen.
  const busy = d?.queue.some((x: any) => x.bucket === 'laeuft' || x.bucket === 'frage');
  useEffect(() => { if (!busy) return; const id = setInterval(() => api('/api/today').then(t.setData).catch(() => {}), 20_000); return () => clearInterval(id); }, [busy]);
  if (t.error) return <div className="page"><Err e={t.error} /></div>;
  if (!d) return <div className="page"><Loading /></div>;

  const review = [...(d.strands ?? []), ...d.queue.filter((x: any) => x.bucket === 'review')];
  const waitingRuns = d.queue.filter((x: any) => ['frage', 'haengt', 'still'].includes(x.bucket));
  const running = d.queue.filter((x: any) => x.bucket === 'laeuft');
  const orchOpen = d.orchOpen ?? 0;
  // Die Zahl an „Wartet auf dich“ = die Plakette „Heute (n)“: offene Vault-Entscheidungen (auch bereinigt noch Hunderte,
  // ein Rückstand) stehen darunter mit eigener Zahl — der bereinigten —, zählen aber nicht mit (Release-Audit 11.10.2026:
  // 445 neben einer Plakette 2; bereinigt 11.10.: 465 Zeilen → 294 offen, docs/plan-heute-fragen-aktuell.md).
  const nMine = waitingRuns.length + mineCount(d.mine, []) + orchOpen;
  const g0: any[] = d.g0 ?? [];
  const showWaiting = nMine > 0 || decisions.length > 0 || (vq?.cleanup.length ?? 0) > 0 || g0.length > 0;
  const reload = () => t.reload();
  const first = cfg.user?.name.split(' ')[0] ?? '';

  return (
    <div className="page heute">
      <div className="head">
        <div>
          <h1>Heute</h1>
          <p className="muted small" style={{ margin: 0 }}>{first ? `${first}, das` : 'Das'} wartet auf dich — zuerst fertige Agenten, dann Fragen, dann dein Tag.</p>
        </div>
      </div>
      {d.dryRun && <p className="chip warn">Vorschau (Trockenlauf): Antworten an Agenten sind aus.</p>}
      {d.memory && <div className="card soft" role="status" data-testid="memory-warning"><b>⚠️ Speicher knapp:</b> <span className="small">{d.memory}. Neue Chats und Agenten können langsam werden oder abbrechen — Testinstanzen stoppen, wartende Chats beantworten.</span></div>}
      {running.length > 0 && <p className="small muted" data-testid="running">⏳ {running.length === 1 ? 'Ein Agent arbeitet' : `${running.length} Agenten arbeiten`} gerade: {running.map((x: any, i: number) => <span key={x.id}>{i ? ', ' : ''}{x.url ? <a href={x.url} target={chatTarget}>{x.key}</a> : x.key}</span>)}</p>}

      {d.leitstand && <p className="small muted" data-testid="leitstand">🛰️ Leitstand: <b>{d.leitstand.status}</b>{d.leitstand.open > 0 ? ` · ${d.leitstand.open} Meldung${d.leitstand.open === 1 ? '' : 'en'} unterwegs` : ''} · <a href={d.leitstand.url} target={chatTarget}>Chat öffnen</a> · <a href="#/leitstand">Übersicht</a></p>}

      {(d.orchAuto ?? []).length > 0 && <p className="small muted" data-testid="orch-auto">🔁 Orchestrator, automatisch fortgesetzt: {d.orchAuto.map((x: any, i: number) => <span key={x.id}>{i ? ', ' : ''}<a href={x.url} target={chatTarget}>{x.title}</a> ({x.n}){x.stopped ? ' — angehalten' : ''}</span>)}</p>}

      {review.length > 0 && <section data-testid="review-queue">
        <h2>Wartet auf dein Review <span className="chip">{review.length}</span></h2>
        {review.map((it: any) => <RunCard key={it.id} it={it} onDone={reload} />)}
      </section>}

      {showWaiting && <section data-testid="waiting">
        <h2>Wartet auf dich <span className="chip">{nMine}</span></h2>
        {g0.length > 0 && <G0Blocked items={g0} />}
        {orchOpen > 0 && <OrchQuestions onChange={reload} />}
        {waitingRuns.map((it: any) => <RunCard key={it.id} it={it} onDone={reload} />)}
        {mineCount(d.mine, decisions) + (vq?.cleanup.length ?? 0) > 0 && <div className="card"><WartetAufDich x={d.mine} decisions={decisions} today={vq ?? undefined} onChange={reload} /></div>}
      </section>}

      <section data-testid="day">
        <h2>Dein Tag</h2>
        {d.day.length
          ? <ul className="plain card day-list">{d.day.map((b: any) => <li key={b.id} className={b.done ? 'done' : ''}><span className="tiny mono">{b.start}–{b.end}</span> {b.key ? <a href={`#/board?key=${b.key}`}>{b.key}</a> : null} {b.title ?? b.summary ?? ''}</li>)}</ul>
          : <p className="small muted">Noch nichts geplant.</p>}
        <a className="small" href="#/timebox">Mein Tag öffnen →</a>
      </section>

      <section data-testid="tickets">
        <HygienePanel max={5} title="Deine Tickets" heading="Tickets, die Pflege brauchen" onChange={reload} />
      </section>

      {review.length === 0 && nMine === 0 && <div className="card soft empty" data-testid="today-empty">
        <p><b>Nichts wartet auf dein Review.</b></p>
        <p className="small muted">Neue Arbeit findest du auf der <a href="#/roadmap">Roadmap</a> (Als Nächstes) oder am <a href="#/board">Board</a>.</p>
      </div>}
    </div>
  );
}
