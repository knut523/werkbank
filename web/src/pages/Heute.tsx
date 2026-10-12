// Startseite „Heute“ (Council-Bedingung 11, docs/plan-heute-review-schlange.md): Review-Schlange → Wartet auf dich →
// Dein Tag → Tickets, die Pflege brauchen. Eine Liste „bei mir“ statt vier verstreuter.
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { api, chatTarget, fmtDateTime, type Config } from '../api.ts';
import { Err, Loading, useConfirm, useLoad, useToast, useJiraLive } from '../ui.tsx';
import { HygienePanel } from '../components.tsx';
import { WartetAufDich, Md, mineCount, note } from '../beimir.tsx';
import { OrchQuestions } from '../orchquestions.tsx';

const BIG: CSSProperties = { minHeight: 44 };
const STAND: Record<string, [string, string]> = { ja: ['✓', 'ok'], teilweise: ['◐', 'warn'], nein: ['✗', 'bad'] };
// Dieselbe Lesart wie web/server/heutekarte.ts (`nothing`): „nichts …“, „keine (…)“, „—“, auch in **Fett**.
const nothing = (t?: string | null) => !t || /^(nichts\b|keins?\s*([.(]|$)|keine\s*([.(]|$)|[—–-]+\s*$|n\/a\b|entfällt\b)/i.test(t.trim().replace(/^\*+|\*+$/g, ''));

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
      <StandChip s={it.stand} />
      <span className="tiny muted">{it.kind === 'strand' && it.running ? <span className="chip">läuft wieder</span> : null} {fmtDateTime(it.reviewReadyAt ?? it.endedAt ?? it.startedAt)}{it.kind === 'strand' && it.statusAt ? ` · Stand ${fmtDateTime(it.statusAt)}` : ''}</span>
    </div>
  );
}

const STAND_CLS: Record<string, string> = { live: 'ok', teilweise: 'warn', release: '', lokal: '', laeuft: '' };
/** Stand im Kartenkopf (Paket 141): Bedeutung im Text, die Farbe nur zusätzlich. */
function StandChip({ s }: { s?: { kind: string; text: string; branch?: string } | null }) {
  if (!s) return null;
  return <span className={`chip tiny-chip ${STAND_CLS[s.kind] ?? ''}`} data-testid="stand" title={s.branch ? `Zweig ${s.branch}` : undefined}>{s.text}</span>;
}

const SAFE_URL = /^(https?:\/\/|api\/files\/agenten\/|#\/)/i;
/** Text mit Markdown-Links: nur http(s), Werkbank-Paketdateien und interne Seiten werden Links; Bilder als „Bild ansehen“. */
function LinkMd({ text }: { text: string }) {
  const parts = text.split(/(!?\[[^\]]*\]\([^)\s]+\))/);
  return <>{parts.map((p, i) => {
    const m = p.match(/^(!?)\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (!m) return <Md key={i} text={p} />;
    const [, img, label, url] = m;
    const raw = url.split('/').pop()?.split('?')[0] ?? '';
    let name = raw;
    try { name = decodeURIComponent(raw); } catch { /* kaputtes % — Rohtext zeigen statt die Seite abstürzen zu lassen */ }
    const shown = img ? `Bild ansehen${label || name ? ` (${label || name})` : ''}` : label || url;
    return SAFE_URL.test(url) ? <a key={i} href={url} target={url.startsWith('#') ? undefined : '_blank'} rel="noreferrer">{shown}</a> : <span key={i}>{shown}</span>;
  })}</>;
}

