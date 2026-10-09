import { useEffect, useState } from 'react';
import { api, embedded, type Config } from './api.ts';
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

// Werkzeug statt Seite (Council-Bedingung 11): oben fünf Einträge, der Rest im Fuß. LibreChat-Leiste: dieselben fünf.
const NAV = [
  { href: '#/', label: 'Heute', ico: '☀️', match: /^#\/?$/ },
  { href: '#/roadmap', label: 'Roadmap', ico: '🧭', match: /^#\/roadmap/ },
  { href: '#/board', label: 'Board', ico: '🗂️', match: /^#\/board/ },
  { href: '#/sprint', label: 'Sprint', ico: '🔁', match: /^#\/sprint/ },
  { href: '#/wissen', label: 'Wissen', ico: '📚', match: /^#\/wissen/ },
];
const MORE = [
  { href: '#/timebox', label: 'Mein Tag', ico: '⏱️', match: /^#\/timebox/ },
  { href: '#/ziele', label: 'Ziele', ico: '🎯', match: /^#\/ziele/ },
  { href: '#/skills', label: 'Skills', ico: '🧰', match: /^#\/skills/ },
  { href: '#/dateien', label: 'Dateien & Teilen', ico: '📎', match: /^#\/dateien/ },
  { href: '#/einrichtung', label: 'Einrichtung', ico: '🚀', match: /^#\/einrichtung/ },
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
  const todayN = useTodayCount(hash, !!cfg?.user);
  useEffect(() => setMenu(false), [hash]);
  const load = () => api<Config>('/api/config').then(setCfg, setErr);
  useEffect(() => { load(); }, []);
  const toggleTheme = () => {
    const t = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('werkbank-theme', t); } catch { /* privat */ }
    setTheme(t);
  };

  // Eingebettet folgt Hell/Dunkel dem Chat (LibreChat setzt die Klasse "dark" auf <html>).
  useEffect(() => {
    if (!embedded) return;
    let root: HTMLElement | null = null;
    try { root = window.parent.document.documentElement; } catch { return; }
    const apply = () => { const t = root!.classList.contains('dark') ? 'dark' : 'light'; document.documentElement.dataset.theme = t; setTheme(t); };
    apply();
    const mo = new MutationObserver(apply);
    mo.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  if (err) return <div className="page"><Err e={err} /></div>;
  if (!cfg) return <div className="page"><Loading /></div>;
  const user = cfg.user;
  if (embedded && !user) {
    return <div className="page"><h1>Werkbank</h1><p className="muted">Dein Chat-Konto ist für die Werkbank noch nicht freigeschaltet (Pilot) — oder die Anmeldung ist abgelaufen. Seite neu laden; hilft das nicht, frag Knut.</p></div>;
  }
  // Anmelden über das Einrichtungs-Formular: weiter mit den ersten Schritten (Claude, Jira) auf der Einrichtung.
  const page = !user ? <Setup cfg={cfg} onLogin={() => { window.location.hash = '#/einrichtung'; load(); }} />
    : /^#\/einrichtung/.test(hash) ? <Setup cfg={cfg} onLogin={load} />
    : /^#\/wissen/.test(hash) ? <Wissen cfg={cfg} hash={hash} />
    : /^#\/board/.test(hash) ? <Board cfg={cfg} hash={hash} />
    : /^#\/sprint/.test(hash) ? <Sprint cfg={cfg} hash={hash} />
    : /^#\/timebox/.test(hash) ? <Timebox cfg={cfg} />
    : /^#\/ziele/.test(hash) ? <Ziele cfg={cfg} hash={hash} />
    : /^#\/roadmap/.test(hash) ? <Roadmap cfg={cfg} hash={hash} />
    : /^#\/skills/.test(hash) ? <Skills cfg={cfg} />
    : /^#\/dateien/.test(hash) ? <Dateien cfg={cfg} />
    : <Heute cfg={cfg} />;

  // Eingebettet (LibreChat-Leiste: fünf Einträge) fehlt der Fuß — die übrigen Seiten als kleine Zeile darunter.
  if (embedded) return (
    <div className="embedded">{page}
      {user && <nav className="more-row small" aria-label="Weitere Seiten">{MORE.map((n) => <a key={n.href} href={n.href} aria-current={n.match.test(hash) ? 'page' : undefined}>{n.ico} {n.label}</a>)}</nav>}
    </div>
  );
  const current = [...NAV, ...MORE].find((n) => n.match.test(hash));

  return (
    <div className="shell">
      <aside className={`side${menu ? ' open' : ''}`} aria-label="Navigation">
        <div className="brand"><img src="favicon.svg" alt="" /><span>OLAF-Werkbank</span></div>
        <a href={cfg.librechatUrl} className="menu-chat btn small" title="Zurück zum Chat (LibreChat)">💬 Chat</a>
        <button className="menu-btn btn small" aria-expanded={menu} aria-controls="werkbank-nav" onClick={() => setMenu(!menu)}>
          {current ? <>{current.ico} {current.label}</> : 'Menü'}
          {/* Auf „Heute“ steht der Zähler am Namen („Heute 10“), sonst als Hinweis daneben („· Heute 10“) — nie beides. */}
          {current?.href === '#/' && todayN ? <span className="nav-count" aria-label={`${todayN} offen`}>{todayN}</span>
            : !menu && <span className="menu-more">· {todayN ? `Heute ${todayN}` : `${NAV.length + MORE.length - (current ? 1 : 0)} weitere`}</span>}<span aria-hidden>{menu ? '▴' : '▾'}</span>
        </button>
        <nav className="nav col" id="werkbank-nav" style={{ gap: 2 }}>
          <a href={cfg.librechatUrl} className="" title="Zurück zum Chat (LibreChat)"><span className="ico">💬</span>Chat</a>
          {NAV.map((n) => <NavLink key={n.href} n={n} hash={hash} count={n.href === '#/' ? todayN : null} />)}
        </nav>
        <div className="spacer" />
        <nav className="nav col more" aria-label="Weitere Seiten" style={{ gap: 0 }}>
          {MORE.map((n) => <NavLink key={n.href} n={n} hash={hash} />)}
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
