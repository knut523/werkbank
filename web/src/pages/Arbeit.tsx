// Arbeit › Unter-Chats (Plan 213 S4a): eine Tabelle — Unter-Chat, Zustand (eine Quelle, S1b), Tiefe, ETA, zuletzt. Eine
// Primäraktion: „＋ Neuer Unter-Chat“ (Auftrag, Repo, Tiefe). Fertiges räumt sich selbst weg (Filter „Erledigt“, Zurückholen).
// Die Karten-Ansicht mit allen bisherigen Knöpfen bleibt unter #/leitstand erreichbar (185 B8: nichts geht verloren).
import { Fragment, useState } from 'react';
import { api, chatTarget, fmtDateTime, type Config } from '../api.ts';
import { Err, Loading, useLoad, useToast } from '../ui.tsx';

const FARBE: Record<string, string> = { wartet: 'warn', blockiert: 'bad', fertig: 'ok', haengt: 'warn', 'stand-fehlt': 'warn', schlange: '', laeuft: '', erledigt: '' };
const sicher = (u: unknown) => (/^https?:\/\//.test(String(u ?? '')) ? String(u) : null);

function NeuerUnterChat({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const opt = useLoad<any>(() => api('/api/arbeit/start'), []);
  const [auftrag, setAuftrag] = useState('');
  const [repo, setRepo] = useState('');
  const [tiefe, setTiefe] = useState('regular');
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
        {!opt.data ? <Loading /> : <>
          <label className="small" htmlFor="nuc-auftrag">Auftrag</label>
          <textarea id="nuc-auftrag" rows={5} value={auftrag} onChange={(e) => setAuftrag(e.target.value)} placeholder="Was soll fertig sein? (ein, zwei Sätze — der Unter-Chat plant selbst)" />
          <label className="small" htmlFor="nuc-repo">Repo</label>
          <select id="nuc-repo" value={repo || opt.data.repos[0]?.name || ''} onChange={(e) => setRepo(e.target.value)}>{opt.data.repos.map((r: any) => <option key={r.name} value={r.name}>{r.name}</option>)}</select>
          {!opt.data.repos.length && <p className="tiny mut">Für „Neuer Unter-Chat“ sind noch keine Repos eingerichtet — bis dahin über den Hauptchat starten.</p>}
          <span className="small" id="nuc-tiefe">Tiefe</span>
          <div className="ub-row" role="radiogroup" aria-labelledby="nuc-tiefe">{opt.data.tiefen.map((t: string) => <button key={t} role="radio" aria-checked={tiefe === t} className={`ub-btn sm${tiefe === t ? ' pri' : ''}`} onClick={() => setTiefe(t)}>{t}</button>)}</div>
          <p className="tiny mut">{tiefe === 'quick' ? 'quick: kurz, ohne Council, kleines Budget.' : tiefe === 'deep' ? 'deep: plan-to-pr mit Council, mehr Schritte, Gegenprüfung.' : 'regular: plan-to-pr, Tests, Pass A/B/C.'} Das Review-Paket bekommt die nächste freie Nummer.</p>
          {opt.data.dryRun && <p className="tiny note">Vorschau (Trockenlauf): hier startet nichts.</p>}
          <Err e={err} />
          <div className="ub-row" style={{ justifyContent: 'flex-end' }}><button className="ub-btn sm" onClick={onClose}>Abbrechen</button>
            <button className="ub-btn pri sm" disabled={busy || auftrag.trim().length < 10 || !opt.data.repos.length} onClick={start}>Starten</button></div>
        </>}
      </div>
    </div>
  );
}

export function ArbeitUnterchats({ cfg: _cfg }: { cfg: Config }) {
  const toast = useToast();
  const [filter, setFilter] = useState<'offen' | 'erledigt'>('offen');
  const [auf, setAuf] = useState<string | null>(null);
  const [neu, setNeu] = useState(false);
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
      {neu && <NeuerUnterChat onClose={() => setNeu(false)} onDone={reload} />}
    </div>
  );
}
