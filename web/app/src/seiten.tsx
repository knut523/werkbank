// Werkbank 2.0: die Seiten. Eine Startseite („Jetzt“) und vier Bereiche; jede Seite liest genau einen Endpunkt der 2.0-API.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useDiagramme } from './diagramm.ts';
import { hole, schicke, type Aufraeumen, type ArbeitKarte, type Dok, type Karte, type Link, type PrZeile, type Start } from './api.ts';
import { useApp } from './kontext.ts';
import { Abschnitt, EntscheidungKarte, Fehler, Laedt, Md, useDaten, Verweis, Verweise, Zeile } from './teile.tsx';
import { BEGRIFFE, OLAF_KURZ } from './begriffe.ts';
import { MEHR } from './mehr.ts';
import { BEREICHE } from './bereiche.tsx';
import { chatFrage, htmlFuerV2, mehrzahl, ohneStatuszeilen, rel, tabellenBeschriften, wann } from './format.ts';

// Radikal simpel: „Prüfung“ statt „Agent/Review“ in Marken.
const EMPFEHLUNG: Record<string, string> = { approve: 'Prüfung: in Ordnung', 'request-changes': 'Prüfung: Änderungen nötig', comment: 'Prüfung: Anmerkungen' };

function gruss(name: string) {
  const h = Number(new Date().toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', hour12: false }));
  return `${h < 11 ? 'Guten Morgen' : h < 18 ? 'Hallo' : 'Guten Abend'}, ${name}`;
}

// ---------- Jetzt ----------

export function Jetzt() {
  const app = useApp();
  // Radikal simpel (Knut 04.11.): Start = Suche + höchstens fünf Karten. Alles andere liegt unter „Arbeit“, „PRs“ und „Mehr“.
  const oben = useDaten<Pick<Start, 'zahl' | 'jetzt' | 'aufraeumen' | 'ich' | 'admin' | 'rolle'>>('api/v2/start?teil=oben');
  const reviewer = oben.d?.rolle === 'reviewer';
  const voll = useDaten<Start>(reviewer ? 'api/v2/start' : null);   // nur Reviewer brauchen die PR-Liste auf dem Start
  const k = oben.d;
  useEffect(() => { if (k) app.zahl(k.zahl); }, [k]);
  if (oben.fehler) return <Fehler text={oben.fehler} nochmal={oben.neu} />;
  if (!k) return <Laedt />;
  const karten = k.jetzt.slice(0, 5);
  const d = voll.d;
  return (
    <div className="seite">
      <SuchFeld />
      <ThemenLeiste />
      {k.admin && <Enden kurz />}
      {k.admin && <HauptsitzungListe />}
      {!k.admin && !reviewer && <p className="klein gedimmt">Neu hier? <a href="v2/begriffe">Begriffe in Klartext</a> — und oben suchst du Dokumente, Chats und PRs.</p>}
      {reviewer && (
        <section className="abschnitt" aria-labelledby="a-prs">
          <h2 id="a-prs">PRs, die auf dich warten</h2>
          {!d ? <Laedt sofort text="Lädt die PRs, bei denen du dran bist …" /> : !d.prFrei ? <p className="leer">PRs sind für dich noch nicht freigegeben — frag Knut.</p>
            : d.prs?.length ? <ul className="liste">{d.prs.map((p) => <PrZeileView key={p.pr} p={p} />)}</ul> : <p className="leer">Kein PR wartet auf dich.</p>}
          {!!d?.reviews?.length && <><p className="gruppe-titel">Zuletzt vom Prüf-Agenten geprüft</p><ul className="liste">{d.reviews.map((p) => <PrZeileView key={p.pr} p={p} />)}</ul></>}
          <p className="abschnitt-fuss"><a href="v2/prs">Alle PRs →</a></p>
        </section>
      )}
      <section className="abschnitt" aria-labelledby="a-jetzt">
        <h2 id="a-jetzt">{karten.length ? 'Was du jetzt tun musst' : 'Jetzt'}</h2>
        {karten.length ? <div className="karten">{karten.map((x) => <EntscheidungKarte key={x.id} k={x} beantwortet={() => app.zahl(null)} />)}</div>
          : <p className="leer">Gerade wartet nichts auf dich.</p>}
        {k.zahl > karten.length && <p className="abschnitt-fuss"><a href="v2/entscheidungen">Alles, was auf dich wartet →</a></p>}
      </section>
    </div>
  );
}

/** Radikal simpel: eine Suche über Unter-Chats und Chats, Dokumente und PRs — Enter öffnet die Treffer. */
function SuchFeld({ q = '' }: { q?: string }) {
  return (
    <form className="suche" role="search" onSubmit={(e) => { e.preventDefault(); const t = String(new FormData(e.currentTarget).get('q') ?? '').trim(); if (!t) return; history.pushState(null, '', `v2/suche?q=${encodeURIComponent(t)}`); window.dispatchEvent(new PopStateEvent('popstate')); }}>
      <label htmlFor="such-alles" className="unsichtbar">Suchen</label>
      <input id="such-alles" name="q" type="search" defaultValue={q} placeholder="Suchen: Chat, Dokument, PR …" />
    </form>
  );
}

/** Treffer der einen Suche, nach Art — je höchstens acht, dahinter der Weg zur vollen Liste. */
export function Suche({ q }: { q: string }) {
  const s = q.trim().toLowerCase();
  const chats = useDaten<{ zeilen: ChatZeile[] }>(s ? 'api/v2/chats' : null);
  const doks = useDaten<{ treffer: Dok[]; frei?: { notizen: boolean; berichte: boolean } }>(s ? `api/v2/dokumente?q=${encodeURIComponent(q.trim())}` : null);
  const prs = useDaten<{ gesperrt?: boolean; zeilen: PrZeile[] }>(s ? 'api/v2/prs?wer=alle' : null);
  const c = (chats.d?.zeilen ?? []).filter((z) => `${z.titel} ${z.thema ?? ''}`.toLowerCase().includes(s));
  // Abgleich (h): Volltext in den Nachrichten — Treffer über `conv` mit „Alle Chats“ verbinden (Titel, Link), Titel-Treffer zuerst.
  const voll = useDaten<{ treffer: { conv: string; auszug: string; at: string }[] }>(s.length >= 3 ? `api/v2/chats/suche?q=${encodeURIComponent(q.trim())}` : null);
  const schon = new Set(c.map((z) => z.conv));
  const imText = (voll.d?.treffer ?? []).filter((t) => !schon.has(t.conv)).map((t) => ({ t, z: (chats.d?.zeilen ?? []).find((z) => z.conv === t.conv) }));
  const p = (prs.d?.zeilen ?? []).filter((z) => `${z.pr} ${z.titel}`.toLowerCase().includes(s.replace(/^#/, '')));
  const gruppe = (titel: string, laedt: boolean, n: number, inhalt: ReactNode, mehr: string | null) => (
    <section className="abschnitt"><h2>{titel}</h2>{laedt ? <Laedt /> : n ? inhalt : <p className="leer">Nichts gefunden.</p>}{mehr && n > 8 && <p className="abschnitt-fuss"><a href={mehr}>Alle ansehen →</a></p>}</section>
  );
  return (
    <div className="seite">
      <SuchFeld q={q} />
      {!s ? <p className="leer">Gib oben ein Wort ein.</p> : <>
        {gruppe('Unter-Chats und Chats', !chats.d && !chats.fehler, c.length, <ul className="liste">{c.slice(0, 8).map((z) => <Zeile key={z.id} titel={z.titel} url={z.url ?? (z.art === 'unterchat' ? `v2/arbeit/${z.id}` : '#')} satz={ART_TEXT[z.art]} rechts={wann(z.zuletzt)} />)}</ul>, `v2/chats?q=${encodeURIComponent(q.trim())}`)}
        {s.length >= 3 && gruppe('In Chat-Nachrichten gefunden', !voll.d && !voll.fehler, imText.length, <ul className="liste">{imText.slice(0, 8).map(({ t, z }) => <Zeile key={t.conv} titel={z?.titel ?? 'Chat'} url={z?.url ?? (z?.art === 'unterchat' ? `v2/arbeit/${z.id}` : '#')} satz={`„${t.auszug}“`} rechts={wann(t.at)} />)}</ul>, null)}
        {gruppe('Dokumente', !doks.d && !doks.fehler, doks.d?.treffer.length ?? 0, <ul className="liste">{(doks.d?.treffer ?? []).slice(0, 8).map((x) => <DokZeile key={x.url} x={x} />)}</ul>, `v2/dokumente?q=${encodeURIComponent(q.trim())}`)}
        {!prs.d?.gesperrt && gruppe('PRs', !prs.d && !prs.fehler, p.length, <ul className="liste">{p.slice(0, 8).map((z) => <PrZeileView key={z.pr} p={z} />)}</ul>, 'v2/prs?wer=alle')}
      </>}
    </div>
  );
}

function AufraeumenListe({ l, fertig }: { l: Aufraeumen[]; fertig?: () => void }) {
  return <ul className="liste aufraeumen">{l.map((x) => x.schliessbar ? <SammelSchliessen key={x.id} x={x} fertig={fertig} /> : <Zeile key={x.id} titel={x.titel} url={x.url} satz={`${x.worum} Zählt als ein Posten. In der alten Werkbank.`} marke={{ text: 'Sammelposten' }} />)}</ul>;
}

/** S21: alte Deckel-Fragen mit einem Klick schließen — mit Rückfrage, derselbe Weg wie in der alten Werkbank. */
function SammelSchliessen({ x, fertig }: { x: Aufraeumen; fertig?: () => void }) {
  const app = useApp();
  const [frage, setFrage] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);
  const zu = async () => {
    setLaeuft(true);
    try { await schicke('api/v2/sammel-schliessen', { id: x.id }); setMeldung(`✓ ${mehrzahl(x.schliessbar!, 'Frage', 'Fragen')} geschlossen — jede steht mit Grund im Entscheidungs-Log.`); app.zahl(null); fertig?.(); }
    catch (e: any) { setMeldung(e.message); } finally { setLaeuft(false); setFrage(false); }
  };
  return (
    <li className="zeile">
      <div className="zeile-haupt">
        <span className="zeile-titel">{x.titel}</span>
        <p className="zeile-satz">{x.worum}</p>
        {frage && <p className="klein"><b>{mehrzahl(x.schliessbar!, 'Frage', 'Fragen')} schließen?</b> Die Unter-Chats laufen nicht mehr; niemand bekommt eine Nachricht. <button type="button" className="knopf haupt klein" disabled={laeuft} onClick={zu}>{laeuft ? 'Schließt …' : 'Ja, schließen'}</button> <button type="button" className="knopf leise klein" onClick={() => setFrage(false)}>Abbrechen</button></p>}
        {meldung && <p className="ok" role="status">{meldung}</p>}
      </div>
      <div className="zeile-rechts">{!frage && !meldung?.startsWith('✓') && <button type="button" className="knopf leise klein" onClick={() => { setMeldung(null); setFrage(true); }}>Alle {x.schliessbar} schließen …</button>}</div>
    </li>
  );
}

interface Ueberholt { id: string; titel: string; grund: string; beleg: string }
const DokZeile = ({ x }: { x: Dok }) => <Zeile titel={x.titel} url={x.url} satz={x.thema && x.thema !== 'Sonstiges' ? `${x.thema} · ${x.worum}` : x.worum} marke={{ text: x.art === 'bericht' ? 'Bericht' : 'Notiz' }} rechts={wann(x.at)} />;
// S22 (Christoph B3): in der Liste sieht man, ob und wie der Prüf-Agent geurteilt hat — auch „prüft noch“ und „fertig, noch nicht veröffentlicht“.
// Audit 05.11. (6): ein Review zu einem älteren Commit ist veraltet — das sagt die Marke zuerst.
const agentMarke = (r: PrZeile['review']) => !r ? undefined : (r as any).aktuell === false && r.status === 'fertig' ? { text: `Review zu altem Stand (${(r as any).kopf}) — neuer Stand ${(r as any).neuerKopf}`, ton: 'warn' } : r.empfehlung ? { text: EMPFEHLUNG[r.empfehlung] ?? `Prüfung: ${r.empfehlung}`, ton: r.empfehlung === 'approve' ? 'gruen' : '' } : r.status !== 'fertig' ? { text: 'wird geprüft …' } : { text: r.gepostet === false ? 'Prüfung noch nicht veröffentlicht' : 'geprüft' };
/** Paket 436 (Knut 04.11.): was nach dem letzten automatischen Fix an offenen Punkten (jeder Reviewer) geblieben ist — an der Karte. */
const fixSatz = (f: PrZeile['fix']) => (!f ? '' : f.lesbar === false ? ' · letzter Fix: offene Punkte nicht prüfbar (PR nicht lesbar)' : f.offen ? ` · nach dem letzten Fix ${f.offen === 1 ? '1 Punkt' : `${f.offen} Punkte`} offen` : f.gesamt ? ' · letzter Fix: alle Punkte abgehakt' : '');
const GRUND: Record<string, string> = { 'nicht-behandelt': 'vom Fix nicht behandelt', frage: 'Rückfrage des Fixes', 'nicht-behoben': 'nicht behoben', 'ohne-commit': 'als behoben gemeldet, aber ohne Commit in diesem Push' };
// Knut 05.11. abends (2): „Strang … arbeitet daran — läuft/wartet/steckt“ direkt in der PR-Zeile.
const strangSatz = (s?: { titel: string; zustand: string }[]) => (s?.length ? ` · Unter-Chat „${s[0].titel}“ arbeitet daran — ${s[0].zustand}${s.length > 1 ? ` (+${s.length - 1})` : ''}` : '');
const PrZeileView = ({ p }: { p: PrZeile }) => (
  <Zeile titel={`${p.pr} · ${p.titel}`} url={`v2/prs/${encodeURIComponent(p.repo)}/${p.number}`} satz={`${p.thema && p.thema !== 'Sonstiges' ? `${p.thema} · ` : ''}${p.wartetAuf.length ? `wartet auf ${p.wartetAuf.join(', ')} — ${p.warum}` : p.warum || 'wartet auf niemanden'}${fixSatz(p.fix)}${strangSatz(p.straenge)}`}
    marke={p.konflikt ? { text: 'Merge-Konflikt' } : p.entwurf ? { text: 'Entwurf' } : agentMarke(p.review) ?? { text: 'noch nicht geprüft' }} rechts={wann(p.geaendert)} />
);

// ---------- Entscheidungen ----------

export function Entscheidungen() {
  const app = useApp();
  const { d, fehler, neu } = useDaten<{ zahl: number; oben: Karte[]; rest: Karte[]; aufraeumen: Aufraeumen[]; geschlossen?: Geschlossen[]; ueberholt?: Ueberholt[]; beiClaude?: { technisch: number; gewichtig: number } | null }>('api/v2/entscheidungen');
  useEffect(() => { if (d) app.zahl(d.zahl); }, [d]);
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  const bc = d.beiClaude;
  return (
    <div className="seite">
      <h1>{bc ? 'Für dich' : 'Entscheidungen'}</h1>
      <p className="unterzeile">{bc ? `${d.oben.length + d.rest.length} Entscheidungen, die nur du treffen kannst (Geld, Recht, Zugang, Außenwirkung, Release).` : 'Alles, was auf dich wartet. „Ja, so“ übernimmt die Empfehlung, „Anders …“ schickt deinen eigenen Text — die Antwort geht an den richtigen Unter-Chat.'}</p>
      {/* Plan §23 T4/T5: was nicht hier steht, entscheidet Claude (technisch) bzw. der Hauptchat nach Council (gewichtig) — sichtbar und umkehrbar. */}
      {bc && <p className="klein bei-claude">{bc.technisch || bc.gewichtig ? <>Nicht für dich: {bc.technisch ? `${bc.technisch} technische ${bc.technisch === 1 ? 'Frage entscheidet' : 'Fragen entscheidet'} Claude nach Empfehlung` : ''}{bc.technisch && bc.gewichtig ? ', ' : ''}{bc.gewichtig ? `${bc.gewichtig} gewichtige ${bc.gewichtig === 1 ? 'geht' : 'gehen'} vorher durch einen Council-Check` : ''}. </> : null}<a href="v2/entschieden">Von Claude entschieden →</a></p>}
      {/* Persona R7 „Knut morgens, 2 Minuten“: erst der Überblick — je Thema eine kurze Zeile je Entscheidung, Klick springt zur Karte. */}
      {bc && <Ueberblick karten={[...d.oben, ...d.rest]} />}
      {!bc && <p className="zusammensetzung">Die Zahl oben rechts: {d.oben.length + d.rest.length} {d.oben.length + d.rest.length === 1 ? 'Frage' : 'Fragen und Freigaben'}{d.aufraeumen.length ? ` + ${d.aufraeumen.length} ${d.aufraeumen.length === 1 ? 'Sammelposten' : 'Sammelposten'} zum Aufräumen` : ''} = {d.zahl}.{d.ueberholt?.length ? <> <a href="#e-ueberholt">{mehrzahl(d.ueberholt.length, 'Freigabe ist überholt und zählt', 'Freigaben sind überholt und zählen')} nicht ↓</a></> : null}{d.geschlossen?.length ? <> <a href="#e-geschlossen">{mehrzahl(d.geschlossen.length, 'Frage hat', 'Fragen haben')} sich von selbst erledigt ↓</a></> : null}</p>}
      {(() => { const s = themen(d.rest).map(([t, ks]) => [t, ks.filter(wieEmpfohlenMoeglich).length] as const).filter(([, n]) => n > 1);
        return s.length ? <p className="klein sammel-sprung">Alle Empfehlungen eines Themas auf einmal annehmen: {s.map(([t, n]) => <a key={t} className="chip" href={`#thema-${themaAnker(t, themen(d.rest).map(([x]) => x))}`}>{t} ({n})</a>)}</p> : null; })()}
      <Abschnitt id="e-zuerst" titel="Zuerst" erklaerung="Dieselben fünf wie auf der Startseite: was einen Agenten anhält oder bald als angenommen gilt.">
        {d.oben.length ? <div className="karten">{d.oben.map((k) => <EntscheidungKarte key={k.id} k={k} beantwortet={() => app.zahl(null)} />)}</div> : <p className="leer">{d.aufraeumen.length ? 'Keine Entscheidung offen — was trotzdem zählt, steht unten unter „Aufräumen“.' : 'Gerade wartet nichts auf dich.'}</p>}
      </Abschnitt>
      {d.rest.length > 0 && (
        <Abschnitt id="e-weitere" titel="Weitere, nach Thema" erklaerung="Alles andere, was auf dich wartet — nach Thema gruppiert. Passt bei einem Thema jede Empfehlung, beantwortest du alle auf einmal mit „Alle wie empfohlen“ (mit Rückfrage); Freigaben und Fragen ohne Empfehlung bleiben dabei stehen.">
          {themen(d.rest).map(([thema, ks], _i, alle) => <ThemaGruppe key={thema} thema={thema} karten={ks} alleThemen={alle.map(([x]) => x)} fertig={() => { neu(); app.zahl(null); }} />)}
        </Abschnitt>
      )}
      {/* Knut 05.11. 19:00: zu jedem fertigen Strang etwas schreiben — die Notiz geht von selbst an den Strang. */}
      <ZumAnsehen />
      {d.aufraeumen.length > 0 && (
        <Abschnitt id="e-aufraeumen" titel="Aufräumen" erklaerung="Zählt mit, weil es auf dich wartet — ist aber keine Entscheidung und hält keinen Agenten an. Das erledigst du (noch) in der alten Werkbank.">
          <AufraeumenListe l={d.aufraeumen} fertig={neu} />
        </Abschnitt>
      )}
      {!!d.ueberholt?.length && (
        <Abschnitt id="e-ueberholt" titel="Überholt — zählt nicht mit" erklaerung="Freigaben, deren Stand auf GitHub schon gemergt ist: entweder genau dieser Stand oder ein neuerer auf demselben Zweig. Daran wartet nichts mehr auf dich. Das wird bei jedem Laden neu geprüft — ändert sich etwas, steht die Freigabe wieder oben.">
          <ul className="liste">{d.ueberholt.map((u) => <li key={u.id} className="zeile"><div className="zeile-haupt"><span className="zeile-titel">{u.titel}</span><p className="zeile-satz">{u.grund}</p></div><div className="zeile-rechts"><span className="zeit">{u.beleg.split('/').pop()}</span></div></li>)}</ul>
        </Abschnitt>
      )}
      {!!d.geschlossen?.length && (
        <Abschnitt id="e-geschlossen" titel="Von selbst geschlossen" erklaerung="Fragen der letzten 7 Tage, die sich erledigt haben — der Unter-Chat ist fertig oder hat die Frage in seinem Bericht schon entschieden. Zählt nicht mit. Stimmt etwas nicht, holst du die Frage mit „Wieder öffnen“ zurück.">
          <GeschlossenListe l={d.geschlossen} geoeffnet={() => { neu(); app.zahl(null); }} />
        </Abschnitt>
      )}
    </div>
  );
}

/** Karten nach Thema, größte Gruppe zuerst; ohne Thema unter „Sonstiges“. */
/** Knut 05.11. 19:00 „Eine Seite, auf der ich zu jedem Punkt etwas schreiben kann“: je fertigem Strang Stand, Links, Passt/Ändern/Später + Notiz. */
function ZumAnsehen() {
  const { d, neu } = useDaten<{ karten: { id: string; titel: string; thema: string; uhr: string | null; satz: string; links: Link[]; ohneBericht?: boolean }[] }>('api/v2/ansehen');
  if (!d?.karten.length) return null;
  return (
    <Abschnitt id="e-ansehen" titel={`Zum Ansehen (${d.karten.length})`} erklaerung="Fertige Unter-Chats. Schreib zu jedem etwas — die Notiz geht von selbst an den Unter-Chat (auch wenn er gerade beschäftigt ist) und steht im Entscheidungs-Log.">
      <div className="karten">{d.karten.map((k) => <AnsehenKarte key={k.id} k={k} fertig={neu} />)}</div>
    </Abschnitt>
  );
}

function AnsehenKarte({ k, fertig }: { k: { id: string; titel: string; thema: string; uhr: string | null; satz: string; links: Link[]; ohneBericht?: boolean }; fertig: () => void }) {
  const [notiz, setNotiz] = useState('');
  const [meldung, setMeldung] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);   // Gegenprüfung 05.11. (Teil 7): kein Doppelklick → keine doppelte Notiz
  const antworten = async (art: 'passt' | 'aendern' | 'spaeter', o: { text?: string; trotzdem?: boolean } = {}) => {
    const n = o.text ?? notiz;
    if (art === 'aendern' && !n.trim()) { setMeldung('Bei „Ändern“ bitte kurz schreiben, was.'); return; }
    if (laeuft) return;
    setLaeuft(true);
    try { await schicke(`api/v2/ansehen/${encodeURIComponent(k.id)}`, { art, notiz: n, ...(o.trotzdem ? { ohneBericht: true } : {}) }); setMeldung(art === 'passt' ? 'Abgenommen.' : art === 'aendern' ? 'Geht an den Unter-Chat.' : 'Für 24 h ausgeblendet.'); setTimeout(fertig, 800); }
    catch (e: any) { setMeldung(String(e?.message ?? e)); setLaeuft(false); }
  };
  // Audit 05.11. (5): ohne Bericht ist „fertig“ kein abnehmbarer Stand — zuerst den Bericht anfordern; abnehmen nur ausdrücklich.
  const BERICHT = 'Bitte schreib den Bericht (Abschnitte wie im Auftrag) und melde dich dann mit „### Stand“ und „Status: fertig“.';
  return (
    <article id={`ansehen-${k.id}`} className="karte ansehen" aria-label={k.titel}>
      {k.thema && k.thema !== 'Sonstiges' && <p className="karte-thema">{k.thema}</p>}
      <h3 className="karte-titel">{k.titel}</h3>
      <p className="klein">{k.satz}{k.uhr ? ` · ${k.uhr}` : ''}</p>
      {k.links.length > 0 && <Verweise links={k.links} />}
      <textarea className="notiz" rows={2} placeholder="Deine Notiz an den Unter-Chat (optional, bei „Ändern“ nötig)" value={notiz} onChange={(e) => setNotiz(e.target.value)} />
      <div className="knoepfe" aria-busy={laeuft}>
        {k.ohneBericht
          ? <>
            <button type="button" className="knopf haupt" disabled={laeuft} onClick={() => antworten('aendern', { text: notiz.trim() ? `${notiz.trim()}\n\n${BERICHT}` : BERICHT })}>Bericht anfordern</button>
            <button type="button" className="knopf leise" disabled={laeuft} title="Fertig ohne Bericht abnehmen — nur, wenn es wirklich keinen braucht" onClick={() => antworten('passt', { trotzdem: true })}>Trotzdem abnehmen</button>
          </>
          : <>
            <button type="button" className="knopf haupt" disabled={laeuft} onClick={() => antworten('passt')}>Passt</button>
            <button type="button" className="knopf" disabled={laeuft} onClick={() => antworten('aendern')}>Ändern</button>
          </>}
        <button type="button" className="knopf leise" disabled={laeuft} onClick={() => antworten('spaeter')}>Später</button>
      </div>
      {meldung && <p className="hinweis klein" role="status">{meldung}</p>}
    </article>
  );
}

/** Persona R7: alle Entscheidungen auf einen Blick — Thema, Anzahl, je Frage eine Zeile (gekürzt) mit Sprung zur Karte. */
function Ueberblick({ karten }: { karten: Karte[] }) {
  if (karten.length < 4) return null;
  const kurzTitel = (t: string) => (t.length > 70 ? `${t.slice(0, 68).replace(/\s+\S*$/, '')} …` : t);
  return (
    <details className="ueberblick" open>
      <summary>Überblick: {karten.length} Entscheidungen in {themen(karten).length} Themen</summary>
      {themen(karten).map(([thema, ks]) => (
        <div key={thema} className="ueberblick-thema">
          <p className="ueberblick-kopf">{thema} · {ks.length}</p>
          <ul>{ks.map((k) => <li key={k.id}><a href={`#karte-${k.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`karte-${k.id}`)?.scrollIntoView({ block: 'start' }); }}>{kurzTitel(k.titel)}</a></li>)}</ul>
        </div>
      ))}
    </details>
  );
}

function themen(ks: Karte[]): [string, Karte[]][] {
  const m = new Map<string, Karte[]>();
  for (const k of ks) { const t = k.thema?.trim() || 'Sonstiges'; m.set(t, [...(m.get(t) ?? []), k]); }
  return [...m].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'de'));
}
/** Anker je Thema — mit Platz in der Liste, damit „A B“ und „A-B“ nie denselben bekommen (Pass C). */
const themaAnker = (t: string, alle: string[]) => `${alle.indexOf(t)}-${t.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '-')}`;
const wieEmpfohlenMoeglich = (k: Karte) => k.art === 'entscheidung' && !k.alt && !!k.empfehlung && k.antworten.includes('ja');

function ThemaGruppe({ thema, karten, fertig, alleThemen }: { thema: string; karten: Karte[]; fertig: () => void; alleThemen: string[] }) {
  const app = useApp();
  const passend = karten.filter(wieEmpfohlenMoeglich);
  const [frage, setFrage] = useState(false);
  const [gesendet, setGesendet] = useState<string>('');   // Runde 4 (Knut B9): nach dem Senden kein zweiter Knopf für dieselben Fragen
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);
  const alle = async () => {
    setLaeuft(true); setMeldung(null);
    try {
      const r = await schicke<{ ok: number; fehler: string[]; uebersprungen: number }>('api/v2/alle-empfohlen', { ids: passend.map((k) => k.id) });
      setMeldung(`✓ ${mehrzahl(r.ok, 'Antwort', 'Antworten')} wie empfohlen verschickt.${app.testbetrieb ? ' Testbetrieb: Fragen aus Notizen bleiben hier offen.' : ''}${r.uebersprungen ? ` ${r.uebersprungen} übersprungen — die beantwortest du einzeln.` : ''}${r.fehler.length ? ` Nicht geklappt: ${r.fehler.join('; ')}` : ''}`);
      setFrage(false); if (!r.fehler.length) setGesendet(passend.map((k) => k.id).join());   // bei Teilfehlern bleibt der Knopf (Pass C)
      // Runde 5 (Knut B7): nach dem Neuladen ist die Gruppe oft weg — die Bestätigung steht deshalb oben auf der Seite.
      if (r.ok) window.dispatchEvent(new CustomEvent('v2-meldung', { detail: { ok: !r.fehler.length, text: `${r.fehler.length ? `${thema}: ${r.ok} von ${passend.length} wie empfohlen verschickt. Nicht geklappt: ${r.fehler.join('; ')}` : `✓ ${thema}: ${mehrzahl(r.ok, 'Antwort', 'Antworten')} wie empfohlen verschickt — jede an ihre Quelle.`}${app.testbetrieb ? ' Testbetrieb: Fragen aus Notizen werden nicht wirklich beantwortet.' : ''}` } }));
      fertig();
    } catch (x: any) { setMeldung(x.message); } finally { setLaeuft(false); }
  };
  return (
    <div className="thema-gruppe" id={`thema-${themaAnker(thema, alleThemen)}`}>
      <div className="thema-kopf">
        <p className="gruppe-titel">{thema} · {karten.length} <a className="klein" href={`v2/thema?name=${encodeURIComponent(thema)}`}>Alles zu {thema} →</a></p>
        {passend.length > 1 && !frage && gesendet !== passend.map((k) => k.id).join() && <button type="button" className="knopf leise klein" onClick={() => setFrage(true)} title={passend.map((k) => k.titel).join(' · ')}>{passend.length < karten.length ? `Die ${passend.length} mit Empfehlung so beantworten …` : `Alle ${passend.length} wie empfohlen …`}</button>}
      </div>
      {frage && (
        <div className="bestaetigen" role="alertdialog" aria-label={`Alle ${passend.length} wie empfohlen beantworten?`}>
          <p>{mehrzahl(passend.length, 'Frage', 'Fragen')} zu „{thema}“ mit der jeweiligen Empfehlung beantworten? Jede Antwort geht an ihre Quelle (meist den Unter-Chat, der gefragt hat).</p>
          <ul className="klein">{passend.map((k) => <li key={k.id}>{k.titel}{k.quelle ? ` (aus ${k.quelle})` : ''} — <i>{k.empfehlung}</i></li>)}</ul>
          <div className="antworten">
            <button type="button" className="knopf haupt" disabled={laeuft} onClick={alle}>{laeuft ? 'Sendet …' : 'Ja, alle so'}</button>
            <button type="button" className="knopf leise" disabled={laeuft} onClick={() => setFrage(false)}>Abbrechen</button>
          </div>
        </div>
      )}
      {meldung && <p className="ok" role="status">{meldung}</p>}
      <div className="karten">{karten.map((k) => <EntscheidungKarte key={k.id} k={k} beantwortet={() => app.zahl(null)} />)}</div>
    </div>
  );
}

interface Geschlossen { id: string; titel: string; grund: string; wann: string }
function GeschlossenListe({ l, geoeffnet }: { l: Geschlossen[]; geoeffnet: () => void }) {
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [weg, setWeg] = useState<string[]>([]);   // Runde 4 (Knut B7): die Zeile verschwindet sofort, nicht erst nach dem Neuladen
  const oeffnen = async (id: string) => {
    setLaeuft(id); setFehler(null);
    try { await schicke('api/v2/wieder-oeffnen', { id }); setWeg((w) => [...w, id]); setOk('✓ Wieder offen — die Frage steht jetzt oben unter „Weitere“ und zählt wieder mit.'); geoeffnet(); } catch (x: any) { setFehler(x.message); } finally { setLaeuft(null); }
  };
  return (
    <>
      {fehler && <p className="fehlertext klein">{fehler}</p>}
      {ok && <p className="ok" role="status">{ok}</p>}
      <ul className="liste">{l.filter((g) => !weg.includes(g.id)).map((g) => (
        <li key={g.id} className="zeile">
          <div className="zeile-haupt"><span className="zeile-titel">{g.titel || 'Frage'}</span><p className="zeile-satz">{g.grund}</p></div>
          <div className="zeile-rechts"><span className="zeit">{wann(g.wann)}</span><button type="button" className="knopf leise klein" disabled={laeuft === g.id} onClick={() => oeffnen(g.id)}>{laeuft === g.id ? 'Öffne …' : 'Wieder öffnen'}</button></div>
        </li>
      ))}</ul>
    </>
  );
}

// ---------- Arbeit ----------

export function Arbeit() {
  const { d, fehler, neu } = useDaten<{ gruppen: Record<'wartet' | 'laeuft' | 'fertig', ArbeitKarte[]>; nurAdmin?: boolean }>('api/v2/arbeit');
  const [q, setQ] = useState('');
  const [thema, setThema] = useState<string | null>(null);   // Runde 7: nach Thema filtern
  // Radikal simpel: drei Reiter statt drei langer Abschnitte; „Fertig“ direkt erreichbar (Knut: „heute fertig“). Merkt sich die Wahl.
  const [reiter, setReiter] = useState<'wartet' | 'laeuft' | 'fertig'>(() => (location.hash === '#fertig' ? 'fertig' : (sessionStorage.getItem('v2-arbeit-reiter') as any) || 'wartet'));
  useEffect(() => { try { sessionStorage.setItem('v2-arbeit-reiter', reiter); } catch { /* egal */ } }, [reiter]);
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  if (d.nurAdmin) return (
    <div className="seite"><h1>Arbeit</h1>
      <div className="willkommen"><p><b>Hier stehen deine Unter-Chats.</b> Ein Unter-Chat ist ein Auftrag, an dem ein Agent selbstständig arbeitet und am Ende einen Bericht schreibt. Du hast gerade keine — Knut verteilt die Aufträge.</p><p className="klein"><a href="v2/chats">Deine Chats durchsuchen</a> · <a href="v2/begriffe">Begriffe in Klartext</a></p></div>
    </div>
  );
  const such = q.trim().toLowerCase();
  const sortiert = (l: ArbeitKarte[]) => [...l].filter((z) => (!such || z.titel.toLowerCase().includes(such)) && (!thema || z.thema === thema)).sort((a, b) => String(b.zuletzt ?? '').localeCompare(String(a.zuletzt ?? '')));
  // Runde 6 (B3): mit Suchwort über alle drei Reiter — sonst findet „Netzentgelt“ im Reiter „Fertig“ nichts, obwohl es den Unter-Chat gibt.
  const l = sortiert(such ? [...d.gruppen.wartet, ...d.gruppen.laeuft, ...d.gruppen.fertig] : d.gruppen[reiter]);
  const heute = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
  const istHeute = (z: ArbeitKarte) => !!z.zuletzt && new Date(z.zuletzt).toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' }) === heute;
  // Unter „Fertig“ derselbe Satz in jeder Zeile ist Lärm — nur zeigen, was abweicht (z. B. „ohne Bericht“).
  const zeile = (z: ArbeitKarte) => <Zeile key={z.id} titel={z.titel} url={`v2/arbeit/${z.id}`} satz={[thema ? '' : z.thema, reiter === 'fertig' && z.satz.startsWith('Fertig — der Bericht liegt bereit') ? '' : z.satz].filter(Boolean).join(' · ')} rechts={wann(z.zuletzt)} />;
  const REITER: [typeof reiter, string][] = [['wartet', 'Wartet auf dich'], ['laeuft', 'Läuft'], ['fertig', 'Fertig']];
  return (
    <div className="seite">
      <h1>Arbeit</h1>
      <UnterChatStarten fertig={neu} />
      <form className="suche" role="search" onSubmit={(e) => { e.preventDefault(); history.pushState(null, '', q.trim() ? `v2/chats?q=${encodeURIComponent(q.trim())}` : 'v2/chats'); window.dispatchEvent(new PopStateEvent('popstate')); }}>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Unter-Chat suchen — Enter sucht auch in alten Chats" aria-label="Unter-Chats durchsuchen" />
      </form>
      <ThemenLeiste aktiv={thema} wahl={setThema} />
      <div className="reiter" role="tablist" aria-label="Unter-Chats">{REITER.map(([r, t]) => <button key={r} type="button" role="tab" aria-selected={reiter === r} className={reiter === r ? 'an' : ''} onClick={() => setReiter(r)}>{t}</button>)}</div>
      {such ? (l.length ? <ul className="liste">{l.map(zeile)}</ul> : <p className="leer">Nichts zu „{q.trim()}“ in deinen Unter-Chats.</p>) : reiter === 'fertig' ? (
        <>
          <Enden />
          {!l.length ? <p className="leer">{such ? `Nichts zu „${q.trim()}“.` : 'Nichts Fertiges offen.'}</p> : <>
            {l.some((z) => z.fast) && <><p className="gruppe-titel">Fast fertig — es fehlt noch etwas</p><ul className="liste">{l.filter((z) => z.fast).map(zeile)}</ul></>}
            <p className="gruppe-titel">Heute fertig</p>
            {l.some((z) => !z.fast && istHeute(z)) ? <ul className="liste">{l.filter((z) => !z.fast && istHeute(z)).map(zeile)}</ul> : <p className="leer">Heute ist noch nichts ganz fertig geworden.</p>}
            {l.some((z) => !z.fast && !istHeute(z)) && <><p className="gruppe-titel">Früher (noch nicht abgenommen)</p><ul className="liste">{l.filter((z) => !z.fast && !istHeute(z)).map(zeile)}</ul></>}
          </>}
          <p className="abschnitt-fuss"><a href="v2/erledigt">Andere Tage ansehen →</a></p>
        </>
      ) : l.length ? <ul className="liste">{l.map(zeile)}</ul> : <p className="leer">{such ? `Nichts zu „${q.trim()}“ in dieser Liste.` : reiter === 'wartet' ? 'Kein Unter-Chat wartet auf dich.' : 'Gerade läuft nichts.'}</p>}
      {such && <p className="klein"><a href={`v2/chats?q=${encodeURIComponent(q.trim())}`}>„{q.trim()}“ in allen Chats suchen, auch alten →</a></p>}
    </div>
  );
}

/** Audit 05.11. (6): Unter-Chat direkt aus der 2.0 starten (vorher nur alte Werkbank oder Hauptchat) — dieselbe Route wie
 *  Workspace › Arbeit › Neuer Unter-Chat (Repo, Tiefe, Auftrag; Paket und G0 macht der Server). */
function UnterChatStarten({ fertig }: { fertig: () => void }) {
  const [offen, setOffen] = useState(false);
  const [opt, setOpt] = useState<{ repos: { name: string }[]; tiefen: string[]; dryRun: boolean } | null>(null);
  const [f, setF] = useState({ repo: '', tiefe: 'regular', titel: '', auftrag: '' });
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ text: string; url?: string } | null>(null);
  useEffect(() => { if (offen && !opt) hole<typeof opt>('api/arbeit/start').then((o) => { setOpt(o); setF((x) => ({ ...x, repo: x.repo || o?.repos[0]?.name || '' })); }).catch((e) => setMeldung({ text: String(e?.message ?? e) })); }, [offen]);
  const TIEFE: Record<string, string> = { quick: 'Kurz (~10 min)', regular: 'Normal (~45 min)', deep: 'Gründlich (~2 h)', live: 'Live-Runde' };
  if (!offen) return <p><button type="button" className="knopf" onClick={() => setOffen(true)}>Neuer Unter-Chat</button></p>;
  const starten = async () => {
    setLaeuft(true); setMeldung(null);
    try {
      const r = await schicke<{ id: string; warning?: string; g0?: { ergebnis: string } | null }>('api/arbeit/start', f);
      setMeldung({ text: r.g0 && r.g0.ergebnis !== 'ok' ? 'Gestoppt vor dem Bau (G0) — die Rückfrage steht unter Entscheidungen.' : `Gestartet${r.warning ? ` — ${r.warning}` : ''}.`, url: r.id ? `v2/arbeit/${r.id}` : undefined });
      setF((x) => ({ ...x, titel: '', auftrag: '' })); fertig();
    } catch (e: any) { setMeldung({ text: String(e?.message ?? e) }); } finally { setLaeuft(false); }
  };
  return (
    <form className="kasten start-form" aria-label="Neuer Unter-Chat" onSubmit={(e) => { e.preventDefault(); void starten(); }}>
      <p className="gruppe-titel">Neuer Unter-Chat</p>
      {opt?.dryRun && <p className="hinweis klein">Vorschau: hier startet kein Unter-Chat.</p>}
      <label className="klein">Repo <select value={f.repo} onChange={(e) => setF({ ...f, repo: e.target.value })}>{(opt?.repos ?? []).map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}</select></label>{' '}
      <label className="klein">Tiefe <select value={f.tiefe} onChange={(e) => setF({ ...f, tiefe: e.target.value })}>{(opt?.tiefen ?? ['regular']).map((t) => <option key={t} value={t}>{TIEFE[t] ?? t}</option>)}</select></label>
      <label className="klein">Titel (optional) <input type="text" value={f.titel} maxLength={100} onChange={(e) => setF({ ...f, titel: e.target.value })} /></label>
      <label className="klein">Auftrag <textarea rows={4} value={f.auftrag} maxLength={8000} placeholder="In ein, zwei Sätzen: was soll am Ende fertig sein?" onChange={(e) => setF({ ...f, auftrag: e.target.value })} /></label>
      <div className="knoepfe">
        <button type="submit" className="knopf haupt" disabled={laeuft || f.auftrag.trim().length < 10 || !f.repo}>{laeuft ? 'Startet …' : 'Starten'}</button>
        <button type="button" className="knopf leise" onClick={() => setOffen(false)}>Abbrechen</button>
      </div>
      {meldung && <p className="hinweis klein" role="status">{meldung.text}{meldung.url && <> · <a href={meldung.url}>Ansehen</a></>}</p>}
    </form>
  );
}

/** Audit 05.11. (7): Push-Freigabe in der 2.0 — derselbe Weg wie in der alten Werkbank (GET /api/review/:id, POST …/freigabe mit dem
 *  gesehenen Kopf und Patch-Id). Freigegeben wird nur genau dieser Stand; pushen tut danach der Agent über das Gate, nie mergen. */
interface RepoStand { branch: string | null; baseRef: string | null; head: string; clean: boolean; dirty: string[]; commits: { sha: string; subject: string }[]; more: number; stat: string; patchId: string | null; key: string | null; fehler?: undefined }
export function Freigabe({ id }: { id: string }) {
  const { d, fehler, neu } = useDaten<{ title: string; running: boolean; repo: RepoStand | { fehler: string }; freigaben: { id: string; head: string; branch: string; at: string; by: string; aktiv: boolean; pushedAt: string | null; revokedAt: string | null }[] }>(`api/review/${id}`);
  const [meldung, setMeldung] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  const r = d.repo;
  const frei = async () => {
    if (r.fehler !== undefined) return;
    setLaeuft(true); setMeldung(null);
    try { await schicke(`api/review/${id}/freigabe`, { head: r.head, patchId: r.patchId }); setMeldung('Freigegeben — der Unter-Chat pusht jetzt über das Gate.'); neu(); }
    catch (e: any) { setMeldung(String(e?.message ?? e)); } finally { setLaeuft(false); }
  };
  const zurueck = async (fid: string) => {
    try { await schicke(`api/review/${id}/freigabe/${fid}/zurueck`, {}); setMeldung('Freigabe zurückgezogen.'); neu(); } catch (e: any) { setMeldung(String(e?.message ?? e)); }
  };
  const aktiv = d.freigaben.find((f) => f.aktiv && !f.pushedAt && r.fehler === undefined && f.head === r.head);
  return (
    <div className="seite">
      <h1>Freigeben: {d.title}</h1>
      <p className="klein"><a href={`v2/arbeit/${id}`}>← Unter-Chat</a></p>
      {r.fehler !== undefined ? <p className="fehlertext">{r.fehler}</p> : <>
        <Abschnitt id="f-stand" titel="Was gepusht würde" erklaerung="Genau dieser Stand: Zweig, Commits und geänderte Dateien gegenüber der Basis. Ändert sich der Stand, gilt die Freigabe nicht mehr.">
          <p><b>{r.key ?? '?'}</b> · Zweig <code>{r.branch ?? '—'}</code> → Basis <code>{r.baseRef ?? '—'}</code> · Kopf <code>{r.head.slice(0, 7)}</code></p>
          {!r.clean && <p className="fehlertext">Ungespeicherte Änderungen im Arbeitsordner ({r.dirty.length}) — erst committen lassen.</p>}
          {d.running && <p className="hinweis">Der Unter-Chat arbeitet gerade — freigeben geht erst, wenn er fertig ist.</p>}
          <ul className="liste">{r.commits.map((c) => <li key={c.sha}><code>{c.sha.slice(0, 7)}</code> {c.subject}</li>)}{r.more > 0 && <li className="gedimmt">… und {r.more} weitere</li>}</ul>
          {r.stat && <pre className="kasten diffstat">{r.stat}</pre>}
        </Abschnitt>
        <div className="knoepfe">
          {aktiv ? <p className="hinweis klein">Schon freigegeben ({wann(aktiv.at)}) — wartet auf den Push. <button type="button" className="knopf leise klein" onClick={() => void zurueck(aktiv.id)}>Zurückziehen</button></p>
            : <button type="button" className="knopf haupt" disabled={laeuft || !r.clean || d.running || !r.patchId} onClick={() => void frei()}>{laeuft ? 'Gibt frei …' : `Push freigeben (${r.head.slice(0, 7)})`}</button>}
        </div>
      </>}
      {meldung && <p className="hinweis klein" role="status">{meldung}</p>}
      {d.freigaben.length > 0 && <Abschnitt id="f-frueher" titel="Frühere Freigaben" erklaerung="Was zu diesem Unter-Chat schon freigegeben oder gepusht wurde.">
        <ul className="liste">{d.freigaben.map((f) => <li key={f.id} className="klein"><code>{f.head.slice(0, 7)}</code> {f.branch} · {wann(f.at)} · {f.pushedAt ? 'gepusht' : f.revokedAt ? 'zurückgezogen' : 'wartet auf den Push'}</li>)}</ul>
      </Abschnitt>}
    </div>
  );
}

export function ArbeitDetail({ id }: { id: string }) {
  const app = useApp();
  const { d, fehler, neu } = useDaten<{ titel: string; satz: string; gruppe: string; zuletzt: string | null; stand: string; fragen: Karte[]; nachrichten: { id: string; rolle: string; text: string; at: string }[]; links: Link[];
    abgleich?: { offenListe: string[]; offenBericht: string[]; agentNennt: string[]; zeilen: { d: string; bericht: string | null; wiederOffen: boolean }[] } | null; steckbrief?: Steckbrief }>(`api/v2/arbeit/${id}`);
  const [alle, setAlle] = useState(false);
  const [verlauf, setVerlauf] = useState(false);
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  const msgs = alle ? d.nachrichten : d.nachrichten.slice(-3);
  return (
    <div className="seite">
      <p className="zurueck"><a href="v2/arbeit">← Arbeit</a></p>
      <h1>{d.titel}</h1>
      {/* Radikal simpel: ist für dich nichts mehr offen, steht genau das da — ein Satz, kein zweiter Kasten. */}
      {d.abgleich && !d.abgleich.offenListe.length && !d.fragen.length
        ? <p className="zustand fertig">Für dich ist hier nichts offen — deine Antworten sind beim Agenten; Bericht und Stand zieht er beim nächsten Zug nach.</p>
        : <p className={`zustand ${d.gruppe}`}>{d.satz}</p>}
      {d.steckbrief && <SteckbriefKasten s={d.steckbrief} titel={d.titel} id={id} />}
      <Nachreichen id={id} />
      <div className="aktionen-zeile"><Verweise links={d.links.filter((l) => !l.extern)} /></div>
      {d.abgleich && d.abgleich.offenListe.length > 0 && <Abgleich a={d.abgleich} />}
      {d.fragen.length > 0 && (
        <Abschnitt id="d-fragen" titel={d.fragen.length === 1 ? 'Diese Frage ist in deiner Liste offen' : 'Diese Fragen sind in deiner Liste offen'} erklaerung="Fragen aus diesem Unter-Chat, die noch auf deine Antwort warten. Sagt der Agent unten etwas anderes, gilt deine Antwort hier — sie geht direkt an ihn.">
          <div className="karten">{d.fragen.map((k) => <EntscheidungKarte key={k.id} k={k} beantwortet={() => app.zahl(null)} />)}</div>
        </Abschnitt>
      )}
      {d.stand && <details className="kasten stand-auf" open={!d.fragen.length && !d.abgleich}><summary>Letzter Stand des Agenten{d.abgleich && !d.abgleich.offenListe.length ? ' — geschrieben vor deinen Antworten' : ''}</summary><Md text={d.stand} /></details>}
      {d.nachrichten.length > 0 && !verlauf && <p><button type="button" className="knopf leise klein" onClick={() => setVerlauf(true)}>Verlauf des Unter-Chats zeigen</button></p>}
      {d.nachrichten.length > 0 && verlauf && (
        <Abschnitt id="d-verlauf" titel="Verlauf" erklaerung="Die letzten Nachrichten dieses Unter-Chats." fuss={d.nachrichten.length > 3 ? <button type="button" className="knopf leise klein" onClick={() => setAlle(!alle)}>{alle ? 'Nur die letzten 3' : `Alle ${d.nachrichten.length} zeigen`}</button> : null}>
          {msgs.map((n) => <div key={n.id} className={`blase ${n.rolle}`}><p className="klein gedimmt">{n.rolle === 'ich' ? 'Du / Auftrag' : 'Agent'} · {wann(n.at)}</p><Md text={(n.rolle === 'ich' ? n.text : ohneStatuszeilen(n.text)).slice(0, 6000)} klein /></div>)}
        </Abschnitt>
      )}
    </div>
  );
}

/** Runde 7 (Knut: DoD): liegen gebliebene Enden — was fertig gemeldete Unter-Chats noch offen lassen, je mit Besitzer. */
/** Plan §24 A4: was die Hauptsitzung erledigen muss (Live-Gang nach Commit, Deploy-Go …) — aus den Stand-Blöcken, abhakbar. */
interface Bedarf { id: string; art: string; artName: string; text: string; pfad: string | null; strang: { id: string; titel: string }; at: string }
function HauptsitzungListe() {
  const { d, neu } = useDaten<{ punkte: { key: string; strand: string; titel: string; text: string; erledigt: boolean }[]; bedarf?: Bedarf[] }>('api/v2/hauptsitzung');
  const offen = (d?.punkte ?? []).filter((p) => !p.erledigt);
  const bedarf = d?.bedarf ?? [];
  if (!offen.length && !bedarf.length) return null;
  const haken = async (key: string) => { await schicke(`api/v2/hauptsitzung/${encodeURIComponent(key)}`, { erledigt: true }).catch(() => null); neu(); };
  return (
    <section className="abschnitt hauptsitzung">
      <h2>Für die Hauptsitzung ({offen.length + bedarf.length})</h2>
      {/* Bedarfskanal (Knut 06.11.): was Unter-Chats brauchen — sie arbeiten inzwischen am Rest weiter. */}
      {bedarf.length > 0 && <ul className="liste">{bedarf.map((b) => <BedarfZeile key={b.id} b={b} fertig={neu} />)}</ul>}
      <ul className="liste">{offen.map((p) => (
        <li key={p.key} className="zeile"><label><input type="checkbox" onChange={() => haken(p.key)} /> {p.text}</label> <a className="klein gedimmt" href={`v2/arbeit/${p.strand}`}>{p.titel}</a></li>
      ))}</ul>
    </section>
  );
}

/** Ein Bedarf eines Unter-Chats: Erteilen (bei Zugang mit Frist) · Erledigt (mit Notiz, z. B. Beleg) · Ablehnen (mit Grund). */
function BedarfZeile({ b, fertig }: { b: Bedarf; fertig: () => void }) {
  const [notiz, setNotiz] = useState('');
  const [dauer, setDauer] = useState(240);
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);
  const antworten = async (antwort: 'erteilt' | 'erledigt' | 'abgelehnt') => {
    if (laeuft) return;
    setLaeuft(true); setMeldung(null);
    try { await schicke(`api/v2/bedarf/${encodeURIComponent(b.id)}`, { antwort, notiz, ...(b.art === 'zugang' ? { dauerMin: dauer } : {}) }); setMeldung('Geht an den Unter-Chat.'); setTimeout(fertig, 700); }
    catch (e: any) { setMeldung(String(e?.message ?? e)); setLaeuft(false); }
  };
  const erteilbar = b.art === 'zugang' || b.art === 'entscheidung';   // wie ERTEILBAR (bedarf.ts): sonst selbst erledigen oder ablehnen
  return (
    <li className="zeile bedarf">
      <div className="zeile-haupt">
        <p><span className="marke warn">{b.artName}</span> {b.text}{b.pfad ? <> — <code>{b.pfad}</code></> : null}</p>
        <p className="klein gedimmt"><a href={`v2/arbeit/${b.strang.id}`}>{b.strang.titel || b.strang.id}</a> · {wann(b.at)}</p>
        <input type="text" className="notiz" value={notiz} maxLength={1000} placeholder={b.art === 'github' || b.art === 'merge' ? 'Beleg (z. B. Link zum Kommentar, Commit) oder Grund' : 'Notiz an den Unter-Chat (optional)'} onChange={(e) => setNotiz(e.target.value)} />
        <div className="knoepfe" aria-busy={laeuft}>
          {erteilbar && <button type="button" className="knopf haupt" disabled={laeuft} onClick={() => antworten('erteilt')}>Erteilen</button>}
          {b.art === 'zugang' && <select value={dauer} onChange={(e) => setDauer(Number(e.target.value))} aria-label="Wie lange"><option value={60}>1 h</option><option value={240}>4 h</option><option value={1440}>24 h</option></select>}
          <button type="button" className={erteilbar ? 'knopf' : 'knopf haupt'} disabled={laeuft} onClick={() => antworten('erledigt')}>Erledigt</button>
          <button type="button" className="knopf leise" disabled={laeuft} onClick={() => antworten('abgelehnt')}>Ablehnen</button>
        </div>
        {meldung && <p className="hinweis klein" role="status">{meldung}</p>}
      </div>
    </li>
  );
}

function Enden({ kurz = false }: { kurz?: boolean }) {
  const app = useApp();
  const { d } = useDaten<{ enden: { strand: string; titel: string; text: string; besitzer: string | null }[] }>(app.ich.admin ? 'api/v2/enden' : null);
  const l = d?.enden ?? [];
  if (!l.length) return null;
  if (kurz) return <p className="klein hinweis-warn"><a href="v2/arbeit#fertig">{l.length === 1 ? 'Ein Ende ist' : `${l.length} Enden sind`} liegen geblieben — fertig gemeldet, aber noch nicht ganz zu Ende →</a></p>;
  return (
    <div className="kasten enden">
      <p className="gruppe-titel">Liegen gebliebene Enden</p>
      <ul className="klein">{l.slice(0, 15).map((e, i) => <li key={i}>{e.besitzer ? <b>{e.besitzer}: </b> : null}{e.text} — <a href={`v2/arbeit/${e.strand}`}>{e.titel}</a></li>)}</ul>
    </div>
  );
}

/** Runde 7 (Abgleich: „Nachreichen an einen laufenden Unter-Chat“ fehlte in 2.0, 148× genutzt). Läuft er, liest er es im Zug. */
function Nachreichen({ id }: { id: string }) {
  const [offen, setOffen] = useState(false);
  const [text, setText] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);
  if (!offen) return <p><button type="button" className="knopf leise klein" onClick={() => { setOffen(true); setMeldung(null); }}>Dem Unter-Chat etwas schreiben …</button>{meldung && <span className="ok klein" role="status"> {meldung}</span>}</p>;
  return (
    <div className="anders">
      <label className="klein" htmlFor={`nach-${id}`}>Nachricht an den Unter-Chat — läuft er gerade, liest er sie noch in diesem Zug</label>
      <textarea id={`nach-${id}`} rows={3} value={text} maxLength={8000} onChange={(e) => setText(e.target.value)} placeholder="z. B. „Bitte zuerst die Tests, dann der Bericht.“" autoFocus />
      <div className="antworten">
        <button type="button" className="knopf haupt" disabled={laeuft || !text.trim()} onClick={async () => { setLaeuft(true); try { await schicke(`api/v2/arbeit/${id}/nachricht`, { text }); setText(''); setOffen(false); setMeldung('✓ Zugestellt.'); } catch (e: any) { setMeldung(e.message); setOffen(false); } finally { setLaeuft(false); } }}>{laeuft ? 'Sendet …' : 'Senden'}</button>
        <button type="button" className="knopf leise" onClick={() => setOffen(false)}>Abbrechen</button>
      </div>
    </div>
  );
}

interface Steckbrief { wofuer: string; gestartet: string | null; ueber: string | null; jetzt: string | null; laeuft: boolean; seit: number | null; schritte: { text: string; stand: 'fertig' | 'offen' }[]; eta: { text: string; ueberfaellig: boolean } | null;
  wartetAuf: { wer: string; was: string }[]; ergebnisse: Link[];
  dod?: { zeilen: { text: string; haken: boolean; beleg: string | null; besitzer: string | null; erledigt: boolean }[]; folgen: { text: string; besitzer: string | null }[] }; fast?: { fehlt: string[]; wartetAuf: string[] } | null; ruhtMin?: number | null; eingereiht?: { at: string; grund: string }[]; beruehrt: { repos: string[]; text: string | null; ordner: string | null; dateien: string[] }; modell: string | null; laufzeitMin: number | null; zugTokens: number | null; laeufer?: { wer: string; grund: string | null } | null }

const dauer = (min: number) => (min < 90 ? `${min} min` : min < 60 * 48 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} Tage`);
/** Runde 7 (Knut: „Unterchats sind halt etwas intransparent“): in 10 Sekunden sehen, was ein Unter-Chat gerade tut — ohne den Chat
 *  zu öffnen. Wofür · Jetzt gerade · Fortschritt · Wartet auf · Ergebnisse · Berührt · Modell/Laufzeit · „Was macht der gerade?“. */
function SteckbriefKasten({ s, titel, id }: { s: Steckbrief; titel: string; id: string }) {
  const app = useApp();
  const fertig = s.schritte.filter((x) => x.stand === 'fertig').length;
  return (
    <div className="kasten steckbrief">
      <dl>
        <div><dt>Wofür</dt><dd>{s.wofuer}{s.gestartet ? <span className="klein gedimmt"> — gestartet {wann(s.gestartet)}{s.ueber ? ` über „${s.ueber}“` : ''}</span> : null}</dd></div>
        {s.laeufer && <div><dt>Läuft mit</dt><dd>{s.laeufer.wer}{s.laeufer.grund ? <span className="klein gedimmt"> — {s.laeufer.grund}</span> : null}</dd></div>}
        <div><dt>Jetzt gerade</dt><dd>{s.laeuft && <span className="live" aria-label="läuft">● </span>}{s.jetzt ?? (s.laeuft ? 'arbeitet' : s.ruhtMin != null ? `ruht seit ${dauer(s.ruhtMin)} — kein Zug läuft` : 'ruht gerade — kein Zug läuft')}{s.seit ? <span className="klein gedimmt"> (seit {dauer(Math.max(1, Math.round((Date.now() - s.seit) / 60000)))})</span> : null}</dd></div>
        {s.schritte.length > 0 && <div><dt>Fortschritt</dt><dd>
          <p className="klein gedimmt">{fertig} von {s.schritte.length} Schritten{s.eta && s.laeuft ? ` · ${s.eta.ueberfaellig ? 'überfällig — dauert länger als geschätzt' : `fertig ${s.eta.text}`}` : ''}</p>
          <ul className="schritte">{s.schritte.map((x, i) => <li key={i} className={x.stand}>{x.stand === 'fertig' ? '✓' : '○'} {x.text}</li>)}</ul>
        </dd></div>}
        {s.dod && s.dod.zeilen.length > 0 && <div><dt>Fertig, wenn</dt><dd>
          {s.fast && <p className="klein hinweis-warn">Fast fertig — fehlt: {s.fast.fehlt.join('; ')}{s.fast.wartetAuf.length ? `; wartet auf: ${s.fast.wartetAuf.join(', ')}` : ''}</p>}
          <ul className="schritte">{s.dod.zeilen.map((z, i) => <li key={i} className={z.erledigt ? 'fertig' : 'offen'}>{z.erledigt ? '✓' : '○'} {z.text}{z.beleg ? <span className="gedimmt"> — {z.beleg}</span> : z.haken ? <span className="gedimmt"> — Beleg fehlt</span> : null}{z.besitzer ? <b> ({z.besitzer})</b> : null}</li>)}</ul>
          {s.dod.folgen.length > 0 && <p className="klein">Folge-Aufgaben: {s.dod.folgen.map((f) => `${f.text}${f.besitzer ? ` (${f.besitzer})` : ''}`).join(' · ')}</p>}
        </dd></div>}
        <div><dt>Wartet auf</dt><dd>{s.wartetAuf.length ? s.wartetAuf.map((w, i) => <p key={i} className="klein"><b>{w.wer}:</b> {w.was}</p>) : 'niemanden'}</dd></div>
        {/* Plan §24 A1: Nachrichten, die warten mussten — die Werkbank stellt sie beim nächsten freien Zug selbst zu. */}
        {!!s.eingereiht?.length && <div><dt>Eingereiht</dt><dd className="klein">{s.eingereiht.length === 1 ? 'Eine Nachricht' : `${s.eingereiht.length} Nachrichten`} seit {wann(s.eingereiht[0].at)} — kommt beim nächsten freien Zug an ({s.eingereiht[0].grund})</dd></div>}
        {s.ergebnisse.length > 0 && <div><dt>Ergebnisse</dt><dd className="verweise">{s.ergebnisse.map((l, i) => l.url ? <Verweis key={i} l={l} /> : <span key={i} className="verweis">{l.label}</span>)}</dd></div>}
        {(s.beruehrt.repos.length > 0 || s.beruehrt.text || s.beruehrt.dateien.length > 0) && <div><dt>Berührt</dt><dd className="klein">{[s.beruehrt.repos.join(', '), s.beruehrt.text, s.beruehrt.dateien.length ? `zuletzt geschrieben: ${s.beruehrt.dateien.join(', ')}` : ''].filter(Boolean).join(' · ')}</dd></div>}
        <div><dt>Modell · Laufzeit</dt><dd className="klein">{[s.modell, s.laufzeitMin != null ? `gestartet vor ${dauer(s.laufzeitMin)}` : null, s.zugTokens ? `dieser Zug ≈ ${Math.round(s.zugTokens / 1000)}k Tokens` : null].filter(Boolean).join(' · ') || '—'}</dd></div>
      </dl>
      <button type="button" className="knopf klein" onClick={() => app.chat(`Was macht der Unter-Chat „${titel}“ (${id}) gerade? Fass in drei Sätzen zusammen: was er tut, was fertig ist, was er von mir braucht.`)}>Was macht der gerade?</button>
      <EntschiedenListe strand={id} kurz />
    </div>
  );
}

// ---------- Plan §23 T5: „Von Claude entschieden“ — sichtbar und mit einem Klick umkehrbar ----------

interface EntschiedenZeile { id: string; frage: string; antwort: string; at: string; strand: { id: string; titel: string } | null; widerruf: { at: string; text: string } | null; widerrufbar: boolean; widerrufGrund: string | null; council: { urteil: string; satz?: string } | null }

function EntschiedenListe({ strand, kurz: knapp }: { strand?: string; kurz?: boolean }) {
  const { d, fehler, neu } = useDaten<{ zeilen: EntschiedenZeile[] }>(`api/v2/entschieden${strand ? `?strand=${encodeURIComponent(strand)}` : ''}`);
  const [meldung, setMeldung] = useState<string | null>(null);
  if (fehler) return knapp ? null : <Fehler text={fehler} nochmal={neu} />;
  if (!d) return knapp ? null : <Laedt />;
  if (!d.zeilen.length) return knapp ? null : <p className="leer">Claude hat in den letzten 30 Tagen nichts selbst entschieden.</p>;
  const umkehren = async (z: EntschiedenZeile) => {
    try { await schicke(`api/v2/entschieden/${encodeURIComponent(z.id)}/umkehren`, {}); setMeldung(`Umgekehrt — „${z.frage}“ geht an ${z.strand ? `den Unter-Chat „${z.strand.titel}“` : 'den Hauptchat'}.`); neu(); }
    catch (e: any) { setMeldung(String(e?.message ?? e)); }
  };
  return (
    <section className={knapp ? 'entschieden kurz' : 'entschieden'}>
      {knapp && <h3>Von Claude entschieden ({d.zeilen.length})</h3>}
      {meldung && <p className="hinweis" role="status">{meldung}</p>}
      <ul className="liste">{d.zeilen.slice(0, knapp ? 5 : 200).map((z) => (
        <li key={z.id} className="zeile">
          <p className="zeile-titel">{z.frage}</p>
          <p className="klein">{z.antwort}{z.council ? ` · Council: ${z.council.urteil}${z.council.satz ? ` — ${z.council.satz}` : ''}` : ''}{!strand && z.strand ? ` · ${z.strand.titel}` : ''} · {wann(z.at)}</p>
          {z.widerruf ? <p className="klein gedimmt">Umgekehrt {wann(z.widerruf.at)}: {z.widerruf.text}</p>
            : z.widerrufbar ? <button type="button" className="knopf klein" onClick={() => umkehren(z)}>Umkehren</button>
            : <p className="klein gedimmt">{z.widerrufGrund}</p>}
        </li>))}</ul>
    </section>
  );
}

export function Entschieden() {
  return (
    <div className="seite">
      <p><a href="v2/entscheidungen">← Für dich</a></p>
      <h1>Von Claude entschieden</h1>
      <p className="unterzeile">Technische und interne Fragen entscheidet Claude nach Empfehlung, gewichtige erst nach einem Council-Check. Alles hier ist umkehrbar: „Umkehren“ schickt es an den Unter-Chat zurück.</p>
      <EntschiedenListe />
    </div>
  );
}

/** Runde 4 (Knut B2): Liste, Bericht und Agent nennen verschiedene offene Fragen — sagen, was gilt, und woher der Unterschied kommt. */
function Abgleich({ a }: { a: NonNullable<{ offenListe: string[]; offenBericht: string[]; agentNennt: string[]; zeilen: { d: string; bericht: string | null; wiederOffen: boolean }[] }> }) {
  const liste = (l: string[]) => (l.length ? l.join(', ') : 'keine');
  const wieder = a.zeilen.filter((z) => z.bericht && z.wiederOffen).map((z) => z.d), schon = a.zeilen.filter((z) => z.bericht && !z.wiederOffen).map((z) => z.d);
  const fehlt = a.offenBericht.filter((x) => a.offenListe.includes(x) && !a.agentNennt.includes(x));
  return (
    <div className="kasten abgleich" role="note">
      {a.offenListe.length ? <p><b>Was gilt:</b> deine Liste — {mehrzahl(a.offenListe.length, 'Frage', 'Fragen')} offen ({liste(a.offenListe)}). Nur eine Antwort hier erreicht den Agenten.</p>
        : <p><b>Was gilt:</b> In deiner Liste ist zu diesem Unter-Chat nichts mehr offen — deine Antworten sind beim Agenten. Du musst hier nichts tun; Bericht und Stand zieht der Agent beim nächsten Zug nach.</p>}
      <ul className="klein">
        <li>Der Bericht nennt als offen: {liste(a.offenBericht)}.</li>
        <li>Der Agent nennt in seinem letzten Stand: {liste(a.agentNennt)}{fehlt.length && a.agentNennt.length ? ` — ${fehlt.join(', ')} hat er dort nicht erwähnt, sie sind aber auch im Bericht offen` : ''}.</li>
        {wieder.length > 0 && <li>{wieder.join(', ')}: im Bericht schon entschieden, du hast sie wieder geöffnet — beantworte sie unten oder lass sie stehen.</li>}
        {schon.length > 0 && <li>{schon.join(', ')}: im Bericht schon entschieden, in deiner Liste noch offen — „Ja, so“ bestätigt die Entscheidung.</li>}
      </ul>
    </div>
  );
}

// ---------- PRs ----------

export function Prs({ wer }: { wer: string | null }) {
  const pfad = `api/v2/prs${wer ? `?wer=${encodeURIComponent(wer)}` : ''}`;
  useEffect(() => { try { sessionStorage.setItem('v2-prs-liste', `v2/prs${wer ? `?wer=${encodeURIComponent(wer)}` : ''}`); } catch { /* egal */ } }, [wer]);   // Runde 3 (B6): „← PRs“ kommt zur selben Auswahl zurück
  const [such, setSuch] = useState('');
  const [mitEntwurf, setMitEntwurf] = useState(false);
  const [thema, setThema] = useState<string | null>(null);
  const { d, fehler, neu } = useDaten<{ gesperrt?: boolean; wer: string; ich: string; personen: { name: string; anzahl: number }[]; zeilen: PrZeile[]; stand: string | null }>(pfad);
  // Suche geht immer über alle offenen PRs (Persona Christoph R2: #268 stand nicht in „mich“).
  const alle = useDaten<{ zeilen: PrZeile[] }>(such.trim() && wer !== 'alle' ? 'api/v2/prs?wer=alle' : null);
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  if (d.gesperrt) return <div className="seite"><h1>PRs</h1><p className="leer">PRs sind für dich noch nicht freigegeben — frag Knut.</p></div>;
  const suche = such.trim().toLowerCase();
  const entwuerfe = d.zeilen.filter((p) => p.entwurf).length;
  const basis = mitEntwurf ? d.zeilen : d.zeilen.filter((p) => !p.entwurf);
  const passt = (p: PrZeile) => `${p.pr} ${p.titel}`.toLowerCase().includes(suche.replace(/^#/, ''));
  const zeilen = (suche ? basis.filter(passt) : basis).filter((p) => !thema || p.thema === thema);
  const sonst = suche ? (alle.d?.zeilen ?? []).filter((p) => passt(p) && !zeilen.some((z) => z.pr === p.pr)) : [];
  const wahl = (n: string) => { const url = n === d.ich ? 'v2/prs' : `v2/prs?wer=${encodeURIComponent(n)}`; history.pushState(null, '', url); window.dispatchEvent(new PopStateEvent('popstate')); };
  return (
    <div className="seite">
      <h1>PRs</h1>
      <p className="unterzeile">Code-Vorschläge auf GitHub und wer gerade dran ist.{d.stand ? ` Stand: ${wann(d.stand)}` : ''}</p>
      <ThemenLeiste aktiv={thema} wahl={setThema} />
      <div className="filter">
        <label htmlFor="wer">Wartet auf</label>
        <select id="wer" value={d.wer} onChange={(e) => wahl(e.target.value)}>
          {d.personen.map((p) => <option key={p.name} value={p.name}>{p.name === 'alle' ? 'alle (offen)' : p.name === d.ich ? `mich (${p.name})` : p.name}</option>)}
        </select>
        <label htmlFor="pr-such" className="unsichtbar">PR suchen</label>
        <input id="pr-such" type="search" value={such} onChange={(e) => setSuch(e.target.value)} placeholder="Nummer oder Titel, z. B. 268" />
        {entwuerfe > 0 && <label className="klein"><input type="checkbox" checked={mitEntwurf} onChange={(e) => setMitEntwurf(e.target.checked)} /> Entwürfe zeigen</label>}
      </div>
      {zeilen.length ? <ul className="liste">{zeilen.map((p) => <PrZeileView key={p.pr} p={p} />)}</ul>
        : suche && sonst.length ? null
        : suche ? <p className="leer">Kein offener PR passt zu „{such}“.</p> : <p className="leer">{d.wer === d.ich ? 'Kein PR wartet auf dich.' : `Kein PR wartet auf ${d.wer}.`}</p>}
      {sonst.length > 0 && <><p className="gruppe-titel">In anderen Listen gefunden</p><ul className="liste">{sonst.slice(0, 10).map((p) => <PrZeileView key={p.pr} p={p} />)}</ul></>}
    </div>
  );
}

/** Grob: ist der Satz englisch? (Der Prüf-Agent schreibt auf GitHub englisch — dann sagen wir es, statt es mitten ins Deutsche zu setzen.) */
const englisch = (t: string) => (t.match(/\b(the|and|were|with|of|executed|applied|which|this)\b/g) ?? []).length >= 3;   // keine deutsch-englischen Wörter wie „was“, „Test“ (Pass C)

/** Knut 05.11. abends (1): Review · Tiefes Review · Fixen · Auftrag … — reiht in die Review- bzw. Fix-Schlange ein. */
function PrAktionen({ pr, fertig }: { pr: string; fertig: () => void }) {
  const app = useApp();
  const [auftrag, setAuftrag] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);
  if (!app.ich.admin) return null;
  const los = async (art: 'review' | 'tief' | 'fixen' | 'auftrag', text = '') => {
    try { const r = await schicke<{ hinweis: string }>('api/v2/pr-aktion', { pr, art, text }); setMeldung(r.hinweis); setAuftrag(null); setTimeout(fertig, 1500); }
    catch (e: any) { setMeldung(String(e?.message ?? e)); }
  };
  return (
    <div className="kasten pr-aktionen">
      <p className="klein"><b>Ein Unter-Chat soll ran:</b></p>
      <div className="knoepfe">
        <button type="button" className="knopf" onClick={() => los('review')}>Review</button>
        <button type="button" className="knopf" onClick={() => los('tief')} title="mehrere Durchgänge, Council, zweites Modell">Tiefes Review</button>
        <button type="button" className="knopf" onClick={() => los('fixen')} title="offene Review-Punkte beheben; Push nur über Prüfung und Freigabe">Fixen</button>
        <button type="button" className="knopf leise" onClick={() => setAuftrag(auftrag === null ? '' : null)}>Auftrag …</button>
      </div>
      {auftrag !== null && <div className="anders"><textarea rows={2} placeholder="Was soll an diesem PR passieren?" value={auftrag} onChange={(e) => setAuftrag(e.target.value)} /><button type="button" className="knopf haupt klein" onClick={() => los('auftrag', auftrag)}>Unter-Chat starten</button></div>}
      {meldung && <p className="hinweis klein" role="status">{meldung}</p>}
    </div>
  );
}

export function PrDetail({ repo, nummer }: { repo: string; nummer: string }) {
  const app = useApp();
  const { d, fehler, neu } = useDaten<{ pr: string; titel: string; url: string | null; autor: string | null; offen: boolean; merge: boolean; wartetAuf: string[]; warum: string; entscheidung: string | null; offeneThreads: number; reviews: { wer: string; zustand: string; at: string }[];
    verlangt?: { wer: string[]; unbekannt: boolean }; fix?: { at: string | null; lesbar: boolean; gesamt: number; status: string | null; offen: { wer: string; art: string; wo: string | null; text: string; grund: string | null; notiz: string | null }[] } | null; agent: { status: string; empfehlung: string | null; text: string | null; kurz?: { satz: string; befunde: number } | null; gepostet: string | null; entwurf: boolean; at: string; bericht: string | null } | null }>(`api/v2/prs/${encodeURIComponent(repo)}/${nummer}`);
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  const ZUSTAND: Record<string, string> = { APPROVED: 'freigegeben', CHANGES_REQUESTED: 'Änderungen verlangt', COMMENTED: 'kommentiert', DISMISSED: 'zurückgezogen' };
  return (
    <div className="seite">
      <p className="zurueck"><a href={(() => { try { return sessionStorage.getItem('v2-prs-liste') || 'v2/prs'; } catch { return 'v2/prs'; } })()}>← PRs</a></p>
      <h1>{d.pr} · {d.titel}</h1>
      <p className="zustand">{!d.offen ? 'Nicht mehr offen — gemergt oder geschlossen.' : d.merge ? 'Freigegeben — wartet auf den Merge (macht ein Mensch auf GitHub).' : d.wartetAuf.length ? `Wartet auf ${d.wartetAuf.join(', ')} — ${d.warum}.` : `${d.warum || 'Wartet auf niemanden'}.`}</p>
      {d.entscheidung === 'CHANGES_REQUESTED' && <p className="zustand">{d.verlangt?.wer.length ? `Änderungen verlangt von ${d.verlangt.wer.join(', ')}.` : 'GitHub meldet „Änderungen verlangt“. Wer das verlangt hat, steht nicht in unserer Kopie — das Review ist älter als die letzten, die wir lesen; auf GitHub steht es.'}</p>}
      {d.agent?.text && d.agent.kurz?.satz && (
        <div className="kasten kurzurteil">
          <p><b>Urteil des Prüf-Agenten:</b> <span className={`marke ${d.agent.empfehlung === 'approve' ? 'gruen' : 'warn'}`}>{(EMPFEHLUNG[d.agent.empfehlung ?? ''] ?? 'Prüfung').replace(/^Prüfung: /, '')}</span>{d.agent.kurz.befunde ? ` · ${mehrzahl(d.agent.kurz.befunde, 'Befund', 'Befunde')}` : ''}</p>
          <p>{englisch(d.agent.kurz.satz) && <span className="klein gedimmt">Wie getestet (Originaltext, englisch): </span>}{d.agent.kurz.satz} <a href="#p-agent">Ganzes Review ↓</a></p>
        </div>
      )}
      <div className="aktionen-zeile">
        {d.url && <a className="verweis" href={d.url} target="_blank" rel="noopener noreferrer">Auf GitHub öffnen ↗</a>}
        {d.agent?.bericht && <a className="verweis" href={rel(d.agent.bericht)}>Bericht des Reviews</a>}
        <button type="button" className="knopf leise klein" onClick={() => app.chat(chatFrage(`PR ${d.pr}`, d.titel))}>Im Chat nachfragen</button>
      </div>
      {/* Knut 05.11. abends (1): Aktionen je PR — jede reiht einen Strang ein; Push/Merge gibt es hier nicht. */}
      {!!(d as any).straenge?.length && <p className="hinweis klein" role="status">{((d as any).straenge as { id: string; titel: string; zustand: string }[]).map((s, i) => <span key={s.id}>{i ? ' · ' : ''}Unter-Chat <a href={`v2/arbeit/${s.id}`}>„{s.titel}“</a> arbeitet daran — {s.zustand}</span>)}</p>}
      {d.offen && <PrAktionen pr={d.pr} fertig={neu} />}
      <div className="aktionen-zeile">
      </div>
      {d.fix && (
        <Abschnitt id="p-fix" titel={!d.fix.lesbar ? 'Letzter Fix: offene Punkte nicht prüfbar' : d.fix.offen.length ? `Nach dem letzten Fix offen (${d.fix.offen.length} von ${d.fix.gesamt})` : 'Letzter Fix: alle offenen Punkte abgehakt'}
          erklaerung="Vor jedem Push eines automatischen Fixes sammelt der Workspace alle offenen Kommentare und ungelösten Threads von jedem Reviewer ein und hakt sie gegen den Fix ab. Was danach offen ist, steht hier — und im Kommentar am PR.">
          {!d.fix.lesbar ? <p className="leer">Der PR war beim Push nicht lesbar — die offenen Punkte bitte auf GitHub prüfen.</p>
            : d.fix.offen.length ? <ul className="liste">{d.fix.offen.map((x, i) => <li key={i} className="zeile"><div className="zeile-haupt"><b>{x.wer}</b>{x.wo ? <> · <code>{x.wo}</code></> : x.art === 'review' ? ' · Review' : ' · Kommentar'}<p className="zeile-satz">{x.text}</p><p className="klein gedimmt">{GRUND[x.grund ?? ''] ?? 'offen'}{x.notiz ? `: ${x.notiz}` : ''}</p></div><div className="zeile-rechts"><span className="zeit">{wann(d.fix!.at)}</span></div></li>)}</ul>
            : <p className="leer">Alle {d.fix.gesamt} Punkte hat der Fix erledigt (mit Commit im Push).</p>}
        </Abschnitt>
      )}
      <Abschnitt id="p-menschen" titel="Reviews von Menschen" erklaerung="Wer den PR auf GitHub geprüft hat und mit welchem Ergebnis.">
        {d.reviews.length ? <ul className="liste">{d.reviews.map((r, i) => <li key={i} className="zeile"><div className="zeile-haupt"><b>{r.wer}</b> · {ZUSTAND[r.zustand] ?? r.zustand}</div><div className="zeile-rechts"><span className="zeit">{wann(r.at)}</span></div></li>)}</ul> : <p className="leer">Noch kein Review von einem Menschen.</p>}
        {d.offeneThreads > 0 && <p className="klein">{mehrzahl(d.offeneThreads, 'offener Kommentar-Faden', 'offene Kommentar-Fäden')} auf GitHub.</p>}
        {d.autor && <p className="klein gedimmt">Geschrieben von {d.autor}.</p>}
      </Abschnitt>
      <Abschnitt id="p-agent" titel="Review des Agenten" erklaerung="Was der Review-Agent zu diesem PR geschrieben hat — derselbe Text, der auf GitHub steht. Du brauchst dafür kein GitHub-Konto.">
        {(d.agent as any)?.aktuell === false && <p className="hinweis klein" role="note">Dieses Review gilt für Commit {(d.agent as any).kopf}; der PR steht inzwischen auf {(d.agent as any).neuerKopf}. Ein neues Review stellt die Werkbank von selbst an (höchstens 3 am Tag){app.ich.admin ? ' — oder oben „Review“ drücken' : ''}.</p>}
        {d.agent?.text ? (
          <div className="kasten">
            <p><span className={`marke ${d.agent.empfehlung === 'approve' ? 'gruen' : 'warn'}`}>{EMPFEHLUNG[d.agent.empfehlung ?? ''] ?? 'Agent'}</span> <span className="klein gedimmt">{wann(d.agent.at)}</span>{d.agent.entwurf && <> <span className="marke">Entwurf — noch nicht auf GitHub</span></>}</p>
            <Md text={d.agent.text} />
            {d.agent.gepostet && <p className="klein"><a href={d.agent.gepostet} target="_blank" rel="noopener noreferrer">So steht es auf GitHub ↗</a></p>}
          </div>
        ) : <p className="leer">{!d.agent ? 'Für diesen PR gibt es noch kein Review des Agenten.' : d.agent.status !== 'fertig' ? `Das Review läuft noch (${d.agent.status}).` : d.agent.entwurf ? 'Das Review ist fertig, aber noch nicht auf GitHub veröffentlicht — Knut gibt es frei.' : 'Das Review ist fertig, aber ohne Text.'}</p>}
      </Abschnitt>
    </div>
  );
}

// ---------- Dokumente ----------

export function Dokumente({ q: q0 }: { q: string }) {
  const [q, setQ] = useState(q0);
  const [suche, setSuche] = useState(q0);
  useEffect(() => { const t = setTimeout(() => setSuche(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { history.replaceState(null, '', suche ? `v2/dokumente?q=${encodeURIComponent(suche)}` : 'v2/dokumente'); }, [suche]);
  const { d, fehler, neu } = useDaten<{ q: string; frei?: { notizen: boolean; berichte: boolean }; treffer: Dok[] }>(`api/v2/dokumente${suche ? `?q=${encodeURIComponent(suche)}` : ''}`);
  const [thema, setThema] = useState<string | null>(null);   // Runde 7: nach Thema filtern
  return (
    <div className="seite">
      <h1>Dokumente</h1>
      <p className="unterzeile">Berichte der Agenten und Notizen aus unserer Wissenssammlung.</p>
      <form className="suche" role="search" onSubmit={(e) => { e.preventDefault(); setSuche(q.trim()); }}>
        <label htmlFor="such" className="unsichtbar">Dokumente durchsuchen</label>
        <input id="such" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen, z. B. Datenschutz, Tarif …" />
      </form>
      <ThemenLeiste aktiv={thema} wahl={setThema} />
      {q.trim() && (q.trim() !== suche || (d && (d.q ?? '') !== suche)) && <p className="klein gedimmt" role="status">Sucht „{q.trim()}“ …</p>}
      {fehler ? <Fehler text={fehler} nochmal={neu} /> : !d ? <Laedt /> : (
        <Abschnitt id="d-liste" titel={d.q ? `Treffer für „${d.q}“` : 'Zuletzt geändert'} erklaerung="Berichte sind Ergebnisse von Unter-Chats; Notizen stammen aus unserer gemeinsamen Wissenssammlung. Die Suche findet Wörter im Titel und im Pfad.">
          {d.frei && !d.frei.notizen && !d.frei.berichte ? <p className="leer">Dokumente sind für dich noch nicht freigegeben — frag Knut.</p>
            : d.treffer.filter((x) => !thema || x.thema === thema).length ? <ul className="liste">{d.treffer.filter((x) => !thema || x.thema === thema).map((x) => <DokZeile key={x.url} x={x} />)}</ul> : <p className="leer">Nichts gefunden. Versuch ein anderes Wort (z. B. kürzer oder englisch).</p>}
        </Abschnitt>
      )}
    </div>
  );
}

export function Dokument({ vault, paket, datei }: { vault: string | null; paket: string | null; datei: string | null }) {
  const app = useApp();
  const pfad = vault ? `api/vault/note?path=${encodeURIComponent(vault)}` : paket ? `api/files/agenten/${encodeURIComponent(paket)}/${(datei ?? 'bericht.md').split('/').map(encodeURIComponent).join('/')}?vorschau=1` : null;
  const { d, fehler, neu } = useDaten<{ title?: string; name?: string; html: string | null; text?: string | null; mtime?: number; backlinks?: { path: string; title: string }[] }>(pfad);
  const inhalt = useRef<HTMLElement>(null);
  useDiagramme(inhalt, d);   // Runde 4 (Knut B5): Diagramme zeichnen statt Quelltext (wie in der alten Werkbank, erst bei Bedarf geladen)
  if (!pfad) return <Fehler text="Kein Dokument angegeben." />;
  if (fehler) return <Fehler text={fehler.includes('Admins') ? 'Dieses Dokument kann nur Knut öffnen.' : fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  const zurueck = herkunft();
  const titel = d.title ?? (paket ? `Bericht ${paket.split('-')[0]} · ${paket.replace(/^\d+-/, '').replace(/-/g, ' ')}` : d.name ?? '');
  return (
    <div className="seite dokument">
      <p className="zurueck"><a href={zurueck.url}>← {zurueck.text}</a></p>
      <h1>{titel}</h1>
      <div className="aktionen-zeile">
        {d.mtime ? <span className="klein gedimmt">geändert {wann(new Date(d.mtime).toISOString())}</span> : null}
        <button type="button" className="knopf leise klein" onClick={() => app.chat(`Fass mir das Dokument „${titel}“ in drei Sätzen zusammen und sag, was daran offen ist.`)}>Im Chat fragen</button>
        <Teilen key={vault ?? `${paket}/${datei}`} titel={titel} vault={vault} />
      </div>
      <article ref={inhalt} className="kasten md" dangerouslySetInnerHTML={{ __html: tabellenBeschriften(htmlFuerV2(d.html ?? `<pre>${(d.text ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</pre>`)) }} />
      {d.backlinks && d.backlinks.length > 0 && (
        <Abschnitt id="d-verweise" titel="Wird erwähnt in" erklaerung="Andere Notizen, die auf diese verweisen.">
          <ul className="liste">{d.backlinks.slice(0, 12).map((b) => <Zeile key={b.path} titel={b.title} url={`v2/dokument?vault=${encodeURIComponent(b.path)}`} />)}</ul>
        </Abschnitt>
      )}
    </div>
  );
}

/** Runde 4 (Knut B5): „← zurück“ dorthin, woher man kam (Arbeit, Thema, Jetzt …) — sonst zu den Dokumenten. */
const HERKUNFT: [RegExp, string][] = [[/\/v2\/arbeit\//, 'Unter-Chat'], [/\/v2\/arbeit/, 'Arbeit'], [/\/v2\/themen/, 'Themen'], [/\/v2\/thema/, 'Thema'], [/\/v2\/entscheidungen/, 'Entscheidungen'], [/\/v2\/prs/, 'PRs'], [/\/v2\/erledigt/, 'Erledigt'], [/\/v2\/chats/, 'Alle Chats'], [/\/v2\/dokumente/, 'Dokumente'], [/\/v2\/?$/, 'Jetzt']];
function herkunft(): { url: string; text: string } {
  let v = '';
  try { v = sessionStorage.getItem('v2-vorher') ?? ''; } catch { /* egal */ }
  const t = HERKUNFT.find(([re]) => re.test(v.split('?')[0]))?.[1];
  const i = v.indexOf('/v2/');
  const hier = v === location.pathname + location.search;   // nach „Zurück“ im Browser kann die Herkunft die Seite selbst sein (Pass C)
  return t && i >= 0 && !hier ? { url: v.slice(i + 1), text: t } : { url: 'v2/dokumente', text: 'Dokumente' };
}

// ---------- Begriffe ----------

export function Begriffe() {
  return (
    <div className="seite">
      <h1>Begriffe in Klartext</h1>
      <p className="unterzeile">Die Wörter, die du im Workspace siehst — und was sie heißen.</p>
      <dl className="begriffe">{BEGRIFFE.map((b) => <div key={b.wort} className="kasten"><dt>{b.wort}</dt><dd>{b.heisst}</dd><dd className="klein gedimmt">Beispiel: {b.beispiel}</dd></div>)}</dl>
    </div>
  );
}

// ---------- Anmelden ----------

export function Anmelden({ fertig }: { fertig: () => void | Promise<void> }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  async function los(e: React.FormEvent) {
    e.preventDefault(); setLaeuft(true); setFehler(null);
    try { await schicke('api/login', { email, password: pw }); await fertig(); } catch (x: any) { setFehler(x.status === 401 || x.status === 400 ? 'E-Mail oder Passwort stimmt nicht.' : x.message); } finally { setLaeuft(false); }
  }
  return (
    <div className="anmelden">
      <form className="kasten" onSubmit={los}>
        <h1>OLAF Workspace</h1>
        <p className="unterzeile">Melde dich mit deinem Workspace-Konto an.</p>
        <label htmlFor="email">E-Mail</label>
        <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label htmlFor="pw">Passwort</label>
        <input id="pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        {fehler && <p className="fehlertext" role="alert">{fehler}</p>}
        <button type="submit" className="knopf haupt breit" disabled={laeuft}>{laeuft ? 'Meldet an …' : 'Anmelden'}</button>
      </form>
    </div>
  );
}


// ---------- Erledigt an einem Tag (S14) ----------

type ErledigtEintrag = Start['erledigt'][number];
/** Runde 5 (Knut B4): ein Tag zurück (JJJJ-MM-TT, Kalendertag — Mittag, damit keine Zeitumstellung dazwischenfunkt). */
const vortag = (t: string) => { const x = new Date(`${t}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
export function Erledigt({ tag }: { tag: string | null }) {
  const { d, fehler, neu } = useDaten<{ tag: string; heute: string; erledigt: ErledigtEintrag[]; nurAdmin?: boolean }>(`api/v2/erledigt${tag ? `?tag=${encodeURIComponent(tag)}` : ''}`);
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  if (d.nurAdmin) return <div className="seite"><h1>Erledigt</h1><p className="leer">Hier steht, was Agenten in Knuts Unter-Chats fertig gemacht haben — das sieht nur Knut.</p></div>;
  const waehlen = (t: string) => { history.pushState(null, '', t && t !== d.heute ? `v2/erledigt?tag=${t}` : 'v2/erledigt'); window.dispatchEvent(new PopStateEvent('popstate')); };
  const abgenommen = d.erledigt.filter((e) => e.stand === 'abgenommen'), zumLesen = d.erledigt.filter((e) => e.stand === 'zum-lesen');
  const datum = new Date(`${d.tag}T12:00:00`).toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className="seite">
      <h1>{d.tag === d.heute ? 'Heute erledigt' : `Erledigt am ${datum}`}</h1>
      <p className="unterzeile"><button type="button" className="knopf leise klein" onClick={() => waehlen(vortag(d.tag))}>← Vortag</button> <label htmlFor="erledigt-tag">Tag: </label><input id="erledigt-tag" type="date" value={d.tag} max={d.heute} onChange={(e) => waehlen(e.target.value)} />{d.tag !== d.heute && <> <button type="button" className="knopf leise klein" onClick={() => waehlen(d.heute)}>Heute</button></>}</p>
      {!d.erledigt.length && <p className="leer">{d.tag === d.heute ? <>Heute ist noch nichts fertig geworden. <button type="button" className="knopf leise klein" onClick={() => waehlen(vortag(d.tag))}>Gestern ansehen</button></> : 'An diesem Tag ist nichts fertig geworden.'}</p>}
      {abgenommen.length > 0 && <Abschnitt id="e-abgenommen" titel="Von dir abgenommen" erklaerung="Unter-Chats, die du an diesem Tag geprüft und abgehakt hast."><ul className="liste">{abgenommen.map((e) => <Zeile key={e.id} titel={e.titel} url={e.links[0]?.url ?? `v2/arbeit/${e.id}`} rechts={e.uhr} marke={{ text: 'abgenommen', ton: 'gruen' }} links={e.links.slice(1)} />)}</ul></Abschnitt>}
      {zumLesen.length > 0 && <Abschnitt id="e-zumlesen" titel="Fertig, Bericht noch nicht gelesen" erklaerung="Ein Agent hat an diesem Tag fertig gemeldet; den Bericht hast du noch nicht abgenommen."><ul className="liste">{zumLesen.map((e) => <Zeile key={e.id} titel={e.titel} url={e.links[0]?.url ?? `v2/arbeit/${e.id}`} rechts={e.uhr} marke={{ text: 'zum Lesen' }} links={e.links.slice(1)} />)}</ul></Abschnitt>}
    </div>
  );
}

// ---------- Mehr (S14, C5): alles aus der alten Werkbank hat hier einen Platz ----------

/** Runde 7 (Abgleich: Kontingentzeile fehlte in 2.0): Melious-Rest und Claude-Konten — nur hier, nicht als zweite Zahl im Kopf. */
function Kontingent() {
  const { d } = useDaten<{ melious: { restProzent: number | null; geschaetzt: boolean; sperre: string | null } | null; claude: { id: string; label: string; erschoepftBis: number | null; zuegeHeute: number }[]; schwelle: number }>('api/kontingent');
  if (!d) return null;
  const m = d.melious;
  const knapp = !!m && (m.sperre !== null || (m.restProzent !== null && m.restProzent < d.schwelle));
  const teile = [`Melious ${!m ? 'aus' : m.sperre ? 'gesperrt' : m.restProzent === null ? '?' : `${m.restProzent} % übrig${m.geschaetzt ? ' (geschätzt)' : ''}`}`,
    ...d.claude.map((c) => `${c.label} ${c.erschoepftBis && c.erschoepftBis > Date.now() ? `erschöpft bis ${new Date(c.erschoepftBis).toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit' })}` : 'frei'}`)];
  return <p className={`klein ${knapp ? 'hinweis-warn' : 'gedimmt'}`} role="status">Kontingent: {teile.join(' · ')}</p>;
}

export function Mehr() {
  const app = useApp();
  const alt = MEHR.filter((e) => e.ziel === 'alt');
  // Radikal simpel: was nicht in die vier Bereiche gehört, steht hier — nichts ist weg.
  const SEITEN: [string, string, string][] = [
    ['Alles, was auf dich wartet', 'v2/entscheidungen', 'Jede offene Frage und Freigabe, nach Thema — auch „Alle wie empfohlen“.'],
    ['Dokumente', 'v2/dokumente', 'Berichte der Agenten und Notizen aus der Wissenssammlung.'],
    ['Themen', 'v2/themen', 'Alles zu Flex, Rechner, Admin, Werkbank … auf einer Seite.'],
    ['Alle Chats', 'v2/chats', 'Jeder Chat und Unter-Chat, auch alte — mit Suche und Filtern.'],
    ['Erledigt', 'v2/erledigt', 'Was an einem Tag fertig wurde — mit Datumswahl.'],
    ['Begriffe in Klartext', 'v2/begriffe', 'Was Unter-Chat, Hauptchat und „wartet auf dich“ heißen.'],
  ];
  return (
    <div className="seite">
      <h1>Mehr</h1>
      {app.ich.admin && <Kontingent />}
      <ul className="liste">{SEITEN.map(([t, u, satz]) => <Zeile key={u} titel={t} url={u} satz={satz} />)}</ul>
      {/* Audit 05.11. (8): die aus der alten Werkbank geholten Bereiche (Lesen und das Nötigste; Ändern verlinkt jede Seite) */}
      <Abschnitt id="m-bereiche" titel="Weitere Bereiche" erklaerung="Aus der alten Werkbank geholt. Lesen geht hier; was Jira, Zugänge oder Konten ändert, verlinkt jede Seite in die alte Werkbank.">
        <ul className="liste">{MEHR.filter((e) => e.ziel === 'v2' && BEREICHE.includes(e.url as any)).map((e) => <Zeile key={e.alt} titel={e.titel} url={e.url} satz={e.satz} />)}</ul>
      </Abschnitt>
      <Abschnitt id="m-alt" titel="In der alten Werkbank" erklaerung="Diese Seiten gibt es (noch) nur in der alten Werkbank. Ein Klick öffnet sie in einem neuen Tab; die Anmeldung gilt dort auch.">
        <ul className="liste">{alt.map((e) => <Zeile key={e.alt} titel={e.titel} url={app.alt ? `${app.alt}/${e.url}` : '#'} satz={e.satz} />)}</ul>
      </Abschnitt>
      <p className="klein gedimmt">Angemeldet als <b>{app.ich.name}</b>. <button type="button" className="knopf leise klein" onClick={() => fetch('api/logout', { method: 'POST', headers: { 'x-werkbank': '1' } }).finally(() => window.dispatchEvent(new Event('v2-abgemeldet')))}>Abmelden</button></p>
    </div>
  );
}

// ---------- Alle Chats (S12, Knut 03.11. Punkt 3): suchen, nach Art/Status/Thema/Zeit filtern, von jeder Zeile in den Chat ----------

interface ChatZeile { id: string; art: 'hauptchat' | 'unterchat' | 'chat' | 'chat2'; titel: string; thema: string | null; status: string; zuletzt: string | null; url: string | null; conv: string | null }
const ART_TEXT: Record<ChatZeile['art'], string> = { hauptchat: 'Hauptchat', unterchat: 'Unter-Chat', chat: 'Chat', chat2: 'Chat (neu)' };
// Runde 4 (Knut B6): auch „älter als“ — alte Chats findet man nicht über „die letzten N Tage“. Negativ = älter als.
const ZEIT: [string, number][] = [['letzte 7 Tage', 7], ['letzte 30 Tage', 30], ['letzte 90 Tage', 90], ['älter als 30 Tage', -30], ['älter als 90 Tage', -90], ['jede Zeit', 0]];

export function AlleChats({ q = '' }: { q?: string }) {
  const app = useApp();
  const { d, fehler, neu } = useDaten<{ zeilen: ChatZeile[]; themen: string[]; fehlt?: string[] }>('api/v2/chats');
  const [such, setSuch] = useState(q);
  const [art, setArt] = useState<'alle' | 'unterchat' | 'haupt' | 'chat'>('alle');
  const [status, setStatus] = useState('alle');
  const [thema, setThema] = useState('alle');
  const [tage, setTage] = useState(0);
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  const s = such.trim().toLowerCase();
  const grenze = tage ? Date.now() - Math.abs(tage) * 86400_000 : 0;
  const liste = d.zeilen.filter((z) =>
    (art === 'alle' || (art === 'unterchat' && z.art === 'unterchat') || (art === 'haupt' && z.art === 'hauptchat') || (art === 'chat' && (z.art === 'chat' || z.art === 'chat2')))
    && (status === 'alle' || z.status === status) && (thema === 'alle' || z.thema === thema)
    && (!grenze || (z.zuletzt && (tage > 0 ? Date.parse(z.zuletzt) >= grenze : Date.parse(z.zuletzt) < grenze)))
    && (!s || `${z.titel} ${z.thema ?? ''}`.toLowerCase().includes(s)));
  const stati = [...new Set(d.zeilen.map((z) => z.status))].sort();
  return (
    <div className="seite">
      <p className="zurueck"><a href="v2/arbeit">← Arbeit</a></p>
      <h1>Alle Chats</h1>
      <p className="unterzeile">Jeder Hauptchat, Unter-Chat und Chat — auch alte und archivierte. Ein Klick öffnet ihn.</p>
      <div className="filter">
        <input type="search" placeholder="Suchen (Titel, Thema)" value={such} onChange={(e) => setSuch(e.target.value)} aria-label="Chats durchsuchen" />
        <select value={art} onChange={(e) => setArt(e.target.value as any)} aria-label="Art"><option value="alle">alle Arten</option><option value="unterchat">Unter-Chats</option><option value="haupt">Hauptchats</option><option value="chat">Chats</option></select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="alle">jeder Status</option>{stati.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        {d.themen.length > 0 && <select value={thema} onChange={(e) => setThema(e.target.value)} aria-label="Thema"><option value="alle">jedes Thema</option>{d.themen.map((x) => <option key={x} value={x}>{x}</option>)}</select>}
        <select value={tage} onChange={(e) => setTage(Number(e.target.value))} aria-label="Zeitraum">{ZEIT.map(([t, n]) => <option key={n} value={n}>{t}</option>)}</select>
      </div>
      {!!d.fehlt?.length && <p className="fehlertext klein">Nicht erreichbar: {d.fehlt.join(', ')} — diese Chats fehlen gerade in der Liste.</p>}
      <p className="klein gedimmt">{mehrzahl(liste.length, 'Treffer', 'Treffer')} von {d.zeilen.length}</p>
      {liste.length ? (
        <ul className="liste">{liste.slice(0, 200).map((z) => z.art === 'chat2'
          ? <li key={z.id} className="zeile"><div className="zeile-haupt"><button type="button" className="zeile-titel knopf-link" onClick={() => z.conv && app.chatOeffnen(z.conv)}>{z.titel}</button><p className="zeile-satz">{ART_TEXT[z.art]} · {z.status}</p></div><div className="zeile-rechts"><span className="zeit">{wann(z.zuletzt)}</span></div></li>
          : <Zeile key={z.id} titel={z.titel} url={z.url ?? '#'} satz={`${ART_TEXT[z.art]} · ${z.status}${z.thema ? ` · ${z.thema}` : ''}${z.art !== 'unterchat' ? ' · öffnet im Chat (LibreChat)' : ''}`} rechts={wann(z.zuletzt)} />)}</ul>
      ) : <p className="leer">{d.zeilen.length ? 'Nichts gefunden — anderer Suchbegriff oder Filter?' : 'Du hast noch keine Chats.'}</p>}
      {liste.length > 200 && <p className="klein gedimmt">Die ersten 200 — enger suchen, um den Rest zu sehen.</p>}
    </div>
  );
}

// ---------- Themen quer über alles (S11) ----------

interface ThemaZeile { thema: string; entscheidungen: number; unterchats: number; dokumente: number; prs: number; summe: number }
const zaehl = (z: ThemaZeile) => [z.entscheidungen && mehrzahl(z.entscheidungen, 'Entscheidung', 'Entscheidungen'), z.unterchats && mehrzahl(z.unterchats, 'Unter-Chat', 'Unter-Chats'), z.dokumente && mehrzahl(z.dokumente, 'Dokument', 'Dokumente'), z.prs && mehrzahl(z.prs, 'PR', 'PRs')].filter(Boolean).join(' · ');

export function Themen() {
  const { d, fehler, neu } = useDaten<{ themen: ThemaZeile[] }>('api/v2/themen');
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  return (
    <div className="seite">
      <h1>Themen</h1>
      <p className="unterzeile">Alles zu einem Thema auf einer Seite: Entscheidungen, Unter-Chats, Dokumente und PRs. Das Thema kommt aus dem Unter-Chat (von Hand gesetzt) oder wird aus Titel und Ablage erkannt.</p>
      <ul className="liste">{d.themen.map((z) => <Zeile key={z.thema} titel={z.thema} url={`v2/thema?name=${encodeURIComponent(z.thema)}`} satz={zaehl(z)} rechts={z.entscheidungen ? `${z.entscheidungen} offen` : undefined} />)}</ul>
    </div>
  );
}

export function Thema({ name }: { name: string }) {
  const app = useApp();
  type UC = { id: string; titel: string; zuletzt: string | null; offen: boolean; gruppe?: string; satz?: string };
  const { d, fehler, neu } = useDaten<{ thema: string; entscheidungen: Karte[]; unterchats: UC[]; unterchatsGesamt: number; dokumente: Dok[]; dokumenteGesamt?: number; prs: { pr: string; titel: string; url: string; satz?: string }[]; roadmap?: { titel: string; stand: string; url: string }[]; notizenFrei: boolean; prFrei: boolean }>(`api/v2/thema?name=${encodeURIComponent(name)}`);
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  // Runde 7 (Knut): je Thema offen · läuft · fertig · Dokumente · PRs · Roadmap-Items — die Unter-Chats nach ihrem Zustand.
  const GRUPPE: [string, string][] = [['wartet', 'Wartet auf dich'], ['laeuft', 'Läuft'], ['fertig', 'Fertig'], ['abgenommen', 'Abgenommen']];
  const uc = (g: string) => d.unterchats.filter((z) => (z.gruppe ?? (z.offen ? 'wartet' : 'abgenommen')) === g);
  const rm = d.roadmap ?? [];
  const staende = [...new Set(rm.map((x) => x.stand))];
  return (
    <div className="seite">
      <ThemenLeiste aktiv={d.thema} />
      <h1>{d.thema}</h1>
      <nav className="sprung" aria-label="Auf dieser Seite"><a href="#t-offen">Offen</a><a href="#t-unterchats">Unter-Chats</a><a href="#t-dokumente">Dokumente</a><a href="#t-prs">PRs</a>{rm.length > 0 && <a href="#t-roadmap">Roadmap</a>}</nav>
      <section className="abschnitt"><h2 id="t-offen">Offen für dich</h2>
        {d.entscheidungen.length ? <div className="karten">{d.entscheidungen.map((k) => <EntscheidungKarte key={k.id} k={k} beantwortet={() => app.zahl(null)} />)}</div> : <p className="leer">Zu diesem Thema wartet nichts auf dich.</p>}
      </section>
      <section className="abschnitt"><h2 id="t-unterchats">Unter-Chats</h2>
        {!d.unterchats.length ? <p className="leer">Keine Unter-Chats zu diesem Thema.</p> : GRUPPE.map(([g, t]) => uc(g).length ? <div key={g}><p className="gruppe-titel">{t}</p><ul className="liste">{uc(g).map((z) => <Zeile key={z.id} titel={z.titel} url={`v2/arbeit/${z.id}`} satz={g === 'abgenommen' ? undefined : z.satz} rechts={wann(z.zuletzt)} />)}</ul></div> : null)}
        {d.unterchatsGesamt > d.unterchats.length && <p className="abschnitt-fuss"><a href="v2/chats">Ältere in „Alle Chats“ →</a></p>}
      </section>
      <section className="abschnitt"><h2 id="t-dokumente">Dokumente</h2>
        {!d.notizenFrei ? <p className="leer">Notizen sind für dich noch nicht freigegeben — frag Knut.</p> : d.dokumente.length ? <ul className="liste">{d.dokumente.map((x) => <DokZeile key={x.url} x={x} />)}</ul> : <p className="leer">Keine Notizen zu diesem Thema.</p>}
        {(d.dokumenteGesamt ?? 0) > d.dokumente.length && <p className="abschnitt-fuss"><a href={`v2/dokumente?q=${encodeURIComponent(d.thema)}`}>Ältere in „Dokumente“ suchen →</a></p>}
      </section>
      <section className="abschnitt"><h2 id="t-prs">PRs</h2>
        {!d.prFrei ? <p className="leer">PRs sind für dich noch nicht freigegeben — frag Knut.</p> : d.prs.length ? <ul className="liste">{d.prs.map((p) => <Zeile key={p.pr} titel={`${p.pr} · ${p.titel}`} url={p.url} satz={p.satz} />)}</ul> : <p className="leer">Keine offenen PRs zu diesem Thema.</p>}
      </section>
      {rm.length > 0 && <section className="abschnitt"><h2 id="t-roadmap">Roadmap</h2>
        {staende.map((st) => <div key={st}><p className="gruppe-titel">{st}</p><ul className="liste">{rm.filter((x) => x.stand === st).map((x) => <Zeile key={x.url} titel={x.titel} url={x.url} />)}</ul></div>)}
      </section>}
    </div>
  );
}

/** Runde 7 (Knut: „Themen als tragende Ordnung“): eine Leiste mit den Themen — auf jeder Hauptseite gleich, ein Tipp öffnet das Thema
 *  (offen · läuft · fertig · Dokumente · PRs · Roadmap) oder filtert die Liste, wenn `wahl` gesetzt ist. „Sonstiges“ steht hinten. */
export function ThemenLeiste({ aktiv, wahl }: { aktiv?: string | null; wahl?: (t: string | null) => void }) {
  const { d } = useDaten<{ themen: { thema: string; summe: number }[] }>('api/v2/themen');
  const alle = (d?.themen ?? []).filter((t) => t.thema !== 'Sonstiges');
  // Persona R7: das aktive Thema immer zeigen (auch jenseits der ersten 12) und auf dem Handy in den sichtbaren Bereich holen.
  const l = [...alle.slice(0, 12), ...alle.slice(12).filter((t) => t.thema === aktiv)];
  const leiste = useRef<HTMLElement>(null);
  useEffect(() => { leiste.current?.querySelector('.chip.an')?.scrollIntoView({ block: 'nearest', inline: 'center' }); }, [aktiv, l.length]);
  if (!l.length) return null;
  const knopf = (t: string | null, text: string) => wahl
    ? <button key={text} type="button" className={`chip${(aktiv ?? null) === t ? ' an' : ''}`} aria-pressed={(aktiv ?? null) === t} onClick={() => wahl(t)}>{text}</button>
    : <a key={text} className={`chip${aktiv === t ? ' an' : ''}`} href={t ? `v2/thema?name=${encodeURIComponent(t)}` : 'v2/'}>{text}</a>;
  return <nav ref={leiste} className="themen-leiste" aria-label="Themen">{wahl && knopf(null, 'Alle Themen')}{l.map((t) => knopf(t.thema, t.thema))}{!wahl && <a className="chip leise" href="v2/themen">Alle Themen →</a>}</nav>;
}

/** S23 (Ablauf „Dokument teilen“): Link kopieren — mit Vault-Pfad, denn jede Person hat ihre eigene Instanz (D8); der Pfad gilt überall. */
function Teilen({ titel, vault }: { titel: string; vault: string | null }) {
  const [text, setText] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const teilen = async () => {
    const t = `${titel}\n${location.href}${vault ? `\nPfad in der Wissenssammlung: ${vault}` : ''}`;
    setText(t);
    // Runde 4 (Knut B8): ohne Zugriff auf die Zwischenablage (Rechte, alte Browser) über eine Markierung kopieren — und immer sagen, ob es geklappt hat.
    try { await navigator.clipboard.writeText(t); setOk(true); }
    catch {
      const f = document.createElement('textarea'); f.value = t; f.setAttribute('readonly', ''); f.style.position = 'fixed'; f.style.opacity = '0'; document.body.appendChild(f); f.select();
      let kopiert = false; try { kopiert = document.execCommand('copy'); } catch { /* bleibt false */ }
      f.remove(); setOk(kopiert);
    }
  };
  return (
    <>
      <button type="button" className="knopf leise klein" onClick={teilen}>Link kopieren</button>
      {text && (ok ? <span className="ok klein" role="status">✓ Kopiert: „{titel}“, der Link <code>{location.href.replace(/^https?:\/\//, '')}</code>{vault ? <> und der Pfad <code>{vault}</code> (gilt in jeder Werkbank, auch bei Kolleg:innen)</> : null}.</span>
        : <span className="teilen-hand"><span className="klein">Kopieren ging nicht automatisch — markiert, jetzt Strg+C (am Handy: lange tippen):</span><textarea className="teilen-text" readOnly autoFocus rows={3} value={text} aria-label="Zum Kopieren markieren" onFocus={(e) => e.currentTarget.select()} /></span>)}
    </>
  );
}
