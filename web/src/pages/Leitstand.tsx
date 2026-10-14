// Seite „Hauptchat & Unter-Chats“ (früher „Leitstand“; docs/plan-leitstand.md Teil B, docs/plan-hauptchat-workspace.md S2):
// alle Unter-Chats (Orchestrator-Stränge) je Lauf, zugeklappt („Flex — 3 Unter-Chats · 2 fertig · 1 wartet“), mit Status,
// Zähler „automatisch fortgesetzt“, Chat- und Bericht-Link; oben der Hauptchat mit Start/Neustart (Übergabe vorbefüllt).
// Nur für Admins (Feature leitstand). Liest nur festgeschriebenen Stand (kein Abruf bei der Brücke).
import { useEffect, useState } from 'react';
import { api, chatTarget, fmtDateTime, openChat, type Config } from '../api.ts';
import { Err, Loading, useLoad } from '../ui.tsx';
import { PrTicker, PrReviewAbschnitt } from '../prticker.tsx';
import { Entscheidungen } from '../entscheidungen.tsx';

const ICON: Record<string, string> = { läuft: '⏳', wartet: '✋', fertig: '✅', gestoppt: '⛔', erledigt: '✔️' };
const CHIP: Record<string, string> = { läuft: '', wartet: 'warn', fertig: 'ok', gestoppt: 'bad', erledigt: '' };
// Wörter wie in der Chat-Seitenleiste (Plan 144): „wartet auf dich“, „zu prüfen“.
const WORD: Record<string, string> = { läuft: 'läuft', wartet: 'wartet auf dich', fertig: 'zu prüfen', gestoppt: 'gestoppt', erledigt: 'erledigt' };
const span = (from: string, to: string) => {
  const a = fmtDateTime(from).split(',')[0], b = fmtDateTime(to).split(',')[0];
  return a === b ? a : `${a} – ${b}`;
};

/** Auftrag oder Bericht eines Unter-Chats (review-pakete/NNN-…/auftrag.md bzw. bericht.md) — hier im OLAF Workspace gelesen. */
function Bericht({ id, art, onClose }: { id: string; art: 'auftrag' | 'bericht'; onClose: () => void }) {
  const t = useLoad(() => api(`/api/leitstand/bericht?strand=${encodeURIComponent(id)}&art=${art}`), [id, art]);
  const d: any = t.data;
  return (
    <section className="card" data-testid="bericht">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>{art === 'auftrag' ? 'Auftrag' : 'Bericht'} {d ? <span className="tiny muted mono">{d.name}</span> : null}</h2>
        <button className="btn small ghost" onClick={onClose}>Schließen</button>
      </div>
      {t.error ? <Err e={t.error} /> : !d ? <Loading /> : <>
        {d.entscheidungen?.length > 0 && <Entscheidungen id={id} liste={d.entscheidungen} berichtHash={d.berichtHash} running={!!d.running} onDone={t.reload} />}
        <pre className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '70vh', overflow: 'auto' }}>{d.text}</pre>
      </>}
    </section>
  );
}


/**
 * Review → Freigabe (docs/plan-hauptchat-monitor.md §9, Council R3). Zeigt, WAS freigegeben wird (Branch, Kopf, Basis, Commits,
 * Diff-Statistik, sauber?), Vorschau-Links aus dem Dienste-Register (geprüft), Entscheidungen mit Antwortfeld, PR-Texte und
 * Bericht — Agententext immer als Text, klickbar sind nur Register-Links. „Freigeben zum Push“ ist die einzige Freigabe;
 * gepusht wird danach von der Hauptsitzung nach der Checkliste (pre-push-Hook prüft). Merge gibt es nicht.
 */
