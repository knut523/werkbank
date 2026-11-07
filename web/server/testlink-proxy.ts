// Angemeldeter Proxy einer Test-Umgebung (testlink.ts startet ihn: `node testlink-proxy.ts <proxy.json>`; Datei mit Rechten 600).
// Lauscht nur auf 127.0.0.1 (die Coder-Vorschau leitet dorthin, nur mit Coder-Anmeldung), nimmt nur Anfragen für den eigenen
// Vorschau-Host oder lokal an, hängt die Test-Sitzung als Cookie an (gleichnamige Browser-Cookies fliegen raus) und streamt in beide
// Richtungen (SSE, große Antworten, WebSocket-Upgrade). Statische Seiten liefert er selbst. Nach Ablauf (7 Tage): 410. Kein Log von Werten.
import http from 'node:http';
import net from 'node:net';
import { createReadStream, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, join, sep } from 'node:path';

export interface ProxyCfg { listen: number; upstream: number | null; statisch: string | null; cookies: { name: string; value: string }[]; ablauf: string; host: string }

/** Browser-Cookies ohne die gleichnamigen Test-Cookies, davor die Test-Sitzung. */
export function cookieZeile(browser: string | undefined, cookies: ProxyCfg['cookies']): string {
  const namen = new Set(cookies.map((c) => c.name));
  const eigen = String(browser ?? '').split(';').map((x) => x.trim()).filter((x) => x && !namen.has(x.split('=')[0].trim()));
  return [...cookies.map((c) => `${c.name}=${c.value}`), ...eigen].join('; ');
}
/** Nur der eigene Vorschau-Host (direkt oder als X-Forwarded-Host der Coder-Vorschau) oder lokal auf dem eigenen Port. */
export function hostErlaubt(host: string | undefined, xfh: string | undefined, cfg: Pick<ProxyCfg, 'host' | 'listen'>): boolean {
  const lokal = [`127.0.0.1:${cfg.listen}`, `localhost:${cfg.listen}`];
  const h = String(host ?? '').toLowerCase();
  const x = String(xfh ?? '').split(',')[0].trim().toLowerCase();
  if (x) return x === cfg.host.toLowerCase() && (h === x || lokal.includes(h));
  return h === cfg.host.toLowerCase() || lokal.includes(h);
}
const TYP: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.woff': 'font/woff', '.mp4': 'video/mp4', '.webm': 'video/webm' };
/** Datei einer statischen Seite — nie außerhalb der Wurzel (auch nicht über Symlinks). null = gibt es nicht. */
export function statischeDatei(wurzel: string, urlPfad: string): string | null {
  let rel: string;
  try { rel = decodeURIComponent(urlPfad.split('?')[0]); } catch { return null; }
  const w = realpathSync(wurzel);
  let f: string;
  try { f = realpathSync(join(w, rel)); } catch { return null; }
  if (f !== w && !f.startsWith(w + sep)) return null;
  try { if (statSync(f).isDirectory()) f = join(f, 'index.html'); return statSync(f).isFile() ? f : null; } catch { return null; }
}

export function proxyServer(cfg: ProxyCfg): http.Server {
  const abgelaufen = () => Date.now() >= new Date(cfg.ablauf).getTime();
  const kopf = (req: http.IncomingMessage) => {
    const h: http.OutgoingHttpHeaders = { ...req.headers, cookie: cookieZeile(req.headers.cookie, cfg.cookies), host: cfg.host, 'x-forwarded-host': cfg.host, 'x-forwarded-proto': 'https' };
    return h;
  };
  const srv = http.createServer((req, res) => {
    if (abgelaufen()) { res.writeHead(410, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Dieser Test-Link ist abgelaufen (7 Tage). Neu starten: OLAF Workspace › Mehr › Test-Umgebungen.'); return; }
    if (!hostErlaubt(req.headers.host, req.headers['x-forwarded-host'] as string | undefined, cfg)) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Nur über die eigene Coder-Vorschau.'); return; }
    if (cfg.statisch) {
      const f = statischeDatei(cfg.statisch, req.url ?? '/');
      if (!f) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Nicht gefunden.'); return; }
      res.writeHead(200, { 'content-type': TYP[extname(f).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
      if (req.method === 'HEAD') { res.end(); return; }
      createReadStream(f).pipe(res);
      return;
    }
    const up = http.request({ host: '127.0.0.1', port: cfg.upstream!, method: req.method, path: req.url, headers: kopf(req) }, (ur) => {
      const h = { ...ur.headers };
      // Absolute Weiterleitungen der App auf ihren lokalen Port zeigen auf die Vorschau zurück.
      if (typeof h.location === 'string') h.location = h.location.replace(new RegExp(`^https?://(127\\.0\\.0\\.1|localhost):${cfg.upstream}`), '');
      res.writeHead(ur.statusCode ?? 502, h);
      ur.pipe(res);
    });
    up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }); res.end('Die Test-Umgebung antwortet gerade nicht.'); });
    req.pipe(up);
  });
  srv.on('upgrade', (req, sock, head) => {
    if (abgelaufen() || cfg.statisch || !hostErlaubt(req.headers.host, req.headers['x-forwarded-host'] as string | undefined, cfg)) { sock.destroy(); return; }
    const u = net.connect(cfg.upstream!, '127.0.0.1', () => {
      const h = kopf(req);
      u.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(h).flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).filter((x) => x !== undefined).map((x) => `${k}: ${x}`)).join('\r\n')}\r\n\r\n`);
      if (head?.length) u.write(head);
      sock.pipe(u).pipe(sock);
    });
    u.on('error', () => sock.destroy()); sock.on('error', () => u.destroy());
  });
  return srv;
}

if (process.argv[1] && /testlink-proxy\.ts$/.test(process.argv[1])) {
  const cfg: ProxyCfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  proxyServer(cfg).listen(cfg.listen, '127.0.0.1', () => process.stdout.write(`testlink-proxy :${cfg.listen} → ${cfg.statisch ? 'statisch' : `:${cfg.upstream}`}\n`));
}
