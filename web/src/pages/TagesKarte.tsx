// Tagesvorschlag / Mein Tag als Karte in der Übersicht (R32, Befund 7, Knut-Entscheidung D2 nach Empfehlung): sagt in zwei Zeilen, was heute
// geplant ist bzw. was die Werkbank vorschlägt, und führt auf die Seite „Mein Tag“. Schreibt nichts — Übernehmen passiert dort.
import { api } from '../api.ts';
import { useLoad } from '../ui.tsx';

const iso = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Vienna' }).format(d);

export function TagesKarte() {
  const heute = iso(new Date());
  const t = useLoad<any>(() => api(`/api/timebox?from=${heute}&days=1&day=${heute}`), [heute]);
  const d = t.data;
  if (!d) return <div className="ub-card soft ub-tag ub-skel" data-testid="ub-tag-lade" aria-busy="true"><span className="tiny mut">Mein Tag lädt …</span></div>;
  const bloecke: any[] = (d.blocks ?? []).filter((b: any) => b.date === heute && b.state !== 'verschoben');
  const offen = bloecke.filter((b) => !b.done && b.state !== 'erledigt');
  const v = d.vorschlag;
  const vorschlag: any[] = v?.bloecke ?? [];
  return (
    <section className="ub-card soft ub-tag" data-testid="ub-tag" aria-label="Mein Tag">
      <div className="ub-row"><h2>Mein Tag</h2><span className="sp" /><a className="ub-btn sm" href="#/timebox" data-testid="ub-tag-link">{bloecke.length ? 'Tag ansehen' : vorschlag.length ? 'Vorschlag ansehen' : 'Tag planen'}</a></div>
      {bloecke.length > 0
        ? <p className="small" data-testid="ub-tag-text">{bloecke.length} {bloecke.length === 1 ? 'Block' : 'Blöcke'} geplant, {offen.length} offen — als Nächstes: <b>{offen[0]?.title ?? bloecke[0].title}</b></p>
        : vorschlag.length > 0
          ? <p className="small" data-testid="ub-tag-text">Nichts geplant. <b>Tagesvorschlag:</b> {vorschlag.length} {vorschlag.length === 1 ? 'Block' : 'Blöcke'} — {vorschlag.slice(0, 3).map((b) => b.title).join(' · ')}{vorschlag.length > 3 ? ' …' : ''}</p>
          : <p className="small mut" data-testid="ub-tag-text">Für heute ist nichts geplant{v?.hinweis ? ' — „Tag planen“ legt einen Vorschlag aus deinem Stand an.' : '.'}</p>}
    </section>
  );
}
