// Werkbank 2.0: gemeinsame Bausteine — jede Karte hat dieselben Teile: Titel · ein Satz · Links · „Was ist das?“.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import MarkdownIt from 'markdown-it';
import { schicke, hole, type Karte, type Link } from './api.ts';
import { useApp } from './kontext.ts';
import { chatBesprechen, istIntern, rel, tabellenBeschriften } from './format.ts';

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
const linkOpen = md.renderer.rules.link_open ?? ((t, i, o, _e, s) => s.renderToken(t, i, o));
md.renderer.rules.link_open = (t, i, o, e, s) => { const h = t[i].attrGet('href') ?? ''; if (rel(h) !== h) t[i].attrSet('href', rel(h));   /* S16: eigene Pfade relativ (auch im neuen Tab unter /werkbank) */ if (/^https?:/i.test(h)) { t[i].attrSet('target', '_blank'); t[i].attrSet('rel', 'noopener noreferrer'); } return linkOpen(t, i, o, e, s); };

/** Markdown sicher rendern (kein Roh-HTML). */
export function Md({ text, klein }: { text: string; klein?: boolean }) {
  return <div className={`md${klein ? ' klein' : ''}`} dangerouslySetInnerHTML={{ __html: tabellenBeschriften(md.render(text || '')) }} />;
}

