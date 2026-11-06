// Werkbank 2.0: der Chat als Seitenleiste auf jeder Seite (Desktop rechts, Handy von unten). Knut: Hauptchat (über LibreChats
// Serverweg) oder ein eigener neuer Chat (direkt auf der Brücke); alle anderen: eigene Chats. Der Zug läuft auf dem Server — die
// Leiste liest alle 1,5 s nach, solange eine Antwort läuft (übersteht Netzwechsel am Handy).
import { useEffect, useRef, useState } from 'react';
import { hole, schicke } from './api.ts';
import { useApp } from './kontext.ts';
import { Md, useDaten } from './teile.tsx';
import { ohneStatuszeilen, wann } from './format.ts';
import { OLAF_KURZ, OLAF_MEHR } from './begriffe.ts';

interface Nachricht { id: string; rolle: 'ich' | 'assistent'; text: string; at: string; status: string; fehler?: string | null }
interface Stand { ziel: 'hauptchat' | 'eigen'; zugang: boolean; nachrichten: Nachricht[]; laeuft: boolean; hauptchat?: { url: string | null } | null; chats?: { conv: string; titel: string; vorlage?: string | null }[]; conv?: string | null; vorlagen?: { name: string; label: string; beschreibung: string }[]; eingereiht?: { text: string; at: string }[] }

/** Runde 7 (Abgleich: „Hauptchat starten“ fehlte in 2.0, 1 004 Züge hängen am Hauptchat): derselbe Weg wie in der alten Werkbank. */
function HauptchatStarten({ fertig }: { fertig: () => void }) {
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  return (
    <div className="hinweis">
      <p>Gerade ist kein Hauptchat aktiv.</p>
      <button type="button" className="knopf haupt klein" disabled={laeuft} onClick={async () => { setLaeuft(true); setFehler(null); try { await schicke('api/leitstand/start', {}); fertig(); } catch (e: any) { setFehler(e.message); } finally { setLaeuft(false); } }}>{laeuft ? 'Startet …' : 'Hauptchat starten'}</button>
      {fehler && <p className="fehlertext klein">{fehler}</p>}
    </div>
  );
}

