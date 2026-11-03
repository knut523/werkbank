// „Heute erledigt“ (R32, Nachtrag 5, Knut 03.11.): alles, was an einem Tag fertig wurde — Stränge mit Ergebnis-Satz, Link und Dokumenten,
// gepushte PRs, Entscheidungen, Releases. Datumswahl für frühere Tage. Nur lesen.
import { useState } from 'react';
import { api, fmtDateTime } from '../api.ts';
import { Err, Loading, useLoad } from '../ui.tsx';

const uhr = (iso: string) => new Date(iso).toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' });
const sicher = (u: string | null | undefined) => (u && (/^https?:\/\//.test(u) || /^[#/]/.test(u)) ? u : null);

export function Dokumente({ liste }: { liste: { label: string; url: string }[] }) {
  if (!liste?.length) return null;
  return <span className="er-doks" data-testid="dokumente">{liste.map((d) => <a key={d.url} className="ub-chip" href={d.url} download={d.label} target="_blank" rel="noreferrer" data-testid="dokument-link" title="Herunterladen bzw. öffnen">⬇ {d.label}</a>)}</span>;
}

export function HeuteErledigt() {
  const heute = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(new Date());
  const [datum, setDatum] = useState(heute);
  const d = useLoad<any>(() => api(`/api/erledigt?datum=${datum}`), [datum]);
  const x = d.data;
  const tag = (n: number) => { const t = new Date(`${datum}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); setDatum(new Intl.DateTimeFormat('sv-SE', { timeZone: 'UTC' }).format(t)); };
  return (
    <div className="page wide er" data-testid="heute-erledigt">
      <header className="e-kopf">
        <h1>{datum === heute ? 'Heute erledigt' : `Erledigt am ${datum.split('-').reverse().join('.')}`}</h1>
        <div className="ub-row">
          <button className="ub-btn sm" onClick={() => tag(-1)} aria-label="Vorheriger Tag" data-testid="er-zurueck">◀ Tag davor</button>
          <input type="date" value={datum} max={heute} onChange={(e) => e.target.value && setDatum(e.target.value)} aria-label="Datum wählen" data-testid="er-datum" />
          <button className="ub-btn sm" disabled={datum >= heute} onClick={() => tag(1)} aria-label="Nächster Tag">Tag danach ▶</button>
          {datum !== heute && <button className="ub-btn ghost sm" onClick={() => setDatum(heute)}>Heute</button>}
        </div>
        {x && <p className="small" data-testid="er-zahlen"><b>{x.zahlen.straenge}</b> Unter-Chats fertig · <b>{x.zahlen.pushes}</b> gepusht · <b>{x.zahlen.entscheidungen}</b> Entscheidungen · <b>{x.zahlen.releases}</b> Releases</p>}
      </header>
      {d.error ? <Err e={d.error} /> : !x ? <Loading /> : <>
        <section data-testid="er-straenge"><h2 className="e-teil">Fertige Unter-Chats <span className="chip">{x.zahlen.straenge}</span></h2>
          {x.straenge.length ? <ul className="lage-liste">{x.straenge.map((s: any) => <li key={s.id} data-testid="er-strang">
            {sicher(s.link) ? <a href={sicher(s.link)!}><b>{s.titel}</b></a> : <b>{s.titel}</b>}
            <div className="tiny mut">{uhr(s.at)}{s.thema ? ` · ${s.thema}` : ''}{s.strang && s.strang !== s.titel ? ` · ${s.strang}` : ''}</div><Dokumente liste={s.dokumente} /></li>)}</ul>
            : <p className="small mut">An diesem Tag ist kein Unter-Chat fertig geworden.</p>}</section>
        <section data-testid="er-pushes"><h2 className="e-teil">Gepushte PRs <span className="chip">{x.zahlen.pushes}</span></h2>
          {x.pushes.length ? <ul className="lage-liste">{x.pushes.map((p: any, i: number) => <li key={i}>{sicher(p.pr) ? <a href={p.pr} target="_blank" rel="noreferrer">{p.repo.split('/').pop()} <code>{p.zweig}</code></a> : <>{p.repo.split('/').pop()} <code>{p.zweig}</code></>}
            <span className="tiny mut"> · <code>{p.commit}</code> · {uhr(p.at)}</span></li>)}</ul> : <p className="small mut">Nichts gepusht.</p>}</section>
        <section data-testid="er-entscheidungen"><h2 className="e-teil">Entscheidungen <span className="chip">{x.zahlen.entscheidungen}</span></h2>
          {x.entscheidungen.length ? <ul className="lage-liste">{x.entscheidungen.map((e: any, i: number) => <li key={i}>{e.titel} <span className="tiny mut">→ {e.antwort}{e.auto ? ' (automatisch angenommen)' : ''} · {fmtDateTime(e.at).split(', ').pop()}</span></li>)}</ul> : <p className="small mut">Keine Entscheidung.</p>}</section>
        <section data-testid="er-releases"><h2 className="e-teil">Releases <span className="chip">{x.zahlen.releases}</span></h2>
          {x.releases.length ? <ul className="lage-liste">{x.releases.map((r: any, i: number) => <li key={i}>{r.name} <span className="tiny mut">· {uhr(r.at)}</span></li>)}</ul> : <p className="small mut">Kein Release.</p>}</section>
      </>}
    </div>
  );
}
