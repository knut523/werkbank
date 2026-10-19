// OLAF Workspace: schreiben, während der Agent arbeitet (docs/plan-hauptchat-monitor.md, S1; Knut 12.10.2026: „Ich kann nichts
// eingeben, wenn er arbeitet, ich kann ihn nur stoppen.“). Neben „Stopp“ ein Knopf „Nachreichen“; Enter im Eingabefeld löst ihn
// aus (Patch 60: useTextarea meldet `werkbank-nachreichen`). Die Nachricht geht über /werkbank/api/chat/nachreichen an die Brücke,
// die sie dem laufenden Zug beim nächsten Werkzeugschritt gibt („📨 Nachgereicht, gelesen …“ in der Antwort).
// Nimmt die Brücke nichts mehr an (Zug endet gerade, neuer Chat) oder bleibt die Nachricht ungelesen, sendet dieser Knopf sie
// nach dem Zug als normale Nachricht — außer nach „Stopp“: dann kommt der Text zurück ins Eingabefeld (Council R1, Bedingung 4).
// Bei „unbekannt“ (Brücke neu gestartet) wird nie neu gesendet, sondern zurückgelegt (Bedingung 2: lieber nicht doppelt).
// Fix 17d: jeder Eintrag kennt seine Unterhaltung; was Knut in einem anderen Chat nachgereicht hat, geht nie über dieses
// Eingabefeld, sondern über nachsenden.ts an genau diese Unterhaltung (oder als Entwurf dorthin zurück).
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { SendHorizontal } from 'lucide-react';
import { cn, getDraft, setDraft } from '~/utils';
import { nachsenden, zugende, type Eintrag } from './nachsenden';
import { abholen } from './chatWechsel';

type Item = Eintrag & { key: number };
const API = '/werkbank/api/chat/nachreichen';
const HINWEIS = 'werkbank-nachreichen-hinweis';

// Das gerade sichtbare Eingabefeld: liegt der Chat, für den ein Entwurf zurückkommt, offen, kommt der Text direkt ins Feld.
const feld: { conv: string | null; legen: ((t: string) => void) | null } = { conv: null, legen: null };
const melden = (text: string) => window.dispatchEvent(new CustomEvent(HINWEIS, { detail: text }));
async function postNachsenden(conv: string, text: string): Promise<number> {
  const r = await fetch('/werkbank/api/chat/nachsenden', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-werkbank': '1' }, body: JSON.stringify({ conv, text }) }).catch(() => null);
  return r?.status ?? 0;
}
function entwurf(conv: string, text: string) {
  if (feld.conv === conv && feld.legen) return feld.legen(text);
  setDraft({ id: conv, value: [text, getDraft(conv)?.trim()].filter(Boolean).join('\n\n') });
}
const DEPS = { stand, post: postNachsenden, entwurf, hinweis: melden, sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), now: () => Date.now() };

const WORT: Record<Item['state'], string> = {
  sende: 'wird zugestellt …',
  zugestellt: '📨 Zugestellt — Claude sieht es beim nächsten Schritt',
  gelesen: '✓ Gelesen',
  danach: '⏳ Kommt nach diesem Zug dran',
  ungelesen: '⏳ Kommt nach diesem Zug dran',
  unbekannt: '⏳ Kommt nach diesem Zug dran',
};

async function stand(id: string): Promise<Item['state']> {
  const r = await fetch(`${API}/${id}`, { credentials: 'same-origin' }).catch(() => null);
  const j: any = r && r.ok ? await r.json().catch(() => null) : null;
  return (['zugestellt', 'gelesen', 'ungelesen'].includes(j?.state) ? j.state : 'unbekannt') as Item['state'];
}