export function ChatLeiste({ offen, vorbereitet, convWahl, schliessen }: { offen: boolean; vorbereitet: string; convWahl?: string; schliessen: () => void }) {
  const app = useApp();
  const [ziel, setZiel] = useState<'hauptchat' | 'eigen'>(app.ich.admin ? 'hauptchat' : 'eigen');
  const [unter, setUnter] = useState(false);   // Chat-Bereich (Knut 06.11.): dritter Einstieg „Unter-Chats“ (wie Arbeit nur für Admins)
  const [conv, setConv] = useState<string | null>(null);
  const [stand, setStand] = useState<Stand | null>(null);
  const [text, setText] = useState('');
  const [vorlage, setVorlage] = useState('');   // S22: Vorlage für einen neuen 2.0-Chat
  const [sendet, setSendet] = useState(false);
  const unterwegs = useRef(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [warten, setWarten] = useState(0);   // > 0: nach dem Senden nachlesen, bis die Antwort da ist (Hauptchat)
  const unten = useRef<HTMLDivElement>(null);

  // Pass A (UI 2): ein vorbereiteter Text oder ein gewählter Chat zeigt den Chat, nicht die Liste der Unter-Chats
  useEffect(() => { if (vorbereitet) { setText(vorbereitet); setUnter(false); } }, [vorbereitet]);
  useEffect(() => { if (offen && convWahl) { setUnter(false); setZiel('eigen'); setConv(convWahl); } }, [offen, convWahl]);   // S12: aus „Alle Chats“ geöffnet
  // Geschlossen: beim nächsten Öffnen wieder der Normalfall (Hauptchat bzw. neuer Chat), nicht der zuletzt gewählte (Pass C).
  useEffect(() => { if (!offen) { setConv(null); setUnter(false); setZiel(app.ich.admin ? 'hauptchat' : 'eigen'); } }, [offen]);

  const abruf = useRef(0);
  async function laden() {
    const mein = ++abruf.current;   // nur die jüngste Antwort zählt (Umschalten Hauptchat/Neuer Chat)
    const q = ziel === 'hauptchat' ? 'ziel=hauptchat' : `ziel=eigen${conv ? `&conv=${encodeURIComponent(conv)}` : ''}`;
    try { const s = await hole<Stand>(`api/v2/chat?${q}`); if (mein === abruf.current) { setStand(s); setFehler(null); } return s; } catch (e: any) { if (mein === abruf.current) setFehler(e.message); return null; }
  }

  // Pass A (UI 7): beim Wechsel des Reiters oder des Chats nicht kurz den alten Stand zeigen (sonst blitzte „Hauptchat starten“ auf);
  // ein neu angelegter Chat (null → Kennung nach dem Senden) behält seinen Verlauf.
  const vorher = useRef<{ ziel: string; conv: string | null }>({ ziel, conv });
  useEffect(() => {
    if (vorher.current.ziel !== ziel || (vorher.current.conv !== null && vorher.current.conv !== conv)) setStand(null);
    vorher.current = { ziel, conv };
    if (offen) void laden();
  }, [offen, ziel, conv]);
  useEffect(() => {
    if (!offen || !(stand?.laeuft || warten > 0)) return;
    const t = setTimeout(async () => { await laden(); setWarten((w) => Math.max(0, w - 1)); }, 1500);
    return () => clearTimeout(t);
  }, [offen, stand, warten]);
  useEffect(() => { unten.current?.scrollIntoView({ block: 'end' }); }, [stand?.nachrichten.length, stand?.nachrichten.at(-1)?.text.length]);

  async function senden() {
    const t = text.trim();
    // Pass B (Runde 5, D1): Strg+Enter umging die Sperre des Knopfs — eine Ref (nicht der Zustand, der im Closure veraltet sein kann)
    if (!t || unterwegs.current || (ziel === 'eigen' && stand?.laeuft)) return;
    unterwegs.current = true;
    setSendet(true); setFehler(null);
    try {
      const r = await schicke<{ conv?: string }>('api/v2/chat', { ziel, text: t, conv: ziel === 'eigen' ? conv : undefined, ...(ziel === 'eigen' && !conv && vorlage ? { vorlage } : {}) });
      setText((jetzt) => (jetzt.trim() === t ? '' : jetzt));   // D3: was während des Sendens getippt wurde, bleibt stehen
      if (ziel === 'eigen' && r.conv) setConv(r.conv);
      setWarten(ziel === 'hauptchat' ? 80 : 4);
      await laden();
    } catch (e: any) { setFehler(e.message); } finally { unterwegs.current = false; setSendet(false); }
  }

  if (!offen) return null;
  const ohneZugang = stand && !stand.zugang && ziel === 'eigen';
  return (
    <aside className="chat" role="dialog" aria-label="Chat" aria-modal="false">
      <div className="chat-kopf">
        <strong>{unter ? 'Unter-Chats' : ziel === 'hauptchat' ? 'Hauptchat' : 'Chat'}</strong>
        {app.ich.admin && (
          <div className="umschalter" role="tablist">
            <button type="button" role="tab" aria-selected={!unter && ziel === 'hauptchat'} className={!unter && ziel === 'hauptchat' ? 'an' : ''} onClick={() => { setUnter(false); setZiel('hauptchat'); }}>Hauptchat</button>
            <button type="button" role="tab" aria-selected={!unter && ziel === 'eigen'} className={!unter && ziel === 'eigen' ? 'an' : ''} onClick={() => { setUnter(false); setZiel('eigen'); setConv(null); }}>Neuer Chat</button>
            <button type="button" role="tab" aria-selected={unter} className={unter ? 'an' : ''} onClick={() => setUnter(true)}>Unter-Chats</button>
          </div>
        )}
        <button type="button" className="knopf leise klein" onClick={schliessen} aria-label="Chat schließen">Schließen</button>
      </div>
      {unter && <UnterchatListe schliessen={schliessen} />}
      {!unter && <p className="chat-hinweis klein gedimmt">{ziel === 'hauptchat' ? 'Dein Gespräch mit dem Assistenten, der die Arbeit verteilt. Antworten kommen hier an, auch wenn du die Seite wechselst.' : 'Ein neues Gespräch mit dem Assistenten — für Fragen zwischendurch.'}</p>}

      {/* Pass A (UI 8): vorgelesen wird nur die kurze Statuszeile, nicht der ganze, ständig nachgeladene Verlauf */}
      {!unter && <p className="unsichtbar" aria-live="polite">{stand?.laeuft ? 'Die Antwort kommt …' : ''}</p>}
      {!unter && <div className="chat-verlauf">
        {fehler && <p className="fehlertext" role="alert">{fehler}</p>}
        {!stand && !fehler && <p className="laedt">Lädt …</p>}
        {stand && ziel === 'hauptchat' && !stand.hauptchat && <HauptchatStarten fertig={() => void laden()} />}
        {ohneZugang && (
          <div className="hinweis">
            <p><b>Chatten geht nur mit einem Claude-Zugang — den hat dein Konto noch nicht.</b> Deshalb gibt es hier kein Eingabefeld, auch nicht über „Im Chat fragen“. Lesen, Suchen und Entscheiden gehen ohne. Frag Knut, wenn du einen Zugang brauchst.</p>
            <p><b>Was ist OLAF?</b> {OLAF_KURZ} <a href={OLAF_MEHR} onClick={schliessen}>Mehr dazu</a></p>
            <p>Weiter: <a href="v2/begriffe" onClick={schliessen}>Begriffe in Klartext</a> · <a href="v2/dokumente" onClick={schliessen}>Dokumente suchen</a></p>
          </div>
        )}
        {stand?.nachrichten.map((n) => (
          <div key={n.id} className={`blase ${n.rolle}`}>
            {n.rolle === 'assistent' && !n.text && n.status === 'laeuft' ? <p className="gedimmt">schreibt …</p> : <Md text={n.rolle === 'assistent' && n.status !== 'laeuft' ? ohneStatuszeilen(n.text) : n.text} klein />}
            {n.status === 'abgebrochen' && <p className="fehlertext klein">Abgebrochen: {n.fehler ?? 'die Antwort lief nicht zu Ende.'}</p>}
            {n.status === 'fehler' && <p className="fehlertext klein">{n.fehler ?? 'Die Antwort kam nicht an.'}</p>}
          </div>
        ))}
        {stand?.laeuft && <p className="klein gedimmt">Der Assistent arbeitet …{ziel === 'hauptchat' ? ' Du kannst trotzdem schreiben — die Nachricht wartet und geht raus, sobald er frei ist.' : ''}</p>}
        {!!stand?.eingereiht?.length && (
          <div className="blase ich wartet">
            <p className="klein gedimmt">{stand.eingereiht.length === 1 ? 'Wartet — geht raus, sobald der Hauptchat frei ist:' : `${stand.eingereiht.length} Nachrichten warten — gehen gesammelt raus, sobald der Hauptchat frei ist:`}</p>
            {stand.eingereiht.map((x, i) => <p key={i} className="klein">{x.text}{x.at && <span className="gedimmt"> · wartet seit {wann(x.at)}</span>}</p>)}
          </div>
        )}
        <div ref={unten} />
      </div>}

      {!unter && !ohneZugang && !(ziel === 'hauptchat' && stand && !stand.hauptchat) && (
        <form className="chat-eingabe" onSubmit={(e) => { e.preventDefault(); void senden(); }}>
          {ziel === 'eigen' && !conv && !!stand?.vorlagen?.length && (
            <label className="klein vorlage-wahl">Vorlage (optional): <select value={vorlage} onChange={(e) => setVorlage(e.target.value)}>
              <option value="">keine — freier Chat</option>
              {stand.vorlagen.map((v) => <option key={v.name} value={v.name} title={v.beschreibung}>{v.label}</option>)}
            </select></label>
          )}
          {ziel === 'eigen' && !conv && vorlage && <p className="klein gedimmt">{stand?.vorlagen?.find((v) => v.name === vorlage)?.beschreibung || 'Die Vorlage gibt dem Assistenten eine Arbeitsweise vor, wie in LibreChat.'}</p>}
          {ziel === 'eigen' && conv && stand?.chats?.find((c) => c.conv === conv)?.vorlage && <p className="klein gedimmt">Vorlage: {stand.vorlagen?.find((v) => v.name === stand.chats?.find((c) => c.conv === conv)?.vorlage)?.label ?? 'gewählt'}</p>}
          <label htmlFor="chat-text" className="unsichtbar">Nachricht</label>
          <textarea id="chat-text" rows={3} value={text} maxLength={8000} onChange={(e) => setText(e.target.value)} placeholder="Frag etwas …"
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void senden(); } }} />
          <div className="chat-aktionen">
            {text.length > 7000 && <span className="klein gedimmt">{text.length} / 8000</span>}
            <button type="submit" className="knopf haupt" disabled={sendet || !text.trim() || (ziel === 'eigen' && !!stand?.laeuft)}>{sendet ? 'Sendet …' : ziel === 'hauptchat' && stand?.laeuft ? 'Einreihen' : 'Senden'}</button>
          </div>
        </form>
      )}
    </aside>
  );
}

