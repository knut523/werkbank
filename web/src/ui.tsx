import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

// ---------- Bestätigung: jede Schreibaktion geht durch diesen Dialog ----------

interface ConfirmReq { title: string; body: ReactNode; confirmLabel?: string; danger?: boolean }
type ConfirmFn = (r: ConfirmReq) => Promise<boolean>;
const ConfirmCtx = createContext<ConfirmFn>(async () => false);
const ToastCtx = createContext<(msg: string) => void>(() => {});

export function Providers({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<(ConfirmReq & { resolve: (b: boolean) => void }) | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const confirm = useCallback<ConfirmFn>((r) => new Promise((resolve) => setReq({ ...r, resolve })), []);
  const showToast = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(null), 3500); }, []);
  const close = (b: boolean) => { req?.resolve(b); setReq(null); };
  useEffect(() => {
    if (!req) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });
  return (
    <ConfirmCtx.Provider value={confirm}>
      <ToastCtx.Provider value={showToast}>
        {children}
        {req && (
          <div className="backdrop" onClick={() => close(false)}>
            <div className="dialog" role="dialog" aria-modal="true" aria-label={req.title} onClick={(e) => e.stopPropagation()}>
              <h3>{req.title}</h3>
              <div className="col">{req.body}</div>
              <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16 }}>
                <button className="btn" onClick={() => close(false)}>Abbrechen</button>
                <button className={`btn ${req.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => close(true)}>{req.confirmLabel ?? 'Bestätigen'}</button>
              </div>
            </div>
          </div>
        )}
        {toast && <div className="toast" role="status">{toast}</div>}
      </ToastCtx.Provider>
    </ConfirmCtx.Provider>
  );
}

export const useConfirm = () => useContext(ConfirmCtx);
export const useToast = () => useContext(ToastCtx);

export function Err({ e }: { e: unknown }) {
  if (!e) return null;
  return <div className="err" role="alert">{e instanceof Error ? e.message : String(e)}</div>;
}

export function Loading({ what = 'Lade' }: { what?: string }) {
  return <p className="muted">{what} …</p>;
}

/** Daten laden mit Neuladen-Funktion. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try { setData(await fn()); setError(null); } catch (e) { setError(e); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload, setData };
}

export function StateChip({ state }: { state: string }) {
  const cls = /verlinkt|gleich|✅|ok|fertig|Done/.test(state) ? 'ok' : /fehlt|abweichend|kaputt|❌|fehler/.test(state) ? 'bad' : /🟡|läuft|wartet|woandershin/.test(state) ? 'warn' : '';
  return <span className={`chip ${cls}`}>{state}</span>;
}
