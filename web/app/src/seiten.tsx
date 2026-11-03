// Werkbank 2.0: die Seiten. Eine Startseite („Jetzt“) und vier Bereiche; jede Seite liest genau einen Endpunkt der 2.0-API.
import { useEffect, useState } from 'react';
import { schicke, type ArbeitKarte, type Dok, type Karte, type Link, type PrZeile, type Start } from './api.ts';
import { useApp } from './kontext.ts';
import { Abschnitt, EntscheidungKarte, Fehler, Laedt, Md, useDaten, Verweise, Zeile } from './teile.tsx';
import { BEGRIFFE } from './begriffe.ts';
import { chatFrage, htmlFuerV2, mehrzahl, wann } from './format.ts';

const EMPFEHLUNG: Record<string, string> = { approve: 'Agent: freigeben', 'request-changes': 'Agent: Änderungen nötig', comment: 'Agent: Anmerkungen' };

function gruss(name: string) {
  const h = Number(new Date().toLocaleTimeString('de-AT', { timeZone: 'Europe/Vienna', hour: '2-digit', hour12: false }));
  return `${h < 11 ? 'Guten Morgen' : h < 18 ? 'Hallo' : 'Guten Abend'}, ${name}`;
}

// ---------- Jetzt ----------

export function Jetzt() {
  const app = useApp();
  const { d, fehler, neu } = useDaten<Start>('/api/v2/start');
  useEffect(() => { if (d) app.zahl(d.zahl); }, [d]);
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  return (
    <div className="seite">
      <h1>{gruss(d.ich)}</h1>
      {!d.admin && (
        <div className="willkommen">
          <p><b>So funktioniert der Workspace:</b> Agenten erledigen Aufträge (<b>Unter-Chats</b>) und fragen, wenn sie etwas nicht selbst entscheiden dürfen. Was davon an dich geht, steht hier ganz oben unter „Was du jetzt tun musst“.</p>
          <p className="klein">Unbekannte Wörter? <a href="/v2/begriffe">Begriffe in Klartext</a> · Jede Karte hat „Was ist das?“.</p>
        </div>
      )}
      <Abschnitt id="a-jetzt" titel="Was du jetzt tun musst" erklaerung="Die wichtigsten Dinge, die ohne deine Antwort nicht weitergehen — höchstens fünf, wichtigste zuerst: zuerst Entscheidungen, die einen Agenten anhalten, darunter Freigaben. Die Zahl oben rechts zählt alles, was auf dich wartet."
        fuss={d.zahl > d.jetzt.length ? <a href="/v2/entscheidungen">Alle Entscheidungen ansehen →</a> : null}>
        {d.jetzt.length ? <div className="karten">{d.jetzt.map((k) => <EntscheidungKarte key={k.id} k={k} beantwortet={() => app.zahl(null)} />)}</div>
          : <p className="leer">Gerade wartet nichts auf dich.</p>}
      </Abschnitt>
      {d.admin && (
        <Abschnitt id="a-laeuft" titel="Läuft gerade" erklaerung="Unter-Chats, an denen ein Agent gerade arbeitet — mit voraussichtlichem Ende. Du musst hier nichts tun."
          fuss={<a href="/v2/arbeit">Alle Unter-Chats →</a>}>
          {d.laeuft.length ? <ul className="liste">{d.laeuft.map((z) => <Zeile key={z.id} titel={z.titel} url={`/v2/arbeit/${z.id}`} satz={z.satz} />)}</ul> : <p className="leer">Gerade läuft nichts.</p>}
        </Abschnitt>
      )}
      {d.admin && (
        <Abschnitt id="a-erledigt" titel="Heute erledigt" erklaerung="Was heute fertig geworden ist, mit der Uhrzeit, zu der es fertig wurde. „Zum Lesen“: fertig, der Bericht wartet auf deinen Blick — du musst nichts entscheiden. Was noch eine Antwort braucht, steht oben, nicht hier.">
          {d.erledigt.length ? <ul className="liste">{d.erledigt.map((e) => <Zeile key={e.id} titel={e.titel} url={e.links[0]?.url ?? `/v2/arbeit/${e.id}`} rechts={e.uhr} marke={e.stand === 'zum-lesen' ? { text: 'zum Lesen' } : { text: 'abgenommen', ton: 'gruen' }} links={e.links.slice(1)} />)}</ul>
            : <p className="leer">Heute ist noch nichts fertig geworden.</p>}
        </Abschnitt>
      )}
      <Abschnitt id="a-prs" titel="PRs, die auf dich warten" erklaerung="Code-Vorschläge auf GitHub (Pull Requests), bei denen du gerade dran bist — zum Prüfen, Freigeben oder Nachbessern. Unter „PRs“ kannst du auf jede andere Person umschalten."
        fuss={<a href="/v2/prs">Alle PRs →</a>}>
        {d.prs === null ? <p className="leer">Die PR-Liste ist gerade nicht erreichbar.</p>
          : d.prs.length ? <ul className="liste">{d.prs.map((p) => <PrZeileView key={p.pr} p={p} />)}</ul> : <p className="leer">Kein PR wartet auf dich.</p>}
      </Abschnitt>
      <Abschnitt id="a-dok" titel="Neue Dokumente" erklaerung="Die zuletzt geänderten Berichte und Notizen. Alles Lesbare findest du unter „Dokumente“ — mit Suche." fuss={<a href="/v2/dokumente">Alle Dokumente →</a>}>
        {d.dokumente.length ? <ul className="liste">{d.dokumente.map((x) => <DokZeile key={x.url} x={x} />)}</ul> : <p className="leer">Keine neuen Dokumente.</p>}
      </Abschnitt>
    </div>
  );
}

