// PR-Ticker (Plan 157; seit Paket 187 aufgeteilt): Schalter und Deckel in der Einrichtung (Automatik), Liste „was ist neu“
// und Auto-Reviews unter Planen › Roadmap › PRs. Und in der Review-Ansicht der Abschnitt „PR-Review“ mit Empfehlung,
// Entwurf und Knuts Klicks (Kommentar / Freigeben / Änderungen verlangen).
import { useEffect, useState } from 'react';
import { api, chatTarget, fmtDateTime } from './api.ts';
import { Err, Loading, useLoad } from './ui.tsx';

const KIND: Record<string, string> = { neu: '🆕', stand: '⬆️', zu: '🏁', kommentar: '💬', review: '🔎', anfrage: '🙋', tag: '🏷️' };
const STATUS_CHIP: Record<string, string> = { wartet: '', startet: '', läuft: '', gegenprüfung: '', abgleich: '', fertig: 'ok', deckel: 'warn', fehler: 'bad', übersprungen: '' };
const uhr = (d: string) => new Date(d).toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' });
const EMPF: Record<string, { t: string; c: string }> = { approve: { t: 'approven', c: 'ok' }, 'request-changes': { t: 'Änderungen verlangen', c: 'bad' }, comment: { t: 'nur kommentieren', c: 'warn' } };
const short = (repo: string) => repo.split('/')[1] ?? repo;

function Schalter({ label, an, onChange, testid, hint, disabled }: { label: string; an: boolean; onChange: (v: boolean) => void; testid: string; hint?: string; disabled?: boolean }) {
  return (
    <label className="row small" style={{ gap: 6, alignItems: 'center' }} title={hint}>
      <input type="checkbox" role="switch" checked={an} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testid} />
      <span>{label}</span> <span className={`chip ${an ? 'ok' : ''}`}>{an ? 'an' : 'aus'}</span>
    </label>
  );
}

/** Gemeinsamer Zustand für Schalter (Einrichtung › Automatik) und Meldungen (Planen › Roadmap › PRs). */
function useTicker() {
  const t = useLoad(() => api('/api/leitstand/ticker'));
  const d: any = t.data;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [allow, setAllow] = useState('');
  useEffect(() => { if (d) setAllow(d.settings.allow.join(', ')); }, [d?.settings?.allow?.join(',')]);
  useEffect(() => { const id = setInterval(() => api('/api/leitstand/ticker').then(t.setData).catch(() => {}), 60_000); return () => clearInterval(id); }, []);
  const set = async (patch: any, ok = 'Gespeichert.') => {
    setBusy(true); setMsg(null);
    try { await api('/api/leitstand/ticker/einstellungen', { body: patch }); setMsg({ ok: true, text: ok }); t.reload(); }
    catch (e: any) { setMsg({ ok: false, text: String(e?.message ?? e) }); } finally { setBusy(false); }
  };
  return { t, d, busy, msg, allow, setAllow, set };
}

function Fehler({ t }: { t: any }) {
  return <section className="card">{t.error ? <Err e={t.error} /> : <Loading />}</section>;
}

