// Chat-Bereich (Knut 06.11.: „Die Chats sollen bei Hauptchat / Neuer Chat / Unterchat sein, und da soll wirklich der normale
// Chatverlauf sein und die Möglichkeit, den Unterchat zu steuern.“): Die Unter-Chat-Seite ist ein Chat — Kopfzeile mit Zustand,
// Wartegrund und Steuerknöpfen, voller Verlauf (Werkzeug-Schritte einklappbar, Live-Aktualisierung), Chatleiste mit Vorlagen und
// Anhang, offene Rückfragen mit ihren Knöpfen, Abnehmen am Ende. Der Steckbrief ist ausklappbar. Wege wie in der alten Werkbank.
import { useEffect, useRef, useState } from 'react';
import { schicke, type Karte, type Link } from './api.ts';
import { useApp } from './kontext.ts';
import { EntscheidungKarte, Fehler, Laedt, Md, useDaten, Verweise } from './teile.tsx';
import { Abgleich, SteckbriefKasten, type Steckbrief } from './seiten.tsx';
import { verlaufTeile, wann } from './format.ts';

interface Steuer { laeuft: boolean; schlange: { pos: number; grund: string } | null; gedeckelt: string | null; abgenommen: boolean; weggeraeumt: boolean; ohneBericht: boolean; modell: string | null; laeufer: string }
interface Daten {
  titel: string; satz: string; gruppe: string; zuletzt: string | null; stand: string; fragen: Karte[]; links: Link[];
  nachrichten: { id: string; rolle: 'ich' | 'assistent'; text: string; at: string; status?: string }[];
  abgleich?: any; steckbrief?: Steckbrief; steuer?: Steuer;
}

const VORLAGEN: [string, string][] = [
  ['Weiter', 'weiter'],
  ['Stand bitte', 'Bitte gib mir jetzt einen kurzen Stand: was fertig ist, was offen ist, was du von mir brauchst.'],
  ['Bericht schreiben', 'Bitte schreib den Bericht (Abschnitte wie im Auftrag) und melde dich mit „### Stand“ und „Status: fertig“.'],
  ['Tests laufen lassen', 'Bitte lass die Tests und Prüfungen des Repos laufen und nenne das Ergebnis.'],
];

