// scripts/orch — die Haupt-Sitzung startet und koordiniert Werkbank-Agenten (docs/plan-orchestrator-agents.md).
//
//   orch start --title T --cwd DIR [--plan DATEI] [--lauf NAME] [--shared] [--code] (--prompt TEXT | --prompt-file DATEI | Auftrag auf stdin)
//     Git-Repo mit origin auf github.com/WirStrom1|knut523: vorher git fetch, „Stand: …“ im Chat; --code = frischer Worktree
//     <repo>-agent-<id> (Zweig agent/<id>) von origin/develop|dev|main statt des angegebenen Ordners. Nie pushen.
//   orch list [--all] [--json]
//   orch show <id> [--json]
//   orch send <id> (--text TEXT | Text auf stdin)
//   orch review <id> [--note TEXT]
//   orch ask --title T --context TEXT --recommend TEXT [--option "Label :: Folge"]… [--strand <id>] [--link URL] [--plan DATEI]
//   orch questions list [--open] [--json] · orch questions get <id> [--json] · orch questions withdraw <id>
//   orch leitstand start --handover DATEI [--json]   Leitstand-Chat (Plan 132, nur Admin): Übergabe aus der Datei (Vorlage
//     docs/leitstand-uebergabe-vorlage.md), ein vorhandener Leitstand wird beendet. Danach weckt die Werkbank ihn bei Ereignissen.
//
// Rückfragen (ask) nur für echte Entscheidungen Knuts — nicht für das, was sich nachlesen, selbst klären oder sicher
// entscheiden lässt. Immer mit eigener Empfehlung. Antwort: `orch questions get <id>` (status beantwortet + answer).
//
// Automatisch fortsetzen (docs/plan-orchestrator-auto-weiter.md): die Werkbank schickt selbst „weiter“ nach Schrittlimit,
// Zeitlimit, Brücken-Neustart, verlorener Nachricht, Parallelgrenze (nach 2 min) und Kontingent (nach 30 min oder bei
// freiem zweiten Konto) — nicht nach review_ready, bei offener Rückfrage zum Strang oder nach `review`. Deckel
// ORCH_AUTO_WEITER_MAX (30) seit der letzten Handnachricht, dann `failed` + Rückfrage in „Heute“. `list` zeigt den Zähler.
// Server: ORCH_AUTO_WEITER=off schaltet ab, ORCH_AUTO_WEITER_TICK_MS (20000); Brücke: ORCH_MAX_TURNS (Vorgabe BRIDGE_MAX_TURNS).
//
// Ziel: WERKBANK_URL (Vorgabe http://127.0.0.1:3070). Interner Schlüssel: WERKBANK_INTERNAL_TOKEN aus der Umgebung oder
// aus der .env.local der Instanz (WERKBANK_ENV_FILE, Vorgabe <checkout>/.env.local) — es wird NUR diese eine Zeile
// gelesen und nie ausgegeben. Person: WERKBANK_ORCH_EMAIL (Vorgabe: Pilot-Konto der Instanz).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WB_ROOT } from './config.ts';

const args = process.argv.slice(2);
const cmd = args.shift() ?? 'help';
const flags: Record<string, string | true> = {};
const options: string[] = [];
const pos: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) {
    const k = a.slice(2);
    if (['all', 'json', 'shared', 'open', 'code'].includes(k)) flags[k] = true;
    else if (k === 'option') options.push(args[++i] ?? '');
    else flags[k] = args[++i] ?? '';
  } else pos.push(a);
}

