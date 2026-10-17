// Heute (Plan 213 S3) — die Startseite der neuen Navigation Heute · Arbeit · Wissen. Oben die Entscheide (eine Inbox für alle
// Fragen, Server: web/server/inbox.ts), darunter Blockiert/hängt und „Geändert seit gestern 18:00“. Eine gefüllte Primäraktion
// je Bereich (Council K12): der empfohlene Knopf ist nur in der obersten Zeile gefüllt. „Später“ = bis morgen 07:00.
// Beantwortet wird an der Quelle (dieselben Wege wie bisher); Push öffnet den bekannten Dialog mit dem gesehenen Stand.
// Der Chief of Staff (Paket 209) setzt hier seine Blöcke „Wer schuldet was“ und „Einwurf“ dazu (eine Startseite, 185 B1).
import { useState } from 'react';
import { api, fmtDateTime, chatTarget, type Config } from '../api.ts';
import { Err, Loading, useConfirm, useLoad, useToast } from '../ui.tsx';
import { usePushFreigeben } from '../freigabe.tsx';

const ABGEBROCHEN = Symbol('abgebrochen');
/** Nur Workspace-Adressen (#/…) und http(s) werden verlinkt — nie `javascript:` o. ä. (Pass C). */
const sicher = (u: string | null | undefined): string | null => (u && (/^https?:\/\//.test(u) || /^#\//.test(u)) ? u : null);

type Eintrag = { id: string; art: string; frage: string; empfehlung: string | null; quelle: { text: string; strand: string | null; url: string | null }; wartetSeit: string | null; blockiert: number; antworten: string[]; daten: any;
  stufe?: 'wichtig' | 'normal'; stufeGrund?: string; autoAb?: string | null };
type HeuteDaten = { eintraege: Eintrag[]; zahl: number; zurueckgestellt: number; blockiert: any[]; geaendert: any; at: string; admin: boolean };

const ART: Record<string, string> = { rueckfrage: 'Rückfrage', entscheidung: 'Entscheidung', braucht: 'Frage', push: 'Push', vault: 'Vault-Sync', pflege: 'Pflege', schlange: 'Schlange', altbestand: 'Altbestand' };
const ZUSTAND: Record<string, string> = { blockiert: 'blockiert', haengt: 'hängt?', schlange: 'in der Schlange', 'stand-fehlt': 'Stand fehlt' };

/** „seit 2 h“, „seit 3 Tagen“ */
export function seit(iso: string | null): string {
  if (!iso) return '';
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return min < 60 ? `seit ${min} min` : min < 48 * 60 ? `seit ${Math.round(min / 60)} h` : `seit ${Math.round(min / 1440)} Tagen`;
}

/** Eine Zeile der Inbox: Frage, Quelle, Wartezeit, Empfehlung — und die erlaubten Antworten. `erste` = gefüllte Primäraktion. */
export function InboxZeile({ e, erste, onDone }: { e: Eintrag; erste: boolean; onDone: () => void }) {
  const toast = useToast();
  const pushFreigeben = usePushFreigeben();
  const [anders, setAnders] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [auf, setAuf] = useState(false);
  const confirm = useConfirm();
  const run = async (fn: () => Promise<unknown>, meldung: string) => {
    setBusy(true); setErr(null);
    try { if ((await fn()) !== ABGEBROCHEN) { toast(meldung); onDone(); } }
    catch (x: any) { if (x?.status === 409) { onDone(); toast(x?.message ?? 'Schon beantwortet oder geändert — neu geladen'); } else setErr(x); }
    finally { setBusy(false); }
  };
  const antworten = (antwort: string, text = '') => run(() => api(`/api/inbox/${e.id}/antwort`, { body: { antwort, text, weg: 'ui' } }), 'Eingetragen — an der Quelle beantwortet');
  const spaeter = () => run(() => api(`/api/inbox/${e.id}/spaeter`, { method: 'POST', body: {} }), 'Zurückgestellt bis morgen 07:00');
  const vault = (antwort: 'ja' | 'nein') => run(() => api('/api/roadmap/question', { body: { id: e.daten.vaultId, answer: antwort } }), 'Für den Vault-Sync eingetragen');
  const pri = erste ? 'ub-btn pri sm' : 'ub-btn sm';
  const mehrere = e.art === 'entscheidung' && (e.daten.entscheidungen?.length ?? 0) > 1;
  return (
    <div className="h-zeile" data-testid="inbox-zeile" data-art={e.art} data-id={e.id}>
      <div className="h-text">
        <div className="h-frage">{e.frage}</div>
        <div className="tiny mut">
          {e.stufe === 'wichtig' && <><span className="chip warn" title={e.stufeGrund ?? ''} data-testid="stufe-wichtig">wichtig</span>{' '}</>}
          <span className={`chip${e.blockiert ? ' bad' : ''}`}>{ART[e.art] ?? e.art}</span>{' '}
          {e.blockiert > 0 && <span className="chip bad">blockiert {e.blockiert}</span>}{' '}
          {sicher(e.quelle.url)?.startsWith('http') ? <a href={sicher(e.quelle.url)!} target={chatTarget} rel="noreferrer">{e.quelle.text}</a> : sicher(e.quelle.url) ? <a href={sicher(e.quelle.url)!}>{e.quelle.text}</a> : e.quelle.text}
          {e.wartetSeit ? ` · wartet ${seit(e.wartetSeit)}` : ''}
        </div>
        {e.empfehlung && <div className="tiny">Empfehlung: <b>{e.empfehlung}</b>{e.autoAb && <span className="mut" data-testid="auto-ab"> · gilt {new Date(e.autoAb).getTime() <= Date.now() ? 'gleich' : `ab ${fmtDateTime(e.autoAb)}`} als angenommen{e.art === 'entscheidung' && (e.daten.autoIds?.length ?? 0) < (e.daten.entscheidungen?.length ?? 0) ? ` (${e.daten.autoIds.join(', ')})` : ''}</span>}</div>}
        {e.art === 'altbestand' && auf && <ul className="tiny h-liste">{(e.daten.eintraege ?? []).map((x: Eintrag) => <li key={x.id}>{x.frage} <span className="mut">({ART[x.art]}, {seit(x.wartetSeit)})</span></li>)}</ul>}
        {e.art === 'pflege' && e.daten.berichte && <ul className="tiny h-liste">{e.daten.berichte.map((b: any) => <li key={b.id}><a href={`#/leitstand?bericht=${b.id}`}>{b.titel}</a></li>)}</ul>}
        {anders !== null && <div className="ub-anders">
          <textarea rows={2} value={anders} placeholder="Deine Antwort" aria-label="Deine Antwort" onChange={(x) => setAnders(x.target.value)} />
          <div className="ub-row"><button className="ub-btn pri sm" disabled={busy || !anders.trim()} onClick={() => antworten('anders', anders)}>Senden</button><button className="ub-btn ghost sm" onClick={() => setAnders(null)}>Abbrechen</button></div>
        </div>}
        <Err e={err} />
      </div>
      <div className="ub-row h-acts">
        {e.art === 'push' && e.daten.strand && <button className={pri} disabled={busy} onClick={() => run(async () => ((await pushFreigeben(e.daten.strand)) ? null : ABGEBROCHEN), 'Freigegeben — der Hauptchat pusht nach seiner Prüfung')}>Freigeben …</button>}
        {mehrere && <><button className={pri} disabled={busy} onClick={() => antworten('ja')}>Alle Empfehlungen</button><a className="ub-btn sm" href={`#/leitstand?bericht=${e.daten.strand}`}>Einzeln</a></>}
        {e.art === 'vault' && e.daten.vaultId !== 'entwurf' && <><button className={pri} disabled={busy} onClick={() => vault('ja')}>Ja</button><button className="ub-btn sm" disabled={busy} onClick={() => vault('nein')}>Nein</button></>}
        {['rueckfrage', 'braucht'].includes(e.art) || (e.art === 'entscheidung' && !mehrere) ? <>
          <button className={pri} disabled={busy} onClick={() => antworten('ja')} title={e.empfehlung ? `Empfehlung übernehmen: ${e.empfehlung}` : 'Ja'}>Ja</button>
          <button className="ub-btn sm" disabled={busy} onClick={() => antworten('nein')}>Nein</button>
          <button className="ub-btn ghost sm" disabled={busy} aria-expanded={anders !== null} onClick={() => setAnders(anders === null ? '' : null)}>Anders …</button>
        </> : null}
        {e.art === 'altbestand' && <><button className={pri} disabled={busy} onClick={async () => {
          if (await confirm({ title: 'Altbestand verwerfen?', confirmLabel: 'Alle verwerfen', body: <p className="small">{(e.daten.eintraege ?? []).length} Fragen, älter als 14 Tage. Rückfragen werden zurückgezogen, alles andere ist 30 Tage zurückgestellt.</p> })) await antworten('nein');
        }}>Alle verwerfen</button><button className="ub-btn sm" aria-expanded={auf} onClick={() => setAuf(!auf)}>Durchsehen</button></>}
        {(e.art === 'pflege' || e.art === 'schlange' || (e.art === 'vault' && e.daten.vaultId === 'entwurf')) && sicher(e.quelle.url) && <a className="ub-btn sm" href={sicher(e.quelle.url)!}>Ansehen</a>}
        {e.antworten.includes('spaeter') && <button className="ub-btn ghost sm" disabled={busy} onClick={spaeter}>Später</button>}
      </div>
    </div>
  );
}

export function InboxListe({ eintraege, max, onDone }: { eintraege: Eintrag[]; max?: number; onDone: () => void }) {
  const zeige = max ? eintraege.slice(0, max) : eintraege;
  if (!zeige.length) return <div className="ub-card soft"><p className="small mut">Nichts wartet auf dich.</p></div>;
  return <div className="ub-card h-inbox">{zeige.map((e, i) => <InboxZeile key={e.id} e={e} erste={i === 0} onDone={onDone} />)}</div>;
}

export function HeuteNeu({ cfg }: { cfg: Config }) {
  const { data, error, reload } = useLoad<HeuteDaten>(() => api('/api/heute'), []);
  if (error) return <div className="page"><Err e={error} /></div>;
  if (!data) return <div className="page"><Loading /></div>;
  const vorname = (cfg.user?.name ?? '').trim().split(/\s+/)[0];
  const tag = new Date().toLocaleDateString('de-AT', { weekday: 'long', day: '2-digit', month: '2-digit' });
  const blk = data.blockiert.filter((b) => b.zustand === 'blockiert' || b.zustand === 'haengt').length;
  return (
    <div className="page wide h-seite" data-testid="heute-neu">
      <div className="h-kopf">
        <div>
          <h1>{new Date().getHours() < 11 ? 'Guten Morgen' : 'Hallo'}{vorname ? `, ${vorname}` : ''}</h1>
          <p className="small mut">{tag} · Stand {fmtDateTime(data.at).split(', ').pop()} · {data.zahl} {data.zahl === 1 ? 'Entscheidung' : 'Entscheidungen'}{blk ? `, ${blk} blockiert/hängt` : ''} · <button className="linkbtn" onClick={reload}>neu laden</button></p>
        </div>
      </div>
      <section aria-labelledby="h-entscheide">
        <h2 id="h-entscheide" className="h-titel">Entscheide <span className="mut small">{data.zahl}{data.zurueckgestellt ? ` · ${data.zurueckgestellt} später` : ''}</span>
          {data.eintraege.length > 7 && <a className="small" href="#/inbox">alle {data.eintraege.length} →</a>}</h2>
        <InboxListe eintraege={data.eintraege} max={7} onDone={reload} />
      </section>
      {data.admin && <div className="h-zwei">
        <section aria-labelledby="h-blk"><h2 id="h-blk" className="h-titel">Blockiert / hängt</h2>
          <div className="ub-card">{data.blockiert.length ? <ul className="plain h-liste">{data.blockiert.map((b) => <li key={b.id}>
            <span className={`chip${b.zustand === 'blockiert' ? ' bad' : ' warn'}`}>{ZUSTAND[b.zustand] ?? b.zustand}</span> {b.titel}
            {b.grund ? <span className="tiny mut"> — {b.grund}</span> : null} {sicher(b.chat) && <a className="tiny" href={sicher(b.chat)!} target={chatTarget} rel="noreferrer">Chat</a>}</li>)}</ul>
            : <p className="small mut">Nichts blockiert.</p>}</div></section>
        <section aria-labelledby="h-neu"><h2 id="h-neu" className="h-titel">Geändert seit gestern 18:00</h2>
          <div className="ub-card"><ul className="plain h-liste">
            <li>{data.geaendert?.fertig ?? 0} Unter-Chats fertig · {data.geaendert?.gepusht ?? 0} gepusht <a className="tiny" href="#/arbeit">ansehen</a></li>
            {(data.geaendert?.weggeraeumt ?? 0) > 0 && <li>{data.geaendert.weggeraeumt} automatisch weggeräumt <a className="tiny" href="#/arbeit">ansehen</a></li>}
            <li>{data.geaendert?.prMeldungen ?? 0} Meldungen an PRs <a className="tiny" href="#/arbeit/reviews">ansehen</a></li>
          </ul></div></section>
      </div>}
    </div>
  );
}

export function InboxSeite() {
  const { data, error, reload } = useLoad<HeuteDaten>(() => api('/api/inbox'), []);
  const [art, setArt] = useState<string>('');
  if (error) return <div className="page"><Err e={error} /></div>;
  if (!data) return <div className="page"><Loading /></div>;
  const arten = [...new Set(data.eintraege.map((e) => e.art))];
  const liste = art ? data.eintraege.filter((e) => e.art === art) : data.eintraege;
  return (
    <div className="page wide h-seite" data-testid="inbox-seite">
      <h1>Entscheide</h1>
      <p className="small mut">Alles, was auf dich wartet — aus Unter-Chats, Berichten, Hauptchat, Vault-Sync und Pflege. Eine Quelle: was hier oder im Chat beantwortet ist, verschwindet überall.</p>
      <nav className="tabs" role="tablist" aria-label="Arten">
        <a role="tab" aria-selected={!art} className={!art ? 'active' : ''} href="#/inbox" onClick={(x) => { x.preventDefault(); setArt(''); }}>Alle {data.eintraege.length}</a>
        {arten.map((a) => <a key={a} role="tab" aria-selected={art === a} className={art === a ? 'active' : ''} href="#/inbox" onClick={(x) => { x.preventDefault(); setArt(a); }}>{ART[a] ?? a} {data.eintraege.filter((e) => e.art === a).length}</a>)}
      </nav>
      <InboxListe eintraege={liste} onDone={reload} />
      <EntscheidungsLog />
    </div>
  );
}

type LogZeile = { id: string; art: string; ids: string[]; frage: string; empfehlung: string | null; stufe: string | null; grund: string | null; antwort: string; durch: 'auto' | 'knut'; at: string;
  strand: { id: string; titel: string } | null; widerruf: { at: string; text: string } | null; widerrufbar: boolean; widerrufGrund: string | null };

/** Entscheidungs-Log (Knut 17.10.): was du beantwortet hast und was nach 24 h automatisch angenommen wurde — filterbar,
 *  automatische Annahmen mit „Anders …“ widerrufbar, solange nichts darauf gebaut wurde. */
export function EntscheidungsLog() {
  const [durch, setDurch] = useState('');
  const [stufe, setStufe] = useState('');
  const { data, error, reload } = useLoad<{ zeilen: LogZeile[]; autoAnnahme: boolean; stunden: number }>(() => api(`/api/entscheidungen?tage=30${durch ? `&durch=${durch}` : ''}${stufe ? `&stufe=${stufe}` : ''}`), [durch, stufe]);
  const toast = useToast();
  const [offen, setOffen] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const widerrufen = async (id: string) => {
    setErr(null);
    try { await api(`/api/entscheidungen/${encodeURIComponent(id)}/anders`, { body: { text } }); toast('Widerrufen — der Unter-Chat bekommt die Korrektur'); setOffen(null); setText(''); reload(); }
    catch (x) { setErr(x); }
  };
  const knopf = (wert: string, akt: string, set: (v: string) => void, label: string) => <button className={`ub-btn sm${akt === wert ? ' pri' : ' ghost'}`} aria-pressed={akt === wert} onClick={() => set(wert)}>{label}</button>;
  return (
    <section aria-labelledby="h-log" data-testid="entscheidungs-log">
      <h2 id="h-log" className="h-titel">Entscheidungs-Log <span className="mut small">30 Tage{data && !data.autoAnnahme ? ' · automatische Annahme ist aus' : ''}</span></h2>
      <div className="ub-row">{knopf('', durch, setDurch, 'Alle')}{knopf('auto', durch, setDurch, 'Automatisch')}{knopf('knut', durch, setDurch, 'Von dir')}
        <span className="mut small"> · </span>{knopf('', stufe, setStufe, 'Jede Stufe')}{knopf('wichtig', stufe, setStufe, 'Wichtig')}{knopf('normal', stufe, setStufe, 'Normal')}</div>
      <Err e={error ?? err} />
      {!data ? <Loading /> : !data.zeilen.length ? <div className="ub-card soft"><p className="small mut">Noch nichts im Log.</p></div> :
        <div className="ub-card"><ul className="plain h-liste">{data.zeilen.map((z) => <li key={z.id} data-testid="log-zeile" data-durch={z.durch}>
          <span className={`chip${z.durch === 'auto' ? ' warn' : ''}`}>{z.durch === 'auto' ? 'nach 24 h angenommen' : 'von dir'}</span>{' '}
          {z.stufe === 'wichtig' && <><span className="chip warn">wichtig</span>{' '}</>}
          <b>{z.frage}</b> <span className="tiny mut">· {fmtDateTime(z.at)}{z.strand ? ` · ${z.strand.titel}` : ''}</span>
          <div className="tiny">{z.antwort}{z.widerruf ? <span className="mut"> — widerrufen: {z.widerruf.text}</span> : null}</div>
          {z.durch === 'auto' && !z.widerruf && (z.widerrufbar
            ? (offen === z.id ? <div className="ub-anders"><textarea rows={2} value={text} placeholder="Was soll stattdessen gelten?" aria-label="Was soll stattdessen gelten?" onChange={(x) => setText(x.target.value)} />
                <div className="ub-row"><button className="ub-btn pri sm" disabled={!text.trim()} onClick={() => widerrufen(z.id)}>Widerrufen</button><button className="ub-btn ghost sm" onClick={() => setOffen(null)}>Abbrechen</button></div></div>
              : <button className="ub-btn ghost sm" onClick={() => { setOffen(z.id); setText(''); }}>Anders …</button>)
            : <div className="tiny mut">{z.widerrufGrund}</div>)}
        </li>)}</ul></div>}
    </section>
  );
}