/** Chat-Bereich (Knut 06.11.): dritter Einstieg — die Unter-Chats, laufende und wartende zuerst; ein Klick öffnet den vollen Chat. */
function UnterchatListe({ schliessen }: { schliessen: () => void }) {
  const { d, fehler } = useDaten<{ gruppen?: Record<'wartet' | 'laeuft' | 'fertig', { id: string; titel: string; satz: string; zuletzt: string | null }[]> }>('api/v2/arbeit');
  if (fehler) return <p className="fehlertext">{fehler}</p>;
  if (!d) return <p className="laedt">Lädt …</p>;
  const g = d.gruppen ?? { wartet: [], laeuft: [], fertig: [] };
  const zeile = (z: { id: string; titel: string; satz: string; zuletzt: string | null }) => (
    <li key={z.id}><a href={`v2/arbeit/${z.id}`} onClick={schliessen}><b>{z.titel}</b></a><br /><span className="klein gedimmt">{z.satz}{z.zuletzt ? ` · ${wann(z.zuletzt)}` : ''}</span></li>
  );
  const teil = (titel: string, l: typeof g.wartet) => l.length > 0 && <><p className="gruppe-titel">{titel} ({l.length})</p><ul className="chat-unterchats">{l.map(zeile)}</ul></>;
  return (
    <div className="chat-verlauf">
      {teil('Wartet auf dich', g.wartet)}
      {teil('Läuft', g.laeuft)}
      {teil('Fertig', g.fertig.slice(0, 15))}
      {!g.laeuft.length && !g.wartet.length && !g.fertig.length && <p className="leer">Keine Unter-Chats.</p>}
      <p className="klein"><a href="v2/arbeit" onClick={schliessen}>Alle Unter-Chats unter „Arbeit“ →</a></p>
    </div>
  );
}
