import { useRef, useState } from 'react';
import { api, fmtDateTime, openChat, chatTarget, type Config } from '../api.ts';
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
  const [tab, setTab] = useState<'dateien' | 'chats' | 'protokoll'>('dateien');
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
          <p className="muted" style={{ margin: 0 }}>Dateien im Team teilen und geteilte Chats wiederfinden. Alles bleibt in dieser Workspace — keine öffentlichen Links.</p>
        </div>
      </div>
      <div className="tabs">
        <button className={tab === 'dateien' ? 'on' : ''} onClick={() => setTab('dateien')}>Dateien</button>
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

          <h2>Meine Dateien ({f.mine.length})</h2>
          {f.mine.length === 0 ? <p className="muted small">Noch nichts hochgeladen.</p> : (
            <table className="t small">
              <thead><tr><th>Datei</th><th>Herkunft</th><th>Ablage</th><th>Größe</th><th>Stand</th><th>Geteilt mit</th><th></th></tr></thead>
              <tbody>{f.mine.map((x: any) => (
                <tr key={x.id} data-file={x.name}>
                  <td><FileLink x={x} />{x.personal && <span className="chip warn" style={{ marginLeft: 6 }}>Personendaten</span>}</td>
                  <td><Origin x={x} /></td>
                  <td><Place x={x} ablage={f.ablage} onDone={reloadAll} /></td>
                  <td>{x.kind === 'vault' ? '—' : size(x.size)}</td>
                  <td>{fmtDateTime(x.updatedAt ?? x.createdAt)}</td>
                  <td>
                    {x.sharedWith.map((id: string, k: number) => (
                      <span key={id} className="chip" style={{ marginRight: 4 }}>{x.sharedWithNames[k]}
                        <button className="btn ghost small" aria-label={`Freigabe für ${x.sharedWithNames[k]} entfernen`} onClick={async () => {
                          if (!(await confirm({ title: 'Freigabe zurücknehmen?', body: <p>{x.sharedWithNames[k]} sieht „{x.name}“ danach nicht mehr.</p>, confirmLabel: 'Zurücknehmen' }))) return;
                          try { await api(`/api/files/${x.id}/share`, { body: { userId: id, share: false } }); toast('Freigabe entfernt'); reloadAll(); } catch (e) { setErr(e); }
                        }}>✕</button>
                      </span>
                    ))}
                    <ShareButton f={x} people={people} onDone={reloadAll} />
                  </td>
                  <td className="row">
                    <button className="btn small" onClick={() => toChat(x.id)} title="Kopie in dein Claude-Arbeitsverzeichnis legen und einen Chat starten">💬 Im Chat</button>
                    <TicketAttach f={x} onDone={reloadAll} />
                    <button className="btn small danger" onClick={async () => {
                      if (!(await confirm({ title: `„${x.name}“ löschen?`, body: <>{x.kind !== 'vault' && x.place && <p>Die Datei wird auch aus der Ablage gelöscht: <code>{x.place}/</code></p>}{x.kind === 'vault' && <p>Nur der Eintrag verschwindet, die Notiz bleibt im Vault.</p>}<p>Auch für alle, mit denen sie geteilt ist.</p></>, danger: true, confirmLabel: 'Löschen' }))) return;
                      try { await api(`/api/files/${x.id}`, { method: 'DELETE' }); toast('Gelöscht'); reloadAll(); } catch (e) { setErr(e); }
                    }}>Löschen</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}

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
function FileLink({ x }: { x: any }) {
  if (x.kind === 'vault') return <a href={`#/wissen/${String(x.vaultPath).split('/').map(encodeURIComponent).join('/')}`} title={x.vaultPath}>{x.name}</a>;
  return <a href={`api/files/${x.id}/download`}>{x.name}</a>;
}

/** Woher die Datei kommt: hochgeladen, oder von einem Agenten fertig geschrieben (Plan 81, Schnitt 3). */
function Origin({ x }: { x: any }) {
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
  const [open, setOpen] = useState(!v?.sicher);
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
      {open && <div style={{ marginTop: 6 }}><AblageForm x={x} ablage={ablage} onDone={onDone} onCancel={v?.sicher ? () => setOpen(false) : undefined} /></div>}
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
