// PR-Ticker auf der Hauptchat-Seite (Plan 157): Schalter (Ticker, Auto-Review, automatisch posten, Review-Anfragen),
// Deckel, Liste „was ist neu“ und die Auto-Reviews. Und in der Review-Ansicht der Abschnitt „PR-Review“ mit Empfehlung,
// Entwurf und Knuts Klicks (Kommentar / Freigeben / Änderungen verlangen).
import { useEffect, useState } from 'react';
import { api, chatTarget, fmtDateTime } from './api.ts';
import { Err, Loading, useLoad } from './ui.tsx';

const KIND: Record<string, string> = { neu: '🆕', stand: '⬆️', zu: '🏁', kommentar: '💬', review: '🔎', anfrage: '🙋', tag: '🏷️' };
const STATUS_CHIP: Record<string, string> = { wartet: '', startet: '', läuft: '', fertig: 'ok', deckel: 'warn', fehler: 'bad', übersprungen: '' };
const EMPF: Record<string, { t: string; c: string }> = { approve: { t: 'freigeben', c: 'ok' }, 'request-changes': { t: 'Änderungen verlangen', c: 'bad' }, comment: { t: 'nur kommentieren', c: 'warn' } };
const short = (repo: string) => repo.split('/')[1] ?? repo;

function Schalter({ label, an, onChange, testid, hint, disabled }: { label: string; an: boolean; onChange: (v: boolean) => void; testid: string; hint?: string; disabled?: boolean }) {
  return (
    <label className="row small" style={{ gap: 6, alignItems: 'center' }} title={hint}>
      <input type="checkbox" role="switch" checked={an} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testid} />
      <span>{label}</span> <span className={`chip ${an ? 'ok' : ''}`}>{an ? 'an' : 'aus'}</span>
    </label>
  );
}

