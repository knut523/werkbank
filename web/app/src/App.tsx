// Werkbank 2.0: die Hülle — Kopf (Name, EINE Zahl, „?“, Chat), links fünf Bereiche (Handy: Leiste unten), Chat als Seitenleiste
// auf jeder Seite. Nach dem Login landet man immer auf „Jetzt“, nie im leeren Chat (428 D2).
import { useEffect, useMemo, useState } from 'react';
import { hole, schicke } from './api.ts';
import { Kontext, type AppKontext } from './kontext.ts';
import { ChatLeiste } from './chat.tsx';
import { Anmelden, AlleChats, Themen, Thema, Arbeit, ArbeitDetail, Begriffe, Dokument, Dokumente, Entscheidungen, Entschieden, Erledigt, Jetzt, Mehr, PrDetail, Prs, Suche } from './seiten.tsx';
import { Laedt, vergessen, vorab } from './teile.tsx';
import { istIntern, logisch, rel } from './format.ts';

// Radikal simpel (Knut 04.11.): vier Bereiche. Entscheidungen erreicht man über die Zahl oben und „Alles, was auf dich wartet“ auf
// „Jetzt“; Dokumente, Themen, alle Chats, Erledigt und Begriffe stehen unter „Mehr“ (und die Suche auf „Jetzt“ findet alles).
const BEREICHE = [
  { url: 'v2/', label: 'Jetzt', ico: '◉', passt: (p: string) => p === 'v2/' || p === 'v2' || p.startsWith('v2/entscheidungen') || p.startsWith('v2/suche') },
  { url: 'v2/arbeit', label: 'Arbeit', ico: '⚙', passt: (p: string) => p.startsWith('v2/arbeit') || p.startsWith('v2/chats') || p.startsWith('v2/erledigt') },
  { url: 'v2/prs', label: 'PRs', ico: '⇄', passt: (p: string) => p.startsWith('v2/prs') },
  { url: 'v2/mehr', label: 'Mehr', ico: '⋯', passt: (p: string) => p.startsWith('v2/mehr') || p.startsWith('v2/dokument') || p.startsWith('v2/them') || p.startsWith('v2/begriffe') },
];

