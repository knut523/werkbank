// Seite „Leitstand“ (docs/plan-leitstand.md, Teil B, B2/B3): alle Orchestrator-Stränge je Lauf, zugeklappt
// („Flex — 3 Stränge · 2 fertig · 1 wartet“), mit Status, Zähler „automatisch fortgesetzt“, Chat- und Bericht-Link.
// Nur für Admins (Feature leitstand). Liest nur festgeschriebenen Stand aus der Werkbank (kein Abruf bei der Brücke).
import { useEffect, useState } from 'react';
import { api, chatTarget, fmtDateTime, type Config } from '../api.ts';
import { Err, Loading, useLoad } from '../ui.tsx';

const ICON: Record<string, string> = { läuft: '⏳', wartet: '✋', fertig: '✅', gestoppt: '⛔', erledigt: '✔️' };
const CHIP: Record<string, string> = { läuft: '', wartet: 'warn', fertig: 'ok', gestoppt: 'bad', erledigt: '' };
const span = (from: string, to: string) => {
  const a = fmtDateTime(from).split(',')[0], b = fmtDateTime(to).split(',')[0];
  return a === b ? a : `${a} – ${b}`;
};

function Bericht({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useLoad(() => api(`/api/leitstand/bericht?strand=${encodeURIComponent(id)}`), [id]);
  const d: any = t.data;
  return (
    <section className="card" data-testid="bericht">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ margin: 0 }}>Bericht {d ? <span className="tiny muted mono">{d.name}</span> : null}</h2>
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
        <span className={`chip ${CHIP[s.status] ?? ''}`}>{ICON[s.status] ?? '?'} {s.status}</span>
        <b>{s.title}</b>
        <span className="tiny muted mono">{s.id}</span>
      </div>
      <div className="small muted" style={{ marginTop: 2 }}>
        {s.reason ? <>{s.reason} · </> : null}
        {s.autoWeiter > 0 && <>automatisch fortgesetzt ({s.autoWeiter}) · </>}
        {s.reviewedBy === 'leitstand' && !s.knutReviewed && <>vom Leitstand abgelegt · </>}
        zuletzt {fmtDateTime(s.lastActivity)}
      </div>
      <div className="row" style={{ gap: 12 }}>
        {s.url && <a className="small" href={s.url} target={chatTarget}>Chat</a>}
        {s.bericht && <a className="small" href={`#/leitstand?bericht=${s.id}`}>Bericht</a>}
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

export function Leitstand({ hash }: { cfg: Config; hash: string }) {
  const t = useLoad(() => api('/api/leitstand/overview'));
  const d: any = t.data;
  const fromHash = new URLSearchParams(hash.split('?')[1] ?? '').get('bericht');
  const [bericht, setBericht] = useState<string | null>(fromHash);
  useEffect(() => { if (fromHash) setBericht(fromHash); }, [fromHash]);
  useEffect(() => { const id = setInterval(() => api('/api/leitstand/overview').then(t.setData).catch(() => {}), 30_000); return () => clearInterval(id); }, []);
  if (t.error) return <div className="page"><Err e={t.error} /></div>;
  if (!d) return <div className="page"><Loading /></div>;
  return (
    <div className="page leitstand" data-testid="leitstand-seite">
      <div className="head">
        <div>
          <h1>Leitstand</h1>
          <p className="muted small" style={{ margin: 0 }}>Alle Stränge des Orchestrators, je Lauf. Fertige stehen zum Prüfen auf <a href="#/">Heute</a>.</p>
        </div>
      </div>
      <p className="small" data-testid="leitstand-kopf">
        {d.leitstand ? <>🛰️ Leitstand-Chat: <b>{d.leitstand.status}</b>{d.leitstand.open > 0 ? ` · ${d.leitstand.open} Meldung${d.leitstand.open === 1 ? '' : 'en'} unterwegs` : ''} · <a href={d.leitstand.url} target={chatTarget}>öffnen</a></> : <>Kein Leitstand-Chat aktiv — starten mit <code>scripts/orch leitstand start --handover …</code></>}
      </p>
      {bericht && <Bericht id={bericht} onClose={() => { setBericht(null); if (fromHash) window.location.hash = '#/leitstand'; }} />}
      {d.offen.length === 0 && <div className="card soft empty"><p><b>Keine offenen Stränge.</b></p></div>}
      <div style={{ display: 'grid', gap: 12 }} data-testid="offen">{d.offen.map((g: any) => <Gruppe key={g.key} g={g} />)}</div>
      {d.erledigt.length > 0 && <details className="leit-erledigt" style={{ marginTop: 20 }} data-testid="erledigt">
        <summary><b>Erledigt</b> <span className="tiny muted">(letzte 14 Tage, {d.erledigt.length} {d.erledigt.length === 1 ? 'Lauf' : 'Läufe'})</span></summary>
        <div style={{ display: 'grid', gap: 12, marginTop: 10 }}>{d.erledigt.map((g: any) => <Gruppe key={g.key} g={g} />)}</div>
      </details>}
    </div>
  );
}
