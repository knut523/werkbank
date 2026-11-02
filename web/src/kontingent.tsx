// Kontingent-Zeile oben in der Werkbank (R31 Nachtrag 2, Knut 02.11.2026: „wenn Melious so niedrig läuft, müssen wir das sehen“).
// Melious-Rest, Claude je Konto (erschöpft bis/frei, Züge heute) und die automatische Modellwahl — alle 5 Minuten neu.
import { useEffect, useState } from 'react';
import { api } from './api';

interface Konto { id: string; label: string; erschoepftBis: number | null; zuegeHeute: number }
interface K { melious: { restProzent: number | null; geschaetzt: boolean; sperre: string | null; monat: { model: string; energie: number; turns: number }[] } | null; claude: Konto[]; schwelle: number; wahl: 'melious' | 'claude'; auto: string[] }

const uhr = (t: number) => new Date(t).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' });

export function KontingentZeile() {
  const [k, setK] = useState<K | null>(null);
  useEffect(() => {
    let weg = false;
    const laden = () => api<K>('/api/kontingent').then((x) => { if (!weg) setK(x); }).catch(() => {});
    laden();
    const t = setInterval(laden, 5 * 60_000);
    return () => { weg = true; clearInterval(t); };
  }, []);
  if (!k) return null;
  const m = k.melious;
  const knapp = !!m && (m.sperre !== null || (m.restProzent !== null && m.restProzent < k.schwelle));
  const jetzt = Date.now();
  const modelle = m?.monat.map((x) => `${x.model}: ${Math.round(x.energie).toLocaleString('de-DE')} Energie, ${x.turns} Züge`).join('\n') ?? '';
  return (
    <div className="kontingent row" role="status" aria-label="Kontingent" data-testid="kontingent">
      <span className={`chip ${!m ? '' : knapp ? 'bad' : 'ok'}`} title={modelle ? `Monat je Modell:\n${modelle}` : undefined}>
        Melious {!m ? 'aus' : m.sperre ? 'gesperrt' : m.restProzent === null ? '?' : `${m.restProzent} %${m.geschaetzt ? ' (geschätzt)' : ''}`}
      </span>
      {k.claude.map((c) => {
        const leer = !!c.erschoepftBis && c.erschoepftBis > jetzt;
        return <span key={c.id} className={`chip ${leer ? 'warn' : 'ok'}`} title={`${c.zuegeHeute} Züge heute`}>{c.label} {leer ? `erschöpft bis ${uhr(c.erschoepftBis!)}` : 'frei'} · {c.zuegeHeute}</span>;
      })}
      {k.auto.length > 0 && <span className="chip" title={`automatisch: ${k.auto.join(', ')} · Schwelle ${k.schwelle} %`}>auto → {k.wahl === 'melious' ? 'Melious' : 'Claude'}</span>}
    </div>
  );
}