const VS: Record<string, string> = { 'läuft': 'ok', 'läuft (Anmeldung)': 'ok', 'Proxy läuft, Ziel antwortet nicht': 'warn', 'antwortet nicht': 'bad', 'Fehler': 'bad' };
function Review({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useLoad(() => api(`/api/review/${encodeURIComponent(id)}`), [id]);
  const d: any = t.data;
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async (key: string, fn: () => Promise<any>, ok: string) => {
    setBusy(key); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); t.reload(); } catch (e: any) { setMsg({ ok: false, text: String(e?.message ?? e) }); } finally { setBusy(''); }
  };
  if (t.error) return <section className="card"><Err e={t.error} /></section>;
  if (!d) return <section className="card"><Loading /></section>;
  const r = d.repo ?? {};
  const aktiv = (d.freigaben ?? []).filter((f: any) => f.aktiv && !f.pushedAt);
  const schonFrei = aktiv.some((f: any) => f.head === r.head);
  return (
    <section className="card review" data-testid="review">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h2 style={{ margin: 0 }}>Review &amp; Freigabe: {d.title} <span className="tiny muted mono">{d.id}{d.paket ? ` · ${d.paket}` : ''}</span></h2>
        <button className="btn small ghost" onClick={onClose}>Schließen</button>
      </div>
      {msg && <p className={`small ${msg.ok ? '' : 'err'}`} role="status" data-testid="review-msg">{msg.text}</p>}
      {d.prReview && <PrReviewAbschnitt id={id} pr={d.prReview} onDone={t.reload} />}

      <h3>Vorschau</h3>
      {d.vorschau.length === 0 ? <p className="small muted">Keine Vorschau im Dienste-Register zu diesem Paket (review-pakete/00-dienste.yaml).</p> :
        <ul className="plain" data-testid="review-vorschau">{d.vorschau.map((v: any) => (
          <li key={v.port} className="row" style={{ gap: 8, alignItems: 'baseline' }}>
            <span className={`chip ${VS[v.ergebnis] ?? ''}`} data-testid="vorschau-status">{v.ergebnis}{v.status ? ` (${v.status})` : ''}</span>
            <a href={v.link} target="_blank" rel="noopener noreferrer">{v.link}</a>
            <span className="tiny muted">{v.was}</span>
          </li>))}</ul>}
      {d.vorschau.length > 0 && <button className="btn small ghost" disabled={!!busy} onClick={() => run('v', () => api(`/api/review/${id}`), 'Vorschau neu geprüft.')}>Neu prüfen</button>}

      <h3>Was freigegeben wird</h3>
      {r.fehler ? <p className="small err">{r.fehler}</p> : <div data-testid="review-repo">
        <p className="small"><span className="mono">{r.key ?? r.dir}</span><br />Branch <b className="mono">{r.branch ?? '— (kein Branch)'}</b> · Kopf <span className="mono">{String(r.head).slice(0, 12)}</span> · Basis <span className="mono">{r.baseRef ?? '—'}</span>{r.mergeBase ? <> (<span className="mono">{String(r.mergeBase).slice(0, 12)}</span>)</> : null}</p>
        <p className="small">{r.clean ? <span className="chip ok">sauber</span> : <span className="chip bad" data-testid="review-unsauber">ungespeicherte Änderungen ({r.dirty.length}) — Vorschau ≠ Commit</span>} {d.running && <span className="chip warn">arbeitet gerade</span>}</p>
        <details><summary className="small">{r.commits.length}{r.more ? `+${r.more}` : ''} Commits</summary><ul className="plain small mono">{r.commits.map((c: any) => <li key={c.sha}>{c.sha.slice(0, 10)} {c.subject}</li>)}</ul></details>
        {r.stat && <details><summary className="small">Diff-Statistik</summary><pre className="small" style={{ whiteSpace: 'pre-wrap' }}>{r.stat}</pre></details>}
        <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <button className="btn primary" data-testid="freigeben" disabled={!!busy || !r.clean || !r.branch || !r.patchId || d.running || schonFrei}
            title="Gibt genau diesen Stand (Kopf + Patch) zum Push frei. Gepusht wird von der Hauptsitzung nach der Checkliste; nie gemergt."
            onClick={() => { if (confirm(`${r.branch}@${String(r.head).slice(0, 12)} zum Push freigeben?\nNur dieser Stand (nach Rebase: derselbe Patch). Merge nie.`)) run('f', () => api(`/api/review/${id}/freigabe`, { body: { head: r.head, patchId: r.patchId } }), 'Freigegeben — die Hauptsitzung pusht nach der Checkliste.'); }}>
            {schonFrei ? 'Freigegeben ✓' : 'Freigeben zum Push'}
          </button>
          <span className="tiny muted">Merge gibt es hier nicht.</span>
        </div>
      </div>}
      {(d.freigaben ?? []).length > 0 && <ul className="plain small" data-testid="review-freigaben">{d.freigaben.map((f: any) => (
        <li key={f.id}>{f.pushedAt ? '🚀 gepusht' : f.revokedAt ? '↩️ zurückgezogen' : '✅ freigegeben'} <span className="mono">{f.branch}@{String(f.head).slice(0, 10)}</span> · {fmtDateTime(f.at)} {f.pr && <span className="mono">{f.pr}</span>}
          {f.aktiv && !f.pushedAt && <button className="btn small ghost" disabled={!!busy} data-testid="zurueckziehen" onClick={() => run('z', () => api(`/api/review/${id}/freigabe/${f.id}/zurueck`, { body: {} }), 'Freigabe zurückgezogen.')}>Zurückziehen</button>}
        </li>))}</ul>}

      <Entscheidungen id={id} liste={d.entscheidungen ?? []} berichtHash={d.berichtHash} running={!!d.running} onDone={t.reload} />

      {d.prTexte.length > 0 && <><h3>PR-Texte</h3>{d.prTexte.map((p: any) => <details key={p.name}><summary className="small mono">{p.name}</summary><pre className="small" style={{ whiteSpace: 'pre-wrap', maxHeight: '50vh', overflow: 'auto' }}>{p.text}</pre></details>)}</>}
      <h3>Bericht</h3>
      {d.bericht ? <details><summary className="small">Bericht lesen</summary><pre className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '70vh', overflow: 'auto' }}>{d.bericht}</pre></details> : <p className="small muted">Noch kein Bericht.</p>}
    </section>
  );
}