/** Worum es geht · Was du jetzt tun sollst (Paket 141) — ohne Aufklappen. */
function Klar({ it, openBericht, berichtOpen }: { it: any; openBericht?: () => void; berichtOpen?: boolean }) {
  const r = it.review;
  const worum = it.kind === 'strand' ? it.worum || it.summary : `${it.key}${it.summary ? ` — ${it.summary}` : ''}`;
  let todo: string[] = it.kind === 'strand' ? (it.todo ?? []).map((t: any) => t.text) : [];
  if (it.kind !== 'strand' && it.bucket === 'review') todo = ['Ergebnis im Chat ansehen, dann „Passt“ oder „Nacharbeit“.', ...(r && !nothing(r.nichtGemacht) ? [`Offen geblieben: ${r.nichtGemacht}`] : [])];
  return (
    <div className="rq-klar">
      {worum && <p className="small rq-worum"><strong className="rq-label">Worum es geht:</strong> <Md text={worum} /></p>}
      <div className="small rq-todo">
        <strong className="rq-label">Was du jetzt tun sollst:</strong>
        {it.running ? <span> Agent arbeitet noch — später wiederkommen.</span>
          : todo.length ? <><ol>{todo.map((t, i) => <li key={i}><LinkMd text={t} /></li>)}</ol>{it.todoMore > 0 && <p className="tiny muted rq-more">+ {it.todoMore} {it.todoMore === 1 ? 'weiterer Punkt' : 'weitere Punkte'} im {it.docs?.bericht && openBericht ? <button className="linklike" aria-expanded={!!berichtOpen} onClick={openBericht}>Bericht</button> : it.bericht ? <a href={`#/leitstand?bericht=${it.id}`}>Bericht</a> : 'Bericht'}</p>}</>
          : <span> Nichts zu tun außer lesen — dann „Passt“.</span>}
      </div>
    </div>
  );
}

function ReviewBody({ it }: { it: any }) {
  const r = it.review;
  // Strang ohne review_ready (Teil B, E10): der „### Stand“-Auszug der letzten Antwort — jetzt unter „Details“.
  if (!r) return it.kind === 'strand' && it.excerpt ? <details className="rq-body small rq-details"><summary>Letzter Stand des Strangs</summary><div style={{ whiteSpace: 'pre-wrap' }}><Md text={it.excerpt} /></div></details> : null;
  const risk = !nothing(r.risiko);
  return (
    <details className="rq-body rq-details" data-testid="details">
      <summary className="small">Was gemacht wurde · DoD {r.dod.filter((d: any) => d.stand === 'ja').length} von {r.dod.length}{!nothing(r.nichtGemacht) ? ' · etwas offen' : ''}{risk ? ' · ⚠ Risiko genannt' : ''}</summary>
      {it.reviewOld && <p className="tiny muted">Älterer Stand (vor der letzten Nachricht an den Strang).</p>}
      <p className="small"><b>Gemacht:</b> <Md text={r.gemacht} /></p>
      {!nothing(r.nichtGemacht) && <p className="small rq-warn"><b>Nicht gemacht:</b> <Md text={r.nichtGemacht} /></p>}
      <p className="small" style={{ marginBottom: 0 }}><b>DoD: {r.dod.filter((d: any) => d.stand === 'ja').length} von {r.dod.length} erfüllt</b></p>
      <ul className="plain dod small">{r.dod.map((d: any, i: number) => <li key={i}><span className={`chip tiny-chip ${STAND[d.stand][1]}`} aria-label={d.stand}>{STAND[d.stand][0]}</span><span className="dod-text"><Md text={d.punkt} />{d.beleg && <span className="tiny muted dod-beleg"> · <Md text={d.beleg} /></span>}</span></li>)}</ul>
      {(r.artefakte.length > 0 || it.written.length > 0) && <div className="tiny rq-files">
        {r.artefakte.map((a: string) => <span key={a} className="chip tiny-chip">{a}</span>)}
        {it.written.filter((w: any) => w.vault).map((w: any) => <a key={w.vault} className="chip tiny-chip" href={note(w.vault)}>📄 {w.vault.split('/').pop()}</a>)}
      </div>}
    </details>
  );
}

type Doc = 'auftrag' | 'bericht';
/** Zuklappen: Fokus zurück auf den Knopf, der geöffnet hat (Review Nachtrag 3). */
const closeDoc = (id: string, doc: Doc, setDoc: (d: Doc | null) => void) => { setDoc(null); setTimeout(() => document.getElementById(`doc-btn-${id}-${doc}`)?.focus(), 0); };
const paketDoc = (paket: string, doc: Doc) => `api/files/agenten/${encodeURIComponent(paket)}/${doc}.md`;