export function PrTicker() {
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
  if (t.error) return <section className="card"><Err e={t.error} /></section>;
  if (!d) return <section className="card"><Loading /></section>;
  const s = d.settings;
  return (
    <section className="card" data-testid="pr-ticker" style={{ marginBottom: 14 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ margin: 0 }}>PR-Ticker</h2>
        <span className="tiny muted">
          {d.aus ? 'per WERKBANK_PR_TICKER=off abgeschaltet' : d.lauf?.at ? `zuletzt ${fmtDateTime(d.lauf.at)} · ${d.scopes.join(' + ')}` : 'noch kein Lauf'}
          {d.lauf?.rate ? ` · GitHub-Kontingent ${d.lauf.rate.remaining}` : ''}
        </span>
      </div>
      {d.lauf?.error && <p className="small err" data-testid="ticker-fehler">⚠️ {d.lauf.error}</p>}
      <div className="row" style={{ gap: 16, flexWrap: 'wrap', margin: '8px 0' }} data-testid="ticker-schalter">
        <Schalter label="Ticker" an={s.ticker} disabled={busy} testid="schalter-ticker" onChange={(v) => set({ ticker: v }, v ? 'Ticker an — erster Abruf in spätestens einer Minute.' : 'Ticker aus.')} hint={`alle ${s.minutes} min neue PRs, Stände, Reviews und Kommentare`} />
        <Schalter label="Auto-Review bei @review" an={s.autoReview} disabled={busy || !s.ticker} testid="schalter-autoreview" onChange={(v) => set({ autoReview: v }, v ? 'Auto-Review an — zählt @review ab jetzt.' : 'Auto-Review aus.')} hint="startet je getaggtem PR einen Review-Unter-Chat" />
        <Schalter label="Kommentare automatisch posten" an={s.autoPost} disabled={busy || !s.autoReview} testid="schalter-autopost" onChange={(v) => set({ autoPost: v })} hint="nur als Kommentar (COMMENT); Freigeben/Änderungen verlangen bleibt dein Klick" />
        <Schalter label="auch bei Review-Anfrage an mich" an={s.onRequest} disabled={busy || !s.autoReview} testid="schalter-anfrage" onChange={(v) => set({ onRequest: v })} />
        <Schalter label="Schatten-Review (Pilot)" an={!!s.schatten} disabled={busy || !s.autoReview} testid="schalter-schatten" onChange={(v) => set({ schatten: v }, v ? 'Schatten-Review an — glm-5.3 plant, Flash prüft, nie gepostet.' : 'Schatten-Review aus.')} hint="Plan 183: neben jedem Auto-Review ein zweiter Weg (glm-5.3 Prüfauftrag → jcode + Flash → Zitatprüfung); Ergebnis nur in der Review-Ansicht" />
      </div>
      <details className="small" style={{ marginBottom: 8 }}>
        <summary>Deckel und Liste · {s.maxPerDay}/Tag · {s.maxParallel} gleichzeitig · heute {d.heute} gestartet · Auto-Review und Posten nur für {(d.reviewOrgs ?? []).join(', ')} · PR-Tests werden nicht ausgeführt</summary>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', margin: '6px 0' }}>
          <label>max. je Tag <input className="input" type="number" min={0} max={50} defaultValue={s.maxPerDay} style={{ width: 60 }} onBlur={(e) => Number(e.target.value) !== s.maxPerDay && set({ maxPerDay: Number(e.target.value) })} data-testid="deckel-tag" /></label>
          <label>gleichzeitig <input className="input" type="number" min={1} max={5} defaultValue={s.maxParallel} style={{ width: 50 }} onBlur={(e) => Number(e.target.value) !== s.maxParallel && set({ maxParallel: Number(e.target.value) })} /></label>
          <label>@review zählt von <input className="input" value={allow} onChange={(e) => setAllow(e.target.value)} style={{ width: 220 }} onBlur={() => allow !== s.allow.join(', ') && set({ allow: allow.split(/[\s,]+/) })} data-testid="allowlist" /></label>
        </div>
        {s.log.length > 0 && <ul className="tiny muted" data-testid="schalt-protokoll" style={{ margin: 0 }}>{s.log.map((l: any, i: number) => <li key={i}>{fmtDateTime(l.at)} · {l.by}: {l.was}</li>)}</ul>}
      </details>
      {msg && <p className={`small ${msg.ok ? '' : 'err'}`} role="status">{msg.text}</p>}

      {d.reviews.length > 0 && <>
        <h3 style={{ marginBottom: 4 }}>Auto-Reviews</h3>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }} data-testid="auto-reviews">
          {d.reviews.map((r: any) => (
            <li key={r.id}>
              <a href={r.url} target="_blank" rel="noreferrer">{short(r.repo)}#{r.number}</a> {r.title}{' '}
              <span className={`chip ${STATUS_CHIP[r.status] ?? ''}`}>{r.status}</span>
              {r.empfehlung && <> <span className={`chip ${EMPF[r.empfehlung]?.c ?? ''}`}>Empfehlung: {EMPF[r.empfehlung]?.t ?? r.empfehlung}</span></>}
              {r.posted && <> · <a href={r.posted.url ?? r.url} target="_blank" rel="noreferrer">gepostet</a></>}
              {r.strand && <> · <a href={`#/leitstand?review=${r.strand}`}>Review-Ansicht</a></>}
              {['deckel', 'fehler', 'übersprungen'].includes(r.status) && <> · <button className="btn tiny ghost" onClick={async () => { await api('/api/leitstand/ticker/review', { body: { id: r.id } }); t.reload(); }}>Jetzt reviewen</button></>}
              {r.schatten && <> · <span className={`chip ${r.schatten.abweichung ? 'warn' : ''}`} data-testid="schatten-chip" title="Schatten-Review (Planer + Flash, Pilot)">Schatten: {r.schatten.status}{r.schatten.empfehlung ? ` · ${EMPF[r.schatten.empfehlung]?.t ?? r.schatten.empfehlung}` : ''}{r.schatten.abweichung ? ' · weicht ab' : ''}{r.schatten.strittig ? ` · ${r.schatten.strittig} strittig` : ''}</span></>}
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
        <button className="btn small" disabled={!!busy || pr.schreibenAus} onClick={() => go('APPROVE', 'Freigeben (Approve)')} data-testid="approve">Freigeben</button>
        <button className="btn small" disabled={!!busy || pr.schreibenAus} onClick={() => go('REQUEST_CHANGES', 'Änderungen verlangen')} data-testid="request-changes">Änderungen verlangen</button>
        <button className="btn small ghost" onClick={() => navigator.clipboard?.writeText(pr.text).then(() => setMsg({ ok: true, text: 'Text kopiert.' }))}>Text kopieren</button>
        {pr.schreibenAus && <span className="tiny muted">GitHub-Schreiben ist aus (WERKBANK_GITHUB_KOMMENTAR=off).</span>}
      </div>}
      {msg && <p className={`small ${msg.ok ? '' : 'err'}`} role="status">{msg.text}</p>}
      <SchattenAbschnitt pr={pr} onDone={onDone} />
    </div>
  );
}

const URTEIL: Record<string, string> = { bestaetigt: 'ok', verworfen: '', strittig: 'warn' };
const ZITAT: Record<string, string> = { ok: '✓ Zitat', nicht_gefunden: '✗ Zitat nicht gefunden', ohne_beleg: '✗ ohne Beleg' };

/** Plan 183: Ergebnis des Schatten-Reviews (Planer + Flash) neben dem bestehenden — nie gepostet. */
export function SchattenAbschnitt({ pr, onDone }: { pr: any; onDone: () => void }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const s = pr.schatten;
  const anstossen = async () => {
    setMsg(null);
    try { await api('/api/leitstand/ticker/schatten', { body: { id: pr.id } }); setMsg({ ok: true, text: 'Schatten-Review angestoßen — startet im nächsten Takt (≤ 1 min).' }); onDone(); }
    catch (e: any) { setMsg({ ok: false, text: String(e?.message ?? e) }); }
  };
  const merken = async (p: any) => {
    const text = prompt('Fallstrick (wird passenden Prüfaufträgen mitgegeben):', `${p.frage ?? ''} — ${p.grund ?? ''}`.trim());
    if (!text) return;
    const stichworte = prompt('Stichwörter im Diff, bei denen er passt (mit Komma):', '') ?? '';
    try { await api('/api/leitstand/fallstricke', { body: { text, repos: [pr.repo], stichworte, quelle: `${pr.repo}#${pr.number} ${p.key}` } }); setMsg({ ok: true, text: 'Als Fallstrick gemerkt.' }); }
    catch (e: any) { setMsg({ ok: false, text: String(e?.message ?? e) }); }
  };
  const laufend = s && ['wartet', 'läuft'].includes(s.status);
  return (
    <div data-testid="schatten" style={{ marginTop: 14, borderTop: '1px dashed var(--border-light, #ddd)', paddingTop: 8 }}>
      <h3 style={{ marginBottom: 4 }}>Schatten-Review (Pilot: glm-5.3 plant, Flash prüft) <span className="tiny muted">— nie gepostet, nur zum Vergleich</span></h3>
      {!s ? <p className="small muted">Noch kein Schatten-Review für diesen Stand.</p> : <>
        <p className="small">
          <span className="chip">{s.status}</span>
          {s.empfehlung && <> <span className={`chip ${EMPF[s.empfehlung]?.c ?? ''}`} data-testid="schatten-empfehlung">Empfehlung: {EMPF[s.empfehlung]?.t ?? s.empfehlung}</span></>}
          {s.abweichung === true && <> <span className="chip warn" data-testid="schatten-abweichung">weicht vom Review ab</span></>}
          {s.abweichung === false && <> <span className="chip ok">gleich wie das Review</span></>}
          {s.workerEmpfehlung && <span className="tiny muted"> · Flash allein: {s.workerEmpfehlung}</span>}
          {s.energie != null && <span className="tiny muted"> · ≈ {s.energie} Energie</span>}
          {s.p5 && <span className="tiny muted"> · {s.p5} (nur gemessen)</span>}
        </p>
        {s.fehler && <p className="small err">{s.fehler}</p>}
        {s.strittig?.length > 0 && <><p className="small" style={{ margin: '6px 0 2px' }}><b>Strittig — an Opus/Knut</b> (der Schattenweg empfiehlt deshalb kein „freigeben“ — deine Knöpfe oben bleiben frei):</p>
          <ul className="small" style={{ margin: 0 }} data-testid="schatten-strittig">{s.strittig.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></>}
        {s.punkte?.length > 0 && <table className="small" style={{ marginTop: 6 }} data-testid="schatten-punkte"><thead><tr><th>Punkt</th><th>Schwere</th><th>Status</th><th>Beleg</th><th>Planer</th><th></th></tr></thead><tbody>
          {s.punkte.map((p: any) => <tr key={p.key}>
            <td><b>{p.key}</b> {p.frage}</td><td>{p.schwere}</td><td>{p.status}</td>
            <td className="mono tiny">{p.beleg} <span className={p.zitatPruefung === 'ok' ? '' : 'err'}>{ZITAT[p.zitatPruefung] ?? p.zitatPruefung}</span></td>
            <td><span className={`chip ${URTEIL[p.urteil] ?? ''}`} title={p.grund}>{p.urteil ?? '—'}</span></td>
            <td>{p.urteil === 'bestaetigt' && p.status === 'befund' && <button className="btn tiny ghost" onClick={() => merken(p)} data-testid="fallstrick-merken">als Fallstrick merken</button>}</td>
          </tr>)}</tbody></table>}
        {s.blind?.length > 0 && <details className="tiny muted" style={{ marginTop: 4 }}><summary>Nicht nachgeprüft ({s.blind.length})</summary><ul>{s.blind.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></details>}
        {s.stufen?.length > 0 && <details className="tiny" style={{ marginTop: 4 }} data-testid="schatten-stufen"><summary>Messung je Stufe</summary>
          <table><thead><tr><th>Stufe</th><th>Modell</th><th>Energie</th><th>Aufrufe</th><th>Cache</th><th>s</th><th>Urteil</th></tr></thead><tbody>
            {s.stufen.map((x: any, i: number) => <tr key={i}><td>{x.stufe}</td><td>{x.modell}</td><td>{x.energie}</td><td>{x.aufrufe}</td><td>{x.input ? Math.round((100 * x.cache) / x.input) : 0} %</td><td>{Math.round(x.ms / 1000)}</td><td>{x.urteil}</td></tr>)}
          </tbody></table></details>}
        {s.auftrag && <details className="tiny" style={{ marginTop: 4 }}><summary>Prüfauftrag ({s.auftrag.pruef_fragen?.length} Fragen)</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(s.auftrag, null, 1)}</pre></details>}
      </>}
      {!laufend && <button className="btn small ghost" onClick={anstossen} data-testid="schatten-starten" style={{ marginTop: 6 }}>{s ? 'Schatten-Review neu' : 'Schatten-Review starten'}</button>}
      {msg && <p className={`small ${msg.ok ? '' : 'err'}`} role="status">{msg.text}</p>}
    </div>
  );
}
