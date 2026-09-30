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

const NAV = [
  { href: '#/', label: 'Einrichtung', ico: '🚀', match: /^#\/?$/ },
  { href: '#/wissen', label: 'Wissen', ico: '📚', match: /^#\/wissen/ },
  { href: '#/board', label: 'Board', ico: '🗂️', match: /^#\/board/ },
  { href: '#/sprint', label: 'Sprint', ico: '🔁', match: /^#\/sprint/ },
  { href: '#/ziele', label: 'Ziele', ico: '🎯', match: /^#\/ziele/ },
  { href: '#/timebox', label: 'Mein Tag', ico: '⏱️', match: /^#\/timebox/ },
  { href: '#/roadmap', label: 'Roadmap', ico: '🧭', match: /^#\/roadmap/ },
  { href: '#/skills', label: 'Skills', ico: '🧰', match: /^#\/skills/ },
  { href: '#/dateien', label: 'Dateien & Teilen', ico: '📎', match: /^#\/dateien/ },
];

export function App() {
  const hash = useHash();
  const [cfg, setCfg] = useState<Config | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'light');
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
  const page = !user ? <Setup cfg={cfg} onLogin={load} />
    : /^#\/wissen/.test(hash) ? <Wissen cfg={cfg} hash={hash} />
    : /^#\/board/.test(hash) ? <Board cfg={cfg} hash={hash} />
    : /^#\/sprint/.test(hash) ? <Sprint cfg={cfg} hash={hash} />
    : /^#\/timebox/.test(hash) ? <Timebox cfg={cfg} />
    : /^#\/ziele/.test(hash) ? <Ziele cfg={cfg} hash={hash} />
    : /^#\/roadmap/.test(hash) ? <Roadmap cfg={cfg} hash={hash} />
    : /^#\/skills/.test(hash) ? <Skills cfg={cfg} />
    : /^#\/dateien/.test(hash) ? <Dateien cfg={cfg} />
    : <Setup cfg={cfg} onLogin={load} />;

  if (embedded) return <div className="embedded">{page}</div>;

  return (
    <div className="shell">
      <aside className="side" aria-label="Navigation">
        <div className="brand"><img src="favicon.svg" alt="" /><span>OLAF-Werkbank</span></div>
        <nav className="nav col" style={{ gap: 2 }}>
          <a href={cfg.librechatUrl} className="" title="Zurück zum Chat (LibreChat)"><span className="ico">💬</span>Chat</a>
          {NAV.map((n) => (
            <a key={n.href} href={n.href} className={n.match.test(hash) ? 'active' : ''} aria-current={n.match.test(hash) ? 'page' : undefined}>
              <span className="ico">{n.ico}</span>{n.label}
            </a>
          ))}
        </nav>
        <div className="spacer" />
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
