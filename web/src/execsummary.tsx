// Exec Summary eines Berichts (docs/plan-leitstand.md, C.7) — wie Folie 1 im Vorbild: worum es geht, was anders ist, was Knut tun
// muss, Pull Requests mit dem Stand von GitHub (vom Server geprüft, nie aus dem Bericht). Auf „Heute“ in der Karte und über dem
// Bericht in der Leitstand-Ansicht.

export const STATUS_TEXT: Record<string, [string, string]> = { wartet_auf_knut: ['braucht dich', 'warn'], bereit_fuer_github: ['Unter-Chat meldet: bereit zum Push', 'ok'], blockiert: ['blockiert', 'bad'] };
const STAND_CHIP: Record<string, string> = { offen: 'warn', gemergt: 'ok', geschlossen: 'bad', fehlt: 'bad', unbekannt: '', lokal: '' };

export interface Summary { kopf: any; prs: any[]; maengel?: string[]; prsAt?: string | null }

export function ExecSummary({ s, fragen = 0 }: { s: Summary | null | undefined; fragen?: number }) {
  const k = s?.kopf;
  if (!k) return null;
  const tun: string[] = [...(k.offen ?? []), ...(fragen > 0 ? [`${fragen === 1 ? 'eine Frage' : `${fragen} Fragen`} beantworten (unten)`] : [])];
  return (
    <div className="exec" data-testid="exec-summary">
      <p className="tiny muted exec-k">Exec Summary</p>
      {k.titel && <p className="exec-titel" data-testid="exec-titel">{k.titel}</p>}
      <p className="small"><span className={`chip ${STATUS_TEXT[k.status]?.[1] ?? ''}`} data-testid="kopf-status">{STATUS_TEXT[k.status]?.[0] ?? k.status}</span></p>
      <div className="exec-grid">
        {k.worum && <div className="exec-box"><h4>Worum es geht</h4><p className="small">{k.worum}</p></div>}
        {(k.anders ?? []).length > 0 && <div className="exec-box"><h4>Was jetzt anders ist</h4><ul className="small">{k.anders.map((a: string, i: number) => <li key={i}>{a}</li>)}</ul></div>}
        <div className="exec-box" data-testid="exec-tun"><h4>Was du tun musst</h4>{tun.length ? <ul className="small">{tun.map((a, i) => <li key={i}>{a}</li>)}</ul> : <p className="small muted">nichts</p>}</div>
      </div>
      {(s!.prs ?? []).length > 0 && <div className="exec-prs">
        <table className="small" data-testid="exec-prs">
          <thead><tr><th>PR</th><th>Was</th><th>Stand (GitHub)</th></tr></thead>
          <tbody>{s!.prs.map((z: any, i: number) => <tr key={i} data-stand={z.stand}>
            <td>{z.url ? <a href={z.url} target="_blank" rel="noreferrer">{z.label}</a> : <span>{z.label}</span>}</td>
            <td>{z.was || <span className="muted">—</span>}</td>
            <td><span className={`chip ${STAND_CHIP[z.stand] ?? ''}`}>{z.text}</span></td>
          </tr>)}</tbody>
        </table>
      </div>}
      {(s!.maengel ?? []).length > 0 && <p className="tiny rq-warn" data-testid="exec-maengel">⚠ Exec Summary unvollständig — im Bericht-Kopf fehlt: {s!.maengel!.join(', ')}</p>}
    </div>
  );
}
