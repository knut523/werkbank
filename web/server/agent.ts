// "Agent ansetzen" (Idee: kandev / Vibe Kanban): eine Claude-Code-Sitzung über die claude-bridge,
// mit dem Ticket als Kontext, unter dem EIGENEN Claude-Token der Person (aus dem LibreChat-
// Schlüsselspeicher). Modus "nur lesen": jede Schreibaktion wird von der Brücke abgelehnt.
// Das Ergebnis landet als Entwurf an der Karte; nach Jira geht er erst nach einem Klick.

import { randomUUID } from 'node:crypto';
import { cfg, browseUrl } from './config.ts';
import { wb } from './db.ts';
import type { User } from './auth.ts';
import type { Issue } from './jira.ts';

export function ticketPrompt(i: Issue, extra = ''): string {
  return [
    `Ticket ${i.key} aus dem Jira-Board PM (Projekt „OLAF“): ${i.summary}`,
    `Link: ${browseUrl(i.key)}`,
    `Status: ${i.status} · Owner: ${i.assignee ?? '—'} · Fällig: ${i.duedate ?? '—'} · Priorität: ${i.priority ?? '—'} · Workstream: ${i.workstream ?? '—'}`,
    i.description ? `Beschreibung (Auszug):\n${i.description}` : '',
    i.lastComment ? `Letzter Kommentar (${i.lastComment.author}, ${i.lastComment.created.slice(0, 10)}):\n${i.lastComment.text}` : '',
    extra,
  ].filter(Boolean).join('\n\n');
}

export const AGENT_INSTRUCTION = `Du arbeitest vom Werkbank-Board aus an diesem Ticket, im Modus NUR LESEN: Lies Vault, Skills (olaf-jira, olaf-sprint-planning) und Jira, aber ändere nichts — Schreibaktionen werden hier automatisch abgelehnt.
Aufgabe: Finde heraus, wo das Ticket wirklich steht (Vault-Register vor Code, Board-Stand ist nicht Arbeitsstand), was als Nächstes zu tun ist und was fehlt.
Schließe mit einem Abschnitt, der genau mit der Zeile "### Kommentarentwurf" beginnt: ein kurzer, sachlicher Jira-Kommentar auf Deutsch (höchstens 8 Zeilen), den die Person prüfen und dann selbst senden kann. Keine neuen Tickets vorschlagen, ohne dass es ausdrücklich gewünscht ist.`;

export function extractDraft(output: string): string {
  const i = output.lastIndexOf('### Kommentarentwurf');
  const text = (i >= 0 ? output.slice(i + '### Kommentarentwurf'.length) : output)
    .replace(/^\s*\*[^*\n]*\*\s*$/gm, '')    // Statuszeilen der Brücke (kursiv)
    .trim();
  return text.slice(0, 4000);
}

