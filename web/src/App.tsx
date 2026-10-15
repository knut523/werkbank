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
import { Uebersicht } from './pages/Uebersicht.tsx';
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

// Vier Bereiche (Paket 185/187, S5): Chats (= LibreChat) · Übersicht · Planen · Wissen. Planen und Wissen sind Reiter-Hüllen um die
// bisherigen Seiten — die Adressen (#/roadmap, #/board, #/wissen …) bleiben, der Bereich merkt sich den zuletzt benutzten Reiter
// (localStorage `wb-bereich:<id>`, gleicher Ursprung wie LibreChats Leiste). Ein Reiter erscheint nur mit Funktionsfreigabe.
type Reiter = { href: string; label: string; match: RegExp; f: string; wide?: boolean };
type Nav = { href: string; label: string; ico: string; match: RegExp; f: string };
const UEBERSICHT: Nav = {
  // Plan 184, Teil B: die Übersicht ist die Startseite; `#/heute`, `#/uebersicht` und `#/leitstand…` (früher die Seite
  // „Hauptchat & Unter-Chats“, S4) führen ebenfalls dorthin — alte Adressen bleiben gültig (185-B3).
  href: '#/', label: 'Übersicht', ico: '📋', match: /^#\/?(\?|$)|^#\/(heute|uebersicht|leitstand)(\?|$)/, f: 'heute',
};
const BEREICHE: { id: string; label: string; ico: string; reiter: Reiter[] }[] = [
  { id: 'planen', label: 'Planen', ico: '🧭', reiter: [
    { href: '#/roadmap', label: 'Roadmap', match: /^#\/roadmap/, f: 'roadmap', wide: true },
    { href: '#/sprint', label: 'Sprint', match: /^#\/sprint/, f: 'sprint' },
    { href: '#/board', label: 'Board', match: /^#\/board/, f: 'board', wide: true },
    { href: '#/ziele', label: 'Ziele', match: /^#\/ziele/, f: 'ziele', wide: true },
    { href: '#/timebox', label: 'Mein Tag', match: /^#\/timebox/, f: 'timebox', wide: true },
  ] },
  { id: 'wissen', label: 'Wissen', ico: '📚', reiter: [
    { href: '#/wissen', label: 'Vault', match: /^#\/wissen/, f: 'wissen', wide: true },
    { href: '#/dateien', label: 'Dateien', match: /^#\/dateien/, f: 'dateien' },
    { href: '#/skills', label: 'Skills', match: /^#\/skills/, f: 'skills' },
  ] },
];
const EINRICHTUNG: Nav = { href: '#/einrichtung', label: 'Einrichtung', ico: '🚀', match: /^#\/einrichtung/, f: '' };
const merkKey = (id: string) => `wb-bereich:${id}`;
/** Zuletzt benutzter Reiter des Bereichs (nur freigegebene), sonst der erste freigegebene. */
function letzterReiter(b: { id: string; reiter: Reiter[] }): string {
  try { const h = localStorage.getItem(merkKey(b.id)); if (h && b.reiter.some((r) => r.href === h)) return h; } catch { /* privat */ }
  return b.reiter[0].href;
}

function NavLink({ n, hash, count }: { n: Nav; hash: string; count?: number | null }) {
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
  // Die Roadmap-Tabelle in Wissen ist entfallen (Paket 187, S6): die alte Adresse führt zur Roadmap.
  useEffect(() => { if (/^#\/wissen\/~roadmap/.test(hash)) window.location.replace('#/roadmap'); }, [hash]);
  // Bereich merkt sich den zuletzt benutzten Reiter (die LibreChat-Leiste liest denselben Schlüssel).
  useEffect(() => { for (const b of BEREICHE) { const r = b.reiter.find((x) => x.match.test(hash)); if (r) try { localStorage.setItem(merkKey(b.id), r.href); } catch { /* privat */ } } }, [hash]);
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
    return <div className="page"><h1>OLAF Workspace</h1><p className="muted">Dein Chat-Konto ist für den OLAF Workspace noch nicht freigeschaltet (Pilot) — oder die Anmeldung ist abgelaufen. Seite neu laden; hilft das nicht, frag Knut.</p></div>;
  }
  // Freigabe je Funktion (web/server/features.ts): Admins alles, das Team nur, was Knut freigegeben hat.
  const vis = (n: { f: string }) => !n.f || cfg.features?.[n.f] !== false;
  // Bereiche mit ihren freigegebenen Reitern; ein Bereich ohne freigegebenen Reiter fehlt ganz.
  const bereiche = BEREICHE.map((b) => ({ ...b, reiter: b.reiter.filter(vis) })).filter((b) => b.reiter.length > 0);
  const nav: Nav[] = [UEBERSICHT, ...bereiche.map((b) => ({ href: letzterReiter(b), label: b.label, ico: b.ico, match: new RegExp(b.reiter.map((r) => r.match.source).join('|')), f: '' }))].filter(vis);
  const more: Nav[] = [EINRICHTUNG];
  const alle = [UEBERSICHT, ...BEREICHE.flatMap((b) => b.reiter)];
  const hidden = user && alle.find((n) => n.f && n.match.test(hash) && !vis(n));
  const bereich = bereiche.find((b) => b.reiter.some((r) => r.match.test(hash)));
  const reiterLeiste = bereich && <div className={`page bereich-bar${bereich.reiter.find((r) => r.match.test(hash))?.wide ? ' wide' : ''}`} data-testid={`bereich-${bereich.id}`}>
    <nav className="tabs" role="tablist" aria-label={bereich.label}>
      {bereich.reiter.map((r) => { const on = r.match.test(hash); return <a key={r.href} role="tab" aria-selected={on} className={on ? 'active' : ''} href={r.href}>{r.label}</a>; })}
    </nav>
  </div>;
  const heuteHidden = user && cfg.features?.heute === false && /^#\/?(\?|$)|^#\/(heute|uebersicht|leitstand)(\?|$)/.test(hash);
  // Anmelden über das Einrichtungs-Formular: weiter mit den ersten Schritten (Claude, Jira) auf der Einrichtung.
  const page = !user ? <Setup cfg={cfg} onLogin={() => { window.location.hash = '#/einrichtung'; load(); }} />
    : /^#\/einrichtung/.test(hash) || heuteHidden ? <Setup cfg={cfg} onLogin={load} />
    : hidden ? <div className="page" data-testid="not-released"><h1>{hidden.label}</h1><div className="card soft empty"><p><b>Noch nicht für das Team freigegeben.</b></p><p className="small muted">Knut gibt die Funktionen des OLAF Workspace nach und nach frei. Bis dahin: Chat und <a href="#/einrichtung">Einrichtung</a>.</p></div></div>
    : /^#\/wissen/.test(hash) ? <Wissen cfg={cfg} hash={hash} />
    : /^#\/board/.test(hash) ? <Board cfg={cfg} hash={hash} />
    : /^#\/sprint/.test(hash) ? <Sprint cfg={cfg} hash={hash} />
    : /^#\/timebox/.test(hash) ? <Timebox cfg={cfg} />
    : /^#\/ziele/.test(hash) ? <Ziele cfg={cfg} hash={hash} />
    : /^#\/roadmap/.test(hash) ? <Roadmap cfg={cfg} hash={hash} />
    : /^#\/skills/.test(hash) ? <Skills cfg={cfg} />
    : /^#\/dateien/.test(hash) ? <Dateien cfg={cfg} />
    : <Uebersicht cfg={cfg} hash={hash} />;

  // Eingebettet: kein eigenes Gerüst — Navigation ist LibreChats Leiste (Chats · Übersicht · Planen · Wissen), Einrichtung im Kontomenü.
  if (embedded) return <div className="embedded">{reiterLeiste}{page}</div>;
  const current = [...nav, ...more].find((n) => n.match.test(hash));

  return (
    <div className="shell">
      <aside className={`side${menu ? ' open' : ''}`} aria-label="Navigation">
        <div className="brand"><img src="favicon.svg" alt="" /><span>OLAF Workspace</span></div>
        <a href={cfg.librechatUrl} className="menu-chat btn small" title="Zurück zum Chat (LibreChat)">💬 Chat</a>
        <button className="menu-btn btn small" aria-expanded={menu} aria-controls="werkbank-nav" onClick={() => setMenu(!menu)}>
          {current ? <>{current.ico} {current.label}</> : 'Menü'}
          {/* Auf der Übersicht steht der Zähler am Namen („Übersicht 10“), sonst als Hinweis daneben („· Übersicht 10“) — nie beides. */}
          {current?.href === '#/' && todayN ? <span className="nav-count" aria-label={`${todayN} offen`}>{todayN}</span>
            : !menu && <span className="menu-more">· {todayN ? `Übersicht ${todayN}` : `${nav.length + more.length - (current ? 1 : 0)} weitere`}</span>}<span aria-hidden>{menu ? '▴' : '▾'}</span>
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
      <main className="main">{reiterLeiste}{page}</main>
    </div>
  );
}
