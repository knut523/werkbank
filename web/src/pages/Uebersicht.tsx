// Übersicht „Was fertig ist“ mit direktem Handeln (docs/plan-uebersicht-handeln.md, Paket 184). Aufbau wie die Morgen-Seite
// des Orchestrators: eine Karte je Strang (Titel, Ampel, 2–3 Sätze, Links, „Von dir“), gruppiert nach Thema wie die
// Chat-Seitenleiste. Gehandelt wird über die vorhandenen Routen: Freigabe, Entscheidungen, Rückfragen, Antwort/Nacharbeit, Passt.
// Entwürfe und auf/zu liegen im localStorage — Neuladen verliert nichts (Council 3).
import { useEffect, useState } from 'react';
import { api, chatTarget, fmtDateTime, type Config } from '../api.ts';
import { Err, Loading, useLoad, useToast } from '../ui.tsx';
import { usePushFreigeben } from '../freigabe.tsx';

const AMPEL_CLS: Record<string, string> = { push: 'ok', review: 'warn', laeuft: '', blockiert: 'bad' };
const PREFIX = 'wb-uebersicht:';

/** Zustand im localStorage (je Schlüssel); `leer` wird nicht gespeichert, sondern gelöscht. */
function useStored<T>(key: string, leer: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => { try { const s = localStorage.getItem(PREFIX + key); return s ? JSON.parse(s) : leer; } catch { return leer; } });
  const set = (n: T) => {
    setV(n);
    try { if (JSON.stringify(n) === JSON.stringify(leer)) localStorage.removeItem(PREFIX + key); else localStorage.setItem(PREFIX + key, JSON.stringify(n)); } catch { /* privat */ }
  };
  return [v, set];
}

const is409 = (e: any) => /geändert|neu laden|arbeitet gerade/i.test(String(e?.message ?? e));

type Wahl = { art: '' | 'akzeptiert' | 'eigene' | 'nachpruefen'; text: string };

/** Entscheidungen (D-/E-Kennungen): je Frage eine Auswahl + Text; vorhandene Route /api/review/:id/entscheidungen. */
function Entscheiden({ k, onDone }: { k: any; onDone: (reload?: boolean) => void }) {
  const toast = useToast();
  const [w, setW] = useStored<Record<string, Wahl>>(`${k.id}:entscheidungen`, {});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const liste: any[] = k.entscheidungen;
  // Nur Entwürfe zu Fragen, die noch offen sind (beantwortete fallen beim Neuladen heraus).
  const gewaehlt = liste.map((e) => [e.id, w[e.id]] as const).filter(([, v]) => v && (v.art === 'akzeptiert' || v.art === 'nachpruefen' || (v.art === 'eigene' && v.text.trim())));
  const set = (id: string, v: Partial<Wahl>) => setW({ ...w, [id]: { art: '', text: '', ...w[id], ...v } });
  const senden = async () => {
    setBusy(true); setErr(null);
    try {
      const r: any = await api(`/api/review/${k.id}/entscheidungen`, { body: { berichtHash: k.berichtHash, antworten: gewaehlt.map(([id, v]) => ({ id, art: v!.art, text: v!.text })) } });
      toast(r.weiter ? 'Eingetragen — der Unter-Chat arbeitet die Abweichungen ab' : r.offen ? `Eingetragen — noch ${r.offen} offen` : 'Alle Entscheidungen beantwortet');
      const rest = { ...w }; for (const [id] of gewaehlt) delete rest[id];
      setW(rest);
      onDone();
    } catch (e) { setErr(e); if (is409(e)) onDone(true); } finally { setBusy(false); }
  };
  return (
    <div className="ub-panel" data-testid="ub-entscheidungen">
      {liste.map((e) => {
        const v = w[e.id] ?? { art: '', text: '' };
        return (
          <div key={e.id} className="ub-frage" data-testid="ub-entscheidung">
            <p className="small"><b>{e.id}</b> {e.frage}</p>
            {e.empfehlung && <p className="tiny muted">Empfehlung: {e.empfehlung}</p>}
            {e.optionen && <details className="tiny"><summary>Optionen aus dem Bericht</summary><pre className="small ub-pre">{e.optionen}</pre></details>}
            <div className="ub-wahl">
              <select aria-label={`Antwort auf ${e.id}`} value={v.art} onChange={(ev) => set(e.id, { art: ev.target.value as Wahl['art'] })} data-testid={`ub-wahl-${e.id}`}>
                <option value="">— wählen —</option>
                {e.empfehlung && <option value="akzeptiert">Empfehlung übernehmen</option>}
                <option value="eigene">Eigene Antwort</option>
                <option value="nachpruefen">Nachprüfen lassen</option>
              </select>
              {(v.art === 'eigene' || v.art === 'nachpruefen') && <input className="input" value={v.text} placeholder={v.art === 'eigene' ? 'Deine Antwort' : 'Was nachprüfen? (optional)'} aria-label={`Text zu ${e.id}`} onChange={(ev) => set(e.id, { text: ev.target.value })} data-testid={`ub-text-${e.id}`} />}
            </div>
          </div>);
      })}
      <div className="row ub-row">
        <button className="btn primary small" disabled={busy || !gewaehlt.length} onClick={senden} data-testid="ub-entscheidungen-senden">Antworten senden ({gewaehlt.length})</button>
        {liste.some((e) => e.empfehlung) && <button className="btn ghost small" disabled={busy} onClick={() => setW({ ...w, ...Object.fromEntries(liste.filter((e) => e.empfehlung).map((e) => [e.id, { art: 'akzeptiert', text: '' }])) })}>Alle Empfehlungen wählen</button>}
      </div>
      <p className="tiny muted">Übernommene Empfehlungen trägt der Workspace in den Bericht ein; eigene Antworten und „nachprüfen“ gehen an den Unter-Chat.{k.running ? ' Er arbeitet gerade — die Antwort wird nachgereicht.' : ''}</p>
      <Err e={err} />
    </div>
  );
}