function Nachreichen({ conversationId, isSubmitting, methods, submitMessage, textAreaRef }: {
  conversationId: string | null | undefined;
  isSubmitting: boolean;
  methods: UseFormReturn<any>;
  submitMessage: (data: { text: string }) => void;
  textAreaRef: React.RefObject<HTMLTextAreaElement>;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [hinweis, setHinweis] = useState('');
  const text = String(useWatch({ control: methods.control, name: 'text' }) ?? '');
  const seq = useRef(0);
  const stopped = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const upd = (key: number, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));
  const aktiv = conversationId && conversationId !== 'new' ? conversationId : null;
  const convRef = useRef(aktiv);
  convRef.current = aktiv;
  const legen = useCallback((t: string) => {
    const vorhanden = String(methods.getValues('text') ?? '').trim();
    methods.setValue('text', [t, vorhanden].filter(Boolean).join('\n\n'), { shouldValidate: true });
  }, [methods]);
  useEffect(() => {
    feld.conv = aktiv;
    feld.legen = legen;
    return () => { if (feld.legen === legen) { feld.conv = null; feld.legen = null; } };
  }, [aktiv, legen]);
  // Fund 2: im Wechselfenster Abgeschicktes steht nach dem Laden hier im Feld (nicht gesendet). Kurz nach LibreChats useAutoSave,
  // das beim Wechsel das Feld in den Entwurf des vorigen Chats sichert und den des neuen lädt; dort wird der Text wieder entfernt.
  useEffect(() => {
    const v = abholen(aktiv);
    if (!v) return;
    const t = setTimeout(() => {
      if (v.von) setDraft({ id: v.von, value: '' });
      legen(v.text);
      setHinweis('Der Chat lud noch — dein Text steht jetzt hier im Eingabefeld. Bitte noch einmal senden.');
    }, 50);
    return () => clearTimeout(t);
  }, [aktiv, legen]);
  useEffect(() => {
    const on = (e: Event) => setHinweis(String((e as CustomEvent).detail ?? ''));
    window.addEventListener(HINWEIS, on);
    return () => window.removeEventListener(HINWEIS, on);
  }, []);

  const send = useCallback(async () => {
    const t = String(methods.getValues('text') ?? '').trim();
    if (!t) return;
    const key = ++seq.current;
    methods.setValue('text', '', { shouldValidate: true });
    if (textAreaRef.current) textAreaRef.current.value = '';
    setHinweis('');
    const conv = aktiv;
    if (!conv) { setItems((xs) => [...xs, { key, conv, text: t, state: 'danach' }]); return; }
    setItems((xs) => [...xs, { key, conv, text: t, state: 'sende' }]);
    const r = await fetch(API, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-werkbank': '1' }, body: JSON.stringify({ conv, text: t }) }).catch(() => null);
    const j: any = r ? await r.json().catch(() => ({})) : {};
    if (r?.ok && j.id) upd(key, { id: j.id, state: 'zugestellt' });
    else if (r && r.status === 409) upd(key, { state: 'danach' });   // Zug endet gerade / kein Zug: nach dem Zug senden
    else {
      // Fehler (400, 401, Netz): Text zurück ins Feld, nichts geht verloren.
      setItems((xs) => xs.filter((x) => x.key !== key));
      methods.setValue('text', t, { shouldValidate: true });
      setHinweis(j?.error ? String(j.error) : 'Nachreichen ging gerade nicht — der Text steht wieder im Eingabefeld.');
    }
  }, [aktiv, methods, textAreaRef]);

  // Enter im Eingabefeld während des Zugs (Patch 60) und der Stopp-Knopf (nach Stopp nichts selbst senden).
  useEffect(() => {
    const onEnter = () => { if (isSubmitting) void send(); };
    const onClick = (e: MouseEvent) => { if ((e.target as Element | null)?.closest?.('[data-testid="stop-generation-button"]')) stopped.current = true; };
    window.addEventListener('werkbank-nachreichen', onEnter);
    document.addEventListener('click', onClick, true);
    return () => { window.removeEventListener('werkbank-nachreichen', onEnter); document.removeEventListener('click', onClick, true); };
  }, [isSubmitting, send]);

  // Während des Zugs: Stand der zugestellten Nachrichten nachfragen.
  useEffect(() => {
    if (!items.some((x) => x.state === 'zugestellt' && x.id)) return;
    const t = setInterval(async () => {
      for (const x of itemsRef.current) if (x.state === 'zugestellt' && x.id) { const s = await stand(x.id); if (s !== 'zugestellt') upd(x.key, { state: s }); }
    }, 1500);
    return () => clearInterval(t);
  }, [items]);

  // Zugende: Ungelesenes als nächste Nachricht senden (nach „Stopp“ bzw. bei „unbekannt“ zurück ins Feld). Nur der Wechsel
  // läuft → fertig zählt; Formular und Senden über Refs, damit ein neues submitMessage den Ablauf weder neu startet noch abbricht.
  // Auch ein Chatwechsel ist für LibreChat „fertig“ (isSubmitting false, der Zug läuft weiter): darum entscheidet zugende() erst
  // nach dem Nachfragen, mit dem DANN offenen Chat — Einträge eines anderen Chats gehen an nachsenden() (Fix 17d).
  const was = useRef(isSubmitting);
  const methodsRef = useRef(methods);
  methodsRef.current = methods;
  const submitRef = useRef(submitMessage);
  submitRef.current = submitMessage;
  useEffect(() => {
    const prev = was.current;
    was.current = isSubmitting;
    if (isSubmitting) { if (!prev) stopped.current = false; return; }
    if (!prev || !itemsRef.current.length) return;
    void (async () => {
      // Die Brücke setzt „ungelesen“ erst am Zugende — kurz nachfragen, bis nichts mehr „zugestellt“ oder „sende“ ist.
      let xs = itemsRef.current;
      for (let i = 0; i < 8 && xs.some((x) => x.state === 'zugestellt' || x.state === 'sende'); i++) {
        await new Promise((r) => setTimeout(r, 700));
        xs = await Promise.all(itemsRef.current.map(async (x) => (x.state === 'zugestellt' && x.id ? { ...x, state: await stand(x.id) } : x)));
      }
      setItems([]);
      const plan = zugende(xs, convRef.current, stopped.current);
      for (const [conv, ys] of plan.fremd) void nachsenden(conv, ys, DEPS);
      const m = methodsRef.current;
      if (plan.zuruecklegen) {
        const vorhanden = String(m.getValues('text') ?? '').trim();
        m.setValue('text', [plan.zuruecklegen, vorhanden].filter(Boolean).join('\n\n'), { shouldValidate: true });
        setHinweis(stopped.current ? 'Gestoppt — deine Nachricht steht wieder im Eingabefeld.' : 'Nicht sicher angekommen — deine Nachricht steht wieder im Eingabefeld.');
        return;
      }
      if (plan.senden) submitRef.current({ text: plan.senden });
    })();
  }, [isSubmitting]);

  useEffect(() => {
    if (!hinweis) return;
    const t = setTimeout(() => setHinweis(''), 8000);
    return () => clearTimeout(t);
  }, [hinweis]);

  useEffect(() => {
    if (!items.length || items.some((x) => x.state !== 'gelesen')) return;
    const t = setTimeout(() => setItems([]), 4000);
    return () => clearTimeout(t);
  }, [items]);

  const leer = !text.trim();
  return (
    <div className="relative flex items-center" data-testid="nachreichen">
      {(items.length > 0 || hinweis) && (
        <div role="status" aria-live="polite" data-testid="nachreichen-status"
          className="absolute bottom-full right-0 mb-2 w-[min(80vw,340px)] rounded-lg border border-border-light bg-surface-primary p-2 text-xs text-text-secondary shadow-md">
          {hinweis && <p className="text-text-primary">{hinweis}</p>}
          {items.map((x) => (
            <p key={x.key} className="truncate" data-state={x.state} title={x.text}>
              <span className="text-text-primary">{WORT[x.state]}</span>: „{x.text}“
            </p>
          ))}
        </div>
      )}
      {isSubmitting && (
        <button
          type="button"
          data-testid="nachreichen-button"
          disabled={leer}
          onClick={() => void send()}
          aria-label="Nachreichen — Claude sieht es beim nächsten Schritt"
          title="Nachreichen (Enter) — Claude sieht es beim nächsten Schritt"
          className={cn('mr-1 flex h-9 items-center gap-1 rounded-full border border-border-medium px-3 text-sm text-text-primary transition-colors',
            'hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-white disabled:cursor-not-allowed disabled:opacity-40')}
        >
          <SendHorizontal className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Nachreichen</span>
        </button>
      )}
    </div>
  );
}

export default memo(Nachreichen);
