// Jira schreiben (Kommentar, Status, Fälligkeit) — Knut, 29.09.: „Schreiben erstmal über MCP“.
//
// Lesen bleibt beim Lesetoken (Jira-Kopie, Übergänge). Geschrieben wird über den Atlassian-MCP in der
// Claude-Code-Sitzung der Person (claude-bridge /internal/mcp-call, mit ihrem Claude-Token und ihrer
// MCP-Anmeldung). Bestätigt ist die Aktion zu diesem Zeitpunkt schon (Dialog in der Oberfläche).
// WERKBANK_JIRA_WRITE=rest schreibt wie bisher per REST mit dem eigenen Token (nur mit write:jira-work).

import { cfg, siteFor, jiraSites, type JiraSite } from './config.ts';
import { wb } from './db.ts';
import { jiraCreds, getClaudeToken } from './creds.ts';
import { addComment, transitionTo, transitions, setDueDate, refreshIssue, jiraFetch, adfDoc, fremdVergessen, fetchPages } from './jira.ts';
import { projektSeite, jqlDuplikate, duplikatKandidaten, ungesehen, schluesselAus, type AnlegenEingabe, type Kandidat } from './jiraanlegen.ts';
import { log } from './log.ts';
import { sameLevelRemovals } from './goals.ts';
import type { User } from './auth.ts';

export type JiraAction = { type: 'comment'; text: string } | { type: 'status'; to: string } | { type: 'due'; date: string | null }
  | { type: 'labels'; add?: string[]; remove?: string[]; replaceLevelOf?: string } | { type: 'parent'; key: string }
  | { type: 'priority'; name: string } | { type: 'assignee'; accountId: string | null; name?: string };

/** Trockenlauf (Vorschau-Instanz): zeigen, was geschrieben würde, nichts nach Jira schreiben. */
export const dryRun = () => process.env.WERKBANK_JIRA_DRYRUN === '1' || process.env.WERKBANK_DRYRUN === '1';

const LABEL = /^[^\s]{1,255}$/;
export function describe(a: JiraAction): string {
  if (a.type === 'comment') return 'Kommentar';
  if (a.type === 'status') return `Status → ${a.to}`;
  if (a.type === 'due') return `Fällig → ${a.date || 'ohne'}`;
  if (a.type === 'labels') return `Labels ${[...(a.add ?? []).map((x) => '+' + x), ...(a.remove ?? []).map((x) => '−' + x)].join(' ')}`;
  if (a.type === 'priority') return `Priorität → ${a.name}`;
  if (a.type === 'assignee') return `Owner → ${a.name ?? a.accountId ?? 'niemand'}`;
  return `Parent → ${a.key}`;
}

export function editFields(a: JiraAction): Record<string, unknown> {
  if (a.type === 'priority') return { priority: { name: a.name } };
  if (a.type === 'assignee') return { assignee: a.accountId ? { accountId: a.accountId } : null };
  return {};
}

/** Neue Label-Liste aus der aktuellen (frisch gelesenen) und den Änderungen. */
export function applyLabels(current: string[], add: string[] = [], remove: string[] = []): string[] {
  const rm = new Set(remove);
  return [...new Set([...current.filter((l) => !rm.has(l)), ...add.filter((l) => !rm.has(l))])];
}

