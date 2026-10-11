import { useMemo, useRef, useState } from 'react';
import { api, fmtDate, fmtDateTime, openChat, chatTarget, type Config } from '../api.ts';
import { Err, Loading, useLoad, useToast, useConfirm } from '../ui.tsx';

const size = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);

function ShareButton({ f, people, onDone }: { f: any; people: any[]; onDone: () => void }) {
  const [to, setTo] = useState('');
  const confirm = useConfirm();
  const toast = useToast();
  const [err, setErr] = useState<unknown>(null);
  const avail = people.filter((p) => !f.sharedWith.includes(p.id));
  return (
    <div className="row">
      <select value={to} onChange={(e) => setTo(e.target.value)} aria-label={`${f.name} teilen mit`}>
        <option value="">Teilen mit …</option>
        {avail.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <button className="btn small" disabled={!to} onClick={async () => {
        const p = people.find((x) => x.id === to);
        const ok = await confirm({ title: `„${f.name}“ mit ${p.name} teilen?`, body: <>{f.personal && <p className="note small">Als personenbezogen markiert: bleibt in der Werkbank, kein externer Link.</p>}<p className="small">{p.name} kann die Datei lesen und herunterladen. Du kannst das jederzeit zurücknehmen. Das Teilen wird protokolliert (ohne Inhalt).</p></>, confirmLabel: 'Teilen' });
        if (!ok) return;
        try { await api(`/api/files/${f.id}/share`, { body: { userId: to, share: true } }); toast('Geteilt'); setTo(''); onDone(); } catch (e) { setErr(e); }
      }}>Teilen</button>
      <Err e={err} />
    </div>
  );
}

export function Dateien({ cfg }: { cfg: Config }) {
  const files = useLoad(() => api('/api/files'));
  const team = useLoad(() => api('/api/team'));
  const chats = useLoad(() => api('/api/chats/shared'));
  const logs = useLoad(() => api('/api/sharelog'));
  const [tab, setTab] = useState<'dateien' | 'agenten' | 'chats' | 'protokoll'>('dateien');
  const [personal, setPersonal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const confirm = useConfirm();
  const people: any[] = (team.data as any)?.people ?? [];
  const f: any = files.data;
  const reloadAll = () => { files.reload(); logs.reload(); };
  const toChat = async (id: string) => {
    try { const r: any = await api(`/api/files/${id}/chat`, { method: 'POST' }); openChat(r.chatUrl); } catch (e) { setErr(e); }
  };
  return (
    <div className="page">
      <div className="head">
        <div>
          <h1>Dateien & Teilen</h1>
          <p className="muted" style={{ margin: 0 }}>Alle deine Dateien aus der Ablage, was Agenten erarbeitet haben, und was im Team geteilt ist. Alles bleibt in dieser Workspace — keine öffentlichen Links.</p>
        </div>
      </div>
      <div className="tabs">
        <button className={tab === 'dateien' ? 'on' : ''} onClick={() => setTab('dateien')}>Dateien</button>
        <button className={tab === 'agenten' ? 'on' : ''} onClick={() => setTab('agenten')}>Von Agenten</button>
        <button className={tab === 'chats' ? 'on' : ''} onClick={() => setTab('chats')}>Chats</button>
        <button className={tab === 'protokoll' ? 'on' : ''} onClick={() => setTab('protokoll')}>Protokoll</button>
      </div>
      <Err e={err} />

      {tab === 'dateien' && (!f ? <Loading /> : (
        <>
          <div className="card soft">
            <div className="row">
              <input ref={input} type="file" aria-label="Datei auswählen" />
              <label className="row small"><input type="checkbox" checked={personal} onChange={(e) => setPersonal(e.target.checked)} /> enthält Personendaten</label>
              <button className="btn primary" disabled={busy} onClick={async () => {
                const file = input.current?.files?.[0];
                if (!file) return;
                setBusy(true); setErr(null);
                try {
                  await api(`/api/files?name=${encodeURIComponent(file.name)}&personal=${personal ? 1 : 0}`, { method: 'PUT', raw: file, headers: { 'content-type': 'application/octet-stream' } });
                  toast('Hochgeladen'); if (input.current) input.current.value = ''; reloadAll();
                } catch (e) { setErr(e); } finally { setBusy(false); }
              }}>{busy ? 'Lade hoch …' : 'Hochladen'}</button>
            </div>
            <p className="tiny" style={{ margin: '6px 0 0' }}>Bis {f.maxMb} MB · PDF, Bilder, Text/Markdown/CSV/JSON, Office (docx/xlsx/pptx), OpenDocument, E-Mail (.eml). Keine Programme, Skripte, Archive oder HTML. Dateien werden nie ausgeführt — aber auch nicht auf Viren geprüft: nur Dateien aus bekannter Quelle hochladen. Neue Dateien landen zuerst in „Noch einzusortieren“.</p>
          </div>

          {f.scratch && <ScratchNotice n={f.scratch} onDone={reloadAll} />}

          {(() => {
            const todo = f.mine.filter((x: any) => x.kind !== 'vault' && x.eingang);
            return (
              <>
                <h2>Noch einzusortieren ({todo.length})</h2>
                {todo.length === 0 ? <p className="muted small">Alles abgelegt.</p> : (
                  <div className="col" style={{ gap: 8 }}>
                    {todo.map((x: any) => <Einsortieren key={x.id} x={x} ablage={f.ablage} onDone={reloadAll} />)}
                  </div>
                )}
              </>
            );
          })()}

          {f.ablage.unklar && <p className="note small">Der Besitz der Ablage ist unklar (kein oder mehr als ein Admin-Konto). Mit <code>WERKBANK_DOCS_OWNER</code> festlegen, dann erscheinen alle Dateien aus der Ablage hier.</p>}
          <Ablage f={f} people={people} onDone={reloadAll} toChat={toChat} setErr={setErr} />

          <h2>Geteilt mit mir ({f.shared.length})</h2>
          {f.shared.length === 0 ? <p className="muted small">Noch nichts.</p> : (
            <table className="t small">
              <thead><tr><th>Datei</th><th>Von</th><th>Größe</th><th></th></tr></thead>
              <tbody>{f.shared.map((x: any) => (
                <tr key={x.id} data-shared-file={x.name}>
                  <td><FileLink x={x} />{x.personal && <span className="chip warn" style={{ marginLeft: 6 }}>Personendaten</span>}{x.fehlt && <span className="chip bad" style={{ marginLeft: 6 }}>nicht mehr am Ablageort</span>}</td>
                  <td>{x.ownerName}</td><td>{x.kind === 'vault' ? '—' : size(x.size)}</td>
                  <td><button className="btn small" onClick={() => toChat(x.id)}>💬 Im Chat</button></td>
                </tr>
              ))}</tbody>
            </table>
          )}

          {f.backup && <BackupCard b={f.backup} />}
        </>
      ))}

      {tab === 'agenten' && (!f ? <Loading /> : <VonAgenten mine={f.mine} admin={cfg.user?.role === 'ADMIN'} librechatUrl={cfg.librechatUrl} />)}

      {tab === 'chats' && (!chats.data ? <Loading /> : (
        <>
          <div className="card soft small">
            <b>Einen Chat teilen:</b> im Chat oben rechts „Teilen“ → Link erstellen → <i>Zugriff verwalten</i> → Teammates auswählen. Links sind nur für angemeldete Werkbank-Konten sichtbar, öffentliche Links sind aus.
            Die Person sieht eine Momentaufnahme; sie kann sie <b>als Kopie weiterführen</b> — dann mit ihrem eigenen Claude, nie mit deiner Sitzung.
          </div>
          <h2>Geteilt mit mir ({(chats.data as any).withMe.length})</h2>
          {(chats.data as any).withMe.length === 0 ? <p className="muted small">Noch keine Chats mit dir geteilt.</p> : (
            <table className="t small"><thead><tr><th>Chat</th><th>Von</th><th>Geteilt</th><th></th></tr></thead>
              <tbody>{(chats.data as any).withMe.map((c: any) => (
                <tr key={c.shareId} data-share={c.shareId}>
                  <td><a href={c.url} target={chatTarget} rel="noreferrer">{c.title}</a> <span className="tiny">{c.messages} Nachrichten</span></td>
                  <td>{c.owner}</td><td>{fmtDateTime(c.sharedAt)}</td>
                  <td><button className="btn small" onClick={async () => {
                    try { const r: any = await api(`/api/chats/${c.shareId}/copy`, { method: 'POST' }); openChat(r.chatUrl); logs.reload(); } catch (e) { setErr(e); }
                  }}>Als Kopie weiterführen</button></td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <h2>Von mir geteilt ({(chats.data as any).byMe.length})</h2>
          {(chats.data as any).byMe.length === 0 ? <p className="muted small">Noch keine.</p> : (
            <table className="t small"><thead><tr><th>Chat</th><th>Mit</th><th>Erstellt</th></tr></thead>
              <tbody>{(chats.data as any).byMe.map((c: any) => (
                <tr key={c.shareId}><td><a href={c.url} target={chatTarget} rel="noreferrer">{c.title}</a></td><td>{c.with.join(', ') || <span className="muted">noch niemand</span>}{c.public && <span className="chip bad">öffentlich</span>}</td><td>{fmtDateTime(c.createdAt)}</td></tr>
              ))}</tbody>
            </table>
          )}
          <p className="tiny">Chat: {cfg.librechatUrl}</p>
        </>
      ))}

      {tab === 'protokoll' && (!logs.data ? <Loading /> : (
        <>
          <p className="small muted">Wer hat was mit wem geteilt — nur Kennungen, keine Inhalte. {cfg.user?.role === 'ADMIN' ? 'Als Admin siehst du alle Einträge.' : 'Du siehst Einträge, an denen du beteiligt bist.'}</p>
          <table className="t small"><thead><tr><th>Zeit</th><th>Wer</th><th>Aktion</th><th>Was</th><th>Mit</th></tr></thead>
            <tbody>{(logs.data as any).entries.map((e: any, i: number) => (
              <tr key={i}><td>{fmtDateTime(e.ts)}</td><td>{e.actor}</td><td>{e.action}</td><td>{e.kind} <span className="tiny">{e.resource.slice(0, 12)}</span></td><td>{e.target ?? '—'}</td></tr>
            ))}</tbody>
          </table>
        </>
      ))}
    </div>
  );
}

/** Vault-Notiz → Wissen, sonst Download. */
function FileLink({ x, label }: { x: any; label?: string }) {
  if (x.kind === 'vault') return <a href={`#/wissen/${String(x.vaultPath).split('/').map(encodeURIComponent).join('/')}`} title={x.vaultPath}>{label ?? x.name}</a>;
  return <a href={`api/files/${x.id}/download`} title={x.name}>{label ?? x.name}</a>;
}

/** Woher die Datei kommt: hochgeladen, oder von einem Agenten fertig geschrieben (Plan 81, Schnitt 3). */
function Origin({ x }: { x: any }) {
  if (x.kind === 'ablage') return <span className="tiny muted">aus der Ablage</span>;
  if (x.kind !== 'agent' && x.kind !== 'vault') return <span className="tiny muted">hochgeladen</span>;
  return (
    <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
      <span className="chip ok" title="nach dem Ende des Agenten-Laufs übernommen">{x.kind === 'vault' ? 'Vault-Notiz' : 'vom Agenten'} · {x.status ?? 'fertig'}</span>
      {x.projectName && <span className="chip" title="Projekt">{x.projectName}</span>}
    </span>
  );
}

// ---------- Ablage (Plan 81, Schnitte 1, 2, 4, 5) ----------

const ARTEN_TEXT: Record<string, string> = { sow: 'SOW', avv: 'AVV', vertrag: 'Vertrag', angebot: 'Angebot', rechnung: 'Rechnung', deck: 'Präsentation', daten: 'Daten', notiz: 'Notiz' };
const extOf = (n: string) => (n.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase();
const slugify = (s: string) => s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Felder fürs Ablegen; „Ablegen“ übernimmt sie. Vorausgefüllt mit dem Vorschlag bzw. den zuletzt gewählten Angaben. */
function AblageForm({ x, ablage, onDone, onCancel, label = 'Ablegen' }: { x: any; ablage: any; onDone: () => void; onCancel?: () => void; label?: string }) {
  const v = x.vorschlag ?? {};
  const [team, setTeam] = useState<string>(v.team ?? '');
  const [vorgang, setVorgang] = useState<string>(v.vorgang ?? '');
  const [art, setArt] = useState<string>(v.art ?? 'notiz');
  const [datum, setDatum] = useState<string>(v.datum && v.datum !== 'undatiert' ? v.datum : '');
  const [slug, setSlug] = useState<string>(v.slug ?? '');
  const [version, setVersion] = useState<string>(v.version ?? '');
  const [ticket, setTicket] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const toast = useToast();
  const t = slugify(team), g = vorgang.trim().toLowerCase(), sl = slugify(slug);
  const name = `${datum || 'undatiert'}_${art}_${sl || '…'}${version ? `_${version}` : ''}${extOf(x.name)}`;
  const missing = !t || !g;
  const id = `ab-${x.id}`;
  return (
    <div className="col" style={{ gap: 6 }}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <label className="small">Team <input list={`${id}-teams`} value={team} onChange={(e) => setTeam(e.target.value)} placeholder="olaf" style={{ width: 90 }} aria-label="Team" /></label>
        <datalist id={`${id}-teams`}>{ablage.teams.map((tm: string) => <option key={tm} value={tm} />)}</datalist>
        <label className="small">Vorgang <input list={`${id}-vorgaenge`} value={vorgang} onChange={(e) => setVorgang(e.target.value)} placeholder="z. B. enlion" style={{ width: 150 }} aria-label="Vorgang" /></label>
        <datalist id={`${id}-vorgaenge`}>{ablage.folders.filter((fo: any) => !t || fo.team === t).map((fo: any) => <option key={`${fo.team}/${fo.vorgang}`} value={fo.vorgang} />)}</datalist>
        <label className="small">Art <select value={art} onChange={(e) => setArt(e.target.value)} aria-label="Art">{ablage.arten.map((a: string) => <option key={a} value={a}>{ARTEN_TEXT[a] ?? a}</option>)}</select></label>
        <label className="small">Dokumentdatum <input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} aria-label="Dokumentdatum" /></label>
        <label className="small">Kurzname <input value={slug} onChange={(e) => setSlug(e.target.value)} style={{ width: 160 }} aria-label="Kurzname" /></label>
        <label className="small">Version <input value={version} onChange={(e) => setVersion(e.target.value.trim())} placeholder="v2" style={{ width: 50 }} aria-label="Version" /></label>
        <label className="small">Ticket <input value={ticket} onChange={(e) => setTicket(e.target.value)} placeholder="PM-…" style={{ width: 80 }} aria-label="Ticket" /></label>
      </div>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <span className="tiny">Wird: <code>{t || '?'}/{g || '?'}/{name}</code>{!datum && <> · ohne Datum „undatiert“</>}</span>
        <button className="btn small primary" disabled={busy || missing || !sl} onClick={async () => {
          setBusy(true); setErr(null);
          try {
            await api(`/api/files/${x.id}/ablegen`, { body: { team: t, vorgang: g, art, datum: datum || 'undatiert', slug: sl, version, ticket: ticket.trim() } });
            toast(`Abgelegt in ${t}/${g}`); onDone();
          } catch (e) { setErr(e); } finally { setBusy(false); }
        }}>{busy ? 'Lege ab …' : label}</button>
        {onCancel && <button className="btn small ghost" onClick={onCancel}>Abbrechen</button>}
      </div>
      {missing && <p className="tiny muted" style={{ margin: 0 }}>Wohin gehört die Datei? Team und Vorgang fehlen noch.</p>}
      <Err e={err} />
    </div>
  );
}

/** Eine Zeile in „Noch einzusortieren“: der Vorschlag als Satz, „Ablegen“ übernimmt ihn, „Ändern“ öffnet die Felder. */
function Einsortieren({ x, ablage, onDone }: { x: any; ablage: any; onDone: () => void }) {
  const v = x.vorschlag;
  const [open, setOpen] = useState(false); // zu: der Baum darunter soll sichtbar bleiben (Plan dateien-vollständig, UX)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const toast = useToast();
  return (
    <div className="card soft" data-einsortieren={x.name}>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
        <FileLink x={x} />{x.personal && <span className="chip warn">Personendaten</span>}{x.fehlt && <span className="chip bad">nicht mehr am Ablageort</span>}
        <span className="tiny muted">{x.kind === 'agent' ? 'vom Agenten' : 'hochgeladen'} · {fmtDateTime(x.createdAt)}</span>
      </div>
      {!open && v?.sicher && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          <span className="small">Vorschlag: <code>{v.team}/{v.vorgang}/{v.name}</code></span>
          <button className="btn small primary" disabled={busy} onClick={async () => {
            setBusy(true); setErr(null);
            try { await api(`/api/files/${x.id}/ablegen`, { body: v }); toast(`Abgelegt in ${v.team}/${v.vorgang}`); onDone(); } catch (e) { setErr(e); } finally { setBusy(false); }
          }}>{busy ? 'Lege ab …' : 'Ablegen'}</button>
          <button className="btn small" onClick={() => setOpen(true)}>Ändern</button>
        </div>
      )}
      {!open && !v?.sicher && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
          <span className="small muted">Wohin gehört die Datei?</span>
          <button className="btn small primary" onClick={() => setOpen(true)}>Einsortieren</button>
        </div>
      )}
      {open && <div style={{ marginTop: 6 }}><AblageForm x={x} ablage={ablage} onDone={onDone} onCancel={() => setOpen(false)} /></div>}
      <Err e={err} />
    </div>
  );
}

/** Ablageort in „Meine Dateien“ mit „Verschieben“. */
function Place({ x, ablage, onDone }: { x: any; ablage: any; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  if (x.kind === 'vault') return <span className="tiny muted">Vault</span>;
  return (
    <span className="col" style={{ gap: 4 }}>
      <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
        {x.eingang ? <span className="chip warn">noch einzusortieren</span> : <code className="tiny" title="Ordner in der Ablage">{x.place}/</code>}
        {x.fehlt && <span className="chip bad" title="Die Datei wurde außerhalb der Werkbank verschoben oder gelöscht.">nicht mehr am Ablageort</span>}
        {!x.eingang && !x.fehlt && <button className="btn ghost small" onClick={() => setOpen(!open)}>{open ? 'Schließen' : 'Verschieben'}</button>}
      </span>
      {open && <AblageForm x={x} ablage={ablage} label="Verschieben" onDone={() => { setOpen(false); onDone(); }} onCancel={() => setOpen(false)} />}
    </span>
  );
}

/** Hinweis: Zwischenstände im Arbeitsordner werden nach 30 Tagen ohne Zugriff gelöscht (vorher einmal angekündigt). */
function ScratchNotice({ n, onDone }: { n: any; onDone: () => void }) {
  const [list, setList] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const toast = useToast();
  const keep = async (rels: string[]) => {
    setErr(null);
    try { const r: any = await api('/api/scratch/keep', { body: { rels } }); toast(`${r.kept} behalten`); onDone(); } catch (e) { setErr(e); }
  };
  const when = n.deleteFrom ? new Date(n.deleteFrom).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit' }) : '';
  return (
    <div className="card note small" data-scratch-notice>
      <b>Ab {when} werden {n.count} {n.count === 1 ? 'Datei' : 'Dateien'} aus deinem Arbeitsordner gelöscht</b> — Zwischenstände der Chats, die seit über {n.days - 7} Tagen niemand geöffnet hat (gelöscht wird nach {n.days} Tagen).
      {' '}Abgelegte Dateien und Vault-Notizen sind nicht betroffen. Was du brauchst, behalte oder lass es vom Agenten ablegen.
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        <button className="btn small" onClick={() => setList(!list)}>{list ? 'Liste schließen' : 'Liste zeigen'}</button>
        <button className="btn small" onClick={() => keep(n.files.map((f: any) => f.rel))}>Alle behalten</button>
      </div>
      {list && (
        <table className="t small" style={{ marginTop: 6 }}><thead><tr><th>Datei</th><th>Zuletzt geöffnet</th><th></th></tr></thead>
          <tbody>{n.files.map((f: any) => (
            <tr key={f.rel}><td><code className="tiny">{f.rel}</code></td><td>{fmtDateTime(f.lastUse)}</td><td><button className="btn ghost small" onClick={() => keep([f.rel])}>behalten</button></td></tr>
          ))}</tbody>
        </table>
      )}
      <Err e={err} />
    </div>
  );
}

/** Nur für Admins: Backup als Download, dazu die Nachtarchive auf der VM. */
function BackupCard({ b }: { b: any }) {
  const last = b.nightly?.[0];
  return (
    <>
      <h2>Backup</h2>
      <div className="card soft small" data-backup>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <a className="btn primary" href="api/backup" download>Backup herunterladen</a>
          <span className="tiny">{last ? <>Letzte Nachtsicherung: {fmtDateTime(last.at)} · {size(last.size)} · {b.nightly.length} von {b.keep} aufbewahrt</> : 'Noch keine Nachtsicherung auf der VM.'}</span>
        </div>
        <p className="tiny" style={{ margin: '6px 0 0' }}>
          Drin: die Datenbank der Werkbank (Tickets-Kopie, Dateien-Einträge, Projekte, Freigaben …), alle Dateien der Ablage, das Freigabe-Protokoll.
          Nicht drin: Zugänge (Claude, Jira) und Anmeldungen, Chats (LibreChat), der Vault (eigenes Git), Arbeitsordner.
          {b.key ? ' Dateien mit Personendaten sind verschlüsselt — den Schlüssel (WERKBANK_BACKUP_KEY) brauchst du zum Wiederherstellen.' : ' Achtung: kein WERKBANK_BACKUP_KEY gesetzt — Dateien mit Personendaten fehlen im Archiv.'}
        </p>
      </div>
    </>
  );
}

/** „an Ticket hängen“: Datei erscheint dann an der Karte (Dokumente). */
function TicketAttach({ f, onDone }: { f: any; onDone: () => void }) {
  const [key, setKey] = useState('');
  const [err, setErr] = useState<unknown>(null);
  return (
    <span className="row" style={{ gap: 4 }}>
      {(f.tickets ?? []).map((k: string) => <span key={k} className="chip">{k}</span>)}
      <input aria-label={`${f.name} an Ticket hängen`} placeholder="PM-…" value={key} onChange={(e) => setKey(e.target.value)} style={{ width: 80 }} />
      <button className="btn small" disabled={!/^[A-Za-z]+-\d+$/.test(key.trim())} onClick={async () => {
        setErr(null);
        try { await api(`/api/files/${f.id}/ticket`, { body: { key: key.trim().toUpperCase() } }); setKey(''); onDone(); } catch (e) { setErr(e); }
      }}>an Ticket</button>
      <Err e={err} />
    </span>
  );
}

// ---------- Ablage als Ordnerbaum (Plan dateien-vollständig, S2) ----------

const byNewest = (a: any, b: any) => String(b.ort?.datum ?? '').localeCompare(String(a.ort?.datum ?? '')) || String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt));
const folderOrder = (a: string, b: string) => (a.startsWith('_') === b.startsWith('_') ? a.localeCompare(b, 'de') : a.startsWith('_') ? -1 : 1);
const OHNE_ORT = 'Ohne Ablageort';

/** Team → Vorgang → (Unterordner) → Dateien. Dateien direkt im Team stehen unter Vorgang „“. */
function buildTree(files: any[]) {
  const teams = new Map<string, Map<string, { files: any[]; subs: Map<string, any[]> }>>();
  for (const x of files) {
    const team = x.ort?.team || OHNE_ORT, vorgang = x.ort?.vorgang ?? '', sub = x.ort?.sub ?? '';
    if (!teams.has(team)) teams.set(team, new Map());
    const vs = teams.get(team)!;
    if (!vs.has(vorgang)) vs.set(vorgang, { files: [], subs: new Map() });
    const v = vs.get(vorgang)!;
    if (sub) v.subs.set(sub, [...(v.subs.get(sub) ?? []), x]); else v.files.push(x);
  }
  return teams;
}

function Ablage({ f, people, onDone, toChat, setErr }: { f: any; people: any[]; onDone: () => void; toChat: (id: string) => void; setErr: (e: unknown) => void }) {
  const [q, setQ] = useState('');
  const [art, setArt] = useState('');
  // `_eingang` steht als eigener Ordner mit im Baum (dort lässt sich auch Unsortiertes teilen); Vault-Notizen unter „Von Agenten“.
  const all: any[] = useMemo(() => f.mine.filter((x: any) => x.kind !== 'vault'), [f]);
  const needle = q.trim().toLowerCase();
  const filtering = !!(needle || art);
  const shown = all.filter((x) => (!art || (art === '-' ? !x.ort?.art : x.ort?.art === art))
    && (!needle || [x.name, x.originalName, x.ort?.team, x.ort?.vorgang, x.ort?.sub, x.projectName, ...(x.tickets ?? [])].filter(Boolean).join(' ').toLowerCase().includes(needle)));
  const tree = buildTree(shown);
  const recent = [...all].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 8);
  const row = (x: any, mitOrt = false) => <DateiZeile key={x.id} x={x} f={f} people={people} onDone={onDone} toChat={toChat} setErr={setErr} mitOrt={mitOrt} />;
  const count = (v: { files: any[]; subs: Map<string, any[]> }) => v.files.length + [...v.subs.values()].reduce((n, l) => n + l.length, 0);
  return (
    <>
      {!filtering && recent.length > 0 && (
        <>
          <h2>Zuletzt dazugekommen</h2>
          <div className="flist" data-zuletzt>{recent.map((x) => row(x, true))}</div>
        </>
      )}
      <h2>Ablage ({all.length})</h2>
      <div className="row ftools">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen: Name, Vorgang, Ticket …" aria-label="Ablage durchsuchen" />
        <select value={art} onChange={(e) => setArt(e.target.value)} aria-label="Nach Art filtern">
          <option value="">alle Arten</option>
          {f.ablage.arten.map((a: string) => <option key={a} value={a}>{ARTEN_TEXT[a] ?? a}</option>)}
          <option value="-">ohne Art</option>
        </select>
        {filtering && <span className="tiny muted">{shown.length} {shown.length === 1 ? 'Treffer' : 'Treffer'}</span>}
      </div>
      {all.length === 0 ? <p className="muted small">Noch keine Dateien in der Ablage.</p> : shown.length === 0 ? <p className="muted small">Nichts gefunden.</p> : (
        <div className="ftree" data-ablage-baum>
          {[...tree.keys()].sort(folderOrder).map((team) => {
            const vs = tree.get(team)!;
            const n = [...vs.values()].reduce((s, v) => s + count(v), 0);
            return (
              <details key={`${team}-${filtering}`} open data-team={team}>
                <summary><b>{team}</b> <span className="tiny muted">{n}</span>{team === '_eingang' && <span className="chip warn" style={{ marginLeft: 6 }}>noch einzusortieren</span>}</summary>
                {[...vs.keys()].sort(folderOrder).map((vorgang) => {
                  const v = vs.get(vorgang)!;
                  const inner = (
                    <>
                      {[...v.subs.keys()].sort(folderOrder).map((sub) => (
                        <details key={`${sub}-${filtering}`} open={filtering} data-sub={sub}>
                          <summary>📁 {sub} <span className="tiny muted">{v.subs.get(sub)!.length}</span></summary>
                          <div className="flist">{v.subs.get(sub)!.sort(byNewest).map((x) => row(x))}</div>
                        </details>
                      ))}
                      <div className="flist">{v.files.sort(byNewest).map((x) => row(x))}</div>
                    </>
                  );
                  if (!vorgang) return <div key="(direkt)" className="fdirect">{inner}</div>;
                  return (
                    <details key={`${vorgang}-${filtering}`} open={filtering} data-vorgang={vorgang}>
                      <summary>📂 {vorgang} <span className="tiny muted">{count(v)}</span></summary>
                      {inner}
                    </details>
                  );
                })}
              </details>
            );
          })}
        </div>
      )}
    </>
  );
}

/** Eine Datei im Baum: Titel, Datum, Art, Herkunft; Aktionen hinter „⋯“. */
function DateiZeile({ x, f, people, onDone, toChat, setErr, mitOrt }: { x: any; f: any; people: any[]; onDone: () => void; toChat: (id: string) => void; setErr: (e: unknown) => void; mitOrt?: boolean }) {
  const [open, setOpen] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();
  const o = x.ort ?? {};
  const titel = o.art ? String(o.slug).replace(/[-_]+/g, ' ') : x.name;
  const ablage = x.kind === 'ablage';
  return (
    <div className="frow" data-file={x.name}>
      <div className="frow-main">
        <span className="frow-title"><FileLink x={x} label={titel} /></span>
        <span className="frow-meta">
          {o.datum && <span className="tiny muted">{fmtDate(o.datum)}</span>}
          {o.art && <span className="chip">{ARTEN_TEXT[o.art] ?? o.art}</span>}
          {o.version && <span className="chip">{o.version}</span>}
          {extOf(x.name) && <span className="tiny muted">{extOf(x.name).slice(1).toUpperCase()}</span>}
          {!ablage && <Origin x={x} />}
          {x.personal && <span className="chip warn">Personendaten</span>}
          {x.sharedWith.length > 0 && <span className="chip" title={x.sharedWithNames.join(', ')}>geteilt · {x.sharedWith.length}</span>}
          {x.fehlt && <span className="chip bad">nicht mehr am Ablageort</span>}
          {mitOrt && x.place && <code className="tiny">{x.place}/</code>}
        </span>
        <button className="btn ghost small" aria-expanded={open} aria-label={`Aktionen für ${x.name}`} onClick={() => setOpen(!open)}>⋯</button>
      </div>
      {open && (
        <div className="frow-actions">
          <span className="tiny muted">{x.name} · {size(x.size)} · Stand {fmtDateTime(x.updatedAt ?? x.createdAt)}{ablage ? ' · aus deiner Ablage' : ''}</span>
          {x.sharedWith.length > 0 && (
            <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
              {x.sharedWith.map((id: string, k: number) => (
                <span key={id} className="chip">{x.sharedWithNames[k]}
                  <button className="btn ghost small" aria-label={`Freigabe für ${x.sharedWithNames[k]} entfernen`} onClick={async () => {
                    if (!(await confirm({ title: 'Freigabe zurücknehmen?', body: <p>{x.sharedWithNames[k]} sieht „{x.name}“ danach nicht mehr.</p>, confirmLabel: 'Zurücknehmen' }))) return;
                    try { await api(`/api/files/${x.id}/share`, { body: { userId: id, share: false } }); toast('Freigabe entfernt'); onDone(); } catch (e) { setErr(e); }
                  }}>✕</button>
                </span>
              ))}
            </span>
          )}
          <ShareButton f={x} people={people} onDone={onDone} />
          <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <button className="btn small" onClick={() => toChat(x.id)} title="Kopie in dein Claude-Arbeitsverzeichnis legen und einen Chat starten">💬 Im Chat</button>
            <TicketAttach f={x} onDone={onDone} />
          </span>
          {!(ablage && o.sub) && <Place x={x} ablage={f.ablage} onDone={onDone} />}
          {!ablage && (
            <button className="btn small danger" style={{ alignSelf: 'flex-start' }} onClick={async () => {
              if (!(await confirm({ title: `„${x.name}“ löschen?`, body: <>{x.place && <p>Die Datei wird auch aus der Ablage gelöscht: <code>{x.place}/</code></p>}<p>Auch für alle, mit denen sie geteilt ist.</p></>, danger: true, confirmLabel: 'Löschen' }))) return;
              try { await api(`/api/files/${x.id}`, { method: 'DELETE' }); toast('Gelöscht'); onDone(); } catch (e) { setErr(e); }
            }}>Löschen</button>
          )}
          {ablage && <span className="tiny muted">Löschen und Umbenennen in deiner Ablage selbst — die Werkbank zieht nach{o.sub ? '; Dateien in Unterordnern bleiben, wo sie sind' : ''}.</span>}
        </div>
      )}
    </div>
  );
}

// ---------- Von Agenten (Plan dateien-vollständig, S3) ----------

const paketUrl = (p: string, rel: string) => `api/files/agenten/${encodeURIComponent(p)}/${rel.split('/').map(encodeURIComponent).join('/')}`;
const isBild = (rel: string) => /\.(png|jpe?g|gif|webp)$/i.test(rel);
const isText = (rel: string) => /\.(md|txt)$/i.test(rel);

function VonAgenten({ mine, admin, librechatUrl }: { mine: any[]; admin: boolean; librechatUrl: string }) {
  const chats = mine.filter((x) => x.kind === 'agent' || x.kind === 'vault').sort((a, b) => String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt)));
  return (
    <>
      {admin ? <Pakete /> : <p className="muted small">Review-Pakete der Agenten-Stränge sehen nur Admins.</p>}
      <h2>Aus Chats ({chats.length})</h2>
      <p className="tiny muted" style={{ marginTop: 0 }}>Was ein Agent im Werkbank-Chat fertig geschrieben hat — Dateien liegen zusätzlich in der Ablage, Notizen im Vault.</p>
      {chats.length === 0 ? <p className="muted small">Noch nichts.</p> : (
        <div className="flist">{chats.map((x) => (
          <div key={x.id} className="frow" data-agent-file={x.name}>
            <div className="frow-main">
              <span className="frow-title"><FileLink x={x} /></span>
              <span className="frow-meta">
                <Origin x={x} />
                <span className="tiny muted">{fmtDateTime(x.updatedAt ?? x.createdAt)}</span>
                {x.source?.conv && <a className="tiny" href={`${librechatUrl}/c/${x.source.conv}`} target={chatTarget} rel="noreferrer">Chat öffnen</a>}
              </span>
            </div>
          </div>
        ))}</div>
      )}
    </>
  );
}

function Pakete() {
  const d = useLoad(() => api('/api/files/agenten'));
  const [q, setQ] = useState('');
  const [n, setN] = useState(30);
  const [view, setView] = useState<{ paket: string; rel: string } | null>(null);
  const data: any = d.data;
  if (d.error) return <Err e={d.error} />;
  if (!data) return <Loading />;
  const needle = q.trim().toLowerCase();
  const list = data.pakete.filter((p: any) => !needle || `${p.name} ${p.title} ${p.strand?.title ?? ''}`.toLowerCase().includes(needle));
  return (
    <>
      <h2>Review-Pakete ({data.pakete.length})</h2>
      <p className="tiny muted" style={{ marginTop: 0 }}>Berichte, Pläne und Screenshots der Haupt-Sitzung und der Orchestrator-Stränge. Nur lesen — hier wird nichts verschoben.</p>
      {!data.ordner ? <p className="muted small">Auf diesem Server gibt es keinen Ordner mit Review-Paketen.</p> : (
        <>
          <div className="row ftools">
            <input type="search" value={q} onChange={(e) => { setQ(e.target.value); setN(30); }} placeholder="Suchen: Nummer, Titel, Strang …" aria-label="Review-Pakete durchsuchen" />
            {needle && <span className="tiny muted">{list.length} Treffer</span>}
          </div>
          {list.length === 0 ? <p className="muted small">Nichts gefunden.</p> : (
            <div className="ftree" data-pakete>
              {list.slice(0, n).map((p: any) => (
                <details key={p.name} className="paket" data-paket={p.name}>
                  <summary>
                    <span className="chip">{p.nr}</span> <b>{p.title}</b>
                    <span className="tiny muted"> · {fmtDate(new Date(p.at).toISOString())} · {p.files.length}{p.more ? ` + ${p.more}` : ''} Dateien</span>
                  </summary>
                  <div className="col" style={{ gap: 4, padding: '4px 0 8px 8px' }}>
                    {p.strand && <span className="small">Strang: {p.strand.url ? <a href={p.strand.url} target={chatTarget} rel="noreferrer">{p.strand.title || p.strand.id}</a> : p.strand.title}</span>}
                    <span className="tiny muted"><code>{p.name}/</code></span>
                    {p.files.map((x: any) => (
                      <div key={x.rel} className="frow-main">
                        <span className="frow-title"><a href={paketUrl(p.name, x.rel)}>{x.rel}</a></span>
                        <span className="frow-meta"><span className="tiny muted">{size(x.size)}</span></span>
                        {(isText(x.rel) || isBild(x.rel)) && <button className="btn small" onClick={() => setView({ paket: p.name, rel: x.rel })}>Vorschau</button>}
                      </div>
                    ))}
                    {p.more > 0 && <span className="tiny muted">… und {p.more} weitere Dateien im Ordner.</span>}
                    {p.files.length === 0 && <span className="tiny muted">Keine lesbaren Ergebnisse (nur Code oder Skripte).</span>}
                  </div>
                </details>
              ))}
              {list.length > n && <button className="btn small" onClick={() => setN(n + 30)}>Weitere {Math.min(30, list.length - n)} zeigen</button>}
            </div>
          )}
        </>
      )}
      {view && <Vorschau {...view} onClose={() => setView(null)} />}
    </>
  );
}

/** Vorschau im Overlay: Markdown gerendert (Bilder im Bericht zeigen auf das Paket), Text, Bilder inline. */
function Vorschau({ paket, rel, onClose }: { paket: string; rel: string; onClose: () => void }) {
  const d = useLoad(() => (isText(rel) ? api(`${paketUrl(paket, rel)}?vorschau=1`) : Promise.resolve(null)), [paket, rel]);
  const data: any = d.data;
  return (
    <div className="backdrop" onClick={onClose} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <div className="dialog vorschau" role="dialog" aria-modal="true" aria-label={`Vorschau ${rel}`} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
          <b className="small" style={{ overflowWrap: 'anywhere' }}>{paket}/{rel}</b>
          <span className="row" style={{ gap: 6 }}>
            <a className="btn small" href={paketUrl(paket, rel)}>Herunterladen</a>
            <button className="btn small" autoFocus onClick={onClose}>Schließen</button>
          </span>
        </div>
        {isBild(rel) ? <img src={`${paketUrl(paket, rel)}?inline=1`} alt={rel} style={{ maxWidth: '100%', marginTop: 10 }} /> : d.error ? <Err e={d.error} /> : !data ? <Loading /> : data.html
          ? <div className="note-body" style={{ marginTop: 10 }} dangerouslySetInnerHTML={{ __html: data.html }} />
          : <pre style={{ whiteSpace: 'pre-wrap', marginTop: 10 }}>{data.text}</pre>}
      </div>
    </div>
  );
}
