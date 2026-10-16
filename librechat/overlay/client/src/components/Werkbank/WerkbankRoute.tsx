// OLAF Workspace: eine Workspace-Seite im Hauptbereich von LibreChat (aus dem Werkbank-Repo).
// Die Seiten kommen von /werkbank/ (gleicher Ursprung → gleiche Anmeldung, gleiches Hell/Dunkel).
// Die Unterseite (#/wissen/…) steht in der Adresszeile als /wb/<seite>?h=<hash>, damit Neuladen und Links gehen.
//
// Eine Oberfläche (docs/plan-eine-oberflaeche.md): EIN iframe für alle Werkbank-Seiten. Ein Wechsel in der Leiste
// setzt nur den Hash im iframe (location.replace → keine zweite Verlaufszeile, kein Neuladen). Den Verlauf führt
// bei Klicks in der Seite der iframe, die Adresszeile folgt immer mit replace — Zurück ist so immer ein Klick.
import { useEffect, useRef, useState } from 'react';
import { useRecoilValue } from 'recoil';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useMediaQuery } from '@librechat/client';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import { WERKBANK_PAGES, openInApp, pageHash, pageIdOf } from './WerkbankNav';
import { useOpenChat } from './openChat';
import store from '~/store';

const hashFor = (page: string, search: string) => {
  const h = new URLSearchParams(search).get('h');
  const p = WERKBANK_PAGES.find((x) => x.id === page);
  return h && h.startsWith('#/') ? h : p ? pageHash(p) : '#/';
};

export default function WerkbankRoute() {
  const { page = 'heute' } = useParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  const openChat = useOpenChat();
  const isSmallScreen = useMediaQuery('(max-width: 768px)');
  const sidebarExpanded = useRecoilValue(store.sidebarExpanded);
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const wanted = hashFor(page, search);
  // Einmal gesetzt, nie geändert: ein neues src würde den iframe neu laden.
  const [src] = useState(() => `/werkbank/?embed=1${wanted}`);
  const label = WERKBANK_PAGES.find((p) => p.id === page)?.label ?? 'OLAF Workspace';

  useEffect(() => { document.title = `${label} · OLAF Workspace`; }, [label]);

  // Adresszeile → iframe (Leiste, Zurück/Vor): nur wenn der Hash im iframe ein anderer ist (verhindert Schleifen).
  useEffect(() => {
    if (!ready) return;
    try {
      const loc = frame.current?.contentWindow?.location;
      if (loc && (loc.hash || '#/') !== wanted) loc.replace(loc.pathname + loc.search + wanted);
    } catch { /* fremder Ursprung – kann nicht sein */ }
  }, [wanted, ready]);

  // Klick in der Leiste auf die schon offene Seite: Inhalt neu laden (WerkbankNav).
  useEffect(() => {
    const reload = () => { try { frame.current?.contentWindow?.location.reload(); } catch { /* egal */ } };
    window.addEventListener('werkbank-reload', reload);
    return () => window.removeEventListener('werkbank-reload', reload);
  }, []);

  // iframe → Adresszeile (immer replace) und „im Chat öffnen“ ohne Neuladen.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const d = e.data;
      if (d?.type === 'werkbank-route' && typeof d.hash === 'string' && d.hash.startsWith('#/')) {
        const id = pageIdOf(d.hash);
        navigate(`/wb/${id}?h=${encodeURIComponent(d.hash)}`, { replace: true });
      }
      if (d?.type === 'werkbank-open' && typeof d.url === 'string') openInApp(openChat, d.url);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [navigate, openChat]);

  return (
    <div className="flex h-full w-full flex-col bg-presentation">
      {isSmallScreen && !sidebarExpanded && (
        // Handy: derselbe Knopf wie im Chat-Kopf, damit man von jeder Werkbank-Seite überallhin kommt.
        <div className="flex h-14 flex-none items-center gap-2 px-2" data-testid="werkbank-mobile-header">
          <OpenSidebar />
          <span className="truncate text-base font-semibold text-text-primary">{label}</span>
        </div>
      )}
      <iframe
        ref={frame}
        title={label}
        src={src}
        onLoad={() => setReady(true)}
        className="h-full w-full flex-1 border-0 bg-presentation transition-opacity duration-150"
        style={{ opacity: ready ? 1 : 0 }}
        data-testid="werkbank-frame"
      />
    </div>
  );
}