/** Startet den Lauf im Hintergrund; der Stand liegt in werkbank.agent_runs. */
export async function startAgentRun(u: User, token: string, issue: Issue, note: string, followUp?: { conv: string; parent: string }, kind: 'ticket' | 'forge' = 'ticket'): Promise<string> {
  const id = randomUUID();
  const runs = wb().collection('agent_runs');
  const running = await runs.findOne({ key: issue.key, status: 'läuft' });
  if (running) throw Object.assign(new Error('Auf diesem Ticket läuft schon ein Agent.'), { status: 409 });
  // Nachfrage (Idee: Vibe Kanban „follow-up“): dieselbe Sitzung der Brücke fortsetzen.
  const conv = followUp?.conv ?? `board-${issue.key}-${id.slice(0, 8)}`;
  await runs.insertOne({ _id: id as any, key: issue.key, userId: u.id, userName: u.name, status: 'läuft', output: '', draft: null, startedAt: new Date(), conv, parent: followUp?.parent ?? null, note: note.slice(0, 300), kind });
  const prompt = followUp
    ? `Nachfrage der Person zu deinem Ergebnis: ${note}\n\nSchließe wieder mit "### Kommentarentwurf".`
    : kind === 'forge'
      ? `${AGENT_INSTRUCTION}\n\nZusätzlich: Prüfe den Pull Request ${note} mit dem Werkzeug forge-review: \`review_pr\` mit \`wait_seconds: 30\`, danach \`review_status\` mit der run_id abfragen, bis der Lauf fertig ist. Nur Entwurf, nichts auf GitHub posten. Fasse die Befunde mit Bezug zum Ticket zusammen: gleiche Befunde aus verschiedenen Concerns zusammenlegen, je Befund Datei:Zeile, Schwere und ob er verifiziert ist. Ist der Status \`incomplete\`, schreibe das in die erste Zeile mit den Gründen — ein unvollständiges Review ist nie „sauber“.\n\n---\n\n${ticketPrompt(issue)}`
      : `${AGENT_INSTRUCTION}\n\n---\n\n${ticketPrompt(issue, note ? `Hinweis der Person: ${note}` : '')}`;
  (async () => {
    let output = '';
    let lastFlush = 0;
    try {
      const r = await fetch(`${cfg.bridgeUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`, 'content-type': 'application/json',
          'x-librechat-user-id': u.id, 'x-librechat-user-email': u.email,
          'x-librechat-conversation-id': conv,
          'x-werkbank-mode': 'readonly',
        },
        body: JSON.stringify({ model: 'claude-code', stream: true, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!r.ok || !r.body) throw new Error(`Brücke antwortet mit ${r.status}`);
      const dec = new TextDecoder();
      let buf = '';
      for await (const chunk of r.body as any) {
        buf += dec.decode(chunk, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data: {')) continue;
          try { output += JSON.parse(line.slice(6)).choices?.[0]?.delta?.content ?? ''; } catch { /* Teilzeile */ }
        }
        if (Date.now() - lastFlush > 1500) { lastFlush = Date.now(); await runs.updateOne({ _id: id as any }, { $set: { output } }); }
      }
      await runs.updateOne({ _id: id as any }, { $set: { output, status: 'fertig', endedAt: new Date(), draft: extractDraft(output) } });
    } catch (e: any) {
      await runs.updateOne({ _id: id as any }, { $set: { output, status: 'fehler', error: String(e.message ?? e).slice(0, 300), endedAt: new Date() } });
    }
  })();
  return id;
}

/** Link, der in LibreChat einen neuen Chat mit Text startet (autoSubmitFromUrl). */
export function chatUrl(prompt: string, opts: { spec?: string; submit?: boolean } = {}): string {
  const p = new URLSearchParams();
  p.set('spec', opts.spec ?? 'claude-code-olaf');
  p.set('prompt', prompt.slice(0, 6000));
  if (opts.submit !== false) p.set('submit', 'true');
  return `${cfg.librechatPublicUrl}/c/new?${p.toString()}`;
}

// ---------- „Agent ansetzen“ als echter Chat (Knut, 29.09.) ----------
//
// Die Werkbank legt im Namen der Person eine LibreChat-Unterhaltung „PM-123 · Titel“ an (derselbe Aufruf
// wie der Senden-Knopf im Chat, mit einem kurzlebigen Zugangstoken). LibreChat fährt den Zug serverseitig
// (fortsetzbarer Stream) — der Agent arbeitet also auch ohne offenen Tab; wer den Chat öffnet, sieht den
// Fortschritt live. Schreiben fragt die Brücke im Chat ab („ja“), GitHub-Schreiben ist gesperrt.

import { librechatAccessToken } from './auth.ts';

export const CHAT_AGENT_INSTRUCTION = `Du bist vom Werkbank-Board auf dieses Ticket angesetzt. Arbeite nach plan-to-pr — auch wenn es keine Coding-Aufgabe ist (Recherche, Dokument, Abstimmung):
1. Lies zuerst, was Vault-Register und Jira sagen (Vault vor Code, Board-Stand ist nicht Arbeitsstand).
2. Schreib dann einen kurzen Plan (Skill plan-to-pr bzw. grilling): Ziel, Ergebnis (was am Ende übergeben wird und wo es liegt), Stand heute, Schnitte, Definition of Done. Leg ihn als Vault-Notiz ab — im Workstream-Bereich unten, wenn einer genannt ist, sonst neben die passende Area-Notiz —, mit \`jira: <Key>\` und \`projekt: <Projekt>\` im Frontmatter.
3. Stell danach alle offenen inhaltlichen Entscheidungen auf einmal, als Text am Ende deiner Antwort (je Kontext · Optionen · Empfehlung · leere Zeile „  - {{NAME}}:“), und setz erst nach den Antworten um. Gibt es keine, sag das und mach weiter. Ob du eine Datei schreiben oder einen Befehl ausführen darfst, fragst du nicht selbst — ruf das Werkzeug direkt auf, das System fragt, wo nötig.
4. Setz dann die Schnitte um. GitHub pushen und mergen ist gesperrt.
5. Neue Vault-Notizen oder Dateien zu diesem Ticket bekommen im Frontmatter \`jira: <Key>\` (dann erscheinen sie an der Karte); Dokumente, die du erstellst, landen nach dem Lauf von selbst unter „Meine Dateien“.
6. Keine neuen Tickets ohne ausdrücklichen Auftrag.
Schließe mit „### Stand“ (3–5 Zeilen: was erledigt ist, was offen ist, wer dran ist) und „### Kommentarentwurf“ (höchstens 8 Zeilen für Jira).`;

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 OLAF-Werkbank';

/** Legt die Unterhaltung an und schickt die erste Nachricht; liefert die LibreChat-Unterhaltungs-ID. */
export async function createLibreChat(u: User, text: string): Promise<string> {
  const token = await librechatAccessToken(u);
  const r = await fetch(`${cfg.librechatUrl}/api/agents/chat/${encodeURIComponent('Claude Code')}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': UA },
    body: JSON.stringify({
      text, sender: 'User', isCreatedByUser: true, parentMessageId: '00000000-0000-0000-0000-000000000000', messageId: randomUUID(),
      clientTimestamp: new Date().toISOString().slice(0, 19), error: false,
      endpoint: 'Claude Code', endpointType: 'custom', model: 'claude-code', modelLabel: 'Claude Code (OLAF)', spec: 'claude-code-olaf',
      key: 'never', modelDisplayLabel: 'Claude Code', isTemporary: false, isRegenerate: false, isContinued: false,
      ephemeralAgent: { mcp: [], web_search: false, file_search: false, execute_code: false, artifacts: '' }, timezone: 'Europe/Vienna',
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j.conversationId) {
    const why = j?.message ?? j?.error ?? `LibreChat antwortet mit ${r.status}`;
    throw Object.assign(new Error(/no_user_key/.test(JSON.stringify(j)) ? 'Im Chat ist noch kein Claude-Token hinterlegt — unter „Einrichtung“ eintragen.' : `Chat konnte nicht angelegt werden: ${String(why).slice(0, 200)}`), { status: 502 });
  }
  return String(j.conversationId);
}

export interface AgentPlace { projectName?: string | null; areaDir?: string | null; personName?: string | null }

/** Projekt und Workstream-Bereich als Zeile für den Prompt (Plan 81, Schnitte 6/7). */
export function placeLine(place: AgentPlace = {}): string {
  const parts = [place.projectName ? `Projekt: ${place.projectName}` : '', place.areaDir ? `Workstream-Bereich im Vault: ${place.areaDir}/ (Plan und neue Notizen dorthin, wenn es keinen besseren Ort gibt)` : ''].filter(Boolean);
  return parts.join('\n');
}

export function chatAgentPrompt(i: Issue, note: string, kind: 'work' | 'discuss', place: AgentPlace = {}): string {
  // Erste Zeile = Titel der Unterhaltung (die Brücke übernimmt „PM-123 · Titel“ unverändert).
  const title = `${i.key} · ${i.summary}`.slice(0, 80);
  return kind === 'discuss'
    ? `${title}\n\n${ticketPrompt(i)}\n\nLass uns an diesem Ticket arbeiten. Lies zuerst, was Vault und Jira dazu sagen.${note ? `\n\n${note}` : ''}`
    : `${title}\n\n${CHAT_AGENT_INSTRUCTION.replace('{{NAME}}', (place.personName || 'Name').split(/\s+/)[0])}\n\n---\n\n${ticketPrompt(i, [placeLine(place), note ? `Hinweis der Person: ${note}` : ''].filter(Boolean).join('\n\n'))}`;
}

export async function startChatAgent(u: User, issue: Issue, note: string, kind: 'work' | 'discuss' = 'work', place: AgentPlace & { projectId?: string | null } = {}): Promise<{ id: string; conv: string; url: string }> {
  const runs = wb().collection('agent_runs');
  if (kind === 'work' && await runs.findOne({ key: issue.key, userId: u.id, mode: 'chat', status: { $in: ['läuft', 'wartet auf ja'] } })) {
    throw Object.assign(new Error('Auf diesem Ticket arbeitet schon ein Agent von dir — im Chat weitermachen.'), { status: 409 });
  }
  const conv = await createLibreChat(u, chatAgentPrompt(issue, note, kind, place));
  const id = randomUUID();
  const url = `${cfg.librechatPublicUrl}/c/${conv}`;
  await runs.insertOne({ _id: id as any, key: issue.key, userId: u.id, userName: u.name, mode: 'chat', kind, status: kind === 'work' ? 'läuft' : 'fertig', conv, url, startedAt: new Date(), note: note.slice(0, 300), written: [], projectId: place.projectId ?? null });
  return { id, conv, url };
}

/** Status der Chat-Läufe aus der Brücke nachziehen (läuft / wartet auf ja / fertig) und geschriebene Dateien merken. */
export async function refreshChatRuns(filter: Record<string, unknown> = {}): Promise<void> {
  const runs = wb().collection('agent_runs');
  const open: any[] = await runs.find({ mode: 'chat', status: { $in: ['läuft', 'wartet auf ja'] }, ...filter }).toArray();
  const byUser = new Map<string, any[]>();
  for (const r of open) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r]);
  for (const [userId, rs] of byUser) {
    let sessions: any[] = [];
    try {
      const r = await fetch(`${cfg.bridgeUrl}/sessions?user=${encodeURIComponent(userId)}`, { headers: { 'x-werkbank-internal': process.env.WERKBANK_INTERNAL_TOKEN ?? '' }, signal: AbortSignal.timeout(3000) });
      sessions = ((await r.json()) as any).sessions ?? [];
    } catch { continue; }
    for (const run of rs) {
      const s = sessions.find((x) => x.conv === run.conv);
      // Noch nicht bei der Brücke angekommen: läuft (LibreChat bereitet vor). Nach 10 Minuten ohne Spur: fertig.
      const status = !s ? (Date.now() - new Date(run.startedAt).getTime() > 600_000 ? 'fertig' : 'läuft') : s.status === 'bereit' ? 'fertig' : s.status;
      const written = s?.written ?? run.written ?? [];
      if (status !== run.status || written.length !== (run.written ?? []).length) {
        await runs.updateOne({ _id: run._id }, { $set: { status, written, ...(status === 'fertig' ? { endedAt: new Date() } : {}) } });
      }
    }
  }
}