function token(): string {
  if (process.env.WERKBANK_INTERNAL_TOKEN) return process.env.WERKBANK_INTERNAL_TOKEN;
  const file = process.env.WERKBANK_ENV_FILE || join(WB_ROOT, '.env.local');
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { die(`Kann ${file} nicht lesen (WERKBANK_ENV_FILE setzen).`); }
  const line = text.split('\n').find((l) => l.startsWith('WERKBANK_INTERNAL_TOKEN='));
  const v = line?.slice('WERKBANK_INTERNAL_TOKEN='.length).trim().replace(/^["']|["']$/g, '');
  if (!v) die(`In ${file} steht kein WERKBANK_INTERNAL_TOKEN.`);
  return v!;
}

function die(msg: string): never { process.stderr.write(`orch: ${msg}\n`); process.exit(1); }

async function stdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  let s = '';
  for await (const c of process.stdin) s += c;
  return s;
}

async function call(path: string, b: Record<string, unknown>): Promise<any> {
  const base = (process.env.WERKBANK_URL || 'http://127.0.0.1:3070').replace(/\/$/, '');
  if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)) die('WERKBANK_URL muss lokal sein (http://127.0.0.1:<port>).');
  const email = process.env.WERKBANK_ORCH_EMAIL;
  let r: Response;
  try {
    r = await fetch(`${base}/internal/orchestrator/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': token() },
      body: JSON.stringify({ ...(email ? { email } : {}), ...b }), signal: AbortSignal.timeout(60_000),
    });
  } catch (e: any) { die(`Werkbank unter ${base} nicht erreichbar (${e.message}).`); }
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) die(`${r.status}: ${j.error ?? 'Fehler'}`);
  return j;
}

const ICON: Record<string, string> = { running: '⏳', waiting: '✋', done: '✅', failed: '❌' };
const t = (d: any) => (d ? new Date(d).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', dateStyle: 'short', timeStyle: 'short' }) : '—');

async function main() {
  switch (cmd) {
    case 'start': {
      const prompt = typeof flags.prompt === 'string' ? flags.prompt : typeof flags['prompt-file'] === 'string' ? readFileSync(flags['prompt-file'], 'utf8') : await stdin();
      if (typeof flags.title !== 'string' || typeof flags.cwd !== 'string') die('start braucht --title und --cwd.');
      const j = await call('start', { title: flags.title, cwd: flags.cwd, plan: typeof flags.plan === 'string' ? flags.plan : null, lauf: typeof flags.lauf === 'string' ? flags.lauf : null, shared: flags.shared === true, code: flags.code === true, prompt });
      if (flags.json) return console.log(JSON.stringify(j, null, 1));
      console.log(`gestartet: ${j.id}  ${j.url}\nOrdner:    ${j.cwd}${j.worktree ? ' (frischer Worktree)' : ''}${j.stand ? `\n${j.stand}` : ''}${j.plan ? `\nPlan:      ${j.plan}` : ''}${j.warning ? `\nHinweis:   ${j.warning}` : ''}`);
      return;
    }
    case 'list': {
      const j = await call('list', { all: flags.all === true });
      if (flags.json) return console.log(JSON.stringify(j.strands, null, 1));
      if (!j.strands.length) return console.log(flags.all ? 'Keine Stränge.' : 'Keine offenen Stränge (--all zeigt auch geprüfte).');
      for (const s of j.strands) {
        console.log(`${ICON[s.status] ?? '?'} ${s.id}  ${s.status.padEnd(7)} ${s.title}${s.reviewed ? '  [geprüft]' : ''}`);
        console.log(`   ${s.reason} · gestartet ${t(s.startedAt)} · zuletzt ${t(s.lastActivity)} · ${s.sends} Nachr.${s.autoWeiter ? ` · automatisch fortgesetzt (${s.autoWeiter})` : ''}${s.reviewReady ? ' · review_ready' : ''}`);
        console.log(`   ${s.cwd}  ${s.url}`);
        if (s.excerpt) console.log(s.excerpt.split('\n').slice(0, 8).map((l: string) => `   │ ${l}`).join('\n'));
      }
      return;
    }
    case 'show': {
      if (!pos[0]) die('show <id>');
      const j = await call('show', { id: pos[0] });
      if (flags.json) return console.log(JSON.stringify(j, null, 1));
      console.log(`${ICON[j.status] ?? '?'} ${j.id} ${j.status} — ${j.reason}\n${j.title}\n${j.url}\n${j.cwd}\n`);
      console.log(j.lastMessage ? `--- letzte Nachricht (${j.lastMessage.fromUser ? 'Orchestrator/Knut' : 'Agent'}, ${t(j.lastMessage.at)}) ---\n${j.lastMessage.text}` : '(noch keine gespeicherte Nachricht)');
      return;
    }
    case 'send': {
      if (!pos[0]) die('send <id> --text …');
      const text = typeof flags.text === 'string' ? flags.text : await stdin();
      const j = await call('send', { id: pos[0], text });
      console.log(`gesendet: ${j.id}  ${j.url}`);
      return;
    }
    case 'review': {
      if (!pos[0]) die('review <id>');
      await call('review', { id: pos[0], note: typeof flags.note === 'string' ? flags.note : '' });
      console.log(`geprüft: ${pos[0]}`);
      return;
    }
    case 'ask': {
      const str = (k: string) => (typeof flags[k] === 'string' ? flags[k] as string : undefined);
      if (!str('title') || !str('context') || !str('recommend')) die('ask braucht --title, --context und --recommend (nur echte Entscheidungen, mit Empfehlung).');
      const opts = options.map((o) => { const [label, ...rest] = o.split('::'); return { label: label.trim(), consequence: rest.join('::').trim() }; });
      const j = await call('questions/ask', { title: str('title'), context: str('context'), recommendation: str('recommend'), options: opts, strand: str('strand') ?? null, link: str('link') ?? null, plan: str('plan') ?? null });
      if (flags.json) return console.log(JSON.stringify(j, null, 1));
      console.log(`Rückfrage angelegt: ${j.id} — erscheint in der Werkbank unter Heute → „Wartet auf dich“ und zählt in „Heute (n)“. Antwort: orch questions get ${j.id}`);
      return;
    }
    case 'questions': {
      const sub = pos[0] ?? 'list';
      if (sub === 'list') {
        const j = await call('questions/list', { open: flags.open === true });
        if (flags.json) return console.log(JSON.stringify(j.questions, null, 1));
        if (!j.questions.length) return console.log(flags.open ? 'Keine offenen Rückfragen.' : 'Keine Rückfragen.');
        for (const q of j.questions) console.log(`${q.status === 'offen' ? '❓' : q.status === 'beantwortet' ? '💬' : '↩️'} ${q.id}  ${q.status.padEnd(12)} ${q.title}  (${t(q.createdAt)})${q.answer ? `\n   → ${[q.answer.option, q.answer.text].filter(Boolean).join(' — ')}` : ''}`);
        return;
      }
      if (!pos[1]) die(`questions ${sub} <id>`);
      if (sub === 'get') {
        const q = await call('questions/get', { id: pos[1] });
        if (flags.json) return console.log(JSON.stringify(q, null, 1));
        console.log(`${q.id} · ${q.status} · ${q.title}\n\n${q.context}\n`);
        for (const o of q.options) console.log(`- ${o.label}${o.consequence ? ` — ${o.consequence}` : ''}`);
        console.log(`Empfehlung: ${q.recommendation}`);
        if (q.answer) console.log(`\nAntwort (${q.answer.by}, ${t(q.answer.at)}): ${[q.answer.option ? `Option „${q.answer.option}“` : '', q.answer.text].filter(Boolean).join(' — ')}`);
        return;
      }
      if (sub === 'withdraw') { await call('questions/withdraw', { id: pos[1] }); console.log(`zurückgezogen: ${pos[1]}`); return; }
      die('questions list|get|withdraw');
    }
    case 'leitstand': {
      if (pos[0] !== 'start') die('leitstand start --handover DATEI');
      if (typeof flags.handover !== 'string') die('leitstand start braucht --handover DATEI (Vorlage: docs/leitstand-uebergabe-vorlage.md).');
      let handoverText = '';
      try { handoverText = readFileSync(flags.handover, 'utf8'); } catch { die(`Kann ${flags.handover} nicht lesen.`); }
      const j = await call('leitstand/start', { handoverText });
      if (flags.json) return console.log(JSON.stringify(j, null, 1));
      console.log(`Leitstand gestartet: ${j.id}  ${j.url}\nOrdner:    ${j.cwd}${j.ended.length ? `\nBeendet:   ${j.ended.map((e: any) => `${e.id} ${e.url}`).join(', ')}` : ''}`);
      return;
    }
    default:
      console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 16).map((l) => l.slice(3)).join('\n'));
  }
}

main();
