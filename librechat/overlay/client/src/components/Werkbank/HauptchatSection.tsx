// OLAF Workspace: Abschnitt „Hauptchat“ ganz oben in LibreChats Chat-Seitenleiste (docs/plan-hauptchat-workspace.md, S1).
// Oben der eine Hauptchat der Person (Admins), darunter eingerückt die offenen Unter-Chats je Thema (Plan 154, S2: automatisch
// aus Titel/Paket/Ordner, von Hand über `orch thema`), jede Gruppe auf-/zuklappbar, mit Status.
// Daten: /werkbank/api/leitstand/overview (gleicher Ursprung, nur Admins; 403 → Abschnitt fehlt, keine weiteren Abrufe).
// Eingesetzt per librechat/patches/50-client-hauptchat.patch in UnifiedSidebar/ConversationsSection.tsx.
import { memo, useCallback, useEffect, useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as Menu from '@ariakit/react/menu';
import { ChevronDown, Ellipsis, FileCheck, FileText, Satellite } from 'lucide-react';
import { cn } from '~/utils';

type Status = 'läuft' | 'wartet' | 'fertig' | 'gestoppt' | 'erledigt';
type Strand = { id: string; title: string; lauf: string; thema?: string; status: Status; url: string; auftrag?: boolean; bericht?: boolean };
type Group = { key: string; lauf: string; counts: Record<string, number>; strands: Strand[] };
type Thema = { thema: string; counts: Record<string, number>; strands: Strand[] };
type Overview = { leitstand: { conv: string; title: string; status: string; url: string } | null; offen: Group[]; themen?: Thema[] };

// ---------- gemeinsamer Stand (Abschnitt + Symbol im Icon-Streifen), ein Abruf für beide ----------
type Snap = { state: 'laden' | 'ok' | 'kein-zugriff' | 'fehler'; data: Overview | null };
let snap: Snap = { state: 'laden', data: null };
const subs = new Set<() => void>();
let inflight: Promise<void> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
const set = (s: Snap) => { snap = s; subs.forEach((f) => f()); };

export function reloadHauptchat() {
  if (snap.state === 'kein-zugriff' || inflight) return inflight ?? undefined;
  inflight = fetch('/werkbank/api/leitstand/overview', { credentials: 'same-origin' })
    .then(async (r) => {
      // 403 = kein Admin (bleibt so, keine weiteren Abrufe); 401 = Anmeldung gerade im Wechsel → still, beim nächsten Takt neu.
      if (r.status === 403) { set({ state: 'kein-zugriff', data: null }); return; }
      if (r.status === 401) { set({ state: snap.data ? snap.state : 'laden', data: snap.data }); return; }
      if (!r.ok) throw new Error(String(r.status));
      set({ state: 'ok', data: (await r.json()) as Overview });
    })
    .catch(() => set({ state: 'fehler', data: snap.data }))
    .finally(() => { inflight = null; });
  return inflight;
}
function subscribe(f: () => void) {
  subs.add(f);
  if (subs.size === 1) {
    reloadHauptchat();
    timer = setInterval(() => { if (document.visibilityState === 'visible') reloadHauptchat(); }, 30_000);
    window.addEventListener('focus', onWake);
    window.addEventListener('werkbank-hauptchat', onWake);
  }
  return () => {
    subs.delete(f);
    if (!subs.size) {
      if (timer) clearInterval(timer);
      window.removeEventListener('focus', onWake);
      window.removeEventListener('werkbank-hauptchat', onWake);
    }
  };
}
const onWake = () => { reloadHauptchat(); };

/** Stand des Hauptchats; lädt bei jedem Chat-/Seitenwechsel neu (ein neuer Hauptchat steht so sofort oben, Council B7). */
export function useHauptchat() {
  const s = useSyncExternalStore(subscribe, () => snap);
  const { pathname } = useLocation();
  useEffect(() => { reloadHauptchat(); }, [pathname]);
  return s;
}

// ---------- Darstellung ----------
const WORD: Record<string, string> = { läuft: 'läuft', wartet: 'braucht dich', fertig: 'bereit', gestoppt: 'blockiert', erledigt: 'erledigt' };
const DOT: Record<string, string> = { läuft: 'bg-blue-500', wartet: 'bg-amber-500', fertig: 'bg-green-600', gestoppt: 'bg-red-600', erledigt: 'bg-gray-400' };
// Server-Werte des Hauptchats bleiben (Brücke, Tests); nur die Anzeige wird gemappt.
const HEAD_WORD: Record<string, string> = { 'wartet auf dich': 'braucht dich' };
const HEAD_DOT: Record<string, string> = { läuft: 'bg-blue-500', 'wartet auf dich': 'bg-amber-500', bereit: 'bg-green-600' };
const chatPath = (url: string) => { const m = /\/c\/([^/?#]+)/.exec(url ?? ''); return m ? `/c/${m[1]}` : null; };
const KEY = 'olaf-hauptchat-auf';
type Auf = { alle?: boolean; lauf?: Record<string, boolean>; thema?: Record<string, boolean>; fertig?: Record<string, boolean> };
const readAuf = (): Auf => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') as Auf; } catch { return {}; } };
const writeAuf = (a: Auf) => { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch { /* privat */ } };
const shortTitle = (s: Strand) => {
  const t = s.title.replace(new RegExp(`^${s.lauf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(:|·)\\s*`), '');
  return t || s.title;
};
// Im Thema „Rechner“ heißt „Rechner b: Feedback …“ nur „b: Feedback …“ nicht — nur ein führendes Thema-Wort samt „:“/„·“ fällt weg.
const themaTitle = (s: Strand, thema: string) => {
  const t = s.title.replace(new RegExp(`^${thema.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(:|·)\\s*`, 'i'), '');
  return t || s.title;
};

// no-underline/font-normal: LibreChats globale Link-Stile würden die Zeilen sonst unterstreichen und fett setzen.
const ROW = 'group relative flex h-12 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-sm font-normal text-text-primary no-underline hover:no-underline outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black dark:focus-visible:ring-white md:h-9';
const ACTIVE = 'bg-surface-active-alt before:absolute before:bottom-1 before:left-0 before:top-1 before:w-0.5 before:rounded-full before:bg-black dark:before:bg-white';

function ChatLink({ path, active, onOpen, className, children, testid, label }: { path: string; active: boolean; onOpen: (p: string) => void; className?: string; children: ReactNode; testid: string; label: string }) {
  return (
    <a
      href={path}
      data-testid={testid}
      aria-current={active ? 'page' : undefined}
      aria-label={label}
      title={label}
      className={cn(ROW, active ? ACTIVE : 'hover:bg-surface-active-alt', className)}
      onClick={(e) => {
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // neuer Tab/Fenster: Browser macht es
        e.preventDefault();
        onOpen(path);
      }}
    >
      {children}
    </a>
  );
}

function StatusWort({ status }: { status: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-text-secondary" data-testid="unterchat-status-wrap">
      <span className={cn('h-2 w-2 rounded-full', DOT[status] ?? 'bg-gray-400')} aria-hidden="true" />
      <span data-testid="unterchat-status">{WORD[status] ?? status}</span>
    </span>
  );
}

function HauptchatSection({ toggleNav }: { toggleNav?: () => void }) {
  const { state, data } = useHauptchat();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const listId = useId();
  const [auf, setAuf] = useState<Auf>(readAuf);
  const save = useCallback((a: Auf) => { setAuf(a); writeAuf(a); }, []);
  const open = useCallback((p: string) => { navigate(p, { state: { focusChat: true } }); toggleNav?.(); }, [navigate, toggleNav]);
  const toStart = () => { navigate(`/wb/heute?h=${encodeURIComponent('#/?start=1')}`); toggleNav?.(); };

  // Ohne je geladene Daten nichts zeigen — auch bei Fehlern (sonst sähe ein Team-Konto bei einem Ausfall den Abschnitt; Review).
  if (state === 'kein-zugriff' || !data) return null;
  const h = data?.leitstand ?? null;
  const groups = data?.offen ?? [];
  // Plan 154: Themen-Gruppen, wenn der Server sie liefert (ältere Server: Läufe wie bisher).
  const themen = data?.themen ?? null;
  const n = themen ? themen.reduce((a, g) => a + g.strands.filter((x) => x.status !== 'erledigt').length, 0) : groups.reduce((a, g) => a + g.strands.length, 0);
  const alleAuf = auf.alle !== false;
  const hPath = h ? chatPath(h.url) ?? `/c/${h.conv}` : null;
  const laufAuf = (g: Group) => auf.lauf?.[g.lauf] ?? !!(g.counts.wartet || g.counts.gestoppt);
  // Vorgabe: offen, wenn dort etwas auf Knut wartet oder gestoppt ist — oder wenn es nur ein Thema gibt.
  const themaAuf = (g: Thema) => auf.thema?.[g.thema] ?? !!(g.counts.wartet || g.counts.gestoppt || ((themen?.length ?? 0) === 1 && (g.counts.läuft || g.counts.fertig)));

  // Je Unter-Chat drei Links (Knut 12.10.): die Zeile selbst = Chat, rechts Auftrag und Bericht (review-pakete/NNN-*/…),
  // gelesen auf der Workspace-Seite „Hauptchat & Unter-Chats“. Fehlt eine Datei, bleibt das Symbol blass und ohne Link.
  const datei = (s: Strand, art: 'auftrag' | 'bericht') => {
    const Icon = art === 'auftrag' ? FileText : FileCheck;
    const name = art === 'auftrag' ? 'Auftrag' : 'Bericht';
    const box = 'flex h-8 w-8 items-center justify-center rounded-md';
    if (!s[art]) return <span className={cn(box, 'text-text-tertiary opacity-40')} title={`${name}: noch keiner`} aria-hidden="true"><Icon className="h-4 w-4" /></span>;
    const to = `/wb/leitstand?h=${encodeURIComponent(`#/leitstand?${art}=${s.id}`)}`;
    return (
      <a
        href={to}
        data-testid={`unterchat-${art}`}
        aria-label={`${name} zu „${s.title}“`}
        title={name}
        className={cn(box, 'no-underline text-text-secondary hover:bg-surface-active-alt hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-white')}
        onClick={(e) => { if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; e.preventDefault(); navigate(to); toggleNav?.(); }}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
      </a>
    );
  };
  const strandRow = (s: Strand, indent: string, label: string) => {
    const p = chatPath(s.url);
    if (!p) return null;
    return (
      <li key={s.id} className="relative" data-status={s.status}>
        <ChatLink path={p} active={pathname === p} onOpen={open} testid="unterchat" label={`Chat: ${s.title} — ${WORD[s.status] ?? s.status}`}
          className={cn(indent, 'h-auto min-h-[48px] py-1 pr-[72px] md:h-auto md:min-h-[44px]', s.status === 'wartet' && pathname !== p && 'bg-amber-500/10 font-medium hover:bg-amber-500/20')}>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate">{label}</span>
            <StatusWort status={s.status} />
          </span>
        </ChatLink>
        <span className="absolute right-1 top-1/2 flex -translate-y-1/2 gap-0.5">{datei(s, 'auftrag')}{datei(s, 'bericht')}</span>
      </li>
    );
  };

  return (
    <section className="px-3 pb-1" data-testid="hauptchat-section" aria-label="Hauptchat und Unter-Chats">
      <div className="flex h-8 w-full items-center gap-0.5 pr-2">
        <button
          type="button"
          data-testid="hauptchat-toggle"
          aria-expanded={alleAuf}
          aria-controls={alleAuf ? listId.replace(/[^A-Za-z0-9_-]/g, '_') : undefined}
          onClick={() => save({ ...auf, alle: !alleAuf })}
          className="group flex min-w-0 flex-1 items-center gap-1 rounded-lg px-1 py-2 text-xs font-bold text-text-secondary outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-black dark:focus-visible:ring-white"
        >
          <span className="select-none truncate">Hauptchat{n ? ` · ${n} Unter-Chat${n === 1 ? '' : 's'}` : ''}</span>
          <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform duration-200', alleAuf ? '' : '-rotate-90')} aria-hidden="true" />
        </button>
        <Menu.MenuProvider placement="bottom-end">
          <Menu.MenuButton
            data-testid="hauptchat-menu"
            aria-label="Hauptchat-Menü"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-secondary hover:bg-surface-active-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-white"
          >
            <Ellipsis className="h-4 w-4" aria-hidden="true" />
          </Menu.MenuButton>
          <Menu.Menu portal gutter={4} className="popover-ui z-[125] w-[220px] rounded-lg">
            <Menu.MenuItem className="select-item text-sm" data-testid="hauptchat-neustart" onClick={toStart}>
              {h ? 'Hauptchat neu starten …' : 'Hauptchat starten …'}
            </Menu.MenuItem>
            <Menu.MenuItem className="select-item text-sm" data-testid="hauptchat-alle" onClick={() => { navigate('/wb/heute'); toggleNav?.(); }}>
              Alle Unter-Chats
            </Menu.MenuItem>
          </Menu.Menu>
        </Menu.MenuProvider>
      </div>

      {!data ? null : h && hPath ? (
        <ChatLink path={hPath} active={pathname === hPath} onOpen={open} testid="hauptchat-open" label={`Hauptchat (${h.title}) — ${HEAD_WORD[h.status] ?? h.status}`}>
          <Satellite className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-medium">Hauptchat</span>
          <span className="flex shrink-0 items-center gap-1 text-xs text-text-secondary">
            <span className={cn('h-2 w-2 rounded-full', HEAD_DOT[h.status] ?? 'bg-gray-400')} aria-hidden="true" />
            {HEAD_WORD[h.status] ?? h.status}
          </span>
        </ChatLink>
      ) : (
        <button type="button" data-testid="hauptchat-starten-leiste" onClick={toStart} className={cn(ROW, 'hover:bg-surface-active-alt')}>
          <Satellite className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-left">
            <span className="font-medium">Hauptchat starten</span>
            <span className="block truncate text-xs text-text-secondary md:hidden">führt die Unter-Chats</span>
          </span>
        </button>
      )}

      {alleAuf && (
        <div id={listId.replace(/[^A-Za-z0-9_-]/g, '_')} className="max-h-[40vh] overflow-y-auto">
          {state === 'fehler' && (
            <p className="flex items-center gap-2 px-2 py-1 text-xs text-text-secondary" role="status">
              Stand gerade nicht abrufbar.
              <button type="button" className="underline" onClick={() => reloadHauptchat()}>Erneut</button>
            </p>
          )}
          {state === 'ok' && n === 0 && <p className="px-2 py-1 pl-8 text-xs text-text-secondary">Noch keine Unter-Chats — der Hauptchat startet sie.</p>}
          <ul className="flex flex-col" aria-label="Unter-Chats">
            {themen && themen.map((g, gi) => {
              const o = themaAuf(g);
              const gid = `${listId}-thema-${gi}`.replace(/[^A-Za-z0-9_-]/g, '_');
              // Zusatz Knut (Z9): zuerst offen (läuft / wartet auf dich / gestoppt), darunter eingeklappt „Fertig (n)“.
              const offen = g.strands.filter((x) => x.status === 'läuft' || x.status === 'wartet' || x.status === 'gestoppt');
              const fertig = g.strands.filter((x) => x.status === 'fertig' || x.status === 'erledigt');
              const parts = (['wartet', 'gestoppt', 'läuft', 'fertig'] as const).filter((w) => g.counts[w]).map((w) => `${g.counts[w]} ${WORD[w]}`);
              const first = (['wartet', 'gestoppt', 'läuft', 'fertig'] as const).find((w) => g.counts[w]);
              const fAuf = auf.fertig?.[g.thema] ?? false;
              const fid = `${gid}-fertig`;
              return (
                <li key={g.thema} data-testid="hauptchat-thema-gruppe">
                  <button
                    type="button"
                    data-testid="hauptchat-thema"
                    aria-expanded={o}
                    aria-controls={o ? gid : undefined}
                    onClick={() => save({ ...auf, thema: { ...(auf.thema ?? {}), [g.thema]: !o } })}
                    className={cn(ROW, 'pl-3 hover:bg-surface-active-alt')}
                    title={`${g.thema}: ${g.strands.length} Unter-Chat${g.strands.length === 1 ? '' : 's'}${parts.length ? ' · ' + parts.join(' · ') : ''}`}
                  >
                    <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform duration-200', o ? '' : '-rotate-90')} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-left font-medium">{g.thema}</span>
                    {g.counts.wartet ? (
                      <span data-testid="hauptchat-thema-wartet" className="shrink-0 rounded-full bg-amber-500/15 px-1.5 text-xs font-medium text-amber-700 dark:text-amber-300">{g.counts.wartet} braucht dich</span>
                    ) : first ? <span className={cn('h-2 w-2 shrink-0 rounded-full', DOT[first])} aria-hidden="true" /> : null}
                    {/* zu: was sonst los ist; auf: nur die Zahl der offenen, die Zeilen zeigen den Stand */}
                    <span className="min-w-0 shrink truncate text-xs text-text-secondary">
                      {!o ? parts.filter((x) => !x.endsWith(WORD.wartet)).join(' · ') || (g.counts.erledigt ? `${g.counts.erledigt} erledigt` : '') : offen.length || ''}
                    </span>
                  </button>
                  {o && (
                    <ul id={gid} className="flex flex-col">
                      {offen.map((x) => strandRow(x, 'pl-8', themaTitle(x, g.thema)))}
                      {fertig.length > 0 && (
                        <li>
                          <button
                            type="button"
                            data-testid="hauptchat-fertig"
                            aria-expanded={fAuf}
                            aria-controls={fAuf ? fid : undefined}
                            onClick={() => save({ ...auf, fertig: { ...(auf.fertig ?? {}), [g.thema]: !fAuf } })}
                            className={cn(ROW, 'h-8 pl-8 text-xs text-text-secondary hover:bg-surface-active-alt md:h-8')}
                          >
                            <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform duration-200', fAuf ? '' : '-rotate-90')} aria-hidden="true" />
                            <span className="min-w-0 flex-1 truncate text-left">Fertig ({fertig.length}){g.counts.fertig ? ` · ${g.counts.fertig} bereit` : ''}</span>
                          </button>
                          {fAuf && <ul id={fid} className="flex flex-col">{fertig.map((x) => strandRow(x, 'pl-12', themaTitle(x, g.thema)))}</ul>}
                        </li>
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
            {!themen && groups.map((g, gi) => {
              if (g.strands.length === 1) return strandRow(g.strands[0], 'pl-6', g.strands[0].title);
              const o = laufAuf(g);
              const gid = `${listId}-lauf-${gi}`.replace(/[^A-Za-z0-9_-]/g, '_');
              const parts = (['wartet', 'gestoppt', 'läuft', 'fertig'] as const).filter((w) => g.counts[w]).map((w) => `${g.counts[w]} ${WORD[w]}`);
              return (
                <li key={g.key}>
                  <button
                    type="button"
                    data-testid="hauptchat-lauf"
                    aria-expanded={o}
                    aria-controls={o ? gid : undefined}
                    onClick={() => save({ ...auf, lauf: { ...(auf.lauf ?? {}), [g.lauf]: !o } })}
                    className={cn(ROW, 'pl-6 hover:bg-surface-active-alt')}
                    title={`${g.lauf}: ${g.strands.length} Unter-Chats${parts.length ? ' · ' + parts.join(' · ') : ''}`}
                  >
                    <ChevronDown className={cn('h-3 w-3 shrink-0 transition-transform duration-200', o ? '' : '-rotate-90')} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-left font-medium">{g.lauf}</span>
                    <span className="shrink-0 text-xs text-text-secondary">{g.strands.length}{parts.length && !o ? ` · ${parts[0]}` : ''}</span>
                  </button>
                  {o && <ul id={gid} className="flex flex-col">{g.strands.map((s) => strandRow(s, 'pl-11', shortTitle(s)))}</ul>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="mx-1 mt-1 border-b border-border-light" />
    </section>
  );
}

export default memo(HauptchatSection);
