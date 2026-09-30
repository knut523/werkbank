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

function NextUp({ d }: { d: any }) {
  if (!d.nextUp?.length) return null;
  return (
    <div className="card nextup" data-testid="next-up">
      <div className="row" style={{ justifyContent: 'space-between' }}><b>Als Nächstes</b><span className="tiny">höchster Rang, noch nicht in Arbeit{d.sprint ? ` · Sprint ${d.sprint.date}: ${d.sprint.tickets} Tickets mit Sprint-Label` : ''}</span></div>
      <ol className="nextup-list">{d.nextUp.map((x: any) => (
        <li key={x.spec}><span className="chip rank">#{x.rank}</span> {x.path ? <a href={note(x.path)}>{x.title ?? x.spec}</a> : x.spec} <span className="tiny">{x.topic} · {x.folderState?.replace(/^\d-/, '')}</span>{x.inSprint && <span className="chip ok">im Sprint</span>} <Tickets ts={x.tickets} /></li>
      ))}</ol>
    </div>
  );
}

function Prio({ d, reload }: { d: any; reload: () => void }) {
  const [order, setOrder] = useState<string[] | null>(null);
  const [why, setWhy] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [q, setQ] = useState('');
  const confirm = useConfirm();
  const toast = useToast();
  const base = d.ranking as any[];
  const cur: string[] = order ?? base.map((r: any) => r.spec);
  const pos = new Map(cur.map((s, i) => [s, i]));
  const topicOf = new Map<string, string>();
  for (const t of d.prioTopics) for (const r of t.ranked) topicOf.set(r.spec, t.topic);
  // Verschieben innerhalb des Themas: mit dem Nachbarn desselben Themas die Plätze tauschen (globaler Rang).
  const move = (spec: string, dir: -1 | 1) => {
    const list = cur.slice();
    const i = list.indexOf(spec);
    let j = i + dir;
    while (j >= 0 && j < list.length && topicOf.get(list[j]) !== topicOf.get(spec)) j += dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setOrder(list);
  };
  const byRow = new Map(base.map((r: any) => [r.spec, r]));
  const moved = order ? cur.map((s, i) => ({ r: byRow.get(s), to: i + 1 })).filter(({ r, to }) => r.rank !== to) : [];
  const match = (r: any) => !q || `${r.spec} ${r.topic} ${r.state}`.toLowerCase().includes(q.toLowerCase());
  return (
    <>
      <NextUp d={d} />
      <p className="small muted">Nach Thema gruppiert, innerhalb nach Rang aus <a href={note(d.hub.prio)}>der Priorisierungsseite</a> (WSJF-leicht: (GW+ZK+RR)/Größe, gerechnet von <code>rank.py</code>). „Noch nicht priorisiert“ = Specs ohne Zeile in der Rangtabelle. Verschieben erzeugt einen <b>Vorschlag</b> — nach Bestätigung als Zeile auf der Priorisierungsseite; neu gerechnet wird in der Hauptsitzung.</p>
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
      <div data-testid="rank-table">
      {d.prioTopics.map((t: any) => {
        const rows = t.ranked.slice().sort((a: any, b: any) => pos.get(a.spec)! - pos.get(b.spec)!).filter(match);
        const un = t.unranked.filter((s: any) => !q || `${s.name} ${s.topic} ${s.state}`.toLowerCase().includes(q.toLowerCase()));
        if (!rows.length && !un.length) return null;
        return (
          <section key={t.topic} className="card topic-block" data-topic={t.topic}>
            <h3 style={{ marginTop: 0 }}>{t.topic} <span className="chip">{t.ranked.length} priorisiert</span>{t.unranked.length > 0 && <span className="chip warn">{t.unranked.length} ohne Rang</span>}</h3>
            {rows.length > 0 && <table className="t small">
              <thead><tr><th>Rang</th><th></th><th>Spec</th><th>Zustand</th><th title="(GW+ZK+RR)/Größe">WSJF</th><th>Kat</th><th>blockiert durch</th><th>nächster Schritt</th><th>Jira · PR</th></tr></thead>
              <tbody>{rows.map((r: any) => {
                const full = byRow.get(r.spec) ?? r;
                const i = pos.get(r.spec)!;
                return (
                  <tr key={r.spec} data-spec={r.spec} className={order && full.rank !== i + 1 ? 'moved' : ''}>
                    <td><span className="chip rank">#{i + 1}</span>{order && full.rank !== i + 1 && <span className="tiny"> (war {full.rank})</span>}</td>
                    <td className="nowrap"><button className="btn ghost small" aria-label={`${r.spec} hoch`} onClick={() => move(r.spec, -1)}>▲</button><button className="btn ghost small" aria-label={`${r.spec} runter`} onClick={() => move(r.spec, 1)}>▼</button></td>
                    <td>{full.path ? <a href={note(full.path)}>{r.spec}</a> : r.spec}{full.open > 0 && <span className="chip warn" title="offene Knut-Zeilen">❓ {full.open}</span>}{full.why && <details><summary className="tiny">Gründe</summary><span className="tiny">{full.why}</span></details>}</td>
                    <td className="tiny">{full.state}</td>
                    <td title={`GW ${full.gw} · ZK ${full.zk} · RR ${full.rr} · Größe ${full.size}`}>{Number(full.wsjf ?? 0).toFixed(1)}</td><td>{full.cat}</td>
                    <td className="tiny">{full.blocked}</td><td className="tiny">{full.next}</td>
                    <td><Tickets ts={full.tickets} /> <Prs prs={full.prs} /></td>
                  </tr>
                );
              })}</tbody>
            </table>}
            {un.length > 0 && <div className="unranked"><div className="tiny"><b>Noch nicht priorisiert</b> — in <code>rank.py</code> aufnehmen</div>
              <ul className="small">{un.map((s: any) => <li key={s.path}><a href={note(s.path)}>{s.title}</a> <span className="tiny">{s.state.replace(/^\d-/, '')}</span> <Tickets ts={s.tickets} /></li>)}</ul></div>}
          </section>
        );
      })}
      </div>
    </>
  );
}

