// Entscheidungen (Knut 19.10.: „Die Entscheidungsseite, wie du sie mir jetzt gibst, finde ich toll … das brauchen wir im Workspace“).
// Muster ~/work/knut/entscheidungen-site, so übernommen: eine Seite, alle offenen Fragen nach Thema gruppiert, Fortschritt
// „x von y beantwortet“, Filter „nur offene“; je Frage Worum es geht · Optionen · Empfehlung (farbig); Ja (wie empfohlen) · Nein ·
// Anders · Später + Notiz („Anders“ verlangt eine Notiz); „Alle offenen wie empfohlen beantworten“ mit Sicherheitsabfrage.
// Die Antwort geht an die Quelle (Rückfrage, Bericht, Strang) — ein Unter-Chat arbeitet weiter, sobald alle seine Fragen beantwortet sind.
import { useState } from 'react';
import { api, fmtDateTime } from '../api.ts';
import { Err, Loading, useLoad, useToast } from '../ui.tsx';
import { InboxZeile, EntscheidungsLog, seit } from './HeuteNeu.tsx';
import { usePushFreigeben } from '../freigabe.tsx';
import { EntscheidZeile } from './Morgenlage.tsx';

type Frage = { id: string; eintrag: string; teil: string | null; art: string; gruppe: string; kennung: string | null; titel: string; worum: string; optionen: string[];
  empfehlung: string | null; stufe: 'wichtig' | 'normal'; stufeGrund: string | null; autoAb: string | null; blockiert: number; quelle: { text: string; url: string | null }; wartetSeit: string | null; antworten: string[]; ref: string | null };
type Daten = { fragen: Frage[]; sonstiges: any[]; beantwortetHeute: number; zurueckgestellt: number; zahl: number; at: string };

