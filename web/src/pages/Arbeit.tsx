// Arbeit › Unter-Chats (Plan 213 S4a): eine Tabelle — Unter-Chat, Zustand (eine Quelle, S1b), Tiefe, ETA, zuletzt. Eine
// Primäraktion: „＋ Neuer Unter-Chat“ (Auftrag, Repo, Tiefe). Fertiges räumt sich selbst weg (Filter „Erledigt“, Zurückholen).
// Die Karten-Ansicht mit allen bisherigen Knöpfen bleibt unter #/leitstand erreichbar (185 B8: nichts geht verloren).
import { Fragment, useState } from 'react';
import { api, chatTarget, fmtDateTime, type Config } from '../api.ts';
import { Err, Loading, useLoad, useToast } from '../ui.tsx';

const FARBE: Record<string, string> = { wartet: 'warn', blockiert: 'bad', fertig: 'ok', haengt: 'warn', 'stand-fehlt': 'warn', schlange: '', laeuft: '', erledigt: '' };
const sicher = (u: unknown) => (/^https?:\/\//.test(String(u ?? '')) ? String(u) : null);

// Tiefe in Klartext (Walkthrough 221: „plan-to-pr“, „Council“, „Pass A/B/C“ versteht ohne Knuts Kontext niemand).
const TIEFE_KLAR: Record<string, string> = {
  quick: 'Kurz: eine kleine, klar umrissene Änderung — ohne große Planung.',
  regular: 'Normal: plant erst, baut dann, testet und prüft das Ergebnis selbst; am Ende ein Bericht mit Fragen an dich.',
  deep: 'Gründlich: wie Normal, dazu eine Gegenprüfung des Plans durch mehrere Blickwinkel und ein zweites Modell — für Riskantes.',
};

function NeuerUnterChat({ onClose, onDone, vorgabe = '' }: { onClose: () => void; onDone: () => void; vorgabe?: string }) {
  const toast = useToast();
  const opt = useLoad<any>(() => api('/api/arbeit/start'), []);
  const [auftrag, setAuftrag] = useState(vorgabe);
  const [repo, setRepo] = useState('');
  const [tiefe, setTiefe] = useState('regular');
  const sch = useLoad<any>(() => api(`/api/arbeit/schaetzung?tiefe=${tiefe}`), [tiefe]);   // F7: Schätzung vor dem Start
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const start = async () => {
    setBusy(true); setErr(null);
    try { const r: any = await api('/api/arbeit/start', { body: { auftrag, repo: repo || opt.data?.repos?.[0]?.name, tiefe } }); toast(`Gestartet — Paket ${r.paket}`); onDone(); onClose(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div className="ub-drawer" data-testid="neuer-unterchat">
      <div className="ub-scrim" onClick={onClose} />
      <div className="ub-sheet a-dialog" role="dialog" aria-modal="true" aria-labelledby="nuc-titel">
        <h2 id="nuc-titel">Neuer Unter-Chat</h2>
        {!opt.data ? (opt.error ? <Err e={opt.error} /> : <Loading />) : <>
          <label className="small" htmlFor="nuc-auftrag">Auftrag</label>
          <textarea id="nuc-auftrag" rows={5} value={auftrag} onChange={(e) => setAuftrag(e.target.value)} placeholder="Was soll fertig sein? (ein, zwei Sätze — der Unter-Chat plant selbst)" />
          <label className="small" htmlFor="nuc-repo">Repo</label>
          <select id="nuc-repo" value={repo || opt.data.repos[0]?.name || ''} onChange={(e) => setRepo(e.target.value)}>{opt.data.repos.map((r: any) => <option key={r.name} value={r.name}>{r.name}</option>)}</select>
          {!opt.data.repos.length && <p className="tiny mut">Für „Neuer Unter-Chat“ sind noch keine Repos eingerichtet — bis dahin über den Hauptchat starten.</p>}
          <span className="small" id="nuc-tiefe">Tiefe</span>
          <div className="ub-row" role="radiogroup" aria-labelledby="nuc-tiefe">{opt.data.tiefen.map((t: string) => <button key={t} role="radio" aria-checked={tiefe === t} className={`ub-btn sm${tiefe === t ? ' pri' : ''}`} onClick={() => setTiefe(t)}>{t}</button>)}</div>
          <p className="tiny mut">{TIEFE_KLAR[tiefe] ?? ''}</p>
          {sch.data?.text && <p className="tiny" data-testid="nuc-schaetzung">{sch.data.text}{(sch.data.hinweise ?? []).map((h: string) => <span key={h} className="note"> · {h}</span>)}</p>}
          {opt.data.dryRun && <p className="tiny note">Vorschau (Trockenlauf): hier startet nichts.</p>}
          <Err e={err} />
          <div className="ub-row" style={{ justifyContent: 'flex-end' }}><button className="ub-btn sm" onClick={onClose}>Abbrechen</button>
            <button className="ub-btn pri sm" disabled={busy || auftrag.trim().length < 10 || !opt.data.repos.length} onClick={start}>Starten</button></div>
        </>}
      </div>
    </div>
  );
}

// ---------- Arbeit › Reviews & PRs (Plan 213 S4b) ----------

const REVIEW_TEXT: Record<string, string> = { wartet: 'in der Schlange', startet: 'startet', 'läuft': 'läuft', 'führt aus': 'führt Tests aus', fertig: 'fertig', fehler: 'Fehler', 'übersprungen': 'übersprungen', deckel: 'Deckel erreicht' };

function ReviewStarten({ prs, deep, deepTests, vorgabe, onClose, onDone }: { prs: any[]; deep: boolean; deepTests?: string; vorgabe: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [pr, setPr] = useState(vorgabe);
  const [stufe, setStufe] = useState<'quick' | 'deep'>('quick');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const start = async () => {
    setBusy(true); setErr(null);
    try { const r: any = await api('/api/arbeit/reviews/start', { body: { pr, stufe } }); toast(r.hinweis ?? 'Review eingereiht'); onDone(); onClose(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div className="ub-drawer" data-testid="review-starten">
      <div className="ub-scrim" onClick={onClose} />
      <div className="ub-sheet a-dialog" role="dialog" aria-modal="true" aria-labelledby="rs-titel">
        <h2 id="rs-titel">Review starten</h2>
        <label className="small" htmlFor="rs-pr">PR</label>
        <input id="rs-pr" list="rs-prs" value={pr} onChange={(e) => setPr(e.target.value)} placeholder="owner/repo#123 oder GitHub-Link" />
        <datalist id="rs-prs">{prs.map((p) => <option key={p.pr} value={p.pr}>{p.titel}</option>)}</datalist>
        <span className="small" id="rs-stufe">Stufe</span>
        <div className="ub-row" role="radiogroup" aria-labelledby="rs-stufe">
          <button role="radio" aria-checked={stufe === 'quick'} className={`ub-btn sm${stufe === 'quick' ? ' pri' : ''}`} onClick={() => setStufe('quick')}>quick — liest, keine Ausführung</button>
          <button role="radio" aria-checked={stufe === 'deep'} disabled={!deep} className={`ub-btn sm${stufe === 'deep' ? ' pri' : ''}`} onClick={() => setStufe('deep')}>deep{deepTests && deepTests !== 'off' ? ' — mit Tests (Erlaubtliste)' : ' — statisch'}</button>
        </div>
        <p className="tiny mut">{deepTests && deepTests !== 'off' ? 'deep: Tests laufen auf der Workspace-VM, nur für PRs von der Erlaubtliste (nicht netzisoliert); sonst statisches Deep-Review mit Council.' : 'deep: statisches Deep-Review mit Council (Testausführung ist aus).'} Ergebnis: Kommentar-Entwurf (englisch) und Bericht (deutsch); gepostet wird erst nach deinem Ja.</p>
        <Err e={err} />
        <div className="ub-row" style={{ justifyContent: 'flex-end' }}><button className="ub-btn sm" onClick={onClose}>Abbrechen</button><button className="ub-btn pri sm" disabled={busy || !pr.trim()} onClick={start}>Review starten</button></div>
      </div>
    </div>
  );
}

export function ArbeitReviews() {
  const { data, error, reload } = useLoad<any>(() => api('/api/arbeit/reviews'), []);
  const [starten, setStarten] = useState<string | null>(null);
  if (error) return <div className="page"><Err e={error} /></div>;
  if (!data) return <div className="page"><Loading /></div>;
  const fuer = data.prs.filter((p: any) => p.fuerDich).length;
  return (
    <div className="page wide" data-testid="arbeit-reviews">
      <div className="h-kopf">
        <div><h1>Reviews & PRs</h1><p className="small mut">live von GitHub{data.stand ? `, Stand ${fmtDateTime(data.stand)}` : ''} · {fuer} für dich · {data.laufend.length} Reviews laufen{data.fehler ? ` · ⚠ ${data.fehler}` : ''}</p></div>
        <button className="ub-btn pri" onClick={() => setStarten('')} data-testid="review-knopf">＋ Review starten</button>
      </div>
      <table className="a-tab" data-testid="pr-tabelle">
        <thead><tr><th>PR</th><th>Für dich</th><th className="a-m">Review</th><th className="a-m">Geändert</th><th></th></tr></thead>
        <tbody>{data.prs.map((p: any) => <tr key={p.pr} data-fuer={p.fuerDich ? '1' : '0'}>
          <td>{p.url ? <a href={p.url} target="_blank" rel="noreferrer"><b>{p.pr}</b></a> : <b>{p.pr}</b>}{p.entwurf ? <span className="chip"> Entwurf</span> : null}<div className="tiny mut">{p.titel}</div></td>
          <td>{p.fuerDich ? <span className="chip warn">{p.warum}</span> : '–'}</td>
          <td className="a-m tiny">{p.review ? <>{p.review.stufe} · {REVIEW_TEXT[p.review.status] ?? p.review.status}{p.review.empfehlung ? ` · ${p.review.empfehlung}` : ''}{p.review.paket ? <> · <a href={`#/ablage`}>{p.review.paket.split('-')[0]}</a></> : null}</> : '–'}</td>
          <td className="a-m tiny">{p.geaendert ? fmtDateTime(p.geaendert) : '–'}</td>
          <td><button className="ub-btn ghost sm" onClick={() => setStarten(p.pr)} aria-label={`Review für ${p.pr} starten`}>Review</button></td>
        </tr>)}</tbody>
      </table>
      {!data.prs.length && <div className="ub-card soft"><p className="small mut">Keine offenen PRs im Abgleich.</p></div>}
      {data.meldungen.length > 0 && <details className="ub-card" style={{ marginTop: 14 }}><summary className="small">Neu an PRs ({data.meldungen.length})</summary>
        <ul className="plain h-liste tiny">{data.meldungen.map((m: any, i: number) => <li key={i}><b>{m.pr}</b> {m.wer ? `${m.wer}: ` : ''}{m.text} <span className="mut">{fmtDateTime(m.at)}</span></li>)}</ul></details>}
      {starten !== null && <ReviewStarten prs={data.prs} deep={data.deep} deepTests={data.deepTests} vorgabe={starten} onClose={() => setStarten(null)} onDone={reload} />}
    </div>
  );
}

export function ArbeitUnterchats({ cfg: _cfg }: { cfg: Config }) {
  const toast = useToast();
  const [filter, setFilter] = useState<'offen' | 'erledigt'>('offen');
  const [auf, setAuf] = useState<string | null>(null);
  // Ein Start (P4): #/arbeit?neu=1&auftrag=… öffnet den Dialog vorbefüllt (aus dem Board, später aus Specs).
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const [neu, setNeu] = useState(q.get('neu') === '1');
  const [vorgabe] = useState(q.get('auftrag') ?? '');
  const { data, error, reload } = useLoad<any>(() => api(`/api/arbeit/unterchats?filter=${filter}`), [filter]);
  const zurueck = async (id: string) => { try { await api(`/api/leitstand/strands/${id}/zurueckholen`, { method: 'POST', body: {} }); toast('Zurückgeholt'); reload(); } catch (e: any) { toast(e.message ?? 'Fehler'); } };
  if (error) return <div className="page"><Err e={error} /></div>;
  if (!data) return <div className="page"><Loading /></div>;
  const z = data.zaehler ?? {};
  return (
    <div className="page wide" data-testid="arbeit-unterchats">
      <div className="h-kopf">
        <div><h1>Arbeit</h1><p className="small mut">{z.laeuft ?? 0} laufen · {z.schlange ?? 0} in der Schlange · {z.wartet ?? 0} warten auf dich · {(z.haengt ?? 0) + (z.blockiert ?? 0)} hängen/blockiert</p></div>
        <button className="ub-btn pri" onClick={() => setNeu(true)} data-testid="neu-knopf">＋ Neuer Unter-Chat</button>
      </div>
      <div className="ub-row small" role="tablist" aria-label="Filter">
        <button role="tab" aria-selected={filter === 'offen'} className={`ub-btn sm${filter === 'offen' ? ' pri' : ' ghost'}`} onClick={() => setFilter('offen')}>Offen {data.offen ?? ''}</button>
        <button role="tab" aria-selected={filter === 'erledigt'} className={`ub-btn sm${filter === 'erledigt' ? ' pri' : ' ghost'}`} onClick={() => setFilter('erledigt')}>Erledigt (14 Tage) {data.erledigt}</button>
        <span className="sp" /><a className="tiny" href="#/leitstand">Karten-Ansicht</a>
      </div>
      <table className="a-tab" data-testid="a-tabelle">
        <thead><tr><th>Unter-Chat</th><th>Zustand</th><th className="a-m">Tiefe</th><th>ETA</th><th className="a-m">Zuletzt</th></tr></thead>
        <tbody>
          {data.zeilen.map((r: any) => <Fragment key={r.id}>
            <tr className={auf === r.id ? 'auf' : ''} onClick={() => setAuf(auf === r.id ? null : r.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setAuf(auf === r.id ? null : r.id); }} aria-expanded={auf === r.id} data-testid="a-zeile" data-zustand={r.zustand}>
              <td><b>{r.titel}</b><div className="tiny mut">{r.thema}</div></td>
              <td><span className={`chip ${FARBE[r.zustand] ?? ''}`}>{r.zustandText}</span></td>
              <td className="a-m">{r.tiefe}</td>
              <td>{r.eta ? <span className={r.eta.ueberfaellig ? 'mut' : ''}>{r.eta.text}</span> : '–'}</td>
              <td className="a-m tiny">{r.zuletzt ? fmtDateTime(r.zuletzt) : '–'}</td>
            </tr>
            {auf === r.id && <tr className="a-detail"><td colSpan={5}>
              {r.grund && <p className="small">{r.grund}</p>}
              <div className="ub-row">
                {r.bericht && <a className="ub-btn sm" href={`#/leitstand?bericht=${r.id}`}>Bericht</a>}
                {sicher(r.chat) && <a className="ub-btn sm" href={sicher(r.chat)!} target={chatTarget} rel="noreferrer">Chat</a>}
                <a className="ub-btn sm" href={`#/leitstand?review=${r.id}`}>Review & Freigabe</a>
                {r.autoWeg && <button className="ub-btn sm" onClick={() => zurueck(r.id)}>Zurückholen</button>}
              </div>
            </td></tr>}
          </Fragment>)}
        </tbody>
      </table>
      {!data.zeilen.length && <div className="ub-card soft"><p className="small mut">{filter === 'offen' ? 'Nichts offen.' : 'Nichts erledigt in den letzten 14 Tagen.'}</p></div>}
      {neu && <NeuerUnterChat vorgabe={vorgabe} onClose={() => { setNeu(false); if (/[?&]neu=1/.test(window.location.hash)) window.history.replaceState(null, '', '#/arbeit'); }} onDone={reload} />}
    </div>
  );
}