const DokZeile = ({ x }: { x: Dok }) => <Zeile titel={x.titel} url={x.url} satz={x.worum} marke={{ text: x.art === 'bericht' ? 'Bericht' : 'Notiz' }} rechts={wann(x.at)} />;
const PrZeileView = ({ p }: { p: PrZeile }) => (
  <Zeile titel={`${p.pr} · ${p.titel}`} url={`/v2/prs/${encodeURIComponent(p.repo)}/${p.number}`} satz={p.wartetAuf.length ? `wartet auf ${p.wartetAuf.join(', ')} — ${p.warum}` : p.warum || 'wartet auf niemanden'}
    marke={p.review?.empfehlung ? { text: EMPFEHLUNG[p.review.empfehlung] ?? p.review.empfehlung, ton: p.review.empfehlung === 'approve' ? 'gruen' : '' } : p.entwurf ? { text: 'Entwurf' } : undefined} rechts={wann(p.geaendert)} />
);

// ---------- Entscheidungen ----------

export function Entscheidungen() {
  const app = useApp();
  const { d, fehler, neu } = useDaten<{ zahl: number; oben: Karte[]; rest: Karte[] }>('/api/v2/entscheidungen');
  useEffect(() => { if (d) app.zahl(d.zahl); }, [d]);
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  return (
    <div className="seite">
      <h1>Entscheidungen</h1>
      <p className="unterzeile">Fragen mit Empfehlung. „Ja, so“ übernimmt die Empfehlung, „Anders …“ schickt deinen eigenen Text — an genau diese Karte.</p>
      <Abschnitt id="e-zuerst" titel="Zuerst" erklaerung="Dieselben fünf wie auf der Startseite: was einen Agenten anhält oder bald als angenommen gilt.">
        {d.oben.length ? <div className="karten">{d.oben.map((k) => <EntscheidungKarte key={k.id} k={k} beantwortet={() => app.zahl(null)} />)}</div> : <p className="leer">Gerade wartet nichts auf dich.</p>}
      </Abschnitt>
      {d.rest.length > 0 && (
        <Abschnitt id="e-weitere" titel="Weitere" erklaerung="Alles andere, was auf dich wartet — nach Thema sortiert, wie es kommt.">
          <div className="karten">{d.rest.map((k) => <EntscheidungKarte key={k.id} k={k} beantwortet={() => app.zahl(null)} />)}</div>
        </Abschnitt>
      )}
    </div>
  );
}

// ---------- Arbeit ----------

