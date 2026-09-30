// Roadmap: Priorisierung · Zustände je Thema · PR-Review · offene Entscheidungen · Konsistenz.
// Alles aus dem Vault (lesend); geschrieben wird nur eine Antwort („- Knut:“) oder ein Rang-Vorschlag —
// jeweils nach Vorschau und Bestätigung. GitHub nur lesend (Links).
import { useMemo, useState } from 'react';
import { api, type Config } from '../api.ts';
import { Err, Loading, useConfirm, useLoad, useToast, StateChip, useJiraLive } from '../ui.tsx';

const note = (p: string) => '#/wissen/' + p.split('/').map(encodeURIComponent).join('/');
const TABS = [['prio', 'Priorisierung'], ['kanban', 'Zustände'], ['prs', 'PR-Review'], ['entscheidungen', 'Offene Entscheidungen'], ['check', 'Konsistenz']] as const;

function Tickets({ ts }: { ts: any[] }) {
  if (!ts?.length) return null;
  return <>{ts.map((t) => <a key={t.key} className="chip" href={`#/board?key=${t.key}`} title={t.summary ?? ''}>{t.key}{t.status ? ` · ${t.status}` : ''}</a>)}</>;
}

function Prs({ prs }: { prs: string[] }) {
  if (!prs?.length) return null;
  return <>{prs.map((p) => <a key={p} className="chip" href={`https://github.com/WirStrom1/${p.replace('#', '/pull/')}`} target="_blank" rel="noreferrer">{p.replace('olaf-', '')}</a>)}</>;
}

