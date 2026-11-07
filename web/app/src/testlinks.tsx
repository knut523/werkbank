// Test-Links (Knut 06./07.11.: „always give me a magic logged in link, this is a test env“; docs/plan-testlinks.md): je Worktree eine
// Test-Umgebung mit angemeldetem Link — Seite „Test-Umgebungen“ (Liste mit Link, Stand, Ablauf, Stoppen; Start für einen Ordner) und
// der Knopf „Test-Link“ auf der Unter-Chat-Seite. Der Server baut, startet, prüft (mit Sitzung 200, ohne 401/30x) und räumt auf.
import { useEffect, useState } from 'react';
import { schicke } from './api.ts';
import { Fehler, Laedt, useDaten } from './teile.tsx';
import { wann } from './format.ts';

export interface TestUmgebung {
  id: string; profil: 'olaf-admin' | 'olaf-tariff-app' | 'werkbank' | 'statisch'; ordner: string; titel: string; strang: string | null;
  zweig: string | null; commit: string | null; dirty: boolean; link: string; lokal: string; status: 'startet' | 'laeuft' | 'fehler' | 'gestoppt' | 'abgelaufen' | 'beendet';
  schritt: string; fehler: string | null; logAuszug: string | null; gestartet: string; ablauf: string; geendet: string | null; geleert: string[];
  gesund: { mit: number; ohne: number | null } | null; laeuftNoch: boolean; neuerCommit: string | null; abgelaufen: boolean;
}
interface Liste { umgebungen: TestUmgebung[]; nurAdmin?: boolean; tage?: number; konto?: string }

const PROFIL: Record<TestUmgebung['profil'], string> = { 'olaf-admin': 'olaf-admin', 'olaf-tariff-app': 'Tarif-App', werkbank: 'Workspace-Testkopie', statisch: 'Statische Seite' };
const ZUSTAND: Record<TestUmgebung['status'], string> = { startet: 'startet', laeuft: 'läuft', fehler: 'Fehler', gestoppt: 'gestoppt', abgelaufen: 'abgelaufen (7 Tage)', beendet: 'beendet' };
const stand = (u: TestUmgebung) => (u.commit ? ` · Stand ${u.commit}${u.zweig ? ` auf ${u.zweig}` : ''}${u.dirty ? ' (mit ungesicherten Änderungen)' : ''}` : '');

/** Eine Umgebung: Link (angemeldet), Stand, Ablauf, Stoppen / neu starten; bei Fehler Grund und Logauszug. */
function Umgebung({ u, neu, knapp }: { u: TestUmgebung; neu: () => void; knapp?: boolean }) {
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);
  const tu = async (name: string, fn: () => Promise<unknown>) => {
    if (laeuft) return;
    setLaeuft(name); setMeldung(null);
    try { await fn(); neu(); } catch (e: any) { setMeldung(String(e?.message ?? e)); } finally { setLaeuft(null); }
  };
  const aktiv = u.status === 'laeuft' || u.status === 'startet';
  return (
    <div className="kasten testlink">
      {!knapp && <p><b>{u.titel || u.ordner}</b> <span className="klein gedimmt">· {PROFIL[u.profil]}</span></p>}
      <p className={`klein ${u.status === 'fehler' ? 'hinweis-warn' : 'gedimmt'}`} role="status">
        {u.status === 'startet' ? <>Startet … ({u.schritt})</> : <>Zustand: {ZUSTAND[u.status]}</>}
        {stand(u)}{u.neuerCommit && aktiv ? <> · <b>neuer Stand {u.neuerCommit}</b> — neu starten, um ihn zu sehen</> : null}
      </p>
      {u.status === 'laeuft' && (
        <p className="knoepfe tl-oeffnen">
          <a className="knopf haupt" href={u.link} target="_blank" rel="noreferrer">Öffnen (angemeldet) ↗</a>
          <span className="klein gedimmt">läuft bis {wann(u.ablauf)}</span>
        </p>
      )}
      {u.status === 'laeuft' && !knapp && <p className="klein gedimmt">Link: <code>{u.link}</code></p>}
      {u.status === 'fehler' && <>
        <p className="klein">{u.fehler}</p>
        {u.logAuszug && <details><summary className="klein">Logauszug</summary><pre className="klein">{u.logAuszug}</pre></details>}
      </>}
      {u.geleert.length > 0 && aktiv && !knapp && <p className="klein gedimmt">Nicht übernommen (keine lokale Adresse): {u.geleert.join(', ')}</p>}
      <div className="knoepfe">
        {aktiv && <button type="button" className="knopf klein" disabled={!!laeuft} onClick={() => void tu('stop', () => schicke(`api/v2/testlinks/${u.id}/stoppen`, {}))}>{laeuft === 'stop' ? '…' : 'Stoppen'}</button>}
        {u.status !== 'startet' && <button type="button" className="knopf leise klein" disabled={!!laeuft} onClick={() => void tu('neu', () => schicke('api/v2/testlinks', { ordner: u.ordner, neu: true, ...(u.strang ? { strang: u.strang } : {}) }))}>{laeuft === 'neu' ? '…' : 'Neu starten'}</button>}
      </div>
      {meldung && <p className="hinweis klein" role="status">{meldung}</p>}
    </div>
  );
}

