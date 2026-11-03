// „Fang hier an“ oben in der Übersicht (R32, Nachtrag B): höchstens 5 Entscheidungen nach Wirkung, je mit Empfehlung und Ein-Klick „wie
// empfohlen“ + „Anders …“ (Text, Enter sendet) + „Was ist das?“. Die Zahl ist dieselbe wie überall (Server: brauchtSumme); der Rest steht auf der
// Entscheidungsseite. Nach einer Antwort füllt sich die Liste nach wenigen Sekunden wieder auf.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { Err, useLoad } from '../ui.tsx';
import { FangKarte, type Frage } from './Entscheidungen.tsx';

type Daten = { fang?: { id: string; grund: string }[]; fragen: Frage[]; summe?: { gesamt: number; text: string }; zahl: number };

export function FangHierAn({ onChange }: { onChange?: () => void }) {
  const d = useLoad<Daten>(() => api('/api/entscheidungen/fragen'), []);
  const [nachlade, setNachlade] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  const data = d.data;
  if (d.error) return <section className="ub-card soft fang-hier" data-testid="fang-hier-an"><Err e={d.error} /></section>;
  if (!data) return <section className="ub-card fang-hier fang-lade" data-testid="fang-platzhalter" aria-busy="true" aria-label="Fang hier an lädt"><div className="ub-row"><h2>Fang hier an</h2><span className="tiny mut">lädt …</span></div><div className="cos-skel" /><div className="cos-skel" /></section>;
  const liste = (data.fang ?? []).map((x) => ({ f: data.fragen.find((y) => y.id === x.id)!, grund: x.grund })).filter((x) => x.f);
  const gesamt = data.summe?.gesamt ?? data.zahl;
  // Nach einer Antwort 3,5 s die Bestätigung stehen lassen, dann neu laden — es rückt die nächste Entscheidung nach.
  const erledigt = (_id: string, status: string) => { if (!status) { d.reload(); return; } onChange?.(); if (t.current) clearTimeout(t.current); setNachlade(true); t.current = setTimeout(() => { d.reload(); setNachlade(false); }, 3500); };
  return (
    <section className="ub-card fang-hier" data-testid="fang-hier-an" aria-label="Fang hier an">
      <div className="ub-row"><h2>Fang hier an</h2><span className="chip warn" data-testid="fang-zahl">{liste.length}</span><span className="sp" />
        <a className="ub-btn sm" href="#/entscheidungen" data-testid="fang-alle" title={data.summe?.text ?? ''}>alle {gesamt} Entscheidungen →</a></div>
      {data.summe && gesamt > 0 && <p className="tiny mut" data-testid="fang-summe">{data.summe.text}{nachlade ? ' · nächste Entscheidung rückt nach …' : ''}</p>}
      {liste.length ? liste.map(({ f, grund }) => <FangKarte key={f.id} f={f} grund={grund} onDone={erledigt} />) : <p className="small">{gesamt > 0 ? 'Nichts Dringendes — der Rest steht auf der Entscheidungsseite, nach Thema.' : 'Nichts wartet auf dich.'}</p>}
    </section>
  );
}
