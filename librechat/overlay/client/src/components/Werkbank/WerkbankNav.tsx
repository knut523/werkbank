// OLAF Workspace (früher OLAF-Werkbank): Einträge in LibreChats linker Leiste (aus dem Werkbank-Repo, librechat/overlay).
import { memo, useEffect, useState } from 'react';
import Cookies from 'js-cookie';
import { useSetRecoilState } from 'recoil';
import { useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { Rocket, BookOpen, SquareKanban, RefreshCw, Blocks, Share2, Compass, Sun, Timer, Target, Satellite, Briefcase } from 'lucide-react';
import { Button, TooltipAnchor, useMediaQuery } from '@librechat/client';
import { cn } from '~/utils';
import store from '~/store';

// Leiste (Paket 185/187, S5): vier Bereiche — Chats (LibreChats Chatverlauf) · Übersicht · Planen · Wissen. Planen und Wissen sind
// Reiter-Hüllen um die bisherigen Seiten (die Reiter stehen in der Seite selbst); die Einträge darunter bleiben als Adressen
// gültig (/wb/<seite>), stehen aber nicht mehr in der Leiste. Das Hauptchat-Symbol und „Mehr“ entfallen (Hauptchat: Abschnitt oben
// in Chats). Die Einrichtung steht im Kontomenü bei LibreChats Einstellungen (WerkbankSetupItem).
// `bereich`/`reiter`: Funktionsfreigaben, bei denen der Bereich erscheint (mindestens eine). Alle alten IDs bleiben — WerkbankRoute
// ordnet damit Adressen zu.
export const WERKBANK_PAGES = [
  { id: 'heute', hash: '#/', label: 'Übersicht', icon: Sun, nav: true },   // Plan 184, Teil B: Startseite heißt Übersicht (Adresse /wb/heute bleibt)
  { id: 'planen', hash: '#/roadmap', label: 'Planen', icon: Compass, nav: true, bereich: 'planen', reiter: ['roadmap', 'sprint', 'board', 'ziele', 'timebox'] },
  { id: 'wissen', hash: '#/wissen', label: 'Wissen', icon: BookOpen, nav: true, bereich: 'wissen', reiter: ['wissen', 'dateien', 'skills'] },
  { id: 'roadmap', hash: '#/roadmap', label: 'Roadmap', icon: Compass, nav: false, menu: false, bereich: 'planen' },
  { id: 'board', hash: '#/board', label: 'Board (Jira PM)', icon: SquareKanban, nav: false, menu: false, bereich: 'planen' },
  { id: 'sprint', hash: '#/sprint', label: 'Sprint', icon: RefreshCw, nav: false, menu: false, bereich: 'planen' },
  { id: 'timebox', hash: '#/timebox', label: 'Mein Tag', icon: Timer, nav: false, menu: false, bereich: 'planen' },
  { id: 'ziele', hash: '#/ziele', label: 'Ziele', icon: Target, nav: false, menu: false, bereich: 'planen' },
  { id: 'skills', hash: '#/skills', label: 'Skills', icon: Blocks, nav: false, menu: false, bereich: 'wissen' },
  { id: 'dateien', hash: '#/dateien', label: 'Dateien & Teilen', icon: Share2, nav: false, menu: false, bereich: 'wissen' },
  { id: 'leitstand', hash: '#/leitstand', label: 'Übersicht', icon: Satellite, nav: false, menu: false },   // Alias: die Seite „Hauptchat & Unter-Chats“ ist in der Übersicht aufgegangen (S4)
  { id: 'einrichtung', hash: '#/einrichtung', label: 'Workspace-Einrichtung', icon: Rocket, nav: false, menu: false },
  // Plan 213 S3 (WERKBANK_NAV_NEU): Adressen der neuen Seiten; die Leiste zeigt dann Heute · Arbeit · Wissen (NAV_NEU unten).
  { id: 'inbox', hash: '#/inbox', label: 'Entscheide', icon: Sun, nav: false, menu: false },
  // Reihenfolge: pageIdOf sucht rückwärts nach Präfix — die längere Adresse (#/arbeit/reviews) muss nach #/arbeit stehen.
  { id: 'arbeit', hash: '#/arbeit', label: 'Arbeit', icon: Briefcase, nav: false, menu: false, bereich: 'arbeit' },
  { id: 'reviews', hash: '#/arbeit/reviews', label: 'Reviews & PRs', icon: Briefcase, nav: false, menu: false, bereich: 'arbeit' },
] as { id: string; hash: string; label: string; icon: any; nav: boolean; menu?: boolean; bereich?: string; reiter?: string[] }[];

/** Leiste der neuen Navigation (Plan 213 S3): Heute · Arbeit · Wissen — dieselben Namen und dieselbe Zahl wie im Workspace (K11).
 *  `zeige`: Funktionsfreigaben, bei denen der Bereich erscheint; `teil`: Seiten-IDs, die zum Bereich gehören (aktiv markieren). */
export const NAV_NEU = [
  { id: 'heute', hash: '#/', label: 'Heute', icon: Sun, zeige: ['heute'], teil: ['heute', 'inbox'] },
  { id: 'arbeit', hash: '#/arbeit', label: 'Arbeit', icon: Briefcase, zeige: ['heute', 'roadmap', 'board', 'sprint', 'timebox'], teil: ['arbeit', 'reviews', 'board', 'sprint', 'timebox', 'leitstand'] },
  { id: 'wissen', hash: '#/wissen', label: 'Wissen', icon: BookOpen, zeige: ['wissen', 'dateien', 'roadmap', 'ziele'], teil: ['wissen', 'dateien', 'roadmap', 'ziele'] },
];

/** Adresse einer Seite in der Leiste; Planen/Wissen öffnen den zuletzt benutzten Reiter (die Seite schreibt `wb-bereich:<id>`),
 *  sonst den ersten freigegebenen (`show`: Funktionsfreigabe je Reiter). */
export function pageHash(p: { id: string; hash: string; bereich?: string; reiter?: string[] }, show: (id: string) => boolean = () => true): string {
  if (!p.reiter) return p.hash;
  const hashes = p.reiter.filter(show).map((id) => WERKBANK_PAGES.find((x) => x.id === id)?.hash).filter((h): h is string => !!h);
  try {
    const h = localStorage.getItem(`wb-bereich:${p.id}`);
    if (h && hashes.includes(h)) return h;
  } catch { /* privat */ }
  return hashes[0] ?? p.hash;
}
/** Seiten-ID (Adresse /wb/<id>) zu einem Hash — wie in WerkbankRoute. */
export const pageIdOf = (hash: string) => WERKBANK_PAGES.slice().reverse().find((x) => x.hash !== '#/' && hash.startsWith(x.hash))?.id ?? 'heute';

/** Ein Link aus der Werkbank (Chat öffnen, Kontomenü …) im selben Fenster: nur eigener Ursprung; /c/ und /wb/ über den
 *  Router (kein Neuladen; Chats über useOpenChat, sonst bliebe der vorige Chat aktiv), anderes vom eigenen Ursprung normal
 *  geladen, Fremdes nie. */
export function openInApp(navigate: NavigateFunction | ((to: string) => void), raw: string) {
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
  const [neu, setNeu] = useState(false);
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch('/werkbank/api/config', { credentials: 'same-origin' }).then((r) => r.json()).then((c) => { if (alive) { setFeatures(c?.user ? c.features ?? {} : {}); setNeu(!!c?.navNeu); } }).catch(() => { if (alive) setFeatures({}); });
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
  return { show, count, onlySetup, neu };
}

function WerkbankNav() {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const closeOnMobile = useCloseSidebarOnMobile();
  useGermanByDefault();
  const current = pathname.startsWith('/wb/') ? pathname.split('/')[2] : '';
  const { show, count, onlySetup, neu } = useWerkbankState(pathname);
  if (neu) return <NavNeu current={current} show={show} count={count} onlySetup={onlySetup} go={(id) => { if (id === current && !new URLSearchParams(search).get('h')) window.dispatchEvent(new Event('werkbank-reload')); else navigate(`/wb/${id}`); closeOnMobile(); }} />;
  // Ein Bereich erscheint, wenn mindestens einer seiner Reiter freigegeben ist.
  const showPage = (p: (typeof WERKBANK_PAGES)[number]) => (p.reiter ? p.reiter.some(show) : show(p.id));
  const bereichOf = (id: string) => WERKBANK_PAGES.find((p) => p.id === id)?.bereich;
  const isActive = (p: (typeof WERKBANK_PAGES)[number]) => current === p.id || (!!p.bereich && bereichOf(current) === p.bereich);
  const go = (p: (typeof WERKBANK_PAGES)[number]) => {
    // Klick auf die offene Seite = neu laden (wie früher, als jeder Klick den iframe neu lud).
    const h = new URLSearchParams(search).get('h');
    const ziel = p.reiter ? pageIdOf(pageHash(p, show)) : p.id;
    if (ziel === current && (!h || h === pageHash(p, show))) window.dispatchEvent(new Event('werkbank-reload'));
    else navigate(`/wb/${ziel}`);
    closeOnMobile();
  };
  return (
    <>
      <div className="mx-2 border-b border-border-light" />
      <div className="flex flex-col gap-1" role="group" aria-label="OLAF Workspace">
        {WERKBANK_PAGES.filter((p) => (p.nav && showPage(p)) || (onlySetup && p.id === 'einrichtung')).map((p) => (
          <TooltipAnchor
            key={p.id}
            description={p.label}
            side="right"
            render={
              <Button
                size="icon"
                variant="ghost"
                aria-label={p.id === 'heute' && count ? `${p.label}, ${count} offen` : p.label}
                aria-pressed={isActive(p)}
                data-testid={`werkbank-nav-${p.id}`}
                className={cn('relative h-9 w-9 rounded-lg', isActive(p) ? 'bg-surface-active-alt text-text-primary' : 'text-text-secondary')}
                onClick={() => go(p)}
              >
                <p.icon className="h-5 w-5" aria-hidden="true" />
                {p.id === 'heute' && count > 0 && (
                  <span data-testid="werkbank-heute-count" aria-hidden="true" className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-yellow-400 px-1 text-[10px] font-bold leading-4 text-gray-900">{count > 99 ? '99+' : count}</span>
                )}
              </Button>
            }
          />
        ))}
      </div>
    </>
  );
}

/** Plan 213 S3: Heute · Arbeit · Wissen; Wissen öffnet den zuletzt benutzten Reiter wie bisher. */
function NavNeu({ current, show, count, onlySetup, go }: { current: string; show: (id: string) => boolean; count: number; onlySetup: boolean; go: (id: string) => void }) {
  const eintraege = NAV_NEU.filter((p) => p.zeige.some(show));
  const ziel = (p: (typeof NAV_NEU)[number]) => (p.id === 'wissen' ? pageIdOf(pageHash({ id: 'wissen', hash: '#/wissen', reiter: ['wissen', 'dateien', 'roadmap', 'ziele'] }, show)) : p.id);
  return (
    <>
      <div className="mx-2 border-b border-border-light" />
      <div className="flex flex-col gap-1" role="group" aria-label="OLAF Workspace">
        {eintraege.map((p) => {
          const aktiv = p.teil.includes(current);
          return (
            <TooltipAnchor key={p.id} description={p.label} side="right" render={
              <Button size="icon" variant="ghost" aria-label={p.id === 'heute' && count ? `${p.label}, ${count} offen` : p.label} aria-pressed={aktiv} data-testid={`werkbank-nav-${p.id}`}
                className={cn('relative h-9 w-9 rounded-lg', aktiv ? 'bg-surface-active-alt text-text-primary' : 'text-text-secondary')} onClick={() => go(ziel(p))}>
                <p.icon className="h-5 w-5" aria-hidden="true" />
                {p.id === 'heute' && count > 0 && <span data-testid="werkbank-heute-count" aria-hidden="true" className="absolute -right-0.5 -top-0.5 min-w-[16px] rounded-full bg-yellow-400 px-1 text-[10px] font-bold leading-4 text-gray-900">{count > 99 ? '99+' : count}</span>}
              </Button>
            } />
          );
        })}
        {onlySetup && <Button size="icon" variant="ghost" aria-label="Workspace-Einrichtung" className="h-9 w-9 rounded-lg text-text-secondary" onClick={() => go('einrichtung')}><Rocket className="h-5 w-5" aria-hidden="true" /></Button>}
      </div>
    </>
  );
}

export default memo(WerkbankNav);