export function Verweis({ l }: { l: Link }) {
  if (!/^(https?:\/\/|\/)/i.test(l.url)) return <span className="verweis">{l.label}</span>;   // nur http(s) und eigene Pfade als Link
  const extern = l.extern || !istIntern(l.url);
  return <a className="verweis" href={rel(l.url)} {...(extern ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{l.label}{extern ? ' ↗' : ''}</a>;
}

export function Verweise({ links }: { links: Link[] }) {
  if (!links.length) return null;
  return <div className="verweise">{links.map((l, i) => <Verweis key={i} l={l} />)}</div>;
}

/** „Was ist das?“ an einer Karte — Erklärung aus den Daten und, bei Unter-Chats, ihr letzter Stand (erst beim Aufklappen geladen). */
function Erklaerung({ zeilen, strang }: { zeilen: [string, string][]; strang?: string | null }) {
  const [stand, setStand] = useState<{ titel: string; stand: string } | null | 'laedt'>(null);
  const app = useApp();
  useEffect(() => { if (strang && stand === null && app.ich.admin) { setStand('laedt'); hole<{ titel: string; stand: string }>(`api/v2/stand/${strang}`).then(setStand).catch(() => setStand({ titel: '', stand: '' })); } }, [strang, app.ich.admin]);
  return (
    <div className="wid-text" role="region" aria-label="Erklärung">
      <dl>{zeilen.filter(([, t]) => t).map(([k, t]) => <div key={k}><dt>{k}</dt><dd>{t}</dd></div>)}</dl>
      {stand === 'laedt' && <p className="klein gedimmt">Lädt den Stand des Unter-Chats …</p>}
      {stand && stand !== 'laedt' && stand.stand && <details className="wid-stand"><summary className="klein">Letzter Stand des Unter-Chats{stand.titel ? ` „${stand.titel}“` : ''}</summary><Md text={stand.stand} klein /></details>}
    </div>
  );
}

/** Abschnitt mit Überschrift und eigenem „Was ist das?“. */
export function Abschnitt({ titel, erklaerung, children, fuss, id }: { titel: string; erklaerung: string; children: ReactNode; fuss?: ReactNode; id?: string }) {
  const [offen, setOffen] = useState(false);
  return (
    <section className="abschnitt" aria-labelledby={id}>
      <div className="abschnitt-kopf">
        <h2 id={id}>{titel}</h2>
        <button type="button" className="knopf leise klein" aria-expanded={offen} onClick={() => setOffen(!offen)}>{offen ? 'Schließen' : 'Was ist das?'}</button>
      </div>
      {offen && <p className="hinweis">{erklaerung}</p>}
      {children}
      {fuss && <div className="abschnitt-fuss">{fuss}</div>}
    </section>
  );
}

/** Eine Zeile in einer Liste (Unter-Chat, PR, Dokument): Titel als Link, ein Satz, rechts eine Zeit oder Marke. */
export function Zeile({ titel, url, satz, rechts, marke, links }: { titel: string; url: string; satz?: string; rechts?: string; marke?: { text: string; ton?: string }; links?: Link[] }) {
  const extern = !istIntern(url);
  return (
    <li className="zeile">
      <div className="zeile-haupt">
        <a className="zeile-titel" href={rel(url)} {...(extern ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>{titel}{extern ? ' ↗' : ''}</a>
        {satz && <p className="zeile-satz">{satz}</p>}
        {links && links.length > 0 && <Verweise links={links} />}
      </div>
      {(rechts || marke) && <div className="zeile-rechts">{marke && <span className={`marke ${marke.ton ?? ''}`}>{marke.text}</span>}{rechts && <span className="zeit">{rechts}</span>}</div>}
    </li>
  );
}

/** Ladehinweis erst nach 400 ms — kurze Abrufe blitzen nicht als leere Seite auf (Persona Knut R2). */
export function Laedt({ text = 'Lädt …', sofort = false }: { text?: string; sofort?: boolean }) {
  const [zeigen, setZeigen] = useState(sofort);   // sofort: dort, wo der Text etwas verspricht (Reviewer-Start, Runde 4)
  useEffect(() => { const t = setTimeout(() => setZeigen(true), 200); return () => clearTimeout(t); }, []);   // Runde 5 (Knut B3): früher sichtbar, aber kein Blitzen bei schnellen Abrufen
  return <p className="laedt" role="status" aria-busy="true">{zeigen ? text : '\u00a0'}</p>;
}
export function Fehler({ text, nochmal }: { text: string; nochmal?: () => void }) {
  return <div className="fehler" role="alert"><p>{text}</p>{nochmal && <button type="button" className="knopf klein" onClick={nochmal}>Noch einmal</button>}</div>;
}

/** Zuletzt gesehener Stand je Adresse: sofort zeigen, im Hintergrund nachladen (kein leeres „Lädt …“ beim Zurückblättern). */
const zuletzt = new Map<string, unknown>();
/** Beim Abmelden/Anmelden leeren — nie Daten einer anderen Person zeigen. */
export function vergessen() { zuletzt.clear(); }
/** Vorab holen (z. B. direkt nach dem Login), damit der erste Bildschirm sofort steht. */
export function vorab(pfad: string) { return hole(pfad).then((x) => { zuletzt.set(pfad, x); }).catch(() => {}); }

/** Daten holen mit Laden/Fehler; `neu()` lädt erneut. */
export function useDaten<T>(pfad: string | null): { d: T | null; fehler: string | null; neu: () => void } {
  const [d, setD] = useState<T | null>(() => (pfad ? (zuletzt.get(pfad) as T) ?? null : null));
  const [fehler, setFehler] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!pfad) return;
    let aus = false;
    setFehler(null);
    setD((zuletzt.get(pfad) as T) ?? null);   // nie Inhalt einer anderen Adresse (Pass C), aber den eigenen letzten Stand sofort
    hole<T>(pfad).then((x) => { zuletzt.set(pfad, x); if (!aus) setD(x); }).catch((e) => { if (!aus) { if (e.status === 401) window.dispatchEvent(new Event('v2-abgemeldet')); setFehler(e.message); } });
    return () => { aus = true; };
  }, [pfad, n]);
  return { d, fehler, neu: () => setN((x) => x + 1) };
}

/** Runde 4 (Knut B10): „D1 bis D8, jede mit Empfehlung …“ — eine Karte für mehrere Entscheidungen, die auf der Karte nicht stehen. */
export const sammelKarte = (t: string) => /\bD\d{1,2}\s*(?:bis|–|-)\s*D\d{1,2}\b/.test(t);

/**
 * Entscheidung als Karte — radikal simpel (Knut 04.11.): ein Satz und EIN Hauptknopf („Ja, so: <Empfehlung>“), leise „Anders …“ und
 * „Was ist das?“. Dort steht alles Übrige: worum es geht, die gemeinten Entscheidungen, Nein, Später, Notiz, Chat, Links. Nach der Antwort
 * bleibt die Karte stehen und zeigt „✓ Ging an …“ (428 W9). Freigaben: nur der Link in die alte Werkbank.
 */
export function EntscheidungKarte({ k, beantwortet }: { k: Karte; beantwortet?: () => void }) {
  const app = useApp();
  const [modus, setModus] = useState<'zu' | 'anders'>('zu');
  const [mehr, setMehr] = useState(false);
  const [text, setText] = useState('');
  const [notiz, setNotiz] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [fertig, setFertig] = useState<string | null>(null);
  const [unterwegs, setUnterwegs] = useState(false);
  const andersFeld = useRef<HTMLDivElement>(null);
  useEffect(() => { if (modus === 'anders') andersFeld.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [modus]);
  const lebt = useRef(true);
  useEffect(() => () => { lebt.current = false; }, []);

  async function antworten(antwort: 'ja' | 'nein' | 'anders' | 'spaeter', t = '') {
    if (antwort === 'anders' && !t.trim()) { setFehler('Schreib kurz, was stattdessen.'); return; }
    setLaeuft(true); setFehler(null);
    // Runde 5 (Knut B2): das Zustellen an einen Unter-Chat dauert Sekunden — gleich sagen, dass es unterwegs ist und man weitermachen kann.
    const zuweilen = setTimeout(() => { if (lebt.current) setUnterwegs(true); }, 700);
    try {
      const r = await schicke<{ ziel: string | null; spaeter: boolean }>('api/v2/antwort', { id: k.id, antwort, text: t.trim() });
      vergessen();   // Runde 5c (Knut B2): kein zwischengespeicherter Stand, in dem die beantwortete Karte noch steht
      setFertig(r.spaeter ? 'Zurückgestellt — kommt morgen wieder.' : `Ging an ${r.ziel ?? 'die Quelle'}: ${antwort === 'ja' ? `„Ja, so“${k.empfehlung ? ` (${k.empfehlung})` : ''}${t.trim() ? ` mit Notiz „${t.trim()}“` : ''}` : antwort === 'nein' ? '„Nein“' : `„${t.trim()}“`}`);
      if (app.testbetrieb && !r.spaeter && !/^(Unter-Chat|Hauptchat)/.test(k.quelle)) setFertig((x) => `${x} — Testbetrieb: Fragen aus Notizen bleiben hier offen.`);
      beantwortet?.();
    } catch (e: any) {
      if (lebt.current) setFehler(e.message);
      else window.dispatchEvent(new CustomEvent('v2-meldung', { detail: `Deine Antwort zu „${k.titel.slice(0, 80)}“ kam nicht an: ${e.message}` }));
    } finally { clearTimeout(zuweilen); if (lebt.current) { setLaeuft(false); setUnterwegs(false); } }
  }

  const freigabe = k.art === 'freigabe';
  const ja = k.antworten.includes('ja');
  const n = k.bezug?.length ?? 0;
  const jaText = n ? `Ja, alle ${n} wie empfohlen` : k.empfehlung ? `Ja, so: ${k.empfehlung.length > 70 ? `${k.empfehlung.slice(0, 68)}…` : k.empfehlung}` : 'Ja';
  const strang = k.links.map((l) => /\/v2\/arbeit\/([0-9a-f]{8})$/.exec(l.url)?.[1]).find(Boolean) ?? null;
  return (
    <article className={`karte${fertig ? ' erledigt' : ''}${freigabe ? ' freigabe' : ''}`} aria-label={k.titel}>
      <h3 className="karte-titel">{k.titel}</h3>
      {sammelKarte(`${k.titel} ${k.worum}`) && !n && !freigabe && !fertig && <p className="klein hinweis-warn">Fasst mehrere Entscheidungen zusammen, die hier nicht einzeln stehen — „Ja, so“ bestätigt alle.{k.bericht ? <> <a href={rel(k.bericht)}>Im Bericht lesen</a></> : null}</p>}

      {fertig ? (
        <p className="ok" role="status" ref={(el) => el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}>✓ {fertig}</p>
      ) : freigabe || k.alt ? (
        <div className="antworten"><a className="knopf haupt" href={k.alt ?? app.alt} target="_blank" rel="noopener noreferrer">{freigabe ? 'In der alten Werkbank freigeben ↗' : 'In der alten Werkbank öffnen ↗'}</a><button type="button" className="knopf leise klein" aria-expanded={mehr} onClick={() => setMehr(!mehr)}>Was ist das?</button></div>
      ) : modus === 'anders' ? (
        <div className="anders" ref={andersFeld}>
          <label className="klein" htmlFor={`anders-${k.id}`}>Was stattdessen? (geht an {k.quelle || 'die Quelle'})</label>
          {k.alternativen.length > 0 && <div className="chips">{k.alternativen.map((a) => <button type="button" key={a} className="chip" onClick={() => setText(a)}>{a}</button>)}</div>}
          <textarea id={`anders-${k.id}`} rows={3} value={text} maxLength={4000} onChange={(e) => setText(e.target.value)} placeholder="Dein eigener Text" autoFocus />
          <div className="antworten">
            <button type="button" className="knopf haupt" disabled={laeuft} onClick={() => antworten('anders', text)}>{laeuft ? 'Sendet …' : 'Senden'}</button>
            <button type="button" className="knopf leise" disabled={laeuft} onClick={() => { setModus('zu'); setFehler(null); }}>Abbrechen</button>
          </div>
        </div>
      ) : (
        <div className="antworten">
          {ja ? <button type="button" className="knopf haupt" disabled={laeuft} onClick={() => antworten('ja', notiz)}>{laeuft ? 'Sendet …' : notiz.trim() ? `${jaText} — mit Notiz` : jaText}</button>
            : <button type="button" className="knopf haupt" onClick={() => setModus('anders')}>Antworten …</button>}
          {ja && k.antworten.includes('anders') && <button type="button" className="knopf leise klein" disabled={laeuft} onClick={() => setModus('anders')}>Anders …</button>}
          <button type="button" className="knopf leise klein" aria-expanded={mehr} onClick={() => setMehr(!mehr)}>{mehr ? 'Weniger' : 'Was ist das?'}</button>
        </div>
      )}
      {unterwegs && !fertig && <p className="ok unterwegs" role="status">⏳ Wird an {k.quelle || 'die Quelle'} zugestellt — dauert ein paar Sekunden, du kannst weitermachen.</p>}
      {fehler && <p className="fehlertext" role="alert">{fehler}</p>}

      {mehr && (
        <div className="karte-mehr">
          {k.grund && <p className="klein gedimmt">{freigabe ? 'Freigabe' : 'Entscheidung'} · {k.grund}</p>}
          {k.worum && <p className="karte-worum">{k.worum}</p>}
          {k.empfehlung && <p className="empfehlung"><b>Empfehlung:</b> {k.empfehlung}</p>}
          {n > 0 && (
            <div className="bezug">
              <p className="klein"><b>Gemeint sind {n} Entscheidungen aus dem Bericht</b> — „Ja“ bestätigt jede Empfehlung:</p>
              <ul className="klein">{k.bezug!.map((b) => <li key={b.id}><b>{b.id}</b> {b.frage}{b.empfehlung ? <> — <i>Empfehlung: {b.empfehlung}</i></> : null}{b.antwort ? <span className="gedimmt"> (im Bericht: {b.antwort})</span> : null}</li>)}</ul>
              {k.bericht && <p className="klein"><a href={rel(k.bericht)}>Ganzen Bericht lesen</a></p>}
            </div>
          )}
          <Erklaerung zeilen={k.erklaerung.filter(([t]) => !['Empfehlung', 'Warum oben', 'Hält an'].includes(t))} strang={strang} />   {/* steht schon in der Grund-Zeile */}
          {!fertig && !freigabe && !k.alt && (
            <div className="antworten">
              {ja && <label className="klein notiz">Notiz zu „Ja“: <input value={notiz} maxLength={2000} onChange={(e) => setNotiz(e.target.value)} placeholder="z. B. „aber erst nach dem Release“" /></label>}
              {k.antworten.includes('nein') && <button type="button" className="knopf leise klein" disabled={laeuft} onClick={() => antworten('nein')}>Nein</button>}
              {k.antworten.includes('spaeter') && <button type="button" className="knopf leise klein" disabled={laeuft} onClick={() => antworten('spaeter')}>Später</button>}
              <button type="button" className="knopf leise klein" onClick={() => app.chat(chatBesprechen(k.titel, k.empfehlung, k.id))}>Im Chat besprechen</button>
            </div>
          )}
          <Verweise links={k.links} />
        </div>
      )}
    </article>
  );
}