export function Arbeit() {
  const { d, fehler, neu } = useDaten<{ gruppen: Record<'wartet' | 'laeuft' | 'fertig', ArbeitKarte[]>; nurAdmin?: boolean }>('/api/v2/arbeit');
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  if (d.nurAdmin) return (
    <div className="seite"><h1>Arbeit</h1>
      <div className="willkommen"><p><b>Hier stehen deine Unter-Chats.</b> Ein Unter-Chat ist ein Auftrag, an dem ein Agent selbstständig arbeitet und am Ende einen Bericht schreibt. Du hast gerade keine — Knut verteilt die Aufträge.</p><p className="klein"><a href="/v2/begriffe">Begriffe in Klartext</a></p></div>
    </div>
  );
  const g = d.gruppen;
  const liste = (l: ArbeitKarte[], leer: string) => (l.length ? <ul className="liste">{l.map((z) => <Zeile key={z.id} titel={z.titel} url={`/v2/arbeit/${z.id}`} satz={z.satz} rechts={wann(z.zuletzt)} links={z.links} />)}</ul> : <p className="leer">{leer}</p>);
  return (
    <div className="seite">
      <h1>Arbeit</h1>
      <p className="unterzeile">Deine Unter-Chats: Aufträge, an denen Agenten selbstständig arbeiten.</p>
      <Abschnitt id="w-wartet" titel="Wartet auf dich" erklaerung="Unter-Chats, die ohne dich nicht weiterkommen: eine offene Frage, ein Hänger oder kein Stand. Ein Klick zeigt, was genau.">{liste(g.wartet, 'Kein Unter-Chat wartet auf dich.')}</Abschnitt>
      <Abschnitt id="w-laeuft" titel="Läuft" erklaerung="Hier arbeitet gerade ein Agent. Du musst nichts tun.">{liste(g.laeuft, 'Gerade läuft nichts.')}</Abschnitt>
      <Abschnitt id="w-fertig" titel="Fertig" erklaerung="Fertige Unter-Chats, die du noch nicht abgenommen hast — der Bericht liegt bereit.">{liste(g.fertig, 'Nichts Fertiges offen.')}</Abschnitt>
    </div>
  );
}

export function ArbeitDetail({ id }: { id: string }) {
  const app = useApp();
  const { d, fehler, neu } = useDaten<{ titel: string; satz: string; gruppe: string; zuletzt: string | null; stand: string; fragen: Karte[]; nachrichten: { id: string; rolle: string; text: string; at: string }[]; links: Link[] }>(`/api/v2/arbeit/${id}`);
  const [alle, setAlle] = useState(false);
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  const msgs = alle ? d.nachrichten : d.nachrichten.slice(-3);
  return (
    <div className="seite">
      <p className="zurueck"><a href="/v2/arbeit">← Arbeit</a></p>
      <h1>{d.titel}</h1>
      <p className={`zustand ${d.gruppe}`}>{d.satz}</p>
      <div className="aktionen-zeile"><Verweise links={d.links} /><button type="button" className="knopf leise klein" onClick={() => app.chat(chatFrage(`Unter-Chat „${d.titel}“`, d.satz))}>Im Chat nachfragen</button></div>
      {d.fragen.length > 0 && (
        <Abschnitt id="d-fragen" titel={d.fragen.length === 1 ? 'Diese Frage wartet auf dich' : 'Diese Fragen warten auf dich'} erklaerung="Der Agent kommt ohne deine Antwort nicht weiter. Antworte direkt an der Karte.">
          <div className="karten">{d.fragen.map((k) => <EntscheidungKarte key={k.id} k={k} beantwortet={() => app.zahl(null)} />)}</div>
        </Abschnitt>
      )}
      {d.stand && <Abschnitt id="d-stand" titel="Letzter Stand" erklaerung="Was der Agent zuletzt gemeldet hat, in seinen Worten."><div className="kasten"><Md text={d.stand} /></div></Abschnitt>}
      {d.nachrichten.length > 0 && (
        <Abschnitt id="d-verlauf" titel="Verlauf" erklaerung="Die letzten Nachrichten dieses Unter-Chats." fuss={d.nachrichten.length > 3 ? <button type="button" className="knopf leise klein" onClick={() => setAlle(!alle)}>{alle ? 'Nur die letzten 3' : `Alle ${d.nachrichten.length} zeigen`}</button> : null}>
          {msgs.map((n) => <div key={n.id} className={`blase ${n.rolle}`}><p className="klein gedimmt">{n.rolle === 'ich' ? 'Du / Auftrag' : 'Agent'} · {wann(n.at)}</p><Md text={n.text.length > 6000 ? `${n.text.slice(0, 6000)} …` : n.text} klein /></div>)}
        </Abschnitt>
      )}
    </div>
  );
}

// ---------- PRs ----------