const L: Record<string, string> = { ja: 'Ja (wie empfohlen)', nein: 'Nein', anders: 'Anders', spaeter: 'Später' };
const sicher = (u: string | null | undefined) => (u && (/^https?:\/\//.test(u) || /^#\//.test(u)) ? u : null);

function Karte({ f, onDone }: { f: Frage; onDone: (id: string, status: string) => void }) {
  const toast = useToast();
  const pushFreigeben = usePushFreigeben();
  const [wahl, setWahl] = useState<string | null>(null);
  const [notiz, setNotiz] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [out, setOut] = useState('');
  const speichern = async () => {
    setErr(null);
    if (!wahl) { setOut('Bitte zuerst Ja, Nein, Anders oder Später wählen.'); return; }
    if (wahl === 'anders' && !notiz.trim()) { setOut('Bei „Anders“ bitte kurz schreiben, was stattdessen.'); return; }
    setBusy(true); setOut('Speichert …');
    try {
      if (f.art === 'push' && wahl === 'ja') { if (!(await pushFreigeben(String(f.ref ?? '')))) { setOut(''); return; } }
      else if (f.art === 'vault' && (wahl === 'ja' || wahl === 'nein')) await api('/api/roadmap/question', { body: { id: f.ref, answer: wahl } });
      else await api('/api/entscheidungen/fragen/antwort', { body: { id: f.id, antwort: wahl, text: notiz.trim() } });
      toast(wahl === 'spaeter' ? 'Zurückgestellt bis morgen 07:00' : 'Gespeichert — an der Quelle eingetragen');
      onDone(f.id, wahl);
    } catch (x: any) { setOut(''); if (x?.status === 409) { toast(x.message); onDone(f.id, ''); } else setErr(x); }
    finally { setBusy(false); }
  };
  return (
    <article className={`e-karte${f.stufe === 'wichtig' ? ' e-wichtig' : ''}`} data-testid="e-karte" data-id={f.id}>
      <div className="e-top">{f.kennung && <span className="e-id">{f.kennung}</span>}<span className="e-ttl">{f.titel}</span>
        {f.stufe === 'wichtig' ? <span className="chip warn" title={f.stufeGrund ?? ''}>wichtig</span> : <span className="chip">offen</span>}</div>
      <div><div className="e-lbl">Worum es geht</div>{f.worum}</div>
      {f.optionen.length > 0 && <div><div className="e-lbl">Optionen</div><ul>{f.optionen.map((o) => <li key={o}>{o}</li>)}</ul></div>}
      {f.empfehlung && <div className="e-rec"><div className="e-lbl">Empfehlung</div>{f.empfehlung}
        {f.autoAb && <div className="tiny mut" data-testid="e-auto-ab">gilt {new Date(f.autoAb).getTime() <= Date.now() ? 'gleich' : `ab ${fmtDateTime(f.autoAb)}`} als angenommen, wenn du bis dahin da warst</div>}</div>}
      <div className="tiny mut">{sicher(f.quelle.url) ? <a href={sicher(f.quelle.url)!}>{f.quelle.text}</a> : f.quelle.text}{f.wartetSeit ? ` · wartet ${seit(f.wartetSeit)}` : ''}</div>
      <div className="e-btns" role="group" aria-label="Antwort">{f.antworten.map((v) => (
        <button key={v} data-v={v} aria-pressed={wahl === v} disabled={busy} onClick={() => { setWahl(v); setOut(''); }}>{v === 'ja' && !f.empfehlung ? 'Ja' : L[v]}</button>))}</div>
      <textarea rows={2} value={notiz} onChange={(e) => setNotiz(e.target.value)} placeholder="Notiz (bei „Anders“: was stattdessen?)" aria-label="Notiz" />
      <div className="ub-row"><button className="ub-btn pri sm" disabled={busy} onClick={speichern} data-testid="e-speichern">Speichern</button><span className="tiny mut">{out}</span></div>
      <Err e={err} />
    </article>
  );
}

export function Entscheidungen() {
  const { data, error, reload } = useLoad<Daten>(() => api('/api/entscheidungen/fragen'), []);
  const toast = useToast();
  const [nurOffen, setNurOffen] = useState(true);
  const [gruppe, setGruppe] = useState('');
  const [erledigt, setErledigt] = useState<Record<string, string>>({});
  const [sicher2, setSicher2] = useState(false);
  const [bulk, setBulk] = useState('');
  if (error) return <div className="page"><Err e={error} /></div>;
  if (!data) return <div className="page"><Loading /></div>;
  const neu = Object.keys(erledigt).length;
  // Dieselbe Zahl wie Leiste, Kopf und Morgenlage ①: `zahl` (jede Frage zählt einzeln, Sonstiges je ein Eintrag).
  const offen = Math.max(0, data.zahl - neu);
  const gesamt = data.zahl + data.beantwortetHeute;
  const fertig = data.beantwortetHeute + neu;
  const gruppen = [...new Set(data.fragen.map((f) => f.gruppe))];
  const sichtbar = data.fragen.filter((f) => (!gruppe || f.gruppe === gruppe) && (!nurOffen || !erledigt[f.id]));
  const offeneEmpf = sichtbar.filter((f) => !erledigt[f.id] && f.empfehlung && f.art !== 'push' && f.art !== 'vault' && f.antworten.includes('ja'));
  const fertigMelden = (id: string, status: string) => { if (status) setErledigt((x) => ({ ...x, [id]: status })); else reload(); };
  const alle = async () => {
    if (!offeneEmpf.length) { setBulk('Nichts mehr offen, das eine Empfehlung hat.'); return; }
    if (!sicher2) { setSicher2(true); return; }
    setSicher2(false); setBulk('Speichert …');
    try {
      const r: any = await api('/api/entscheidungen/fragen/alle', { body: { ids: offeneEmpf.map((f) => f.id) } });
      setBulk(`${r.ok} Fragen wie empfohlen gespeichert.${r.fehler.length ? ` Nicht gespeichert: ${r.fehler.join(' · ')}` : ''}`);
      toast('Wie empfohlen beantwortet'); setErledigt({}); reload();
    } catch (x: any) { setBulk(`Nicht gespeichert: ${x?.message ?? x}`); }
  };
  // U3 (Knut 19.10.): drei Teile wie auf der Entscheidungsseite — Heute (fällig) · Offen · Log.
  const faellig = (f: Frage) => (!!f.autoAb && new Date(f.autoAb).getTime() <= Date.now() + 24 * 3600_000) || (f.stufe === 'wichtig' && f.blockiert > 0);
  const heute = sichtbar.filter(faellig), offenListe = sichtbar.filter((f) => !faellig(f));
  const karte = (f: Frage) => erledigt[f.id] ? <p className="small e-erledigt" data-testid="e-erledigt">✓ {f.kennung ? `${f.kennung}: ` : ''}{f.titel} — {L[erledigt[f.id]] ?? erledigt[f.id]}</p> : <Karte f={f} onDone={fertigMelden} />;
  let zuletzt = '';
  return (
    <div className="page wide e-seite" data-testid="entscheidungen-seite">
      <header className="e-kopf">
        <h1>Entscheidungen</h1>
        <p className="small mut">Alle offenen Fragen an dich · Stand {fmtDateTime(data.at).split(', ').pop()} · Antworten gehen direkt dorthin, wo weitergearbeitet wird</p>
        <div className="e-prog"><div className="e-bar"><span style={{ width: `${gesamt ? (fertig / gesamt) * 100 : 100}%` }} /></div>
          <span className="small" data-testid="e-fortschritt"><b>{offen} offen</b> · heute {fertig} von {gesamt} beantwortet</span></div>
        <div className="ub-row">
          {gruppen.length > 1 && <select value={gruppe} onChange={(e) => setGruppe(e.target.value)} aria-label="Thema"><option value="">Alle Themen</option>{gruppen.map((g) => <option key={g}>{g}</option>)}</select>}
          <label className="small"><input type="checkbox" checked={nurOffen} onChange={(e) => setNurOffen(e.target.checked)} /> nur offene</label>
          <button className="ub-btn sm e-bulk" onClick={alle} data-testid="e-alle">{sicher2 ? `Wirklich ${offeneEmpf.length} offene mit „Ja (wie empfohlen)“ speichern? Nochmal klicken` : 'Alle offenen wie empfohlen beantworten'}</button>
          {sicher2 && <button className="linklike tiny" onClick={() => setSicher2(false)}>abbrechen</button>}
        </div>
        {bulk && <p className="tiny mut" data-testid="e-bulk-out">{bulk}</p>}
      </header>
      <nav className="tabs e-sprung" aria-label="Teile"><a href="#e-heute" onClick={(x) => { x.preventDefault(); document.getElementById('e-heute')?.scrollIntoView({ behavior: 'smooth' }); }}>Heute {heute.length}</a>
        <a href="#e-offen" onClick={(x) => { x.preventDefault(); document.getElementById('e-offen')?.scrollIntoView({ behavior: 'smooth' }); }}>Offen {offenListe.length}</a>
        <a href="#e-log" onClick={(x) => { x.preventDefault(); document.getElementById('e-log')?.scrollIntoView({ behavior: 'smooth' }); }}>Log</a></nav>
      {!sichtbar.length && <p className="small mut">Alles beantwortet. Danke!</p>}
      <section id="e-heute" data-testid="e-teil-heute"><h2 className="e-teil">Heute <span className="mut small">fällig: gilt in 24 h als angenommen oder hält einen Unter-Chat an</span></h2>
        {heute.length ? heute.map((f) => <div key={f.id}>{karte(f)}</div>) : <p className="small mut">Heute ist nichts fällig.</p>}</section>
      <section id="e-offen" data-testid="e-teil-offen"><h2 className="e-teil">Offen <span className="mut small">nach Wichtigkeit und Thema</span></h2>
      {offenListe.map((f) => {
        const h = f.gruppe !== zuletzt ? <h3 className="e-gruppe" key={`g-${f.gruppe}`}>{f.gruppe}</h3> : null;
        zuletzt = f.gruppe;
        return <div key={f.id}>{h}{karte(f)}</div>;
      })}</section>
      {data.sonstiges.length > 0 && <section><h2 className="e-gruppe">Sonstiges (keine Frage, nur ansehen oder später)</h2>
        <div className="ub-card h-inbox">{data.sonstiges.map((e, i) => e.art === 'triage'
          ? <EntscheidZeile key={e.id} e={{ art: 'triage', id: e.daten.triageId, titel: e.frage, empfehlung: e.empfehlung, datei: e.daten.datei, seit: e.wartetSeit, wartet: false }} onDone={reload} />
          : <InboxZeile key={e.id} e={e} erste={i === 0} onDone={reload} />)}</div></section>}
      {data.zurueckgestellt > 0 && <p className="tiny mut">{data.zurueckgestellt} bis morgen 07:00 zurückgestellt.</p>}
      <section id="e-log" data-testid="e-teil-log"><h2 className="e-teil">Log <span className="mut small">beantwortet und nach 24 h angenommen</span></h2><EntscheidungsLog /></section>
    </div>
  );
}