/** Zu einer Sprungmarke scrollen, sobald der Abschnitt gerendert ist (Daten laden nach) — höchstens 3 s warten. */
function springZu(hash: string) {
  if (!hash || hash.length < 2) return;
  let n = 0;
  const t = setInterval(() => { const el = document.getElementById(decodeURIComponent(hash.slice(1))); if (el || ++n > 30) { clearInterval(t); el?.scrollIntoView({ block: 'start' }); } }, 100);
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
      if (href?.startsWith('#') && a) { e.preventDefault(); document.getElementById(href.slice(1))?.scrollIntoView({ block: 'start' }); return; }
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

function Seite({ pfad, such }: { pfad: string; such: string }) {
  const q = new URLSearchParams(such);
  let m: RegExpMatchArray | null;
  if (pfad === 'v2' || pfad === 'v2/') return <Jetzt />;
  if (pfad.startsWith('v2/entscheidungen')) return <Entscheidungen />;
  if (pfad.startsWith('v2/entschieden')) return <Entschieden />;
  if (pfad.startsWith('v2/suche')) return <Suche key={such} q={q.get('q') ?? ''} />;
  if ((m = pfad.match(/^v2\/arbeit\/([0-9a-f]{8})$/))) return <ArbeitDetail key={m[1]} id={m[1]} />;
  if (pfad.startsWith('v2/arbeit')) return <Arbeit />;
  if ((m = pfad.match(/^v2\/prs\/([^/]+)\/(\d+)$/))) return <PrDetail key={pfad} repo={decodeURIComponent(m[1])} nummer={m[2]} />;
  if (pfad.startsWith('v2/prs')) return <Prs key={such} wer={q.get('wer')} />;
  if (pfad === 'v2/dokument') return <Dokument key={such} vault={q.get('vault')} paket={q.get('paket')} datei={q.get('datei')} />;
  if (pfad.startsWith('v2/dokumente')) return <Dokumente key={q.get('q') ?? ''} q={q.get('q') ?? ''} />;
  if (pfad.startsWith('v2/begriffe')) return <Begriffe />;
  if (pfad.startsWith('v2/mehr')) return <Mehr />;
  if (pfad.startsWith('v2/chats')) return <AlleChats key={such} q={q.get('q') ?? ''} />;
  if (pfad === 'v2/themen') return <Themen />;
  if (pfad === 'v2/thema') return <Thema key={such} name={q.get('name') ?? ''} />;
  if (pfad.startsWith('v2/erledigt')) return <Erledigt key={such} tag={q.get('tag')} />;
  return <div className="seite"><h1>Seite nicht gefunden</h1><p><a href="v2/">Zur Startseite</a></p></div>;
}

export function App() {
  const { pfad, such } = useAdresse();
  const [konto, setKonto] = useState<{ name: string; admin: boolean } | null | undefined>(undefined);
  const [alt, setAlt] = useState('');
  const [trocken, setTrocken] = useState(false);
  const [zahl, setZahl] = useState<number | null>(null);
  const [chat, setChat] = useState<{ offen: boolean; text: string; conv?: string }>({ offen: false, text: '' });
  // Runde 5 (Knut B2/B7): Meldungen, die die Seite überdauern (Antwort kam nicht an; Sammelantwort verschickt, Block ist weg).
  const [meldung, setMeldung] = useState<{ text: string; ok: boolean } | null>(null);
  useEffect(() => { setMeldung(null); }, [pfad]);   // Runde 6 (B8): die Meldung gehört zur Seite, auf der sie entstand
  // Runde 7 (Abgleich, D2): auch 2.0 zählt geöffnete Seiten — dieselbe Auswertung wie die alte Werkbank (Nutzungs-Audit).
  useEffect(() => { if (konto) schicke('api/nutzung/seite', { seite: `v2/${pfad.replace(/^v2\/?/, '')}`.replace(/\/$/, '') || 'v2' }).catch(() => {}); }, [pfad, konto]);
  useEffect(() => { const m = (e: Event) => { const d = (e as CustomEvent).detail; setMeldung(typeof d === 'string' ? { text: d, ok: false } : d); }; window.addEventListener('v2-meldung', m); return () => window.removeEventListener('v2-meldung', m); }, []);
  // Runde 5 (Knut B9): der schwebende Chat-Knopf geht beim Lesen nach unten aus dem Weg und kommt beim Hochwischen wieder.
  const [fabWeg, setFabWeg] = useState(false);
  useEffect(() => { let y = scrollY; const s = () => { const n = scrollY; if (Math.abs(n - y) > 8) { setFabWeg(n > y && n > 120); y = n; } }; addEventListener('scroll', s, { passive: true }); return () => removeEventListener('scroll', s); }, []);
  const [n, setN] = useState(0);

  const pruefen = () => hole<{ user: { name: string; role: string } | null; librechatUrl: string; dryRun?: boolean; vaultDryRun?: boolean }>('api/config')
    .then((c) => { if (typeof c.librechatUrl === 'string') setAlt(`${c.librechatUrl}/wb`); setTrocken(!!(c.dryRun || c.vaultDryRun)); setKonto(c.user ? { name: c.user.name.split(/\s+/)[0], admin: c.user.role === 'ADMIN' } : null); })
    .catch(() => setKonto(null));
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
  }), [konto, alt]);

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
            <button type="button" className="knopf leise klein" onClick={() => fetch('api/logout', { method: 'POST', headers: { 'x-werkbank': '1' } }).finally(() => { vergessen(); setKonto(null); })}>Abmelden</button>
          </div>
        </nav>
        {trocken && <p className="testband" role="note">Testbetrieb: Antworten an Notizen und Jira werden hier nicht wirklich geschrieben.</p>}
        {meldung && <div className={`meldung-band${meldung.ok ? ' ok' : ''}`} role={meldung.ok ? 'status' : 'alert'}><span>{meldung.text}</span><button type="button" className="knopf leise klein" onClick={() => setMeldung(null)}>Schließen</button></div>}
        <main className="inhalt"><Seite pfad={pfad} such={such} /></main>
        <button type="button" className={`chat-fab${fabWeg ? ' weg' : ''}`} onClick={() => setChat({ offen: true, text: '' })} aria-label="Chat öffnen" hidden={chat.offen}>Chat</button>
        <ChatLeiste offen={chat.offen} vorbereitet={chat.text} convWahl={chat.conv} schliessen={() => setChat({ offen: false, text: '' })} />
      </div>
    </Kontext.Provider>
  );
}
