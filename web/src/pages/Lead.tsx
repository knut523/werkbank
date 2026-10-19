// Lead (Zielbild F1, Knut 19.10.): der eine Gesprächspartner — der Hauptchat der Person. Diese Seite ist nur der Eingang aus der
// Leiste: gibt es den Hauptchat, öffnet ein Klick ihn im Chat; sonst wird er hier gestartet. Gearbeitet wird im Chat.
import { useState } from 'react';
import { api, chatTarget, type Config } from '../api.ts';
import { Err, Loading, useLoad } from '../ui.tsx';
import { StartHauptchat } from './Leitstand.tsx';

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
      {/* F2: Die Chat-Vorlagen gehen im Lead auf — statt eines Menüs drei Beispiele, was man ihm schreiben kann. */}
      <ul className="small" data-testid="lead-beispiele">
        <li>„Schau dir PR olaf-admin#354 an und sag mir, ob ich ihn freigeben kann.“</li>
        <li>„Recherchier, wie andere Energieversorger Speicher-Kundinnen ansprechen — kurz, mit Quellen.“</li>
        <li>„Bau die Kachel ‚Ersparnis‘ im Cockpit, wie in der Spec beschrieben, und zeig mir einen Screenshot.“</li>
      </ul>
      {lead && !neu ? <div className="ub-card">
        <p className="small"><b>{lead.title}</b> · {lead.status}</p>
        <div className="ub-row"><a className="ub-btn pri" href={lead.url} target={chatTarget} data-testid="lead-oeffnen">Lead öffnen</a>
          <button className="ub-btn ghost sm" onClick={() => setNeu(true)}>Neu starten …</button></div>
      </div> : <StartHauptchat aktiv={!!lead} onClose={() => setNeu(false)} onStarted={() => ov.reload()} />}
    </div>
  );
}
