// Wissen › Ablage (Plan 213 S5): Pakete nach Status (wartet auf dich zuerst), Decks und Downloads direkt — ein Ort statt
// Links auf Datei-Server-Ports. „Dateien & Teilen“ ist die bisherige Seite (Upload, Einsortieren, Geteilt, Protokoll).
import { useState } from 'react';
import { api, fmtDateTime, type Config } from '../api.ts';
import { Err, Loading, useLoad } from '../ui.tsx';
import { Dateien, Vorschau } from './Dateien.tsx';

const STATUS: { id: string; text: string; chip: string }[] = [
  { id: '', text: 'Alle (ohne Archiv)', chip: '' }, { id: 'wartet', text: 'wartet auf dich', chip: 'warn' }, { id: 'bereit', text: 'bereit für GitHub', chip: 'ok' },
  { id: 'blockiert', text: 'blockiert', chip: 'bad' }, { id: 'kopf-fehler', text: 'Kopf unlesbar', chip: 'bad' }, { id: 'ohne-kopf', text: 'ohne Kopf', chip: '' }, { id: 'archiv', text: 'Archiv', chip: '' },
];
const datei = (paket: string, rel: string) => `api/files/agenten/${encodeURIComponent(paket)}/${rel.split('/').map(encodeURIComponent).join('/')}`;

function Pakete() {
  const [status, setStatus] = useState('wartet');
  const [q, setQ] = useState('');
  const [ansicht, setAnsicht] = useState<{ paket: string; rel: string } | null>(null);
  const { data, error } = useLoad<any>(() => api(`/api/ablage/pakete?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`), [status, q]);
  if (error) return <Err e={error} />;
  return (
    <div data-testid="ablage-pakete">
      <div className="ub-row small" role="tablist" aria-label="Status">
        {STATUS.map((s) => <button key={s.id} role="tab" aria-selected={status === s.id} className={`ub-btn sm${status === s.id ? ' pri' : ' ghost'}`} onClick={() => setStatus(s.id)}>
          {s.text}{data && s.id ? ` ${data.zahlen?.[s.id] ?? 0}` : ''}</button>)}
        <span className="sp" />
        <input aria-label="Pakete suchen" placeholder="Paket suchen …" value={q} onChange={(e) => setQ(e.target.value)} style={{ minHeight: 40, padding: '0 10px', borderRadius: 9, border: '1px solid var(--border-light)' }} />
      </div>
      {!data ? <Loading /> : <table className="a-tab">
        <thead><tr><th>Paket</th><th>Status</th><th className="a-m">Decks & Downloads</th><th className="a-m">Stand</th></tr></thead>
        <tbody>{data.zeilen.map((z: any) => <tr key={z.name} data-status={z.status}>
          <td><b>{z.nr}</b> {z.titel}<div className="tiny mut">{z.name} · {z.dateien} Dateien{z.bilder ? ` · ${z.bilder} Bilder` : ''}</div>
            {z.fehler && <div className="tiny err">{z.fehler}</div>}</td>
          <td><span className={`chip ${STATUS.find((s) => s.id === z.status)?.chip ?? ''}`}>{STATUS.find((s) => s.id === z.status)?.text ?? z.status}</span>{z.offen ? <div className="tiny">{z.offen} offene Fragen</div> : null}</td>
          <td className="a-m tiny"><div className="ub-row">
            {z.status !== 'archiv' && <button className="ub-btn sm" onClick={() => setAnsicht({ paket: z.name, rel: 'bericht.md' })}>Bericht</button>}
            {z.decks.map((d: string) => <a key={d} className="ub-btn sm" href={datei(z.name, d)} target="_blank" rel="noreferrer">{d.split('/').pop()}</a>)}
            {z.downloads.filter((d: string) => !z.decks.includes(d)).map((d: string) => <a key={d} className="ub-btn ghost sm" href={datei(z.name, d)} download>⬇ {d.split('/').pop()}</a>)}
          </div></td>
          <td className="a-m tiny">{fmtDateTime(z.at)}</td>
        </tr>)}</tbody>
      </table>}
      {data && !data.zeilen.length && <div className="ub-card soft"><p className="small mut">Keine Pakete in diesem Filter.</p></div>}
      {ansicht && <Vorschau paket={ansicht.paket} rel={ansicht.rel} onClose={() => setAnsicht(null)} />}
    </div>
  );
}

export function Ablage({ cfg }: { cfg: Config }) {
  const [teil, setTeil] = useState<'pakete' | 'dateien'>(cfg.user?.role === 'ADMIN' ? 'pakete' : 'dateien');
  return (
    <div className="page wide">
      <h1>Ablage</h1>
      <p className="small mut">Ein Ort für Review-Pakete, Decks, Downloads und geteilte Dateien.</p>
      {cfg.user?.role === 'ADMIN' && <div className="ub-row" role="tablist" aria-label="Ablage" style={{ marginBottom: 12 }}>
        <button role="tab" aria-selected={teil === 'pakete'} className={`ub-btn sm${teil === 'pakete' ? ' pri' : ' ghost'}`} onClick={() => setTeil('pakete')}>Pakete</button>
        <button role="tab" aria-selected={teil === 'dateien'} className={`ub-btn sm${teil === 'dateien' ? ' pri' : ' ghost'}`} onClick={() => setTeil('dateien')}>Dateien & Teilen</button>
      </div>}
      {teil === 'pakete' ? <Pakete /> : <Dateien cfg={cfg} />}
    </div>
  );
}