/** Rückfrage des Orchestrators (q-…): Auswahl der Optionen + Text; vorhandene Route. */
function Rueckfrage({ q, onDone }: { q: any; onDone: (reload?: boolean) => void }) {
  const toast = useToast();
  const [e, setE] = useStored<{ option: string; text: string }>(`q:${q.id}`, { option: '', text: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const senden = async () => {
    setBusy(true); setErr(null);
    try {
      await api(`/api/orchestrator/questions/${q.id}/answer`, { body: { option: e.option || null, text: e.text || '' } });
      toast('Antwort gespeichert — der Orchestrator liest sie beim nächsten Abruf');
      setE({ option: '', text: '' });
      window.dispatchEvent(new Event('werkbank-questions'));
      onDone();
    } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return (
    <div className="ub-frage" data-testid="ub-rueckfrage">
      <p className="small"><b>{q.title}</b> <span className="tiny muted">· {q.id} · {fmtDateTime(q.createdAt)}</span></p>
      {q.context && <details className="tiny"><summary>Kontext</summary><p className="small ub-pre">{q.context}</p></details>}
      {q.recommendation && <p className="tiny muted">Empfehlung: {q.recommendation}</p>}
      <div className="ub-wahl">
        {q.options?.length > 0 && <select aria-label={`Option für ${q.title}`} value={e.option} onChange={(ev) => setE({ ...e, option: ev.target.value })}>
          <option value="">— Option wählen —</option>
          {q.options.map((o: any) => <option key={o.label} value={o.label}>{o.label}{o.consequence ? ` — ${o.consequence}` : ''}</option>)}
        </select>}
        <input className="input" value={e.text} placeholder={q.options?.length ? 'Ergänzung (optional)' : 'Deine Antwort'} aria-label={`Antwort auf ${q.title}`} onChange={(ev) => setE({ ...e, text: ev.target.value })} />
        <button className="btn small primary" disabled={busy || (!e.option && !e.text.trim())} onClick={senden}>Antworten</button>
      </div>
      <Err e={err} />
    </div>
  );
}

/** Freitext an den Strang: Antwort auf „Braucht Knut“ oder Nacharbeit — vorhandene Route /api/leitstand/strands/:id/reply. */
function AnStrang({ k, kind, onDone }: { k: any; kind: 'antwort' | 'nacharbeit'; onDone: (reload?: boolean) => void }) {
  const toast = useToast();
  const [t, setT] = useStored<string>(`${k.id}:${kind}`, '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const senden = async () => {
    setBusy(true); setErr(null);
    try {
      await api(`/api/leitstand/strands/${k.id}/reply`, { body: { kind, text: t, seen: k.seen } });
      toast(kind === 'antwort' ? 'Antwort an den Unter-Chat geschickt' : 'Zurück an den Unter-Chat');
      setT('');
      onDone(true);
    } catch (e) { setErr(e); if (is409(e)) onDone(true); } finally { setBusy(false); }
  };
  return (
    <div className="ub-panel">
      {kind === 'antwort' && k.braucht && <p className="small"><b>Der Unter-Chat braucht:</b> {k.braucht}</p>}
      <textarea rows={3} value={t} aria-label={kind === 'antwort' ? 'Antwort an den Unter-Chat' : 'Was nacharbeiten?'} placeholder={kind === 'antwort' ? 'Deine Antwort' : 'z. B. Test für den Fehlerfall ergänzen'} onChange={(e) => setT(e.target.value)} data-testid={`ub-${kind}-text`} />
      <div className="row ub-row">
        <button className="btn primary small" disabled={busy || k.running || !t.trim()} onClick={senden} data-testid={`ub-${kind}-senden`}>{kind === 'antwort' ? 'Antwort senden' : 'Nacharbeit senden'}</button>
        {k.running && <span className="tiny muted">Der Unter-Chat arbeitet gerade — dein Text bleibt hier stehen, bis er fertig ist.</span>}
      </div>
      <Err e={err} />
    </div>
  );
}

type Panel = '' | 'entscheiden' | 'fragen' | 'antwort' | 'nacharbeit';

function Karte({ k, onDone }: { k: any; onDone: (reload?: boolean) => void }) {
  const toast = useToast();
  const pushFreigeben = usePushFreigeben();
  const [panel, setPanel] = useStored<Panel>(`${k.id}:panel`, '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const tun = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr(e); if (is409(e)) onDone(true); } finally { setBusy(false); } };
  const freigeben = () => tun(async () => { if (await pushFreigeben(k.id)) { toast('Freigegeben — die Hauptsitzung pusht nach ihrer Prüfung'); onDone(true); } });
  const passt = () => tun(async () => { await api(`/api/leitstand/strands/${k.id}/passt`, { body: { seen: k.seen, note: 'Passt (Übersicht)' } }); toast(`${k.titel} abgelegt`); onDone(true); });
  const toggle = (p: Panel) => setPanel(panel === p ? '' : p);
  const nE = k.entscheidungen.length, nQ = k.rueckfragen.length;
  return (
    <article className={`card ub-karte ub-${k.ampel}`} data-testid="ub-karte" data-ampel={k.ampel} data-strang={k.id}>
      <div className="ub-top">
        <h3>{k.titel}</h3>
        <span className="ub-chips"><span className={`chip ub-ampel ${AMPEL_CLS[k.ampel]}`} data-testid="ub-ampel">{k.ampelText}</span>{k.zusatz && <span className="chip tiny-chip" data-testid="ub-zusatz">{k.zusatz}</span>}</span>
      </div>
      {k.kurz && <p className="ub-kurz">{k.kurz}</p>}
      {k.github.length > 0 && <p className="tiny muted ub-gh">{k.github.map((g: any, i: number) => <span key={i}>{i ? ' · ' : ''}{g.repo} <code>{g.zweig}</code>{g.commit ? <> → <code>{g.commit}</code></> : null}{g.pr ? <> · <a href={g.pr} target="_blank" rel="noreferrer">PR</a></> : null}</span>)}</p>}
      {k.commitWarnung && <p className="tiny rq-warn">⚠ {k.commitWarnung}</p>}
      {k.links.length > 0 && <div className="ub-links">{k.links.map((l: any) => <a key={l.url} href={l.url} target={l.url.startsWith('#') ? undefined : l.art === 'chat' ? chatTarget : '_blank'} rel="noreferrer" data-art={l.art}>{l.label}</a>)}</div>}
      <p className="ub-von" data-testid="ub-von"><b>Von dir:</b> {k.vonDir}</p>
      <div className="row ub-aktionen">
        {k.kannFreigeben && <button className={`btn small${k.ampel === 'push' ? ' primary' : ''}`} disabled={busy || k.running} onClick={freigeben} data-testid="ub-push">{k.freigabe?.veraltet ? 'Neu freigeben' : 'Push freigeben'}</button>}
        {nE > 0 && <button className="btn small" aria-expanded={panel === 'entscheiden'} onClick={() => toggle('entscheiden')} data-testid="ub-btn-entscheiden">Entscheiden ({nE}) {panel === 'entscheiden' ? '▴' : '▾'}</button>}
        {nQ > 0 && <button className="btn small" aria-expanded={panel === 'fragen'} onClick={() => toggle('fragen')}>Rückfragen ({nQ}) {panel === 'fragen' ? '▴' : '▾'}</button>}
        {k.braucht && <button className="btn small" aria-expanded={panel === 'antwort'} onClick={() => toggle('antwort')} data-testid="ub-btn-antwort">Antworten {panel === 'antwort' ? '▴' : '▾'}</button>}
        {k.ampel !== 'laeuft' && <button className="btn ghost small" aria-expanded={panel === 'nacharbeit'} onClick={() => toggle('nacharbeit')}>Nacharbeit {panel === 'nacharbeit' ? '▴' : '▾'}</button>}
        {k.ampel !== 'laeuft' && <button className="btn ghost small" disabled={busy} onClick={passt} title="Als von dir geprüft ablegen — nichts wird geschrieben oder gepusht" data-testid="ub-passt">Passt, ablegen</button>}
      </div>
      {panel === 'entscheiden' && nE > 0 && <Entscheiden k={k} onDone={onDone} />}
      {panel === 'fragen' && nQ > 0 && <div className="ub-panel">{k.rueckfragen.map((q: any) => <Rueckfrage key={q.id} q={q} onDone={onDone} />)}</div>}
      {panel === 'antwort' && k.braucht && <AnStrang k={k} kind="antwort" onDone={onDone} />}
      {panel === 'nacharbeit' && <AnStrang k={k} kind="nacharbeit" onDone={onDone} />}
      <Err e={err} />
    </article>
  );
}

const ZAHL: [string, string, string][] = [['review', 'Review', 'warn'], ['blockiert', 'blockiert', 'bad'], ['push', 'bereit', 'ok'], ['laeuft', 'läuft', '']];

function Thema({ t, onDone }: { t: any; onDone: (reload?: boolean) => void }) {
  const offenVorgabe = t.zahlen.review + t.zahlen.blockiert + t.zahlen.push > 0;
  const [zu, setZu] = useStored<boolean | null>(`thema:${t.thema}`, null);
  const open = zu === null ? offenVorgabe : !zu;
  return (
    <details className={`ub-thema${t.karten.length > 1 ? ' ub-breit' : ''}`} open={open} onToggle={(e) => { const o = (e.target as HTMLDetailsElement).open; if (o !== open) setZu(o === offenVorgabe ? null : !o); }} data-testid="ub-thema" data-thema={t.thema}>
      <summary><span className="ub-thema-name">{t.thema}</span> <span className="chip">{t.karten.length}</span>
        {ZAHL.filter(([z]) => t.zahlen[z]).map(([z, label, cls]) => <span key={z} className={`chip tiny-chip ${cls}`}>{t.zahlen[z]} {label}</span>)}</summary>
      <div className="ub-grid">{t.karten.map((k: any) => <Karte key={k.id} k={k} onDone={onDone} />)}</div>
    </details>
  );
}

export function Uebersicht({ cfg }: { cfg: Config }) {
  const d = useLoad(() => api('/api/uebersicht'));
  const x: any = d.data;
  const neu = () => api('/api/uebersicht').then(d.setData).catch(() => {});
  // Sichtbarer Stand (Council 7): alle 60 s und beim Zurückkehren in den Tab neu laden — Entwürfe bleiben im localStorage.
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') neu(); }, 60_000);
    const vis = () => { if (document.visibilityState === 'visible') neu(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  }, []);
  if (cfg.user?.role !== 'ADMIN') return <div className="page"><p className="muted">Nur für Admins.</p></div>;
  if (d.error) return <div className="page"><Err e={d.error} /></div>;
  if (!x) return <div className="page"><Loading /></div>;
  const onDone = () => { neu(); };
  const n = x.themen.reduce((s: number, t: any) => s + t.karten.length, 0);
  return (
    <div className="page ub" data-testid="uebersicht">
      <header className="ub-head">
        <h1>Übersicht: Was fertig ist</h1>
        <p className="muted small">Stand {fmtDateTime(x.at)} · {n} {n === 1 ? 'Unter-Chat' : 'Unter-Chats'} · <b>Von dir: {x.vonDir}</b> · <button className="linklike" onClick={neu}>neu laden</button></p>
      </header>
      {x.dryRun && <p className="chip warn">Vorschau (Trockenlauf): Antworten an Unter-Chats sind aus.</p>}
      <section className="card ub-exec">
        <h2>So bringst du es auf GitHub</h2>
        <p className="small">„Push freigeben“ gibt genau den gezeigten Stand frei. Gepusht wird danach von der Hauptsitzung (Fast-Forward oder neuer Zweig mit PR), <b>nie gemergt</b>. Entscheidungen und Antworten gehen direkt an den Unter-Chat; was du anfängst, bleibt beim Neuladen stehen.</p>
        {!x.paketDienst && <p className="tiny muted">Folien- und Bilder-Links fehlen: der Review-Pakete-Dienst ist nicht eingetragen (WERKBANK_PAKETE_URL oder Dienste-Register).</p>}
      </section>
      {x.lose.length > 0 && <section className="card ub-lose" data-testid="ub-lose">
        <h2>Rückfragen an dich <span className="chip warn">{x.lose.length}</span></h2>
        {x.lose.map((q: any) => <Rueckfrage key={q.id} q={q} onDone={onDone} />)}
      </section>}
      <div className="ub-themen">{x.themen.map((t: any) => <Thema key={t.thema} t={t} onDone={onDone} />)}</div>
      {!n && !x.lose.length && <div className="card soft empty"><p><b>Nichts offen.</b></p><p className="small muted">Neue Unter-Chats startet der Hauptchat.</p></div>}
    </div>
  );
}
