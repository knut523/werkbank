// Werkbank 2.0: Deck-Review (docs/plan-deck-review.md) — Liste der Decks, Deck-Ansicht mit Folien, Kommentar je Folie (optional
// mit Markierung), Status je Kommentar, Vergleich zweier Fassungen, Präsentieren; dazu die öffentliche Teilen-Seite für Externe
// (eigener Link je Deck, keine Anmeldung). Ersetzt die Nebenserver deck-review* (server.py auf 8110/8111/8112).
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { ApiFehler, hole, klartext, schicke } from './api.ts';
import { Abschnitt, Fehler, Laedt, useDaten, Zeile } from './teile.tsx';
import { useApp } from './kontext.ts';
import { vergleichAus, type DeckFassung } from './deckkern.ts';

// ---------- Typen (wie web/server/deckroutes.ts liefert) ----------

export type Status = 'offen' | 'gesendet' | 'umgesetzt' | 'abgelehnt' | 'notiz';
export interface Markierung { x: number; y: number; w: number; h: number }
export interface DeckKommentar { id: string; folie: number; fassung: string; text: string; markierung: Markierung | null; autor: string; extern: boolean; status: Status; statusText: string; grund: string | null; at: string; erledigtIn: string | null }
interface DeckLink { id: string; name: string; ablauf: string; widerrufen: string | null; erstellt: string; genutzt: string | null; kommentare: number; gueltig: boolean }
interface DeckDaten {
  slug: string; titel: string; aktuell: string | null; fassungen: DeckFassung[]; kommentare: DeckKommentar[]; rendern: string[]; renderFehler: { fassung: string; text: string } | null; admin: boolean;
  unterchat?: string | null; auto?: boolean; ordner?: string | null; letzterVersand?: string | null; naechsterVersand?: string | null; sendeFehler?: string | null; weitereInAblage?: string[]; links?: DeckLink[];
}
interface DeckZeile { slug: string; titel: string; angelegt: boolean; aktuell: string | null; fassungen: string[]; folien?: number; zahlen?: Record<string, number>; auto?: boolean; unterchat?: boolean; at: string }

