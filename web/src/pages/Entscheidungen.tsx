// Entscheidungen (Knut 19.10.: „Die Entscheidungsseite, wie du sie mir jetzt gibst, finde ich toll … das brauchen wir im Workspace“).
// Muster ~/work/knut/entscheidungen-site, so übernommen: eine Seite, alle offenen Fragen nach Thema gruppiert, Fortschritt
// „x von y beantwortet“, Filter „nur offene“; je Frage Worum es geht · Optionen · Empfehlung (farbig); Ja (wie empfohlen) · Nein ·
// Anders · Später + Notiz („Anders“ verlangt eine Notiz); Knut 20.10.: je Alternative ein Knopf zwischen Ja und Nein — ein Klick
// = „Anders: <Alternative>“, Notiz optional; „Anders (frei)“ verlangt weiter eine Notiz; „Alle offenen wie empfohlen beantworten“ mit Sicherheitsabfrage.
// Die Antwort geht an die Quelle (Rückfrage, Bericht, Strang) — ein Unter-Chat arbeitet weiter, sobald alle seine Fragen beantwortet sind.
import { useState } from 'react';
import { api, fmtDateTime } from '../api.ts';
import { Err, Loading, useLoad, useToast } from '../ui.tsx';
import { InboxZeile, EntscheidungsLog, seit } from './HeuteNeu.tsx';
import { usePushFreigeben } from '../freigabe.tsx';
import { EntscheidZeile } from './Morgenlage.tsx';
import { altText } from '../alternativen.ts';
import { WasIstDas } from '../nachfrage.tsx';

export type Frage = { form?: 'janein' | 'wahl' | 'frei'; zeigWichtig?: boolean; wichtigGrund?: string | null; id: string; worumKurz?: string; eintrag: string; teil: string | null; art: string; gruppe: string; kennung: string | null; titel: string; worum: string; optionen: string[]; alternativen?: string[];
  empfehlung: string | null; stufe: 'wichtig' | 'normal'; stufeGrund: string | null; autoAb: string | null; blockiert: number; quelle: { text: string; url: string | null }; wartetSeit: string | null; antworten: string[]; ref: string | null; klasse?: 'aktion' | 'entscheidung' | null;
  nurKnut?: string | null; sql?: string | null; hauptchat?: string | null };
type Summe = { gesamt: number; heute: number; offen: number; sonstiges: number; beimHauptchat: number; text: string };
type Daten = { fang?: { id: string; grund: string }[]; fragen: Frage[]; sonstiges: any[]; beantwortetHeute: number; zurueckgestellt: number; zahl: number; summe?: Summe; at: string };

