// Werkbank 2.0: der Chat als Seitenleiste auf jeder Seite (Desktop rechts, Handy von unten). Knut: Hauptchat (über LibreChats
// Serverweg) oder ein eigener neuer Chat (direkt auf der Brücke); alle anderen: eigene Chats. Der Zug läuft auf dem Server — die
// Leiste liest alle 1,5 s nach, solange eine Antwort läuft (übersteht Netzwechsel am Handy).
import { useEffect, useRef, useState } from 'react';
import { hole, schicke } from './api.ts';
import { useApp } from './kontext.ts';
import { Md } from './teile.tsx';

interface Nachricht { id: string; rolle: 'ich' | 'assistent'; text: string; at: string; status: string; fehler?: string | null }
interface Stand { ziel: 'hauptchat' | 'eigen'; zugang: boolean; nachrichten: Nachricht[]; laeuft: boolean; hauptchat?: { url: string | null } | null; chats?: { conv: string; titel: string }[]; conv?: string | null }

const ERKLAER_URL = '/v2/dokument?vault=' + encodeURIComponent('olaf/2-Areas/Product/Produkt-OLAF/produkt-olaf.md');

export function ChatLeiste({ offen, vorbereitet, schliessen }: { offen: boolean; vorbereitet: string; schliessen: () => void }) {
  const app = useApp();
  const [ziel, setZiel] = useState<'hauptchat' | 'eigen'>(app.ich.admin ? 'hauptchat' : 'eigen');
  const [conv, setConv] = useState<string | null>(null);
  const [stand, setStand] = useState<Stand | null>(null);
  const [text, setText] = useState('');
  const [sendet, setSendet] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [warten, setWarten] = useState(0);   // > 0: nach dem Senden nachlesen, bis die Antwort da ist (Hauptchat)
  const unten = useRef<HTMLDivElement>(null);

  useEffect(() => { if (vorbereitet) setText(vorbereitet); }, [vorbereitet]);

  async function laden() {
    const q = ziel === 'hauptchat' ? 'ziel=hauptchat' : `ziel=eigen${conv ? `&conv=${encodeURIComponent(conv)}` : ''}`;
    try { const s = await hole<Stand>(`/api/v2/chat?${q}`); setStand(s); setFehler(null); return s; } catch (e: any) { setFehler(e.message); return null; }
  }

  useEffect(() => { if (offen) void laden(); }, [offen, ziel, conv]);
  useEffect(() => {
    if (!offen || !(stand?.laeuft || warten > 0)) return;
    const t = setTimeout(async () => { await laden(); setWarten((w) => Math.max(0, w - 1)); }, 1500);
    return () => clearTimeout(t);
  }, [offen, stand, warten]);
  useEffect(() => { unten.current?.scrollIntoView({ block: 'end' }); }, [stand?.nachrichten.length, stand?.nachrichten.at(-1)?.text.length]);

  async function senden() {
    const t = text.trim();
    if (!t) return;
    setSendet(true); setFehler(null);
    try {
      const r = await schicke<{ conv?: string }>('/api/v2/chat', { ziel, text: t, conv: ziel === 'eigen' ? conv : undefined });
      setText('');
      if (ziel === 'eigen' && r.conv) setConv(r.conv);
      setWarten(ziel === 'hauptchat' ? 80 : 4);
      await laden();
    } catch (e: any) { setFehler(e.message); } finally { setSendet(false); }
  }

  if (!offen) return null;
  const ohneZugang = stand && !stand.zugang && ziel === 'eigen';
  return (
    <aside className="chat" role="dialog" aria-label="Chat" aria-modal="false">
      <div className="chat-kopf">
        <strong>{ziel === 'hauptchat' ? 'Hauptchat' : 'Chat'}</strong>
        {app.ich.admin && (
          <div className="umschalter" role="tablist">
            <button type="button" role="tab" aria-selected={ziel === 'hauptchat'} className={ziel === 'hauptchat' ? 'an' : ''} onClick={() => setZiel('hauptchat')}>Hauptchat</button>
            <button type="button" role="tab" aria-selected={ziel === 'eigen'} className={ziel === 'eigen' ? 'an' : ''} onClick={() => { setZiel('eigen'); setConv(null); }}>Neuer Chat</button>
          </div>
        )}
        <button type="button" className="knopf leise klein" onClick={schliessen} aria-label="Chat schließen">Schließen</button>
      </div>
      <p className="chat-hinweis klein gedimmt">{ziel === 'hauptchat' ? 'Dein Gespräch mit dem Assistenten, der die Arbeit verteilt. Antworten kommen hier an, auch wenn du die Seite wechselst.' : 'Ein neues Gespräch mit dem Assistenten — für Fragen zwischendurch.'}</p>

      <div className="chat-verlauf" aria-live="polite">
        {fehler && <p className="fehlertext" role="alert">{fehler}</p>}
        {!stand && !fehler && <p className="laedt">Lädt …</p>}
        {stand && ziel === 'hauptchat' && !stand.hauptchat && <p className="hinweis">Gerade ist kein Hauptchat aktiv. Starte ihn in der alten Werkbank oder nimm „Neuer Chat“.</p>}
        {ohneZugang && (
          <div className="hinweis">
            <p><b>Für den Chat brauchst du einen Claude-Zugang — alles andere geht ohne.</b> Frag Knut, wenn du einen brauchst.</p>
            <p>Bis dahin: <a href="/v2/begriffe" onClick={schliessen}>Begriffe in Klartext</a> · <a href={ERKLAER_URL} onClick={schliessen}>Was ist OLAF?</a> · <a href="/v2/dokumente" onClick={schliessen}>Dokumente suchen</a></p>
          </div>
        )}
        {stand?.nachrichten.map((n) => (
          <div key={n.id} className={`blase ${n.rolle}`}>
            {n.rolle === 'assistent' && !n.text && n.status === 'laeuft' ? <p className="gedimmt">schreibt …</p> : <Md text={n.text} klein />}
            {n.status === 'abgebrochen' && <p className="fehlertext klein">Abgebrochen: {n.fehler ?? 'die Antwort lief nicht zu Ende.'}</p>}
            {n.status === 'fehler' && <p className="fehlertext klein">{n.fehler ?? 'Die Antwort kam nicht an.'}</p>}
          </div>
        ))}
        {stand?.laeuft && <p className="klein gedimmt">Der Assistent arbeitet …</p>}
        <div ref={unten} />
      </div>

      {!ohneZugang && !(ziel === 'hauptchat' && stand && !stand.hauptchat) && (
        <form className="chat-eingabe" onSubmit={(e) => { e.preventDefault(); void senden(); }}>
          <label htmlFor="chat-text" className="unsichtbar">Nachricht</label>
          <textarea id="chat-text" rows={3} value={text} maxLength={8000} onChange={(e) => setText(e.target.value)} placeholder="Frag etwas …"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void senden(); } }} />
          <div className="chat-aktionen">
            {text.length > 7000 && <span className="klein gedimmt">{text.length} / 8000</span>}
            <button type="submit" className="knopf haupt" disabled={sendet || !text.trim() || !!stand?.laeuft}>{sendet ? 'Sendet …' : 'Senden'}</button>
          </div>
        </form>
      )}
    </aside>
  );
}
