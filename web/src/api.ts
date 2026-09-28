// Kleiner API-Client. Schreibende Aufrufe tragen den Header x-werkbank: 1 (CSRF-Schutz).

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined || opts.raw !== undefined ? 'POST' : 'GET');
  // Relative Pfade: funktioniert direkt (:3070) und unter /werkbank/ im Chat.
  const r = await fetch(path.replace(/^\//, ''), {
    method,
    credentials: 'same-origin',
    headers: {
      ...(method !== 'GET' ? { 'x-werkbank': '1' } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.headers ?? {}),
    },
    body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  const text = await r.text();
  let j: any = null;
  try { j = text ? JSON.parse(text) : null; } catch { /* kein JSON */ }
  if (!r.ok) throw new ApiError(r.status, j?.error ?? `Fehler ${r.status}`);
  return j as T;
}

export interface User { id: string; email: string; name: string; role?: string }
export interface Config { librechatUrl: string; publicUrl: string; demo: boolean; user: User | null; jiraSite: string; project: string; vault: string; forge?: boolean }

export const fmtDate = (s?: string | null) => (s ? new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
export const fmtDateTime = (s?: string | number | null) => (s ? new Date(s).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
export const today = () => new Date().toISOString().slice(0, 10);

/** Läuft die Werkbank eingebettet in LibreChat (/werkbank im Hauptbereich)? */
export const embedded = (() => { try { return window.self !== window.top || new URLSearchParams(location.search).has('embed'); } catch { return true; } })();
/** Links zum Chat: eingebettet im selben Fenster (oben), sonst in einem neuen Tab. */
export const chatTarget = embedded ? '_top' : '_blank';
export function openChat(url: string) {
  if (embedded) { try { window.top!.location.href = url; return; } catch { /* fremder Ursprung */ } }
  window.open(url, '_blank', 'noopener');
}
