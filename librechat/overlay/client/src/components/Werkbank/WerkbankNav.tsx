// OLAF-Werkbank: Einträge in LibreChats linker Leiste (aus dem Werkbank-Repo, librechat/overlay).
import { memo, useEffect } from 'react';
import Cookies from 'js-cookie';
import { useSetRecoilState } from 'recoil';
import * as Menu from '@ariakit/react/menu';
import { useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { Rocket, BookOpen, SquareKanban, RefreshCw, Blocks, Share2, Compass, Sun, Timer, Target, Ellipsis } from 'lucide-react';
import { Button, TooltipAnchor, useMediaQuery } from '@librechat/client';
import { cn } from '~/utils';
import store from '~/store';

// Leiste = dieselben fünf wie oben in der Werkbank (Council-Bedingung 11): Heute · Roadmap · Board · Sprint · Wissen.
// Die übrigen vier unter „Mehr“; die Einrichtung steht im Kontomenü bei LibreChats Einstellungen (WerkbankSetupItem).
export const WERKBANK_PAGES = [
  { id: 'heute', hash: '#/', label: 'Heute', icon: Sun, nav: true },
  { id: 'roadmap', hash: '#/roadmap', label: 'Roadmap', icon: Compass, nav: true },
  { id: 'board', hash: '#/board', label: 'Board (Jira PM)', icon: SquareKanban, nav: true },
  { id: 'sprint', hash: '#/sprint', label: 'Sprint', icon: RefreshCw, nav: true },
  { id: 'wissen', hash: '#/wissen', label: 'Wissen (Vault)', icon: BookOpen, nav: true },
  { id: 'timebox', hash: '#/timebox', label: 'Mein Tag', icon: Timer, nav: false },
  { id: 'ziele', hash: '#/ziele', label: 'Ziele', icon: Target, nav: false },
  { id: 'skills', hash: '#/skills', label: 'Skills', icon: Blocks, nav: false },
  { id: 'dateien', hash: '#/dateien', label: 'Dateien & Teilen', icon: Share2, nav: false },
  { id: 'einrichtung', hash: '#/einrichtung', label: 'Werkbank-Einrichtung', icon: Rocket, nav: false, menu: false },
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

function WerkbankNav() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const closeOnMobile = useCloseSidebarOnMobile();
  useGermanByDefault();
  const current = pathname.startsWith('/wb/') ? pathname.split('/')[2] : '';
  const go = (id: string) => {
    // Klick auf die offene Seite = neu laden (wie früher, als jeder Klick den iframe neu lud).
    const h = new URLSearchParams(search).get('h');
    if (id === current && (!h || h === WERKBANK_PAGES.find((p) => p.id === id)?.hash)) window.dispatchEvent(new Event('werkbank-reload'));
    else navigate(`/wb/${id}`);
    closeOnMobile();
  };
  const moreActive = MORE.some((p) => p.id === current);
  return (
    <>
      <div className="mx-2 border-b border-border-light" />
      <div className="flex flex-col gap-1" role="group" aria-label="Werkbank">
        {WERKBANK_PAGES.filter((p) => p.nav).map((p) => (
          <TooltipAnchor
            key={p.id}
            description={p.label}
            side="right"
            render={
              <Button
                size="icon"
                variant="ghost"
                aria-label={p.label}
                aria-pressed={current === p.id}
                data-testid={`werkbank-nav-${p.id}`}
                className={cn('h-9 w-9 rounded-lg', current === p.id ? 'bg-surface-active-alt text-text-primary' : 'text-text-secondary')}
                onClick={() => go(p.id)}
              >
                <p.icon className="h-5 w-5" aria-hidden="true" />
              </Button>
            }
          />
        ))}
        <Menu.MenuProvider placement="right-start">
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
            {MORE.map((p) => (
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
        </Menu.MenuProvider>
      </div>
    </>
  );
}

export default memo(WerkbankNav);
