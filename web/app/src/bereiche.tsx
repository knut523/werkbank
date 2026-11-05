// Audit 05.11. (8) (Knut 05.11. abends, 3): Bereiche der alten Werkbank in der 2.0 — schlank, auf den bestehenden Routen der alten
// Werkbank (gleicher Server, gleiche Freigaben). Lesen hier; geschrieben wird nur, was lokal und harmlos ist (Mein Tag: erledigt,
// auf morgen; Dateien: hochladen). Jira schreiben, Zugangsdaten und Konten bleiben in der alten Werkbank (Link je Seite).
import { useState } from 'react';
import { schicke } from './api.ts';
import { useApp } from './kontext.ts';
import { Abschnitt, Fehler, Laedt, useDaten } from './teile.tsx';
import { mehrzahl, wann } from './format.ts';

/** Zeile ohne Link (Stand, Liste) — Zeile aus teile.tsx verlangt eine Adresse. */
function Info({ titel, satz, marke }: { titel: string; satz?: string; marke?: { text: string; ton?: string } }) {
  return <li className="zeile"><div className="zeile-haupt"><span className="zeile-titel">{titel}</span>{satz && <p className="zeile-satz">{satz}</p>}</div>{marke && <div className="zeile-rechts"><span className={`marke ${marke.ton ?? ''}`}>{marke.text}</span></div>}</li>;
}

const heute = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' });
const uhr = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function AltLink({ seite, text }: { seite: string; text: string }) {
  const app = useApp();
  return app.alt ? <p className="abschnitt-fuss klein"><a href={`${app.alt}/${seite}`} target="_blank" rel="noopener noreferrer">{text} ↗</a></p> : null;
}