function Strand({ s }: { s: any }) {
  return (
    <li className="leit-strand" data-strand={s.id} data-status={s.status}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span className={`chip ${CHIP[s.status] ?? ''}`}>{ICON[s.status] ?? '?'} {WORD[s.status] ?? s.status}</span>
        <b>{s.title}</b>
        <span className="tiny muted mono">{s.id}</span>
      </div>
      <div className="small muted" style={{ marginTop: 2 }}>
        {s.reason ? <>{s.reason} · </> : null}
        {s.autoWeiter > 0 && <>automatisch fortgesetzt ({s.autoWeiter}) · </>}
        {s.reviewedBy === 'leitstand' && !s.knutReviewed && <>vom Hauptchat abgelegt · </>}
        zuletzt {fmtDateTime(s.lastActivity)}
      </div>
      {/* Plan 144 (Knut 12.10.): je Unter-Chat drei Links — Chat · Auftrag · Bericht; fehlt eine Datei, steht das da. */}
      <div className="row" style={{ gap: 12 }} data-testid="strand-links">
        {s.url && <a className="small" href={s.url} target={chatTarget}>Chat</a>}
        {s.auftrag ? <a className="small" href={`#/leitstand?auftrag=${s.id}`}>Auftrag</a> : <span className="small muted" title="Kein auftrag.md im review-pakete-Ordner dieses Unter-Chats">kein Auftrag</span>}
        {s.bericht ? <a className="small" href={`#/leitstand?bericht=${s.id}`}>Bericht</a> : <span className="small muted" title="Noch kein bericht.md">noch kein Bericht</span>}
        {(s.status === 'fertig' || s.reviewReady) && <a className="small" href={`#/leitstand?review=${s.id}`} data-testid="review-link">Review &amp; Freigabe</a>}
      </div>
    </li>
  );
}