export function Prs({ wer }: { wer: string | null }) {
  const pfad = `/api/v2/prs${wer ? `?wer=${encodeURIComponent(wer)}` : ''}`;
  const { d, fehler, neu } = useDaten<{ wer: string; ich: string; personen: { name: string; anzahl: number }[]; zeilen: PrZeile[]; stand: string | null }>(pfad);
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  const wahl = (n: string) => { const url = n === d.ich ? '/v2/prs' : `/v2/prs?wer=${encodeURIComponent(n)}`; history.pushState(null, '', url); window.dispatchEvent(new PopStateEvent('popstate')); };
  return (
    <div className="seite">
      <h1>PRs</h1>
      <p className="unterzeile">Code-Vorschläge auf GitHub und wer gerade dran ist.{d.stand ? ` Stand: ${wann(d.stand)}` : ''}</p>
      <div className="filter">
        <label htmlFor="wer">Wartet auf</label>
        <select id="wer" value={d.wer} onChange={(e) => wahl(e.target.value)}>
          {d.personen.map((p) => <option key={p.name} value={p.name}>{p.name === 'alle' ? 'alle (offen)' : p.name === d.ich ? `mich (${p.name})` : p.name} · {p.anzahl}</option>)}
        </select>
      </div>
      {d.zeilen.length ? <ul className="liste">{d.zeilen.map((p) => <PrZeileView key={p.pr} p={p} />)}</ul> : <p className="leer">{d.wer === d.ich ? 'Kein PR wartet auf dich.' : `Kein PR wartet auf ${d.wer}.`}</p>}
    </div>
  );
}

export function PrDetail({ repo, nummer }: { repo: string; nummer: string }) {
  const app = useApp();
  const { d, fehler, neu } = useDaten<{ pr: string; titel: string; url: string | null; autor: string | null; offen: boolean; merge: boolean; wartetAuf: string[]; warum: string; entscheidung: string | null; offeneThreads: number; reviews: { wer: string; zustand: string; at: string }[];
    agent: { status: string; empfehlung: string | null; text: string | null; gepostet: string | null; at: string; bericht: string | null } | null }>(`/api/v2/prs/${encodeURIComponent(repo)}/${nummer}`);
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  const ZUSTAND: Record<string, string> = { APPROVED: 'freigegeben', CHANGES_REQUESTED: 'Änderungen verlangt', COMMENTED: 'kommentiert', DISMISSED: 'zurückgezogen' };
  return (
    <div className="seite">
      <p className="zurueck"><a href="/v2/prs">← PRs</a></p>
      <h1>{d.pr} · {d.titel}</h1>
      <p className="zustand">{!d.offen ? 'Nicht mehr offen — gemergt oder geschlossen.' : d.merge ? 'Freigegeben — wartet auf den Merge (macht ein Mensch auf GitHub).' : d.wartetAuf.length ? `Wartet auf ${d.wartetAuf.join(', ')} — ${d.warum}.` : `${d.warum || 'Wartet auf niemanden'}.`}</p>
      <div className="aktionen-zeile">
        {d.url && <a className="verweis" href={d.url} target="_blank" rel="noopener noreferrer">Auf GitHub öffnen ↗</a>}
        {d.agent?.bericht && <a className="verweis" href={d.agent.bericht}>Bericht des Reviews</a>}
        <button type="button" className="knopf leise klein" onClick={() => app.chat(chatFrage(`PR ${d.pr}`, d.titel))}>Im Chat nachfragen</button>
      </div>
      <Abschnitt id="p-agent" titel="Review des Agenten" erklaerung="Was der Review-Agent zu diesem PR geschrieben hat — derselbe Text, der auf GitHub steht. Du brauchst dafür kein GitHub-Konto.">
        {d.agent?.text ? (
          <div className="kasten">
            <p><span className={`marke ${d.agent.empfehlung === 'approve' ? 'gruen' : 'warn'}`}>{EMPFEHLUNG[d.agent.empfehlung ?? ''] ?? 'Agent'}</span> <span className="klein gedimmt">{wann(d.agent.at)}</span></p>
            <Md text={d.agent.text} />
            {d.agent.gepostet && <p className="klein"><a href={d.agent.gepostet} target="_blank" rel="noopener noreferrer">So steht es auf GitHub ↗</a></p>}
          </div>
        ) : <p className="leer">{d.agent ? `Review ${d.agent.status === 'fertig' ? 'fertig, aber ohne Text' : `läuft (${d.agent.status})`}.` : 'Für diesen PR gibt es noch kein Review des Agenten.'}</p>}
      </Abschnitt>
      <Abschnitt id="p-menschen" titel="Reviews von Menschen" erklaerung="Wer den PR auf GitHub geprüft hat und mit welchem Ergebnis.">
        {d.reviews.length ? <ul className="liste">{d.reviews.map((r, i) => <li key={i} className="zeile"><div className="zeile-haupt"><b>{r.wer}</b> · {ZUSTAND[r.zustand] ?? r.zustand}</div><div className="zeile-rechts"><span className="zeit">{wann(r.at)}</span></div></li>)}</ul> : <p className="leer">Noch kein Review von einem Menschen.</p>}
        {d.offeneThreads > 0 && <p className="klein">{mehrzahl(d.offeneThreads, 'offener Kommentar-Faden', 'offene Kommentar-Fäden')} auf GitHub.</p>}
        {d.autor && <p className="klein gedimmt">Geschrieben von {d.autor}.</p>}
      </Abschnitt>
    </div>
  );
}

