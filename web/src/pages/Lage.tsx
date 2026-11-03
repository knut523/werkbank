// Lage (Release 31; Knut 02.11.: „Was ist offen?“ — mehrmals täglich; die Ansicht beantwortet das ohne Nachfrage).
// Eine Spalte, auf dem Handy lesbar: Für dich zu tun (die ersten Entscheidungen direkt mit Knöpfen, wie auf der
// Entscheidungsseite) · Läuft · Fertig seit heute früh · Erledigt der Hauptchat · PR-Lage · Themen. Nur lesen außer den
// Antwort-Knöpfen der Entscheidungskarten (dieselbe Route wie die Entscheidungsseite). Schalter WERKBANK_LAGE.
import { useState } from 'react';
import { api, fmtDateTime } from '../api.ts';
import { Err, Loading, useLoad } from '../ui.tsx';
import { Karte, type Frage } from './Entscheidungen.tsx';
import { WasIstDas } from '../nachfrage.tsx';

const SOFORT = 1;   // die wichtigste Entscheidung mit Knöpfen direkt in der Lage; der Rest als eine Zeile mit Empfehlung (auf einen Blick)
const sicher = (u: string | null | undefined) => (u && (/^https?:\/\//.test(u) || /^#\//.test(u) || /^\/#\//.test(u)) ? u : null);
const kurzPr = (pr: string) => pr.replace(/^[^/]+\//, '');
const uhr = (s?: string | null) => (s ? new Date(s).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' }) : '');
const wissen = (p: string) => '#/wissen/' + p.split('/').map(encodeURIComponent).join('/');

function Abschnitt({ titel, zahl, id, children, leer }: { titel: string; zahl?: number | null; id: string; children: React.ReactNode; leer?: string | false }) {
  return (
    <section className="card lage-sec" data-testid={`lage-${id}`} aria-labelledby={`lage-h-${id}`}>
      <h2 id={`lage-h-${id}`} className="lage-h">{titel}{zahl != null && <span className={`chip${zahl ? ' warn' : ' ok'}`}>{zahl}</span>}</h2>
      {leer ? <p className="small mut">{leer}</p> : children}
    </section>
  );
}

export function Lage() {
  const { data, error, loading, reload } = useLoad(() => api<any>('/api/lage'), []);
  const fr = useLoad(() => api<{ fragen: Frage[] }>('/api/entscheidungen/fragen'), []);
  const [erledigt, setErledigt] = useState<Record<string, string>>({});
  if (loading && !data) return <div className="page lage"><Loading what="Lage wird zusammengestellt" /></div>;
  if (error) return <div className="page lage"><Err e={error} /></div>;
  const l = data;
  const karten = (fr.data?.fragen ?? []).filter((f) => f.klasse !== 'aktion' && !erledigt[f.id]);
  const sofort = karten.slice(0, SOFORT);
  const fdRest = (l.fuerDich as any[]).filter((x) => x.art !== 'frage' || (!erledigt[x.id] && !sofort.some((f) => f.id === x.id)));
  const offenFragen = (l.fuerDich as any[]).filter((x) => x.art === 'frage').length;
  return (
    <div className="page lage" data-testid="lage">
      <header className="lage-kopf">
        <h1>Was ist offen?</h1>
        <p className="small mut">Stand {fmtDateTime(l.at)} · seit heute früh {uhr(l.seit)} · <button className="linkish" onClick={() => { reload(); fr.reload(); }}>neu laden</button></p>
        <p className="lage-summe" data-testid="lage-summe">
          <b>{l.zahlen.fuerDich}</b> für dich · <b>{l.zahlen.laeuft}</b> laufen · <b>{l.zahlen.fertig}</b> fertig seit heute früh · <b>{l.zahlen.hauptchat}</b> erledigt der Hauptchat{l.zahlen.prsOffen != null && <> · <b>{l.zahlen.prsOffen}</b> offene PRs</>}
        </p>
        {l.fehler?.length > 0 && <p className="tiny" role="status">Nicht alles lesbar: {l.fehler.join(' · ')}</p>}
      </header>

      <Abschnitt titel="Für dich zu tun" zahl={l.zahlen.fuerDich} id="fuerdich" leer={!l.fuerDich.length && 'Nichts — keine Entscheidung, keine Review-Bitte, Jira sauber.'}>
        {sofort.map((f) => <Karte key={f.id} f={f} kurz onDone={(id, s) => { setErledigt((e) => ({ ...e, [id]: s })); }} />)}
        <ul className="lage-liste">
          {fdRest.map((x) => (
            <li key={x.id} data-testid="lage-fd">
              <span className={`chip${x.art === 'approve' ? ' warn' : ''}`}>{x.art === 'frage' ? (x.stufe === 'wichtig' ? 'wichtig' : 'Frage') : x.art === 'approve' ? 'Review' : 'Jira'}</span>{' '}
              {sicher(x.link) ? <a href={sicher(x.link)!} target={/^https?:/.test(x.link) ? '_blank' : undefined} rel="noreferrer">{x.titel}</a> : x.titel}
              {x.empfehlung && <div className="tiny">{x.art === 'frage' ? 'Empfehlung: ' : ''}{x.empfehlung}</div>}
              {x.art === 'frage' ? <WasIstDas art="frage" id={x.id} kompakt /> : x.art === 'approve' ? <WasIstDas art="pr" id={String(x.id).replace(/^pr:/, '')} kompakt /> : null}
            </li>
          ))}
        </ul>
        {offenFragen > SOFORT && <p className="small"><a href="#/entscheidungen">Alle {offenFragen} Entscheidungen auf der Entscheidungsseite →</a></p>}
      </Abschnitt>

      <Abschnitt titel="Läuft gerade" zahl={l.laeuft.length} id="laeuft" leer={!l.laeuft.length && 'Kein Unter-Chat läuft.'}>
        <ul className="lage-liste">
          {l.laeuft.map((s: any) => (
            <li key={s.id}>
              {sicher(s.chat) ? <a href={sicher(s.chat)!} target="_blank" rel="noreferrer">{s.titel}</a> : s.titel}
              <span className="tiny"> · {s.thema}{s.blockiert ? ' · wartet' : ''}</span>
              <div className={`tiny${s.ueberfaellig ? ' lage-warn' : ''}`}>{s.eta ?? 'ohne ETA'}</div>
            </li>
          ))}
        </ul>
      </Abschnitt>

      <Abschnitt titel="Fertig seit heute früh" zahl={null} id="fertig" leer={!l.fertig.length && 'Seit heute früh ist nichts fertig geworden.'}>
        <ul className="lage-liste">
          {l.fertig.map((f: any) => (
            <li key={f.id}>
              {sicher(f.link) ? <a href={sicher(f.link)!}>{f.satz}</a> : f.satz}
              <div className="tiny">{uhr(f.at)} · {f.ampel === 'geprüft' ? 'von dir geprüft' : f.ampel === 'push' ? 'bereit zum Push' : 'dein Review'}{f.strang && f.strang !== f.satz ? ` · ${f.strang}` : ''}</div>
            </li>
          ))}
        </ul>
      </Abschnitt>

      <Abschnitt titel="Erledigt der Hauptchat" zahl={null} id="hauptchat" leer={!l.hauptchat.length && (l.schalter?.brauchtDich ? 'Nichts — keine Aufgabe für den Hauptchat.' : 'Nichts (Klassifikation „Braucht dich“ ist aus).')}>
        <ul className="lage-liste">
          {l.hauptchat.map((a: any) => <li key={a.kennung}><span className="chip ok">{a.aktion}</span> {a.titel}<div className="tiny">nichts für dich — der Hauptchat führt es über die Freigabewege aus</div></li>)}
        </ul>
      </Abschnitt>

      <Abschnitt titel="PR-Lage" zahl={l.prs?.offen ?? null} id="prs" leer={!l.prs ? 'PR-Lage ist ausgeschaltet.' : !l.prs.offen && 'Keine offenen PRs.'}>
        {l.prs && <>
          <p className="tiny">{l.prs.quelle === 'live' ? 'live von GitHub' : `aus der Kopie${l.prs.hinweis ? ` (${l.prs.hinweis})` : ''}`} · Ticker {l.prs.ticker.an ? `an, letzter Lauf ${uhr(l.prs.ticker.letzterLauf)}` : 'aus'}</p>
          {l.prs.gruppen.map((g: any) => (
            <div key={g.titel} className="lage-gruppe">
              <h3 className="lage-h3">{g.titel} <span className="chip">{g.zeilen.length}</span></h3>
              <ul className="lage-liste">
                {g.zeilen.slice(0, 8).map((z: any) => (
                  <li key={z.pr} data-testid="lage-pr">
                    {sicher(z.url) ? <a href={sicher(z.url)!} target="_blank" rel="noreferrer">{kurzPr(z.pr)}</a> : kurzPr(z.pr)} {z.titel} <WasIstDas art="pr" id={z.pr} kompakt />
                    <div className="tiny">{z.autor ?? '?'} · {z.merge ? `merge: ${z.mergeHinweis}` : z.entscheidung ?? '—'}{z.reviews.length ? ` · ${z.reviews.map((r: any) => `${r.wer} ${r.zustand}`).join(', ')}` : ''}{z.tags.length ? ` · ${z.tags.map((t: any) => `${t.tag} ${t.wer}`).join(', ')}` : ''}{z.ticker?.review ? ` · Ticker: ${z.ticker.review}` : ''}</div>
                  </li>
                ))}
                {g.zeilen.length > 8 && <li className="tiny">… und {g.zeilen.length - 8} weitere</li>}
              </ul>
            </div>
          ))}
          {l.prs.gepusht.length > 0 && <p className="small"><b>Heute von uns gepusht:</b> {l.prs.gepusht.map((z: any) => `${kurzPr(z.pr)} (${z.gepusht.sha}, ${z.gepusht.quelle})`).join(' · ')}</p>}
          {l.prs.chris.length > 0 && <div><h3 className="lage-h3">Christoph zuletzt</h3><ul className="lage-liste">{l.prs.chris.map((c: any, i: number) => <li key={i} className="small">{sicher(c.url) ? <a href={sicher(c.url)!} target="_blank" rel="noreferrer">{kurzPr(c.pr)}</a> : kurzPr(c.pr)} {uhr(c.wann)}: {c.text}</li>)}</ul></div>}
        </>}
      </Abschnitt>

      <Abschnitt titel="Themen" zahl={null} id="themen">
        <ul className="lage-liste">
          {l.themen.map((t: any) => (
            <li key={t.thema} data-testid="lage-thema">
              <b>{t.thema}</b>{(t.laufen || t.fertigHeute) ? <span className="tiny"> · {t.laufen} laufen · {t.fertigHeute} fertig heute</span> : null}
              <div>{t.satz}</div>
              <div className="tiny">{t.link ? <a href={wissen(t.link)}>{t.quelle}</a> : t.quelle}</div>
            </li>
          ))}
        </ul>
      </Abschnitt>
    </div>
  );
}