/** Auftrag oder Bericht des Pakets direkt in der Karte (Knut 12.10.: „Heute“ ist DIE Übersicht — keine andere Seite). */
function DocView({ paket, doc, onClose }: { paket: string; doc: Doc; onClose: () => void }) {
  const d = useLoad(() => api(`${paketDoc(paket, doc)}?vorschau=1`), [paket, doc]);
  const data: any = d.data;
  // Aufgeklappt → ins Bild rücken und Fokus hinein (sonst passiert auf dem Handy sichtbar nichts, Review Nachtrag 3).
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.scrollIntoView({ block: 'nearest' }); ref.current?.focus({ preventScroll: true }); }, [paket, doc]);
  return (
    <div className="rq-doc" ref={ref} tabIndex={-1} data-testid={`doc-${doc}`} role="region" aria-label={doc === 'auftrag' ? 'Auftrag' : 'Bericht'}>
      <div className="row rq-doc-head"><b>{doc === 'auftrag' ? 'Auftrag' : 'Bericht'}</b> <span className="tiny muted">{paket}/{doc}.md</span>
        <a className="tiny" href={paketDoc(paket, doc)} target="_blank" rel="noreferrer">Datei</a>
        <button className="btn ghost small" onClick={onClose}>Zuklappen</button></div>
      {d.error ? <Err e={d.error} /> : !data ? <Loading /> : <div className="note-body" dangerouslySetInnerHTML={{ __html: data.html ?? '' }} />}
    </div>
  );
}

/** Knöpfe Auftrag · Bericht (klappen in der Karte auf) — nur, wenn die Datei im Paket liegt. */
function DocButtons({ it, doc, setDoc, small }: { it: any; doc: Doc | null; setDoc: (d: Doc | null) => void; small?: boolean }) {
  if (!it.paket) return null;
  const b = (k: Doc, label: string) => it.docs?.[k] && <button key={k} className={`btn ghost small${small ? ' rq-link' : ''}`} style={small ? undefined : BIG} aria-expanded={doc === k} id={`doc-btn-${it.id}-${k}`} data-testid={`btn-${k}`} onClick={() => setDoc(doc === k ? null : k)}>{label}{doc === k ? ' ▴' : ' ▾'}</button>;
  return <>{b('auftrag', 'Auftrag')}{b('bericht', 'Bericht')}</>;
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
  const [doc, setDoc] = useState<Doc | null>(null);
  // Auftrag · Bericht · Chat (Knut 12.10.): Strang-Karten öffnen Auftrag und Bericht in der Karte, nicht auf einer anderen Seite.
  const open = <><DocButtons it={it} doc={doc} setDoc={setDoc} />{it.url && <a className="btn small ghost" style={BIG} href={it.url} target={chatTarget}>Chat öffnen</a>}{!it.paket && it.auftrag && <a className="btn small ghost" style={BIG} href={`#/leitstand?auftrag=${it.id}`}>Auftrag</a>}{!it.paket && it.bericht && <a className="btn small ghost" style={BIG} href={`#/leitstand?bericht=${it.id}`}>Bericht</a>}</>;

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
      {it.bucket === 'review' && <Klar it={it} berichtOpen={doc === 'bericht'} openBericht={() => setDoc(doc === 'bericht' ? null : 'bericht')} />}
      <ReviewBody it={it} />
      {it.bucket === 'review' && <>
        {it.review && !nothing(it.review.risiko) && <p className="small rq-risk rq-risk-line" data-testid="risk-line"><b>⚠ Risiko:</b> <Md text={it.review.risiko} max={200} /></p>}
        <div className="row rq-actions">
          <button className="btn primary" style={BIG} disabled={busy || it.running} onClick={passt} aria-describedby={`hint-${it.id}`}>Passt</button>
          <button className="btn" style={BIG} disabled={busy || it.running} aria-expanded={rework !== null} onClick={() => setRework(rework === null ? '' : null)} aria-describedby={`hint-${it.id}`}>Nacharbeit</button>
          {open}
          {it.kind !== 'strand' && <label className="small row rq-check" style={{ gap: 6 }}><input type="checkbox" checked={comment} onChange={(e) => setComment(e.target.checked)} /> mit Jira-Kommentar</label>}
          {it.kind === 'strand' && it.reviewedBy === 'leitstand' && <span className="tiny muted">vom Hauptchat abgelegt</span>}
        </div>
        <p className="tiny muted rq-hint" id={`hint-${it.id}`} data-testid="passt-hint">{comment
          ? <><b>Passt</b> = geprüft, und nach deiner Bestätigung ein Kommentar in {it.key} (Jira).</>
          : <><b>Passt</b> = nur als geprüft markieren, nichts wird geschrieben{it.kind === 'strand' ? ', der Strang ruht' : ''}.</>}
          {' '}<b>Nacharbeit</b> = dein Text geht an den Agenten, er macht weiter.</p>
        {rework !== null && <div className="rq-rework">
          <label className="small" htmlFor={`rw-${it.id}`}>Was soll der Agent nacharbeiten?</label>
          <textarea id={`rw-${it.id}`} rows={3} value={rework} onChange={(e) => setRework(e.target.value)} placeholder="z. B. Test für den Fehlerfall ergänzen" />
          <div className="row"><button className="btn primary small" style={BIG} disabled={busy || !rework.trim()} onClick={() => reply('nacharbeit', rework)}>Zurück an den Agenten</button><button className="btn ghost small" style={BIG} onClick={() => setRework(null)}>Abbrechen</button></div>
        </div>}
      </>}
      {it.rework && it.bucket !== 'review' && <p className="tiny muted">Nacharbeit {fmtDateTime(it.rework.at)}: {it.rework.text}</p>}
      {doc && it.paket && <DocView paket={it.paket} doc={doc} onClose={() => closeDoc(it.id, doc, setDoc)} />}
      <Err e={err} />
    </article>
  );
}