// ---------- Dokumente ----------

export function Dokumente({ q: q0 }: { q: string }) {
  const [q, setQ] = useState(q0);
  const [suche, setSuche] = useState(q0);
  useEffect(() => { const t = setTimeout(() => setSuche(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { history.replaceState(null, '', suche ? `/v2/dokumente?q=${encodeURIComponent(suche)}` : '/v2/dokumente'); }, [suche]);
  const { d, fehler, neu } = useDaten<{ q: string; treffer: Dok[] }>(`/api/v2/dokumente${suche ? `?q=${encodeURIComponent(suche)}` : ''}`);
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
          {d.treffer.length ? <ul className="liste">{d.treffer.map((x) => <DokZeile key={x.url} x={x} />)}</ul> : <p className="leer">Nichts gefunden. Versuch ein anderes Wort (z. B. kürzer oder englisch).</p>}
        </Abschnitt>
      )}
    </div>
  );
}

export function Dokument({ vault, paket, datei }: { vault: string | null; paket: string | null; datei: string | null }) {
  const app = useApp();
  const pfad = vault ? `/api/vault/note?path=${encodeURIComponent(vault)}` : paket ? `/api/files/agenten/${encodeURIComponent(paket)}/${(datei ?? 'bericht.md').split('/').map(encodeURIComponent).join('/')}?vorschau=1` : null;
  const { d, fehler, neu } = useDaten<{ title?: string; name?: string; html: string | null; text?: string | null; mtime?: number; backlinks?: { path: string; title: string }[] }>(pfad);
  if (!pfad) return <Fehler text="Kein Dokument angegeben." />;
  if (fehler) return <Fehler text={fehler.includes('Admins') ? 'Dieses Dokument kann nur Knut öffnen.' : fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  const titel = d.title ?? (paket ? `Bericht ${paket.split('-')[0]} · ${paket.replace(/^\d+-/, '').replace(/-/g, ' ')}` : d.name ?? '');
  return (
    <div className="seite dokument">
      <p className="zurueck"><a href="/v2/dokumente">← Dokumente</a></p>
      <h1>{titel}</h1>
      <div className="aktionen-zeile">
        {d.mtime ? <span className="klein gedimmt">geändert {wann(new Date(d.mtime).toISOString())}</span> : null}
        <button type="button" className="knopf leise klein" onClick={() => app.chat(`Fass mir das Dokument „${titel}“ in drei Sätzen zusammen und sag, was daran offen ist.`)}>Im Chat fragen</button>
      </div>
      <article className="kasten md" dangerouslySetInnerHTML={{ __html: htmlFuerV2(d.html ?? `<pre>${(d.text ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</pre>`) }} />
      {d.backlinks && d.backlinks.length > 0 && (
        <Abschnitt id="d-verweise" titel="Wird erwähnt in" erklaerung="Andere Notizen, die auf diese verweisen.">
          <ul className="liste">{d.backlinks.slice(0, 12).map((b) => <Zeile key={b.path} titel={b.title} url={`/v2/dokument?vault=${encodeURIComponent(b.path)}`} />)}</ul>
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

export function Anmelden({ fertig }: { fertig: () => void }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  async function los(e: React.FormEvent) {
    e.preventDefault(); setLaeuft(true); setFehler(null);
    try { await schicke('/api/login', { email, password: pw }); fertig(); } catch (x: any) { setFehler(x.status === 401 || x.status === 400 ? 'E-Mail oder Passwort stimmt nicht.' : x.message); } finally { setLaeuft(false); }
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

