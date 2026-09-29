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
            <p className="tiny" style={{ margin: '6px 0 0' }}>Bis {f.maxMb} MB · PDF, Bilder, Text/Markdown/CSV/JSON, Office (docx/xlsx/pptx), OpenDocument, E-Mail (.eml). Keine Programme, Skripte, Archive oder HTML. Dateien werden nie ausgeführt — aber auch nicht auf Viren geprüft: nur Dateien aus bekannter Quelle hochladen.</p>
          </div>

          <h2>Meine Dateien ({f.mine.length})</h2>
          {f.mine.length === 0 ? <p className="muted small">Noch nichts hochgeladen.</p> : (
            <table className="t small">
              <thead><tr><th>Datei</th><th>Größe</th><th>Hochgeladen</th><th>Geteilt mit</th><th></th></tr></thead>
              <tbody>{f.mine.map((x: any) => (
                <tr key={x.id} data-file={x.name}>
                  <td><a href={`api/files/${x.id}/download`}>{x.name}</a>{x.personal && <span className="chip warn" style={{ marginLeft: 6 }}>Personendaten</span>}</td>
                  <td>{size(x.size)}</td>
                  <td>{fmtDateTime(x.createdAt)}</td>
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
                      if (!(await confirm({ title: `„${x.name}“ löschen?`, body: <p>Auch für alle, mit denen sie geteilt ist.</p>, danger: true, confirmLabel: 'Löschen' }))) return;
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
                  <td><a href={`api/files/${x.id}/download`}>{x.name}</a>{x.personal && <span className="chip warn" style={{ marginLeft: 6 }}>Personendaten</span>}</td>
                  <td>{x.ownerName}</td><td>{size(x.size)}</td>
                  <td><button className="btn small" onClick={() => toChat(x.id)}>💬 Im Chat</button></td>
                </tr>
              ))}</tbody>
            </table>
          )}
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
