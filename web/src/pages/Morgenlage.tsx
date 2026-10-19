// Chief of Staff — Karte „Morgenlage“ oben auf der Übersicht (docs/plan-chief-of-staff.md, S1.2/S1.4; nur Admin, Feature `cos`).
// Immer live berechnet (GET /api/cos/lage), mit eigener Uhrzeit (K19). Antworten gehen über die vorhandenen Wege: Rückfragen an Strang
// (`/api/orchestrator/questions/:id/answer`), Bericht-Entscheidungen (`/api/review/:id/entscheidungen`), Meeting-Vorschläge (`/api/cos/triage`).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, chatTarget } from '../api.ts';
import { Err, useToast } from '../ui.tsx';
import { JaNeinAnders, Rueckfrage, useStored, type Art } from './Uebersicht.tsx';
import { InboxZeile } from './HeuteNeu.tsx';
import { note } from '../beimir.tsx';

const hm = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' }) : '—');
const seitText = (iso?: string | null) => {
  if (!iso) return '';
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3600_000);
  return h < 1 ? 'seit unter 1 h' : h < 48 ? `seit ${h} h` : `seit ${Math.floor(h / 24)} Tagen`;
};
const datumKurz = (d?: string | null) => (d ? `${d.slice(8, 10)}.${d.slice(5, 7)}.` : '');

/** „… und N weitere“ klappt an Ort und Stelle auf (`rest` vom Server) — keine Sackgasse mehr (Walkthrough 221). */
function Mehr({ liste, zeile }: { liste: { weitere: number; rest?: any[] }; zeile: (x: any, i: number) => ReactNode }) {
  const [auf, setAuf] = useState(false);
  if (!liste.weitere) return null;
  const rest = liste.rest ?? [];
  if (!rest.length) return <p className="tiny mut" data-testid="cos-mehr">… und {liste.weitere} weitere</p>;
  return <>{auf && <ul data-testid="cos-mehr-liste">{rest.map(zeile)}</ul>}
    <button className="linklike tiny" aria-expanded={auf} onClick={() => setAuf(!auf)} data-testid="cos-mehr">{auf ? 'weniger zeigen' : `… und ${liste.weitere} weitere zeigen`}</button></>;
}

