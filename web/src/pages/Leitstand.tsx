// Seite „Hauptchat & Unter-Chats“ (früher „Leitstand“; docs/plan-leitstand.md Teil B, docs/plan-hauptchat-workspace.md S2):
// alle Unter-Chats (Orchestrator-Stränge) je Lauf, zugeklappt („Flex — 3 Unter-Chats · 2 fertig · 1 wartet“), mit Status,
// Zähler „automatisch fortgesetzt“, Chat- und Bericht-Link; oben der Hauptchat mit Start/Neustart (Übergabe vorbefüllt).
// Nur für Admins (Feature leitstand). Liest nur festgeschriebenen Stand (kein Abruf bei der Brücke).
import { useEffect, useState } from 'react';
import { api, chatTarget, fmtDateTime, openChat, type Config } from '../api.ts';
import { Err, Loading, useLoad } from '../ui.tsx';

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
      {t.error ? <Err e={t.error} /> : !d ? <Loading /> : <pre className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '70vh', overflow: 'auto' }}>{d.text}</pre>}
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
