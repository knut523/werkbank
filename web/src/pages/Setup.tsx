import { useState } from 'react';
import { api, fmtDateTime, chatTarget, embedded, type Config } from '../api.ts';
import { Err, Loading, useLoad, useToast, useConfirm } from '../ui.tsx';

function Login({ cfg, onLogin }: { cfg: Config; onLogin: () => void }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <h1>Willkommen in der OLAF-Werkbank</h1>
      <p className="muted">Chat mit Claude Code — mit unseren Skills, dem Vault und Jira, unter deinem eigenen Claude-Konto. Dazu Wissen, Board, Sprint und Dateien an einem Ort.</p>
      <div className="steps" style={{ marginTop: 20 }}>
        <div className="step">
          <div className="num">1</div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Konto anlegen</h3>
            <p>Die Werkbank nutzt dasselbe Konto wie der Chat. Noch keins? <a href={cfg.librechatUrl + '/register'} target="_blank" rel="noreferrer">Im Chat registrieren</a> — nur mit einer Adresse <code>@maxenergy.at</code> oder <code>@konekto.energy</code>. Danach hier anmelden.</p>
            <form className="col" style={{ maxWidth: 360 }} onSubmit={async (e) => {
              e.preventDefault(); setBusy(true); setErr(null);
              try { await api('/api/login', { body: { email, password: pw } }); onLogin(); } catch (x) { setErr(x); } finally { setBusy(false); }
            }}>
              <label htmlFor="email">E-Mail</label>
              <input id="email" name="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <label htmlFor="pw">Passwort</label>
              <input id="pw" name="password" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
              <Err e={err} />
              <div><button className="btn primary" disabled={busy} type="submit">{busy ? 'Anmelden …' : 'Anmelden'}</button></div>
            </form>
          </div>
        </div>
        {['Claude verbinden', 'Jira verbinden', 'Loslegen'].map((t, i) => (
          <div className="step" key={t}><div className="num">{i + 2}</div><div className="card soft"><b>{t}</b> <span className="muted">— nach der Anmeldung</span></div></div>
        ))}
      </div>
    </div>
  );
}

export function Setup({ cfg, onLogin }: { cfg: Config; onLogin: () => void }) {
  if (!cfg.user) return <Login cfg={cfg} onLogin={onLogin} />;
  return <Wizard cfg={cfg} />;
}

function Sessions() {
  const s = useLoad(() => api('/api/sessions'));
  const d: any = s.data;
  if (!d || !d.sessions.length) return null;
  return (
    <>
      <h2>Deine Claude-Sitzungen</h2>
      <table className="t small" data-testid="sessions">
        <thead><tr><th>Sitzung</th><th>Status</th><th>Züge</th><th>Zuletzt</th></tr></thead>
        <tbody>{d.sessions.slice(0, 10).map((x: any) => (
          <tr key={x.conv}>
            <td>{x.url ? <a href={x.url} target={chatTarget}>{x.title || x.conv.slice(0, 8)}</a> : <>{x.title || x.conv} <span className="tiny">(Board-Agent)</span></>}</td>
            <td><span className={`chip ${x.status === 'wartet auf ja' ? 'warn' : x.status === 'läuft' ? 'ok' : ''}`}>{x.status}</span></td>
            <td>{x.turns ?? '—'}</td><td>{fmtDateTime(x.lastActivity)}</td>
          </tr>
        ))}</tbody>
      </table>
      <p className="tiny">Jede Unterhaltung ist eine fortsetzbare Claude-Code-Sitzung. „wartet auf ja“: dort steht eine Rückfrage offen.</p>
    </>
  );
}

