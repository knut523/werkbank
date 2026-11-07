// Werkbank 2.0: die Hülle — Kopf (Name, EINE Zahl, „?“, Chat), links vier Bereiche (Handy: Leiste unten), Chat als Seitenleiste
// auf jeder Seite. Nach dem Login landet man immer auf „Jetzt“, nie im leeren Chat (428 D2).
import { Component, lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { abmelden, hole, schicke } from './api.ts';
import { Kontext, useApp, type AppKontext } from './kontext.ts';
import { ChatLeiste } from './chat.tsx';
import { Anmelden, AlleChats, Themen, Thema, Arbeit, Begriffe, Dokument, Dokumente, Entscheidungen, Entschieden, Erledigt, Jetzt, Mehr, PrDetail, Prs, Suche, Freigabe, Verbrauch } from './seiten.tsx';
import { ALT_PFADE } from './mehr.ts';
import { UnterChat } from './unterchat.tsx';
import { TestUmgebungen } from './testlinks.tsx';
import { Deck, Decks } from './decks.tsx';
import { Fehler, Laedt, vergessen, vorab } from './teile.tsx';
import { istIntern, logisch, rel } from './format.ts';

// Pass B2 (D1): nach einem Release fehlt das alte Bundle — einmal neu laden (Merker gegen eine Schleife), sonst zeigt die Fehlergrenze es an.
const NEU_GELADEN = 'v2-neu-geladen';
const AltSeite = lazy(() => import('./alt.tsx').then((m) => { try { sessionStorage.removeItem(NEU_GELADEN); } catch { /* egal */ } return { default: m.AltSeite }; }, (e) => {
  let schon = false; try { schon = sessionStorage.getItem(NEU_GELADEN) === '1'; sessionStorage.setItem(NEU_GELADEN, '1'); } catch { /* egal */ }
  if (!schon) location.reload();
  throw e;
}));
/** Pass B2 (D1): ein Fehler in einer Seite (oder ein fehlendes Bundle) nimmt nicht Kopf, Navigation und Chat mit. */
class FehlerGrenze extends Component<{ children: ReactNode; schluessel: string }, { fehler: string | null; bei: string }> {
  state = { fehler: null as string | null, bei: '' };
  static getDerivedStateFromError(e: unknown) { return { fehler: String((e as any)?.message ?? e) }; }
  static getDerivedStateFromProps(p: { schluessel: string }, s: { bei: string }) { return p.schluessel !== s.bei ? { fehler: null, bei: p.schluessel } : null; }   // andere Seite: neuer Versuch
  render() {
    if (!this.state.fehler) return this.props.children;
    return <div className="seite"><h1>Diese Seite ließ sich nicht anzeigen</h1><p>Meist gibt es einen neuen Stand der Werkbank. Bitte neu laden.</p><p className="leise">{this.state.fehler}</p><button type="button" className="knopf haupt" onClick={() => location.reload()}>Neu laden</button></div>;
  }
}
function FreigabeAus() { const { alt } = useApp(); return <div className="seite"><h1>Freigabe</h1><p>Push-Freigaben laufen über die <a href={alt} target="_blank" rel="noreferrer">alte Werkbank</a>.</p></div>; }
function AltBereich({ start }: { start: string }) { const { alt } = useApp(); return <AltSeite key={start} start={start} altUrl={alt} />; }

// Radikal simpel (Knut 04.11.): vier Bereiche. Entscheidungen erreicht man über die Zahl oben und „Alles, was auf dich wartet“ auf
// „Jetzt“; Dokumente, Themen, alle Chats, Erledigt und Begriffe stehen unter „Mehr“ (und die Suche auf „Jetzt“ findet alles).
const BEREICHE = [
  { url: 'v2/', label: 'Jetzt', ico: '◉', passt: (p: string) => p === 'v2/' || p === 'v2' || p.startsWith('v2/entscheidungen') || p.startsWith('v2/suche') },
  { url: 'v2/arbeit', label: 'Arbeit', ico: '⚙', passt: (p: string) => p.startsWith('v2/arbeit') || p.startsWith('v2/chats') || p.startsWith('v2/erledigt') },
  { url: 'v2/prs', label: 'PRs', ico: '⇄', passt: (p: string) => p.startsWith('v2/prs') },
  // Pass A (UI 22): die eingehängten alten Seiten (Board, Übersicht, Wissen …) gehören zu „Mehr“
  { url: 'v2/mehr', label: 'Mehr', ico: '⋯', passt: (p: string) => p.startsWith('v2/mehr') || p.startsWith('v2/verbrauch') || p.startsWith('v2/decks') || p.startsWith('v2/dokument') || p.startsWith('v2/them') || p.startsWith('v2/begriffe') || p in ALT_PFADE },
];

/** Zu einer Sprungmarke scrollen, sobald der Abschnitt gerendert ist (Daten laden nach) — höchstens 3 s warten. */
let sprung: ReturnType<typeof setInterval> | undefined;   // Phase 4: nur eine Sprungmarke wartet — ein neuer Klick bricht die alte ab
function springZu(hash: string) {
  clearInterval(sprung);
  if (!hash || hash.length < 2) return;
  let n = 0;
  const t = sprung = setInterval(() => { const el = document.getElementById(decodeURIComponent(hash.slice(1))); if (el || ++n > 30) { clearInterval(t); el?.scrollIntoView({ block: 'start' }); } }, 100);
}

function useAdresse() {
  const [a, setA] = useState(() => ({ pfad: logisch(location.pathname), such: location.search }));
  useEffect(() => {
    const neu = () => setA({ pfad: logisch(location.pathname), such: location.search });
    // Interne Links ohne Neuladen (alle <a href="v2/…"> ohne target; relativ zu <base href>, S16).
    const klick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest('a');
      const href = a?.getAttribute('href');
      // Sprungmarken springen sofort (Runde 4, Christoph B3): während einer weichen Animation ging der nächste Tipp ins Leere.
      if (href?.startsWith('#') && a) { e.preventDefault(); history.replaceState(null, '', location.pathname + location.search + href); document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ block: 'start' }); return; }   // Phase 4: Adresse mitführen (Neuladen, Teilen)
      if (!a || !href || a.target || !istIntern(href)) return;
      e.preventDefault();
      const ziel = new URL(rel(href), document.baseURI);   // relativ zu <base href> (S16)
      if (ziel.pathname + ziel.search + ziel.hash !== location.pathname + location.search + location.hash) {
        try { sessionStorage.setItem('v2-vorher', location.pathname + location.search); } catch { /* egal */ }   // Runde 4 (Knut B5): „← zurück“ dorthin, woher man kam
        history.pushState(null, '', ziel.pathname + ziel.search + ziel.hash); window.scrollTo(0, 0);
      }
      springZu(ziel.hash);   // Runde 3 (B4): Sprungmarke auf der Zielseite, sobald sie geladen ist
      neu();
    };
    springZu(location.hash);   // auch beim direkten Aufruf mit #…
    window.addEventListener('popstate', neu);
    document.addEventListener('click', klick);
    return () => { window.removeEventListener('popstate', neu); document.removeEventListener('click', klick); };
  }, []);
  return a;
}