function Prio({ d, reload }: { d: any; reload: () => void }) {
  const [order, setOrder] = useState<string[] | null>(null);
  const [why, setWhy] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [q, setQ] = useState('');
  const confirm = useConfirm();
  const toast = useToast();
  const rows: any[] = useMemo(() => {
    const base = d.ranking as any[];
    if (!order) return base;
    return order.map((s) => base.find((r) => r.spec === s)!);
  }, [d, order]);
  const move = (i: number, dir: -1 | 1) => {
    const cur = (order ?? d.ranking.map((r: any) => r.spec)).slice();
    const j = i + dir;
    if (j < 0 || j >= cur.length) return;
    [cur[i], cur[j]] = [cur[j], cur[i]];
    setOrder(cur);
  };
  const moved = order ? rows.map((r, i) => ({ r, to: i + 1 })).filter(({ r, to }) => r.rank !== to) : [];
  const shown = rows.filter((r) => !q || `${r.spec} ${r.topic} ${r.state}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <p className="small muted">Rangliste aus <a href={note(d.hub.prio)}>der Priorisierungsseite</a> (WSJF-leicht: (GW+ZK+RR)/Größe, gerechnet von <code>rank.py</code> im Skill <code>olaf-produkt-roadmap</code>). Verschieben erzeugt einen <b>Vorschlag</b> — er wird nach Bestätigung als Zeile auf der Priorisierungsseite festgehalten; neu gerechnet wird die Tabelle in der Hauptsitzung.</p>
      <div className="row" style={{ marginBottom: 8 }}>
        <input type="search" placeholder="Spec, Thema, Zustand …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rangliste filtern" />
        {order && <>
          <input placeholder="Warum? (kommt in den Vorschlag)" value={why} onChange={(e) => setWhy(e.target.value)} style={{ minWidth: 260 }} aria-label="Begründung" />
          <button className="btn primary" disabled={!moved.length} onClick={async () => {
            setErr(null);
            try {
              const top = moved.sort((a, b) => Math.abs(b.r.rank - b.to) - Math.abs(a.r.rank - a.to))[0];
              const p: any = await api('/api/roadmap/rank-proposal', { body: { spec: top.r.spec, from: top.r.rank, to: top.to, why } });
              if (!(await confirm({ title: 'Rang-Vorschlag festhalten?', confirmLabel: 'In den Vault schreiben', body: <><p className="small">Diese Zeile kommt unter „Vorschläge aus der Werkbank“ auf <code>{p.preview.path.split('/').pop()}</code>:</p><pre className="small">{p.preview.add}</pre></> }))) return;
              await api('/api/roadmap/rank-proposal', { body: { spec: top.r.spec, from: top.r.rank, to: top.to, why, confirm: true, hash: p.hash } });
              toast('Vorschlag festgehalten'); setOrder(null); setWhy(''); reload();
            } catch (e) { setErr(e); }
          }}>Vorschlag festhalten</button>
          <button className="btn" onClick={() => setOrder(null)}>Zurücksetzen</button>
        </>}
      </div>
      <Err e={err} />
      <table className="t small" data-testid="rank-table">
        <thead><tr><th>#</th><th></th><th>Spec</th><th>Thema</th><th>Zustand</th><th title="(GW+ZK+RR)/Größe">WSJF</th><th>Kat</th><th>blockiert durch</th><th>nächster Schritt</th><th>Jira · PR</th></tr></thead>
        <tbody>{shown.map((r) => {
          const i = rows.indexOf(r);
          return (
            <tr key={r.spec} data-spec={r.spec} className={order && r.rank !== i + 1 ? 'moved' : ''}>
              <td><b>{i + 1}</b>{order && r.rank !== i + 1 && <span className="tiny"> (war {r.rank})</span>}</td>
              <td className="nowrap"><button className="btn ghost small" aria-label={`${r.spec} hoch`} onClick={() => move(i, -1)}>▲</button><button className="btn ghost small" aria-label={`${r.spec} runter`} onClick={() => move(i, 1)}>▼</button></td>
              <td>{r.path ? <a href={note(r.path)}>{r.spec}</a> : r.spec}{r.open > 0 && <span className="chip warn" title="offene Knut-Zeilen">❓ {r.open}</span>}{r.why && <details><summary className="tiny">Gründe</summary><span className="tiny">{r.why}</span></details>}</td>
              <td>{r.topic}</td><td className="tiny">{r.state}</td>
              <td title={`GW ${r.gw} · ZK ${r.zk} · RR ${r.rr} · Größe ${r.size}`}>{r.wsjf.toFixed(1)}</td><td>{r.cat}</td>
              <td className="tiny">{r.blocked}</td><td className="tiny">{r.next}</td>
              <td><Tickets ts={r.tickets} /> <Prs prs={r.prs} /></td>
            </tr>
          );
        })}</tbody>
      </table>
    </>
  );
}

function Kanban({ d }: { d: any }) {
  return (
    <>
      <p className="small muted">Specs je Thema und Zustandsordner (<code>1-Backlog … 6-Archive</code>) mit offenen Entscheidungen, Tickets und PRs.</p>
      {d.topics.map((t: any) => (
        <section className="lane" key={t.name}>
          <h3>{t.overview ? <a href={note(t.overview)}>{t.name}</a> : t.name} <span className="chip">{Object.values(t.states).flat().length}</span></h3>
          <div className="cols" style={{ gridTemplateColumns: `repeat(${d.states.length}, minmax(170px, 1fr))` }}>
            {d.states.map((s: string) => (
              <div key={s}>
                <div className="colhead">{s} · {(t.states[s] ?? []).length}</div>
                <div className="col-cards">{(t.states[s] ?? []).map((sp: any) => (
                  <a key={sp.path} className="tcard" href={note(sp.path)} data-spec={sp.name}>
                    <div className="s">{sp.title}</div>
                    <div className="row" style={{ gap: 3 }}>
                      {sp.status && <span className="chip tiny-chip">{sp.status}</span>}
                      {sp.open > 0 && <span className="chip tiny-chip warn">❓ {sp.open}</span>}
                      {sp.tickets.map((x: any) => <span key={x.key} className="chip tiny-chip">{x.key}</span>)}
                      {sp.prs.map((p: string) => <span key={p} className="chip tiny-chip">{p.replace('olaf-', '')}</span>)}
                    </div>
                  </a>
                ))}</div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

const ago = (s?: string | null) => { if (!s) return '—'; const d = Math.floor((Date.now() - new Date(s).getTime()) / 864e5); return d <= 0 ? 'heute' : d === 1 ? '1 Tag' : `${d} Tage`; };

function PrReview({ d, reload }: { d: any; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const gh = d.github ?? {};
  const list = d.prs.filter((p: any) => !onlyOpen || p.live || !['nicht mehr offen', 'gemergt'].includes(p.review));
  return (
    <>
      <p className="small muted">Live von GitHub (<b>{gh.org ?? 'WirStrom1'}</b>, alle offenen PRs, alle 5 Minuten, <b>nur lesend</b>) plus <a href={note(d.hub.register)}>PR-Register</a> und PR-Links in den Specs (Spec ↔ PR, Deploy-Gates). Review, Merge und Deploy passieren auf GitHub bzw. durch Menschen.</p>
      <div className="row small" style={{ marginBottom: 8 }}>
        {gh.error ? <span className="chip bad" data-testid="gh-error">GitHub: {gh.error}</span> : gh.at ? <span className="chip ok">GitHub-Stand {new Date(gh.at).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {gh.count} offen</span> : <span className="chip warn">GitHub noch nicht abgerufen</span>}
        <button className="btn small" disabled={busy} onClick={async () => { setBusy(true); setErr(null); try { await api('/api/roadmap/github', { method: 'POST' }); reload(); } catch (e) { setErr(e); } finally { setBusy(false); } }}>{busy ? 'Frage GitHub …' : '↻ jetzt abrufen'}</button>
        <label className="row small"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> nur offene</label>
        <span className="tiny">{list.length} PRs · {list.filter((p: any) => p.live?.mergeable === 'CONFLICTING').length} mit Konflikt</span>
      </div>
      <Err e={err} />
      <table className="t small" data-testid="pr-table">
        <thead><tr><th>PR</th><th>Zustand</th><th>Review</th><th>wer ist dran</th><th>Alter · zuletzt</th><th>Specs</th><th>Jira</th><th>Deploy-Gates / Hinweise</th><th>Register</th></tr></thead>
        <tbody>{list.map((p: any) => {
          const l = p.live;
          return (
          <tr key={p.pr} data-pr={p.pr}>
            <td><a href={p.url} target="_blank" rel="noreferrer"><b>{p.pr.replace('olaf-', '')}</b> ↗</a>{l && <div className="tiny" title={`${l.headRefName} → ${l.baseRefName}`}>{l.title}</div>}{l && l.baseRefName !== 'develop' && <span className="chip warn" title="Feature-PRs gehen gegen develop, nie main">→ {l.baseRefName}</span>}</td>
            <td className="nowrap">{l ? <>
              {l.isDraft && <span className="chip">Entwurf</span>}
              {l.mergeable === 'CONFLICTING' ? <span className="chip bad" data-conflict="1">⚠ Konflikt</span> : l.mergeable === 'MERGEABLE' ? <span className="chip ok">mergebar</span> : <span className="chip">{l.mergeable === 'UNKNOWN' ? 'prüft …' : l.mergeable ?? '?'}</span>}
              {l.openThreads > 0 && <span className="chip warn" title="offene Review-Threads">💬 {l.openThreads}</span>}
            </> : <span className="tiny">{p.review === 'nicht mehr offen' ? 'nicht mehr offen' : 'nur Vault'}</span>}</td>
            <td><StateChip state={p.review === 'freigegeben' ? 'ok · freigegeben' : p.review === 'Änderungen verlangt' ? 'fehlt · Änderungen verlangt' : p.review} /></td>
            <td>{l ? <><b>{l.turn.who}</b><div className="tiny">{l.turn.why}</div></> : p.turn}</td>
            <td className="tiny nowrap">{l ? <>{ago(l.createdAt)} · {ago(l.updatedAt)}</> : '—'}</td>
            <td>{p.specs.map((s: string) => <div key={s} className="tiny">{s}</div>)}</td>
            <td>{p.tickets.map((k: string) => <a key={k} className="chip" href={`#/board?key=${k}`}>{k}</a>)}</td>
            <td className="tiny">{p.gates.join(' · ') || '—'}</td>
            <td className="tiny">{p.rows.map((r: any, i: number) => <div key={i} title={Object.entries(r.cols).map(([k, v]) => `${k}: ${v}`).join('\n')}>{r.section.slice(0, 50)}</div>)}</td>
          </tr>);
        })}</tbody>
      </table>
    </>
  );
}

