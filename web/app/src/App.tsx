// Werkbank 2.0: die Hülle — Kopf (Name, EINE Zahl, „?“, Chat), links fünf Bereiche (Handy: Leiste unten), Chat als Seitenleiste
// auf jeder Seite. Nach dem Login landet man immer auf „Jetzt“, nie im leeren Chat (428 D2).
import { useEffect, useMemo, useState } from 'react';
import { hole } from './api.ts';
import { Kontext, type AppKontext } from './kontext.ts';
import { ChatLeiste } from './chat.tsx';
import { Anmelden, Arbeit, ArbeitDetail, Begriffe, Dokument, Dokumente, Entscheidungen, Jetzt, PrDetail, Prs } from './seiten.tsx';
import { Laedt, vergessen, vorab } from './teile.tsx';
import { istIntern, logisch, rel } from './format.ts';

const BEREICHE = [
  { url: 'v2/', label: 'Jetzt', ico: '◉', passt: (p: string) => p === 'v2/' || p === 'v2' },
  { url: 'v2/entscheidungen', label: 'Entscheidungen', ico: '✓', passt: (p: string) => p.startsWith('v2/entscheidungen') },
  { url: 'v2/arbeit', label: 'Arbeit', ico: '⚙', passt: (p: string) => p.startsWith('v2/arbeit') },
  { url: 'v2/prs', label: 'PRs', ico: '⇄', passt: (p: string) => p.startsWith('v2/prs') },
  { url: 'v2/dokumente', label: 'Dokumente', ico: '▤', passt: (p: string) => p.startsWith('v2/dokument') },
];

function useAdresse() {
  const [a, setA] = useState(() => ({ pfad: logisch(location.pathname), such: location.search }));
  useEffect(() => {
    const neu = () => setA({ pfad: logisch(location.pathname), such: location.search });
    // Interne Links ohne Neuladen (alle <a href="v2/…"> ohne target; relativ zu <base href>, S16).
    const klick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement).closest('a');
      const href = a?.getAttribute('href');
      if (href?.startsWith('#') && a) { e.preventDefault(); document.getElementById(href.slice(1))?.scrollIntoView({ behavior: 'smooth' }); return; }   // Sprungmarken
      if (!a || !href || a.target || !istIntern(href)) return;
      e.preventDefault();
      const ziel = new URL(rel(href), document.baseURI);   // relativ zu <base href> (S16)
      if (ziel.pathname + ziel.search !== location.pathname + location.search) { history.pushState(null, '', ziel.pathname + ziel.search); window.scrollTo(0, 0); }
      neu();
    };
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
  if ((m = pfad.match(/^v2\/arbeit\/([0-9a-f]{8})$/))) return <ArbeitDetail key={m[1]} id={m[1]} />;
  if (pfad.startsWith('v2/arbeit')) return <Arbeit />;
  if ((m = pfad.match(/^v2\/prs\/([^/]+)\/(\d+)$/))) return <PrDetail key={pfad} repo={decodeURIComponent(m[1])} nummer={m[2]} />;
  if (pfad.startsWith('v2/prs')) return <Prs key={such} wer={q.get('wer')} />;
  if (pfad === 'v2/dokument') return <Dokument key={such} vault={q.get('vault')} paket={q.get('paket')} datei={q.get('datei')} />;
  if (pfad.startsWith('v2/dokumente')) return <Dokumente key={q.get('q') ?? ''} q={q.get('q') ?? ''} />;
  if (pfad.startsWith('v2/begriffe')) return <Begriffe />;
  return <div className="seite"><h1>Seite nicht gefunden</h1><p><a href="v2/">Zur Startseite</a></p></div>;
}

export function App() {
  const { pfad, such } = useAdresse();
  const [konto, setKonto] = useState<{ name: string; admin: boolean } | null | undefined>(undefined);
  const [alt, setAlt] = useState('');
  const [trocken, setTrocken] = useState(false);
  const [zahl, setZahl] = useState<number | null>(null);
  const [chat, setChat] = useState<{ offen: boolean; text: string }>({ offen: false, text: '' });
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
    zahl: (x) => { if (x === null) setN((v) => v + 1); else setZahl(x); },
  }), [konto, alt]);

  if (konto === undefined) return <Laedt />;
  if (konto === null) return <Anmelden fertig={async () => { vergessen(); history.replaceState(null, '', 'v2/'); await vorab('api/v2/start?teil=oben'); await pruefen(); }} />;

  return (
    <Kontext.Provider value={kontext}>
      <div className={`huelle${chat.offen ? ' mit-chat' : ''}`}>
        <header className="kopf">
          <a className="marke-name" href="v2/">OLAF<span className="marke-lang"> Workspace</span></a>
          <div className="kopf-rechts">
            <a className="zahl" href="v2/entscheidungen" title="So viel wartet auf dich — antippen für die Liste">
              <b>{zahl ?? '…'}</b><span>warten auf dich</span>
            </a>
            <a className="knopf leise rund" href="v2/begriffe" aria-label="Begriffe in Klartext" title="Begriffe in Klartext">?</a>
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
        <main className="inhalt"><Seite pfad={pfad} such={such} /></main>
        <button type="button" className="chat-fab" onClick={() => setChat({ offen: true, text: '' })} aria-label="Chat öffnen" hidden={chat.offen}>Chat</button>
        <ChatLeiste offen={chat.offen} vorbereitet={chat.text} schliessen={() => setChat({ offen: false, text: '' })} />
      </div>
    </Kontext.Provider>
  );
}
