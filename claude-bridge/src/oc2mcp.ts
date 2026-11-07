// Werkbank-Werkzeuge für OC2-Stränge (Auftrag 07.11., Punkt 4): hauptchat_melden, bedarf_melden, review_ready als MCP-Server.
// opencode 2 trägt ihn je Arbeitsordner zur Laufzeit ein (PUT /api/experimental/mcp/werkbank?location[directory]=…, Test 07.11.:
// keine Datei im Ordner, Werkzeuge heißen werkbank_<name>, Recht „werkbank_*“). Der Server ist die Brücke selbst (POST /oc2-mcp):
// das Token im Header bestimmt Person und Strang — nie die Argumente des Modells. Das interne Werkbank-Token bleibt in der Brücke;
// opencode 2 sieht nur das Strang-Token (zufällig, im Speicher, je Brückenlauf neu).
import { randomBytes, timingSafeEqual } from 'node:crypto';

export interface Oc2McpStrang { userId: string; conv: string }
const tokens = new Map<string, Oc2McpStrang>();
const jeStrang = new Map<string, string>();

/** Token eines Strangs (stabil für diesen Brückenlauf). */
export function oc2McpToken(userId: string, conv: string): string {
  const k = `${userId}\u0000${conv}`;
  let t = jeStrang.get(k);
  if (!t) { t = randomBytes(24).toString('base64url'); jeStrang.set(k, t); tokens.set(t, { userId, conv }); }
  return t;
}
/** Strang zum Header „Authorization: Bearer <token>“ — oder null. */
export function oc2McpStrang(auth: string | undefined): Oc2McpStrang | null {
  const t = /^Bearer ([\w-]{20,64})$/.exec(String(auth ?? ''))?.[1];
  if (!t) return null;
  for (const [k, v] of tokens) if (k.length === t.length && timingSafeEqual(Buffer.from(k), Buffer.from(t))) return v;
  return null;
}
export const oc2McpVergessen = (userId: string, conv: string) => { const k = `${userId}\u0000${conv}`; const t = jeStrang.get(k); if (t) tokens.delete(t); jeStrang.delete(k); };

const s = (description?: string) => ({ type: 'string', ...(description ? { description } : {}) });
export const OC2_MCP_WERKZEUGE = [
  {
    name: 'hauptchat_melden',
    description: 'Dem Hauptchat SOFORT etwas melden, das nicht bis zu deinem Ende warten kann: art=blocker (die Arbeit steht und braucht eine Entscheidung von Knut) oder art=risiko (Risiko oder Planänderung, die den Auftrag ändert). text: kurz, mit Empfehlung (höchstens 500 Zeichen). Kein Fortschritt. Höchstens eine Meldung je 10 Minuten.',
    inputSchema: { type: 'object', properties: { art: { type: 'string', enum: ['blocker', 'risiko'] }, text: s() }, required: ['art', 'text'] },
    pfad: '/internal/hauptchat-meldung', felder: ['art', 'text'],
    antwort: (j: any) => (j.hauptchat ? 'Gemeldet — der Hauptchat bekommt es. Arbeite weiter, soweit es geht.' : 'Gespeichert — gerade ist kein Hauptchat aktiv; schreib das Wichtige zusätzlich in „### Stand“. Arbeite weiter.'),
  },
  {
    name: 'bedarf_melden',
    description: 'Bedarf an die Hauptsitzung melden — für alles, was du nicht selbst darfst (github schreiben, merge, jira, deploy, zugang außerhalb deines Ordners, recht, geheimnis, datei, entscheidung, sonstiges). text: genau was und warum. Danach NICHT warten: am Rest weiterarbeiten; die Antwort kommt als Nachricht.',
    inputSchema: { type: 'object', properties: { art: { type: 'string', enum: ['github', 'merge', 'jira', 'deploy', 'zugang', 'recht', 'geheimnis', 'datei', 'entscheidung', 'sonstiges'] }, text: s(), pfad: s('nur bei art=zugang: absoluter Ordner') }, required: ['art', 'text'] },
    pfad: '/internal/bedarf', felder: ['art', 'text', 'pfad'],
    antwort: (j: any) => `Gemeldet (${j.id ?? '?'}) — ${j.hauptchat ? 'die Hauptsitzung hat es sofort' : 'es steht unter „Braucht Hauptsitzung“'}. Arbeite am Rest weiter.`,
  },
  {
    name: 'review_ready',
    description: 'Am Ende: meldet „bereit zum Review“. Pflicht: gemacht, nicht_gemacht, risiko (je kurzer Text, „nichts“ statt leer) und dod (je Punkt: punkt, stand ja|teilweise|nein, beleg). artefakte: Dateien, Branch.',
    inputSchema: {
      type: 'object',
      properties: {
        gemacht: s(), nicht_gemacht: s(), risiko: s(),
        dod: { type: 'array', items: { type: 'object', properties: { punkt: s(), stand: { type: 'string', enum: ['ja', 'teilweise', 'nein'] }, beleg: s() }, required: ['punkt', 'stand'] } },
        artefakte: { type: 'array', items: s() },
      },
      required: ['gemacht', 'nicht_gemacht', 'risiko', 'dod'],
    },
    pfad: '/internal/review-ready', felder: ['gemacht', 'nicht_gemacht', 'risiko', 'dod', 'artefakte'],
    antwort: (j: any) => `Bereit zum Review gemeldet (${j.key ?? '?'}). Nicht weiterarbeiten.`,
  },
];

/** Eine JSON-RPC-Nachricht (Streamable HTTP, Antwort als JSON). null = Benachrichtigung (HTTP 202). `werkbank` ruft die Werkbank
 *  mit Person und Strang aus dem Token; nur die bekannten Felder gehen weiter (wie werkbank-tools.ts). */
export async function oc2McpAntwort(msg: any, strang: Oc2McpStrang, werkbank: (pfad: string, daten: object) => Promise<any>): Promise<object | null> {
  if (!msg || typeof msg !== 'object' || msg.id === undefined || msg.id === null) return null;
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result });
  const err = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } });
  if (msg.method === 'initialize') return ok({ protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'werkbank', version: '1' } });
  if (msg.method === 'ping') return ok({});
  if (msg.method === 'tools/list') return ok({ tools: OC2_MCP_WERKZEUGE.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  if (msg.method === 'tools/call') {
    const w = OC2_MCP_WERKZEUGE.find((x) => x.name === msg.params?.name);
    if (!w) return err(-32602, `Unbekanntes Werkzeug ${String(msg.params?.name).slice(0, 60)}`);
    const a = msg.params?.arguments ?? {};
    const daten: Record<string, unknown> = { conv: strang.conv };
    for (const f of w.felder) if (a[f] !== undefined) daten[f] = a[f];
    try { return ok({ content: [{ type: 'text', text: w.antwort(await werkbank(w.pfad, daten)) }] }); }
    catch (e: any) { return ok({ content: [{ type: 'text', text: `Nicht gemeldet: ${String(e?.message ?? e).slice(0, 300)}` }], isError: true }); }
  }
  return err(-32601, 'Methode unbekannt');
}
