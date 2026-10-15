// OLAF Workspace (früher OLAF-Werkbank): Einträge in LibreChats linker Leiste (aus dem Werkbank-Repo, librechat/overlay).
import { memo, useEffect, useState } from 'react';
import Cookies from 'js-cookie';
import { useSetRecoilState } from 'recoil';
import * as Menu from '@ariakit/react/menu';
import { useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { Rocket, BookOpen, SquareKanban, RefreshCw, Blocks, Share2, Compass, Sun, Timer, Target, Ellipsis, Satellite } from 'lucide-react';
import { Button, TooltipAnchor, useMediaQuery } from '@librechat/client';
import { cn } from '~/utils';
import store from '~/store';
import { useHauptchat } from './HauptchatSection';

// Leiste = dieselben fünf wie oben in der Werkbank (Council-Bedingung 11): Heute · Roadmap · Board · Sprint · Wissen.
// Die übrigen vier unter „Mehr“; die Einrichtung steht im Kontomenü bei LibreChats Einstellungen (WerkbankSetupItem).
export const WERKBANK_PAGES = [
  { id: 'heute', hash: '#/', label: 'Übersicht', icon: Sun, nav: true },   // Plan 184, Teil B: Startseite heißt Übersicht (Adresse /wb/heute bleibt)
  { id: 'roadmap', hash: '#/roadmap', label: 'Roadmap', icon: Compass, nav: true },
  { id: 'board', hash: '#/board', label: 'Board (Jira PM)', icon: SquareKanban, nav: true },
  { id: 'sprint', hash: '#/sprint', label: 'Sprint', icon: RefreshCw, nav: true },
  { id: 'wissen', hash: '#/wissen', label: 'Wissen (Vault)', icon: BookOpen, nav: true },
  { id: 'timebox', hash: '#/timebox', label: 'Mein Tag', icon: Timer, nav: false },
  { id: 'ziele', hash: '#/ziele', label: 'Ziele', icon: Target, nav: false },
  { id: 'skills', hash: '#/skills', label: 'Skills', icon: Blocks, nav: false },
  { id: 'dateien', hash: '#/dateien', label: 'Dateien & Teilen', icon: Share2, nav: false },
  { id: 'leitstand', hash: '#/leitstand', label: 'Übersicht', icon: Satellite, nav: false, menu: false },   // Paket 187 S4: Alias — die Seite ist in der Übersicht aufgegangen
  { id: 'einrichtung', hash: '#/einrichtung', label: 'Workspace-Einrichtung', icon: Rocket, nav: false, menu: false },
];
const MORE = WERKBANK_PAGES.filter((p) => !p.nav && p.menu !== false);

/** Ein Link aus der Werkbank (Chat öffnen, Kontomenü …) im selben Fenster: nur eigener Ursprung; /c/ und /wb/ über den
 *  Router (kein Neuladen), anderes vom eigenen Ursprung normal geladen, Fremdes nie. */
export function openInApp(navigate: NavigateFunction, raw: string) {
  let u: URL;
  try { u = new URL(raw, window.location.origin); } catch { return; }
  if (u.origin !== window.location.origin) return;
  const to = u.pathname + u.search + u.hash;
  if (/^\/(c|wb)\//.test(u.pathname)) navigate(to);
  else window.location.assign(to);
}

/** Am Handy deckt die offene Leiste den Hauptbereich zu: nach einem Seitenwechsel schließen (wie LibreChat bei Chats). */
export function useCloseSidebarOnMobile() {
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const setExpanded = useSetRecoilState(store.sidebarExpanded);
  return () => { if (isSmallScreen) setExpanded(false); };
}

/** Deutsch als Vorgabe, solange niemand selbst eine Sprache gewählt hat (weder Cookie noch gespeicherte Wahl). Kein Cookie
 *  setzen: eine spätere Wahl in den Einstellungen bleibt die eigene. */
function useGermanByDefault() {
  const setLang = useSetRecoilState(store.lang);
  useEffect(() => {
    let stored: string | null = null;
    try { stored = localStorage.getItem('lang'); } catch { /* privat */ }
    if (!Cookies.get('lang') && !stored) setLang('de-DE');
  }, [setLang]);
}

/** Freigaben je Funktion und Zähler „Heute (n)“ aus der Werkbank (gleicher Ursprung, /werkbank). Admins sehen alles,
 *  das Team nur Freigegebenes (WERKBANK_TEAM_FEATURES); bis die Antwort da ist, keine Einträge (kein Aufblitzen). */
function useWerkbankState(dep: string) {
  const [features, setFeatures] = useState<Record<string, boolean> | null>(null);
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch('/werkbank/api/config', { credentials: 'same-origin' }).then((r) => r.json()).then((c) => { if (alive) setFeatures(c?.user ? c.features ?? {} : {}); }).catch(() => { if (alive) setFeatures({}); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    if (!features || features.heute === false) return;
    let alive = true;
    const load = () => fetch('/werkbank/api/today/count', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (alive && j) setCount(Number(j.count) || 0); }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    window.addEventListener('werkbank-questions', load);
    return () => { alive = false; clearInterval(t); window.removeEventListener('werkbank-questions', load); };
  }, [features, dep]);
  const show = (id: string) => !!features && features[id] !== false && (id in features || id === 'einrichtung');
  // Neu im Team (noch nichts freigegeben): die Einrichtung als einziger Eintrag in der Leiste, sonst findet man sie nur
  // im Kontomenü und der erste Chat endet mit „Kein API-Key gefunden“ (Release-Audit 11.10.2026).
  const onlySetup = !!features && !Object.values(features).some(Boolean);
  return { show, count, onlySetup };
}

function WerkbankNav() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const closeOnMobile = useCloseSidebarOnMobile();
  useGermanByDefault();
  const current = pathname.startsWith('/wb/') ? pathname.split('/')[2] : '';
  const { show, count, onlySetup } = useWerkbankState(pathname);
  const more = MORE.filter((p) => show(p.id));
  const go = (id: string) => {
    // Klick auf die offene Seite = neu laden (wie früher, als jeder Klick den iframe neu lud).
    const h = new URLSearchParams(search).get('h');
    if (id === current && (!h || h === WERKBANK_PAGES.find((p) => p.id === id)?.hash)) window.dispatchEvent(new Event('werkbank-reload'));
    else navigate(`/wb/${id}`);
    closeOnMobile();
  };
  const moreActive = more.some((p) => p.id === current);
  const haupt = useHauptchat();
  const hauptPath = haupt.data?.leitstand ? `/c/${haupt.data.leitstand.conv}` : null;
  return (
    <>
      <div className="mx-2 border-b border-border-light" />
      <div className="flex flex-col gap-1" role="group" aria-label="OLAF Workspace">
        {hauptPath && (
          // Hauptchat mit einem Klick, auch bei eingeklappter Leiste (Plan 144, Council B6) — nur Admins mit aktivem Hauptchat.
          <TooltipAnchor
            description="Hauptchat"
            side="right"
            render={
              <Button
                size="icon"
                variant="ghost"
                aria-label="Hauptchat öffnen"
                aria-current={pathname === hauptPath ? 'page' : undefined}
                data-testid="werkbank-nav-hauptchat"
                className={cn('relative h-9 w-9 rounded-lg', pathname === hauptPath ? 'bg-surface-active-alt text-text-primary' : 'text-text-secondary')}
                onClick={() => { navigate(hauptPath, { state: { focusChat: true } }); closeOnMobile(); }}
              >
                <Satellite className="h-5 w-5" aria-hidden="true" />
              </Button>
            }
          />
        )}
        {WERKBANK_PAGES.filter((p) => (p.nav && show(p.id)) || (onlySetup && p.id === 'einrichtung')).map((p) => (
          <TooltipAnchor
            key={p.id}
            description={p.label}
            side="right"
            render={
              <Button
                size="icon"
                variant="ghost"
                aria-label={p.id === 'heute' && count ? `${p.label}, ${count} offen` : p.label}
                aria-pressed={current === p.id}
                data-testid={`werkbank-nav-${p.id}`}
                className={cn('relative h-9 w-9 rounded-lg', current === p.id ? 'bg-surface-active-alt text-text-primary' : 'text-text-secondary')}
                onClick={() => go(p.id)}
              >
                <p.icon className="h-5 w-5" aria-hidden="true" />
                {p.id === 'heute' && count > 0 && (
                  <span data-testid="werkbank-heute-count" aria-hidden="true" className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-yellow-400 px-1 text-[10px] font-bold leading-4 text-gray-900">{count > 99 ? '99+' : count}</span>
                )}
              </Button>
            }
          />
        ))}
        {more.length > 0 && <Menu.MenuProvider placement="right-start">
          <TooltipAnchor
            description="Weitere Seiten"
            side="right"
            render={
              <Menu.MenuButton
                aria-label={moreActive ? `Weitere Seiten (offen: ${MORE.find((p) => p.id === current)?.label})` : 'Weitere Seiten'}
                data-testid="werkbank-mehr"
                className={cn(
                  'flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-surface-active-alt aria-[expanded=true]:bg-surface-active-alt',
                  moreActive ? 'bg-surface-active-alt text-text-primary' : 'text-text-secondary',
                )}
              >
                <Ellipsis className="h-5 w-5" aria-hidden="true" />
              </Menu.MenuButton>
            }
          />
          <Menu.Menu portal gutter={4} className="popover-ui z-[125] w-[220px] rounded-lg" data-testid="werkbank-mehr-menu">
            {more.map((p) => (
              <Menu.MenuItem
                key={p.id}
                onClick={() => go(p.id)}
                className={cn('select-item text-sm', current === p.id && 'font-semibold')}
                aria-current={current === p.id ? 'page' : undefined}
                data-testid={`werkbank-mehr-${p.id}`}
              >
                <p.icon className="icon-md" aria-hidden="true" />
                {p.label}
              </Menu.MenuItem>
            ))}
          </Menu.Menu>
        </Menu.MenuProvider>}
      </div>
    </>
  );
}

export default memo(WerkbankNav);