export class JiraWriteError extends Error {
  status: number; code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

export const writeMode = () => (process.env.WERKBANK_JIRA_WRITE === 'rest' ? 'rest' : 'mcp');

// Anmeldung beim Atlassian-MCP: gilt je Claude-Konfiguration (je Person .runtime/claude/<id>, Pilot ~/.claude).
// Am einfachsten im Werkbank-Chat — Claude Code bietet dort bei „needs-auth“ das Werkzeug authenticate an (Link öffnen,
// anmelden, die Adresse der Fehlerseite in den Chat kopieren). Terminal-Weg in der README.
export const MCP_HELP = 'Einmalig anmelden: unter „Einrichtung“ → „Im Chat bei Jira anmelden“ (Link öffnen, mit deinem Atlassian-Konto anmelden, die Adresse der danach erscheinenden Fehlerseite in den Chat kopieren). Danach „Jira-MCP prüfen“.';

const MESSAGES: Record<string, string> = {
  mcp_auth: `Jira-Schreiben über den Atlassian-MCP ist nicht angemeldet (401 / Anmeldung abgelaufen). ${MCP_HELP}`,
  mcp_missing: 'Der Atlassian-MCP ist im OLAF Workspace abgeschaltet (BRIDGE_ATLASSIAN_MCP_URL=off) — Jira-Schreiben geht so nicht.',
  claude_auth: 'Dein Claude-Token wurde abgelehnt — unter „Einrichtung“ einen neuen aus `claude setup-token` eintragen.',
  not_called: 'Claude hat den Jira-Aufruf nicht ausgeführt. Bitte noch einmal versuchen.',
};

async function bridge(path: string, token: string, body: unknown): Promise<any> {
  const r = await fetch(cfg.bridgeUrl + path, {
    method: 'POST', signal: AbortSignal.timeout(150_000),
    headers: { 'content-type': 'application/json', 'x-werkbank-internal': process.env.WERKBANK_INTERNAL_TOKEN ?? '', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (r.status === 403) throw new JiraWriteError(500, 'failed', 'Brücke lehnt ab (interner Token fehlt).');
  return r.json();
}

async function claudeToken(u: User): Promise<string> {
  const t = await getClaudeToken(u);
  if (!t) throw new JiraWriteError(412, 'claude_missing', 'Für Jira-Schreiben über den MCP brauchst du dein Claude — unter „Einrichtung“ den Token aus `claude setup-token` eintragen.');
  return t;
}

/** Ein MCP-Aufruf; Fehler werden zu klaren Meldungen. */
export async function mcpWrite(u: User, tool: string, input: Record<string, unknown>): Promise<string> {
  const r = await bridge('/internal/mcp-call', await claudeToken(u), { userId: u.id, email: u.email, tool, input });
  if (r.ok) return String(r.result ?? '');
  await setMcpState(u, r.error === 'mcp_auth' || r.error === 'mcp_missing' ? r.error : null);
  throw new JiraWriteError(r.error === 'tool_error' ? 502 : 412, r.error, MESSAGES[r.error] ?? `Jira (MCP): ${r.message ?? 'Fehler'}`);
}

async function setMcpState(u: User, problem: string | null) {
  await wb().collection('mcp_status').updateOne({ _id: u.id as any }, { $set: problem ? { problem, problemAt: new Date() } : { problem: null, status: 'connected', checkedAt: new Date() } }, { upsert: true });
}

/** Atlassian-MCP der Person prüfen (nur Init der Sitzung, kein Modellaufruf). */
export async function checkMcp(u: User) {
  const r = await bridge('/internal/mcp-status', await claudeToken(u), { userId: u.id, email: u.email });
  const s = (r.servers ?? []).find((x: any) => x.name === 'atlassian');
  const status = s?.status ?? 'fehlt';
  const doc = { status, checkedAt: new Date(), problem: status === 'connected' ? null : status === 'fehlt' ? 'mcp_missing' : 'mcp_auth', home: r.home ?? null };
  await wb().collection('mcp_status').updateOne({ _id: u.id as any }, { $set: doc }, { upsert: true });
  return { ...doc, help: status === 'connected' ? null : MESSAGES[doc.problem!] };
}

export async function mcpState(u: User) {
  const d: any = await wb().collection('mcp_status').findOne({ _id: u.id as any });
  return d ? { status: d.status ?? null, checkedAt: d.checkedAt ?? null, problem: d.problem ?? null, home: d.home ?? null } : { status: null, checkedAt: null, problem: null, home: null };
}

/** Ist Jira-Schreiben für diese Person möglich? (für Pflegefragen: nur fragen, wenn ja) */
export async function canWriteJira(u: User): Promise<boolean> {
  if (dryRun()) return true;
  if (writeMode() === 'rest') return !!(await jiraCreds(u));
  const s = await mcpState(u);
  return s.status === 'connected' && !s.problem;
}

/** Führt bestätigte Aktionen auf einem Ticket aus. Lesen (Übergänge, Kopie) mit dem Lesezugang. */
export async function writeJira(u: User, key: string, actions: JiraAction[]): Promise<{ done: string[]; via: 'mcp' | 'rest'; dryRun?: boolean; calls?: { tool: string; input: unknown }[] }> {
  const read = await jiraCreds(u);
  const done: string[] = [];
  const via = writeMode();
  const calls: { tool: string; input: unknown }[] = [];
  const dry = dryRun();
  // Release 31 (Schnitt 2): Seite nach Präfix — Tickets der zweiten Seite (OLAF-…) mit deren cloudId; die Aufrufer lassen
  // fremde Schlüssel nur mit WERKBANK_JIRA_ZWEI_SEITEN=on durch. REST schreibt nur auf die Hauptseite.
  const site = siteFor(key);
  if (!site.main && via === 'rest' && !dry) throw new JiraWriteError(409, 'rest_site', `${key} liegt auf ${site.site.replace(/^https:\/\//, '')} — dort schreibt die Werkbank nur über den Jira-MCP (WERKBANK_JIRA_WRITE=rest gilt nur für die Hauptseite).`);
  for (const a of actions) {
    if (a.type === 'comment' && !a.text?.trim()) continue;
    if (a.type === 'labels') {
      for (const l of [...(a.add ?? []), ...(a.remove ?? [])]) if (!LABEL.test(l)) throw new JiraWriteError(400, 'bad_label', `Ungültiges Label „${l}“ (keine Leerzeichen).`);
      if (!(a.add?.length || a.remove?.length)) continue;
    }
    if (a.type === 'parent' && !/^[A-Z][A-Z0-9]+-\d+$/.test(a.key)) throw new JiraWriteError(400, 'bad_parent', 'Ungültiger Parent-Schlüssel.');
    if (a.type === 'due' && a.date && !/^\d{4}-\d{2}-\d{2}$/.test(a.date)) throw new JiraWriteError(400, 'bad_date', 'Datum im Format JJJJ-MM-TT.');
    const base = { cloudId: site.cloudId, issueIdOrKey: key };
    // Aktuelle Labels frisch lesen (Lesezugang), damit nichts überschrieben wird, was inzwischen dazukam.
    // Ohne frische Liste wird nicht geschrieben (die Kopie kann 15 min alt sein → Labels würden überschrieben).
    const currentLabels = async (): Promise<string[]> => {
      if (!read && dry) { const d: any = await wb().collection('jira_issues').findOne({ key }); return d?.labels ?? []; }   // nur Anzeige
      if (!read) throw new JiraWriteError(412, 'jira_missing', 'Für Label-Änderungen braucht der OLAF Workspace den Jira-Lesezugang (aktuelle Labels lesen).');
      try { const r = await jiraFetch(read, 'GET', `/issue/${encodeURIComponent(key)}?fields=labels`, undefined, site); return r?.fields?.labels ?? []; }
      catch (e: any) { throw new JiraWriteError(502, 'labels_read', `Aktuelle Labels von ${key} nicht lesbar — nichts geschrieben (${String(e.message).slice(0, 120)}).`); }
    };
    // Ziel ersetzen: die zu entfernenden Labels derselben Ebene aus der FRISCH gelesenen Liste (nicht aus der Kopie).
    if (a.type === 'labels' && a.replaceLevelOf) {
      const fresh = await currentLabels();
      a.remove = [...new Set([...(a.remove ?? []), ...sameLevelRemovals(fresh, a.replaceLevelOf)])].filter((l) => !(a.add ?? []).includes(l));
    }
    if (dry) {
      // Nur beschreiben, was geschrieben würde (Übergänge/Labels werden lesend aufgelöst).
      if (a.type === 'comment') calls.push({ tool: 'mcp__atlassian__addCommentToJiraIssue', input: { ...base, commentBody: a.text.trim(), contentFormat: 'markdown' } });
      if (a.type === 'status') {
        let t: any = null;
        if (read) { try { const ts = await transitions(read, key, site); t = ts.find((x) => x.to.toLowerCase() === a.to.toLowerCase()) ?? ts.find((x) => x.name.toLowerCase() === a.to.toLowerCase()); if (!t) throw new JiraWriteError(400, 'no_transition', `Von hier aus gibt es keinen Übergang nach „${a.to}“ (möglich: ${ts.map((x) => x.to).join(', ') || '—'}).`); } catch (e) { if (e instanceof JiraWriteError) throw e; } }
        calls.push({ tool: 'mcp__atlassian__transitionJiraIssue', input: { ...base, transition: { id: t?.id ?? `(Übergang nach ${a.to})` } } });
      }
      if (a.type === 'due') calls.push({ tool: 'mcp__atlassian__editJiraIssue', input: { ...base, fields: { duedate: a.date || null } } });
      if (a.type === 'labels') calls.push({ tool: 'mcp__atlassian__editJiraIssue', input: { ...base, fields: { labels: applyLabels(await currentLabels(), a.add, a.remove) } } });
      if (a.type === 'parent') calls.push({ tool: 'mcp__atlassian__editJiraIssue', input: { ...base, fields: { parent: { key: a.key } } } });
      if (a.type === 'priority' || a.type === 'assignee') calls.push({ tool: 'mcp__atlassian__editJiraIssue', input: { ...base, fields: editFields(a) } });
    } else if (via === 'rest') {
      if (!read) throw new JiraWriteError(412, 'jira_missing', 'Kein Jira-Zugang hinterlegt — unter „Einrichtung“ verbinden.');
      if (a.type === 'comment') await addComment(read, key, a.text.trim());
      if (a.type === 'status') await transitionTo(read, key, a.to);
      if (a.type === 'due') await setDueDate(read, key, a.date || null);
      if (a.type === 'labels') await jiraFetch(read, 'PUT', `/issue/${encodeURIComponent(key)}`, { update: { labels: [...(a.add ?? []).map((l) => ({ add: l })), ...(a.remove ?? []).map((l) => ({ remove: l }))] } });
      if (a.type === 'parent') await jiraFetch(read, 'PUT', `/issue/${encodeURIComponent(key)}`, { fields: { parent: { key: a.key } } });
      if (a.type === 'priority' || a.type === 'assignee') await jiraFetch(read, 'PUT', `/issue/${encodeURIComponent(key)}`, { fields: editFields(a) });
    } else {
      if (a.type === 'comment') await mcpWrite(u, 'mcp__atlassian__addCommentToJiraIssue', { ...base, commentBody: a.text.trim(), contentFormat: 'markdown' });
      if (a.type === 'status') {
        if (!read) throw new JiraWriteError(412, 'jira_missing', 'Für die Übergänge braucht der OLAF Workspace den Jira-Lesezugang (Einrichtung).');
        const ts = await transitions(read, key, site);
        const t = ts.find((x) => x.to.toLowerCase() === a.to.toLowerCase()) ?? ts.find((x) => x.name.toLowerCase() === a.to.toLowerCase());
        if (!t) throw new JiraWriteError(400, 'no_transition', `Von hier aus gibt es keinen Übergang nach „${a.to}“ (möglich: ${ts.map((x) => x.to).join(', ') || '—'}).`);
        await mcpWrite(u, 'mcp__atlassian__transitionJiraIssue', { ...base, transition: { id: t.id } });
      }
      if (a.type === 'due') await mcpWrite(u, 'mcp__atlassian__editJiraIssue', { ...base, fields: { duedate: a.date || null } });
      if (a.type === 'labels') await mcpWrite(u, 'mcp__atlassian__editJiraIssue', { ...base, fields: { labels: applyLabels(await currentLabels(), a.add, a.remove) } });
      if (a.type === 'parent') await mcpWrite(u, 'mcp__atlassian__editJiraIssue', { ...base, fields: { parent: { key: a.key } } });
      if (a.type === 'priority' || a.type === 'assignee') await mcpWrite(u, 'mcp__atlassian__editJiraIssue', { ...base, fields: editFields(a) });
    }
    done.push(describe(a));
  }
  if (dry) {
    await wb().collection('jira_dryrun').insertOne({ at: new Date(), userId: u.id, user: u.name, key, done, calls } as any);
    log('jira trockenlauf', { user: u.id, key, n: done.length });
    return { done, via, dryRun: true, calls };
  }
  if (via === 'mcp') await setMcpState(u, null);
  log('jira write', { user: u.id, key, via, n: done.length });
  // Sofort nachziehen (Kopie + offene Boards). Ohne eigenen Lesezugang mit dem der Kopie (Entscheidung 3: Knuts Token).
  if (!site.main) { fremdVergessen(key); return { done, via }; }   // zweite Seite: keine Kopie, nur der Lese-Zwischenspeicher
  const mirror = read ?? (await jiraCreds(null));
  if (mirror) { try { await refreshIssue(mirror, key); } catch { /* nächster Sync */ } }
  return { done, via };
}

// ---------- Anlegen auf beiden Seiten (Release 31, Schnitt 2) ----------

/** Seite eines Projekts oder ein klarer Fehler (kein stiller Rückfall auf die Hauptseite). */
export function seiteVonProjekt(projekt: string, sites = jiraSites()): JiraSite {
  const s = projektSeite(projekt, sites) as JiraSite | null;
  if (!s) throw new JiraWriteError(400, 'bad_project', `Projekt ${projekt} ist keiner Jira-Seite zugeordnet (bekannt: ${sites.map((x) => x.prefix).join(', ')}).`);
  return s;
}

/** Duplikatsuche im Projekt über den Lesezugang (JQL, Volltext auf den Titel); Kandidaten ab der Schwelle. */
export async function duplikateSuchen(u: User, projekt: string, titel: string): Promise<{ site: string; jql: string; kandidaten: Kandidat[] }> {
  const site = seiteVonProjekt(projekt);
  const read = await jiraCreds(u);
  if (!read) throw new JiraWriteError(412, 'jira_missing', 'Für die Duplikatsuche braucht der OLAF Workspace deinen Jira-Lesezugang (Einrichtung).');
  let jql: string;
  try { jql = jqlDuplikate(projekt, titel); } catch (e: any) { throw new JiraWriteError(400, 'bad_title', String(e.message)); }
  const r = await fetchPages(read, jql, 50, site.main ? undefined : site, ['summary', 'status']);
  return { site: site.site, jql, kandidaten: duplikatKandidaten(titel, r.issues) };
}

/**
 * Ticket anlegen (nach Klick auf die Karte der Brücke). Vorher sucht die Werkbank selbst noch einmal nach Duplikaten: ein
 * Treffer, der nicht unter `gesehen` steht → nichts angelegt (409 mit den Kandidaten). Trockenlauf: nur protokollieren.
 */
export async function anlegenJira(u: User, e: AnlegenEingabe): Promise<{ key: string | null; site: string; via: 'mcp' | 'rest'; dryRun?: boolean; kandidaten: Kandidat[] }> {
  const site = seiteVonProjekt(e.projekt);
  const via = writeMode();
  const dup = await duplikateSuchen(u, e.projekt, e.titel);
  const neu = ungesehen(dup.kandidaten, e.gesehen);
  if (neu.length) throw Object.assign(new JiraWriteError(409, 'duplikat', `Nichts angelegt — mögliche Duplikate, die noch nicht als gesehen gemeldet sind: ${neu.map((k) => `${k.key} „${k.summary}“ (${k.status})`).join('; ')}. Erst prüfen; ist es trotzdem neu, mit duplikate_gesehen = [${neu.map((k) => k.key).join(', ')}] noch einmal.`), { kandidaten: neu });
  const input = { cloudId: site.cloudId, projectKey: e.projekt, issueTypeName: e.typ, summary: e.titel, ...(e.beschreibung ? { description: e.beschreibung } : {}), contentFormat: 'markdown', ...(e.faellig ? { additional_fields: { duedate: e.faellig } } : {}) };
  if (dryRun()) {
    await wb().collection('jira_dryrun').insertOne({ at: new Date(), userId: u.id, user: u.name, key: `${e.projekt}-(neu)`, done: ['Anlegen'], calls: [{ tool: 'mcp__atlassian__createJiraIssue', input }], gesehen: e.gesehen } as any);
    log('jira trockenlauf (anlegen)', { user: u.id, projekt: e.projekt });
    return { key: null, site: site.site, via, dryRun: true, kandidaten: dup.kandidaten };
  }
  let key: string | null;
  if (via === 'rest') {
    if (!site.main) throw new JiraWriteError(409, 'rest_site', `Projekt ${e.projekt} liegt auf ${site.site.replace(/^https:\/\//, '')} — dort legt die Werkbank nur über den Jira-MCP an.`);
    const read = await jiraCreds(u);
    if (!read) throw new JiraWriteError(412, 'jira_missing', 'Kein Jira-Zugang hinterlegt — unter „Einrichtung“ verbinden.');
    const r = await jiraFetch(read, 'POST', '/issue', { fields: { project: { key: e.projekt }, issuetype: { name: e.typ }, summary: e.titel, ...(e.beschreibung ? { description: adfDoc(e.beschreibung) } : {}), ...(e.faellig ? { duedate: e.faellig } : {}) } });
    key = r?.key ?? null;
  } else {
    key = schluesselAus(await mcpWrite(u, 'mcp__atlassian__createJiraIssue', input), e.projekt);
    await setMcpState(u, null);
  }
  log('jira angelegt', { user: u.id, projekt: e.projekt, key, via });
  // Angelegt, aber kein Schlüssel erkannt: nicht als Erfolg melden (Gegenprüfung 02.11.) — sonst legt ein zweiter Versuch doppelt an.
  if (!key) throw new JiraWriteError(502, 'kein_schluessel', `Jira hat das Anlegen angenommen, der neue Schlüssel war aber nicht zu erkennen. NICHT erneut anlegen — erst jira_duplikate mit demselben Titel, das Ticket ist vermutlich da.`);
  if (key && site.main) { const mirror = (await jiraCreds(u)) ?? (await jiraCreds(null)); if (mirror) { try { await refreshIssue(mirror, key); } catch { /* nächster Sync */ } } }
  return { key, site: site.site, via, kandidaten: dup.kandidaten };
}

/** Einmaliger Hinweis im Chat, wenn Pflegefragen wegen fehlendem Jira-MCP ausfallen (true = jetzt zeigen). */
export async function takeMcpHint(u: User): Promise<boolean> {
  const r = await wb().collection('mcp_status').updateOne({ _id: u.id as any, hintShownAt: { $exists: false } }, { $set: { hintShownAt: new Date() } });
  if (r.matchedCount) return true;
  const d = await wb().collection('mcp_status').findOne({ _id: u.id as any });
  if (d) return false;
  await wb().collection('mcp_status').insertOne({ _id: u.id as any, hintShownAt: new Date() } as any);
  return true;
}