function Seite({ pfad, such, freigabe }: { pfad: string; such: string; freigabe: boolean }) {
  const q = new URLSearchParams(such);
  let m: RegExpMatchArray | null;
  // Zuerst (genaue Adressen, sonst griffe z. B. v2/entscheidungen-bisher in v2/entscheidungen). Parität (Knut 06.11.): diese Bereiche sind die Seiten der alten Werkbank selbst (alt.tsx; vorher schmale Lese-Fassungen,
  // Audit 05.11. (8)) — erst geladen, wenn man hingeht.
  const altSeite = ALT_PFADE[pfad];
  if (altSeite) return <Suspense fallback={<Laedt />}><AltBereich start={altSeite} /></Suspense>;
  if (pfad === 'v2' || pfad === 'v2/') return <Jetzt />;
  if (pfad.startsWith('v2/entscheidungen')) return <Entscheidungen />;
  if (pfad.startsWith('v2/entschieden')) return <Entschieden />;
  if (pfad.startsWith('v2/suche')) return <Suche key={such} q={q.get('q') ?? ''} />;
  if ((m = pfad.match(/^v2\/arbeit\/([0-9a-f]{8})$/))) return <UnterChat key={m[1]} id={m[1]} />;   // Chat-Bereich (Knut 06.11.)
  // Phase 4: die Freigabe-Seite nur mit WERKBANK_V2_FREIGABE (Server liefert v2Freigabe) — sonst bleibt es bei der alten Werkbank.
  if ((m = pfad.match(/^v2\/freigabe\/([0-9a-f]{8})$/))) return freigabe ? <Freigabe key={m[1]} id={m[1]} /> : <FreigabeAus />;
  if (pfad.startsWith('v2/arbeit')) return <Arbeit />;
  if ((m = pfad.match(/^v2\/prs\/([^/]+)\/(\d+)$/))) return <PrDetail key={pfad} repo={decodeURIComponent(m[1])} nummer={m[2]} />;
  if (pfad.startsWith('v2/prs')) return <Prs key={such} wer={q.get('wer')} />;
  if (pfad === 'v2/dokument') return <Dokument key={such} vault={q.get('vault')} paket={q.get('paket')} datei={q.get('datei')} />;
  if (pfad.startsWith('v2/dokumente')) return <Dokumente key={q.get('q') ?? ''} q={q.get('q') ?? ''} />;
  if (pfad.startsWith('v2/begriffe')) return <Begriffe />;
  if (pfad.startsWith('v2/verbrauch')) return <Verbrauch />;   // B4 (unter „Mehr“)
  if (pfad === 'v2/decks') return <Decks />;   // Deck-Review (docs/plan-deck-review.md)
  if ((m = pfad.match(/^v2\/decks\/([a-z0-9-]{1,81})$/))) return <Deck key={m[1]} slug={m[1]} />;
  if (pfad.startsWith('v2/mehr')) return <Mehr />;
  if (pfad.startsWith('v2/testlinks')) return <TestUmgebungen />;   // Test-Links (docs/plan-testlinks.md)
  if (pfad.startsWith('v2/chats')) return <AlleChats key={such} q={q.get('q') ?? ''} />;
  if (pfad === 'v2/themen') return <Themen />;
  if (pfad === 'v2/thema') return <Thema key={such} name={q.get('name') ?? ''} />;
  if (pfad.startsWith('v2/erledigt')) return <Erledigt key={such} tag={q.get('tag')} />;
  return <div className="seite"><h1>Seite nicht gefunden</h1><p><a href="v2/">Zur Startseite</a></p></div>;
}

