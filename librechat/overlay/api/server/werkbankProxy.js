// OLAF-Werkbank: /werkbank/* → Werkbank-Web (127.0.0.1:3070), damit die Werkbank-Seiten unter dem
// LibreChat-Ursprung laufen (eine Anmeldung: der Refresh-Cookie kommt mit). Aus dem Werkbank-Repo
// (librechat/overlay), eingespielt von scripts/werkbank.sh up|update. /internal/* wird nie durchgereicht.
const http = require('http');

const TARGET_HOST = process.env.WERKBANK_WEB_HOST || '127.0.0.1';
const TARGET_PORT = Number(process.env.WERKBANK_WEB_PORT || 3070);
const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host']);

module.exports = function werkbankProxy(req, res) {
  if (req.originalUrl === '/werkbank') return res.redirect(301, '/werkbank/');
  const path = req.url || '/';
  if (/^\/internal(\/|$)/.test(path)) return res.status(404).end();
  const headers = {};
  for (const [k, v] of Object.entries(req.headers)) if (!HOP.has(k.toLowerCase())) headers[k] = v;
  headers['x-forwarded-for'] = [req.headers['x-forwarded-for'], req.ip].filter(Boolean).join(', ');
  headers['x-forwarded-prefix'] = '/werkbank';
  const up = http.request({ host: TARGET_HOST, port: TARGET_PORT, method: req.method, path, headers }, (r) => {
    const out = {};
    for (const [k, v] of Object.entries(r.headers)) if (!HOP.has(k.toLowerCase())) out[k] = v;
    res.writeHead(r.statusCode || 502, out);
    r.pipe(res);
  });
  up.on('error', () => {
    if (!res.headersSent) res.status(502).json({ error: 'Die Werkbank-Seiten laufen gerade nicht (Dienst werkbank-web). Bitte scripts/werkbank.sh status prüfen.' });
    else res.end();
  });
  req.pipe(up);
};
