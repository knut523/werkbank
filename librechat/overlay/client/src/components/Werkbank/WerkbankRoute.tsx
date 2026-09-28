// OLAF-Werkbank: eine Werkbank-Seite im Hauptbereich von LibreChat (aus dem Werkbank-Repo).
// Die Seiten kommen von /werkbank/ (gleicher Ursprung → gleiche Anmeldung, gleiches Hell/Dunkel).
// Die Unterseite (#/wissen/…) steht in der Adresszeile als /wb/<seite>?h=<hash>, damit Neuladen und Links gehen.
import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { WERKBANK_PAGES } from './WerkbankNav';

export default function WerkbankRoute() {
  const { page = 'einrichtung' } = useParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  const frame = useRef<HTMLIFrameElement>(null);
  const initial = useMemo(() => {
    const h = new URLSearchParams(search).get('h');
    return h && h.startsWith('#/') ? h : (WERKBANK_PAGES.find((p) => p.id === page)?.hash ?? '#/');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);
  const label = WERKBANK_PAGES.find((p) => p.id === page)?.label ?? 'Werkbank';

  useEffect(() => { document.title = `${label} · OLAF-Werkbank`; }, [label]);
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const d = e.data;
      if (d?.type === 'werkbank-route' && typeof d.hash === 'string') {
        const id = WERKBANK_PAGES.slice().reverse().find((p) => p.hash !== '#/' && d.hash.startsWith(p.hash))?.id ?? 'einrichtung';
        navigate(`/wb/${id}?h=${encodeURIComponent(d.hash)}`, { replace: id === page });
      }
      if (d?.type === 'werkbank-open' && typeof d.url === 'string' && d.url.startsWith('/')) navigate(d.url);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [navigate, page]);

  return (
    <div className="flex h-full w-full flex-col bg-surface-primary">
      <iframe
        ref={frame}
        key={page}
        title={label}
        src={`/werkbank/?embed=1${initial}`}
        className="h-full w-full flex-1 border-0"
        data-testid="werkbank-frame"
      />
    </div>
  );
}
