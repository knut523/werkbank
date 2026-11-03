// Werkbank 2.0 (Paket 436, Council B1–B3, B5): eigene Chats direkt auf der Brücke — Zug auf dem Server, ein Zug je Person,
// Text ≤ 8 000, offene Züge nach einem Neustart sichtbar „abgebrochen“; nur der Adapter liest LibreChats Datenbank.
import { TEST_MONGO } from './testmongo.ts';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

process.env.MONGO_URI_WERKBANK = TEST_MONGO;
process.env.WERKBANK_DB = `werkbank_v2chat_${randomBytes(4).toString('hex')}`;
const { connect, closeDb } = await import('../server/db.ts');
const chat = await import('../server/v2chat.ts');
let client: any;
before(async () => { client = await connect(); });
after(async () => { await client.db(process.env.WERKBANK_DB).dropDatabase(); await closeDb(); await client.close(); });

const u = { id: 'u1', email: 'a@x', name: 'Anna', role: 'USER' } as any;
/** Gefälschte Brücke: SSE in zwei Stücken; `halt` hält den Zug offen, bis `los()` gerufen wird. */
function bruecke() {
  let los!: () => void;
  const warte = new Promise<void>((r) => { los = r; });
  const aufrufe: any[] = [];
  const f = (async (url: string, init: any) => {
    aufrufe.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const enc = new TextEncoder();
    const body = new ReadableStream({ async start(c) {
      c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"Hal"}}]}\n'));
      await warte;
      c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n'));
      c.close();
    } });
    return new Response(body, { status: 200 });
  }) as any;
  return { f, los, aufrufe };
}
const bis = async (fn: () => Promise<boolean>) => { for (let i = 0; i < 100; i++) { if (await fn()) return; await new Promise((r) => setTimeout(r, 30)); } throw new Error('Zeit um'); };

test('Chat: Zug läuft auf dem Server mit eigener v2-Kennung; zweiter Zug derselben Person → 409; Antwort landet in der Datenbank', async () => {
  const b = bruecke();
  const deps = { bridgeUrl: 'http://bruecke', token: async () => 'sk-ant-oat01-test', fetch: b.f };
  const r = await chat.senden(u, { text: 'Was ist OLAF?' }, deps);
  assert.match(r.conv, /^v2-[0-9a-f-]{36}$/);
  await assert.rejects(chat.senden(u, { text: 'noch eine', conv: r.conv }, deps), (e: any) => e.status === 409);
  assert.equal(b.aufrufe[0].headers['x-librechat-conversation-id'], r.conv, 'eigene Unterhaltungs-ID, nie eine LibreChat-ID');
  assert.equal(b.aufrufe[0].body.messages[0].content, 'Was ist OLAF?');
  b.los();
  await bis(async () => (await chat.verlauf(u, r.conv)).some((n) => n.rolle === 'assistent' && n.status === 'fertig'));
  const v = await chat.verlauf(u, r.conv);
  assert.deepEqual(v.map((n) => [n.rolle, n.text, n.status]), [['ich', 'Was ist OLAF?', 'fertig'], ['assistent', 'Hallo', 'fertig']]);
  // danach geht der nächste Zug
  const b2 = bruecke(); b2.los();
  const r2 = await chat.senden(u, { text: 'Danke', conv: r.conv }, { ...deps, fetch: b2.f });
  assert.equal(r2.conv, r.conv);
  await bis(async () => (await chat.verlauf(u, r.conv)).filter((n) => n.status === 'fertig').length === 4);
});

test('Chat: Text leer → 400, über 8 000 Zeichen → 413; ohne Claude-Zugang Klartext statt Fehler', async () => {
  const deps = { bridgeUrl: 'http://bruecke', token: async () => 'sk-ant-oat01-test', fetch: bruecke().f };
  await assert.rejects(chat.senden(u, { text: '   ' }, deps), (e: any) => e.status === 400);
  await assert.rejects(chat.senden(u, { text: 'x'.repeat(8001) }, deps), (e: any) => e.status === 413);
  await assert.rejects(chat.senden({ ...u, id: 'u2' }, { text: 'hallo' }, { ...deps, token: async () => null }), (e: any) => e.status === 412 && /Claude-Zugang — alles andere geht ohne/.test(e.message));
});

test('Chat: fremder oder erfundener Chat → 404/400, nie in fremde Unterhaltungen schreiben', async () => {
  const b = bruecke(); b.los();
  const deps = { bridgeUrl: 'http://bruecke', token: async () => 'sk-ant-oat01-test', fetch: b.f };
  const r = await chat.senden({ ...u, id: 'u3' }, { text: 'meins' }, deps);
  await bis(async () => (await chat.verlauf({ ...u, id: 'u3' }, r.conv)).every((n) => n.status === 'fertig'));
  await assert.rejects(chat.verlauf({ ...u, id: 'u4' }, r.conv), (e: any) => e.status === 404);
  await assert.rejects(chat.senden({ ...u, id: 'u4' }, { text: 'fremd', conv: r.conv }, deps), (e: any) => e.status === 404);
  await assert.rejects(chat.verlauf(u, 'c18b2a5a-f485-48ab-9f1a-8fd7b3a37b7f'), (e: any) => e.status === 400, 'LibreChat-ID wird nicht als 2.0-Chat angenommen');
});

test('Neustart: offene Züge werden sichtbar „abgebrochen“ markiert, mit Grund', async () => {
  await chat.nachrichten().insertOne({ _id: 'offen1' as any, conv: 'v2-00000000-0000-0000-0000-000000000000', userId: 'u5', rolle: 'assistent', text: 'hal', status: 'laeuft', at: new Date(), geaendert: new Date() });
  assert.ok((await chat.abgebrochenMarkieren()) >= 1);
  const m: any = await chat.nachrichten().findOne({ _id: 'offen1' as any });
  assert.equal(m.status, 'abgebrochen');
  assert.match(m.fehler, /neu gestartet/);
});

test('Adapter (B5): nur v2librechat.ts greift auf LibreChats Datenbank zu; kein anderes v2-Modul importiert lc()', () => {
  const dir = new URL('../server/', import.meta.url).pathname;
  for (const f of readdirSync(dir).filter((n) => /^v2.*\.ts$/.test(n) && n !== 'v2librechat.ts')) {
    const t = readFileSync(dir + f, 'utf8');
    assert.doesNotMatch(t, /\blc\(\)|import\s*\{[^}]*\blc\b[^}]*\}\s*from\s*'\.\/db\.ts'/, f);
    assert.doesNotMatch(t, /createLibreChat|from '\.\/orchestrator\.ts'/, `${f}: Schreiben in LibreChat nur über den Adapter`);
  }
});
