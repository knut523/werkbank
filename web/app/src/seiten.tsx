// Werkbank 2.0: die Seiten. Eine Startseite („Jetzt“) und vier Bereiche; jede Seite liest genau einen Endpunkt der 2.0-API.
import { useEffect, useState } from 'react';
import { schicke, type Aufraeumen, type ArbeitKarte, type Dok, type Karte, type Link, type PrZeile, type Start } from './api.ts';
import { useApp } from './kontext.ts';
import { Abschnitt, EntscheidungKarte, Fehler, Laedt, Md, useDaten, Verweise, Zeile } from './teile.tsx';
import { BEGRIFFE, OLAF_KURZ } from './begriffe.ts';
import { MEHR } from './mehr.ts';
import { chatFrage, htmlFuerV2, mehrzahl, rel, wann } from './format.ts';

const EMPFEHLUNG: Record<string, string> = { approve: 'Agent: freigeben', 'request-changes': 'Agent: Änderungen nötig', comment: 'Agent: Anmerkungen' };

function gruss(name: string) {
  const h = Number(new Date().toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', hour12: false }));
  return `${h < 11 ? 'Guten Morgen' : h < 18 ? 'Hallo' : 'Guten Abend'}, ${name}`;
}

// ---------- Jetzt ----------

export function Jetzt() {
  const app = useApp();
  // Erst Zahl und Karten (schnell), dann der Rest — der erste Bildschirm zeigt sofort, was zu tun ist.
  const oben = useDaten<Pick<Start, 'zahl' | 'jetzt' | 'aufraeumen' | 'ich' | 'admin' | 'rolle'>>('api/v2/start?teil=oben');
  const voll = useDaten<Start>('api/v2/start');
  const k = voll.d ?? oben.d;
  useEffect(() => { if (k) app.zahl(k.zahl); }, [k]);
  if (oben.fehler && !voll.d) return <Fehler text={oben.fehler} nochmal={oben.neu} />;
  if (!k) return <Laedt />;
  const d = voll.d;
  const kopf = (
    <>
      <h1>{gruss(k.ich)}</h1>
      {k.rolle === 'reviewer' && (
        <div className="willkommen">
          <p><b>Du prüfst Code.</b> Gleich darunter steht, was eine Antwort von dir braucht; danach die PRs, bei denen du dran bist — ein Klick zeigt den Stand und was der Prüf-Agent dazu sagt, ohne GitHub. <a href="v2/begriffe">Begriffe in Klartext</a></p>
        </div>
      )}
      {!k.admin && k.rolle !== 'reviewer' && (
        <div className="willkommen">
          <p><b>Neu hier?</b> {OLAF_KURZ}</p>
          <p>In der Werkbank arbeiten Agenten (KI-Assistenten) an Aufträgen und fragen, wenn sie etwas nicht selbst entscheiden dürfen. Was an dich geht, steht gleich darunter; Berichte und Notizen findest du unter „Dokumente“. <a href="v2/begriffe">Begriffe in Klartext</a></p>
        </div>
      )}
      <Abschnitt id="a-jetzt" titel="Was du jetzt tun musst" erklaerung="Die wichtigsten Dinge, die ohne deine Antwort nicht weitergehen — höchstens fünf, wichtigste zuerst: zuerst Entscheidungen, die einen Agenten anhalten, darunter Freigaben. Die Zahl oben rechts zählt alles, was auf dich wartet; unter „Entscheidungen“ steht, woraus sie sich zusammensetzt."
        fuss={k.zahl > k.jetzt.length + k.aufraeumen.length ? <a href="v2/entscheidungen">Alles ansehen, was auf dich wartet →</a> : null}>
        {k.jetzt.length > 0 && <p className="klein gedimmt oben-hinweis">Wichtigste zuerst — die oberste hält am meisten Arbeit an.</p>}
        {k.jetzt.length > 0 && <div className="karten">{k.jetzt.map((x) => <EntscheidungKarte key={x.id} k={x} beantwortet={() => app.zahl(null)} />)}</div>}
        {k.aufraeumen.length > 0 && <AufraeumenListe l={k.aufraeumen} />}
        {!k.jetzt.length && !k.aufraeumen.length && <p className="leer">Gerade wartet nichts auf dich.</p>}
      </Abschnitt>
    </>
  );
  if (!d) return <div className="seite">{kopf}{voll.fehler ? <Fehler text={voll.fehler} nochmal={voll.neu} /> : <Laedt text="Lädt Läuft, Heute erledigt, PRs …" />}</div>;
  // S13: Reihenfolge je Rolle — Team (Lisa) liest zuerst Dokumente, Reviewer (Christoph) und Leitung sehen zuerst PRs.
  const prsAbschnitt = (
      <Abschnitt id="a-prs" titel="PRs, die auf dich warten (die neuesten)" erklaerung="Code-Vorschläge auf GitHub (Pull Requests), bei denen du gerade dran bist — zum Prüfen, Freigeben oder Nachbessern. Entwürfe zählen nicht mit. Unter „PRs“ siehst du alle und kannst auf jede andere Person umschalten."
        fuss={<a href="v2/prs">Alle PRs →</a>}>
        {!d.prFrei ? <p className="leer">PRs sind für dich noch nicht freigegeben — frag Knut.</p>
          : d.prs === null ? <p className="leer">Die PR-Liste ist gerade nicht erreichbar.</p>
          : d.prs.length ? <ul className="liste">{d.prs.map((p) => <PrZeileView key={p.pr} p={p} />)}</ul> : <p className="leer">Kein PR wartet auf dich.</p>}
      </Abschnitt>
  );
  const dokAbschnitt = (
      <Abschnitt id="a-dok" titel="Neue Dokumente" erklaerung="Die zuletzt geänderten Berichte und Notizen. Alles Lesbare findest du unter „Dokumente“ — mit Suche." fuss={<a href="v2/dokumente">Alle Dokumente →</a>}>
        {d.dokumente.length ? <ul className="liste">{d.dokumente.map((x) => <DokZeile key={x.url} x={x} />)}</ul> : <p className="leer">Keine neuen Dokumente.</p>}
      </Abschnitt>
  );
  const abgenommen = d.erledigt.filter((e) => e.stand === 'abgenommen'), zumLesen = d.erledigt.filter((e) => e.stand === 'zum-lesen');
  return (
    <div className="seite">
      {kopf}
      <nav className="sprung" aria-label="Weiter unten">{d.admin && <a href="#a-laeuft">Läuft</a>}{d.admin && <a href="#a-erledigt">Heute erledigt</a>}{d.rolle === 'team' ? <><a href="#a-dok">Dokumente</a><a href="#a-prs">PRs</a></> : <><a href="#a-prs">PRs</a><a href="#a-dok">Dokumente</a></>}</nav>
      {d.admin && (
        <Abschnitt id="a-laeuft" titel="Läuft gerade" erklaerung="Unter-Chats, an denen ein Agent gerade arbeitet — mit voraussichtlichem Ende. Du musst hier nichts tun."
          fuss={<a href="v2/arbeit">Alle Unter-Chats →</a>}>
          {d.laeuft.length ? <ul className="liste">{d.laeuft.slice(0, 3).map((z) => <Zeile key={z.id} titel={z.titel} url={`v2/arbeit/${z.id}`} satz={z.satz} />)}</ul> : <p className="leer">Gerade läuft nichts.</p>}
        </Abschnitt>
      )}
      {d.admin && (
        <Abschnitt id="a-erledigt" titel="Heute erledigt" erklaerung="Was heute fertig geworden ist, mit der Uhrzeit — getrennt: was du schon abgenommen hast, und was ein Agent fertig gemacht hat, dessen Bericht du noch nicht gelesen hast. Was noch eine Antwort von dir braucht, steht oben, nicht hier.">
          {!abgenommen.length && !zumLesen.length && <p className="leer">Heute ist noch nichts fertig geworden.</p>}
          {abgenommen.length > 0 && <><p className="gruppe-titel">Von dir abgenommen</p>
            <ul className="liste">{abgenommen.slice(0, 3).map((e) => <Zeile key={e.id} titel={e.titel} url={e.links[0]?.url ?? `v2/arbeit/${e.id}`} rechts={e.uhr} marke={{ text: 'abgenommen', ton: 'gruen' }} links={e.links.slice(1)} />)}</ul></>}
          {zumLesen.length > 0 && <><p className="gruppe-titel">Fertig, Bericht noch nicht gelesen</p>
            <ul className="liste">{zumLesen.slice(0, 3).map((e) => <Zeile key={e.id} titel={e.titel} url={e.links[0]?.url ?? `v2/arbeit/${e.id}`} rechts={e.uhr} marke={{ text: 'zum Lesen' }} />)}</ul>
            {zumLesen.length > 3 && <p className="abschnitt-fuss"><a href="v2/arbeit#fertig">Alle fertigen unter Arbeit →</a></p>}</>}
          <p className="abschnitt-fuss"><a href="v2/erledigt">Andere Tage ansehen →</a></p>
        </Abschnitt>
      )}
      {d.rolle === 'team' ? <>{dokAbschnitt}{prsAbschnitt}</> : <>{prsAbschnitt}{dokAbschnitt}</>}
    </div>
  );
}

const AufraeumenListe = ({ l }: { l: Aufraeumen[] }) => (
  <ul className="liste aufraeumen">{l.map((x) => <Zeile key={x.id} titel={x.titel} url={x.url} satz={`${x.worum} Zählt als ein Posten. In der alten Werkbank.`} marke={{ text: 'Sammelposten' }} />)}</ul>
);
const DokZeile = ({ x }: { x: Dok }) => <Zeile titel={x.titel} url={x.url} satz={x.worum} marke={{ text: x.art === 'bericht' ? 'Bericht' : 'Notiz' }} rechts={wann(x.at)} />;
const PrZeileView = ({ p }: { p: PrZeile }) => (
  <Zeile titel={`${p.pr} · ${p.titel}`} url={`v2/prs/${encodeURIComponent(p.repo)}/${p.number}`} satz={p.wartetAuf.length ? `wartet auf ${p.wartetAuf.join(', ')} — ${p.warum}` : p.warum || 'wartet auf niemanden'}
    marke={p.entwurf ? { text: 'Entwurf' } : p.review?.empfehlung ? { text: EMPFEHLUNG[p.review.empfehlung] ?? p.review.empfehlung, ton: p.review.empfehlung === 'approve' ? 'gruen' : '' } : undefined} rechts={wann(p.geaendert)} />
);

// ---------- Entscheidungen ----------

export function Entscheidungen() {
  const app = useApp();
  const { d, fehler, neu } = useDaten<{ zahl: number; oben: Karte[]; rest: Karte[]; aufraeumen: Aufraeumen[]; geschlossen?: Geschlossen[] }>('api/v2/entscheidungen');
  useEffect(() => { if (d) app.zahl(d.zahl); }, [d]);
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  return (
    <div className="seite">
      <h1>Entscheidungen</h1>
      <p className="unterzeile">Alles, was auf dich wartet. „Ja, so“ übernimmt die Empfehlung, „Anders …“ schickt deinen eigenen Text — an genau diese Karte.</p>
      <p className="zusammensetzung">Die Zahl oben rechts: {d.oben.length + d.rest.length} {d.oben.length + d.rest.length === 1 ? 'Frage' : 'Fragen und Freigaben'}{d.aufraeumen.length ? ` + ${d.aufraeumen.length} ${d.aufraeumen.length === 1 ? 'Sammelposten' : 'Sammelposten'} zum Aufräumen` : ''} = {d.zahl}.{d.geschlossen?.length ? <> <a href="#e-geschlossen">{mehrzahl(d.geschlossen.length, 'Frage hat', 'Fragen haben')} sich von selbst erledigt ↓</a></> : null}</p>
      <Abschnitt id="e-zuerst" titel="Zuerst" erklaerung="Dieselben fünf wie auf der Startseite: was einen Agenten anhält oder bald als angenommen gilt.">
        {d.oben.length ? <div className="karten">{d.oben.map((k) => <EntscheidungKarte key={k.id} k={k} beantwortet={() => app.zahl(null)} />)}</div> : <p className="leer">Gerade wartet nichts auf dich.</p>}
      </Abschnitt>
      {d.rest.length > 0 && (
        <Abschnitt id="e-weitere" titel="Weitere, nach Thema" erklaerung="Alles andere, was auf dich wartet — nach Thema gruppiert. Passt bei einem Thema jede Empfehlung, beantwortest du alle auf einmal mit „Alle wie empfohlen“ (mit Rückfrage); Freigaben und Fragen ohne Empfehlung bleiben dabei stehen.">
          {themen(d.rest).map(([thema, ks]) => <ThemaGruppe key={thema} thema={thema} karten={ks} fertig={() => { neu(); app.zahl(null); }} />)}
        </Abschnitt>
      )}
      {d.aufraeumen.length > 0 && (
        <Abschnitt id="e-aufraeumen" titel="Aufräumen" erklaerung="Zählt mit, weil es auf dich wartet — ist aber keine Entscheidung und hält keinen Agenten an. Das erledigst du (noch) in der alten Werkbank.">
          <AufraeumenListe l={d.aufraeumen} />
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
function themen(ks: Karte[]): [string, Karte[]][] {
  const m = new Map<string, Karte[]>();
  for (const k of ks) { const t = k.thema?.trim() || 'Sonstiges'; m.set(t, [...(m.get(t) ?? []), k]); }
  return [...m].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'de'));
}
const wieEmpfohlenMoeglich = (k: Karte) => k.art === 'entscheidung' && !k.alt && !!k.empfehlung && k.antworten.includes('ja');

function ThemaGruppe({ thema, karten, fertig }: { thema: string; karten: Karte[]; fertig: () => void }) {
  const app = useApp();
  const passend = karten.filter(wieEmpfohlenMoeglich);
  const [frage, setFrage] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);
  const alle = async () => {
    setLaeuft(true); setMeldung(null);
    try {
      const r = await schicke<{ ok: number; fehler: string[]; uebersprungen: number }>('api/v2/alle-empfohlen', { ids: passend.map((k) => k.id) });
      setMeldung(`✓ ${mehrzahl(r.ok, 'Antwort', 'Antworten')} wie empfohlen verschickt.${app.testbetrieb ? ' Testbetrieb: Fragen aus Notizen bleiben hier offen.' : ''}${r.uebersprungen ? ` ${r.uebersprungen} übersprungen — die beantwortest du einzeln.` : ''}${r.fehler.length ? ` Nicht geklappt: ${r.fehler.join('; ')}` : ''}`);
      setFrage(false); fertig();
    } catch (x: any) { setMeldung(x.message); } finally { setLaeuft(false); }
  };
  return (
    <div className="thema-gruppe">
      <div className="thema-kopf">
        <p className="gruppe-titel">{thema} · {karten.length}</p>
        {passend.length > 1 && !frage && <button type="button" className="knopf leise klein" onClick={() => setFrage(true)}>Alle {passend.length} wie empfohlen …</button>}
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
  const oeffnen = async (id: string) => {
    setLaeuft(id); setFehler(null);
    try { await schicke('api/v2/wieder-oeffnen', { id }); setOk('✓ Wieder offen — die Frage steht jetzt oben unter „Weitere“ und zählt wieder mit.'); geoeffnet(); } catch (x: any) { setFehler(x.message); } finally { setLaeuft(null); }
  };
  return (
    <>
      {fehler && <p className="fehlertext klein">{fehler}</p>}
      {ok && <p className="ok" role="status">{ok}</p>}
      <ul className="liste">{l.map((g) => (
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
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  if (d.nurAdmin) return (
    <div className="seite"><h1>Arbeit</h1>
      <div className="willkommen"><p><b>Hier stehen deine Unter-Chats.</b> Ein Unter-Chat ist ein Auftrag, an dem ein Agent selbstständig arbeitet und am Ende einen Bericht schreibt. Du hast gerade keine — Knut verteilt die Aufträge.</p><p className="klein"><a href="v2/chats">Deine Chats durchsuchen</a> · <a href="v2/begriffe">Begriffe in Klartext</a></p></div>
    </div>
  );
  const g = d.gruppen;
  const liste = (l: ArbeitKarte[], leer: string) => (l.length ? <ul className="liste">{l.map((z) => <Zeile key={z.id} titel={z.titel} url={`v2/arbeit/${z.id}`} satz={z.satz} rechts={wann(z.zuletzt)} links={z.links} />)}</ul> : <p className="leer">{leer}</p>);
  return (
    <div className="seite">
      <h1>Arbeit</h1>
      <p className="unterzeile">Deine Unter-Chats: Aufträge, an denen Agenten selbstständig arbeiten. <a href="v2/chats">Alle Chats durchsuchen (auch alte) →</a></p>
      <Abschnitt id="w-wartet" titel="Wartet auf dich" erklaerung="Unter-Chats, die ohne dich nicht weiterkommen: eine offene Frage, ein Hänger oder kein Stand. Ein Klick zeigt, was genau.">{liste(g.wartet, 'Kein Unter-Chat wartet auf dich.')}</Abschnitt>
      <Abschnitt id="w-laeuft" titel="Läuft" erklaerung="Hier arbeitet gerade ein Agent. Du musst nichts tun.">{liste(g.laeuft, 'Gerade läuft nichts.')}</Abschnitt>
      <Abschnitt id="fertig" titel="Fertig" erklaerung="Fertige Unter-Chats, die du noch nicht abgenommen hast — der Bericht liegt bereit.">{liste(g.fertig, 'Nichts Fertiges offen.')}</Abschnitt>
    </div>
  );
}

export function ArbeitDetail({ id }: { id: string }) {
  const app = useApp();
  const { d, fehler, neu } = useDaten<{ titel: string; satz: string; gruppe: string; zuletzt: string | null; stand: string; fragen: Karte[]; nachrichten: { id: string; rolle: string; text: string; at: string }[]; links: Link[] }>(`api/v2/arbeit/${id}`);
  const [alle, setAlle] = useState(false);
  const [verlauf, setVerlauf] = useState(false);
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  const msgs = alle ? d.nachrichten : d.nachrichten.slice(-3);
  return (
    <div className="seite">
      <p className="zurueck"><a href="v2/arbeit">← Arbeit</a></p>
      <h1>{d.titel}</h1>
      <p className={`zustand ${d.gruppe}`}>{d.satz}</p>
      <div className="aktionen-zeile"><Verweise links={d.links} /><button type="button" className="knopf leise klein" onClick={() => app.chat(chatFrage(`Unter-Chat „${d.titel}“`, d.satz))}>Im Chat nachfragen</button></div>
      {d.stand && <Abschnitt id="d-stand" titel="Was der Agent zuletzt gemeldet hat" erklaerung="Der letzte Stand in den Worten des Agenten — was erledigt ist, was offen ist, was er von dir braucht."><div className="kasten"><Md text={d.stand} /></div></Abschnitt>}
      {d.fragen.length > 0 && (
        <Abschnitt id="d-fragen" titel={d.fragen.length === 1 ? 'Diese Frage ist in deiner Liste offen' : 'Diese Fragen sind in deiner Liste offen'} erklaerung="Fragen aus diesem Unter-Chat, die noch auf deine Antwort warten. Sagt der Agent oben etwas anderes, gilt deine Antwort hier — sie geht direkt an ihn.">
          <div className="karten">{d.fragen.map((k) => <EntscheidungKarte key={k.id} k={k} beantwortet={() => app.zahl(null)} />)}</div>
        </Abschnitt>
      )}
      {d.nachrichten.length > 0 && !verlauf && <p><button type="button" className="knopf leise klein" onClick={() => setVerlauf(true)}>Verlauf des Unter-Chats zeigen</button></p>}
      {d.nachrichten.length > 0 && verlauf && (
        <Abschnitt id="d-verlauf" titel="Verlauf" erklaerung="Die letzten Nachrichten dieses Unter-Chats." fuss={d.nachrichten.length > 3 ? <button type="button" className="knopf leise klein" onClick={() => setAlle(!alle)}>{alle ? 'Nur die letzten 3' : `Alle ${d.nachrichten.length} zeigen`}</button> : null}>
          {msgs.map((n) => <div key={n.id} className={`blase ${n.rolle}`}><p className="klein gedimmt">{n.rolle === 'ich' ? 'Du / Auftrag' : 'Agent'} · {wann(n.at)}</p><Md text={n.text.length > 6000 ? `${n.text.slice(0, 6000)} …` : n.text} klein /></div>)}
        </Abschnitt>
      )}
    </div>
  );
}

// ---------- PRs ----------

export function Prs({ wer }: { wer: string | null }) {
  const pfad = `api/v2/prs${wer ? `?wer=${encodeURIComponent(wer)}` : ''}`;
  const [such, setSuch] = useState('');
  const [mitEntwurf, setMitEntwurf] = useState(false);
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
  const zeilen = suche ? basis.filter(passt) : basis;
  const sonst = suche ? (alle.d?.zeilen ?? []).filter((p) => passt(p) && !zeilen.some((z) => z.pr === p.pr)) : [];
  const wahl = (n: string) => { const url = n === d.ich ? 'v2/prs' : `v2/prs?wer=${encodeURIComponent(n)}`; history.pushState(null, '', url); window.dispatchEvent(new PopStateEvent('popstate')); };
  return (
    <div className="seite">
      <h1>PRs</h1>
      <p className="unterzeile">Code-Vorschläge auf GitHub und wer gerade dran ist.{d.stand ? ` Stand: ${wann(d.stand)}` : ''}</p>
      <div className="filter">
        <label htmlFor="wer">Wartet auf</label>
        <select id="wer" value={d.wer} onChange={(e) => wahl(e.target.value)}>
          {d.personen.map((p) => <option key={p.name} value={p.name}>{p.name === 'alle' ? 'alle (offen)' : p.name === d.ich ? `mich (${p.name})` : p.name} · {p.anzahl}</option>)}
        </select>
        <label htmlFor="pr-such" className="unsichtbar">PR suchen</label>
        <input id="pr-such" type="search" value={such} onChange={(e) => setSuch(e.target.value)} placeholder="Nummer oder Titel, z. B. 268" />
        {entwuerfe > 0 && <label className="klein"><input type="checkbox" checked={mitEntwurf} onChange={(e) => setMitEntwurf(e.target.checked)} /> Entwürfe zeigen ({entwuerfe})</label>}
      </div>
      {zeilen.length ? <ul className="liste">{zeilen.map((p) => <PrZeileView key={p.pr} p={p} />)}</ul>
        : suche && sonst.length ? null
        : suche ? <p className="leer">Kein offener PR passt zu „{such}“.</p> : <p className="leer">{d.wer === d.ich ? 'Kein PR wartet auf dich.' : `Kein PR wartet auf ${d.wer}.`}</p>}
      {sonst.length > 0 && <><p className="gruppe-titel">In anderen Listen gefunden</p><ul className="liste">{sonst.slice(0, 10).map((p) => <PrZeileView key={p.pr} p={p} />)}</ul></>}
    </div>
  );
}

export function PrDetail({ repo, nummer }: { repo: string; nummer: string }) {
  const app = useApp();
  const { d, fehler, neu } = useDaten<{ pr: string; titel: string; url: string | null; autor: string | null; offen: boolean; merge: boolean; wartetAuf: string[]; warum: string; entscheidung: string | null; offeneThreads: number; reviews: { wer: string; zustand: string; at: string }[];
    agent: { status: string; empfehlung: string | null; text: string | null; gepostet: string | null; entwurf: boolean; at: string; bericht: string | null } | null }>(`api/v2/prs/${encodeURIComponent(repo)}/${nummer}`);
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  const ZUSTAND: Record<string, string> = { APPROVED: 'freigegeben', CHANGES_REQUESTED: 'Änderungen verlangt', COMMENTED: 'kommentiert', DISMISSED: 'zurückgezogen' };
  return (
    <div className="seite">
      <p className="zurueck"><a href="v2/prs">← PRs</a></p>
      <h1>{d.pr} · {d.titel}</h1>
      <p className="zustand">{!d.offen ? 'Nicht mehr offen — gemergt oder geschlossen.' : d.merge ? 'Freigegeben — wartet auf den Merge (macht ein Mensch auf GitHub).' : d.wartetAuf.length ? `Wartet auf ${d.wartetAuf.join(', ')} — ${d.warum}.` : `${d.warum || 'Wartet auf niemanden'}.`}</p>
      <div className="aktionen-zeile">
        {d.url && <a className="verweis" href={d.url} target="_blank" rel="noopener noreferrer">Auf GitHub öffnen ↗</a>}
        {d.agent?.bericht && <a className="verweis" href={rel(d.agent.bericht)}>Bericht des Reviews</a>}
        <button type="button" className="knopf leise klein" onClick={() => app.chat(chatFrage(`PR ${d.pr}`, d.titel))}>Im Chat nachfragen</button>
      </div>
      <Abschnitt id="p-menschen" titel="Reviews von Menschen" erklaerung="Wer den PR auf GitHub geprüft hat und mit welchem Ergebnis.">
        {d.reviews.length ? <ul className="liste">{d.reviews.map((r, i) => <li key={i} className="zeile"><div className="zeile-haupt"><b>{r.wer}</b> · {ZUSTAND[r.zustand] ?? r.zustand}</div><div className="zeile-rechts"><span className="zeit">{wann(r.at)}</span></div></li>)}</ul> : <p className="leer">Noch kein Review von einem Menschen.</p>}
        {d.offeneThreads > 0 && <p className="klein">{mehrzahl(d.offeneThreads, 'offener Kommentar-Faden', 'offene Kommentar-Fäden')} auf GitHub.</p>}
        {d.autor && <p className="klein gedimmt">Geschrieben von {d.autor}.</p>}
      </Abschnitt>
      <Abschnitt id="p-agent" titel="Review des Agenten" erklaerung="Was der Review-Agent zu diesem PR geschrieben hat — derselbe Text, der auf GitHub steht. Du brauchst dafür kein GitHub-Konto.">
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
  return (
    <div className="seite">
      <h1>Dokumente</h1>
      <p className="unterzeile">Berichte der Agenten und Notizen aus unserer Wissenssammlung.</p>
      <form className="suche" role="search" onSubmit={(e) => { e.preventDefault(); setSuche(q.trim()); }}>
        <label htmlFor="such" className="unsichtbar">Dokumente durchsuchen</label>
        <input id="such" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen, z. B. Datenschutz, Tarif …" />
      </form>
      {fehler ? <Fehler text={fehler} nochmal={neu} /> : !d ? <Laedt /> : (
        <Abschnitt id="d-liste" titel={d.q ? `Treffer für „${d.q}“` : 'Zuletzt geändert'} erklaerung="Berichte sind Ergebnisse von Unter-Chats; Notizen stammen aus unserer gemeinsamen Wissenssammlung. Die Suche findet Wörter im Titel und im Pfad.">
          {d.frei && !d.frei.notizen && !d.frei.berichte ? <p className="leer">Dokumente sind für dich noch nicht freigegeben — frag Knut.</p>
            : d.treffer.length ? <ul className="liste">{d.treffer.map((x) => <DokZeile key={x.url} x={x} />)}</ul> : <p className="leer">Nichts gefunden. Versuch ein anderes Wort (z. B. kürzer oder englisch).</p>}
        </Abschnitt>
      )}
    </div>
  );
}

export function Dokument({ vault, paket, datei }: { vault: string | null; paket: string | null; datei: string | null }) {
  const app = useApp();
  const pfad = vault ? `api/vault/note?path=${encodeURIComponent(vault)}` : paket ? `api/files/agenten/${encodeURIComponent(paket)}/${(datei ?? 'bericht.md').split('/').map(encodeURIComponent).join('/')}?vorschau=1` : null;
  const { d, fehler, neu } = useDaten<{ title?: string; name?: string; html: string | null; text?: string | null; mtime?: number; backlinks?: { path: string; title: string }[] }>(pfad);
  if (!pfad) return <Fehler text="Kein Dokument angegeben." />;
  if (fehler) return <Fehler text={fehler.includes('Admins') ? 'Dieses Dokument kann nur Knut öffnen.' : fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  const titel = d.title ?? (paket ? `Bericht ${paket.split('-')[0]} · ${paket.replace(/^\d+-/, '').replace(/-/g, ' ')}` : d.name ?? '');
  return (
    <div className="seite dokument">
      <p className="zurueck"><a href="v2/dokumente">← Dokumente</a></p>
      <h1>{titel}</h1>
      <div className="aktionen-zeile">
        {d.mtime ? <span className="klein gedimmt">geändert {wann(new Date(d.mtime).toISOString())}</span> : null}
        <button type="button" className="knopf leise klein" onClick={() => app.chat(`Fass mir das Dokument „${titel}“ in drei Sätzen zusammen und sag, was daran offen ist.`)}>Im Chat fragen</button>
      </div>
      <article className="kasten md" dangerouslySetInnerHTML={{ __html: htmlFuerV2(d.html ?? `<pre>${(d.text ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</pre>`) }} />
      {d.backlinks && d.backlinks.length > 0 && (
        <Abschnitt id="d-verweise" titel="Wird erwähnt in" erklaerung="Andere Notizen, die auf diese verweisen.">
          <ul className="liste">{d.backlinks.slice(0, 12).map((b) => <Zeile key={b.path} titel={b.title} url={`v2/dokument?vault=${encodeURIComponent(b.path)}`} />)}</ul>
        </Abschnitt>
      )}
    </div>
  );
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
      <p className="unterzeile"><label htmlFor="erledigt-tag">Tag: </label><input id="erledigt-tag" type="date" value={d.tag} max={d.heute} onChange={(e) => waehlen(e.target.value)} /></p>
      {!d.erledigt.length && <p className="leer">An diesem Tag ist nichts fertig geworden.</p>}
      {abgenommen.length > 0 && <Abschnitt id="e-abgenommen" titel="Von dir abgenommen" erklaerung="Unter-Chats, die du an diesem Tag geprüft und abgehakt hast."><ul className="liste">{abgenommen.map((e) => <Zeile key={e.id} titel={e.titel} url={e.links[0]?.url ?? `v2/arbeit/${e.id}`} rechts={e.uhr} marke={{ text: 'abgenommen', ton: 'gruen' }} links={e.links.slice(1)} />)}</ul></Abschnitt>}
      {zumLesen.length > 0 && <Abschnitt id="e-zumlesen" titel="Fertig, Bericht noch nicht gelesen" erklaerung="Ein Agent hat an diesem Tag fertig gemeldet; den Bericht hast du noch nicht abgenommen."><ul className="liste">{zumLesen.map((e) => <Zeile key={e.id} titel={e.titel} url={e.links[0]?.url ?? `v2/arbeit/${e.id}`} rechts={e.uhr} marke={{ text: 'zum Lesen' }} links={e.links.slice(1)} />)}</ul></Abschnitt>}
    </div>
  );
}

// ---------- Mehr (S14, C5): alles aus der alten Werkbank hat hier einen Platz ----------

export function Mehr() {
  const app = useApp();
  const v2 = MEHR.filter((e) => e.ziel === 'v2'), alt = MEHR.filter((e) => e.ziel === 'alt');
  return (
    <div className="seite">
      <h1>Mehr</h1>
      <p className="unterzeile">Alles, was die alte Werkbank kann, findest du hier — entweder schon in der neuen Oberfläche oder mit einem Klick in der alten.</p>
      <Abschnitt id="m-alt" titel="In der alten Werkbank" erklaerung="Diese Seiten gibt es (noch) nur in der alten Werkbank. Ein Klick öffnet sie in einem neuen Tab; die Anmeldung gilt dort auch.">
        <ul className="liste">{alt.map((e) => <Zeile key={e.alt} titel={e.titel} url={app.alt ? `${app.alt}/${e.url}` : '#'} satz={e.satz} />)}</ul>
      </Abschnitt>
      <Abschnitt id="m-neu" titel="Schon in der neuen Oberfläche" erklaerung="Was du aus der alten Werkbank kennst und hier schon findest.">
        <ul className="liste">{v2.map((e) => <Zeile key={e.alt} titel={e.titel} url={e.url} satz={e.satz} />)}</ul>
      </Abschnitt>
      <Abschnitt id="m-konto" titel="Konto" erklaerung="Wer angemeldet ist; Abmelden gilt für dieses Gerät.">
        <p>Angemeldet als <b>{app.ich.name}</b>. <button type="button" className="knopf leise klein" onClick={() => fetch('api/logout', { method: 'POST', headers: { 'x-werkbank': '1' } }).finally(() => window.dispatchEvent(new Event('v2-abgemeldet')))}>Abmelden</button></p>
      </Abschnitt>
    </div>
  );
}

// ---------- Alle Chats (S12, Knut 03.11. Punkt 3): suchen, nach Art/Status/Thema/Zeit filtern, von jeder Zeile in den Chat ----------

interface ChatZeile { id: string; art: 'hauptchat' | 'unterchat' | 'chat' | 'chat2'; titel: string; thema: string | null; status: string; zuletzt: string | null; url: string | null; conv: string | null }
const ART_TEXT: Record<ChatZeile['art'], string> = { hauptchat: 'Hauptchat', unterchat: 'Unter-Chat', chat: 'Chat', chat2: 'Chat (neu)' };
const ZEIT: [string, number][] = [['7 Tage', 7], ['30 Tage', 30], ['90 Tage', 90], ['alle', 0]];

export function AlleChats() {
  const app = useApp();
  const { d, fehler, neu } = useDaten<{ zeilen: ChatZeile[]; themen: string[]; fehlt?: string[] }>('api/v2/chats');
  const [such, setSuch] = useState('');
  const [art, setArt] = useState<'alle' | 'unterchat' | 'haupt' | 'chat'>('alle');
  const [status, setStatus] = useState('alle');
  const [thema, setThema] = useState('alle');
  const [tage, setTage] = useState(0);
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  const s = such.trim().toLowerCase();
  const grenze = tage ? Date.now() - tage * 86400_000 : 0;
  const liste = d.zeilen.filter((z) =>
    (art === 'alle' || (art === 'unterchat' && z.art === 'unterchat') || (art === 'haupt' && z.art === 'hauptchat') || (art === 'chat' && (z.art === 'chat' || z.art === 'chat2')))
    && (status === 'alle' || z.status === status) && (thema === 'alle' || z.thema === thema)
    && (!grenze || (z.zuletzt && Date.parse(z.zuletzt) >= grenze))
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
        <select value={tage} onChange={(e) => setTage(Number(e.target.value))} aria-label="Zeitraum">{ZEIT.map(([t, n]) => <option key={n} value={n}>{n ? `letzte ${t}` : 'jede Zeit'}</option>)}</select>
      </div>
      {!!d.fehlt?.length && <p className="fehlertext klein">Nicht erreichbar: {d.fehlt.join(', ')} — diese Chats fehlen gerade in der Liste.</p>}
      <p className="klein gedimmt">{mehrzahl(liste.length, 'Treffer', 'Treffer')} von {d.zeilen.length}</p>
      {liste.length ? (
        <ul className="liste">{liste.slice(0, 200).map((z) => z.art === 'chat2'
          ? <li key={z.id} className="zeile"><div className="zeile-haupt"><button type="button" className="zeile-titel knopf-link" onClick={() => z.conv && app.chatOeffnen(z.conv)}>{z.titel}</button><p className="zeile-satz">{ART_TEXT[z.art]} · {z.status}</p></div><div className="zeile-rechts"><span className="zeit">{wann(z.zuletzt)}</span></div></li>
          : <Zeile key={z.id} titel={z.titel} url={z.url ?? '#'} satz={`${ART_TEXT[z.art]} · ${z.status}${z.thema ? ` · ${z.thema}` : ''}${z.art !== 'unterchat' ? ' · öffnet im Chat (LibreChat)' : ''}`} rechts={wann(z.zuletzt)} />)}</ul>
      ) : <p className="leer">Nichts gefunden — anderer Suchbegriff oder Filter?</p>}
      {liste.length > 200 && <p className="klein gedimmt">Die ersten 200 — enger suchen, um den Rest zu sehen.</p>}
    </div>
  );
}