/** Nachladen: während etwas startet alle 3 s, sonst alle 30 s (die nächste Abfrage erst nach der Antwort). */
function useNachladen(d: Liste | null, fehler: string | null, neu: () => void) {
  const startet = !!d?.umgebungen.some((u) => u.status === 'startet');
  useEffect(() => { const t = setTimeout(neu, startet && !document.hidden ? 3000 : 30000); return () => clearTimeout(t); }, [d, fehler, startet, neu]);
}

export function TestUmgebungen() {
  const { d, fehler, neu } = useDaten<Liste>('api/v2/testlinks');
  const [ordner, setOrdner] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ text: string; id?: string } | null>(null);
  useNachladen(d, fehler, neu);
  // Die Startmeldung gilt nur, solange die gestartete Umgebung noch startet.
  useEffect(() => { if (meldung?.id && d?.umgebungen.some((u) => u.id === meldung.id && u.status !== 'startet')) setMeldung(null); }, [d, meldung]);
  if (fehler && !d) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  if (d.nurAdmin) return <div className="seite"><h1>Test-Umgebungen</h1><p className="leer">Test-Umgebungen startet, wer die Unter-Chats führt.</p></div>;
  const starten = async () => {
    const o = ordner.trim();
    if (!o || laeuft) return;
    setLaeuft(true); setMeldung(null);
    try { const r: any = await schicke('api/v2/testlinks', { ordner: o }); setMeldung(r?.schon ? { text: 'Läuft schon für diesen Stand.' } : { text: 'Startet — der Link erscheint unten, sobald die Prüfung durch ist.', id: r?.umgebung?.id }); setOrdner(''); neu(); }
    catch (e: any) { setMeldung({ text: String(e?.message ?? e) }); } finally { setLaeuft(false); }
  };
  const aktiv = d.umgebungen.filter((u) => u.status === 'laeuft' || u.status === 'startet');
  const rest = d.umgebungen.filter((u) => !(u.status === 'laeuft' || u.status === 'startet'));
  return (
    <div className="seite">
      <h1>Test-Umgebungen</h1>
      <p className="klein gedimmt">Je Worktree eine Test-Umgebung mit eigener Test-Datenbank, Mails im Trockenlauf und einem Link, mit dem du sofort angemeldet bist (als {d.konto ?? 'Testkonto'}). Nur über die Coder-Vorschau, {d.tage ?? 7} Tage gültig.</p>
      <form className="suche" onSubmit={(e) => { e.preventDefault(); void starten(); }}>
        <label htmlFor="tl-ordner" className="unsichtbar">Ordner des Worktrees</label>
        <input id="tl-ordner" type="text" value={ordner} onChange={(e) => setOrdner(e.target.value)} placeholder="Ordner, z. B. /home/knut/work/knut/olaf-admin-bot-vorschau" />
        <button type="submit" className="knopf haupt" disabled={laeuft || !ordner.trim()}>{laeuft ? 'Startet …' : 'Test-Link starten'}</button>
      </form>
      {meldung && <p className="hinweis klein" role="status">{meldung.text}</p>}
      {aktiv.length ? aktiv.map((u) => <Umgebung key={u.id} u={u} neu={neu} />) : <p className="leer">Gerade läuft keine Test-Umgebung.</p>}
      {rest.length > 0 && <>
        <p className="gruppe-titel">Beendet (letzte 24 h)</p>
        {rest.map((u) => <Umgebung key={u.id} u={u} neu={neu} />)}
      </>}
    </div>
  );
}

/** Auf der Unter-Chat-Seite: Knopf „Test-Link“ (startet für den Arbeitsordner) bzw. die laufende Umgebung mit Link. */
export function TestLinkKnopf({ strang }: { strang: string }) {
  const { d, fehler, neu } = useDaten<Liste>(`api/v2/testlinks?strang=${strang}`);
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<string | null>(null);
  useNachladen(d, fehler, neu);
  if (!d || d.nurAdmin) return null;
  const u = d.umgebungen.find((x) => x.status === 'laeuft' || x.status === 'startet') ?? d.umgebungen.find((x) => x.status === 'fehler');
  const starten = async () => {
    if (laeuft) return;
    setLaeuft(true); setMeldung(null);
    try { await schicke('api/v2/testlinks', { strang }); neu(); } catch (e: any) { setMeldung(String(e?.message ?? e)); } finally { setLaeuft(false); }
  };
  return (
    <div className="uc-testlink">
      {u ? <Umgebung u={u} neu={neu} knapp /> : <button type="button" className="knopf klein" disabled={laeuft} onClick={() => void starten()}>{laeuft ? 'Startet …' : 'Test-Link (angemeldet)'}</button>}
      {meldung && <p className="hinweis klein" role="status">{meldung}</p>}
    </div>
  );
}
