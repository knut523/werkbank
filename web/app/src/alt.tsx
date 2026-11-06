// Parität (Knut 06.11.: „kein Bereich der 2.0 schlechter als der alte — lieber die alte Komponente 1:1 übernehmen“): die
// Bereiche Jira-Board (mit PM/DEV-Seitenwahl), Sprint, Ziele, Roadmap, Lage, Mein Tag, Skills, Einrichtung und Meine Dateien
// sind hier die Seiten der alten Werkbank selbst; Übersicht, Entscheidungen, Erledigt, Vault und Ablage stehen „wie bisher“ neben
// den 2.0-Seiten — eingehängt in die 2.0-Hülle. Ihr Stylesheet gilt nur innerhalb von
// .alt-seite (scopeCss), die alte Hash-Adresse (#/board?site=DEV …) steht hinter der 2.0-Adresse (v2/board#/board?site=DEV).
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react';
import altCss from '../../src/styles.css?inline';
import { api, setChatOrigin, type Config } from '../../src/api.ts';
import { Providers } from '../../src/ui.tsx';
import { Board } from '../../src/pages/Board.tsx';
import { Sprint } from '../../src/pages/Sprint.tsx';
import { Ziele } from '../../src/pages/Ziele.tsx';
import { Roadmap } from '../../src/pages/Roadmap.tsx';
import { Lage } from '../../src/pages/Lage.tsx';
import { Timebox } from '../../src/pages/Timebox.tsx';
import { Skills } from '../../src/pages/Skills.tsx';
import { Setup } from '../../src/pages/Setup.tsx';
import { Dateien } from '../../src/pages/Dateien.tsx';
import { scopeCss } from './altcss.ts';
import { ALT_SEITEN, ALT_GLEICH } from './mehr.ts';
import { Uebersicht } from '../../src/pages/Uebersicht.tsx';
import { Entscheidungen } from '../../src/pages/Entscheidungen.tsx';
import { HeuteErledigt } from '../../src/pages/HeuteErledigt.tsx';
import { Wissen } from '../../src/pages/Wissen.tsx';
import { Ablage } from '../../src/pages/Ablage.tsx';

const gleich = (hash: string) => { const k = Object.keys(ALT_GLEICH).find((g) => hash === g || hash.startsWith(g + '?') || hash.startsWith(g + '/')); return k ? ALT_GLEICH[k] + hash.slice(k.length) : hash; };
const seiteVon = (roh: string) => { const hash = gleich(roh); return ALT_SEITEN.find((s) => hash === s.hash || hash.startsWith(s.hash + '?') || (s.hash !== '#/' && hash.startsWith(s.hash + '/'))); };

let stil: HTMLStyleElement | null = null;
function stilEinhaengen() {
  if (stil) return;
  stil = document.createElement('style');
  stil.dataset.alt = 'werkbank';
  stil.textContent = scopeCss(altCss, '.alt-seite');
  document.head.appendChild(stil);
}

export function AltSeite({ start, altUrl }: { start: string; altUrl: string }) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [hash, setHash] = useState(() => (seiteVon(location.hash)?.hash === start ? location.hash : start));
  useEffect(() => { stilEinhaengen(); api<Config>('/api/config').then((c) => { setChatOrigin(c.librechatUrl); setCfg(c); }, (e) => setFehler(String(e?.message ?? e))); }, []);
  useEffect(() => {
    const f = () => setHash(seiteVon(location.hash)?.hash === start ? location.hash : start);
    window.addEventListener('hashchange', f);
    window.addEventListener('popstate', f);
    return () => { window.removeEventListener('hashchange', f); window.removeEventListener('popstate', f); };
  }, [start]);

  // Links der alten Seiten (#/sprint, #/board?key=…): dieselbe Seite → nur der Hash; eine andere eingehängte Seite → deren
  // 2.0-Adresse; alles andere öffnet die alte Werkbank in einem neuen Tab. Läuft vor dem Klick-Router der 2.0 (React-Wurzel).
  const klick = (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (!href?.startsWith('#/') || a?.target) return;
    e.preventDefault();
    const z = seiteVon(href);
    if (z?.hash === start) { location.hash = href; return; }
    if (z) { history.pushState(null, '', new URL(z.pfad + href, document.baseURI).pathname + href); window.dispatchEvent(new PopStateEvent('popstate')); window.scrollTo(0, 0); return; }
    if (altUrl) window.open(`${altUrl}/${encodeURIComponent(href.slice(2).split(/[?/]/)[0] || 'heute')}?h=${encodeURIComponent(href)}`, '_blank', 'noopener');
  };

  if (fehler) return <div className="seite"><p className="fehlertext">{fehler}</p></div>;
  if (!cfg) return <div className="seite"><p className="laedt">Lädt …</p></div>;
  const s = seiteVon(hash);
  const frei = (!s?.f || cfg.features?.[s.f] !== false) && (start !== '#/lage' || !!cfg.lage);   // Lage nur, wo die alte Werkbank sie zeigt (cfg.lage)
  const seite: ReactNode = !cfg.user ? <p>Bitte neu anmelden.</p>
    : !frei ? <div className="page"><p><b>Noch nicht für das Team freigegeben.</b></p></div>
    : start === '#/board' ? <Board cfg={cfg} hash={hash} />
    : start === '#/sprint' ? <Sprint cfg={cfg} hash={hash} />
    : start === '#/ziele' ? <Ziele cfg={cfg} hash={hash} />
    : start === '#/roadmap' ? <Roadmap cfg={cfg} hash={hash} />
    : start === '#/lage' ? <Lage />
    : start === '#/timebox' ? <Timebox cfg={cfg} />
    : start === '#/skills' ? <Skills cfg={cfg} />
    : start === '#/einrichtung' ? <Setup cfg={cfg} onLogin={() => location.reload()} />
    : start === '#/dateien' ? <Dateien cfg={cfg} />
    : start === '#/' ? <Uebersicht cfg={cfg} hash={gleich(hash)} />
    : start === '#/entscheidungen' ? <Entscheidungen />
    : start === '#/erledigt' ? (cfg.user.role === 'ADMIN' ? <HeuteErledigt /> : <div className="page"><p>Nur für Admins.</p></div>)
    : start === '#/wissen' ? <Wissen cfg={cfg} hash={hash} />
    : start === '#/ablage' ? <Ablage cfg={cfg} />
    : null;
  return <div className="alt-seite" onClick={klick}><Providers>{seite}</Providers></div>;
}
