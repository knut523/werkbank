// Offene Entscheidungen aus dem Bericht eines Unter-Chats (Plan 157, Ergänzung B): je Block `**D1 — …**` mit
// `- Empfehlung: …` die Wahl „Empfehlung akzeptieren“ / eigene Antwort / „nachprüfen“. Gilt auf der Berichtsseite und in
// der Review-Ansicht. Der Server trägt die Antworten in den Bericht ein („- Knut: …“); nur Abweichungen lassen den
// Unter-Chat weiterarbeiten, sind alle akzeptiert, geht „fertig“ an den Hauptchat.
import { useState } from 'react';
import { api } from './api.ts';

type Wahl = { art: 'akzeptiert' | 'eigene' | 'nachpruefen'; text: string };

export function Entscheidungen({ id, liste, berichtHash, running, onDone }: { id: string; liste: any[]; berichtHash: string; running: boolean; onDone: () => void }) {
  const [w, setW] = useState<Record<string, Wahl>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const offen = liste.filter((e) => !e.knut);
  const gewaehlt = Object.entries(w).filter(([, v]) => v.art === 'akzeptiert' || v.art === 'nachpruefen' || v.text.trim());
  const set = (eid: string, v: Partial<Wahl>) => setW({ ...w, [eid]: { art: 'eigene', text: '', ...w[eid], ...v } });
  const senden = async () => {
    setBusy(true); setMsg(null);
    try {
      const r: any = await api(`/api/review/${id}/entscheidungen`, { body: { berichtHash, antworten: gewaehlt.map(([k, v]) => ({ id: k, art: v.art, text: v.text })) } });
      setMsg({ ok: true, text: r.weiter ? 'Im Bericht eingetragen — der Unter-Chat arbeitet die Abweichungen ab.' : r.offen ? `Im Bericht eingetragen — noch ${r.offen} offen.` : 'Alle Entscheidungen beantwortet — fertig, der Hauptchat ist informiert.' });
      setW({}); onDone();
    } catch (e: any) { setMsg({ ok: false, text: String(e?.message ?? e) }); } finally { setBusy(false); }
  };
  return (
    <div data-testid="entscheidungen">
      <h3>Entscheidungen {offen.length > 0 ? <span className="chip warn">{offen.length} offen</span> : liste.length > 0 && <span className="chip ok">alle beantwortet</span>}</h3>
      {liste.length === 0 ? <p className="small muted">Keine Entscheidungsblöcke (**D1 — …** mit „- Empfehlung: …“) im Bericht.</p> : <>
        {liste.map((e) => {
          const v = w[e.id];
          return (
            <div key={e.id} className="review-entscheidung" data-testid="entscheidung" style={{ marginBottom: 8 }}>
              <p className="small" style={{ marginBottom: 2 }}><b>{e.id}</b> — {e.titel} {e.knut && <span className="chip ok">Knut: {e.knut}</span>}</p>
              {e.empfehlung && <p className="small" style={{ margin: '0 0 4px' }}>Empfehlung: <i>{e.empfehlung}</i></p>}
              <details><summary className="tiny">Optionen (vom Unter-Chat, als Text)</summary><pre className="small" style={{ whiteSpace: 'pre-wrap' }}>{e.text}</pre></details>
              {!e.knut && <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <button className={`btn small ${v?.art === 'akzeptiert' ? 'primary' : ''}`} disabled={!e.empfehlung} onClick={() => set(e.id, { art: v?.art === 'akzeptiert' ? 'eigene' : 'akzeptiert' })} data-testid={`akzeptieren-${e.id}`}>Empfehlung akzeptieren</button>
                <button className={`btn small ${v?.art === 'nachpruefen' ? 'primary' : ''}`} onClick={() => set(e.id, { art: v?.art === 'nachpruefen' ? 'eigene' : 'nachpruefen' })} data-testid={`nachpruefen-${e.id}`}>nachprüfen</button>
                <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder={v?.art === 'nachpruefen' ? 'Was nachprüfen? (optional)' : 'oder eigene Antwort'} disabled={v?.art === 'akzeptiert'}
                  value={v?.text ?? ''} onChange={(ev) => set(e.id, { text: ev.target.value, art: v?.art === 'nachpruefen' ? 'nachpruefen' : 'eigene' })} data-testid={`antwort-${e.id}`} />
              </div>}
            </div>);
        })}
        {offen.length > 0 && <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn small primary" disabled={busy || running || !gewaehlt.length} onClick={senden} data-testid="antworten-senden">Antworten eintragen ({gewaehlt.length})</button>
          {offen.some((e) => e.empfehlung) && <button className="btn small ghost" disabled={busy || running} onClick={() => setW(Object.fromEntries(offen.filter((e) => e.empfehlung).map((e) => [e.id, { art: 'akzeptiert', text: '' }])))} data-testid="alle-akzeptieren">Alle Empfehlungen wählen</button>}
          {running && <span className="tiny muted">Der Unter-Chat arbeitet gerade — Antworten gehen, sobald er fertig ist.</span>}
        </div>}
      </>}
      {msg && <p className={`small ${msg.ok ? '' : 'err'}`} role="status" data-testid="entscheidungen-msg">{msg.text}</p>}
    </div>
  );
}