function Decisions({ d, reload, user }: { d: any; reload: () => void; user: string }) {
  const [topic, setTopic] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [err, setErr] = useState<unknown>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const topics = [...new Set(d.decisions.map((x: any) => x.topic))] as string[];
  const list = d.decisions.filter((x: any) => !topic || x.topic === topic);
  const bySpec = new Map<string, any[]>();
  for (const x of list) bySpec.set(x.path, [...(bySpec.get(x.path) ?? []), x]);
  return (
    <>
      <p className="small muted">Alle leeren <code>- Knut:</code>-Zeilen aus Specs und Übersichten ({d.decisions.length}). Antworten geht hier: Vorschau → Bestätigen → die Zeile wird in der Notiz gefüllt (hat sie sich geändert, wird nichts geschrieben). Antworten schreibt {user === 'Knut' ? 'du' : `„Knut:“ — gedacht für Knut; du bist ${user}`}.</p>
      <div className="row" style={{ marginBottom: 8 }}>
        <select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Thema"><option value="">Alle Themen</option>{topics.map((t) => <option key={t}>{t}</option>)}</select>
        <span className="tiny">{list.length} offen in {bySpec.size} Notizen</span>
      </div>
      <Err e={err} />
      {[...bySpec.entries()].map(([path, xs]) => (
        <div className="card" key={path} style={{ marginBottom: 10 }} data-decisions={xs[0].spec}>
          <div className="row" style={{ justifyContent: 'space-between' }}><a href={note(path)}><b>{xs[0].title}</b></a><span className="tiny">{xs[0].topic} · {xs[0].state}</span></div>
          {xs.map((x: any) => {
            const id = `${path}:${x.line}`;
            return (
              <div key={id} className="q" style={{ marginTop: 8 }}>
                <div className="small">{x.section && <span className="tiny">{x.section} · </span>}{x.question || <i>(Frage ohne Text, Zeile {x.line})</i>}</div>
                <div className="row" style={{ marginTop: 4 }}>
                  <span className="tiny">Knut:</span>
                  <input aria-label={`Antwort ${x.spec} Zeile ${x.line}`} value={answers[id] ?? ''} onChange={(e) => setAnswers({ ...answers, [id]: e.target.value })} style={{ flex: 1, minWidth: 200 }} />
                  <button className="btn small" disabled={!(answers[id] ?? '').trim()} onClick={async () => {
                    setErr(null);
                    try {
                      const p: any = await api('/api/roadmap/answer', { body: { path, line: x.line, hash: x.hash, text: answers[id] } });
                      if (!(await confirm({ title: 'Antwort in die Notiz schreiben?', confirmLabel: 'In den Vault schreiben', body: <><p className="small"><code>{p.preview.path}</code>, Zeile {p.preview.line}</p><pre className="small">- {p.preview.before}{'\n'}+ {p.preview.after}</pre></> }))) return;
                      await api('/api/roadmap/answer', { body: { path, line: x.line, hash: x.hash, text: answers[id], confirm: true } });
                      toast('Antwort gespeichert'); reload();
                    } catch (e) { setErr(e); }
                  }}>Antworten</button>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

function Check() {
  const c = useLoad(() => api('/api/roadmap/check'));
  const d: any = c.data;
  if (!d) return c.error ? <Err e={c.error} /> : <Loading what="Prüfe die Roadmap (roadmap_check.py)" />;
  if (!d.available) return <p className="note small">Der Konsistenz-Check (<code>roadmap_check.py</code> aus dem Skill <code>olaf-produkt-roadmap</code>) ist hier nicht eingerichtet.</p>;
  const by = new Map<string, any[]>();
  for (const f of d.findings) by.set(f.check, [...(by.get(f.check) ?? []), f]);
  const names: Record<string, string> = { B1: 'Hub ↔ Ordner', B2: 'Zustandsseiten ↔ Ordner', B3: 'Themen-Übersichten', B4: 'Specs (Zustand, Abschnitte, Knut-Zeilen, Bau-Stand)', B5: 'Review ↔ PR-Register' };
  return (
    <>
      <p className="small muted">Ausgabe von <code>roadmap_check.py</code> (nur lesend) — Kette Hub → Zustandsseite → Übersicht → Spec → PR-Register. <span className="chip bad">{d.errors} Fehler</span> <span className="chip warn">{d.warnings} Hinweise</span> <button className="btn small" onClick={() => c.reload()}>↻ neu prüfen</button></p>
      {[...by.entries()].map(([k, fs]) => (
        <details key={k} className="card" open={fs.some((f) => f.level === 'ERROR')} style={{ marginBottom: 8 }}>
          <summary><b>{k}</b> {names[k] ?? ''} <span className="tiny">{fs.length} Befunde</span></summary>
          <ul className="small">{fs.map((f, i) => <li key={i}><span className={`chip ${f.level === 'ERROR' ? 'bad' : 'warn'}`}>{f.level === 'ERROR' ? 'Fehler' : 'Hinweis'}</span> {f.text}</li>)}</ul>
        </details>
      ))}
    </>
  );
}

export function Roadmap({ cfg, hash }: { cfg: Config; hash: string }) {
  const tab = hash.match(/^#\/roadmap\/(\w+)/)?.[1] ?? 'prio';
  const r = useLoad(() => api('/api/roadmap'));
  const d: any = r.data;
  // Live: neuer GitHub-Stand (alle 5 min) oder Jira-Änderung → still nachladen.
  useJiraLive(() => { api('/api/roadmap').then(r.setData).catch(() => {}); }, 'both');
  return (
    <div className="page wide">
      <div className="head">
        <div>
          <h1>Roadmap · Produkt OLAF</h1>
          <p className="muted" style={{ margin: 0 }}>Priorisierung, Zustände je Thema, PR-Review, offene Entscheidungen und Konsistenz — aus dem Vault (<code>{d?.base ?? '…'}</code>). Verknüpft: Spec ↔ Jira ↔ PR.</p>
        </div>
        {d && <a className="btn" href={note(d.hub.path)}>Roadmap-Hub öffnen</a>}
      </div>
      <div className="tabs" role="tablist">
        {TABS.map(([id, label]) => <a key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} href={`#/roadmap/${id}`}>{label}{d && id === 'entscheidungen' ? ` (${d.decisions.length})` : d && id === 'prs' ? ` (${d.prs.length})` : d && id === 'prio' ? ` (${d.ranking.length})` : ''}</a>)}
      </div>
      {r.error && <Err e={r.error} />}
      {!d ? <Loading /> : tab === 'kanban' ? <Kanban d={d} /> : tab === 'prs' ? <PrReview d={d} reload={r.reload} /> : tab === 'entscheidungen' ? <Decisions d={d} reload={r.reload} user={cfg.user?.name.split(' ')[0] ?? ''} /> : tab === 'check' ? <Check /> : <Prio d={d} reload={r.reload} />}
    </div>
  );
}