function SpecCard({ sp }: { sp: any }) {
  return (
    <a className="tcard" href={note(sp.path)} data-spec={sp.name}>
      <div className="k"><span>{sp.rank ? <span className="chip rank">#{sp.rank}</span> : <span className="chip warn" title="nicht in der Rangtabelle">ohne Rang</span>}</span>{sp.open > 0 && <span className="chip tiny-chip warn" title="offene Knut-Zeilen">❓ {sp.open}</span>}</div>
      <div className="s">{sp.title}</div>
      <div className="row" style={{ gap: 3 }}>
        {sp.tickets.map((x: any) => <span key={x.key} className={`chip tiny-chip ${x.status === 'Done' ? 'ok' : x.status === 'In Progress' ? 'warn' : ''}`} title={x.summary ?? ''}>{x.key}{x.status ? ` · ${x.status}` : ''}</span>)}
        {(sp.prLive ?? []).map((p: any) => <span key={p.pr} className={`chip tiny-chip ${p.conflict ? 'bad' : p.review === 'APPROVED' ? 'ok' : p.closed ? '' : 'warn'}`} title={p.turn ? `dran: ${p.turn}` : p.closed ? 'nicht mehr offen (gemergt/geschlossen)' : 'GitHub-Stand unbekannt'}>{p.pr.replace('olaf-', '')}{p.conflict ? ' ⚠ Konflikt' : p.draft ? ' · Entwurf' : p.review === 'APPROVED' ? ' ✓' : p.closed ? ' · zu' : p.turn ? ` · ${p.turn}` : ''}</span>)}
      </div>
    </a>
  );
}

function Kanban({ d }: { d: any }) {
  return (
    <>
      <NextUp d={d} />
      <p className="small muted">Swimlanes Thema × Zustand (<code>1-Backlog … 5-Live</code>), Karten nach Rang sortiert, mit Jira-Status und PR-Live-Zustand von GitHub.</p>
      {d.lanes.map((t: any) => (
        <section className="lane" key={t.topic} data-lane={t.topic}>
          <h3>{t.topic} <span className="chip">{Object.values(t.states).flat().length}</span></h3>
          <div className="cols" style={{ gridTemplateColumns: `repeat(${d.kanbanStates.length}, minmax(170px, 1fr))` }}>
            {d.kanbanStates.map((s: string) => (
              <div key={s}>
                <div className="colhead">{s.replace(/^\d-/, '')} · {t.states[s].length}</div>
                <div className="col-cards">{t.states[s].map((sp: any) => <SpecCard key={sp.path} sp={sp} />)}</div>
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

function SpecVsJira({ d }: { d: any }) {
  const w = d.consistency.filter((x: any) => x.level === 'Widerspruch'), h = d.consistency.filter((x: any) => x.level === 'Hinweis');
  return (
    <div className="card" style={{ marginBottom: 10 }} data-testid="spec-jira">
      <h3 style={{ marginTop: 0 }}>Spec ↔ Jira <span className="chip bad">{w.length} Widersprüche</span> <span className="chip warn">{h.length} Hinweise</span> <span className="chip">{d.withoutJira.length} Specs ohne jira:-Key</span></h3>
      {d.consistency.length > 0 && <table className="t small"><thead><tr><th></th><th>Spec</th><th>Zustand</th><th>Ticket</th><th>Befund</th></tr></thead>
        <tbody>{[...w, ...h].map((x: any) => <tr key={x.spec + x.ticket}><td><span className={`chip ${x.level === 'Widerspruch' ? 'bad' : 'warn'}`}>{x.level}</span></td><td><a href={note(x.path)}>{x.spec}</a> <span className="tiny">{x.topic}</span></td><td className="tiny">{x.state}</td><td><a className="chip" href={`#/board?key=${x.ticket}`}>{x.ticket} · {x.status}</a></td><td>{x.kind}</td></tr>)}</tbody></table>}
      {d.withoutJira.length > 0 && <details><summary className="small">Specs ohne <code>jira:</code> im Frontmatter ({d.withoutJira.length})</summary><ul className="small">{d.withoutJira.map((s: any) => <li key={s.path}><a href={note(s.path)}>{s.title}</a> <span className="tiny">{s.topic} · {s.state}</span></li>)}</ul></details>}
    </div>
  );
}

function Check({ d: rd }: { d: any }) {
  const c = useLoad(() => api('/api/roadmap/check'));
  const d: any = c.data;
  if (!d) return <><SpecVsJira d={rd} />{c.error ? <Err e={c.error} /> : <Loading what="Prüfe die Roadmap (roadmap_check.py)" />}</>;
  if (!d.available) return <><SpecVsJira d={rd} /><p className="note small">Der Konsistenz-Check (<code>roadmap_check.py</code> aus dem Skill <code>olaf-produkt-roadmap</code>) ist hier nicht eingerichtet.</p></>;
  const by = new Map<string, any[]>();
  for (const f of d.findings) by.set(f.check, [...(by.get(f.check) ?? []), f]);
  const names: Record<string, string> = { B1: 'Hub ↔ Ordner', B2: 'Zustandsseiten ↔ Ordner', B3: 'Themen-Übersichten', B4: 'Specs (Zustand, Abschnitte, Knut-Zeilen, Bau-Stand)', B5: 'Review ↔ PR-Register' };
  return (
    <>
      <SpecVsJira d={rd} />
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
      {!d ? <Loading /> : tab === 'kanban' ? <Kanban d={d} /> : tab === 'prs' ? <PrReview d={d} reload={r.reload} /> : tab === 'entscheidungen' ? <Decisions d={d} reload={r.reload} user={cfg.user?.name.split(' ')[0] ?? ''} /> : tab === 'check' ? <Check d={d} /> : <Prio d={d} reload={r.reload} />}
    </div>
  );
}