/** Eine Entscheidung mit Ja / Nein / Anders — antwortet dort, wo sie hingehört (Strang, Bericht, Meeting-Notiz). */
export function EntscheidZeile({ e, onDone }: { e: any; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const wartet = e.wartet && e.strang ? <span className="ub-amp u-dich" title="Ein Unter-Chat wartet auf diese Antwort">blockiert: {e.strang.titel || 'Unter-Chat'}</span> : null;
  const kopf = <div className="ub-row"><b className="small">{e.titel}</b>{wartet}<span className="tiny mut">{seitText(e.seit)}</span></div>;
  if (e.art === 'frage') {
    const q = { id: e.id, title: e.titel, recommendation: e.empfehlung, options: (e.optionen ?? []).map((label: string) => ({ label })), context: '' };
    return <div className="cos-e" data-testid="cos-entscheid" data-art="frage" data-id={e.id}>{kopf}<Rueckfrage q={q} onDone={onDone} ohneTitel /></div>;
  }
  if (e.art === 'bericht') {
    const [strang, kennung] = [e.strang.id as string, String(e.id).slice(String(e.strang.id).length + 1)];
    const send = async (art: Art, text: string) => {
      setBusy(true);
      try {
        const antwort = art === 'ja' ? { id: kennung, art: 'akzeptiert' } : art === 'nein' ? { id: kennung, art: 'abgelehnt' } : { id: kennung, art: 'eigene', text };
        await api(`/api/review/${strang}/entscheidungen`, { body: { berichtHash: e.berichtHash, weiter: true, antworten: [antwort] } });
        toast(`${kennung} beantwortet — im Bericht eingetragen`);
        onDone();
      } catch (x: any) { if (x?.status === 409) onDone(); throw x; } finally { setBusy(false); }
    };
    return <div className="cos-e" data-testid="cos-entscheid" data-art="bericht" data-id={e.id}>{kopf}
      {e.empfehlung && <p className="tiny mut">Empfehlung: {e.empfehlung}</p>}
      <JaNeinAnders k={`cos:${e.id}`} empfehlung={e.empfehlung} disabled={busy} onSend={send} /></div>;
  }
  return <TriageZeile e={e} onDone={onDone} kopf={kopf} />;
}

/** Meeting-Vorschlag (S1.3): Ja zeigt erst die Vorschau aller Änderungen, dann wird bestätigt. */
function TriageZeile({ e, onDone, kopf }: { e: any; onDone: () => void; kopf: ReactNode }) {
  const toast = useToast();
  const [vorschau, setVorschau] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [anders, setAnders] = useState(false);
  const post = async (body: any) => { setBusy(true); setErr(null); try { return await api('/api/cos/triage', { body: { datei: e.datei, ...body } }); } catch (x) { setErr(x); return null; } finally { setBusy(false); } };
  const ja = async () => { const r = await post({}); if (r?.needsConfirm) setVorschau(r); };
  const bestaetigen = async () => { const r = await post({ confirm: true, hash: vorschau.hash, registerHash: vorschau.registerHash }); if (r?.ok) { toast('Übernommen — Zusagen im Register, Notiz markiert'); setVorschau(null); onDone(); } };
  const nein = async () => { const r = await post({ art: 'nein' }); if (r?.ok) { toast('Vorschlag ausgeblendet'); onDone(); } };
  return (
    <div className="cos-e" data-testid="cos-entscheid" data-art="triage" data-id={e.id}>{kopf}
      <p className="tiny mut">Empfehlung: {e.empfehlung}</p>
      {!vorschau && <div className="ub-row">
        <button className="ub-btn pri sm" disabled={busy} onClick={ja} data-testid="cos-triage-ja">Ja</button>
        <button className="ub-btn sm" disabled={busy} onClick={nein} data-testid="cos-triage-nein">Nein</button>
        <button className="ub-btn ghost sm" onClick={() => setAnders(!anders)}>Anders …</button></div>}
      {anders && !vorschau && <p className="small">Im Chat triagieren: <a href={`#/uebersicht?einwurf=${encodeURIComponent(e.datei)}`} onClick={(ev) => { ev.preventDefault(); window.dispatchEvent(new CustomEvent('cos-einwurf', { detail: { notiz: e.datei } })); }}>Einwurf mit dieser Notiz</a></p>}
      {vorschau && <div className="cos-vorschau" data-testid="cos-triage-vorschau">
        <p className="small"><b>Das wird geschrieben</b> ({vorschau.datei}):</p>
        <ul className="small">{(vorschau.aenderungen as string[]).map((a, i) => <li key={i}>{a}</li>)}</ul>
        <div className="ub-row"><button className="ub-btn pri sm" disabled={busy} onClick={bestaetigen} data-testid="cos-triage-bestaetigen">Bestätigen</button>
          <button className="ub-btn ghost sm" onClick={() => setVorschau(null)}>Zurück</button></div></div>}
      <Err e={err} />
    </div>
  );
}

function SchuldZeile({ s, onChange }: { s: any; onChange?: () => void }) {
  const [nf, setNf] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const toast = useToast();
  const entwurf = async () => { setErr(null); try { setNf(await api('/api/cos/nachfassen', { body: { id: s.id } })); } catch (e) { setErr(e); } };
  const kopieren = async () => { try { await navigator.clipboard.writeText(nf.text); toast('Kopiert'); } catch { toast('Kopieren nicht möglich — Text markieren'); } };
  const senden = async () => {
    setErr(null);
    try {
      const pre: any = await api('/api/cos/nachfassen/senden', { body: { id: s.id } });
      if (!window.confirm(`Senden?\n\n${pre.ziel}\n\n${pre.text}`)) return;
      await api('/api/cos/nachfassen/senden', { body: { id: s.id, confirm: true, hash: pre.hash } });
      toast('Gesendet und im Register vermerkt'); setNf(null); onChange?.();
    } catch (e) { setErr(e); }
  };
  return (
    <li className={`cos-s${s.ueberfaellig ? ' ueber' : ''}`} data-testid="cos-schuld" data-id={s.id ?? ''}>
      <span className="small">{s.id && <b>{s.id} </b>}{s.wer ?? 'Wer: offen'} → {s.an}: {s.was}</span>
      {' '}{s.ueberfaellig ? <span className="ub-amp u-bad">überfällig{s.tage > 0 ? ` (${s.tage} T.)` : ''}</span> : s.bis ? <span className="tiny mut">bis {datumKurz(s.bis)}</span> : s.fristUnklar && !s.abgeleitet ? <span className="tiny mut">Frist unklar</span> : null}
      {s.abgeleitet && s.link && <> <a className="tiny" href={s.link} target="_blank" rel="noreferrer">öffnen</a></>}
      {s.id && s.ueberfaellig && s.seite !== 'Knut' && s.wer && <> <button className="linklike tiny" onClick={entwurf} data-testid="cos-nachfassen">Nachfassen …</button></>}
      {nf && <div className="cos-nf" data-testid="cos-nachfass-entwurf"><pre className="ub-pre">{nf.text}</pre>
        <div className="ub-row"><button className="ub-btn sm" onClick={kopieren}>Kopieren</button>
          {nf.senden && <button className="ub-btn pri sm" onClick={senden} data-testid="cos-senden">Senden …</button>}
          <span className="tiny mut">{nf.weg}</span><button className="linklike tiny" onClick={() => setNf(null)}>schließen</button></div></div>}
      <Err e={err} />
    </li>
  );
}

function Einwurf({ onClose, vorgabe }: { onClose: () => void; vorgabe?: string }) {
  const [text, setText] = useState('');
  const [titel, setTitel] = useState('');
  const [name, setName] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [fertig, setFertig] = useState<any>(null);
  const datei = useRef<HTMLInputElement>(null);
  const wahl = async (f?: File | null) => { if (!f) return; setName(f.name); setText(await f.text()); if (!titel) setTitel(f.name.replace(/\.[^.]+$/, '')); };
  const senden = async () => {
    setBusy(true); setErr(null);
    try { setFertig(await api('/api/cos/einwurf', { body: { text, titel: titel || undefined, dateiname: name, hinweis: vorgabe ? `Bezug: Notiz ${vorgabe} (Anders → im Chat triagieren)` : undefined } })); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return (
    <div className="cos-einwurf ub-card" data-testid="cos-einwurf" role="dialog" aria-label="Einwurf">
      <div className="ub-row"><h3>Einwurf</h3><span className="sp" /><button className="linklike" onClick={onClose}>schließen</button></div>
      {fertig ? <div><p className="small">Chat gestartet: <a href={fertig.url} target={chatTarget} data-testid="cos-einwurf-chat">„Einwurf · {fertig.titel}“ öffnen</a></p>
        <p className="tiny mut">Dort entsteht die Meeting-Notiz und eine Liste von Kandidaten. Geschrieben wird erst nach deinem „ja“.</p></div> : <>
        <p className="tiny mut">Notizen, Transkript eines beliebigen Recorders (Text, VTT, SRT) oder eine weitergeleitete Mail als Text. Keine Kundendaten, keine Zugangsdaten.{vorgabe ? ` Bezug: ${vorgabe}` : ''}</p>
        <input type="text" value={titel} onChange={(e) => setTitel(e.target.value)} placeholder="Titel (optional)" aria-label="Titel" />
        <textarea rows={8} value={text} onChange={(e) => { setText(e.target.value); setName(undefined); }} placeholder="Text einfügen …" aria-label="Einwurf-Text" data-testid="cos-einwurf-text" />
        <div className="ub-row"><input ref={datei} type="file" accept=".txt,.md,.markdown,.vtt,.srt,.eml,text/*" hidden onChange={(e) => wahl(e.target.files?.[0])} />
          <button className="ub-btn sm" onClick={() => datei.current?.click()}>Datei wählen …</button>{name && <span className="tiny mut">{name}</span>}
          <span className="sp" /><button className="ub-btn pri sm" disabled={busy || !text.trim()} onClick={senden} data-testid="cos-einwurf-senden">{busy ? 'Startet …' : 'Einwerfen'}</button></div>
        <Err e={err} /></>}
    </div>
  );
}

/** Die Karte. `alle` = Vollansicht der Entscheide (Freigabe-Inbox, S3.1). */
export function Morgenlage({ onChange, onAktiv, ohneEntscheide }: { onChange: () => void; onAktiv?: (aktiv: boolean) => void; ohneEntscheide?: boolean }) {
  const [l, setL] = useState<any>(null);
  const [err, setErr] = useState<unknown>(null);
  const [zu, setZu] = useStored<boolean>('cos:zu', false);
  const [einwurf, setEinwurf] = useState<{ notiz?: string } | null>(null);
  const [alle, setAlle] = useState(false);
  // ① kommt aus der Inbox — dieselbe Quelle wie der Zähler in der Leiste und im Kopf (Walkthrough 221: „6 brauchen dich“ vs. „0“).
  const [ib, setIb] = useState<any>(null);
  const lade = () => Promise.all([api('/api/cos/lage'), api('/api/inbox').catch(() => null)]).then(([x, i]: any[]) => { setL(x); setIb(i); setErr(null); onAktiv?.(!x.aus); }).catch((e) => { setErr(e); onAktiv?.(false); });
  useEffect(() => {
    lade();
    const id = setInterval(() => { if (document.visibilityState === 'visible') lade(); }, 120_000);
    const on = (ev: Event) => setEinwurf({ notiz: (ev as CustomEvent).detail?.notiz });
    window.addEventListener('cos-einwurf', on);
    return () => { clearInterval(id); window.removeEventListener('cos-einwurf', on); };
  }, []);
  const fertig = () => { lade(); onChange(); };
  if (err) return <div className="ub-card soft cos" data-testid="cos-fehler"><Err e={err} /></div>;
  if (!l || l.aus) return null;
  const s = l.schulden, n = l.nacht;
  const nachtN = n.pr.gesamt + n.jira.gesamt + n.olafjira.gesamt + n.strang.gesamt + n.meeting.gesamt;
  const eintraege: any[] = ib?.eintraege ?? [];
  const entN = ib ? ib.zahl : l.entscheide.gesamt;
  const gezeigt = alle ? eintraege : eintraege.slice(0, 7);
  const inboxZeile = (e: any, i: number) => e.art === 'triage'
    ? <EntscheidZeile key={e.id} e={{ art: 'triage', id: e.daten.triageId, titel: e.frage, empfehlung: e.empfehlung, datei: e.daten.datei, seit: e.wartetSeit, wartet: false }} onDone={fertig} />
    : <InboxZeile key={e.id} e={e} erste={i === 0} onDone={fertig} />;
  const blockZeile = (b: any) => <li key={b.id} className="small"><b>{b.titel}</b> — {b.von}{b.link ? <> <a className="tiny" href={b.link} target={b.art === 'strang' ? chatTarget : '_blank'} rel="noreferrer">öffnen</a></> : null}</li>;
  const nachtZeile = (x: any, i: number) => <li key={i} className="small">{x.link && /^https?:/.test(x.link) ? <a href={x.link} target="_blank" rel="noreferrer">{x.text}</a> : x.text}</li>;
  const spalte = (titel: string, liste: any, key: string) => (
    <div className="cos-sp" data-testid={`cos-schulden-${key}`}><h4>{titel} <span className="tiny mut">{liste.gesamt}</span></h4>
      {liste.items.length ? <ul>{liste.items.map((x: any, i: number) => <SchuldZeile key={x.id ?? `${key}${i}`} s={x} onChange={fertig} />)}</ul> : <p className="tiny mut">nichts offen</p>}<Mehr liste={liste} zeile={(x: any, i: number) => <SchuldZeile key={x.id ?? `${key}r${i}`} s={x} onChange={fertig} />} /></div>
  );
  return (
    <section className="ub-card cos" data-testid="cos-morgenlage" aria-label="Morgenlage">
      <div className="ub-row">
        <h2>Morgenlage</h2>
        <span className="tiny mut" data-testid="cos-stand">Stand {hm(l.stand.at)}</span>
        <span className="sp" />
        <button className="ub-btn sm" onClick={() => setEinwurf({})} data-testid="cos-einwurf-knopf">Einwurf</button>
        <button className="linklike" onClick={lade}>neu laden</button>
        <button className="ub-btn ghost sm" aria-expanded={!zu} onClick={() => setZu(!zu)} data-testid="cos-zu">{zu ? 'aufklappen' : 'zuklappen'}</button>
      </div>
      {einwurf && <Einwurf vorgabe={einwurf.notiz} onClose={() => setEinwurf(null)} />}
      {zu ? <p className="small mut">{entN} Entscheide · {l.blockiert.gesamt} blockiert · {nachtN} über Nacht · {s.ueberfaellig} überfällig</p> : <>
        {l.leer && <p className="small cos-leer" data-testid="cos-leer">{l.leer}</p>}
        {!ohneEntscheide && <div className="cos-block" data-testid="cos-entscheide">
          <h3>① Entscheide heute <span className="ub-amp u-dich" data-testid="cos-entscheide-zahl">{entN}</span> <a className="tiny" href="#/entscheidungen" data-testid="cos-entscheidungen-link">alle als Karten →</a></h3>
          {ib ? (gezeigt.length ? <div className="h-inbox">{gezeigt.map(inboxZeile)}</div> : <p className="small mut">Nichts wartet auf dich.</p>)
            : (l.entscheide.items.length ? l.entscheide.items.map((e: any) => <EntscheidZeile key={e.id} e={e} onDone={fertig} />) : <p className="small mut">Nichts wartet auf dich.</p>)}
          {ib && eintraege.length > 7 && <button className="linklike tiny" aria-expanded={alle} onClick={() => setAlle(!alle)} data-testid="cos-inbox-auf">{alle ? 'nur die ersten 7 zeigen' : `… und ${eintraege.length - 7} weitere zeigen`}</button>}
          {ib?.zurueckgestellt > 0 && <p className="tiny mut">{ib.zurueckgestellt} bis morgen 07:00 zurückgestellt.</p>}
          {l.roadmapFragen > 0 && <p className="tiny mut">{l.roadmapFragen} offene Roadmap-Fragen → <a href="#/roadmap">Planen</a></p>}
        </div>}
        <div className="cos-block" data-testid="cos-blockiert">
          <h3>② Blockiert <span className="ub-amp u-bad">{l.blockiert.gesamt}</span></h3>
          {l.blockiert.items.length ? <ul>{l.blockiert.items.map(blockZeile)}</ul> : <p className="small mut">Nichts blockiert.</p>}
          <Mehr liste={l.blockiert} zeile={blockZeile} />
        </div>
        {(l.budgets?.items ?? []).length > 0 && <div className="cos-block" data-testid="cos-budget">
          <h3>Budget je Unter-Chat</h3>
          <ul>{l.budgets.items.map((b: any) => <li key={b.id} className="small" data-stufe={b.stufe}><b>{b.titel}</b>: {b.prozent} % ({b.tokens.toLocaleString('de-AT')} von {b.budget.toLocaleString('de-AT')} Tokens){b.stufe === 'stopp' ? <span className="ub-amp u-bad"> Pause — Rückfrage steht unter ①</span> : b.stufe === 'warn' ? <span className="ub-amp u-dich"> ab 80 %</span> : null}{b.energie > 0 && <span className="tiny mut"> · Melious {b.energie} Energie</span>}</li>)}</ul>
        </div>}
        <details className="cos-block" data-testid="cos-nacht" open={nachtN > 0 && nachtN <= 12}>
          <summary><h3 style={{ display: 'inline' }}>③ Über Nacht geändert <span className="tiny mut">{nachtN}</span></h3></summary>
          {(['pr', 'jira', 'olafjira', 'strang', 'meeting'] as const).map((k) => n[k].gesamt > 0 && <div key={k}><h4>{{ pr: 'GitHub', jira: 'Jira PM', olafjira: 'Jira OLAF', strang: 'Unter-Chats', meeting: 'Meetings' }[k]}</h4>
            <ul>{n[k].items.map(nachtZeile)}</ul><Mehr liste={n[k]} zeile={nachtZeile} /></div>)}
          {n.olafjiraFehler && <p className="tiny mut">OLAF-Jira nicht lesbar: {n.olafjiraFehler}</p>}
          {nachtN === 0 && <p className="small mut">Seit {hm(l.stand.stichzeit)} ist nichts passiert, was Aufmerksamkeit braucht.</p>}
          {l.berichte.length > 0 && <div><h4>Berichte von heute</h4><ul>{l.berichte.map((b: any) => <li key={b.art} className="small" data-testid={`cos-bericht-${b.art}`}><b>{b.label}:</b> {b.link ? <a href={note(b.link)} title="Bericht im Wissen öffnen — dort stehen die Tickets hinter den Zahlen">{b.zeile}</a> : b.zeile}</li>)}</ul></div>}
        </details>
        <div className="cos-block" data-testid="cos-schulden">
          <h3>④ Wer schuldet was {s.ueberfaellig > 0 && (l.zusagenDatei ? <a className="ub-amp u-bad" href={note(l.zusagenDatei)} title="Register der Zusagen öffnen" data-testid="cos-ueberfaellig">{s.ueberfaellig} überfällig</a> : <span className="ub-amp u-bad">{s.ueberfaellig} überfällig</span>)}</h3>
          <div className="cos-spalten">{spalte('Knut', s.knut, 'knut')}{spalte('Team', s.team, 'team')}{spalte('Partner', s.partner, 'partner')}</div>
          {s.klaeren.gesamt > 0 && <div className="cos-sp"><h4>Seite klären <span className="tiny mut">{s.klaeren.gesamt}</span></h4><ul>{s.klaeren.items.map((x: any, i: number) => <SchuldZeile key={x.id ?? `k${i}`} s={x} />)}</ul></div>}
          {s.rueckfragenAnKnut > 0 && <p className="tiny mut">{s.rueckfragenAnKnut} offene Rückfragen an dich stehen oben unter ①.</p>}
        </div>
        {(l.termine ?? []).length > 0 && <div className="cos-block" data-testid="cos-termine">
          <h3>Termine vorbereiten <span className="tiny mut">{l.termine.length}</span></h3>
          {l.termine.map((t: any, i: number) => <div key={i} className="cos-e" data-testid="cos-termin">
            <p className="small"><b>{t.wann === 'heute' ? 'Heute' : 'Morgen'}{t.zeit ? ` ${t.zeit}` : ''}: {t.link ? <a href={`#/wissen/${t.link}`}>{t.titel}</a> : t.titel}</b>{t.teilnehmer.length > 0 && <span className="tiny mut"> · mit {t.teilnehmer.join(', ')}</span>}</p>
            {t.schuldenAnKnut.length > 0 && <p className="tiny">Schulden dir: {t.schuldenAnKnut.map((z: any) => `${z.id} ${z.was}${z.ueberfaellig ? ' (überfällig)' : ''}`).join(' · ')}</p>}
            {t.knutSchuldet.length > 0 && <p className="tiny">Du schuldest: {t.knutSchuldet.map((z: any) => `${z.id} ${z.was}${z.ueberfaellig ? ' (überfällig)' : ''}`).join(' · ')}</p>}
            {t.letzteNotiz && <p className="tiny mut">Letzte Notiz der Serie: {t.letzteNotiz.titel} ({datumKurz(t.letzteNotiz.datum)}){t.letzteNotiz.offeneFragen.length > 0 ? ` — offen: ${t.letzteNotiz.offeneFragen.join('; ')}` : ''}{t.letzteNotiz.offeneAktionen > 0 ? ` · ${t.letzteNotiz.offeneAktionen} offene Action Items` : ''}</p>}
            <p className="tiny mut">Notetaker einladen: {t.notetaker}</p></div>)}
        </div>}
        <div className="cos-block" data-testid="cos-themen">
          <h3>⑤ Themen</h3>
          {l.themen.zeilen.items.length ? <ul>{l.themen.zeilen.items.map((t: any) => <li key={t.name} className="small"><b>{t.name}</b>: {t.stand || '–'} · Nächster Schritt: {t.naechster || '–'} · Ball bei <b>{t.ball || '–'}</b>
            {t.offeneZusagen > 0 && <span className="tiny mut"> · {t.offeneZusagen} Zusagen</span>}{t.straenge > 0 && <span className="tiny mut"> · {t.straenge} Unter-Chats</span>}</li>)}</ul> : <p className="small mut">{l.leer ? 'Noch keine Themen im Register.' : 'Alle Themen ruhig.'}</p>}
          {l.themen.ruhig > 0 && <p className="tiny mut">{l.themen.ruhig} weitere Themen ohne Bewegung.</p>}
        </div>
        <Nachmittag onChange={fertig} />
        {l.unlesbar.length > 0 && <p className="tiny mut" data-testid="cos-unlesbar">Nicht lesbar im Register ({l.unlesbar.length}): {l.unlesbar.slice(0, 3).map((u: any) => `Zeile ${u.zeile}`).join(', ')} — bleibt unverändert, bitte von Hand prüfen.</p>}
      </>}
    </section>
  );
}

/** Nachmittagskarte (S3.4): ab 15 Uhr der Tagesabschluss, freitags die Wochendurchsicht mit Rückstau — live berechnet; die Vault-Seiten schreibt der Takt. */
function Nachmittag({ onChange }: { onChange: () => void }) {
  const jetzt = new Date();
  const wien = new Intl.DateTimeFormat('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(jetzt);
  const h = Number(wien.find((p) => p.type === 'hour')?.value ?? 0), freitag = /^fr/i.test(wien.find((p) => p.type === 'weekday')?.value ?? '');
  const [a, setA] = useState<any>(null);
  const [w, setW] = useState<any>(null);
  const [wahl, setWahl] = useState<Record<string, boolean>>({});
  const [zurueck, setZurueck] = useState<any[]>([]);
  const [err, setErr] = useState<unknown>(null);
  const toast = useToast();
  const ladeW = () => api('/api/cos/woche').then((x) => { setW(x); setWahl(Object.fromEntries((x.rueckstauListe ?? []).map((i: any) => [i.datei, true]))); }).catch(setErr);
  useEffect(() => {
    if (h >= 15) api('/api/cos/abschluss').then(setA).catch(setErr);
    if (freitag && h >= 14) ladeW();
    api('/api/cos/rueckstau/zurueck').then((r) => setZurueck(r.moeglich ?? [])).catch(() => {});
  }, []);
  if (h < 15 && !(freitag && h >= 14) && !zurueck.length) return null;
  const archivieren = async () => {
    setErr(null);
    try {
      const dateien = (w.rueckstauListe as any[]).filter((i) => wahl[i.datei]).map((i) => i.datei);
      const hashes = Object.fromEntries((w.rueckstauListe as any[]).map((i) => [i.datei, i.hash]));
      const r = await api('/api/cos/rueckstau', { body: { dateien, confirm: true, hashes } });
      toast(`${r.archiviert.length} Entwürfe archiviert — rückgängig 7 Tage`); ladeW(); api('/api/cos/rueckstau/zurueck').then((x) => setZurueck(x.moeglich ?? [])).catch(() => {}); onChange();
    } catch (e) { setErr(e); }
  };
  const rueck = async (datei: string) => { try { await api('/api/cos/rueckstau/zurueck', { body: { datei } }); toast('Wieder auf Entwurf gesetzt'); setZurueck(zurueck.filter((z) => z.datei !== datei)); ladeW(); } catch (e) { setErr(e); } };
  return (
    <div className="cos-block" data-testid="cos-nachmittag">
      {a && h >= 15 && <div data-testid="cos-abschluss"><h3>Tagesabschluss</h3>
        <p className="small">Heute entschieden: <b>{a.entschieden.length}</b> · Zusagen erledigt <b>{a.erledigt.length}</b>, neu <b>{a.neu.length}</b>, überfällig <b>{a.ueberfaellig}</b> · läuft über Nacht: <b>{a.laeuft.length}</b></p>
        {a.morgen.length > 0 && <p className="small">Morgen fällig: {a.morgen.map((z: any) => `${z.id} ${z.was}`).join(' · ')}</p>}
        <p className="tiny mut">Um 17:30 entsteht dazu die Seite im Vault und setzt die Stichzeit für „über Nacht“.</p></div>}
      {w && <div data-testid="cos-woche"><h3>Wochendurchsicht</h3>
        <p className="small">Überfällig <b>{w.ueberfaellig.length}</b> · seit 14 Tagen unverändert <b>{w.unveraendert.length}</b> · nächste Woche fällig <b>{w.naechsteWoche.length}</b> · Themen ohne Bewegung <b>{w.themenRuhig.length}</b></p>
        {w.teuerste.length > 0 && <p className="tiny mut">Teuerste Unter-Chats: {w.teuerste.map((t: any) => `${t.titel} ${Math.round(t.tokens / 1000)}k`).join(' · ')}</p>}
        {w.rueckstauListe.length > 0 && <details data-testid="cos-rueckstau"><summary className="small">{w.rueckstauListe.length} ältere Meeting-Entwürfe ohne Action Items — sammelweise archivieren</summary>
          <ul className="cos-rs">{w.rueckstauListe.map((i: any) => <li key={i.datei}><label className="small"><input type="checkbox" checked={!!wahl[i.datei]} onChange={(e) => setWahl({ ...wahl, [i.datei]: e.target.checked })} /> {i.titel} <span className="tiny mut">({i.datum})</span></label></li>)}</ul>
          <button className="ub-btn pri sm" disabled={!Object.values(wahl).some(Boolean)} onClick={archivieren} data-testid="cos-rueckstau-ja">Ausgewählte archivieren (Status → archived)</button></details>}</div>}
      {zurueck.length > 0 && <p className="tiny mut" data-testid="cos-zurueck">Rückgängig möglich: {zurueck.slice(0, 5).map((z) => <span key={z.datei}>{z.datei.split('/').pop()} <button className="linklike" onClick={() => rueck(z.datei)}>zurück</button> </span>)}</p>}
      <Err e={err} />
    </div>
  );
}
