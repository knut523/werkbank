// Karte am Chat (Release 29, Strang B; Knut 26.10.: „Entscheidungen direkt am Chat beantworten, der Status muss klar sein“).
// Ein Status je Chat (läuft · braucht Knut · in Review · fertig · hängt, web/server/chatstatus.ts) und darunter genau das, was zu tun ist:
//   braucht Knut → die offenen Fragen dieses Chats (dieselben Karten wie auf der Entscheidungsseite: Worum in einem Satz, Optionen,
//                  Empfehlung, Ja · Alternativen · Nein · Später · Anders + Notiz; Antworten gehen an dieselbe Quelle, der Strang
//                  arbeitet nach der letzten Antwort weiter, der Status wechselt von selbst). Ohne einzelne Frage: Grund + freies Antwortfeld.
//   in Review    → Link zum Paket, Screenshots, „Passt“ (→ fertig) / „Änderung“ (Text → der Strang arbeitet weiter).
// Die Seite `#/chatkarte/<Strang oder Unterhaltung>` hat nur diese Karte; LibreChat bettet sie oben im Chat ein und bekommt die Höhe
// per postMessage (`werkbank-chatkarte`). Schalter WERKBANK_CHAT_STATUS aus → Server antwortet `an: false`, hier bleibt es leer.
import { useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { Err, Loading, useLoad, useToast } from './ui.tsx';
import { Karte } from './pages/Entscheidungen.tsx';

const sicher = (u: unknown) => (/^https?:\/\//.test(String(u ?? '')) ? String(u) : null);
const TON: Record<string, string> = { warn: 'warn', ok: 'ok', bad: 'bad', info: '', '': '' };

/** Chip mit dem Chat-Status — dieselbe Darstellung in Karte, Arbeit-Liste und Leiste. */
export function StatusChip({ text, ton, status }: { text: string; ton?: string; status: string }) {
  return <span className={`chip ck-status ck-${status} ${TON[ton ?? ''] ?? ''}`} data-testid="chat-status" data-status={status}>{text}</span>;
}

function Freitext({ id, seen, art, vorgabe, knopf, onDone }: { id: string; seen: string | null; art: 'antwort' | 'nacharbeit'; vorgabe: string; knopf: string; onDone: () => void }) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const senden = async () => {
    setBusy(true); setErr(null);
    try { await api(`/api/leitstand/strands/${id}/reply`, { body: { kind: art, text: text.trim(), seen } }); toast('Gesendet — der Chat arbeitet weiter'); setText(''); onDone(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return <div className="ck-frei">
    <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={vorgabe} aria-label={vorgabe} data-testid="ck-text" />
    <div className="ub-row"><button className="ub-btn pri sm" disabled={busy || !text.trim()} onClick={senden} data-testid="ck-senden">{knopf}</button></div>
    <Err e={err} />
  </div>;
}

function ReviewTeil({ d, onDone }: { d: any; onDone: () => void }) {
  const toast = useToast();
  const r = d.review;
  const [aendern, setAendern] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const passt = async () => {
    setBusy(true); setErr(null);
    try { await api(`/api/leitstand/strands/${d.id}/passt`, { body: { seen: d.seen, note: 'Passt (Chat-Karte)' } }); toast('Abgehakt — fertig'); onDone(); }
    catch (e) { setErr(e); } finally { setBusy(false); }
  };
  return <div className="ck-review" data-testid="ck-review">
    {r && <>
      <p className="small"><b>{r.titel}</b>{r.kurz ? ` — ${r.kurz}` : ''}</p>
      {r.links?.length > 0 && <div className="ub-row">{r.links.map((l: any) => sicher(l.url) ? <a key={l.url} className="ub-btn sm" href={l.url} target="_blank" rel="noreferrer">{l.label}</a> : null)}</div>}
      {r.bilder?.length > 0 && <div className="ck-bilder">{r.bilder.map((b: string) => <a key={b} href={b} target="_blank" rel="noreferrer"><img src={b} alt="Screenshot aus dem Paket" loading="lazy" /></a>)}</div>}
      {r.github?.length > 0 && <p className="tiny mut">{r.github.map((g: any) => `${g.repo} · ${g.zweig} · ${g.commit}`).join(' — ')}</p>}
    </>}
    {d.laeuft && <p className="tiny mut">Der Chat arbeitet gerade — „Passt“ und „Änderung“ gehen, sobald er fertig ist.</p>}
    <div className="e-btns" role="group" aria-label="Review">
      <button data-v="passt" disabled={busy || d.laeuft || !d.seen} onClick={passt} data-testid="ck-passt">Passt</button>
      <button data-v="aenderung" aria-pressed={aendern} disabled={busy || d.laeuft || !d.seen} onClick={() => setAendern((x) => !x)} data-testid="ck-aenderung">Änderung</button>
    </div>
    {aendern && <Freitext id={d.id} seen={d.seen} art="nacharbeit" vorgabe="Was soll anders werden?" knopf="Änderung schicken" onDone={onDone} />}
    <Err e={err} />
  </div>;
}

export function ChatKarte({ id }: { id: string }) {
  const { data, error, reload } = useLoad<any>(() => api(`/api/chatstatus/${id}`), [id]);
  const wurzel = useRef<HTMLDivElement>(null);
  // Alle 15 s neu (Status wechselt von selbst, wenn der Strang weiterarbeitet).
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 15_000); return () => clearInterval(t); }, [reload]);
  // Höhe an LibreChat melden (die Karte steckt dort in einem iframe).
  useEffect(() => {
    const el = wurzel.current; if (!el || window.parent === window) return;
    const senden = () => { try { window.parent.postMessage({ type: 'werkbank-chatkarte', id, hoehe: Math.ceil(el.getBoundingClientRect().height) }, window.location.origin); } catch { /* egal */ } };
    senden();
    const ro = new ResizeObserver(senden); ro.observe(el);
    return () => ro.disconnect();
  }, [id, data]);
  if (error) return <div ref={wurzel}><Err e={error} /></div>;
  if (!data) return <div ref={wurzel}><Loading /></div>;
  if (!data.an || !data.strang) return <div ref={wurzel} data-testid="chatkarte-leer" />;
  const offen: any[] = data.fragen ?? [];
  const nachDer = () => reload();
  return (
    <div ref={wurzel} className={`ck ck-${data.status}`} data-testid="chatkarte" data-status={data.status}>
      <div className="ck-kopf">
        <StatusChip text={data.text} ton={data.ton} status={data.status} />
        <span className="small ck-grund">{data.grund}</span>
      </div>
      {data.status === 'braucht' && <>
        {offen.length > 0 && <p className="small"><b>{offen.length} {offen.length === 1 ? 'Frage' : 'Fragen'}</b> an dich — hier beantworten, der Chat arbeitet danach weiter.</p>}
        {offen.map((f) => <Karte key={f.id} f={f} kurz onDone={() => nachDer()} />)}
        {data.freitext && <div data-testid="ck-freitext">
          {data.freitext.grund && <p className="small">{data.freitext.grund}</p>}
          {data.freitext.auszug && <details className="tiny"><summary>Letzte Antwort des Chats</summary><pre className="small" style={{ whiteSpace: 'pre-wrap' }}>{data.freitext.auszug}</pre></details>}
          <Freitext id={data.id} seen={data.seen} art="antwort" vorgabe="Deine Antwort an den Chat" knopf="Antwort schicken" onDone={nachDer} />
        </div>}
      </>}
      {data.status === 'review' && <ReviewTeil d={data} onDone={nachDer} />}
    </div>
  );
}
