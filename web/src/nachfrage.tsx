// „Was ist das?“ (R32, Nachtrag 2): ein kleiner Chat direkt an der Karte. Der Klick schickt dem Hauptchat die Frage samt Kontext (Server:
// nachfrage.ts) und zeigt seine Antwort an der Karte; Knut fragt frei nach („was passiert bei Nein?“, „was würdest du tun?“). Entscheiden
// bleibt ein Klick an der Karte — der Hauptchat entscheidet nie selbst.
import { useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { Err } from './ui.tsx';

export type NfArt = 'frage' | 'strang' | 'pr' | 'eintrag';
type Zeile = { wer: 'du' | 'hauptchat'; text: string | null; warte?: boolean };

const SCHNELL = ['Was heißt das?', 'Was passiert, wenn ich Nein sage?', 'Was würdest du tun?'];
/** Markdown-Reste der Antwort ausblenden (der Hauptchat schreibt gern **fett**); der Zeilenumbruch bleibt. */
const rein = (t: string) => t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]*)`/g, '$1').replace(/^#{1,6}\s+/gm, '');

/** Knopf + Panel. `onSo` bekommt die Zeile „So entscheiden: …“ aus der Antwort, falls vorhanden (für einen Klick „so entscheiden“). */
export type NfAktion = { label: string; onClick: () => void; pri?: boolean };
export function WasIstDas({ art, id, kompakt = false, aktionen = [] }: { art: NfArt; id: string; kompakt?: boolean; aktionen?: NfAktion[] }) {
  const [offen, setOffen] = useState(false);
  const [zeilen, setZeilen] = useState<Zeile[]>([]);
  const [nid, setNid] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = () => { if (timer.current) { clearInterval(timer.current); timer.current = null; } };
  useEffect(() => stop, []);

  /** Alle 3 s nachsehen, bis zu jeder Frage eine Antwort da ist (höchstens 6 Minuten). */
  const warte = (n: string, anzahl: number) => {
    stop();
    const bis = Date.now() + 6 * 60_000;
    timer.current = setInterval(async () => {
      try {
        const r: any = await api(`/api/nachfrage/${n}`);
        const a: { text: string | null; fertig: boolean }[] = r.antworten ?? [];
        setZeilen((alt) => {
          const du = alt.filter((z) => z.wer === 'du');
          const neu: Zeile[] = [];
          du.forEach((z, i) => { neu.push(z); const x = a[i]; neu.push({ wer: 'hauptchat', text: x?.fertig ? x.text : null, warte: !x?.fertig }); });
          return neu;
        });
        if (a.length >= anzahl && a.slice(0, anzahl).every((x) => x.fertig)) { stop(); setBusy(false); }
      } catch (e) { stop(); setBusy(false); setErr(e); }
      if (Date.now() > bis) { stop(); setBusy(false); setErr(new Error('Der Hauptchat hat noch nicht geantwortet — seine Antwort steht später auch in seinem Chat.')); }
    }, 3000);
  };

  const frage = async (t: string) => {
    setBusy(true); setErr(null);
    const q = t.trim();
    try {
      const r: any = await api('/api/nachfrage', { body: { art, id, text: q, ...(nid ? { nid } : {}) } });
      setNid(r.nid);
      const du = zeilen.filter((z) => z.wer === 'du').length + 1;
      setZeilen((alt) => [...alt, { wer: 'du', text: q || 'Was ist das? (Erklär mir die Entscheidung in Klartext)' }, { wer: 'hauptchat', text: null, warte: true }]);
      setText('');
      warte(r.nid, du);
    } catch (e) { setBusy(false); setErr(e); }
  };
  const aufmachen = () => { if (offen) { setOffen(false); return; } setOffen(true); if (!zeilen.length) void frage(''); };

  return (
    <span className="nf" data-testid="nf">
      <button type="button" className="ub-btn sm nf-knopf" aria-expanded={offen} onClick={aufmachen} data-testid="nf-knopf" title="Frag den Hauptchat: er erklärt die Entscheidung in Klartext — mit Kontext, ohne dass du ihn suchen musst">{kompakt ? '❔ Was ist das?' : 'Was ist das?'}</button>
      {offen && (
        <div className="nf-panel" role="region" aria-label="Nachfrage an den Hauptchat" data-testid="nf-panel">
          {zeilen.map((z, i) => (
            <div key={i} className={`nf-zeile ${z.wer}`} data-testid={`nf-${z.wer}`}>
              <b>{z.wer === 'du' ? 'Du' : 'Hauptchat'}</b>
              <div className="nf-text">{z.text ? rein(z.text) : <span className="mut">{z.wer === 'du' ? '' : 'schaut nach … (liest Bericht und Stand, dauert meist eine Minute)'}</span>}</div>
            </div>
          ))}
          <div className="nf-schnell">{SCHNELL.map((s) => <button key={s} type="button" className="ub-btn ghost sm" disabled={busy} onClick={() => frage(s)}>{s}</button>)}</div>
          <div className="ub-row">
            <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Frag nach — Enter sendet" aria-label="Frage an den Hauptchat" data-testid="nf-text"
              onKeyDown={(ev) => { if (ev.key === 'Enter' && !ev.shiftKey && !ev.nativeEvent.isComposing && text.trim() && !busy) { ev.preventDefault(); void frage(text); } }} />
            <button type="button" className="ub-btn pri sm" disabled={busy || !text.trim()} onClick={() => frage(text)} data-testid="nf-senden">Fragen</button>
          </div>
          <Err e={err} />
          {aktionen.length > 0 && zeilen.some((z) => z.wer === 'hauptchat' && z.text) && <div className="nf-schnell" data-testid="nf-entscheiden" role="group" aria-label="So entscheiden">
            {aktionen.map((a) => <button key={a.label} type="button" className={`ub-btn sm${a.pri ? ' pri' : ''}`} onClick={a.onClick}>{a.label}</button>)}</div>}
          <p className="tiny mut">Der Hauptchat erklärt und empfiehlt — entscheiden tust du mit den Knöpfen (hier oder an der Karte); die Antwort geht wie jede andere an den Unter-Chat.</p>
        </div>
      )}
    </span>
  );
}
