import { useState } from 'react';
import { api, fmtDateTime, type Config } from '../api.ts';
import { Err, Loading, useLoad, useToast, useConfirm, StateChip } from '../ui.tsx';

const EXPLAIN: Record<string, string> = {
  'verlinkt': 'aus dem Vault, immer aktuell',
  'fehlt': 'im Vault, aber für Claude noch nicht eingerichtet',
  'lokale Kopie, gleich': 'Kopie statt Link, inhaltlich gleich',
  'lokale Kopie, abweichend': 'Kopie weicht vom Vault ab — wird nicht überschrieben',
  'nur lokal': 'nicht aus dem Vault',
  'Link woandershin': 'Link zeigt nicht auf den Vault',
  'kaputter Link': 'Ziel fehlt',
};

export function Skills({ cfg }: { cfg: Config }) {
  const s = useLoad(() => api('/api/skills'));
  const [q, setQ] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const toast = useToast();
  const confirm = useConfirm();
  if (s.error) return <div className="page"><Err e={s.error} /></div>;
  if (!s.data) return <div className="page"><Loading /></div>;
  const d: any = s.data;
  const list = d.skills.filter((x: any) => !q || `${x.name} ${x.description}`.toLowerCase().includes(q.toLowerCase()));
  const missing = d.skills.filter((x: any) => x.state === 'fehlt');
  return (
    <div className="page">
      <div className="head">
        <div>
          <h1>Skills</h1>
          <p className="muted" style={{ margin: 0 }}>Was Claude in der Werkbank kann: {d.skills.length} Skills. Team-Skills kommen aus <code>{d.source}</code>, Claude liest sie aus <code>{d.target}</code>.</p>
        </div>
        <button className="btn" disabled={!missing.length} onClick={async () => {
          const ok = await confirm({ title: `${missing.length} Skills einrichten?`, body: <><p>Diese Vault-Skills werden als Link eingerichtet (nichts wird überschrieben):</p><p className="small">{missing.map((m: any) => m.name).join(', ')}</p></>, confirmLabel: 'Einrichten' });
          if (!ok) return;
          try { const r: any = await api('/api/skills/sync', { method: 'POST' }); toast(`${r.linked.length} Skills eingerichtet`); s.reload(); } catch (e) { setErr(e); }
        }}>Fehlende einrichten ({missing.length})</button>
      </div>
      <Err e={err} />

      <h2>Schnellstart im Chat</h2>
      <p className="small muted">Vorlagen starten einen Chat mit der passenden Anweisung (im Chat im Modell-Menü genauso auswählbar).</p>
      <div className="grid2">
        {d.presets.filter((p: any) => p.skill).map((p: any) => (
          <a key={p.name} className="card soft" href={p.url} target="_blank" rel="noreferrer">
            <b>{p.label}</b><div className="small muted">{p.description}</div><div className="tiny">Skill: {p.skill}</div>
          </a>
        ))}
      </div>

      <h2>Alle Skills</h2>
      <input type="search" placeholder="Skills filtern …" aria-label="Skills filtern" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10, width: 320 }} />
      <table className="t small">
        <thead><tr><th>Name</th><th>Was er kann</th><th>Stand</th><th>Quelle</th><th>Version</th></tr></thead>
        <tbody>
          {list.map((x: any) => (
            <tr key={x.name} data-skill={x.name}>
              <td><b>{x.name}</b>{x.hasScripts && <div className="tiny">mit Skripten</div>}</td>
              <td style={{ maxWidth: 520 }}>{x.description.length > 260 ? x.description.slice(0, 259) + '…' : x.description}</td>
              <td><StateChip state={x.state} /><div className="tiny">{EXPLAIN[x.state]}</div></td>
              <td className="tiny">{x.source ?? x.realPath ?? x.path}</td>
              <td className="tiny">{x.version}<div>{fmtDateTime(x.mtime)}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tiny" style={{ marginTop: 10 }}>Auf der Kommandozeile: <code>scripts/werkbank.sh skills</code> (Bericht) · <code>scripts/werkbank.sh skills --apply</code> (fehlende verlinken). Eigene Skills im Chat-Konto: {cfg.librechatUrl}</p>
    </div>
  );
}
