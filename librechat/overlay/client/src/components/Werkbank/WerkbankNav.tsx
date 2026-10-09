// OLAF-Werkbank: Einträge in LibreChats linker Leiste (aus dem Werkbank-Repo, librechat/overlay).
import { memo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Rocket, BookOpen, SquareKanban, RefreshCw, Blocks, Share2, Compass, Sun, Timer, Target } from 'lucide-react';
import { Button, TooltipAnchor } from '@librechat/client';
import { cn } from '~/utils';

// Leiste = dieselben fünf wie oben in der Werkbank (Council-Bedingung 11): Heute · Roadmap · Board · Sprint · Wissen.
// Die übrigen Seiten bleiben als /wb/<id> erreichbar (Zeile „Mehr“ unter jeder eingebetteten Seite).
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
  { id: 'einrichtung', hash: '#/einrichtung', label: 'Einrichtung', icon: Rocket, nav: false },
];

function WerkbankNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const current = pathname.startsWith('/wb/') ? pathname.split('/')[2] : '';
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
                onClick={() => navigate(`/wb/${p.id}`)}
              >
                <p.icon className="h-5 w-5" aria-hidden="true" />
              </Button>
            }
          />
        ))}
      </div>
    </>
  );
}

export default memo(WerkbankNav);
