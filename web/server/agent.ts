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
export async function startAgentRun(u: User, token: string, issue: Issue, note: string): Promise<string> {
  const id = randomUUID();
  const runs = wb().collection('agent_runs');
  const running = await runs.findOne({ key: issue.key, status: 'läuft' });
  if (running) throw Object.assign(new Error('Auf diesem Ticket läuft schon ein Agent.'), { status: 409 });
  await runs.insertOne({ _id: id as any, key: issue.key, userId: u.id, userName: u.name, status: 'läuft', output: '', draft: null, startedAt: new Date() });
  const prompt = `${AGENT_INSTRUCTION}\n\n---\n\n${ticketPrompt(issue, note ? `Hinweis der Person: ${note}` : '')}`;
  (async () => {
    let output = '';
    let lastFlush = 0;
    try {
      const r = await fetch(`${cfg.bridgeUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`, 'content-type': 'application/json',
          'x-librechat-user-id': u.id, 'x-librechat-user-email': u.email,
          'x-librechat-conversation-id': `board-${issue.key}-${id.slice(0, 8)}`,
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