export function App() {
  const { pfad, such } = useAdresse();
  const [konto, setKonto] = useState<{ name: string; admin: boolean } | null | undefined>(undefined);
  const [startFehler, setStartFehler] = useState<string | null>(null);
  const [alt, setAlt] = useState('');
  const [trocken, setTrocken] = useState(false);
  const [freigabe, setFreigabe] = useState(false);
  const [zahl, setZahl] = useState<number | null>(null);
  const [chat, setChat] = useState<{ offen: boolean; text: string; conv?: string }>({ offen: false, text: '' });
  // Runde 5 (Knut B2/B7): Meldungen, die die Seite überdauern (Antwort kam nicht an; Sammelantwort verschickt, Block ist weg).
  const [meldung, setMeldung] = useState<{ text: string; ok: boolean } | null>(null);
  useEffect(() => { setMeldung(null); }, [pfad]);   // Runde 6 (B8): die Meldung gehört zur Seite, auf der sie entstand
  // Runde 7 (Abgleich, D2): auch 2.0 zählt geöffnete Seiten — dieselbe Auswertung wie die alte Werkbank (Nutzungs-Audit).
  useEffect(() => { if (konto) schicke('api/nutzung/seite', { seite: `v2/${pfad.replace(/^v2\/?/, '')}`.replace(/\/$/, '') || 'v2' }).catch(() => {}); }, [pfad, konto]);
  useEffect(() => { const m = (e: Event) => { const d = (e as CustomEvent).detail; setMeldung(typeof d === 'string' ? { text: d, ok: false } : d); }; window.addEventListener('v2-meldung', m); return () => window.removeEventListener('v2-meldung', m); }, []);
  const [n, setN] = useState(0);

  const pruefen = () => hole<{ user: { name: string; role: string } | null; librechatUrl: string; dryRun?: boolean; vaultDryRun?: boolean; v2Freigabe?: boolean }>('api/config')
    .then((c) => { if (typeof c.librechatUrl === 'string') setAlt(`${c.librechatUrl}/wb`); setTrocken(!!(c.dryRun || c.vaultDryRun)); setFreigabe(!!c.v2Freigabe); setKonto(c.user ? { name: c.user.name.split(/\s+/)[0], admin: c.user.role === 'ADMIN' } : null); })
    // Pass B2 (D3): nur „nicht angemeldet“ führt zur Anmeldung — 502/403/Netz (z. B. während des Release-Neustarts) zeigen den Fehler
    .then(() => setStartFehler(null), (e: any) => { if (e?.status === 401) setKonto(null); else setStartFehler(String(e?.message ?? e)); });
  useEffect(() => { void pruefen(); const ab = () => { vergessen(); setKonto(null); }; window.addEventListener('v2-abgemeldet', ab); return () => window.removeEventListener('v2-abgemeldet', ab); }, []);
  // Die eine Zahl: beim Start, alle 60 s und nach jeder Antwort neu (null = neu holen).
  useEffect(() => {
    if (!konto) return;
    const holen = () => hole<{ zahl: number }>('api/v2/zahl').then((r) => setZahl(r.zahl)).catch(() => {});
    void holen();
    const t = setInterval(holen, 60_000);
    return () => clearInterval(t);
  }, [konto, n]);

  const kontext: AppKontext = useMemo(() => ({
    ich: konto ?? { name: '', admin: false }, alt,
    chat: (text = '') => setChat({ offen: true, text }),
    chatOeffnen: (conv: string) => setChat({ offen: true, text: '', conv }),
    testbetrieb: trocken,
    zahl: (x) => { if (x === null) setN((v) => v + 1); else setZahl(x); },
  }), [konto, alt, trocken]);   // Pass A (UI 19): testbetrieb hängt an trocken

  if (konto === undefined && startFehler) return <Fehler text={`Die Werkbank antwortet gerade nicht (${startFehler}) — vermutlich ein Neustart.`} nochmal={() => { setStartFehler(null); void pruefen(); }} />;
  if (konto === undefined) return <Laedt />;
  if (konto === null) return <Anmelden fertig={async () => { vergessen(); history.replaceState(null, '', 'v2/'); window.dispatchEvent(new PopStateEvent('popstate')); /* Runde 4: nach dem Login immer „Jetzt“ */ await vorab('api/v2/start?teil=oben'); await pruefen(); }} />;

  return (
    <Kontext.Provider value={kontext}>
      <div className={`huelle${chat.offen ? ' mit-chat' : ''}`}>
        <header className="kopf">
          <a className="marke-name" href="v2/">OLAF<span className="marke-lang"> Workspace</span></a>
          <div className="kopf-rechts">
            <a className="zahl" href="v2/entscheidungen" title="So viel wartet auf dich — antippen für die Liste">
              <b>{zahl ?? '…'}</b><span>warten auf dich</span>
            </a>
            <button type="button" className="knopf chat-knopf" onClick={() => setChat({ offen: !chat.offen, text: '' })} aria-expanded={chat.offen}>Chat</button>
          </div>
        </header>
        <nav className="leiste" aria-label="Bereiche">
          {BEREICHE.map((b) => <a key={b.url} href={b.url} className={b.passt(pfad) ? 'an' : ''} aria-current={b.passt(pfad) ? 'page' : undefined}><span className="ico" aria-hidden="true">{b.ico}</span><span>{b.label}</span></a>)}
          <div className="leiste-unten">
            <span className="klein gedimmt">Angemeldet als {konto.name}</span>
            {alt && <a className="klein" href={`${alt}/heute`} target="_blank" rel="noopener noreferrer">Alte Werkbank ↗</a>}
            <button type="button" className="knopf leise klein" onClick={() => void abmelden()}>Abmelden</button>
          </div>
        </nav>
        {trocken && <p className="testband" role="note">Testbetrieb: Antworten an Notizen und Jira werden hier nicht wirklich geschrieben.</p>}
        {meldung && <div className={`meldung-band${meldung.ok ? ' ok' : ''}`} role={meldung.ok ? 'status' : 'alert'}><span>{meldung.text}</span><button type="button" className="knopf leise klein" onClick={() => setMeldung(null)}>Schließen</button></div>}
        <main className={`inhalt${ALT_PFADE[pfad] ? ' breit' : ''}`}><FehlerGrenze schluessel={pfad}><Seite pfad={pfad} such={such} freigabe={freigabe} /></FehlerGrenze></main>
        <ChatLeiste offen={chat.offen} vorbereitet={chat.text} convWahl={chat.conv} schliessen={() => setChat({ offen: false, text: '' })} />
      </div>
    </Kontext.Provider>
  );
}
