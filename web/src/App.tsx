import { useEffect, useState } from 'react';
import { api, embedded, openInParent, setChatOrigin, type Config } from './api.ts';
import { Loading, Err } from './ui.tsx';
import { Setup } from './pages/Setup.tsx';
import { Wissen } from './pages/Wissen.tsx';
import { Board } from './pages/Board.tsx';
import { Sprint } from './pages/Sprint.tsx';
import { Roadmap } from './pages/Roadmap.tsx';
import { Skills } from './pages/Skills.tsx';
import { Dateien } from './pages/Dateien.tsx';
import { Timebox } from './pages/Timebox.tsx';
import { Ziele } from './pages/Ziele.tsx';
import { Heute } from './pages/Heute.tsx';
import { Leitstand } from './pages/Leitstand.tsx';
import { useTodayCount } from './beimir.tsx';

function useHash() {
  const [h, setH] = useState(() => window.location.hash || '#/');
  useEffect(() => {
    const f = () => {
      const hash = window.location.hash || '#/';
      setH(hash);
      // Eingebettet: LibreChat hält die Adresszeile aktuell (/wb/<seite>?h=…).
      if (embedded) try { window.parent.postMessage({ type: 'werkbank-route', hash }, window.location.origin); } catch { /* egal */ }
    };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return h;
}

// Variablen, die LibreChat und die Werkbank gleich benennen und gleich meinen (LibreChat client/src/style.css).
// Nur-Werkbank-Variablen (--chip-*, --link, --shadow) und die Flächen-Ausnahmen unter .embedded bleiben in styles.css.
const SHARED_TOKENS = ['--presentation', '--text-primary', '--text-secondary', '--text-tertiary', '--surface-primary', '--surface-primary-alt',
  '--surface-secondary', '--surface-tertiary', '--surface-hover', '--surface-submit', '--surface-submit-hover', '--surface-destructive',
  '--surface-dialog', '--border-light', '--border-medium', '--border-heavy'];

// Werkzeug statt Seite (Council-Bedingung 11): oben fünf Einträge, der Rest im Fuß. LibreChat-Leiste: dieselben fünf.
const NAV = [
  { href: '#/', label: 'Heute', ico: '☀️', match: /^#\/?$/, f: 'heute' },
  { href: '#/roadmap', label: 'Roadmap', ico: '🧭', match: /^#\/roadmap/ , f: 'roadmap' },
  { href: '#/board', label: 'Board', ico: '🗂️', match: /^#\/board/ , f: 'board' },
  { href: '#/sprint', label: 'Sprint', ico: '🔁', match: /^#\/sprint/ , f: 'sprint' },
  { href: '#/wissen', label: 'Wissen', ico: '📚', match: /^#\/wissen/ , f: 'wissen' },
  { href: '#/leitstand', label: 'Leitstand', ico: '🛰️', match: /^#\/leitstand/ , f: 'leitstand' },
];
const MORE = [
  { href: '#/timebox', label: 'Mein Tag', ico: '⏱️', match: /^#\/timebox/ , f: 'timebox' },
  { href: '#/ziele', label: 'Ziele', ico: '🎯', match: /^#\/ziele/ , f: 'ziele' },
  { href: '#/skills', label: 'Skills', ico: '🧰', match: /^#\/skills/ , f: 'skills' },
  { href: '#/dateien', label: 'Dateien & Teilen', ico: '📎', match: /^#\/dateien/ , f: 'dateien' },
  { href: '#/einrichtung', label: 'Einrichtung', ico: '🚀', match: /^#\/einrichtung/, f: '' },
];

function NavLink({ n, hash, count }: { n: typeof NAV[number]; hash: string; count?: number | null }) {
  const on = n.match.test(hash);
  return (
    <a href={n.href} className={on ? 'active' : ''} aria-current={on ? 'page' : undefined} aria-label={count ? `${n.label}, ${count} offen` : undefined}>
      <span className="ico">{n.ico}</span>{n.label}{count ? <span className="nav-count" aria-hidden>{count}</span> : null}
    </a>
  );
}

export function App() {
  const hash = useHash();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'light');
  // Handy (≤ 760 px): Navigation und Fuß stecken im Menü oben (Knut, 07.10.2026: Abmelden/Hell-Dunkel fehlten am Handy).
  const [menu, setMenu] = useState(false);
  const todayN = useTodayCount(hash, !!cfg?.user && cfg?.features?.heute !== false);
  useEffect(() => setMenu(false), [hash]);
  const load = () => api<Config>('/api/config').then((c) => { setChatOrigin(c.librechatUrl); setCfg(c); }, setErr);
  useEffect(() => { load(); }, []);
  const toggleTheme = () => {
    const t = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('werkbank-theme', t); } catch { /* privat */ }
    setTheme(t);
  };

  // Eingebettet folgt Hell/Dunkel dem Chat (LibreChat setzt die Klasse "dark" auf <html>), und die gemeinsamen Farben
  // kommen aus LibreChats Variablen — eine Quelle; styles.css ist nur noch Rückfall für die direkte Web-App (:3070).
  useEffect(() => {
    if (!embedded) return;
    let root: HTMLElement | null = null;
    try { root = window.parent.document.documentElement; } catch { return; }
    const apply = () => {
      const t = root!.classList.contains('dark') ? 'dark' : 'light';
      document.documentElement.dataset.theme = t;
      const cs = window.parent.getComputedStyle(root!);
      for (const name of SHARED_TOKENS) {
        const v = cs.getPropertyValue(name).trim();
        if (v) document.documentElement.style.setProperty(name, v); else document.documentElement.style.removeProperty(name);
      }
      setTheme(t);
    };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  // Eingebettet: Links zum Chat (target=_top, 14 Stellen) ohne Neuladen über LibreChats Router; Strg/Cmd/Umschalt/Mitte
  // bleiben beim Browser (neuer Tab), fremde Adressen auch.
  useEffect(() => {
    if (!embedded) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.('a[target="_top"]') as HTMLAnchorElement | null;
      if (a?.href && openInParent(a.href)) e.preventDefault();
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  if (err) return <div className="page"><Err e={err} /></div>;
  if (!cfg) return <div className="page"><Loading /></div>;
  const user = cfg.user;
  if (embedded && !user) {
    return <div className="page"><h1>Werkbank</h1><p className="muted">Dein Chat-Konto ist für die Werkbank noch nicht freigeschaltet (Pilot) — oder die Anmeldung ist abgelaufen. Seite neu laden; hilft das nicht, frag Knut.</p></div>;
  }
  // Freigabe je Funktion (web/server/features.ts): Admins alles, das Team nur, was Knut freigegeben hat.
  const vis = (n: { f: string }) => !n.f || cfg.features?.[n.f] !== false;
  const nav = NAV.filter(vis), more = MORE.filter(vis);
  const hidden = user && [...NAV, ...MORE].find((n) => n.f && n.match.test(hash) && !vis(n));
  const heuteHidden = user && cfg.features?.heute === false && /^#\/?$/.test(hash);
  // Anmelden über das Einrichtungs-Formular: weiter mit den ersten Schritten (Claude, Jira) auf der Einrichtung.
  const page = !user ? <Setup cfg={cfg} onLogin={() => { window.location.hash = '#/einrichtung'; load(); }} />
    : /^#\/einrichtung/.test(hash) || heuteHidden ? <Setup cfg={cfg} onLogin={load} />
    : hidden ? <div className="page" data-testid="not-released"><h1>{hidden.label}</h1><div className="card soft empty"><p><b>Noch nicht für das Team freigegeben.</b></p><p className="small muted">Knut gibt die Werkbank-Funktionen nach und nach frei. Bis dahin: Chat und <a href="#/einrichtung">Einrichtung</a>.</p></div></div>
    : /^#\/wissen/.test(hash) ? <Wissen cfg={cfg} hash={hash} />
    : /^#\/board/.test(hash) ? <Board cfg={cfg} hash={hash} />
    : /^#\/sprint/.test(hash) ? <Sprint cfg={cfg} hash={hash} />
    : /^#\/timebox/.test(hash) ? <Timebox cfg={cfg} />
    : /^#\/ziele/.test(hash) ? <Ziele cfg={cfg} hash={hash} />
    : /^#\/roadmap/.test(hash) ? <Roadmap cfg={cfg} hash={hash} />
    : /^#\/skills/.test(hash) ? <Skills cfg={cfg} />
    : /^#\/dateien/.test(hash) ? <Dateien cfg={cfg} />
    : /^#\/leitstand/.test(hash) ? <Leitstand cfg={cfg} hash={hash} />
    : <Heute cfg={cfg} />;

  // Eingebettet: kein eigenes Gerüst — Navigation ist LibreChats Leiste (fünf Einträge + „Mehr“), Einrichtung im Kontomenü.
  if (embedded) return <div className="embedded">{page}</div>;
  const current = [...nav, ...more].find((n) => n.match.test(hash));

  return (
    <div className="shell">
      <aside className={`side${menu ? ' open' : ''}`} aria-label="Navigation">
        <div className="brand"><img src="favicon.svg" alt="" /><span>OLAF-Werkbank</span></div>
        <a href={cfg.librechatUrl} className="menu-chat btn small" title="Zurück zum Chat (LibreChat)">💬 Chat</a>
        <button className="menu-btn btn small" aria-expanded={menu} aria-controls="werkbank-nav" onClick={() => setMenu(!menu)}>
          {current ? <>{current.ico} {current.label}</> : 'Menü'}
          {/* Auf „Heute“ steht der Zähler am Namen („Heute 10“), sonst als Hinweis daneben („· Heute 10“) — nie beides. */}
          {current?.href === '#/' && todayN ? <span className="nav-count" aria-label={`${todayN} offen`}>{todayN}</span>
            : !menu && <span className="menu-more">· {todayN ? `Heute ${todayN}` : `${nav.length + more.length - (current ? 1 : 0)} weitere`}</span>}<span aria-hidden>{menu ? '▴' : '▾'}</span>
        </button>
        <nav className="nav col" id="werkbank-nav" style={{ gap: 2 }}>
          <a href={cfg.librechatUrl} className="" title="Zurück zum Chat (LibreChat)"><span className="ico">💬</span>Chat</a>
          {nav.map((n) => <NavLink key={n.href} n={n} hash={hash} count={n.href === '#/' ? todayN : null} />)}
        </nav>
        <div className="spacer" />
        <nav className="nav col more" aria-label="Weitere Seiten" style={{ gap: 0 }}>
          {more.map((n) => <NavLink key={n.href} n={n} hash={hash} />)}
        </nav>
        <div className="foot">
          {cfg.demo && <span className="chip warn">Demo-Modus</span>}
          {user && <div className="small"><b>{user.name}</b><div className="tiny">{user.email}</div></div>}
          <div className="row">
            <button className="btn small" onClick={toggleTheme} aria-label="Hell/Dunkel umschalten">{theme === 'dark' ? '☀️ Hell' : '🌙 Dunkel'}</button>
            {user && <button className="btn small" onClick={async () => { await api('/api/logout', { method: 'POST' }); window.location.hash = '#/'; load(); }}>Abmelden</button>}
          </div>
        </div>
      </aside>
      <main className="main">{page}</main>
    </div>
  );
}
