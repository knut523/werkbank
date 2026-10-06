// Nachbau der Jira-REST-Endpunkte, die die Werkbank benutzt — für Tests und den Demo-Modus.
// Antwortformen wie Jira Cloud v3 (/search/jql mit nextPageToken, ADF-Beschreibungen,
// Transitions mit to.name). Schreibaufrufe werden mitgeschrieben (writes), nichts verlässt den Rechner.
// Standalone: node test/jira-mock.ts 3095

import { createServer, type Server } from 'node:http';

const adf = (t: string) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const user = (n: string) => ({ displayName: n, accountId: 'acc-' + n.toLowerCase().replace(/\W/g, '') });
const status = (n: string) => ({ name: n, statusCategory: { key: n === 'Done' ? 'done' : n === 'To Do' || n === 'Backlog' ? 'new' : 'indeterminate' } });

export function demoIssues() {
  const ws = (key: string, summary: string, owner: string) => ({ key, fields: { summary, status: status('In Progress'), issuetype: { name: 'Workstream' }, assignee: user(owner), parent: null, duedate: null, priority: { name: 'Medium' }, updated: '2026-09-20T10:00:00.000+0200', created: '2026-08-01T10:00:00.000+0200', description: adf(`Workstream ${summary}`), comment: { total: 0, comments: [] }, labels: [] } });
  const t = (key: string, summary: string, st: string, owner: string | null, parent: string, due: string | null, type = 'Task', comments = 0) => ({
    key, fields: {
      summary, status: status(st), issuetype: { name: type }, assignee: owner ? user(owner) : null, parent: { key: parent, fields: { summary: 'x' } },
      duedate: due, priority: { name: 'Medium' }, updated: '2026-09-27T10:00:00.000+0200', created: '2026-09-01T10:00:00.000+0200',
      description: adf(`Beschreibung von ${key}: ${summary}.`),
      comment: { total: comments, comments: comments ? [{ author: user('Knut Peters'), created: '2026-09-26T09:00:00.000+0200', body: adf('Letzter Stand: wartet auf Review.') }] : [] },
      labels: [], statuscategorychangedate: '2026-09-20T10:00:00.000+0200', issuelinks: [],
    },
  });
  return [
    ws('PM-70', 'Produkt OLAF', 'Knut Peters'),
    ws('PM-73', 'Operations Setup & UX', 'Daniela Muster'),
    t('PM-321', 'Hardware Admin Flow', 'To Do', 'Knut Peters', 'PM-70', '2026-09-15', 'Task', 2),
    (() => { const x: any = t('PM-322', 'Kalender Booking Page', 'To Do', 'Knut Peters', 'PM-70', '2026-09-15'); x.fields.issuelinks = [
      { type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' }, inwardIssue: { key: 'PM-331', fields: { summary: 'Prod-Push Sicherheitsfixes', status: status('In Progress') } } },
      { type: { name: 'Relates', inward: 'relates to', outward: 'relates to' }, outwardIssue: { key: 'PM-341', fields: { summary: 'Abrechnung Oktober', status: status('Done') } } },
    ]; return x; })(),
    t('PM-331', 'Prod-Push Sicherheitsfixes', 'In Progress', 'Christoph Beispiel', 'PM-70', '2099-10-02'),
    t('PM-332', 'Leak-Check #208 dokumentieren', 'To Do', 'Knut Peters', 'PM-331', null, 'Sub-task'),
    t('PM-267', 'Bill-OCR Phase 1', 'Ongoing', 'Lisa Probe', 'PM-70', null),
    t('PM-340', 'Textbausteine Service', 'Backlog', null, 'PM-73', null),
    t('PM-341', 'Abrechnung Oktober', 'Done', 'Daniela Muster', 'PM-73', '2026-09-20'),
    t('PM-323', 'Admin-Rolle anlegen', 'Done', 'Knut Peters', 'PM-321', '2026-09-10', 'Sub-task'),
    t('PM-324', 'Geräteliste importieren', 'To Do', null, 'PM-321', '2026-10-05', 'Sub-task'),
    { ...t('PM-259', 'Feedback Umfragen holen', 'To Do', 'Daniela Muster', 'PM-73', null, 'Sub-task'), fields: { ...t('PM-259', 'Feedback Umfragen holen', 'To Do', 'Daniela Muster', 'PM-73', null, 'Sub-task').fields, parent: null } },
  ];
}

export interface JiraMock { server: Server; port: number; writes: any[]; issues: any[]; close: () => Promise<void> }

export function startJiraMock(port = 0, opts: { readOnly?: boolean; truncate?: boolean } = {}): Promise<JiraMock> {
  const issues = demoIssues();
  const writes: any[] = [];
  const TRANS: Record<string, string[]> = { 'Backlog': ['To Do', 'In Progress'], 'To Do': ['In Progress', 'Done', 'Backlog'], 'In Progress': ['Done', 'To Do', 'Ongoing'], 'Ongoing': ['Done', 'In Progress'], 'Done': ['To Do'] };
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname.replace(/^.*\/rest\/api\/3/, '');
    const send = (s: number, j?: unknown) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(j === undefined ? '' : JSON.stringify(j)); };
    if (!String(req.headers.authorization ?? '').startsWith('Basic ')) return send(401, { errorMessages: ['Unauthorized'] });
    const write = req.method !== 'GET' && !p.startsWith('/search');
    if (write && opts.readOnly) return send(401, { errorMessages: ['Unauthorized; scope does not match'] });
    const find = (k: string) => issues.find((i) => i.key === k);
    let m;
    if (req.method === 'POST' && p === '/search/jql') {
      // „updated >= -Nm“: nur Tickets, deren updated in den letzten N Minuten liegt (inkrementeller Abgleich).
      const inc = String(body.jql ?? '').match(/updated >= -(\d+)m/);
      const pool = inc ? issues.filter((i) => Date.parse(i.fields.updated) >= Date.now() - Number(inc[1]) * 60_000) : issues;
      const start = Number(body.nextPageToken ?? 0);
      if (opts.truncate && start > 0) return send(200, { issues: [], nextPageToken: String(start) });   // kaputte Seite
      const page = pool.slice(start, start + 4);   // kleine Seiten, damit das Blättern getestet wird
      return send(200, { issues: page, ...(start + 4 < pool.length ? { nextPageToken: String(start + 4) } : {}) });
    }
    if (req.method === 'POST' && p === '/search/approximate-count') return send(200, { count: issues.length });
    if ((m = p.match(/^\/issue\/([A-Z]+-\d+)$/))) {
      const i = find(m[1]); if (!i) return send(404, { errorMessages: ['Issue does not exist'] });
      if (req.method === 'GET') return send(200, i);
      if (req.method === 'PUT') { writes.push({ type: 'edit', key: i.key, fields: body.fields }); Object.assign(i.fields, body.fields); return send(204); }
    }
    if ((m = p.match(/^\/issue\/([A-Z]+-\d+)\/comment$/)) && req.method === 'POST') {
      const i = find(m[1]); if (!i) return send(404, { errorMessages: ['Issue does not exist'] });
      writes.push({ type: 'comment', key: i.key, body: body.body });
      i.fields.comment.total++; i.fields.comment.comments.push({ author: user('Werkbank Test'), created: new Date().toISOString(), body: body.body });
      return send(201, { id: String(writes.length) });
    }
    if ((m = p.match(/^\/issue\/([A-Z]+-\d+)\/transitions$/))) {
      const i = find(m[1]); if (!i) return send(404, { errorMessages: ['Issue does not exist'] });
      const to = TRANS[i.fields.status.name] ?? [];
      const list = to.map((n) => ({ id: 't' + Object.keys(TRANS).indexOf(n), name: n === 'Done' ? 'Erledigt' : n, to: { name: n } }));
      if (req.method === 'GET') return send(200, { transitions: list });
      const t = list.find((x) => x.id === body.transition?.id);
      if (!t) return send(400, { errorMessages: ['Transition invalid'] });
      writes.push({ type: 'transition', key: i.key, to: t.to.name });
      i.fields.status = status(t.to.name);
      return send(204);
    }
    send(404, { errorMessages: ['not found ' + p] });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => {
    const a = server.address() as any;
    resolve({ server, port: a.port, writes, issues, close: () => new Promise((r) => { server.close(() => r()); server.closeAllConnections(); }) });
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const m = await startJiraMock(Number(process.argv[2] || 3095));
  console.log(`Jira-Mock auf http://127.0.0.1:${m.port}/rest/api/3`);
}
