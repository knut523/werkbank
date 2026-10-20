// Übersicht — die Startseite (docs/plan-uebersicht-handeln.md, Paket 184, Teil B; Struktur und Bildsprache aus den Mockups von
// Paket 185). Eine Karte je Unter-Chat, nach Thema wie die Chat-Seitenleiste: Ampel, 2–3 Sätze, Links, „Von dir“ — und direkt
// handeln: Push freigeben, Entscheidungen und Rückfragen mit Ja / Nein / Anders …, Nacharbeit, Abhaken. Alles über die
// vorhandenen Routen. Was früher nur auf „Heute“ stand (Board-Agentenläufe, Vault-Sync-Fragen, G0-Stopps, Pflege, Mein Tag),
// steht hier weiter (185-Council B2/B8). Entwürfe und auf/zu liegen im localStorage — Neuladen verliert nichts.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, chatTarget, fmtDateTime, type Config } from '../api.ts';
import { Err, Loading, useJiraLive, useLoad, useToast } from '../ui.tsx';
import { usePushFreigeben } from '../freigabe.tsx';
import { useMermaidIn } from '../mermaid.tsx';
import { WartetAufDich, mineCount } from '../beimir.tsx';
import { OrchQuestions } from '../orchquestions.tsx';
import { G0Blocked, LiveGroup, RunCard } from './Heute.tsx';
import { Bericht, Review, StartHauptchat } from './Leitstand.tsx';
import { Morgenlage } from './Morgenlage.tsx';

const AMP: Record<string, string> = { push: 'u-push', review: 'u-dich', laeuft: 'u-run', blockiert: 'u-bad' };
const PREFIX = 'wb-uebersicht:';

/** Zustand im localStorage (je Schlüssel); `leer` wird nicht gespeichert, sondern gelöscht. */
export function useStored<T>(key: string, leer: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => { try { const s = localStorage.getItem(PREFIX + key); return s ? JSON.parse(s) : leer; } catch { return leer; } });
  const set = (n: T) => {
    setV(n);
    try { if (JSON.stringify(n) === JSON.stringify(leer)) localStorage.removeItem(PREFIX + key); else localStorage.setItem(PREFIX + key, JSON.stringify(n)); } catch { /* privat */ }
  };
  return [v, set];
}

const is409 = (e: any) => e?.status === 409;   // Stand veraltet / Unter-Chat arbeitet → neu laden, Entwurf bleibt
const kurzText = (t: string, n = 140) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

export type Art = 'ja' | 'nein' | 'anders';