/** Schalter, Deckel und Protokoll des PR-Tickers (Einrichtung › Automatik). */
export function PrTickerSchalter() {
  const { t, d, busy, msg, allow, setAllow, set } = useTicker();
  if (!d) return <Fehler t={t} />;
  const s = d.settings;
  return (
    <section className="card" data-testid="pr-ticker" style={{ marginBottom: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>PR-Ticker</h2>
        <span className="tiny muted">
          {d.aus ? <>abgeschaltet · <details className="tiny" style={{ display: 'inline' }}><summary style={{ display: 'inline', cursor: 'pointer' }}>Technische Details</summary> Schalter WERKBANK_PR_TICKER=off</details></> : d.lauf?.at ? `zuletzt ${fmtDateTime(d.lauf.at)} · ${d.scopes.join(' + ')}` : 'noch keine Prüfung'}
          {d.lauf?.rate ? ` · GitHub-Kontingent ${d.lauf.rate.remaining}` : ''}
        </span>
      </div>
      {d.lauf?.error && <p className="small err" data-testid="ticker-fehler">⚠️ {d.lauf.error}</p>}
      <div className="row" style={{ gap: 16, flexWrap: 'wrap', margin: '8px 0' }} data-testid="ticker-schalter">
        <Schalter label="Ticker" an={s.ticker} disabled={busy} testid="schalter-ticker" onChange={(v) => set({ ticker: v }, v ? 'Ticker an — erster Abruf in spätestens einer Minute.' : 'Ticker aus.')} hint={`alle ${s.minutes} min neue PRs, Stände, Reviews und Kommentare`} />
        <Schalter label="Auto-Review bei @review" an={s.autoReview} disabled={busy || !s.ticker} testid="schalter-autoreview" onChange={(v) => set({ autoReview: v }, v ? 'Auto-Review an — zählt @review ab jetzt.' : 'Auto-Review aus.')} hint="startet je getaggtem PR einen Review-Unter-Chat" />
        <Schalter label="Kommentare automatisch posten" an={s.autoPost} disabled={busy || !s.autoReview} testid="schalter-autopost" onChange={(v) => set({ autoPost: v })} hint="nur als Kommentar (COMMENT); Approve/Änderungen verlangen bleibt dein Klick" />
        <Schalter label="auch bei Review-Anfrage an mich" an={s.onRequest} disabled={busy || !s.autoReview} testid="schalter-anfrage" onChange={(v) => set({ onRequest: v })} />
      </div>
      <details className="small" style={{ marginBottom: 8 }}>
        <summary>Grenzen und Liste · ohne Tagesgrenze · {s.maxParallel} gleichzeitig (weitere warten) · heute {d.heute} gestartet · Auto-Review und Posten nur für {(d.reviewOrgs ?? []).join(', ')} · PR-Tests werden nicht ausgeführt</summary>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', margin: '6px 0' }}>
          <span className="muted" data-testid="deckel-tag">ohne Tagesgrenze</span>
          <label>gleichzeitig <input className="input" type="number" min={1} max={5} defaultValue={s.maxParallel} style={{ width: 50 }} onBlur={(e) => Number(e.target.value) !== s.maxParallel && set({ maxParallel: Number(e.target.value) })} /></label>
          <label>@review zählt von <input className="input" value={allow} onChange={(e) => setAllow(e.target.value)} style={{ width: 220 }} onBlur={() => allow !== s.allow.join(', ') && set({ allow: allow.split(/[\s,]+/) })} data-testid="allowlist" /></label>
        </div>
        {s.log.length > 0 && <ul className="tiny muted" data-testid="schalt-protokoll" style={{ margin: 0 }}>{s.log.map((l: any, i: number) => <li key={i}>{fmtDateTime(l.at)} · {l.by}: {l.was}</li>)}</ul>}
      </details>
      {msg && <p className={`small ${msg.ok ? '' : 'err'}`} role="status">{msg.text}</p>}
    </section>
  );
}

/** Auto-Reviews und „Was ist neu“ des PR-Tickers (Planen › Roadmap › PRs). */
export function PrTickerMeldungen() {
  const { t, d } = useTicker();
  if (!d) return <Fehler t={t} />;
  const s = d.settings;
  return (
    <section className="card" data-testid="pr-ticker-meldungen" style={{ marginBottom: 14 }}>
      <h2 style={{ margin: 0 }}>PR-Ticker: Meldungen</h2>
      {d.reviews.length > 0 && <>
        <h3 style={{ marginBottom: 4 }}>Auto-Reviews</h3>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }} data-testid="auto-reviews">
          {d.reviews.map((r: any) => (
            <li key={r.id}>
              <a href={r.url} target="_blank" rel="noreferrer">{short(r.repo)}#{r.number}</a> {r.title}{' '}
              <span className={`chip ${STATUS_CHIP[r.status] ?? ''}`} data-testid="review-status">{r.status === 'wartet' && r.retryAt ? `erneut ab ${uhr(r.retryAt)} (Versuch ${r.versuche + 1})` : r.status}</span>
              {r.tiefe && <> <span className="chip" title={`${r.zeilen ?? '?'} geänderte Zeilen${r.delta ? ` · Delta seit ${r.delta.von}: ${r.delta.zeilen}` : ''}`}>{r.delta ? 'Delta · ' : ''}{r.tiefe}{r.eta ? ` · ~${r.eta} min` : ''}</span></>}
              {r.gp && <> <span className={`chip ${r.gp.ok ? '' : 'warn'}`} title={r.gp.fehler ?? ''}>{r.gp.ok ? 'Gegenprüfung ✓' : 'ohne Gegenprüfung'}</span></>}
              {r.empfehlung && <> <span className={`chip ${EMPF[r.empfehlung]?.c ?? ''}`}>Empfehlung: {EMPF[r.empfehlung]?.t ?? r.empfehlung}</span></>}
              {r.posted && <> · <a href={r.posted.url ?? r.url} target="_blank" rel="noreferrer">gepostet</a></>}
              {r.strand && <> · <a href={`#/leitstand?review=${r.strand}`}>Review-Ansicht</a></>}
              {(['deckel', 'fehler', 'übersprungen'].includes(r.status) || (r.status === 'wartet' && r.retryAt)) && <> · <button className="btn tiny ghost" onClick={async () => { await api('/api/leitstand/ticker/review', { body: { id: r.id } }); t.reload(); }}>Jetzt reviewen</button></>}
              {r.note && <span className="tiny muted"> · {r.note}</span>}
            </li>))}
        </ul>
      </>}

      <h3 style={{ marginBottom: 4 }}>Was ist neu</h3>
      {d.items.length === 0 ? <p className="small muted">{s.ticker ? 'Noch nichts Neues.' : 'Ticker ist aus.'}</p> :
        <ul className="small ticker-liste" style={{ margin: 0, paddingLeft: 0, listStyle: 'none', maxHeight: 360, overflow: 'auto' }} data-testid="ticker-liste">
          {d.items.map((e: any) => (
            <li key={e._id} style={{ padding: '3px 0', borderBottom: '1px solid var(--border-light, #eee)' }}>
              <span title={e.kind}>{KIND[e.kind] ?? '•'}</span>{' '}
              <a href={e.prUrl} target={chatTarget === '_top' ? '_blank' : '_blank'} rel="noreferrer" className="mono">{short(e.repo)}#{e.number}</a>{' '}
              <span>{e.title}</span> · <a href={e.url} target="_blank" rel="noreferrer">{e.text}</a>{' '}
              <span className="tiny muted">{fmtDateTime(e.at)}</span>{e.note && <span className="tiny muted"> · {e.note}</span>}
            </li>))}
        </ul>}
    </section>
  );
}