function ContextInfo() {
  const c = useLoad(() => api('/api/context'));
  const [show, setShow] = useState(false);
  if (!c.data) return null;
  const d: any = c.data;
  const avg = d.recent.length ? Math.round(d.recent.reduce((s: number, r: any) => s + r.tokens, 0) / d.recent.length) : 0;
  return (
    <>
      <h2>Kontext für Claude</h2>
      <div className="card" data-testid="context-info">
        <p className="small" style={{ marginTop: 0 }}>Jede <b>neue</b> Chat-Sitzung bekommt ein kurzes Kontext-Paket (deine Tickets, Sprint, Roadmap, offene Fragen, Vault-Karte — nur Zeiger, keine Kundendaten). Pflegefragen (höchstens drei) nur in der ersten Sitzung des Tages und zum Tagesabschluss (ab 16 Uhr oder über die Vorlage). Fortgesetzte Sitzungen bekommen nichts noch einmal.</p>
        <table className="t small" style={{ marginBottom: 8 }}>
          <thead><tr><th>Fester Teil je Sitzung (geschätzt)</th><th>vorher</th><th>jetzt</th></tr></thead>
          <tbody>
            <tr><td>Skill-Liste</td><td>~{d.fixed.skillsAll} Tokens ({d.fixed.skillsAllCount} Skills)</td><td>~{d.fixed.skillsCore} Tokens ({d.fixed.skillsCoreCount} Kern-Skills, weitere je Vorlage/Nennung)</td></tr>
            <tr><td>Eigene MCP-Werkzeuge (vault-search, werkbank)</td><td>—</td><td>~{d.fixed.ownTools} Tokens (per Tool Search erst bei Bedarf)</td></tr>
            <tr><td>Kontext-Paket</td><td>—</td><td>~{d.current.tokens} Tokens (Obergrenze 1500)</td></tr>
          </tbody>
        </table>
        <div className="row small">
          <span className="chip">jetzt: ~{d.current.tokens} Tokens{d.current.cached ? ' (aus dem Zwischenspeicher)' : ''}</span>
          <span className="chip">Obergrenze 1500</span>
          {avg > 0 && <span className="chip">Ø letzte {d.recent.length} Sitzungen: ~{avg} Tokens</span>}
          <button className="btn small" onClick={() => setShow(!show)}>{show ? 'ausblenden' : 'Paket ansehen'}</button>
        </div>
        {show && <pre style={{ whiteSpace: 'pre-wrap', marginTop: 8 }}>{d.current.pack}</pre>}
        {d.recent.length > 0 && (
          <table className="t small" style={{ marginTop: 8 }}>
            <thead><tr><th>Zeit</th><th>Paket + Fragen</th><th>Anlass</th><th>Skills (geschätzt)</th><th>gemessen (Claude Code)</th><th>Zwischenspeicher</th></tr></thead>
            <tbody>{d.recent.slice(0, 8).map((r: any, i: number) => <tr key={i}><td>{fmtDateTime(r.at)}</td><td>{r.tokens} ({r.questions} Fragen)</td><td>{r.slot === 'morgen' ? 'Tagesbeginn' : r.slot === 'abend' ? 'Tagesabschluss' : '—'}</td><td>{r.skillsTokens ?? '—'}{r.skillsCount ? ` (${r.skillsCount})` : ''}</td><td>{r.measured ? `gesamt ${r.measured.total}, Werkzeuge ${r.measured.tools}, Skills ${r.measured.skills}${r.measured.deferredTools ? `, zurückgestellt ${r.measured.deferredTools}` : ''}` : '—'}</td><td>{r.cached ? 'ja' : 'nein'}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </>
  );
}

/** Jira schreiben über den Atlassian-MCP in der eigenen Claude-Sitzung (Knut, 29.09.). */
function McpStep({ claude }: { claude: boolean }) {
  const m = useLoad(() => api('/api/setup/mcp'));
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState<string | null>(null);
  const d: any = m.data;
  const ok = d?.status === 'connected' && !d?.problem;
  return (
    <div className={`step ${ok ? 'done' : ''}`} data-testid="mcp-step">
      <div className="num">{ok ? '✓' : '4'}</div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Jira schreiben (Atlassian-MCP)</h3>
        <p className="small" style={{ marginTop: 0 }}>Kommentare, Statuswechsel und Fälligkeiten vom Board, aus dem Sprint und aus den Pflegefragen schreibt die Werkbank <b>über den Atlassian-MCP in deiner eigenen Claude-Sitzung</b> — unter deinem Atlassian-Konto, jeweils erst nach deiner Bestätigung. Gelesen wird weiter mit dem Lesezugang oben.</p>
        {d && (ok
          ? <p className="okbox">Verbunden (geprüft {fmtDateTime(d.checkedAt)}).</p>
          : d.status || d.problem
            ? <p className="err small">Nicht verbunden{d.status && d.status !== 'connected' ? ` (Status: ${d.status})` : d.problem === 'mcp_auth' ? ' (letzter Schreibversuch: nicht angemeldet)' : ''}.</p>
            : <p className="note small">Noch nicht geprüft.</p>)}
        {d?.home && <p className="small" data-testid="claude-home">Deine Claude-Konfiguration: {d.home.mode === 'person'
          ? <><b>eigene</b> (<code>{d.home.dir}</code>) — eigene MCP-Anmeldungen, keine fremden Hooks oder Erinnerungen.</>
          : <><b>geteilt</b> mit dem VM-Nutzer (Pilot) — Jira-Anmeldung aus dessen <code>~/.claude</code>.</>}</p>}
        <ol className="small">
          <li>Einmalig anmelden, am einfachsten <b>im Chat</b>: <a className="btn small" href={d?.loginChatUrl} target={chatTarget} data-testid="mcp-login-chat">Im Chat bei Jira anmelden</a> — Claude gibt dir einen Link, du meldest dich mit deinem Atlassian-Konto an und kopierst danach die <b>komplette Adresse</b> der Seite, auf der du landest (sie zeigt einen Verbindungsfehler — das ist so), zurück in den Chat.</li>
          {d?.terminal && <li>Oder im Terminal der Workspace: <code>{d.terminal}</code> → <code>/mcp</code> → <b>atlassian</b> → <b>Authenticate</b>.</li>}
          <li>Hier prüfen — es wird nur der Verbindungsstatus gelesen, kein Modellaufruf.</li>
        </ol>
        <div className="row">
          <button className="btn primary" disabled={!claude || busy} onClick={async () => {
            setBusy(true); setErr(null);
            try { const r: any = await api('/api/setup/mcp/check', { method: 'POST' }); setHelp(r.help); await m.reload(); } catch (e) { setErr(e); } finally { setBusy(false); }
          }}>{busy ? 'Prüfe …' : 'Jira-MCP prüfen'}</button>
          {!claude && <span className="tiny">erst Claude verbinden</span>}
        </div>
        {help && <p className="small">{help}</p>}
        <p className="tiny">Ohne verbundenen MCP: keine Pflegefragen im Chat (nur die 🧹-Badges am Board, einmal ein Hinweis), und Schreibaktionen melden sich mit dieser Anleitung.</p>
        <Err e={err} />
      </div>
    </div>
  );
}

function Wizard({ cfg }: { cfg: Config }) {
  const st = useLoad(() => api('/api/setup/status'));
  const toast = useToast();
  const confirm = useConfirm();
  const [token, setToken] = useState('');
  const [jEmail, setJEmail] = useState(cfg.user?.email ?? '');
  const [jToken, setJToken] = useState('');
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState('');
  if (st.loading && !st.data) return <div className="page"><Loading /></div>;
  if (st.error) return <div className="page"><Err e={st.error} /></div>;
  const s: any = st.data;
  const run = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what); setErr(null);
    try { await fn(); await st.reload(); } catch (e) { setErr(e); } finally { setBusy(''); }
  };
  const allOk = s.claude.connected && s.jira.connected;
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="head">
        <div>
          <h1>Einrichtung</h1>
          <p className="muted" style={{ margin: 0 }}>Einmal durchklicken, dann arbeitet Claude Code im Chat, am Board und im Sprint mit deinen eigenen Zugängen.</p>
        </div>
        {!embedded && <a className="btn primary" href={cfg.librechatUrl}>💬 Zum Chat</a>}
      </div>
      <Err e={err} />
      <div className="steps" style={{ marginTop: 12 }}>
        <div className="step done">
          <div className="num">✓</div>
          <div className="card"><b>Konto</b> — angemeldet als {s.user.name} ({s.user.email}).</div>
        </div>

        <div className={`step ${s.claude.connected ? 'done' : ''}`}>
          <div className="num">{s.claude.connected ? '✓' : '2'}</div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Eigenes Claude verbinden</h3>
            {s.claude.connected
              ? <p className="okbox">Verbunden{s.claude.expiresAt ? `, gültig bis ${fmtDateTime(s.claude.expiresAt)}` : ' (läuft nicht ab)'}. Der Token liegt verschlüsselt im Chat-Schlüsselspeicher und gilt dort genauso.</p>
              : <p>Die Werkbank arbeitet ohne API-Schlüssel — mit <b>deinem</b> Claude-Abo.</p>}
            <ol className="small">
              <li>Im Terminal (auf deinem Rechner oder in der Coder-Workspace) mit deinem Claude-Konto angemeldet: <code>claude setup-token</code></li>
              <li>Den ausgegebenen Token kopieren (beginnt mit <code>sk-ant-oat</code>). Er gilt ein Jahr.</li>
              <li>Hier einfügen und speichern. (Alternativ im Chat: Modell-Menü → „Claude Code“ → Zahnrad, Ablauf „nie“.)</li>
            </ol>
            <form className="row" onSubmit={(e) => { e.preventDefault(); run('claude', async () => { await api('/api/setup/claude', { body: { token } }); setToken(''); toast('Claude verbunden'); }); }}>
              <input type="password" aria-label="Claude-Token" placeholder="sk-ant-oat…" value={token} onChange={(e) => setToken(e.target.value)} style={{ flex: 1, minWidth: 260 }} autoComplete="off" />
              <button className="btn primary" disabled={!token || busy === 'claude'}>{s.claude.connected ? 'Ersetzen' : 'Speichern'}</button>
              {s.claude.connected && <button type="button" className="btn danger" onClick={async () => {
                if (await confirm({ title: 'Claude trennen?', body: <p>Der Token wird gelöscht; Chat und Board-Agent arbeiten dann nicht mehr, bis du einen neuen einträgst.</p>, danger: true, confirmLabel: 'Trennen' })) run('claude', () => api('/api/setup/claude', { method: 'DELETE' }));
              }}>Trennen</button>}
            </form>
          </div>
        </div>

        <div className={`step ${s.jira.connected ? 'done' : ''}`}>
          <div className="num">{s.jira.connected ? '✓' : '3'}</div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Jira lesen (Board-Kopie)</h3>
            {s.jira.connected && <p className="okbox">Verbunden als {s.jira.email} · Quelle: {s.jira.source}{s.jira.canWrite === false ? ' · nur lesen' : s.jira.canWrite ? ' · darf schreiben' : ''}.</p>}
            {s.jira.source === 'Pilot (Vaultwarden der VM)' && <p className="note small">Pilot: gelesen wird mit dem Team-Lesetoken „Jira api“ aus dem Vaultwarden der VM. Er darf <b>nicht schreiben</b> — geschrieben wird über den Atlassian-MCP (nächster Schritt).</p>}
            <ol className="small">
              <li><a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer">id.atlassian.com → API-Tokens</a> → <b>API-Token mit Bereichen erstellen</b> → App <b>Jira</b>.</li>
              <li>Bereich: <code>read:jira-work</code> reicht (geschrieben wird über den Atlassian-MCP). Ablaufdatum setzen.</li>
              <li>E-Mail deines Atlassian-Kontos und den Token hier eintragen. Er wird verschlüsselt gespeichert, nie angezeigt und nie geloggt.</li>
            </ol>
            <form className="row" onSubmit={(e) => { e.preventDefault(); run('jira', async () => { const r: any = await api('/api/setup/jira', { body: { email: jEmail, token: jToken } }); setJToken(''); toast(r.count != null ? `Jira verbunden — ${r.count} Tickets in ${cfg.project} sichtbar` : 'Jira verbunden'); }); }}>
              <input type="email" aria-label="Atlassian-E-Mail" value={jEmail} onChange={(e) => setJEmail(e.target.value)} style={{ minWidth: 220 }} />
              <input type="password" aria-label="Atlassian-API-Token" placeholder="API-Token" value={jToken} onChange={(e) => setJToken(e.target.value)} style={{ flex: 1, minWidth: 200 }} autoComplete="off" />
              <button className="btn primary" disabled={!jToken || busy === 'jira'}>{busy === 'jira' ? 'Prüfe …' : 'Prüfen & speichern'}</button>
              {s.jira.source === 'eigener Token' && <button type="button" className="btn danger" onClick={() => run('jira', () => api('/api/setup/jira', { method: 'DELETE' }))}>Entfernen</button>}
            </form>
          </div>
        </div>

        <McpStep claude={s.claude.connected} />

        <div className={`step ${allOk ? 'done' : ''}`}>
          <div className="num">{allOk ? '✓' : '5'}</div>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Loslegen</h3>
            <div className="grid2">
              <a className="card soft" href={cfg.librechatUrl} target={chatTarget}><b>💬 Chat</b><div className="small muted">Claude Code mit Skills, Vault und Jira. Schreibt nur nach deinem „ja“.</div></a>
              <a className="card soft" href="#/wissen"><b>📚 Wissen</b><div className="small muted">Der Vault: Struktur, Roadmap, Suche, Backlinks.</div></a>
              <a className="card soft" href="#/board"><b>🗂️ Board</b><div className="small muted">Jira-Kopie von {cfg.project}, Agent auf Karte ansetzen.</div></a>
              <a className="card soft" href="#/sprint"><b>🔁 Sprint</b><div className="small muted">Review und Planning: Fragen beantworten, Sprint-Sync vorbereiten.</div></a>
              <a className="card soft" href="#/skills"><b>🧰 Skills</b><div className="small muted">{s.skills.linked} Team-Skills aus dem Vault aktiv{s.skills.missing ? `, ${s.skills.missing} noch nicht eingerichtet` : ''}.</div></a>
              <a className="card soft" href="#/dateien"><b>📎 Dateien & Teilen</b><div className="small muted">Dateien ablegen, mit Teammates teilen, geteilte Chats.</div></a>
            </div>
          </div>
        </div>
      </div>

      <Sessions />
      <ContextInfo />

      <h2>Dienste</h2>
      <div className="row">
        {Object.entries(s.services).map(([k, v]) => <span key={k} className={`chip ${v ? 'ok' : 'bad'}`}>{v ? '✓' : '✗'} {k}</span>)}
        <span className="chip">Suche: {s.search.docs} Notizen indiziert{s.search.error ? ` · Fehler: ${s.search.error}` : ''}</span>
      </div>
      <p className="tiny" style={{ marginTop: 8 }}>Betrieb: <code>scripts/werkbank.sh up|status|doctor</code> im Repo. Alles läuft nur in dieser Workspace; die Links sind nur mit Coder-Anmeldung erreichbar.</p>
    </div>
  );
}