/** Eine Zeile der Live-Gruppe: Titel, Stand, Auftrag · Bericht (klappen auf) · Chat. */
function LiveRow({ x, why }: { x: any; why?: string }) {
  const [doc, setDoc] = useState<Doc | null>(null);
  return (
    <li data-testid="live-item">
      <div className="rq-live-row">
        <span className="rq-title">{x.summary}</span> <StandChip s={x.stand} />
        <DocButtons it={x} doc={doc} setDoc={setDoc} small />
        {x.url && <a className="small rq-link" href={x.url} target={chatTarget}>Chat</a>}
        {why && <span className="tiny rq-warn">übersprungen: {why}</span>}
      </div>
      {doc && x.paket && <DocView paket={x.paket} doc={doc} onClose={() => closeDoc(x.id, doc, setDoc)} />}
    </li>
  );
}

/** Schon live gegangene Stränge (Paket 141): eingeklappt, je Strang eine Zeile, gesammelt abhaken mit Bestätigung. */
function LiveGroup({ items, onDone }: { items: any[]; onDone: () => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [skipped, setSkipped] = useState<Record<string, string>>({});
  const all = async () => {
    const n = items.length;
    if (!(await confirm({ title: `${n} live gegangene ${n === 1 ? 'Strang' : 'Stränge'} abhaken?`, confirmLabel: `${n} abhaken`,
      body: <><p className="small">Sie werden als geprüft markiert. Nichts wird geschrieben, gepusht oder gemergt. Die Werkbank prüft vorher noch einmal, ob jeder wirklich live ist.</p><ul className="small">{items.map((x) => <li key={x.id}>{x.summary} · {x.stand.text}</li>)}</ul></> }))) return;
    setBusy(true); setErr(null);
    try {
      const r: any = await api('/api/leitstand/strands/passt-live', { body: { items: items.map((x) => ({ id: x.id, seen: x.seen })) } });
      setSkipped(Object.fromEntries(r.skipped.map((x: any) => [x.id, x.why])));
      const title = (id: string) => items.find((x) => x.id === id)?.summary ?? id;
      toast(`${r.done.length} abgehakt${r.skipped.length ? ` · übersprungen: ${r.skipped.map((x: any) => `${title(x.id)} (${x.why})`).join(', ')}` : ''}`);
      onDone();
    } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div className="card rq rq-live" data-testid="live-group">
      <details>
        <summary><b>Schon live — nur noch abhaken ({items.length})</b> <span className="small muted">· Liste zeigen</span></summary>
        <p className="small muted">Diese Stränge sind auf der Werkbank live. Zu prüfen gibt es nichts mehr — abhaken räumt sie von hier weg.</p>
        <ul className="plain rq-live-list">{items.map((x) => <LiveRow key={x.id} x={x} why={skipped[x.id]} />)}</ul>
      </details>
      <div className="row rq-actions">
        <button className="btn primary" style={BIG} disabled={busy} onClick={all} data-testid="passt-live">Alle {items.length} als geprüft markieren</button>
      </div>
      <Err e={err} />
    </div>
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

  const allReview = [...(d.strands ?? []), ...d.queue.filter((x: any) => x.bucket === 'review')];
  // Schon live (Paket 141): eigene, eingeklappte Gruppe am Ende; die Zahl am Abschnitt zählt nur, was zu prüfen ist.
  const isLive = (x: any) => x.kind === 'strand' && x.stand?.kind === 'live' && !x.running;
  const liveDone = allReview.filter(isLive);
  // Karten mit Aufgaben für dich zuerst (stabil: sonst bleibt die Reihenfolge der Schlange).
  const hasTodo = (x: any) => x.kind !== 'strand' || (x.todo ?? []).length > 0 || (x.review && !nothing(x.review.risiko));
  const review = allReview.filter((x) => !isLive(x)).sort((a, b) => Number(hasTodo(b)) - Number(hasTodo(a)));
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
      {allReview.length > 0 && showWaiting && <p className="row small rq-jump" data-testid="jump">Springen zu:
        <button className="btn ghost small" onClick={() => document.querySelector('[data-testid="review-queue"]')?.scrollIntoView()}>Zu prüfen ({review.length})</button>
        <button className="btn ghost small" onClick={() => document.querySelector('[data-testid="waiting"]')?.scrollIntoView()}>Wartet auf dich ({nMine})</button>
      </p>}
      {d.memory && <div className="card soft" role="status" data-testid="memory-warning"><b>⚠️ Speicher knapp:</b> <span className="small">{d.memory}. Neue Chats und Agenten können langsam werden oder abbrechen — Testinstanzen stoppen, wartende Chats beantworten.</span></div>}
      {running.length > 0 && <p className="small muted" data-testid="running">⏳ {running.length === 1 ? 'Ein Agent arbeitet' : `${running.length} Agenten arbeiten`} gerade: {running.map((x: any, i: number) => <span key={x.id}>{i ? ', ' : ''}{x.url ? <a href={x.url} target={chatTarget}>{x.key}</a> : x.key}</span>)}</p>}

      {d.leitstand && <p className="small muted" data-testid="leitstand">🛰️ Hauptchat: <b>{d.leitstand.status}</b>{d.leitstand.open > 0 ? ` · ${d.leitstand.open} Meldung${d.leitstand.open === 1 ? '' : 'en'} unterwegs` : ''} · <a href={d.leitstand.url} target={chatTarget}>Chat öffnen</a> · <a href="#/leitstand">Unter-Chats</a></p>}

      {(d.orchAuto ?? []).length > 0 && <p className="small muted" data-testid="orch-auto">🔁 Orchestrator, automatisch fortgesetzt: {d.orchAuto.map((x: any, i: number) => <span key={x.id}>{i ? ', ' : ''}<a href={x.url} target={chatTarget}>{x.title}</a> ({x.n}){x.stopped ? ' — angehalten' : ''}</span>)}</p>}

      {allReview.length > 0 && <section data-testid="review-queue">
        <h2>Wartet auf dein Review {review.length > 0 ? <span className="chip">{review.length}</span> : <span className="small muted">— nichts zu prüfen</span>}</h2>
        {review.map((it: any) => <RunCard key={it.id} it={it} onDone={reload} />)}
        {liveDone.length > 0 && <LiveGroup items={liveDone} onDone={reload} />}
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

      {allReview.length === 0 && nMine === 0 && <div className="card soft empty" data-testid="today-empty">
        <p><b>Nichts wartet auf dein Review.</b></p>
        <p className="small muted">Neue Arbeit findest du auf der <a href="#/roadmap">Roadmap</a> (Als Nächstes) oder am <a href="#/board">Board</a>.</p>
      </div>}
    </div>
  );
}