export const STATUS_TON: Record<Status, string> = { offen: 'warn', gesendet: 'blau', umgesetzt: 'gruen', abgelehnt: 'rot', notiz: '' };
const uhr = (s: string | null | undefined) => (s ? new Date(s).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const tag = (s: string) => new Date(s).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric' });
const geaendertText = (f: DeckFassung | undefined, vorher: string | undefined) => (f?.geaendert && vorher ? (f.geaendert.length ? `geändert gegenüber ${vorher}: Folie ${f.geaendert.join(', ')}` : `gleich wie ${vorher}`) : '');

// ---------- Liste ----------

export function Decks() {
  const { d, fehler, neu } = useDaten<{ decks: DeckZeile[]; ablage: DeckZeile[]; admin: boolean }>('api/v2/decks');
  const [anlegen, setAnlegen] = useState<string | null>(null);
  const [unterchat, setUnterchat] = useState('');
  const [melde, setMelde] = useState<string | null>(null);
  const [alle, setAlle] = useState(false);
  if (fehler && !d) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  const los = async (slug: string) => {
    setMelde(null);
    try { await schicke('api/v2/decks', { slug, unterchat: unterchat.trim() || null }); history.pushState(null, '', new URL(`v2/decks/${slug}`, document.baseURI).pathname); window.dispatchEvent(new PopStateEvent('popstate')); }
    catch (e: any) { setMelde(e.message); }
  };
  const satz = (x: DeckZeile) => {
    const z = x.zahlen ?? {};
    const teile = [`Fassung ${x.aktuell ?? '—'}`, `${x.folien ?? 0} Folien`, x.unterchat ? (x.auto ? 'geht alle 10 min an den Unter-Chat' : 'an den Unter-Chat von Hand') : 'ohne Unter-Chat'];
    if (z.abgelehnt) teile.push(`${z.abgelehnt} abgelehnt`);
    return teile.join(' · ');
  };
  const marke = (x: DeckZeile) => { const z = x.zahlen ?? {}; return z.offen ? { text: `${z.offen} offen`, ton: 'warn' } : z.gesendet ? { text: `${z.gesendet} beim Unter-Chat`, ton: 'blau' } : { text: 'nichts offen', ton: 'gruen' }; };
  return (
    <div className="seite">
      <h1>Decks im Review</h1>
      <p className="unterzeile">Folien ansehen, je Folie kommentieren, Fassungen vergleichen. Kommentare gehen gesammelt an den Unter-Chat, der das Deck baut.</p>
      <Abschnitt id="d-review" titel="Im Review" erklaerung="Decks, die hier angelegt sind: jede neue Fassung in deinen Dokumenten erscheint von selbst (die Folien werden aus PDF oder PowerPoint erzeugt). Zahlen rechts: offene Kommentare.">
        {d.decks.length ? <ul className="liste">{d.decks.map((x) => <Zeile key={x.slug} titel={x.titel} url={`v2/decks/${x.slug}`} satz={satz(x)} marke={marke(x)} rechts={uhr(x.at)} />)}</ul> : <p className="leer">Noch kein Deck im Review. Lege unten eines aus deinen Dokumenten an.</p>}
      </Abschnitt>
      <Abschnitt id="d-ablage" titel="In den Dokumenten" erklaerung="Decks, die in deinen Dokumenten oder im Teilen-Ordner liegen (Dateiname mit „_deck_“ und Fassung), aber noch nicht im Review sind. Anlegen erzeugt die Folienbilder der neuesten fünf Fassungen.">
        {d.ablage.length ? <><ul className="liste">{(alle ? d.ablage : d.ablage.slice(0, 5)).map((x) => (
          <li key={x.slug} className="zeile">
            <div className="zeile-haupt">
              <span className="zeile-titel">{x.titel}</span>
              <p className="zeile-satz">Fassungen {x.fassungen.join(', ')}</p>
              {anlegen === x.slug && <div className="deck-anlegen">
                <label className="klein">Unter-Chat, der das Deck baut (Kennung, 8 Zeichen, optional)<input value={unterchat} onChange={(e) => setUnterchat(e.target.value)} placeholder="z. B. ba58c60a" maxLength={8} /></label>
                <div className="antworten"><button type="button" className="knopf haupt klein" onClick={() => void los(x.slug)}>Zum Review anlegen</button><button type="button" className="knopf leise klein" onClick={() => setAnlegen(null)}>Abbrechen</button></div>
                {melde && <p className="fehlertext">{melde}</p>}
              </div>}
            </div>
            <div className="zeile-rechts"><span className="zeit">{tag(x.at)}</span>{d.admin && anlegen !== x.slug && <button type="button" className="knopf klein" onClick={() => { setAnlegen(x.slug); setMelde(null); }}>Anlegen …</button>}</div>
          </li>
        ))}</ul>{d.ablage.length > 5 && <button type="button" className="knopf leise klein" onClick={() => setAlle(!alle)}>{alle ? 'Weniger zeigen' : `Alle ${d.ablage.length} zeigen`}</button>}</> : <p className="leer">Keine weiteren Decks in deinen Dokumenten.</p>}
      </Abschnitt>
    </div>
  );
}

// ---------- Bild: intern direkt, auf der Teilen-Seite mit dem Token im Kopf (Blob) — das Token steht nie in einer Adresse ----------

let teilenToken = '';
async function teilenBlob(pfad: string): Promise<Blob> {
  const r = await fetch(pfad, { headers: { 'x-deck-token': teilenToken }, credentials: 'omit' });
  if (!r.ok) throw new ApiFehler(r.status, klartext(r.status));
  return r.blob();
}
function Bild({ src, alt, sofort = false }: { src: string; alt: string; sofort?: boolean }) {
  const extern = !!teilenToken && src.startsWith('api/deck-teilen/');
  const [url, setUrl] = useState<string | null>(extern ? null : src);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!extern) { setUrl(src); return; }
    let weg = false, u: string | null = null;
    const laden = () => teilenBlob(src).then((b) => { if (weg) return; u = URL.createObjectURL(b); setUrl(u); }).catch(() => {});
    // wie loading=lazy: erst holen, wenn die Folie in die Nähe kommt
    const io = !sofort && 'IntersectionObserver' in window ? new IntersectionObserver((e) => { if (e.some((x) => x.isIntersecting)) { io!.disconnect(); void laden(); } }, { rootMargin: '600px' }) : null;
    if (io && ref.current) io.observe(ref.current); else void laden();
    return () => { weg = true; io?.disconnect(); if (u) URL.revokeObjectURL(u); };
  }, [src, extern]);
  return <img ref={ref} src={url ?? 'data:image/gif;base64,R0lGODlhAQABAAAAACw='} alt={alt} loading={extern ? undefined : 'lazy'} draggable={false} className={url ? '' : 'laedt-bild'} />;
}
async function herunterladen(pfad: string) {
  const b = await teilenBlob(pfad);
  const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = decodeURIComponent(pfad.split('/').slice(-2).join('.'));
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

// ---------- Folienbild mit Markierungen (und Zeichnen) ----------

function FolienBild({ src, alt, marken, zeichnen, neu, setNeu }: { src: string; alt: string; marken: { nr: number; m: Markierung; ton: string }[]; zeichnen: boolean; neu: Markierung | null; setNeu: (m: Markierung | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const punkt = (e: RPointerEvent) => { const r = ref.current!.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
  const rechteck = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
  const stil = (m: Markierung) => ({ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%` });
  return (
    <div ref={ref} className={`folie-bild${zeichnen ? ' zeichnen' : ''}`}
      onPointerDown={zeichnen ? (e) => { (e.target as Element).setPointerCapture?.(e.pointerId); start.current = punkt(e); setNeu(null); } : undefined}
      onPointerMove={zeichnen ? (e) => { if (start.current) setNeu(rechteck(start.current, punkt(e))); } : undefined}
      onPointerUp={zeichnen ? (e) => { if (start.current) { const r = rechteck(start.current, punkt(e)); setNeu(r.w > 0.01 && r.h > 0.01 ? r : null); } start.current = null; } : undefined}>
      <Bild src={src} alt={alt} />
      {marken.map((x) => <span key={x.nr} className={`markierung ${x.ton}`} style={stil(x.m)}><b>{x.nr}</b></span>)}
      {neu && <span className="markierung neu" style={stil(neu)} />}
    </div>
  );
}

// ---------- Eine Folie: Bild (oder Vergleich), Kommentare, Eingabe ----------

interface FolieProps {
  nr: number; fassung: string; vergleich: string | null; geaendert: boolean; neuIn: string | null;
  bild: (fassung: string, n: number) => string; folienIn: (fassung: string) => number;
  kommentare: DeckKommentar[]; admin: boolean; extern: boolean;
  senden: (b: { folie: number; text: string; markierung: Markierung | null; notiz: boolean; fassung: string }) => Promise<void>;
  status?: (id: string, status: Status, grund: string) => Promise<void>;
  praesentieren?: () => void;
}
function Folie(p: FolieProps) {
  const [text, setText] = useState('');
  const [zeichnen, setZeichnen] = useState(false);
  const [mark, setMark] = useState<Markierung | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  const eigene = p.kommentare.filter((k) => k.folie === p.nr);
  const marken = (f: string) => eigene.map((k, i) => ({ k, i })).filter(({ k }) => k.fassung === f && k.markierung).map(({ k, i }) => ({ nr: i + 1, m: k.markierung!, ton: STATUS_TON[k.status] }));
  const los = async (notiz: boolean) => {
    if (!text.trim()) return;
    setLaeuft(true); setFehler(null);
    try { await p.senden({ folie: p.nr, text: text.trim(), markierung: mark, notiz, fassung: p.fassung }); setText(''); setMark(null); setZeichnen(false); }
    catch (e: any) { setFehler(e.message); } finally { setLaeuft(false); }
  };
  const da = (f: string) => p.folienIn(f) >= p.nr;
  return (
    <article className={`karte deck-folie${p.nr ? '' : ' ganz'}`} id={`folie-${p.nr}`}>
      {p.nr === 0 ? <h2>Ganzes Deck / Storyline</h2> : <div className="deck-folie-bilder">
        <div className="deck-folie-kopf">
          <h2>Folie {p.nr}</h2>
          {p.geaendert && <span className="marke warn">geändert in {p.fassung}</span>}
          {p.neuIn && <span className="marke">neu in {p.neuIn}</span>}
          {p.praesentieren && <button type="button" className="knopf leise klein" onClick={p.praesentieren}>▶ ab hier</button>}
        </div>
        {p.vergleich ? (
          <div className="vergleich">
            <figure><figcaption className="klein gedimmt">vorher · {p.vergleich}</figcaption>{da(p.vergleich) ? <FolienBild src={p.bild(p.vergleich, p.nr)} alt={`Folie ${p.nr}, Fassung ${p.vergleich}`} marken={marken(p.vergleich)} zeichnen={false} neu={null} setNeu={() => {}} /> : <p className="leer klein">Diese Folie gab es in {p.vergleich} nicht.</p>}</figure>
            <figure><figcaption className="klein gedimmt">nachher · {p.fassung}</figcaption><FolienBild src={p.bild(p.fassung, p.nr)} alt={`Folie ${p.nr}, Fassung ${p.fassung}`} marken={marken(p.fassung)} zeichnen={zeichnen} neu={mark} setNeu={setMark} /></figure>
          </div>
        ) : <FolienBild src={p.bild(p.fassung, p.nr)} alt={`Folie ${p.nr}, Fassung ${p.fassung}`} marken={marken(p.fassung)} zeichnen={zeichnen} neu={mark} setNeu={setMark} />}
      </div>}
      <div className="deck-folie-kommentare">
        <Kommentare liste={eigene} admin={p.admin} status={p.status} fassung={p.fassung} />
        <label className="unsichtbar" htmlFor={`t-${p.nr}`}>{p.nr ? `Kommentar zu Folie ${p.nr}` : 'Kommentar zum ganzen Deck'}</label>
        <textarea id={`t-${p.nr}`} className="deck-text" value={text} onChange={(e) => setText(e.target.value)} placeholder={p.nr ? 'Was soll sich auf dieser Folie ändern?' : 'Reihenfolge, Kernbotschaft, Folie streichen …'} maxLength={4000} />
        {p.nr > 0 && <div className="antworten">
          <button type="button" className={`knopf klein${zeichnen ? ' an' : ''}`} aria-pressed={zeichnen} onClick={() => setZeichnen(!zeichnen)}>{zeichnen ? (mark ? 'Fertig markiert' : 'Bereich auf dem Bild ziehen …') : mark ? 'Markierung ändern' : 'Bereich markieren'}</button>
          {mark && <button type="button" className="knopf leise klein" onClick={() => setMark(null)}>Markierung entfernen</button>}
        </div>}
        <div className="antworten">
          <button type="button" className="knopf haupt" disabled={laeuft || !text.trim()} onClick={() => void los(false)}>Kommentieren</button>
          {!p.extern && <button type="button" className="knopf leise klein" disabled={laeuft || !text.trim()} onClick={() => void los(true)} title="Bleibt hier stehen, geht nicht an den Unter-Chat">Nur als Notiz</button>}
        </div>
        {fehler && <p className="fehlertext">{fehler}</p>}
      </div>
    </article>
  );
}

function Kommentare({ liste, admin, status, fassung }: { liste: DeckKommentar[]; admin: boolean; status?: FolieProps['status']; fassung: string }) {
  if (!liste.length) return null;
  // Kommentare zu anderen Fassungen derselben Foliennummer: gedimmt (der Inhalt kann ein anderer sein)
  return <ol className="deck-kommentare">{liste.map((k, i) => <KommentarZeile key={k.id} k={k} nr={i + 1} admin={admin} status={status} andere={k.folie > 0 && k.fassung !== fassung} />)}</ol>;
}
function KommentarZeile({ k, nr, admin, status, andere }: { k: DeckKommentar; nr: number; admin: boolean; status?: FolieProps['status']; andere?: boolean }) {
  const [ablehnen, setAblehnen] = useState(false);
  const [grund, setGrund] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const setzen = async (s: Status, g = '') => { setFehler(null); try { await status!(k.id, s, g); setAblehnen(false); setGrund(''); } catch (e: any) { setFehler(e.message); } };
  return (
    <li className={`deck-kommentar ${STATUS_TON[k.status]}${andere ? ' andere-fassung' : ''}`} title={andere ? `zu Fassung ${k.fassung}` : undefined}>
      <div className="deck-kommentar-kopf">
        <span className="klein"><b>{k.markierung ? `${nr} · ` : ''}{k.autor}</b>{k.extern ? ' (extern)' : ''} · {uhr(k.at)} · {k.fassung}</span>
        <span className={`marke ${STATUS_TON[k.status]}`}>{k.statusText}{k.status === 'umgesetzt' && k.erledigtIn ? ` in ${k.erledigtIn}` : ''}</span>
      </div>
      <p className="deck-kommentar-text">{k.text}</p>
      {k.grund && <p className="klein gedimmt">{k.status === 'abgelehnt' ? 'Grund: ' : ''}{k.grund}</p>}
      {admin && status && <div className="antworten">
        {(k.status === 'offen' || k.status === 'gesendet' || k.status === 'abgelehnt') && <button type="button" className="knopf leise klein" onClick={() => void setzen('umgesetzt')}>Umgesetzt</button>}
        {(k.status === 'offen' || k.status === 'gesendet' || k.status === 'umgesetzt') && <button type="button" className="knopf leise klein" onClick={() => setAblehnen(!ablehnen)}>Ablehnen …</button>}
        {k.status !== 'offen' && <button type="button" className="knopf leise klein" onClick={() => void setzen('offen')}>{k.status === 'notiz' ? 'Doch an den Unter-Chat' : 'Wieder öffnen'}</button>}
      </div>}
      {ablehnen && <div className="anders"><textarea value={grund} onChange={(e) => setGrund(e.target.value)} placeholder="Warum nicht? (ein Satz)" maxLength={500} /><button type="button" className="knopf klein" disabled={grund.trim().length < 3} onClick={() => void setzen('abgelehnt', grund)}>Ablehnen</button></div>}
      {fehler && <p className="fehlertext">{fehler}</p>}
    </li>
  );
}

// ---------- Präsentieren ----------

function Praesentation({ bilder, start, ende }: { bilder: string[]; start: number; ende: (i: number) => void }) {
  const [i, setI] = useState(start);
  const jetzt = useRef(start); jetzt.current = i;   // für Esc/Vollbild-Ende ohne Setter im State-Updater (Pass B 12)
  useEffect(() => {
    const el = document.documentElement;
    el.requestFullscreen?.().catch(() => {});
    const taste = (e: KeyboardEvent) => {
      if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); setI((x) => Math.min(bilder.length - 1, x + 1)); }
      else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
      else if (e.key === 'Escape') ende(jetzt.current);
    };
    const voll = () => { if (!document.fullscreenElement) ende(jetzt.current); };
    document.addEventListener('keydown', taste); document.addEventListener('fullscreenchange', voll);
    return () => { document.removeEventListener('keydown', taste); document.removeEventListener('fullscreenchange', voll); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); };
  }, []);
  return (
    // Tippen links (erstes Drittel) blättert zurück, sonst vor — auch am Handy
    <div className="praesentation" role="dialog" aria-modal="true" aria-label="Präsentation" tabIndex={-1} ref={(el) => el?.focus()} onClick={(e) => { const zurueck = e.clientX < window.innerWidth / 3; setI((x) => Math.max(0, Math.min(bilder.length - 1, x + (zurueck ? -1 : 1)))); }}>
      <Bild key={i} src={bilder[i]} alt={`Folie ${i + 1}`} sofort />
      <span className="praes-zahl">{i + 1} / {bilder.length}</span>
      <button type="button" className="knopf klein praes-ende" onClick={(e) => { e.stopPropagation(); ende(i); }}>Beenden (Esc)</button>
    </div>
  );
}

// ---------- Folienliste (gemeinsam für Werkbank und Teilen-Seite) ----------

function FolienListe({ d, bild, datei, admin, extern, senden, status }: { d: { aktuell: string | null; fassungen: DeckFassung[]; kommentare: DeckKommentar[] }; bild: (f: string, n: number) => string; datei: (f: string, art: 'pdf' | 'pptx') => string; admin: boolean; extern: boolean; senden: FolieProps['senden']; status?: FolieProps['status'] }) {
  const [fassung, setFassung] = useState<string | null>(null);
  const [vergleich, setVergleich] = useState<string>('');
  const [filter, setFilter] = useState<'alle' | 'kommentiert' | 'geaendert'>('alle');
  const [praes, setPraes] = useState<number | null>(null);
  const f = fassung && d.fassungen.some((x) => x.fassung === fassung) ? fassung : d.aktuell;
  const idx = d.fassungen.findIndex((x) => x.fassung === f);
  const fd = d.fassungen[idx];
  const vorher = d.fassungen[idx - 1]?.fassung;
  const folienIn = (x: string) => d.fassungen.find((y) => y.fassung === x)?.folien ?? 0;
  const v = vergleich && vergleich !== f ? vergleich : null;
  // „geändert“ gegenüber der Vergleichsfassung — sonst gegenüber der vorigen
  const geaendertGegen = useMemo(() => {
    if (!fd) return new Set<number>();
    if (!v) return new Set(fd.geaendert ?? []);
    return new Set(vergleichAus(d.fassungen, v, fd.fassung));
  }, [fd, v, d.fassungen]);
  if (!f || !fd) return <p className="leer">Noch keine Folien — die erste Fassung wird gerade erzeugt.</p>;
  const nummern = Array.from({ length: fd.folien }, (_, i) => i + 1).filter((n) => filter === 'alle' || (filter === 'kommentiert' ? d.kommentare.some((k) => k.folie === n) : geaendertGegen.has(n)));
  const neuIn = (n: number) => { const erste = d.fassungen.find((x) => x.folien >= n); return erste && erste.fassung === f && idx > 0 ? f : null; };
  return (
    <>
      <div className="filter deck-werkzeug">
        <label htmlFor="d-fassung">Fassung</label>
        <select id="d-fassung" value={f} onChange={(e) => setFassung(e.target.value)}>{[...d.fassungen].reverse().map((x) => <option key={x.fassung} value={x.fassung}>{x.fassung}{x.fassung === d.aktuell ? ' (aktuell)' : ''} · {x.folien} Folien</option>)}</select>
        <label htmlFor="d-vergleich">Vergleichen mit</label>
        <select id="d-vergleich" value={v ?? ''} onChange={(e) => setVergleich(e.target.value)}><option value="">— kein Vergleich —</option>{[...d.fassungen].reverse().filter((x) => x.fassung !== f).map((x) => <option key={x.fassung} value={x.fassung}>{x.fassung}</option>)}</select>
        <label htmlFor="d-filter">Zeigen</label>
        <select id="d-filter" value={filter} onChange={(e) => setFilter(e.target.value as any)}><option value="alle">alle Folien</option><option value="kommentiert">nur kommentierte</option><option value="geaendert">nur geänderte</option></select>
        <button type="button" className="knopf klein" onClick={() => setPraes(0)}>▶ Präsentieren</button>
        {(['pdf', 'pptx'] as const).filter((art) => fd[art]).map((art) => extern
          ? <button key={art} type="button" className="knopf klein" onClick={() => void herunterladen(datei(f, art))}>⬇ {art === 'pdf' ? 'PDF' : 'PowerPoint'}</button>
          : <a key={art} className="knopf klein" href={datei(f, art)} download>⬇ {art === 'pdf' ? 'PDF' : 'PowerPoint'}</a>)}
      </div>
      <p className="klein gedimmt">{fd.folien} Folien · {v ? `${geaendertGegen.size ? `geändert gegenüber ${v}: Folie ${[...geaendertGegen].join(', ')}` : `keine Änderung gegenüber ${v} erkannt`}` : geaendertText(fd, vorher)}</p>
      <Folie key="0" nr={0} {...gemeinsam()} />
      {nummern.map((n) => <Folie key={`${f}-${n}`} nr={n} {...gemeinsam()} geaendert={geaendertGegen.has(n)} neuIn={neuIn(n)} praesentieren={() => setPraes(n - 1)} />)}
      {!nummern.length && <p className="leer">Keine Folie passt zum Filter.</p>}
      {praes !== null && <Praesentation bilder={Array.from({ length: fd.folien }, (_, i) => bild(f, i + 1))} start={praes} ende={(i) => { setPraes(null); document.getElementById(`folie-${i + 1}`)?.scrollIntoView({ block: 'start' }); }} />}
    </>
  );
  function gemeinsam() { return { fassung: f!, vergleich: v, geaendert: false, neuIn: null, bild, folienIn, kommentare: d.kommentare, admin, extern, senden, status }; }
}

// ---------- Deck-Ansicht (angemeldet) ----------

export function Deck({ slug }: { slug: string }) {
  const app = useApp();
  const { d, fehler, neu } = useDaten<DeckDaten>(`api/v2/decks/${slug}`);
  useEffect(() => { const t = setInterval(neu, 20_000); return () => clearInterval(t); }, [neu]);   // neue Fassungen und Rückmeldungen erscheinen von selbst
  if (fehler && !d) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  // Render-Zeitpunkt in der Adresse: nach „neu erzeugen“ derselben Fassung kein altes Bild aus dem Cache
  const bild = (f: string, n: number) => `api/v2/decks/${slug}/bild/${encodeURIComponent(f)}/${n}?r=${encodeURIComponent(d.fassungen.find((x) => x.fassung === f)?.at ?? '')}`;
  const senden: FolieProps['senden'] = async (b) => { await schicke(`api/v2/decks/${slug}/kommentar`, b); neu(); };
  const status: FolieProps['status'] = async (id, s, grund) => { await schicke(`api/v2/decks/${slug}/kommentar/${id}`, { status: s, grund }); neu(); };
  const offen = d.kommentare.filter((k) => k.status === 'offen').length;
  return (
    <div className="seite deck-seite">
      <p className="zurueck"><a href="v2/decks">← Alle Decks</a></p>
      <h1>{d.titel}</h1>
      <p className="unterzeile">{d.aktuell ? `Aktuell ${d.aktuell}` : 'Noch keine Folien'} · {d.kommentare.length} Kommentare{offen ? `, ${offen} offen` : ''}{d.rendern.length ? ` · Folien für ${d.rendern.join(', ')} werden gerade erzeugt …` : ''}</p>
      {d.renderFehler && <p className="fehler">Die Folien für {d.renderFehler.fassung} ließen sich nicht erzeugen: {d.renderFehler.text}</p>}
      {app.ich.admin && <DeckSteuerung d={d} neu={neu} />}
      <FolienListe d={d} bild={bild} datei={(f, art) => `api/v2/decks/${slug}/datei/${encodeURIComponent(f)}/${art}`} admin={d.admin} extern={false} senden={senden} status={status} />
    </div>
  );
}

function DeckSteuerung({ d, neu }: { d: DeckDaten; neu: () => void }) {
  const [unterchat, setUnterchat] = useState(d.unterchat ?? '');
  const [melde, setMelde] = useState<{ text: string; ok: boolean } | null>(null);
  const [link, setLink] = useState<{ url: string; ablauf: string } | null>(null);
  const [linkName, setLinkName] = useState('');
  const [tage, setTage] = useState(14);
  const offen = d.kommentare.filter((k) => k.status === 'offen').length;
  const tun = async (pfad: string, b: unknown, ok: (r: any) => string) => {
    setMelde(null);
    try { const r = await schicke(`api/v2/decks/${d.slug}/${pfad}`, b); setMelde({ text: ok(r), ok: true }); neu(); return r; }
    catch (e: any) { setMelde({ text: e.message, ok: false }); return null; }
  };
  const linkNeu = async () => {
    const r = await tun('links', { name: linkName.trim(), tage }, () => 'Link angelegt — jetzt kopieren, er wird nicht noch einmal angezeigt.');
    if (r) { setLink({ url: `${new URL('v2/teilen', document.baseURI).href}#${r.token}`, ablauf: r.ablauf }); setLinkName(''); }
  };
  return (
    <div className="deck-steuerung">
      <Abschnitt id="d-unterchat" titel="Unter-Chat" erklaerung="Offene Kommentare gehen gesammelt an den Unter-Chat, der das Deck baut — automatisch alle 10 Minuten (abschaltbar) oder sofort per Knopf. Er legt die nächste Fassung in den Dokumenten ab und meldet je Kommentar „umgesetzt“ oder „abgelehnt mit Grund“ zurück.">
        <div className="kasten">
          <div className="filter">
            <label htmlFor="d-uc">Unter-Chat</label>
            <input id="d-uc" className="deck-uc" value={unterchat} onChange={(e) => setUnterchat(e.target.value)} placeholder="Kennung, z. B. ba58c60a" maxLength={8} />
            {unterchat !== (d.unterchat ?? '') && <button type="button" className="knopf klein" onClick={() => void tun('einstellungen', { unterchat: unterchat.trim() || null }, () => 'Gespeichert.')}>Speichern</button>}
            {d.unterchat && <a className="klein" href={`v2/arbeit/${d.unterchat}`}>Unter-Chat öffnen</a>}
          </div>
          <label className="deck-schalter"><input type="checkbox" checked={!!d.auto} disabled={!d.unterchat} onChange={(e) => void tun('einstellungen', { auto: e.target.checked }, () => (e.target.checked ? 'Geht wieder automatisch alle 10 Minuten.' : 'Automatisches Senden aus.'))} /> Automatisch alle 10 Minuten senden</label>
          <p className="klein gedimmt">Zuletzt gesendet: {uhr(d.letzterVersand)}{d.auto && d.unterchat && offen ? ` · nächstes Mal ab ${uhr(d.naechsterVersand)}` : ''}</p>
          {d.sendeFehler && <p className="fehlertext">Letztes Senden ging nicht: {d.sendeFehler}</p>}
          <div className="antworten">
            <button type="button" className="knopf haupt klein" disabled={!d.unterchat || !offen} onClick={() => void tun('senden', {}, (r) => (r.gesendet ? `${r.gesendet} Kommentar${r.gesendet === 1 ? '' : 'e'} an den Unter-Chat geschickt.` : 'Nichts Offenes zu senden.'))}>Jetzt an Unter-Chat senden ({offen})</button>
            <button type="button" className="knopf klein" onClick={() => void tun('rendern', {}, (r) => (r.rendern ? `Folien für ${r.rendern} Fassung${r.rendern === 1 ? '' : 'en'} werden erzeugt …` : 'Alles schon erzeugt.'))}>Neue Fassung suchen</button>
          </div>
          {!!d.weitereInAblage?.length && <p className="klein gedimmt">Ältere Fassungen in den Dokumenten, noch ohne Folien: {d.weitereInAblage.join(', ')} — <button type="button" className="knopf leise klein" onClick={() => void tun('rendern', {}, (r) => `Folien für ${r.rendern} Fassungen werden erzeugt …`)}>auch erzeugen</button></p>}
          {d.ordner && <p className="klein gedimmt">Neue Fassungen erwartet in: <code>{d.ordner}</code></p>}
        </div>
      </Abschnitt>
      <Abschnitt id="d-teilen" titel="Mit Externen teilen" erklaerung="Ein eigener Link je Person: öffnet nur dieses Deck, man kann nur lesen und kommentieren (Name beim ersten Kommentar), keine Anmeldung. Der Link läuft ab und lässt sich jederzeit widerrufen.">
        <div className="kasten">
          <div className="filter">
            <label htmlFor="d-ln">Für</label>
            <input id="d-ln" className="deck-uc" value={linkName} onChange={(e) => setLinkName(e.target.value)} placeholder="z. B. Peter" maxLength={40} />
            <label htmlFor="d-lt">gültig</label>
            <select id="d-lt" value={tage} onChange={(e) => setTage(Number(e.target.value))}>{[1, 3, 7, 14, 30, 90].map((t) => <option key={t} value={t}>{t} {t === 1 ? 'Tag' : 'Tage'}</option>)}</select>
            <button type="button" className="knopf klein" onClick={() => void linkNeu()}>Link anlegen</button>
          </div>
          {link && <div className="hinweis"><p><b>Neuer Link</b> (gültig bis {tag(link.ablauf)}) — jetzt kopieren, er wird nicht noch einmal angezeigt:</p><p className="deck-link"><code>{link.url}</code></p><button type="button" className="knopf klein" onClick={() => void navigator.clipboard?.writeText(link.url).then(() => setMelde({ text: 'Kopiert.', ok: true }))}>Kopieren</button></div>}
          {!!d.links?.length && <ul className="liste deck-links">{d.links.map((l) => (
            <li key={l.id} className="zeile">
              <div className="zeile-haupt"><span className="zeile-titel">{l.name || 'ohne Namen'}</span><p className="zeile-satz">angelegt {tag(l.erstellt)} · {l.widerrufen ? `widerrufen ${tag(l.widerrufen)}` : l.gueltig ? `gültig bis ${tag(l.ablauf)}` : `abgelaufen ${tag(l.ablauf)}`} · {l.kommentare} Kommentare{l.genutzt ? ` · zuletzt ${uhr(l.genutzt)}` : ''}</p></div>
              <div className="zeile-rechts">{l.gueltig ? <button type="button" className="knopf leise klein" onClick={() => void tun(`links/${l.id}/widerrufen`, {}, () => 'Link widerrufen.')}>Widerrufen</button> : <span className="marke">{l.widerrufen ? 'widerrufen' : 'abgelaufen'}</span>}</div>
            </li>
          ))}</ul>}
        </div>
      </Abschnitt>
      {melde && <p className={melde.ok ? 'ok' : 'fehlertext'} role="status">{melde.text}</p>}
    </div>
  );
}

// ---------- Öffentliche Teilen-Seite (ohne Anmeldung; Token nur im #-Teil der Adresse) ----------

async function teilenHole<T>(token: string, pfad: string): Promise<T> {
  const r = await fetch(pfad, { headers: { accept: 'application/json', 'x-deck-token': token }, credentials: 'omit' });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiFehler(r.status, klartext(r.status, j?.error));
  return j as T;
}
async function teilenSchicke(token: string, pfad: string, body: unknown) {
  const r = await fetch(pfad, { method: 'POST', credentials: 'omit', headers: { 'content-type': 'application/json', 'x-werkbank': '1', 'x-deck-token': token }, body: JSON.stringify(body) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiFehler(r.status, klartext(r.status, j?.error));
  return j;
}

export function DeckTeilen() {
  const token = useMemo(() => { let t = ''; try { t = decodeURIComponent(location.hash.replace(/^#/, '')); } catch { /* kaputter #-Teil: wie ohne Token */ } teilenToken = t; return t; }, []);
  const [d, setD] = useState<(DeckDaten & { name: string; ablauf: string }) | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [name, setName] = useState(() => { try { return localStorage.getItem('deck-name') ?? ''; } catch { return ''; } });
  const laden = () => teilenHole<DeckDaten & { name: string; ablauf: string }>(token, 'api/deck-teilen').then((x) => { setD(x); setFehler(null); setName((n) => n || x.name || ''); }, (e) => setFehler(e.message));
  useEffect(() => { if (!token) { setFehler('Dieser Link ist unvollständig. Bitte frag nach einem neuen.'); return; } void laden(); const t = setInterval(() => void laden(), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => { try { localStorage.setItem('deck-name', name); } catch { /* egal */ } }, [name]);
  if (fehler && !d) return <div className="teilen"><div className="seite"><h1>Deck-Review</h1><p className="fehler">{fehler}</p></div></div>;
  if (!d) return <div className="teilen"><Laedt /></div>;
  const bild = (f: string, n: number) => `api/deck-teilen/bild/${encodeURIComponent(f)}/${n}`;
  const senden: FolieProps['senden'] = async (b) => {
    if (name.trim().length < 2) throw new Error('Bitte oben deinen Namen eintragen — er steht dann bei deinem Kommentar.');
    await teilenSchicke(token, 'api/deck-teilen/kommentar', { ...b, notiz: false, name: name.trim() });
    await laden();
  };
  return (
    <div className="teilen">
      <header className="kopf"><span className="marke-name">OLAF<span className="marke-lang"> Workspace</span> · Deck-Review</span>
        <label className="teilen-name klein">Dein Name <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z. B. Peter" maxLength={40} /></label>
      </header>
      <main className="inhalt seite deck-seite">
        <h1>{d.titel}</h1>
        {fehler && <p className="fehler" role="alert">{fehler}</p>}
        <p className="unterzeile">Kommentiere direkt an der Folie — optional mit markiertem Bereich. Das Team sieht deine Kommentare und arbeitet sie in die nächste Fassung ein; hier siehst du deine eigenen mit ihrem Stand. Link gültig bis {tag(d.ablauf)}.</p>
        <FolienListe d={d} bild={bild} datei={(f, art) => `api/deck-teilen/datei/${encodeURIComponent(f)}/${art}`} admin={false} extern senden={senden} />
      </main>
    </div>
  );
}