// ---------- Mein Tag ----------
interface TbBlock { id: string; title?: string; key?: string | null; date: string; start: number; dur: number; prio?: number | null; state?: string; ticket?: { key: string; summary: string; status: string } | null }
export function MeinTag() {
  const [tag, setTag] = useState(heute());
  const { d, fehler, neu } = useDaten<{ blocks: TbBlock[]; tickets: { key: string; summary: string; status: string; duedate: string | null; overdue: boolean }[]; sprint: { label: string | null } | null; summary: Record<string, any> }>(`api/timebox?from=${tag}&days=1`);
  const [meldung, setMeldung] = useState<string | null>(null);
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  const bl = d.blocks.filter((b) => b.date === tag).sort((a, b) => a.start - b.start);
  const erledigt = async (b: TbBlock) => {
    try { await fetch(`api/timebox/${encodeURIComponent(b.id)}`, { method: 'PATCH', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-werkbank': '1' }, body: JSON.stringify({ state: b.state === 'erledigt' ? 'geplant' : 'erledigt' }) }).then((r) => { if (!r.ok) throw new Error(`Fehler ${r.status}`); }); neu(); }
    catch (e: any) { setMeldung(String(e?.message ?? e)); }
  };
  const aufMorgen = async () => {
    try { await schicke('api/timebox/carry', { date: tag }); setMeldung('Offene Blöcke liegen jetzt auf morgen.'); neu(); } catch (e: any) { setMeldung(String(e?.message ?? e)); }
  };
  return (
    <div className="seite">
      <h1>Mein Tag</h1>
      <p className="klein"><label>Tag <input type="date" value={tag} onChange={(e) => e.target.value && setTag(e.target.value)} /></label>{d.sprint?.label ? ` · ${d.sprint.label}` : ''}</p>
      <Abschnitt id="t-bloecke" titel={`Zeitblöcke (${bl.length})`} erklaerung="Dein Plan für den Tag. Abhaken geht hier; Blöcke anlegen und verschieben in der alten Werkbank.">
        {bl.length ? <ul className="liste">{bl.map((b) => (
          <li key={b.id} className="zeile">
            <label><input type="checkbox" checked={b.state === 'erledigt'} onChange={() => void erledigt(b)} /> <b>{uhr(b.start)}–{uhr(b.start + b.dur)}</b> {b.ticket ? `${b.ticket.key} · ${b.ticket.summary}` : b.title ?? '—'}</label>
          </li>))}</ul> : <p className="leer">Für diesen Tag ist nichts geplant.</p>}
        {bl.some((b) => b.state === 'geplant' || !b.state) && <p><button type="button" className="knopf leise" onClick={() => void aufMorgen()}>Offenes auf morgen</button></p>}
        {meldung && <p className="hinweis klein" role="status">{meldung}</p>}
      </Abschnitt>
      <Abschnitt id="t-tickets" titel={`Deine offenen Tickets (${d.tickets.length})`} erklaerung="Was in Jira auf dich zeigt — überfällige zuerst.">
        <ul className="liste">{[...d.tickets].sort((a, b) => Number(b.overdue) - Number(a.overdue)).slice(0, 30).map((t) => <Info key={t.key} titel={`${t.key} · ${t.summary}`} satz={`${t.status}${t.duedate ? ` · fällig ${t.duedate}` : ''}`} marke={t.overdue ? { text: 'überfällig', ton: 'warn' } : undefined} />)}</ul>
      </Abschnitt>
      <AltLink seite="timebox" text="Blöcke planen in der alten Werkbank" />
    </div>
  );
}

// ---------- Jira-Board (nur lesend) ----------
interface Karte { key: string; summary: string; status: string; assignee?: string | null; duedate?: string | null; overdue?: boolean; subtasks?: unknown[] }
export function Board() {
  const [wer, setWer] = useState('');
  const [q, setQ] = useState('');
  const { d, fehler, neu } = useDaten<{ statuses: string[]; lanes: { key: string; name: string; columns: Record<string, Karte[]>; count: number }[]; owners: string[]; totals: { cards: number; overdue: number }; site?: string | null; sync?: { at?: string } | null }>(`api/board?owner=${encodeURIComponent(wer)}&q=${encodeURIComponent(q)}`);
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  const jira = (k: string) => (d.site && /^https:\/\//.test(d.site) ? `${d.site.replace(/\/$/, '')}/browse/${k}` : null);
  return (
    <div className="seite">
      <h1>Jira-Board</h1>
      <p className="klein gedimmt">{mehrzahl(d.totals.cards, 'Ticket', 'Tickets')} · {d.totals.overdue} überfällig{d.sync?.at ? ` · Stand ${wann(d.sync.at)}` : ''} · nur lesend — ändern in Jira oder der alten Werkbank</p>
      <p className="klein">
        <label>Wer <select value={wer} onChange={(e) => setWer(e.target.value)}><option value="">alle</option>{d.owners.map((o) => <option key={o} value={o}>{o}</option>)}</select></label>{' '}
        <label>Suche <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Key oder Titel" /></label>
      </p>
      {d.lanes.filter((l) => l.count).map((l) => (
        <Abschnitt key={l.key} id={`b-${l.key}`} titel={`${l.name} (${l.count})`} erklaerung="Ein Workstream mit seinen Tickets, nach Status.">
          {d.statuses.filter((s) => l.columns[s]?.length).map((s) => (
            <div key={s}><p className="gruppe-titel">{s}</p>
              <ul className="liste">{l.columns[s].map((c) => {
                const u = jira(c.key);
                return <li key={c.key} className="klein">{u ? <a href={u} target="_blank" rel="noopener noreferrer">{c.key}</a> : c.key} · {c.summary}{c.assignee ? ` · ${c.assignee}` : ''}{c.duedate ? ` · fällig ${c.duedate}` : ''}{c.overdue ? <> <span className="marke warn">überfällig</span></> : null}</li>;
              })}</ul>
            </div>))}
        </Abschnitt>))}
      <AltLink seite="board" text="Tickets ziehen, bearbeiten und Agenten ansetzen in der alten Werkbank" />
    </div>
  );
}

// ---------- Skills ----------
export function Skills() {
  const { d, fehler, neu } = useDaten<{ skills: { name: string; description: string; state: string; core?: boolean; usage?: { count: number; lastUsed?: string | null } }[] }>('api/skills');
  const [q, setQ] = useState('');
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  const l = d.skills.filter((s) => !q || `${s.name} ${s.description}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="seite">
      <h1>Skills</h1>
      <p className="klein gedimmt">Fähigkeiten, die die Agenten nutzen können — {mehrzahl(d.skills.length, 'Skill', 'Skills')}.</p>
      <p><input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Skill suchen" aria-label="Skills durchsuchen" /></p>
      <ul className="liste">{l.map((s) => <Info key={s.name} titel={s.name} satz={`${s.description}${s.usage?.count ? ` · ${s.usage.count}× genutzt${s.usage.lastUsed ? `, zuletzt ${wann(s.usage.lastUsed)}` : ''}` : ''}`} marke={s.state !== 'verlinkt' ? { text: s.state, ton: 'warn' } : s.core ? { text: 'Kern' } : undefined} />)}</ul>
      <AltLink seite="skills" text="Skills einrichten in der alten Werkbank" />
    </div>
  );
}

// ---------- Einrichtung (Stand; Zugangsdaten nur in der alten Werkbank) ----------
export function Einrichtung() {
  const { d, fehler, neu } = useDaten<{ claude: { connected: boolean; expiresAt?: string | null }; jira: { connected: boolean; email?: string; source?: string; canWrite?: boolean | null }; services: Record<string, boolean>; skills: { total: number; linked: number; missing: number }; melious: { connected: boolean } }>('api/setup/status');
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  const ja = (b: boolean) => (b ? { text: 'eingerichtet', ton: 'gruen' } : { text: 'fehlt', ton: 'warn' });
  return (
    <div className="seite">
      <h1>Einrichtung</h1>
      <Abschnitt id="s-zugaenge" titel="Zugänge" erklaerung="Was für dein Konto eingerichtet ist. Zugangsdaten gibst du nur in der alten Werkbank ein — sie werden nie angezeigt.">
        <ul className="liste">
          <Info titel="Claude" satz={d.claude.connected ? `verbunden${d.claude.expiresAt ? `, gültig bis ${wann(d.claude.expiresAt)}` : ''}` : 'nicht verbunden — ohne Claude kein Chat'} marke={ja(d.claude.connected)} />
          <Info titel="Jira" satz={d.jira.connected ? `${d.jira.email ?? ''}${d.jira.source ? ` (${d.jira.source})` : ''}${d.jira.canWrite === false ? ' · nur lesen' : ''}` : 'nicht verbunden'} marke={ja(d.jira.connected)} />
          <Info titel="Melious" satz={d.melious.connected ? 'verbunden' : 'nicht verbunden'} marke={ja(d.melious.connected)} />
          <Info titel="Skills" satz={`${d.skills.linked} von ${d.skills.total} eingerichtet${d.skills.missing ? `, ${d.skills.missing} fehlen` : ''}`} marke={ja(!d.skills.missing)} />
        </ul>
      </Abschnitt>
      <Abschnitt id="s-dienste" titel="Dienste" erklaerung="Läuft alles, was die Werkbank braucht?">
        <ul className="liste">{Object.entries(d.services).map(([k, v]) => <Info key={k} titel={k} satz={v ? 'antwortet' : 'antwortet nicht'} marke={v ? { text: 'ok', ton: 'gruen' } : { text: 'aus', ton: 'warn' }} />)}</ul>
      </Abschnitt>
      <AltLink seite="einrichtung" text="Zugänge einrichten oder ändern in der alten Werkbank" />
    </div>
  );
}

// ---------- Meine Dateien ----------
interface Datei { id: string; name: string; kind?: string; size?: number; createdAt?: string; sharedWithNames?: string[] }
export function Dateien() {
  const { d, fehler, neu } = useDaten<{ mine: Datei[]; shared: (Datei & { from?: string })[]; maxMb: number }>('api/files');
  const [meldung, setMeldung] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  const hoch = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > d.maxMb * 1024 * 1024) { setMeldung(`Zu groß — höchstens ${d.maxMb} MB.`); return; }
    setLaeuft(true); setMeldung(null);
    try {
      const r = await fetch(`api/files?name=${encodeURIComponent(f.name)}`, { method: 'PUT', credentials: 'same-origin', headers: { 'content-type': 'application/octet-stream', 'x-werkbank': '1' }, body: f });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `Fehler ${r.status}`);
      setMeldung(`„${f.name}“ hochgeladen.`); neu();
    } catch (e: any) { setMeldung(String(e?.message ?? e)); } finally { setLaeuft(false); }
  };
  const zeile = (x: Datei & { from?: string }) => <li key={x.id} className="klein"><a href={`api/files/${encodeURIComponent(x.id)}/download`}>{x.name}</a>{x.createdAt ? ` · ${wann(x.createdAt)}` : ''}{x.from ? ` · von ${x.from}` : ''}{x.sharedWithNames?.length ? ` · geteilt mit ${x.sharedWithNames.join(', ')}` : ''}</li>;
  return (
    <div className="seite">
      <h1>Meine Dateien</h1>
      <p><label className="knopf">{laeuft ? 'Lädt hoch …' : 'Datei hochladen'}<input type="file" className="unsichtbar" disabled={laeuft} onChange={(e) => void hoch(e.target.files?.[0])} /></label> <span className="klein gedimmt">höchstens {d.maxMb} MB</span></p>
      {meldung && <p className="hinweis klein" role="status">{meldung}</p>}
      <Abschnitt id="d-mein" titel={`Deine Dateien (${d.mine.length})`} erklaerung="Was du hochgeladen hast. Ein Klick lädt herunter.">
        {d.mine.length ? <ul className="liste">{d.mine.map(zeile)}</ul> : <p className="leer">Noch keine Dateien.</p>}
      </Abschnitt>
      {d.shared.length > 0 && <Abschnitt id="d-geteilt" titel={`Mit dir geteilt (${d.shared.length})`} erklaerung="Dateien, die andere mit dir geteilt haben."><ul className="liste">{d.shared.map(zeile)}</ul></Abschnitt>}
      <AltLink seite="dateien" text="Ablegen, teilen, Dateien der Agenten und Datensicherung in der alten Werkbank" />
    </div>
  );
}

// ---------- Roadmap (Überblick) ----------
export function Roadmap() {
  const { d, fehler, neu } = useDaten<{ topics: { name: string; states: Record<string, unknown[]> }[]; states: string[] }>('api/roadmap');
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  return (
    <div className="seite">
      <h1>Roadmap</h1>
      <p className="klein gedimmt">Woran das Team arbeitet — je Thema, wie viele Vorhaben in welchem Stand sind.</p>
      <ul className="liste">{d.topics.map((t) => <Info key={t.name} titel={t.name} satz={(d.states ?? Object.keys(t.states)).filter((s) => t.states[s]?.length).map((s) => `${s}: ${t.states[s].length}`).join(' · ') || 'nichts offen'} />)}</ul>
      <AltLink seite="roadmap" text="Rangliste, Pflege und Vorhaben anlegen in der alten Werkbank" />
    </div>
  );
}

// ---------- Sprint ----------
export function Sprint() {
  const { d: c, fehler, neu } = useDaten<{ cycles: { id: string; date: string; archived?: boolean }[] }>('api/sprint/cycles');
  const [id, setId] = useState<string | null>(null);
  const aktiv = id ?? c?.cycles.filter((x) => !x.archived).sort((a, b) => b.date.localeCompare(a.date))[0]?.id ?? null;
  const { d } = useDaten<{ cycle: { id: string; date: string }; files: Record<string, { title?: string; status?: string | null; goal?: { goal?: string } | null; outcomes?: { id?: string; title?: string; owner?: string; date?: string }[] } | null>; overdue?: unknown[]; undated?: unknown[] }>(aktiv ? `api/sprint/${aktiv}` : null as any);
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!c) return <Laedt />;
  const NAME: Record<string, string> = { planning: 'Planung', review: 'Review', summary: 'Zusammenfassung' };
  return (
    <div className="seite">
      <h1>Sprint</h1>
      <p className="klein"><label>Sprint <select value={aktiv ?? ''} onChange={(e) => setId(e.target.value)}>{c.cycles.map((x) => <option key={x.id} value={x.id}>{x.date}{x.archived ? ' (archiviert)' : ''}</option>)}</select></label></p>
      {!d ? (aktiv ? <Laedt /> : <p className="leer">Noch kein Sprint angelegt.</p>) : <>
        {Object.entries(d.files ?? {}).filter(([, f]) => f).map(([k, f]) => (
          <Abschnitt key={k} id={`sp-${k}`} titel={NAME[k] ?? k} erklaerung={f!.status ? `Stand: ${f!.status}` : 'Datei des Sprints in der Wissenssammlung.'}>
            {f!.goal?.goal && <p><b>Ziel:</b> {f!.goal.goal}</p>}
            {!!f!.outcomes?.length && <ul className="liste">{f!.outcomes.slice(0, 15).map((o, i) => <li key={i} className="klein">{o.id ? <b>{o.id}</b> : null} {o.title ?? ''}{o.owner ? ` · ${o.owner}` : ''}{o.date ? ` · ${o.date}` : ''}</li>)}</ul>}
          </Abschnitt>))}
        <p className="klein gedimmt">{mehrzahl(d.overdue?.length ?? 0, 'überfälliges Ticket', 'überfällige Tickets')} · {mehrzahl(d.undated?.length ?? 0, 'Ticket ohne Datum', 'Tickets ohne Datum')}</p>
      </>}
      <AltLink seite="sprint" text="Sprint planen und abschließen in der alten Werkbank" />
    </div>
  );
}

// ---------- Ziele ----------
interface Ziel { id: string; result: string; due?: string; owner?: string; subtree?: { done: number; total: number }; children: Ziel[] }
export function Ziele() {
  const { d, fehler, neu } = useDaten<{ roots: Ziel[]; noGoal: number }>('api/goals');
  if (fehler) return <Fehler text={fehler} nochmal={neu} />;
  if (!d) return <Laedt />;
  const baum = (l: Ziel[], tiefe = 0): JSX.Element[] => l.flatMap((z) => [
    <li key={z.id} className="klein" style={{ paddingLeft: `${tiefe * 1.2}em` }}><b>{z.id}</b> {z.result}{z.owner ? ` · ${z.owner}` : ''}{z.due ? ` · bis ${z.due}` : ''}{z.subtree?.total ? ` · ${z.subtree.done}/${z.subtree.total} erledigt` : ''}</li>,
    ...baum(z.children ?? [], tiefe + 1)]);
  return (
    <div className="seite">
      <h1>Ziele</h1>
      {d.noGoal > 0 && <p className="hinweis klein">{mehrzahl(d.noGoal, 'Ticket hat', 'Tickets haben')} noch kein Ziel.</p>}
      <ul className="liste">{baum(d.roots)}</ul>
      <AltLink seite="ziele" text="Ziele zuordnen und bewerten in der alten Werkbank" />
    </div>
  );
}

// ---------- Lage (nur Admin; Schalter WERKBANK_LAGE) ----------
export function Lage() {
  const { d, fehler, neu } = useDaten<{ zahlen: Record<string, number>; laeuft: { titel?: string; title?: string }[]; fehler: string[] }>('api/lage');
  if (fehler) return <div className="seite"><h1>Lage</h1><p className="leer">{/40[34]/.test(fehler) || /nicht/.test(fehler) ? 'Die Lage ist hier (noch) nicht eingeschaltet.' : fehler}</p><button type="button" className="knopf leise" onClick={neu}>Noch einmal</button><AltLink seite="lage" text="Lage in der alten Werkbank" /></div>;
  if (!d) return <Laedt />;
  const NAME: Record<string, string> = { fuerDich: 'für dich', laeuft: 'läuft', fertig: 'fertig', hauptchat: 'beim Hauptchat', prsOffen: 'PRs offen' };
  return (
    <div className="seite">
      <h1>Lage</h1>
      <p>{Object.entries(d.zahlen ?? {}).filter(([, v]) => v != null).map(([k, v]) => `${v} ${NAME[k] ?? k}`).join(' · ')}</p>
      {!!d.fehler?.length && <p className="fehlertext klein">{d.fehler.join(' · ')}</p>}
      <AltLink seite="lage" text="Ganze Lage in der alten Werkbank" />
    </div>
  );
}

/** Für Tests: welche Pfade diese Datei bedient (App.tsx). */
export const BEREICHE = ['v2/tag', 'v2/board', 'v2/skills', 'v2/einrichtung', 'v2/dateien', 'v2/roadmap', 'v2/sprint', 'v2/ziele', 'v2/lage'] as const;