/** Eine Frage, eine Antwort: Ja (= Empfehlung) · Nein · Anders … (Textfeld). Ja/Nein gehen mit einem Klick ab. */
export function JaNeinAnders({ k, empfehlung, disabled, onSend, extra }: { k: string; empfehlung?: string | null; disabled?: boolean; onSend: (art: Art, text: string) => Promise<void>; extra?: ReactNode }) {
  const [anders, setAnders] = useStored<string | null>(`${k}:anders`, null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const go = async (art: Art, text = '') => {
    setBusy(true); setErr(null);
    try { await onSend(art, text); if (art === 'anders') setAnders(null); } catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div className="ub-jna" data-testid="ub-jna">
      <div className="ub-row">
        <button className="ub-btn pri sm" disabled={busy || disabled} title={empfehlung ? `Empfehlung übernehmen: ${empfehlung}` : 'Ja'} onClick={() => go('ja')} data-testid="ub-ja">Ja</button>
        <button className="ub-btn sm" disabled={busy || disabled} onClick={() => go('nein')} data-testid="ub-nein">Nein</button>
        <button className="ub-btn ghost sm" aria-expanded={anders !== null} disabled={disabled} onClick={() => setAnders(anders === null ? '' : null)} data-testid="ub-anders">Anders …</button>
      </div>
      {anders !== null && <div className="ub-anders">
        {extra}
        <textarea rows={2} value={anders} placeholder="Deine Antwort" aria-label="Deine Antwort" onChange={(e) => setAnders(e.target.value)} data-testid="ub-anders-text" />
        <div className="ub-row"><button className="ub-btn pri sm" disabled={busy || disabled || !anders.trim()} onClick={() => go('anders', anders)} data-testid="ub-anders-senden">Senden</button>
          <button className="ub-btn ghost sm" onClick={() => setAnders(null)}>Abbrechen</button></div>
      </div>}
      <Err e={err} />
    </div>
  );
}

/** Entscheidungen (D-/E-Kennungen) aus Bericht-Kopf und Textblöcken — vorhandene Route, die Antwort landet an der Quelle. */
function Entscheiden({ k, onDone }: { k: any; onDone: () => void }) {
  const toast = useToast();
  const liste: any[] = k.entscheidungen;
  const [einzeln, setEinzeln] = useStored<boolean>(`${k.id}:einzeln`, false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  // Ein Bericht, eine Antwort zur Zeit: solange eine unterwegs ist, sind alle Knöpfe der Karte aus (Pass C, Teil B).
  const send = async (antworten: any[]) => {
    setBusy(true);
    try {
      const r: any = await api(`/api/review/${k.id}/entscheidungen`, { body: { berichtHash: k.berichtHash, weiter: true, antworten } });
      toast(`${antworten.map((a) => a.id).join(', ')} beantwortet — im Bericht eingetragen${r.weiter ? ', der Unter-Chat macht weiter' : ''}`);
      onDone();
    } catch (e) { if (is409(e)) onDone(); throw e; } finally { setBusy(false); }
  };
  const antwort = (e: any, art: Art, text: string) => art === 'ja' ? { id: e.id, art: 'akzeptiert' }   // ohne Empfehlung trägt der Server „ja“ ein
    : art === 'nein' ? { id: e.id, art: 'abgelehnt' } : { id: e.id, art: 'eigene', text };
  const alle = async () => {
    setErr(null);
    try { await send(liste.filter((e) => e.empfehlung).map((e) => ({ id: e.id, art: 'akzeptiert' }))); } catch (e) { setErr(e); }
  };
  const frage = (e: any) => (
    <div key={e.id} className="ub-frage" data-testid="ub-entscheidung" data-id={e.id}>
      <p className="small"><b>{e.id}</b> {e.frage}</p>
      {e.empfehlung && <p className="tiny mut">Empfehlung: {e.empfehlung}</p>}
      {e.optionen && <details className="tiny"><summary className="mut">Optionen aus dem Bericht</summary><pre className="ub-pre">{e.optionen}</pre></details>}
      <JaNeinAnders k={`${k.id}:${e.id}`} empfehlung={e.empfehlung} disabled={busy} onSend={(art, text) => send([antwort(e, art, text)])} />
    </div>
  );
  if (liste.length === 1) return <div className="ub-dec">{frage(liste[0])}</div>;
  return (
    <div className="ub-dec" data-testid="ub-entscheidungen">
      <div className="ub-row">
        {liste.some((e) => e.empfehlung) && <button className="ub-btn sm" disabled={busy} onClick={alle} data-testid="ub-alle">Alle Empfehlungen übernehmen</button>}
        <button className="ub-btn ghost sm" aria-expanded={einzeln} onClick={() => setEinzeln(!einzeln)} data-testid="ub-einzeln">Einzeln entscheiden {einzeln ? '▴' : '▾'}</button>
      </div>
      {einzeln && <div className="ub-dec-liste">{liste.map(frage)}</div>}
      <Err e={err} />
    </div>
  );
}

/** Rückfrage des Orchestrators (q-…): Ja = empfohlene Option, Nein, Anders = andere Option und/oder Text. */
export function Rueckfrage({ q, onDone, ohneTitel }: { q: any; onDone: () => void; ohneTitel?: boolean }) {
  const toast = useToast();
  const opts: any[] = q.options ?? [];
  const rec = opts.find((o) => o.label === q.recommendation) ?? opts.find((o) => String(q.recommendation ?? '').startsWith(o.label));
  const [wahl, setWahl] = useStored<string>(`q:${q.id}:option`, '');
  const send = async (art: Art, text: string) => {
    const body = art === 'ja' ? (rec ? { option: rec.label, text: '' } : { option: null, text: `Ja${q.recommendation ? ` (wie empfohlen: ${q.recommendation})` : ''}` })
      : art === 'nein' ? { option: null, text: `Nein${q.recommendation ? ` (Empfehlung „${q.recommendation}“ abgelehnt)` : ''}` } : { option: wahl || null, text };
    await api(`/api/orchestrator/questions/${q.id}/answer`, { body });
    setWahl('');
    toast('Antwort gespeichert — der Hauptchat liest sie beim nächsten Abruf');
    window.dispatchEvent(new Event('werkbank-questions'));
    onDone();
  };
  return (
    <div className="ub-frage" data-testid="ub-rueckfrage" data-q={q.id}>
      {!ohneTitel && <p className="small"><b>{q.title}</b></p>}
      {q.context && <details className="tiny"><summary className="mut">Kontext</summary><p className="small ub-pre">{q.context}</p></details>}
      {q.recommendation && <p className="tiny mut">Empfehlung: {rec ? <b>{rec.label}</b> : q.recommendation}{rec && q.recommendation !== rec.label ? ` — ${q.recommendation}` : ''}</p>}
      <JaNeinAnders k={`q:${q.id}`} empfehlung={rec?.label ?? q.recommendation} onSend={send}
        extra={opts.length > 0 && <div className="ub-qopt">{opts.map((o) => <label key={o.label} className={o === rec ? 'rec' : ''}>
          <input type="radio" name={`q-${q.id}`} checked={wahl === o.label} onChange={() => setWahl(o.label)} />{o.label}{o === rec ? ' ⭐' : ''}{o.consequence ? <span className="tiny mut"> — {o.consequence}</span> : null}</label>)}</div>} />
    </div>
  );
}

/** „Braucht Knut“ aus dem Stand des Unter-Chats: Ja / Nein / Anders als Antwort in denselben Chat. */
function Braucht({ k, onDone }: { k: any; onDone: () => void }) {
  const toast = useToast();
  const send = async (art: Art, text: string) => {
    try {
      await api(`/api/leitstand/strands/${k.id}/reply`, { body: { kind: 'antwort', text: art === 'ja' ? 'Ja.' : art === 'nein' ? 'Nein.' : text, seen: k.seen } });
      toast('Antwort an den Unter-Chat — er macht weiter');
      onDone();
    } catch (e) { if (is409(e)) onDone(); throw e; }
  };
  return (
    <div className="ub-frage" data-testid="ub-braucht">
      <p className="small">{k.braucht}</p>
      <JaNeinAnders k={`${k.id}:braucht`} onSend={send} disabled={k.running} />
    </div>
  );
}

type Tab = 'bericht' | 'auftrag' | 'aenderungen';

/** Schublade statt Unterseite (Mockup 185): Bericht · Auftrag · Änderungen, Push freigeben auch hier. */
function Schublade({ k, tab, setTab, onClose, onDone }: { k: any; tab: Tab; setTab: (t: Tab) => void; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const pushFreigeben = usePushFreigeben();
  const datei = useLoad(() => (tab === 'aenderungen' || !k.paket ? Promise.resolve(null) : api(`api/files/agenten/${encodeURIComponent(k.paket)}/${tab}.md?vorschau=1`)), [k.id, tab]);
  const rev = useLoad(() => (tab === 'aenderungen' ? api(`/api/review/${k.id}`) : Promise.resolve(null)), [k.id, tab]);
  const ref = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useMermaidIn(body, datei.data);
  useEffect(() => {
    ref.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, []);
  const [err, setErr] = useState<unknown>(null);
  const freigeben = async () => { setErr(null); try { if (await pushFreigeben(k.id)) { toast('Freigegeben — der Hauptchat pusht nach seiner Prüfung'); onDone(); onClose(); } } catch (e) { setErr(e); } };
  const r: any = rev.data;
  const d: any = datei.data;
  return (
    <div className="ub-drawer" data-testid="ub-schublade">
      <div className="ub-scrim" onClick={onClose} />
      <div className="ub-sheet" role="dialog" aria-modal="true" aria-label={`${k.titel}: Bericht und Freigabe`} tabIndex={-1} ref={ref}>
        <div className="ub-row ub-sheet-head"><h2>{k.titel}</h2><span className="sp" /><button className="ub-btn sm" onClick={onClose}>Schließen</button></div>
        <div className="ub-tabs" role="tablist">
          {(['bericht', 'auftrag', 'aenderungen'] as Tab[]).map((t) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'bericht' ? 'Bericht' : t === 'auftrag' ? 'Auftrag' : 'Änderungen'}</button>)}
        </div>
        {tab !== 'aenderungen' && (!k.paket ? <p className="small mut">Kein Review-Paket zu diesem Unter-Chat.</p>
          : datei.error ? <p className="small mut">{tab === 'auftrag' ? 'Kein Auftrag im Paket.' : 'Kein Bericht im Paket.'}</p>
          : !d ? <Loading /> : <div className="note-body ub-doc" ref={body} dangerouslySetInnerHTML={{ __html: d.html ?? '' }} />)}
        {tab === 'aenderungen' && (rev.error ? <Err e={rev.error} /> : !r ? <Loading /> : <div className="ub-card" data-testid="ub-aenderungen">
          <h3>Was du freigibst</h3>
          {r.repo?.fehler ? <p className="small mut">{r.repo.fehler}</p> : <>
            <table className="ub-table"><thead><tr><th>Repo</th><th>Zweig</th><th>Stand</th></tr></thead>
              <tbody><tr><td>{String(r.repo?.key ?? '').replace(/^https:\/\/github\.com\//, '')}</td><td><code>{r.repo?.branch}</code></td><td>{(r.repo?.commits ?? []).length} Commits · {r.repo?.clean ? 'sauber' : 'ungespeicherte Änderungen'}</td></tr></tbody></table>
            <p className="tiny mut">Der Hauptchat pusht genau diesen Stand und öffnet die PRs. Gemergt wird nie.</p>
            <div className="ub-row">{k.kannFreigeben && <button className="ub-btn pri" onClick={freigeben} data-testid="ub-push-schublade">Push freigeben</button>}</div>
            <details className="small"><summary className="mut">Technische Details ▾</summary>
              <pre className="ub-pre tiny">Kopf {String(r.repo?.head ?? '').slice(0, 12)}\n{(r.repo?.commits ?? []).map((c: any) => `${String(c.sha ?? '').slice(0, 8)} ${c.subject ?? ''}`).join('\n')}{r.repo?.stat ? `\n\n${r.repo.stat}` : ''}</pre></details>
          </>}
          <Err e={err} />
        </div>)}
      </div>
    </div>
  );
}

/** Tiefe und ETA eines Strangs (Plan 205): „deep · fertig ca. 17:30“; überfällig gedämpft markiert, kein Alarm. */
function TiefeEta({ k }: { k: any }) {
  if (!k.tiefe && !k.eta?.at) return null;
  return <span className={`tiny ub-eta${k.eta?.ueberfaellig ? ' ueber' : ''}`} data-testid="ub-eta" title={k.eta?.quelle ? `ETA: ${k.eta.quelle}` : undefined}>
    {k.tiefe && <span className="ub-tiefe" data-testid="ub-tiefe">{k.tiefe}</span>}{k.eta?.text ?? '–'}</span>;
}

function Karte({ k, onDone, oeffne }: { k: any; onDone: () => void; oeffne: (k: any, t: Tab) => void }) {
  const toast = useToast();
  const pushFreigeben = usePushFreigeben();
  const [nacharbeit, setNacharbeit] = useStored<string | null>(`${k.id}:nacharbeit`, null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const tun = async (fn: () => Promise<void>) => { setBusy(true); setErr(null); try { await fn(); } catch (e) { setErr(e); if (is409(e)) onDone(); } finally { setBusy(false); } };
  const freigeben = () => tun(async () => { if (await pushFreigeben(k.id)) { toast('Freigegeben — der Hauptchat pusht nach seiner Prüfung'); onDone(); } });
  const abhaken = () => tun(async () => { await api(`/api/leitstand/strands/${k.id}/passt`, { body: { seen: k.seen, note: 'Abgehakt (Übersicht)' } }); toast(`${k.titel} abgehakt`); onDone(); });
  const zurueck = () => tun(async () => { await api(`/api/leitstand/strands/${k.id}/reply`, { body: { kind: 'nacharbeit', text: nacharbeit, seen: k.seen } }); toast('Nacharbeit an den Unter-Chat'); setNacharbeit(null); onDone(); });
  const g = k.github?.[0];
  return (
    <article className={`ub-card ub-karte a-${k.ampel}`} data-testid="ub-karte" data-ampel={k.ampel} data-strang={k.id}>
      <div className="ub-top"><h3>{k.titel}</h3><span className={`ub-amp ${AMP[k.ampel]}`} data-testid="ub-ampel">{k.ampelText}</span></div>
      {(k.tiefe || k.eta?.at) && <p className="ub-etaz"><TiefeEta k={k} /></p>}
      {k.kurz && <p className="ub-kurz">{k.kurz}</p>}
      <div className="ub-chips">
        {k.links.map((l: any) => l.art === 'bericht'
          ? <button key="bericht" className="ub-chip" onClick={() => oeffne(k, 'bericht')} data-testid="ub-bericht">Bericht</button>
          : <a key={l.url} className="ub-chip" href={l.url} target={l.art === 'chat' ? chatTarget : '_blank'} rel="noreferrer" data-art={l.art}>{l.label}{l.art === 'vorschau' ? ' ↗' : ''}</a>)}
        {k.github?.length > 0 && <button className="ub-chip" onClick={() => oeffne(k, 'aenderungen')}>Änderungen</button>}
      </div>
      {k.commitWarnung && <p className="tiny ub-warn">⚠ {k.commitWarnung}</p>}
      {k.kopfFehler && <p className="tiny ub-warn" data-testid="ub-kopf-fehler">⚠ Bericht-Kopf unlesbar: {k.kopfFehler}</p>}
      <div className="ub-von">
        <span className="ub-lab">Von dir</span>
        <p className="small" data-testid="ub-von">{k.vonDir}</p>
        {k.entscheidungen.length > 0 && <Entscheiden k={k} onDone={onDone} />}
        {k.rueckfragen.map((q: any) => <Rueckfrage key={q.id} q={q} onDone={onDone} />)}
        {k.braucht && k.entscheidungen.length === 0 && k.rueckfragen.length === 0 && <Braucht k={k} onDone={onDone} />}
        <div className="ub-row">
          {k.kannFreigeben && <button className={`ub-btn${k.ampel === 'push' ? ' pri big' : ''}`} disabled={busy || k.running} onClick={freigeben} data-testid="ub-push">{k.freigabe?.veraltet ? 'Neu freigeben' : 'Push freigeben'}</button>}
          {k.ampel !== 'laeuft' && <button className="ub-btn ghost sm" aria-expanded={nacharbeit !== null} onClick={() => setNacharbeit(nacharbeit === null ? '' : null)} data-testid="ub-nacharbeit">Nacharbeit …</button>}
          {k.ampel !== 'laeuft' && <button className="ub-btn ghost sm" disabled={busy} onClick={abhaken} title="Als von dir geprüft ablegen — nichts wird geschrieben oder gepusht" data-testid="ub-abhaken">Abhaken</button>}
        </div>
        {nacharbeit !== null && <div className="ub-anders">
          <textarea rows={3} value={nacharbeit} aria-label="Was nacharbeiten?" placeholder="z. B. Test für den Fehlerfall ergänzen" onChange={(e) => setNacharbeit(e.target.value)} data-testid="ub-nacharbeit-text" />
          <div className="ub-row"><button className="ub-btn pri sm" disabled={busy || k.running || !nacharbeit.trim()} onClick={zurueck}>Nacharbeit</button>
            {k.running && <span className="tiny mut">Arbeitet gerade — dein Text bleibt hier stehen.</span>}</div>
        </div>}
      </div>
      {(g || k.zusatz) && <p className="ub-gh">{g && <>{g.repo.split('/').pop()} <code>{g.zweig}</code>{g.commit && <> · <code>{g.commit}</code></>}</>}{k.zusatz && <span className="ub-zusatz" data-testid="ub-zusatz">{k.zusatz}</span>}</p>}
      <details className="ub-tech tiny" data-testid="ub-tech">
        <summary className="mut">Technische Details</summary>
        <p data-testid="strand-modell">{k.modell ? `Modell ${k.modell}` : k.modellPlan ? `Modell ${k.modellPlan} (geplant)` : 'Modell unbekannt'}</p>
        {(k.gegenpruefung > 0 || k.reviewReady) && <p data-testid="strand-gegenpruefung">{k.gegenpruefung > 0 ? `Gegenprüfung ${k.gegenpruefung}×` : '⚠️ ohne Gegenprüfung'}</p>}
        <p className="mono">{k.id}</p>
      </details>
      <Err e={err} />
    </article>
  );
}

const PILLE: [string, string, string][] = [['dich', 'u-dich', 'braucht dich|brauchen dich'], ['push', 'u-push', 'bereit zum Push|bereit zum Push'], ['laeuft', 'u-run', 'läuft|laufen'], ['blockiert', 'u-bad', 'blockiert|blockiert']];
const pille = (n: number, w: string) => `${n} ${w.split('|')[n === 1 ? 0 : 1]}`;

function Thema({ t, onDone, oeffne }: { t: any; onDone: () => void; oeffne: (k: any, tab: Tab) => void }) {
  const [zu, setZu] = useStored<boolean>(`thema:${t.thema}`, false);
  const z = t.zahlen;
  const dich = t.karten.filter((k: any) => k.ampel === 'review').length;
  return (
    <details className={`ub-thema${t.karten.filter((k: any) => k.ampel !== 'laeuft').length > 1 ? ' ub-breit' : ''}`} open={!zu} onToggle={(e) => { const o = (e.target as HTMLDetailsElement).open; if (o === zu) setZu(!o); }} data-testid="ub-thema" data-thema={t.thema}>
      <summary><h2>{t.thema}</h2>
        {dich > 0 && <span className="ub-amp u-dich">{pille(dich, 'braucht dich|brauchen dich')}</span>}
        {z.push > 0 && <span className="ub-amp u-push">{z.push} bereit</span>}
        {z.blockiert > 0 && <span className="ub-amp u-bad">{z.blockiert} blockiert</span>}
        {z.laeuft > 0 && <span className="tiny mut">· {z.laeuft} läuft</span>}</summary>
      <div className="ub-grid">{t.karten.filter((k: any) => k.ampel !== 'laeuft').map((k: any) => <Karte key={k.id} k={k} onDone={onDone} oeffne={oeffne} />)}</div>
    </details>
  );
}

/** Die Startseite. Admins sehen die Unter-Chats; alle sehen ihre Board-Agentenläufe, Fragen und Pflegepunkte. */
/** Anzahl eigener Tickets je Jira-Seite (17c). */
const meineTickets = (ts: any[]) => ts.reduce((m: Record<string, number>, t: any) => ({ ...m, [t.site ?? '?']: (m[t.site ?? '?'] ?? 0) + 1 }), {});

export function Uebersicht({ cfg, hash = '#/' }: { cfg: Config; hash?: string }) {
  const admin = cfg.user?.role === 'ADMIN';
  const u = useLoad(() => (admin ? api('/api/uebersicht') : Promise.resolve(null)), [admin]);
  const t = useLoad(() => api('/api/today'));
  const cfgMain = cfg.project;   // 17c: Seiten-Kennzeichen der Tickets (PM | OLAF)
  const [schublade, setSchublade] = useState<{ id: string; tab: Tab } | null>(null);
  // Alte Adressen (Paket 187, S4; `#/leitstand?…`, `#/heute?…`, `#/?…`): review · bericht · auftrag öffnen Ansicht bzw. Schublade, start=1 den Dialog.
  const q = new URLSearchParams(hash.split('?')[1] ?? '');
  const aus = (k: string) => q.get(k) || null;
  const wantStart = q.has('start');
  const [ansicht, setAnsicht] = useState<{ id: string; art: 'bericht' | 'auftrag' } | null>(null);
  const [starten, setStarten] = useState(wantStart);
  const [cosAktiv, setCosAktiv] = useState(false);   // Chief of Staff: die Entscheide stehen oben in der Morgenlage — dann nur eine Liste (Plan 209, S3.1)
  const zurueck = () => { if (hash.includes('?')) window.location.hash = '#/'; };
  const hq = `${aus('review') ?? ''}|${aus('bericht') ?? ''}|${aus('auftrag') ?? ''}`;
  useEffect(() => { setStarten(wantStart); }, [wantStart]);   // Dialog folgt der Adresse (auch beim Verlassen); der Knopf öffnet ihn ohne Adresse
  useEffect(() => { const b = aus('bericht'), a = aus('auftrag'); setAnsicht(b ? { id: b, art: 'bericht' } : a ? { id: a, art: 'auftrag' } : null); }, [hq]);
  const neu = () => { if (admin) api('/api/uebersicht').then(u.setData).catch(() => {}); api('/api/today').then(t.setData).catch(() => {}); };
  useJiraLive(() => { api('/api/today').then(t.setData).catch(() => {}); }, 'both');
  // Sichtbarer Stand: alle 60 s (20 s, solange ein Board-Agent arbeitet oder fragt) und beim Zurückkehren in den Tab.
  const d: any = t.data;
  const x: any = u.data;
  const eilig = d?.queue?.some((q: any) => q.bucket === 'laeuft' || q.bucket === 'frage');
  useEffect(() => {
    const id = setInterval(() => { if (document.visibilityState === 'visible') neu(); }, eilig ? 20_000 : 60_000);
    const vis = () => { if (document.visibilityState === 'visible') neu(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  }, [eilig, admin]);
  if (t.error) return <div className="page"><Err e={t.error} /></div>;
  if (!d || (admin && !x && !u.error)) return <div className="page"><Loading /></div>;

  // Schon live (Paket 141): in der eigenen Gruppe „nur noch abhaken“, nicht noch einmal als Karte.
  const live = (d.strands ?? []).filter((s: any) => s.stand?.kind === 'live' && !s.running);
  const liveIds = new Set(live.map((s: any) => s.id));
  const themen = (x?.themen ?? []).map((th: any) => ({ ...th, karten: th.karten.filter((k: any) => !liveIds.has(k.id)) })).filter((th: any) => th.karten.some((k: any) => k.ampel !== 'laeuft'));
  const karten: any[] = (x?.themen ?? []).flatMap((th: any) => th.karten).filter((k: any) => !liveIds.has(k.id));   // auch Themen nur mit laufenden
  const lose: any[] = x?.lose ?? [];
  const board = d.queue.filter((q: any) => ['review', 'frage', 'haengt', 'still'].includes(q.bucket));
  const laufen = [...karten.filter((k) => k.ampel === 'laeuft').map((k) => ({ id: k.id, thema: k.thema, titel: k.titel, at: k.statusAt, chat: k.chat, tiefe: k.tiefe, eta: k.eta })),
    ...d.queue.filter((q: any) => q.bucket === 'laeuft').map((q: any) => ({ id: q.id, thema: 'Board', titel: `${q.key}${q.summary ? ` — ${q.summary}` : ''}`, at: q.startedAt, chat: q.url }))];
  const mine = mineCount(d.mine, []);
  const zahl = {
    // Eine Zahl, eine Quelle (Walkthrough 221): der Kopf zeigt die Inbox-Zahl wie Leiste und Morgenlage ①.
    dich: typeof d.count === 'number' ? d.count : karten.filter((k) => k.ampel === 'review' && !String(k.vonDir).startsWith('nichts')).length + lose.length + board.length + mine + (d.g0?.length ?? 0),
    push: karten.filter((k) => k.ampel === 'push' && k.kannFreigeben).length,
    laeuft: laufen.length,
    blockiert: karten.filter((k) => k.ampel === 'blockiert').length,
  };
  const springe = (w: string) => {
    const sel = w === 'laeuft' ? '[data-testid="ub-laeuft"]' : w === 'dich' ? (cosAktiv ? '[data-testid="cos-entscheide"]' : '[data-ampel="review"], [data-testid="ub-lose"], [data-testid="ub-board"]') : `[data-ampel="${w}"]`;
    // Morgenlage zugeklappt → ① ist nicht im Dokument; dann auf die Karten der Übersicht springen (Pass C).
    (document.querySelector(sel) ?? document.querySelector('[data-testid="cos-morgenlage"]'))?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  const ansichtKarte = ansicht ? karten.find((k) => k.id === ansicht.id) : null;
  const offen = schublade ? karten.find((k) => k.id === schublade.id) : ansichtKarte;
  const hc = x?.hauptchat;
  const hcFarbe = !hc ? 'bad' : hc.status === 'bereit' ? 'ok' : hc.status === 'läuft' ? 'run' : hc.status === 'wartet auf dich' ? 'dich' : 'bad';
  const heute = new Intl.DateTimeFormat('de-AT', { weekday: 'long', day: '2-digit', month: '2-digit' }).format(new Date());

  return (
    <div className="page ub" data-testid="uebersicht">
      <div className="ub-head">
        <div><h1>Übersicht</h1><p className="small mut">{heute} · was fertig ist, was dich braucht, was läuft{x ? <> · Stand {fmtDateTime(x.at)} · <button className="linklike" onClick={neu}>neu laden</button></> : null}</p></div>
        <div className="ub-sum" role="group" aria-label="Springen zu">
          {PILLE.map(([w, cls, text]) => (zahl as any)[w] > 0 && <button key={w} className={`ub-amp ${cls}`} onClick={() => springe(w)} data-testid={`ub-pille-${w}`}>{pille((zahl as any)[w], text)}</button>)}
        </div>
      </div>
      {x?.fragenFehler && <p className="ub-amp u-bad" role="alert">Rückfragen gerade nicht lesbar — hier fehlen evtl. offene Fragen. Später neu laden.</p>}
      {u.error ? <Err e={u.error} /> : null}

      {admin && <Morgenlage onChange={neu} onAktiv={setCosAktiv} />}

      {admin && <div className="ub-card soft ub-hc" data-testid="ub-hauptchat">
        <span className={`ub-dot d-${hcFarbe}`} aria-hidden /><b>Hauptchat</b>
        <span className="small mut">{hc ? `${hc.status}${hc.open > 0 ? ` · ${hc.open} Meldung${hc.open === 1 ? '' : 'en'} unterwegs` : ''} · pusht, was du hier freigibst — nie mergen` : 'kein Hauptchat aktiv'}</span>
        <span className="sp" />
        {hc && <a className="ub-btn sm" href={hc.url} target={chatTarget}>Hauptchat öffnen</a>}
        {!starten && <button className={`ub-btn sm${hc ? ' ghost' : ''}`} onClick={() => setStarten(true)} data-testid="neu-starten">{hc ? 'Neu starten …' : 'Hauptchat starten'}</button>}
      </div>}
      {admin && starten && <StartHauptchat aktiv={!!hc} onStarted={() => { setStarten(false); neu(); zurueck(); }} onClose={() => { setStarten(false); zurueck(); }} />}
      {admin && aus('review') && <Review id={aus('review')!} onClose={zurueck} />}
      {admin && ansicht && !karten.some((k) => k.id === ansicht.id) && <Bericht id={ansicht.id} art={ansicht.art} onClose={() => { setAnsicht(null); zurueck(); }} />}
      {(d.orchAuto ?? []).length > 0 && <p className="small mut" data-testid="orch-auto">🔁 Automatisch fortgesetzt: {d.orchAuto.map((a: any, i: number) => <span key={a.id}>{i ? ', ' : ''}<a href={a.url} target={chatTarget}>{a.title}</a> ({a.n}){a.stopped ? ' — angehalten' : ''}</span>)}</p>}
      <p className="small" data-testid="link-entscheidungs-log"><a href="#/inbox">Alle Entscheide und Entscheidungs-Log (was nach 24 h automatisch angenommen wurde) →</a></p>

      <div className="ub-themen">
      {lose.length > 0 && !cosAktiv && <section className={`ub-thema-flach${lose.length > 1 ? ' ub-breit' : ''}`} data-testid="ub-lose">
        <h2 className="ub-h">Rückfragen an dich <span className="ub-amp u-dich">{lose.length}</span></h2>
        <div className="ub-grid">{lose.map((q) => <article key={q.id} className="ub-card a-review" data-ampel="review">
          <div className="ub-top"><h3>{q.title}</h3><span className="ub-amp u-dich">ja / nein</span></div>
          <div className="ub-von"><span className="ub-lab">Von dir</span><Rueckfrage q={q} onDone={neu} ohneTitel /></div>
        </article>)}</div>
      </section>}

      {themen.map((th: any) => <Thema key={th.thema} t={th} onDone={neu} oeffne={(k, tab) => setSchublade({ id: k.id, tab })} />)}
      </div>

      {(board.length > 0 || mine > 0 || (d.g0 ?? []).length > 0 || (!admin && (d.orchOpen ?? 0) > 0)) && <section data-testid="ub-board">
        <h2 className="ub-h">Agentenläufe und Fragen {board.length + mine > 0 && <span className="ub-amp u-dich">{board.length + mine}</span>}</h2>
        {(d.g0 ?? []).length > 0 && <G0Blocked items={d.g0} />}
        {!admin && (d.orchOpen ?? 0) > 0 && <OrchQuestions onChange={neu} />}
        {board.map((it: any) => <RunCard key={it.id} it={it} onDone={neu} />)}
        {mine > 0 && <div className="ub-card"><WartetAufDich x={d.mine} decisions={[]} onChange={neu} /></div>}
      </section>}

      {laufen.length > 0 && <section className="ub-card" data-testid="ub-laeuft" id="lauf">
        <div className="ub-row"><h2>Läuft</h2><span className="ub-amp u-run">{laufen.length}</span><span className="sp" /><span className="tiny mut">steuern im jeweiligen Chat</span></div>
        <div className="ub-runs">{laufen.map((r) => <div key={r.id} className="ub-runrow"><span className="ub-amp u-run">{r.thema}</span><span className="t">{r.titel}</span>
          <TiefeEta k={r} /><span className="tiny mut">seit {fmtDateTime(r.at)}</span>{r.chat && <a className="ub-btn sm" href={r.chat} target={chatTarget}>Chat</a>}</div>)}</div>
      </section>}

      {live.length > 0 && <LiveGroup items={live} onDone={neu} />}

      {(x?.erledigt ?? []).length > 0 && <details className="ub-card" data-testid="ub-erledigt">
        <summary className="ub-row"><h2>Erledigt diese Woche</h2><span className="ub-amp u-done">{x.erledigt.length}</span><span className="sp" /><span className="tiny mut">aufklappen</span></summary>
        <div className="ub-runs">{x.erledigt.map((r: any) => <div key={r.id} className="ub-runrow"><span className="ub-amp u-done">{r.thema}</span><span className="t">{r.titel}</span>
          <span className="tiny mut">{fmtDateTime(r.at)}</span>{r.chat && <a className="ub-btn sm" href={r.chat} target={chatTarget}>Chat</a>}</div>)}</div>
      </details>}

      {!karten.length && !lose.length && !board.length && !mine && !laufen.length && <div className="ub-card soft" data-testid="today-empty">
        <p><b>Nichts braucht dich.</b></p><p className="small mut">Neue Arbeit findest du auf der <a href="#/roadmap">Roadmap</a> (Als Nächstes) oder am <a href="#/board">Board</a>.</p></div>}

      {/* U4 (Knut 19.10.): „Außerdem in Planen“ ist weg — Vault-Fragen stehen unter Entscheidungen, Pflege ist ein Eintrag dort, eigene Tickets im Board. */}

      {offen && (schublade || ansicht) && <Schublade k={offen} tab={schublade?.tab ?? ansicht!.art} setTab={(tab) => { setAnsicht(null); setSchublade({ id: offen.id, tab }); }} onClose={() => { setSchublade(null); if (ansicht) { setAnsicht(null); zurueck(); } }} onDone={neu} />}
    </div>
  );
}
