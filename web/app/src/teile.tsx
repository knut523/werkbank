// Werkbank 2.0: gemeinsame Bausteine — jede Karte hat dieselben Teile: Titel · ein Satz · Links · „Was ist das?“.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import MarkdownIt from 'markdown-it';
import { schicke, hole, type Karte, type Link } from './api.ts';
import { useApp } from './kontext.ts';
import { chatBesprechen, chatFrage, istIntern, rel } from './format.ts';

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });
const linkOpen = md.renderer.rules.link_open ?? ((t, i, o, _e, s) => s.renderToken(t, i, o));
md.renderer.rules.link_open = (t, i, o, e, s) => { const h = t[i].attrGet('href') ?? ''; if (rel(h) !== h) t[i].attrSet('href', rel(h));   /* S16: eigene Pfade relativ (auch im neuen Tab unter /werkbank) */ if (/^https?:/i.test(h)) { t[i].attrSet('target', '_blank'); t[i].attrSet('rel', 'noopener noreferrer'); } return linkOpen(t, i, o, e, s); };

/** Markdown sicher rendern (kein Roh-HTML). */
export function Md({ text, klein }: { text: string; klein?: boolean }) {
  return <div className={`md${klein ? ' klein' : ''}`} dangerouslySetInnerHTML={{ __html: md.render(text || '') }} />;
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

/** „Was ist das?“ — klappt sofort eine Erklärung aus den Daten auf; „Im Chat fragen“ öffnet den Chat mit vorbereitetem Text. */
export function WasIstDas({ zeilen, frage }: { zeilen: [string, string][]; frage: string }) {
  const [offen, setOffen] = useState(false);
  const app = useApp();
  const feld = useRef<HTMLDivElement>(null);
  useEffect(() => { if (offen) feld.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [offen]);   // Handy: nicht unter dem Rand öffnen
  return (
    <div className="wid">
      <button type="button" className="knopf leise klein" aria-expanded={offen} onClick={() => setOffen(!offen)}>{offen ? 'Erklärung schließen' : 'Was ist das?'}</button>
      {offen && (
        <div className="wid-text" role="region" aria-label="Erklärung" ref={feld}>
          <dl>{zeilen.filter(([, t]) => t).map(([k, t]) => <div key={k}><dt>{k}</dt><dd>{t}</dd></div>)}</dl>
          <button type="button" className="knopf leise klein" onClick={() => app.chat(frage)}>Im Chat fragen</button>
        </div>
      )}
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
export function Laedt({ text = 'Lädt …' }: { text?: string }) {
  const [zeigen, setZeigen] = useState(false);
  useEffect(() => { const t = setTimeout(() => setZeigen(true), 400); return () => clearTimeout(t); }, []);
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

const ANTWORT_TEXT: Record<string, string> = { ja: 'Ja, so', nein: 'Nein', anders: 'Anders …', spaeter: 'Später' };

/**
 * Entscheidung als Karte: Empfehlung hervorgehoben · „Ja, so“ · „Anders: …“ (Textfeld an DIESER Karte). Nach der Antwort bleibt die
 * Karte stehen und zeigt „✓ Ging an …“ (428 W9: kein Springen, kein zweiter Tipp auf die nächste Karte). Freigaben: nur der Link.
 */
export function EntscheidungKarte({ k, beantwortet }: { k: Karte; beantwortet?: () => void }) {
  const app = useApp();
  const [modus, setModus] = useState<'zu' | 'anders'>('zu');
  const [text, setText] = useState('');
  const [notiz, setNotiz] = useState<string | null>(null);   // S15: „Ja, so“ mit kurzer Notiz
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [fertig, setFertig] = useState<string | null>(null);
  const andersFeld = useRef<HTMLDivElement>(null);
  useEffect(() => { if (modus === 'anders') andersFeld.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [modus]);

  async function antworten(antwort: 'ja' | 'nein' | 'anders' | 'spaeter', t = '') {
    if (antwort === 'anders' && !t.trim()) { setFehler('Schreib kurz, was stattdessen.'); return; }
    setLaeuft(true); setFehler(null);
    try {
      const r = await schicke<{ ziel: string | null; spaeter: boolean }>('api/v2/antwort', { id: k.id, antwort, text: t.trim() });
      setFertig(r.spaeter ? 'Zurückgestellt — kommt morgen wieder.' : `Ging an ${r.ziel ?? 'die Quelle'}: ${antwort === 'ja' ? `„Ja, so“${k.empfehlung ? ` (${k.empfehlung})` : ''}${t.trim() ? ` mit Notiz „${t.trim()}“` : ''}` : antwort === 'nein' ? '„Nein“' : `„${t.trim()}“`}`);
      beantwortet?.();
    } catch (e: any) { setFehler(e.message); } finally { setLaeuft(false); }
  }

  const freigabe = k.art === 'freigabe';
  return (
    <article className={`karte${fertig ? ' erledigt' : ''}${freigabe ? ' freigabe' : ''}`} aria-label={k.titel}>
      <div className="karte-meta">
        <span className={`marke ${freigabe ? 'blau' : k.wichtig ? 'warn' : ''}`}>{freigabe ? 'Freigabe' : 'Entscheidung'}</span>
        {k.grund && <span className="grund">{k.grund}</span>}
      </div>
      <h3 className="karte-titel">{k.titel}</h3>
      {k.worum && <p className="karte-worum">{k.worum}</p>}
      {k.empfehlung && <p className="empfehlung"><b>Empfehlung:</b> {k.empfehlung}</p>}

      {fertig ? (
        <p className="ok" role="status">✓ {fertig}</p>
      ) : freigabe || k.alt ? (
        <div className="antworten">
          <p className="klein gedimmt">{freigabe ? 'Freigaben nach außen gibst du in der alten Werkbank — dort siehst du den genauen Stand.' : 'Das beantwortest du in der alten Werkbank.'}</p>
          <a className="knopf" href={k.alt ?? app.alt} target="_blank" rel="noopener noreferrer">{freigabe ? 'In der alten Werkbank freigeben ↗' : 'In der alten Werkbank öffnen ↗'}</a>
        </div>
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
        <>
          {notiz !== null && (
            <div className="anders">
              <label className="klein" htmlFor={`notiz-${k.id}`}>Notiz zu „Ja, so“ (geht mit an {k.quelle || 'die Quelle'})</label>
              <textarea id={`notiz-${k.id}`} rows={2} value={notiz} maxLength={2000} onChange={(e) => setNotiz(e.target.value)} placeholder="z. B. „aber erst nach dem Release“" autoFocus />
            </div>
          )}
          <div className="antworten">
            {k.antworten.filter((a) => a !== 'spaeter').map((a) => (
              <button type="button" key={a} className={`knopf${a === 'ja' ? ' haupt' : ''}`} disabled={laeuft} onClick={() => (a === 'anders' ? setModus('anders') : antworten(a, a === 'ja' ? notiz ?? '' : ''))}>{a === 'ja' && laeuft ? 'Sendet …' : a === 'ja' && notiz?.trim() ? 'Ja, so — mit Notiz' : ANTWORT_TEXT[a]}</button>
            ))}
            {k.antworten.includes('ja') && notiz === null && <button type="button" className="knopf leise klein" disabled={laeuft} onClick={() => setNotiz('')}>+ Notiz</button>}
            {k.antworten.includes('spaeter') && <button type="button" className="knopf leise klein" disabled={laeuft} onClick={() => antworten('spaeter')}>Später</button>}
            <button type="button" className="knopf leise klein" onClick={() => app.chat(chatBesprechen(k.titel, k.empfehlung, k.id))}>Im Chat besprechen</button>
          </div>
        </>
      )}
      {fehler && <p className="fehlertext" role="alert">{fehler}</p>}
      <div className="karte-fuss">
        <Verweise links={k.links} />
        <WasIstDas zeilen={k.erklaerung} frage={chatFrage(k.titel, k.worum)} />
      </div>
    </article>
  );
}
