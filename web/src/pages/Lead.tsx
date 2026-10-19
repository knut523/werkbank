// Lead (Zielbild F1, Knut 19.10.): der eine Gesprächspartner — der Hauptchat der Person. Diese Seite ist nur der Eingang aus der
// Leiste: gibt es den Hauptchat, öffnet ein Klick ihn im Chat; sonst wird er hier gestartet. Gearbeitet wird im Chat.
import { useState } from 'react';
import { api, chatTarget, openChat, type Config } from '../api.ts';
import { Err, Loading, useLoad } from '../ui.tsx';
import { StartHauptchat } from './Leitstand.tsx';
import { mitErstemSatz } from '../erster-start.ts';

const BEISPIELE = [
  'Schau dir PR olaf-admin#354 an und sag mir, ob ich ihn freigeben kann.',
  'Recherchier, wie andere Energieversorger Speicher-Kundinnen ansprechen — kurz, mit Quellen.',
  'Bau die Kachel ‚Ersparnis‘ im Cockpit, wie in der Spec beschrieben, und zeig mir einen Screenshot.',
];

export function LeadSeite({ cfg }: { cfg: Config }) {
  const ov = useLoad<any>(() => api('/api/leitstand/overview'), []);
  const [neu, setNeu] = useState(false);
  if (ov.error) return <div className="page"><Err e={ov.error} /></div>;
  if (!ov.data) return <div className="page"><Loading /></div>;
  const lead = ov.data.leitstand;
  const vorname = (cfg.user?.name ?? '').trim().split(/\s+/)[0];
  return (
    <div className="page" data-testid="lead-seite">
      <h1>Lead</h1>
      <p className="small mut">Dein Gesprächspartner{vorname ? `, ${vorname}` : ''}: Schreib ihm, woran du arbeitest. Er startet die Arbeit in Unter-Chats,
        verteilt Lesen und Recherche an Melious, behält den Überblick und fragt dich, wenn etwas zu entscheiden ist — die Fragen stehen dann unter <a href="#/entscheidungen">Entscheidungen</a>.</p>
      {lead && !neu ? <>
        {/* F2: Die Chat-Vorlagen gehen im Lead auf — statt eines Menüs drei Beispiele, was man ihm schreiben kann. */}
        <ul className="small" data-testid="lead-beispiele">{BEISPIELE.map((b) => <li key={b}>„{b}“</li>)}</ul>
        <div className="ub-card">
          <p className="small"><b>{lead.title}</b> · {lead.status}</p>
          <div className="ub-row"><a className="ub-btn pri" href={lead.url} target={chatTarget} data-testid="lead-oeffnen">Lead öffnen</a>
            <button className="ub-btn ghost sm" onClick={() => setNeu(true)}>Neu starten …</button></div>
        </div>
      </> : lead ? <StartHauptchat aktiv onClose={() => setNeu(false)} onStarted={() => ov.reload()} />
        : <ErsterStart onStarted={() => ov.reload()} />}
    </div>
  );
}

/** U5: erster Start ohne Vorwissen — ein Satz genügt; die erzeugte Übergabe bleibt unter „Erweitert“ einsehbar. */
function ErsterStart({ onStarted }: { onStarted: () => void }) {
  const [satz, setSatz] = useState('');
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<unknown>(null);
  const [erweitert, setErweitert] = useState(false);
  const start = async () => {
    setBusy(true); setFehler(null);
    try {
      const d: any = await api('/api/leitstand/handover');
      const r: any = await api('/api/leitstand/start', { body: { handoverText: mitErstemSatz(d.text, satz) } });
      onStarted(); openChat(r.url);
    } catch (e) { setFehler(e); } finally { setBusy(false); }
  };
  if (erweitert) return <StartHauptchat aktiv={false} onClose={() => setErweitert(false)} onStarted={onStarted} />;
  return (
    <section className="card" data-testid="lead-erster-start" aria-labelledby="lead-erst-h">
      <h2 id="lead-erst-h" style={{ marginTop: 0 }}>Woran arbeitest du gerade?</h2>
      <p className="small muted" style={{ marginTop: 0 }}>Ein Satz genügt. Der Lead öffnet sich danach im Chat und legt los — dort schreibst du weiter.</p>
      <textarea data-testid="lead-erster-satz" rows={3} value={satz} onChange={(e) => setSatz(e.target.value)} style={{ width: '100%' }}
        placeholder="z. B. Ich will verstehen, wie das Cockpit die Ersparnis berechnet." aria-label="Woran arbeitest du gerade?" />
      <p className="tiny muted" style={{ margin: '6px 0 4px' }}>Oder ein Beispiel übernehmen:</p>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }} data-testid="lead-beispiele">
        {BEISPIELE.map((b) => <button key={b} type="button" className="ub-btn ghost sm" onClick={() => setSatz(b)}>„{b}“</button>)}
      </div>
      {fehler ? <Err e={fehler} /> : null}
      <div className="row" style={{ gap: 8, marginTop: 10, alignItems: 'center' }}>
        <button className="btn primary" data-testid="lead-erster-start-los" disabled={busy || !satz.trim()} onClick={start}>{busy ? 'Startet …' : 'Lead starten'}</button>
        <button className="btn ghost sm" type="button" onClick={() => setErweitert(true)}>Erweitert: Übergabe selbst bearbeiten</button>
      </div>
    </section>
  );
}