/** Abschnitt in der Review-Ansicht eines Auto-Review-Strangs. */
export function PrReviewAbschnitt({ id, pr, onDone }: { id: string; pr: any; onDone: () => void }) {
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const go = async (event: string, label: string) => {
    if (event !== 'COMMENT' && !confirm(`${label} auf GitHub für ${pr.repo}#${pr.number}?`)) return;
    setBusy(event); setMsg(null);
    try { const r: any = await api(`/api/review/${id}/github`, { body: { event, text: pr.text } }); setMsg({ ok: true, text: `${label}: gepostet${r.url ? ` (${r.url})` : ''}.` }); onDone(); }
    catch (e: any) { setMsg({ ok: false, text: String(e?.message ?? e) }); } finally { setBusy(''); }
  };
  const e = EMPF[pr.empfehlung ?? ''];
  return (
    <div data-testid="pr-review">
      <h3>PR-Review: <a href={pr.url} target="_blank" rel="noreferrer">{pr.repo}#{pr.number}</a> <span className="tiny muted mono">Stand {String(pr.head).slice(0, 7)}</span></h3>
      <p className="small">{e ? <span className={`chip ${e.c}`} data-testid="empfehlung">Empfehlung: {e.t}</span> : <span className="chip">noch keine Empfehlung</span>}
        {pr.posted && <> · Kommentar <a href={pr.posted.url ?? pr.url} target="_blank" rel="noreferrer">gepostet</a> ({pr.posted.by === 'auto' ? 'automatisch' : pr.posted.by}, {fmtDateTime(pr.posted.at)})</>}
        {pr.note && <span className="tiny muted"> · {pr.note}</span>}</p>
      {pr.text ? <pre className="small" style={{ whiteSpace: 'pre-wrap', maxHeight: '50vh', overflow: 'auto' }} data-testid="kommentar-entwurf">{pr.text}</pre> : <p className="small muted">Noch kein Kommentar-Entwurf (kommentar.md).</p>}
      {pr.text && <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        {!pr.posted && <button className="btn small primary" disabled={!!busy || pr.schreibenAus} onClick={() => go('COMMENT', 'Kommentar')} data-testid="kommentar-posten">Kommentar posten</button>}
        <button className="btn small" disabled={!!busy || pr.schreibenAus} onClick={() => go('APPROVE', 'Approve')} data-testid="approve">Approve</button>
        <button className="btn small" disabled={!!busy || pr.schreibenAus} onClick={() => go('REQUEST_CHANGES', 'Änderungen verlangen')} data-testid="request-changes">Änderungen verlangen</button>
        <button className="btn small ghost" onClick={() => navigator.clipboard?.writeText(pr.text).then(() => setMsg({ ok: true, text: 'Text kopiert.' }))}>Text kopieren</button>
        {pr.schreibenAus && <span className="tiny muted">Schreiben auf GitHub ist aus. <details className="tiny" style={{ display: 'inline' }}><summary style={{ display: 'inline', cursor: 'pointer' }}>Technische Details</summary> Schalter WERKBANK_GITHUB_KOMMENTAR=off</details></span>}
      </div>}
      {msg && <p className={`small ${msg.ok ? '' : 'err'}`} role="status">{msg.text}</p>}
    </div>
  );
}
