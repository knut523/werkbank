// OLAF Workspace: Status und Karte oben im Chat eines Unter-Chats (Release 29, Strang B; Schalter WERKBANK_CHAT_STATUS am Server).
// Fragt /werkbank/api/chatstatus/<Unterhaltung>; ist der Schalter aus, der Chat kein Unter-Chat oder die Person kein Admin, bleibt
// es leer (null). Sonst ein Streifen mit dem Status (läuft · braucht Knut · in Review · fertig · hängt); bei „braucht Knut“ und
// „in Review“ darunter die Karte — die Werkbank-Seite `#/chatkarte/<id>` in einem iframe (eine Quelle mit Entscheidungsseite und
// Arbeit-Liste), Höhe per postMessage `werkbank-chatkarte`. Eingesetzt per librechat/patches/85-client-chatstatus-kopf.patch in ChatView.tsx.
import { memo, useCallback, useEffect, useState } from 'react';
import { cn } from '~/utils';

type Kopf = { id: string; status: string; text: string; grund: string };
const DOT: Record<string, string> = { laeuft: 'bg-blue-500', braucht: 'bg-amber-500', review: 'bg-violet-500', fertig: 'bg-green-600', haengt: 'bg-red-600' };

function ChatStatusKopf({ conversationId }: { conversationId?: string | null }) {
  const [k, setK] = useState<Kopf | null>(null);
  const [zu, setZu] = useState(false);
  const [hoehe, setHoehe] = useState(160);
  const lade = useCallback(async () => {
    if (!conversationId || conversationId === 'new') { setK(null); return; }
    try {
      const r = await fetch(`/werkbank/api/chatstatus/${encodeURIComponent(conversationId)}`, { credentials: 'same-origin' });
      const j: any = r.ok ? await r.json() : null;
      setK(j?.an && j.strang ? { id: j.id, status: j.status, text: j.text, grund: j.grund } : null);
    } catch { setK(null); }
  }, [conversationId]);
  useEffect(() => {
    lade();
    const t = setInterval(() => { if (document.visibilityState === 'visible') lade(); }, 15_000);
    return () => clearInterval(t);
  }, [lade]);
  useEffect(() => {
    const f = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== 'werkbank-chatkarte' || e.data.id !== k?.id) { return; }
      setHoehe(Math.min(Math.max(Number(e.data.hoehe) || 0, 60), 640));
    };
    window.addEventListener('message', f);
    return () => window.removeEventListener('message', f);
  }, [k?.id]);
  if (!k) { return null; }
  const karte = k.status === 'braucht' || k.status === 'review';
  return (
    <div className="border-b border-border-light bg-surface-primary px-3 py-2" data-testid="chatstatus-kopf" data-chat-status={k.status}>
      <button type="button" className="flex w-full items-center gap-2 text-left text-sm" onClick={() => setZu((x) => !x)} aria-expanded={karte ? !zu : undefined} disabled={!karte}>
        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', DOT[k.status] ?? 'bg-gray-400')} aria-hidden="true" />
        <span className="font-medium" data-testid="chatstatus-text">{k.text}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">{k.grund}</span>
      </button>
      {karte && !zu && (
        <iframe title="Karte zu diesem Chat" src={`/werkbank/#/chatkarte/${k.id}`} className="mt-2 w-full rounded-md border-0" style={{ height: hoehe }} data-testid="chatstatus-karte" />
      )}
    </div>
  );
}

export default memo(ChatStatusKopf);