const L: Record<string, string> = { ja: 'Ja (wie empfohlen)', nein: 'Nein', anders: 'Anders', spaeter: 'Später' };
/** R32: Beschriftung des „Ja“-Knopfs — bei Ja/Nein-Fragen „Ja“, sonst die Empfehlung selbst („Funktionspostfach übernehmen“). */
export const jaLabel = (f: Pick<Frage, 'form' | 'empfehlung'>) => (f.form && f.form !== 'janein' && f.empfehlung ? `Empfehlung übernehmen: ${f.empfehlung.length > 48 ? f.empfehlung.slice(0, 47) + '…' : f.empfehlung}` : f.empfehlung ? L.ja : 'Ja');
const sicher = (u: string | null | undefined) => (u && (/^https?:\/\//.test(u) || /^#\//.test(u)) ? u : null);

/** Nachbesserung 02.11.: warum eine „Braucht dich“-Zeile nur Knut betrifft, und wo eine (b)-Aufgabe beim Hauptchat steht. */
const NUR_KNUT: Record<string, string> = { datenbank: 'Abfrage auf einer Datenbank', zugang: 'Zugang oder Zugangsdaten', geld: 'es geht um Geld', recht: 'Recht oder Verträge', extern: 'braucht eine andere Person', entscheidung: 'offene Entscheidung' };
const ZUSTELLUNG: Record<string, string> = { zugestellt: 'hat die Aufgabe bekommen', gemeldet: 'liegt in seiner Warteschlange', 'kein-hauptchat': 'kein Hauptchat aktiv — der nächste bekommt sie', fehlgeschlagen: 'Meldung fehlgeschlagen — frag ihn direkt' };

function SqlKopieren({ sql }: { sql: string }) {
  const toast = useToast();
  const kopieren = async () => { try { await navigator.clipboard.writeText(sql); toast('SQL kopiert'); } catch { toast('Kopieren ging nicht — bitte markieren'); } };
  return <details className="tiny" data-testid="e-sql" open><summary>SQL zum Weitergeben</summary>
    <pre className="small" style={{ whiteSpace: 'pre-wrap', overflowX: 'auto' }}>{sql}</pre>
    <button className="ub-btn sm" onClick={kopieren} data-testid="e-sql-kopieren">SQL kopieren</button></details>;
}

export type Info = { text?: string; ziel?: string };

/** Antwort abschicken — für die Frage-Karte und „Fang hier an“ dieselbe Logik: Push öffnet den Freigabe-Dialog, Vault-Sync-Ja/Nein den Vault-Weg,
 *  alles andere die Entscheidungsroute. Gibt zurück, ob es geklappt hat; `onDone` bekommt Status, Text und das Ziel („den Strang „X““). */
export function useAntwort(f: Frage, onDone: (id: string, status: string, info?: Info) => void) {
  const toast = useToast();
  const pushFreigeben = usePushFreigeben();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [out, setOut] = useState('');
  const senden = async (wahl: string, alt: string | null, notiz: string): Promise<boolean> => {
    setErr(null); setBusy(true); setOut('Sendet …');
    try {
      let r: any = null;
      if (f.art === 'push' && wahl === 'ja') { if (!(await pushFreigeben(String(f.ref ?? '')))) { setOut(''); return false; } }
      else if (f.art === 'vault' && (wahl === 'ja' || wahl === 'nein')) r = await api('/api/roadmap/question', { body: { id: f.ref, answer: wahl } });
      else r = await api('/api/entscheidungen/fragen/antwort', { body: { id: f.id, antwort: wahl, text: wahl === 'anders' && alt ? altText(alt, notiz) : notiz.trim() } });
      const ziel: string | undefined = r?.ziel;
      toast(wahl === 'spaeter' ? 'Zurückgestellt bis morgen 07:00' : ziel ? `Gespeichert — an ${ziel} geschickt` : 'Gespeichert — an der Quelle eingetragen');
      onDone(f.id, wahl === 'anders' && alt ? `Anders: ${alt}` : wahl, { text: notiz.trim() || undefined, ziel });
      return true;
    } catch (x: any) { setOut(''); if (x?.status === 409) { toast(x.message); onDone(f.id, ''); } else setErr(x); return false; }
    finally { setBusy(false); }
  };
  return { senden, busy, err, out, setOut };
}

/** Eine Frage-Karte; `kurz`: nur „Worum“ in einem Satz (Karte am Chat), der ganze Text hinter „mehr“. */
export function Karte({ f, onDone, kurz = false }: { f: Frage; onDone: (id: string, status: string, info?: Info) => void; kurz?: boolean }) {
  const [wahl0, setWahl] = useState<string | null>(null);
  const wahl = wahl0;
  const [alt, setAlt] = useState<string | null>(null);
  const [notiz, setNotiz] = useState('');
  const alts = f.antworten.includes('anders') ? f.alternativen ?? [] : [];
  const { senden, busy, err, out, setOut } = useAntwort(f, onDone);
  const speichern = async () => {
    // R32 (Nachtrag A): steht Text im Feld und ist kein Knopf gewählt, ist der Text die Antwort („Anders“) — Enter oder „Senden“ genügt.
    const gewaehlt = wahl0 ?? (notiz.trim() ? 'anders' : null);
    if (!gewaehlt) { setOut('Bitte eine Antwort wählen — oder deinen Text ins Feld schreiben.'); return; }
    if (gewaehlt === 'anders' && !alt && !notiz.trim()) { setOut('Bitte kurz schreiben, was stattdessen.'); return; }
    await senden(gewaehlt, alt, notiz);
  };
  return (
    <article className={`e-karte${f.stufe === 'wichtig' && f.klasse !== 'aktion' ? ' e-wichtig' : ''}`} data-testid="e-karte" data-id={f.id} data-klasse={f.klasse ?? ''}>
      <div className="e-top">{f.kennung && <span className="e-id">{f.kennung}</span>}<span className="e-ttl">{f.titel}</span>
        {f.klasse === 'aktion' ? <span className="chip">beim Hauptchat</span>
          : f.zeigWichtig ? <span className="chip warn" title={`Regel: ${f.stufeGrund ?? ''}`}>wichtig</span> : <span className="chip" title={f.stufe === 'wichtig' ? `Regel: ${f.stufeGrund ?? ''} — nichts hängt davon ab` : undefined}>offen</span>}</div>
      {f.zeigWichtig && f.wichtigGrund && <div className="tiny mut" data-testid="wichtig-grund">Wichtig, weil: {f.wichtigGrund}</div>}
      {f.klasse === 'entscheidung' && <div className="tiny mut" data-testid="was-tun">{f.nurKnut && f.nurKnut !== 'entscheidung' && NUR_KNUT[f.nurKnut]
        ? <><b>Nur du:</b> {NUR_KNUT[f.nurKnut]}. Antwort über „Anders“ mit Notiz (Ergebnis oder wer es übernimmt) — sie geht an den Unter-Chat.</>
        : 'Was du tun musst: die Frage oben beantworten.'}</div>}
      {f.sql && <SqlKopieren sql={f.sql} />}
      {f.klasse === 'aktion' && <div className="tiny" data-testid="hauptchat-aufgabe"><span className="chip ok">nichts für dich</span> Erledigt der Hauptchat ({ZUSTELLUNG[f.hauptchat ?? ''] ?? `Stand unklar: ${f.hauptchat ?? 'unbekannt'}`}). „Anders“ nur, wenn es doch etwas für dich ist.</div>}
      <div><div className="e-lbl">Worum es geht</div>{kurz && f.worumKurz ? <>{f.worumKurz}{f.worum !== f.worumKurz && <details className="tiny"><summary>mehr</summary>{f.worum}</details>}</> : f.worum}</div>
      {f.optionen.length > 0 && <div><div className="e-lbl">Optionen</div><ul>{f.optionen.map((o) => <li key={o}>{o}</li>)}</ul></div>}
      {f.empfehlung && <div className="e-rec"><div className="e-lbl">Empfehlung</div>{f.empfehlung}
        {f.autoAb && <div className="tiny mut" data-testid="e-auto-ab">gilt {new Date(f.autoAb).getTime() <= Date.now() ? 'gleich' : `ab ${fmtDateTime(f.autoAb)}`} als angenommen, wenn du bis dahin da warst</div>}</div>}
      <div className="tiny mut">{sicher(f.quelle.url) ? <a href={sicher(f.quelle.url)!}>{f.quelle.text}</a> : f.quelle.text}{f.wartetSeit ? ` · wartet ${seit(f.wartetSeit)}` : ''}</div>
      {/* Reihenfolge: Ja (wie empfohlen) · je Alternative ein Knopf · Nein · Später · Anders (frei). */}
      <div className="e-btns" role="group" aria-label="Antwort">
        {f.antworten.includes('ja') && <button data-v="ja" aria-pressed={wahl === 'ja'} disabled={busy} title={f.empfehlung ? `Empfehlung: ${f.empfehlung}` : undefined} onClick={() => { setWahl('ja'); setAlt(null); setOut(''); }}>{jaLabel(f)}</button>}
        {alts.map((a) => <button key={`alt:${a}`} data-v="anders" data-alt={a} className="e-alt" data-testid="e-alt" aria-pressed={wahl === 'anders' && alt === a} disabled={busy}
          onClick={() => { setWahl('anders'); setAlt(a); setOut(''); }}>{a}</button>)}
        {(['nein', 'spaeter', 'anders'] as const).filter((v) => f.antworten.includes(v) && !(v === 'anders' && f.form === 'frei')).map((v) => (
          <button key={v} data-v={v} aria-pressed={wahl === v && !alt} disabled={busy} onClick={() => { setWahl(v); setAlt(null); setOut(''); }}>{v === 'anders' && alts.length ? 'Anders (frei)' : L[v]}</button>))}
      </div>
      <textarea rows={2} value={notiz} onChange={(e) => setNotiz(e.target.value)} data-testid="e-text"
        onKeyDown={(ev) => { if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) { ev.preventDefault(); void speichern(); } }}
        placeholder={f.form === 'frei' ? 'Deine Antwort — Enter sendet' : 'Eigene Antwort schreiben (Enter sendet) — oder oben einen Knopf wählen, der Text geht dann als Notiz mit'} aria-label={f.form === 'frei' ? 'Deine Antwort' : 'Eigene Antwort oder Notiz'} />
      {!f.empfehlung && f.art !== 'push' && f.klasse !== 'aktion' && <div className="tiny mut" data-testid="keine-empfehlung">Keine Empfehlung — du entscheidest.</div>}
      <div className="ub-row"><button className="ub-btn pri sm" disabled={busy} onClick={speichern} data-testid="e-speichern">{wahl0 || !notiz.trim() ? 'Senden' : 'Eigene Antwort senden'}</button><WasIstDas art="frage" id={f.id} /><span className="tiny mut">{out}</span></div>
      <Err e={err} />
    </article>
  );
}

/** Erster Satz (bis 220 Zeichen) — „Worum es geht“ in einer Zeile für die kurze Karte. */
const ersterSatz = (t: string) => { const x = (t ?? '').replace(/\s+/g, ' ').trim(); const m = /^(.{20,220}?[.!?])(\s|$)/.exec(x); return m ? m[1] : x.length > 220 ? `${x.slice(0, 219)}…` : x; };

/** „Fang hier an“ (R32, Nachtrag B): kurze Karte mit Grund, Empfehlung und Ein-Klick-Antworten. Der Hauptknopf sendet sofort („wie empfohlen“);
 *  bei Wahlfragen ist jede Option ein Knopf; eigener Text geht mit Enter. Nach dem Senden steht die Bestätigung (an wen geschickt) da. */
export function FangKarte({ f, grund, onDone }: { f: Frage; grund: string; onDone: (id: string, status: string, info?: Info) => void }) {
  const [text, setText] = useState('');
  const [fertig, setFertig] = useState<{ status: string; info?: Info } | null>(null);
  const { senden, busy, err } = useAntwort(f, (id, status, info) => { if (status) setFertig({ status, info }); onDone(id, status, info); });
  if (fertig) return <article className="e-karte e-fang e-erledigt" data-testid="fang-erledigt"><p className="small">✓ {f.kennung ? `${f.kennung}: ` : ''}{f.titel} — {L[fertig.status] ?? fertig.status}{fertig.info?.text ? `: „${fertig.info.text}“` : ''}{fertig.info?.ziel ? ` · an ${fertig.info.ziel} geschickt` : ''}</p></article>;
  const ja = f.antworten.includes('ja'), nein = f.antworten.includes('nein'), spaeter = f.antworten.includes('spaeter');
  const wahlKnoepfe = f.antworten.includes('anders') && f.form === 'wahl' ? f.alternativen ?? [] : [];
  const eigene = async () => { if (text.trim()) await senden('anders', null, text); };
  return (
    <article className="e-karte e-fang" data-testid="fang-karte" data-id={f.id}>
      <div className="e-top">{f.kennung && <span className="e-id">{f.kennung}</span>}<span className="e-ttl">{f.titel}</span><span className="chip warn" data-testid="fang-grund">{grund}</span></div>
      {ersterSatz(f.worum) && <div className="small" data-testid="fang-worum">{ersterSatz(f.worum)}</div>}
      {f.empfehlung ? <div className="e-rec" data-testid="fang-empfehlung"><div className="e-lbl">Empfehlung</div>{f.empfehlung}</div> : <div className="tiny mut" data-testid="keine-empfehlung">Keine Empfehlung — du entscheidest.</div>}
      <div className="e-btns" role="group" aria-label="Antwort">
        {ja && <button className="pri" data-v="ja" disabled={busy} data-testid="fang-empfohlen" title={f.empfehlung ? `Empfehlung übernehmen: ${f.empfehlung}` : undefined} onClick={() => senden('ja', null, text)}>{f.art === 'push' ? 'Freigeben …' : f.empfehlung ? `✓ Wie empfohlen${f.form && f.form !== 'janein' ? `: ${f.empfehlung.length > 36 ? f.empfehlung.slice(0, 35) + '…' : f.empfehlung}` : ''}` : 'Ja'}</button>}
        {wahlKnoepfe.map((a) => <button key={a} data-v="anders" data-alt={a} className="e-alt" data-testid="fang-alt" disabled={busy} onClick={() => senden('anders', a, text)}>{a}</button>)}
        {nein && <button data-v="nein" disabled={busy} data-testid="fang-nein" onClick={() => senden('nein', null, text)}>Nein</button>}
        {spaeter && <button data-v="spaeter" disabled={busy} onClick={() => senden('spaeter', null, '')}>Später</button>}
        <WasIstDas art="frage" id={f.id} aktionen={[...(ja ? [{ label: f.empfehlung ? `So entscheiden: ${f.empfehlung.length > 40 ? f.empfehlung.slice(0, 39) + '…' : f.empfehlung}` : 'Ja', pri: true, onClick: () => { void senden('ja', null, text); } }] : []), ...wahlKnoepfe.map((a) => ({ label: a, onClick: () => { void senden('anders', a, text); } })), ...(nein ? [{ label: 'Nein', onClick: () => { void senden('nein', null, text); } }] : [])]} />
      </div>
      {f.antworten.includes('anders') && <div className="ub-row">
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} data-testid="fang-text" aria-label="Anders: eigene Antwort"
          onKeyDown={(ev) => { if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing) { ev.preventDefault(); void eigene(); } }}
          placeholder="Anders entscheiden: deine Antwort schreiben — Enter sendet" />
        <button className="ub-btn pri sm" disabled={busy || !text.trim()} onClick={eigene} data-testid="fang-senden">Senden</button>
      </div>}
      <Err e={err} />
    </article>
  );
}

