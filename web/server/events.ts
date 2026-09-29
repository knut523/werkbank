// Änderungen an der Jira-Kopie sofort an offene Board-/Sprint-Seiten schieben (Knut, 29.09.: „instant update des
// board wenn etwas geändert geschrieben wird mit jira“). Server-Sent Events über GET /api/events.
//
// Quellen: refreshIssue (nach jedem bestätigten Schreiben über den MCP, nach Jira-Schreiben im Chat, das die Brücke
// meldet) und syncMirror (Abgleich alle 15 Minuten bzw. per Knopf, dann „all“).

import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface JiraChange { seq: number; keys: string[]; all?: boolean; why: string; at: number }

const bus = new EventEmitter();
bus.setMaxListeners(500);
let seq = 0;

export function jiraChanged(keys: string[], why: string, all = false) {
  const e: JiraChange = { seq: ++seq, keys: [...new Set(keys)], all: all || undefined, why, at: Date.now() };
  bus.emit('change', e);
  return e;
}

export function onJiraChange(fn: (e: JiraChange) => void): () => void {
  bus.on('change', fn);
  return () => bus.off('change', fn);
}

/** SSE-Strom für eine angemeldete Person. Kein Inhalt außer Schlüsseln; die Seite lädt dann selbst nach. */
export function jiraEventStream(req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    // no-transform: keine Kompression/Pufferung unterwegs (LibreChat-Proxy, Coder-Proxy).
    'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no', connection: 'keep-alive',
  });
  res.write(`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ seq })}\n\n`);
  const off = onJiraChange((e) => res.write(`event: jira\ndata: ${JSON.stringify(e)}\n\n`));
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  const close = () => { clearInterval(ping); off(); };
  req.on('close', close);
  res.on('error', close);
}