function Gruppe({ g, open }: { g: any; open?: boolean }) {
  return (
    <details className="card leit-gruppe" open={open} data-lauf={g.lauf}>
      <summary><b>{g.lauf}</b> — <span data-testid="gruppe-zeile">{g.line}</span> <span className="tiny muted">{span(g.from, g.to)}</span></summary>
      <ul className="plain" style={{ display: 'grid', gap: 10, marginTop: 10 }}>{g.strands.map((s: any) => <Strand key={s.id} s={s} />)}</ul>
    </details>
  );
}

/** Hauptchat starten oder neu starten (Plan 144, S2): Übergabe automatisch erzeugt, bearbeitbar; nach dem Start öffnet sich der
 *  neue Hauptchat im selben Fenster (die Chat-Seitenleiste lädt beim Chatwechsel neu). */
function StartHauptchat({ aktiv, onClose, onStarted }: { aktiv: boolean; onClose: () => void; onStarted: () => void }) {
  const draft = useLoad(() => api('/api/leitstand/handover'));
  const d: any = draft.data;
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<unknown>(null);
  useEffect(() => { if (d && text === null) setText(d.text); }, [d]);
  const max = d?.max ?? 40000;
  const start = async () => {
    setBusy(true); setFehler(null);
    // Kein Hash-Wechsel nach dem Start: sonst könnte LibreChat nach dem Öffnen des Chats wieder auf diese Seite springen.
    try { const r: any = await api('/api/leitstand/start', { body: { handoverText: text ?? '' } }); onStarted(); openChat(r.url); }
    catch (e) { setFehler(e); } finally { setBusy(false); }
  };
  return (
    <section className="card" data-testid="hauptchat-start" aria-labelledby="hc-start-h">
      <h2 id="hc-start-h" style={{ marginTop: 0 }}>{aktiv ? 'Hauptchat neu starten' : 'Hauptchat starten'}</h2>
      <p className="small muted" style={{ marginTop: 0 }}>
        Der Hauptchat führt die Unter-Chats: er startet sie, prüft ihren Stand und fragt dich, wenn etwas zu entscheiden ist.
        Die Übergabe unten wird seine erste Nachricht. Sie ist aus den offenen Unter-Chats und Rückfragen erzeugt — ergänze
        „Woran wir gerade arbeiten“ und „Was als Nächstes ansteht“.
        {aktiv && <> <b>Der bisherige Hauptchat wird beendet</b> und bleibt lesbar.</>}
      </p>
      {draft.error ? <Err e={draft.error} /> : text === null ? <Loading what="Übergabe wird erzeugt" /> : <>
        <label htmlFor="hc-uebergabe" className="small"><b>Übergabe</b> <span className="muted">({d.strands} offene Unter-Chats, {d.questions} Rückfragen)</span></label>
        <textarea id="hc-uebergabe" data-testid="uebergabe-text" rows={16} value={text} onChange={(e) => setText(e.target.value)}
          style={{ width: '100%', fontFamily: 'var(--font-mono, monospace)', fontSize: 12.5, marginTop: 4 }} aria-describedby="hc-zeichen" />
        <div id="hc-zeichen" className="tiny muted" style={text.length > max ? { color: 'var(--red-600)' } : undefined}>
          {text.length.toLocaleString('de-AT')} / {max.toLocaleString('de-AT')} Zeichen{text.length > max ? ' — zu lang' : ''}
        </div>
      </>}
      {fehler ? <Err e={fehler} /> : null}
      <div className="row" style={{ gap: 8, marginTop: 10 }}>
        <button className="btn primary" data-testid="hauptchat-starten" disabled={busy || !text?.trim() || (text?.length ?? 0) > max} onClick={start}>
          {busy ? 'Startet …' : aktiv ? 'Neu starten' : 'Hauptchat starten'}
        </button>
        <button className="btn ghost" onClick={onClose} disabled={busy}>Abbrechen</button>
      </div>
    </section>
  );
}