export function Entscheidungen() {
  const { data, error, reload } = useLoad<Daten>(() => api('/api/entscheidungen/fragen'), []);
  const toast = useToast();
  const [nurOffen, setNurOffen] = useState(false);   // R32: eine beantwortete Karte bleibt als „✓ …“-Zeile stehen (Bestätigung), bis man sie ausblendet
  const [gruppe, setGruppe] = useState('');
  const [erledigt, setErledigt] = useState<Record<string, string>>({});
  const [bestaetigt, setBestaetigt] = useState<Record<string, Info>>({});
  const [sicher2, setSicher2] = useState(false);
  const [bulk, setBulk] = useState('');
  const [gruppeSicher, setGruppeSicher] = useState('');
  if (error) return <div className="page"><Err e={error} /></div>;
  if (!data) return <div className="page"><Loading /></div>;
  const neu = Object.keys(erledigt).length;
  // Dieselbe Zahl wie Leiste, Kopf und Morgenlage ①: `zahl` (jede Frage zählt einzeln, Sonstiges je ein Eintrag).
  const offen = Math.max(0, data.zahl - neu);
  const gesamt = data.zahl + data.beantwortetHeute;
  const fertig = data.beantwortetHeute + neu;
  const gruppen = [...new Set(data.fragen.map((f) => f.gruppe))];
  const aktionen = data.fragen.filter((f) => f.klasse === 'aktion');   // Aufgaben des Hauptchats: zählen nicht mit, eigener Abschnitt
  const fangIds = new Map((data.fang ?? []).map((x) => [x.id, x.grund]));
  const fangListe = (data.fang ?? []).map((x) => ({ f: data.fragen.find((y) => y.id === x.id)!, grund: x.grund })).filter((x) => x.f && (!nurOffen || !erledigt[x.f.id] || bestaetigt[x.f.id]));
  const sichtbar = data.fragen.filter((f) => f.klasse !== 'aktion' && !fangIds.has(f.id) && (!gruppe || f.gruppe === gruppe) && (!nurOffen || !erledigt[f.id]));
  const offeneEmpf = [...fangListe.map((x) => x.f), ...sichtbar].filter((f) => !erledigt[f.id] && f.empfehlung && f.art !== 'push' && f.art !== 'vault' && f.antworten.includes('ja'));
  const fertigMelden = (id: string, status: string, info?: Info) => { if (status) { setErledigt((x) => ({ ...x, [id]: status })); setBestaetigt((x) => ({ ...x, [id]: info ?? {} })); } else reload(); };
  /** Wie empfohlen beantworten (die Sicherheitsabfrage liegt am jeweiligen Knopf: Kopf = zweiter Klick, Thema = zweiter Klick). */
  const sendeEmpfohlen = async (ids: string[]) => {
    if (!ids.length) { setBulk('Nichts mehr offen, das eine Empfehlung hat.'); return; }
    setBulk('Speichert …');
    try {
      const r: any = await api('/api/entscheidungen/fragen/alle', { body: { ids } });
      setBulk(`${r.ok} Fragen wie empfohlen gespeichert.${r.fehler.length ? ` Nicht gespeichert: ${r.fehler.join(' · ')}` : ''}`);
      toast('Wie empfohlen beantwortet'); setErledigt({}); reload();
    } catch (x: any) { setBulk(`Nicht gespeichert: ${x?.message ?? x}`); }
  };
  const alle = async () => {
    if (!offeneEmpf.length) { setBulk('Nichts mehr offen, das eine Empfehlung hat.'); return; }
    if (!sicher2) { setSicher2(true); return; }
    setSicher2(false);
    await sendeEmpfohlen(offeneEmpf.map((f) => f.id));
  };
  // U3 (Knut 19.10.): drei Teile wie auf der Entscheidungsseite — Heute (fällig) · Offen · Log.
  const faellig = (f: Frage) => (!!f.autoAb && new Date(f.autoAb).getTime() <= Date.now() + 24 * 3600_000) || (f.stufe === 'wichtig' && f.blockiert > 0);
  const heute = sichtbar.filter(faellig), offenListe = sichtbar.filter((f) => !faellig(f));
  const karte = (f: Frage) => erledigt[f.id] ? <p className="small e-erledigt" data-testid="e-erledigt">✓ {f.kennung ? `${f.kennung}: ` : ''}{f.titel} — {L[erledigt[f.id]] ?? erledigt[f.id]}{bestaetigt[f.id]?.text ? `: „${bestaetigt[f.id].text}“` : ''}{bestaetigt[f.id]?.ziel ? ` · an ${bestaetigt[f.id].ziel} geschickt` : ''}</p> : <Karte f={f} onDone={fertigMelden} />;
  const gruppenListe = [...offenListe.reduce((m, f) => m.set(f.gruppe, [...(m.get(f.gruppe) ?? []), f]), new Map<string, Frage[]>())];
  return (
    <div className="page wide e-seite" data-testid="entscheidungen-seite">
      <header className="e-kopf">
        <h1>Entscheidungen</h1>
        <p className="small mut" data-testid="e-zusammensetzung" title="Dieselbe Zahl wie in der Übersicht, der Leiste und der Morgenlage">{data.summe ? <b>{data.summe.text}</b> : null}{data.summe ? ' · ' : ''}Alle offenen Fragen an dich · Stand {fmtDateTime(data.at).split(', ').pop()} · Antworten gehen direkt dorthin, wo weitergearbeitet wird</p>
        <div className="e-prog"><div className="e-bar"><span style={{ width: `${gesamt ? (fertig / gesamt) * 100 : 100}%` }} /></div>
          <span className="small" data-testid="e-fortschritt"><b>{offen} offen</b> · heute {fertig} von {gesamt} beantwortet</span></div>
        <div className="ub-row">
          {gruppen.length > 1 && <select value={gruppe} onChange={(e) => setGruppe(e.target.value)} aria-label="Thema"><option value="">Alle Themen</option>{gruppen.map((g) => <option key={g}>{g}</option>)}</select>}
          <label className="small"><input type="checkbox" checked={nurOffen} onChange={(e) => setNurOffen(e.target.checked)} /> Beantwortete ausblenden</label>
          <button className="ub-btn sm e-bulk" onClick={alle} data-testid="e-alle">{sicher2 ? `Wirklich ${offeneEmpf.length} offene mit „Ja (wie empfohlen)“ speichern? Nochmal klicken` : 'Alle offenen wie empfohlen beantworten'}</button>
          {sicher2 && <button className="linklike tiny" onClick={() => setSicher2(false)}>abbrechen</button>}
        </div>
        {bulk && <p className="tiny mut" data-testid="e-bulk-out">{bulk}</p>}
      </header>
      <nav className="tabs e-sprung" aria-label="Teile">{([['e-fang', `Fang hier an ${fangListe.filter((x) => !erledigt[x.f.id]).length}`], ['e-heute', `Heute ${heute.filter((f) => !erledigt[f.id]).length}`], ['e-offen', `Offen ${offenListe.filter((f) => !erledigt[f.id]).length}`], ...(data.sonstiges.length ? [['e-sonstiges', `Sonstiges ${data.sonstiges.length}`]] : []), ...(aktionen.length ? [['e-hauptchat', `Beim Hauptchat ${aktionen.length}`]] : []), ['e-log', 'Log']] as [string, string][]).map(([id, t]) =>
        <a key={id} href={`#${id}`} onClick={(x) => { x.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); }}>{t}</a>)}</nav>
      {!sichtbar.length && <p className="small mut">Alles beantwortet. Danke!</p>}
      <section id="e-fang" data-testid="e-teil-fang"><h2 className="e-teil">Fang hier an <span className="chip">{fangListe.length}</span> <span className="mut small">die wichtigsten zuerst: hält einen Unter-Chat an · Frist · betrifft Kund:innen</span></h2>
        {fangListe.length ? fangListe.map(({ f, grund }) => <div key={f.id}><FangKarte f={f} grund={grund} onDone={fertigMelden} /></div>) : <p className="small mut">Nichts Dringendes — der Rest steht darunter nach Thema.</p>}</section>
      <section id="e-heute" data-testid="e-teil-heute"><h2 className="e-teil">Heute <span className="mut small">fällig: gilt in 24 h als angenommen oder hält einen Unter-Chat an</span></h2>
        {heute.length ? heute.map((f) => <div key={f.id}>{karte(f)}</div>) : <p className="small mut">Heute ist nichts weiter fällig.</p>}</section>
      <section id="e-offen" data-testid="e-teil-offen"><h2 className="e-teil">Offen <span className="mut small">nach Thema, zugeklappt — je Thema „alle wie empfohlen“</span></h2>
      {gruppenListe.map(([g, fs]) => {
        const empf = fs.filter((f) => !erledigt[f.id] && f.empfehlung && f.art !== 'push' && f.art !== 'vault' && f.antworten.includes('ja'));
        return (
          <details key={g} className="e-gruppe-auf" data-testid="e-gruppe" data-gruppe={g}>
            <summary><b>{g}</b> <span className="chip">{fs.filter((f) => !erledigt[f.id]).length}</span>
              {empf.length > 0 && <button className="ub-btn sm" data-testid="e-gruppe-alle" onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); if (gruppeSicher !== g) { setGruppeSicher(g); return; } setGruppeSicher(''); void sendeEmpfohlen(empf.map((f) => f.id)); }}
                title="Nimmt bei allen Fragen dieses Themas die Empfehlung an">{gruppeSicher === g ? `Wirklich ${empf.length} wie empfohlen? Nochmal klicken` : `alle ${empf.length} wie empfohlen`}</button>}</summary>
            {fs.map((f) => <div key={f.id}>{karte(f)}</div>)}
          </details>);
      })}</section>
      {data.sonstiges.length > 0 && <section id="e-sonstiges" data-testid="e-teil-sonstiges"><h2 className="e-gruppe">Sonstiges ({data.sonstiges.length}) — keine Frage, nur ansehen oder später</h2>
        <div className="ub-card h-inbox">{data.sonstiges.map((e, i) => e.art === 'triage'
          ? <EntscheidZeile key={e.id} e={{ art: 'triage', id: e.daten.triageId, titel: e.frage, empfehlung: e.empfehlung, datei: e.daten.datei, seit: e.wartetSeit, wartet: false }} onDone={reload} />
          : <InboxZeile key={e.id} e={e} erste={i === 0} onDone={reload} />)}</div></section>}
      {aktionen.length > 0 && <section id="e-hauptchat" data-testid="e-teil-hauptchat"><h2 className="e-gruppe">Beim Hauptchat ({aktionen.length}) — nichts für dich, zählt nicht mit</h2>
        {aktionen.map((f) => <div key={f.id}>{karte(f)}</div>)}</section>}
      {data.zurueckgestellt > 0 && <p className="tiny mut">{data.zurueckgestellt} bis morgen 07:00 zurückgestellt.</p>}
      <section id="e-log" data-testid="e-teil-log"><h2 className="e-teil">Log <span className="mut small">beantwortet und nach 24 h angenommen</span></h2><EntscheidungsLog /></section>
    </div>
  );
}