export function UnterChat({ id }: { id: string }) {
  const app = useApp();
  const { d, fehler, neu } = useDaten<Daten>(`api/v2/arbeit/${id}`);
  const [text, setText] = useState('');
  const [laeuft, setLaeuft] = useState<string | null>(null);   // welche Aktion gerade läuft (kein Doppelklick)
  const [meldung, setMeldung] = useState<string | null>(null);
  const datei = useRef<HTMLInputElement>(null);
  const anzahl = d?.nachrichten.length ?? 0;
  const arbeitet = !!d?.steuer?.laeuft || !!d?.steuer?.schlange || d?.nachrichten.at(-1)?.status === 'laeuft';
  // Live-Aktualisierung: während der Unter-Chat arbeitet alle 3 s, sonst alle 20 s.
  useEffect(() => { const t = setInterval(neu, arbeitet ? 3000 : 20000); return () => clearInterval(t); }, [arbeitet, neu]);
  // Ans Seitenende statt an die letzte Nachricht: die feste Leiste liegt sonst über der neuesten Nachricht (Abnahme 06.11.).
  useEffect(() => { if (anzahl) document.scrollingElement?.scrollTo({ top: document.scrollingElement.scrollHeight }); }, [anzahl]);
  if (fehler && !d) return <Fehler text={fehler} nochmal={neu} />;   // ein Aussetzer beim Neuladen ersetzt nicht den Chat (und den angefangenen Text)
  if (!d) return <Laedt />;
  const s = d.steuer;

  const tu = async (name: string, fn: () => Promise<unknown>, gut: string) => {
    if (laeuft) return;
    setLaeuft(name); setMeldung(null);
    try { const r: any = await fn(); setMeldung(r?.hinweis ?? (r?.zustellung ? `${gut} — ${r.zustellung}` : gut)); neu(); }
    catch (e: any) { setMeldung(String(e?.message ?? e)); } finally { setLaeuft(null); }
  };
  const steuern = (aktion: string, gut: string) => tu(aktion, () => schicke(`api/v2/arbeit/${id}/steuern`, { aktion }), gut);
  const senden = (t = text) => { const v = t.trim(); if (!v) return; void tu('senden', async () => { const r = await schicke(`api/v2/arbeit/${id}/nachricht`, { text: v }); setText(''); return r; }, arbeitet ? 'Nachgereicht — er sieht es beim nächsten Schritt (oder bekommt es nach dem Zug).' : 'Gesendet.'); };
  const anhaengen = async (f: File | undefined) => {
    if (!f) return;
    if (laeuft) { setMeldung('Einen Moment — die vorige Aktion läuft noch. Datei bitte gleich noch einmal wählen.'); if (datei.current) datei.current.value = ''; return; }
    if (f.size > 8 * 1024 * 1024) { setMeldung('Höchstens 8 MB je Anhang — größere Dateien unter „Meine Dateien“.'); return; }
    await tu('anhang', async () => {
      const inhalt = await new Promise<string>((ok, nein) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => nein(new Error(`„${f.name}“ ließ sich nicht lesen.`)); r.readAsDataURL(f); });
      const r = await schicke(`api/v2/arbeit/${id}/anhang`, { name: f.name, inhalt, text: text.trim() }); setText(''); return r; }, `„${f.name}“ angehängt und geschickt.`);
    if (datei.current) datei.current.value = '';
  };
  const abnehmen = (art: 'passt' | 'aendern' | 'spaeter', o: { trotzdem?: boolean; notiz?: string } = {}) =>
    tu(art, () => schicke(`api/v2/ansehen/${id}`, { art, notiz: o.notiz ?? text.trim(), ...(o.trotzdem ? { ohneBericht: true } : {}) }), art === 'passt' ? 'Abgenommen.' : art === 'aendern' ? 'Geht an den Unter-Chat.' : 'Für 24 h ausgeblendet.');

  // als Funktion, nicht als Komponente: sonst baut jedes Neuladen (alle 3 s) die Knöpfe neu auf und der Fokus springt weg
  const knopf = ({ aktion, label, haupt, gut }: { aktion: string; label: string; haupt?: boolean; gut: string }) => (
    <button key={aktion} type="button" className={`knopf klein${haupt ? ' haupt' : ''}`} disabled={!!laeuft} onClick={() => void steuern(aktion, gut)}>{laeuft === aktion ? '…' : label}</button>
  );
  return (
    <div className="seite unterchat">
      <p className="zurueck"><a href="v2/arbeit">← Arbeit</a></p>
      <header className="uc-kopf">
        <h1>{d.titel}</h1>
        <p className={`zustand ${d.gruppe}`}>{s?.laeuft && <span className="live" aria-label="läuft">● </span>}{d.satz}</p>
        <p className="klein gedimmt">
          {s?.schlange ? <>In der Schlange (Platz {s.schlange.pos}{s.schlange.grund ? ` — ${s.schlange.grund}` : ''}) · </> : null}
          {s?.gedeckelt ? <>Angehalten: {s.gedeckelt} · </> : null}
          Läufer: {s?.laeufer === 'jcode' ? 'jcode (Melious)' : 'Claude'}{s?.modell ? ` · Modell ${s.modell.replace(/^Claude /, '')}` : ''}{d.zuletzt ? ` · zuletzt ${wann(d.zuletzt)}` : ''}
        </p>
        <div className="knoepfe uc-steuer" aria-busy={!!laeuft}>
          {s?.weggeraeumt && knopf({ aktion: 'zurueckholen', label: 'Zurückholen', haupt: true, gut: 'Zurückgeholt.' })}
          {(s?.laeuft || s?.schlange) && knopf({ aktion: 'abbrechen', label: 'Zug abbrechen', gut: 'Wird beendet.' })}
          {s?.gedeckelt && !s.laeuft && knopf({ aktion: 'fortsetzen', label: 'Fortsetzen', haupt: true, gut: 'Fortgesetzt.' })}
          {!s?.laeuft && !s?.gedeckelt && knopf({ aktion: 'weiter', label: 'Weiter', gut: '„weiter“ geschickt.' })}
          {!s?.laeuft && knopf({ aktion: 'gruendlich', label: 'Gründlich', gut: 'Geht gründlicher weiter.' })}
          {!s?.abgenommen && knopf({ aktion: 'anhalten', label: 'Anhalten', gut: 'Angehalten.' })}
        </div>
        {d.steckbrief && <details className="uc-steckbrief"><summary>Steckbrief: wofür, Fortschritt, Ergebnisse</summary><SteckbriefKasten s={d.steckbrief} titel={d.titel} id={id} /></details>}
        {d.links.length > 0 && <Verweise links={d.links.filter((l) => !l.extern)} />}
      </header>

      <section className="uc-verlauf" aria-label="Verlauf" aria-live="polite">
        {d.nachrichten.length === 0 && <p className="leer">Noch keine Nachrichten.</p>}
        {d.nachrichten.map((n) => (
          <div key={n.id} className={`blase ${n.rolle}`}>
            <p className="klein gedimmt">{n.rolle === 'ich' ? 'Du / Auftrag' : 'Agent'} · {wann(n.at)}</p>
            {n.rolle === 'assistent' && !n.text && n.status === 'laeuft' ? <p className="gedimmt">schreibt …</p>
              : n.rolle === 'ich' ? <Md text={n.text} klein />
                : verlaufTeile(n.text).map((t, i) => t.art === 'text'
                  ? <Md key={i} text={t.text} klein />
                  : <details key={i} className="uc-schritte"><summary>{t.zeilen.length === 1 ? '1 Werkzeug-Schritt' : `${t.zeilen.length} Werkzeug-Schritte`}{n.status === 'laeuft' ? ` — ${t.zeilen.at(-1)}` : ''}</summary><ul>{t.zeilen.map((z, j) => <li key={j} className="klein">{z}</li>)}</ul></details>)}
          </div>
        ))}
        {arbeitet && <p className="klein gedimmt">Der Agent arbeitet … (aktualisiert sich von selbst)</p>}
      </section>

      {d.abgleich && d.abgleich.offenListe?.length > 0 && <Abgleich a={d.abgleich} />}
      {d.fragen.length > 0 && <div className="karten uc-fragen">{d.fragen.map((k) => <EntscheidungKarte key={k.id} k={k} beantwortet={() => { app.zahl(null); neu(); }} />)}</div>}

      <form className="chat-eingabe uc-leiste" onSubmit={(e) => { e.preventDefault(); senden(); }}>
        <div className="uc-vorlagen" role="group" aria-label="Vorlagen">{VORLAGEN.map(([l, t]) => <button key={l} type="button" className="knopf leise klein" disabled={!!laeuft} onClick={() => (l === 'Weiter' ? void steuern('weiter', '„weiter“ geschickt.') : setText(t))}>{l}</button>)}</div>
        <label htmlFor="uc-text" className="unsichtbar">Nachricht an den Unter-Chat</label>
        <textarea id="uc-text" rows={3} value={text} maxLength={8000} placeholder={arbeitet ? 'Er arbeitet gerade — deine Nachricht wird nachgereicht.' : 'Nachricht an den Unter-Chat …'} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); senden(); } }} />
        <div className="knoepfe">
          <button type="submit" className="knopf haupt" disabled={!!laeuft || !text.trim()}>{laeuft === 'senden' ? 'Sendet …' : 'Senden'}</button>
          <label className="knopf leise">{laeuft === 'anhang' ? 'Lädt …' : 'Datei anhängen'}<input ref={datei} type="file" className="unsichtbar" disabled={!!laeuft} onChange={(e) => void anhaengen(e.target.files?.[0])} /></label>
        </div>
        {meldung && <p className="hinweis klein" role="status">{meldung}</p>}
      </form>

      {d.gruppe === 'fertig' && !s?.abgenommen && (
        <div className="kasten uc-abnehmen">
          <p className="klein"><b>Abnehmen:</b> {s?.ohneBericht ? 'fertig gemeldet, aber ohne Bericht.' : 'der Unter-Chat meldet „fertig“.'} Eine Notiz aus dem Feld oben geht mit.</p>
          <div className="knoepfe">
            {s?.ohneBericht
              ? <><button type="button" className="knopf haupt" disabled={!!laeuft} onClick={() => void abnehmen('aendern', { notiz: `${text.trim() ? `${text.trim()}\n\n` : ''}${VORLAGEN[2][1]}` })}>Bericht anfordern</button>
                <button type="button" className="knopf leise" disabled={!!laeuft} onClick={() => void abnehmen('passt', { trotzdem: true })}>Trotzdem abnehmen</button></>
              : <><button type="button" className="knopf haupt" disabled={!!laeuft} onClick={() => void abnehmen('passt')}>Passt</button>
                <button type="button" className="knopf" disabled={!!laeuft || !text.trim()} onClick={() => void abnehmen('aendern')}>Ändern</button></>}
            <button type="button" className="knopf leise" disabled={!!laeuft} onClick={() => void abnehmen('spaeter')}>Später</button>
          </div>
        </div>
      )}
    </div>
  );
}