export function Leitstand({ hash }: { cfg: Config; hash: string }) {
  const t = useLoad(() => api('/api/leitstand/overview'));
  const d: any = t.data;
  const q = new URLSearchParams(hash.split('?')[1] ?? '');
  const fromHash = q.get('bericht') ? { id: q.get('bericht')!, art: 'bericht' as const } : q.get('auftrag') ? { id: q.get('auftrag')!, art: 'auftrag' as const } : null;
  const fromKey = fromHash ? `${fromHash.art}:${fromHash.id}` : '';
  const [bericht, setBericht] = useState<{ id: string; art: 'auftrag' | 'bericht' } | null>(fromHash);
  const reviewId = q.get('review');
  const wantStart = new URLSearchParams(hash.split('?')[1] ?? '').has('start');
  const [starten, setStarten] = useState(wantStart);
  useEffect(() => { if (wantStart) setStarten(true); }, [wantStart]);
  useEffect(() => { if (fromHash) setBericht(fromHash); }, [fromKey]);
  useEffect(() => { const id = setInterval(() => api('/api/leitstand/overview').then(t.setData).catch(() => {}), 30_000); return () => clearInterval(id); }, []);
  if (t.error) return <div className="page"><Err e={t.error} /></div>;
  if (!d) return <div className="page"><Loading /></div>;
  return (
    <div className="page leitstand" data-testid="leitstand-seite">
      <div className="head">
        <div>
          <h1>Hauptchat &amp; Unter-Chats</h1>
          <p className="muted small" style={{ margin: 0 }}>Der Hauptchat führt, die Unter-Chats arbeiten — je Lauf gruppiert. Fertige stehen zum Prüfen auf <a href="#/">Heute</a>.</p>
        </div>
      </div>
      <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '8px 0 14px' }} data-testid="leitstand-kopf">
        {d.leitstand ? <>
          <span className="small">🛰️ Hauptchat: <b>{d.leitstand.status}</b>{d.leitstand.open > 0 ? ` · ${d.leitstand.open} Meldung${d.leitstand.open === 1 ? '' : 'en'} unterwegs` : ''}</span>
          <a className="btn small" href={d.leitstand.url} target={chatTarget}>Öffnen</a>
          {!starten && <button className="btn small ghost" onClick={() => setStarten(true)} data-testid="neu-starten">Neu starten …</button>}
        </> : <>
          <span className="small">Noch kein Hauptchat aktiv.</span>
          {!starten && <button className="btn small primary" onClick={() => setStarten(true)} data-testid="neu-starten">Hauptchat starten</button>}
        </>}
      </div>
      {starten && <StartHauptchat aktiv={!!d.leitstand} onStarted={() => { setStarten(false); t.reload(); if (wantStart) history.replaceState(null, '', location.pathname + location.search + '#/leitstand'); }} onClose={() => { setStarten(false); if (wantStart) window.location.hash = '#/leitstand'; }} />}
      <PrTicker />
      {reviewId && <Review id={reviewId} onClose={() => { window.location.hash = '#/leitstand'; }} />}
      {bericht && <Bericht id={bericht.id} art={bericht.art} onClose={() => { setBericht(null); if (fromHash) window.location.hash = '#/leitstand'; }} />}
      {d.offen.length === 0 && <div className="card soft empty"><p><b>Keine offenen Unter-Chats.</b></p></div>}
      <div style={{ display: 'grid', gap: 12 }} data-testid="offen">{d.offen.map((g: any) => <Gruppe key={g.key} g={g} />)}</div>
      {d.erledigt.length > 0 && <details className="leit-erledigt" style={{ marginTop: 20 }} data-testid="erledigt">
        <summary><b>Erledigt</b> <span className="tiny muted">(letzte 14 Tage, {d.erledigt.length} {d.erledigt.length === 1 ? 'Lauf' : 'Läufe'})</span></summary>
        <div style={{ display: 'grid', gap: 12, marginTop: 10 }}>{d.erledigt.map((g: any) => <Gruppe key={g.key} g={g} />)}</div>
      </details>}
    </div>
  );
}
