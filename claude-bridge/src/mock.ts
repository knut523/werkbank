// BRIDGE_MOCK=1: ein Ersatz für query() aus dem Agent SDK, der Claude nicht aufruft.
// Er liefert dieselben Nachrichtenformen, damit Streaming, Statuszeilen und die
// Bestätigungs-Rückfrage ohne echten Token durchgetestet werden können.
// Enthält die Nachricht "schreib", versucht der Mock eine Datei zu schreiben (→ Rückfrage).
// „mock-tool <Werkzeug> <JSON>“ ruft ein beliebiges Werkzeug auf und spielt dabei den Rechteweg des SDK nach:
// PreToolUse-Hook → (ohne Entscheidung) Modus → im Auto-Modus ein Nachbau des Klassifikators (RISKANT → nachfragen,
// VERBOTEN → ablehnen, sonst erlauben) → bei „nachfragen“ canUseTool. $CWD steht für den Arbeitsordner.

import { randomUUID } from 'node:crypto';
import { VAULT_DIR } from './tools.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alwaysLimit = new Set<string>();   // Sitzungen mit „maxturns-immer“
const workerSessions = new Map<string, { rolle: string; prompt: string }>();   // Plan 165: Worker-Sitzung → Rolle und Auftrag (Reparaturrunde)

const textOf = (m: any) => (typeof m?.message?.content === 'string' ? m.message.content : (m?.message?.content ?? []).map((b: any) => b?.text ?? '').join(''));

/**
 * Streaming-Input wie das CLI (Plan 154, S1): erste Nachricht = Szenario; nachgereichte Nachrichten werden nach dem nächsten
 * Werkzeugaufruf eingefaltet (Echo mit uuid, wie --replay-user-messages), nach dem Ergebnis als Folgezug. Die Eingabe bleibt
 * nach dem Ergebnis offen, bis die Brücke sie schließt — wie beim CLI, damit Tests ein Hängen finden würden.
 */
function mockStreamed(prompt: AsyncIterable<any>, options: Record<string, any>) {
  const signal: AbortSignal = options.abortController?.signal;
  async function* run() {
    const it = prompt[Symbol.asyncIterator]();
    const first = await it.next();
    if (first.done) return;
    const inbox: any[] = [];
    let closed = false;
    let wake: (() => void) | null = null;
    (async () => {
      for (;;) {
        const n = await it.next();
        if (n.done) { closed = true; wake?.(); return; }
        inbox.push(n.value); wake?.();
      }
    })();
    let sid = options.resume ?? '';
    const fold = function* () {
      while (inbox.length) {
        const m = inbox.shift();
        yield { type: 'user', isReplay: true, uuid: m.uuid, session_id: sid, parent_tool_use_id: null, message: m.message };
        yield { type: 'stream_event', parent_tool_use_id: null, session_id: sid, event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `(Mock) Nachgereicht gelesen: ${textOf(m)} ` } } };
      }
    };
    let afterTool = false;
    for await (const m of mockQuery({ prompt: textOf(first.value), options })) {
      sid = m.session_id ?? sid;
      if (afterTool) { afterTool = false; yield* fold(); }
      yield m;
      if (m.type === 'assistant' && (m.message?.content ?? []).some((b: any) => b?.type === 'tool_use')) afterTool = true;
    }
    // Nach dem Ergebnis: Folgezug für jede weitere Nachricht, bis die Eingabe geschlossen wird.
    for (;;) {
      if (signal?.aborted) return;
      if (inbox.length) {
        yield* fold();
        yield { type: 'result', subtype: 'success', session_id: sid, is_error: false, usage: { input_tokens: 1, output_tokens: 1 } };
        continue;
      }
      if (closed) return;
      await new Promise<void>((r) => { wake = r; signal?.addEventListener('abort', () => r(), { once: true }); });
      wake = null;
    }
  }
  return run();
}

export function mockQuery({ prompt, options }: { prompt: string | AsyncIterable<any>; options: Record<string, any> }): any {
  if (typeof prompt !== 'string' && options.extraArgs && 'replay-user-messages' in options.extraArgs) return mockStreamed(prompt, options);
  if (typeof prompt !== 'string') {
    // Streaming-Eingabe ohne Nachricht (MCP-Status): nur Steuerabfragen, keine Modellantwort.
    const signal: AbortSignal = options.abortController?.signal;
    return {
      async *[Symbol.asyncIterator]() { await new Promise<void>((r) => signal?.addEventListener('abort', () => r())); },
      mcpServerStatus: async () => mcpList(options),
    } as any;
  }
  const session_id: string = options.resume ?? randomUUID();
  const signal: AbortSignal = options.abortController?.signal;
  const guard = options.hooks?.PreToolUse?.[0]?.hooks?.[0];

  const text = (t: string) => ({
    type: 'stream_event', parent_tool_use_id: null, session_id,
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } },
  });
  const toolUse = (name: string, input: Record<string, unknown>) => ({
    type: 'assistant', parent_tool_use_id: null, session_id,
    message: { content: [{ type: 'tool_use', id: randomUUID(), name, input }] },
  });

  async function* run() {
    yield { type: 'system', subtype: 'init', session_id, mcp_servers: mcpList(options) };
    // Mehrere Claude-Konten: Tokens mit „limit“ sind ausgeschöpft (rate_limit, Reset in 2 h), „midlimit“ erst nach einem
    // Werkzeug mitten im Zug; „bad-auth“ wird abgelehnt. Tokens mit „acct“ nennen ihre letzten 4 Zeichen.
    const tok = String(options.env?.CLAUDE_CODE_OAUTH_TOKEN ?? '');
    const limited = function* () {
      yield { type: 'rate_limit_event', session_id, rate_limit_info: { status: 'rejected', resetsAt: Math.floor(Date.now() / 1000) + 7200, rateLimitType: 'five_hour' } };
      yield { type: 'assistant', parent_tool_use_id: null, session_id, error: 'rate_limit', message: { content: [{ type: 'text', text: 'API Error: Rate limit reached' }] } };
      yield { type: 'result', subtype: 'success', session_id, is_error: true, result: 'Rate limit reached', usage: { input_tokens: 0, output_tokens: 0 } };
    };
    // Melious (Plan 162): Schlüssel in ANTHROPIC_API_KEY, Basis-URL gesetzt, kein OAuth-Token. „mel-pleite“ = Budget aus
    // (billing_error), „mel-viel“ = drei Antworten mit je 40 000 Tokens (Deckel), sonst eine kurze Antwort mit usage.
    const mel = String(options.env?.ANTHROPIC_API_KEY ?? '');
    // Rollen-Profile (Plan 162, S6): was die Brücke für diesen Zug einstellt.
    if (prompt.includes('PROFIL?')) {
      const ea = options.extraArgs ?? {};
      yield text(`(Mock) Profil: Werkzeuge ${options.tools ? options.tools.join(',') : 'alle'}; MCP ${Object.keys(options.mcpServers ?? {}).sort().join(',') || '-'}; Skills ${Array.isArray(options.skills) ? options.skills.length : '?'}; Einstellungen ${(options.settingSources ?? []).join(',') || '-'}; bare ${'bare' in ea ? 'ja' : 'nein'}; dynamisch aus ${'exclude-dynamic-system-prompt-sections' in ea ? 'ja' : 'nein'}; Systemprompt ${typeof options.systemPrompt === 'string' ? 'eigen' : 'Claude Code'}; Melious ${mel ? 'ja' : 'nein'}. `);
      yield { type: 'result', subtype: 'success', session_id, is_error: false, usage: { input_tokens: 5, output_tokens: 5 } };
      return;
    }
    // Plan 165: Lead, der die Werkzeuge delegieren/delegation_*/phase_wechseln über die Brücke aufruft wie der Werkbank-MCP
    // (Person/Strang/Adresse aus dessen Umgebung). „MOCK-LEAD {json}“ mit schritte: [{ tool, args }].
    const leadM = prompt.match(/MOCK-LEAD (\{.*\})/);
    if (!mel && /limit/.test(tok) && (leadM || prompt.startsWith('Neue Phase „') || prompt.startsWith('Auftrag vom Strang-Lead'))) { yield* limited(); return; }
    if (leadM && !prompt.startsWith('Neue Phase „')) {
      const wenv = options.mcpServers?.werkbank?.env ?? {};
      yield text(`(Mock-Lead) Modell ${options.model ?? 'Standard'}; Melious ${mel ? 'ja' : 'nein'}; Werkzeuge ${wenv.WERKBANK_BRIDGE_URL ? 'ja' : 'nein'}; Kompakt ${options.env?.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE ?? '-'}. `);
      const plan = JSON.parse(leadM[1]);
      for (const s of plan.schritte ?? []) {
        if (s.warte) { await sleep(s.warte); continue; }
        const path = ({ delegieren: '/internal/delegate', delegation_stand: '/internal/delegate-stand', delegation_urteil: '/internal/delegate-urteil', phase_wechseln: '/internal/phase', melious_sub: '/internal/mel-sub', auslastung: '/internal/auslastung' } as Record<string, string>)[s.tool];
        const r = await fetch(`${wenv.WERKBANK_BRIDGE_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-werkbank-internal': wenv.WERKBANK_INTERNAL_TOKEN }, body: JSON.stringify({ userId: wenv.WERKBANK_USER_ID, conv: wenv.WERKBANK_CONV_ID, ...s.args }) });
        const j: any = await r.json().catch(() => ({}));
        yield text(`\n[${s.tool}] ${r.ok ? j.text : `FEHLER ${r.status}: ${j.error}`}\n`);
      }
      yield { type: 'result', subtype: 'success', session_id, is_error: false, usage: { input_tokens: 50, output_tokens: 20 } };
      return;
    }
    // Neue Phase (Plan 165, S3): zeigt, womit die Folgesitzung startet.
    if (prompt.startsWith('Neue Phase „')) {
      yield text(`(Mock-Phase) ${prompt.match(/^Neue Phase „([^“]+)“/)?.[1]}: Modell ${options.model ?? 'Standard'}; Melious ${mel ? 'ja' : 'nein'}; fortgesetzt ${options.resume ? 'ja' : 'nein'}; Verlauf ${prompt.includes('Bisheriger Verlauf') ? 'ja' : 'nein'}; Auftrag ${prompt.includes('MOCK-LEAD') ? 'ja' : 'nein'}; Übergabe ${prompt.includes('## Offene Widersprüche') ? 'ja' : 'nein'}; Brücken-Prüfung ${prompt.includes('## Prüfausgaben der Brücke') ? 'ja' : 'nein'}. `);
      yield { type: 'result', subtype: 'success', session_id, is_error: false, usage: { input_tokens: 30, output_tokens: 10 } };
      return;
    }
    // Worker (Plan 165, S2): Verhalten aus Stichwörtern im Auftrag. MOCK-DATEI name=inhalt (schreiben + committen),
    // MOCK-LUEGE (meldet eine andere Datei), MOCK-OHNE-BLOCK (kein Abschluss-Block), MOCK-REPARIERBAR (liefert ihn nachgefordert),
    // MOCK-UNCOMMITTET (schreibt ohne Commit), MOCK-MAENGEL (Prüfer-Urteil maengel), MOCK-LANG ms (arbeitet so lange).
    const wm = prompt.match(/^Auftrag vom Strang-Lead \(Rolle (\w+), Risiko (\w+), Delegation (d-\w+)\)/);
    const repair = prompt.startsWith('Dein Abschluss-Block fehlt');
    if (wm || repair) {
      const rolle = wm?.[1] ?? workerSessions.get(String(options.resume))?.rolle ?? 'leser';
      const flags = wm ? prompt : workerSessions.get(String(options.resume))?.prompt ?? '';
      workerSessions.set(session_id, { rolle, prompt: flags });
      const cwd = String(options.cwd ?? '.');
      yield text(`(Mock-Worker) Rolle ${rolle}; Modell ${options.model ?? 'Standard'}; Melious ${mel ? 'ja' : 'nein'}; Profil-Werkzeuge ${options.tools ? options.tools.join(',') : 'alle'}; MCP ${Object.keys(options.mcpServers ?? {}).sort().join(',') || '-'}; Strang-Werkzeuge ${options.mcpServers?.werkbank?.env?.WERKBANK_BRIDGE_URL ? 'ja' : 'nein'}; Teilagenten ${options.agents && !(options.disallowedTools ?? []).includes('Task') ? 'ja' : 'nein'}; Kompakt ${options.env?.CLAUDE_CODE_AUTO_COMPACT_WINDOW ?? '-'}/${options.env?.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE ?? '-'}; Schritte ${options.maxTurns}; cwd ${cwd}. `);
      if (wm && prompt.includes('Hinweis des Leads:')) yield text(`(Mock-Worker) Hinweis des Leads gesehen: ${prompt.match(/Hinweis des Leads: ([^\n]*)/)?.[1]}. `);
      const lang = Number(flags.match(/MOCK-LANG (\d+)/)?.[1] ?? 0);
      for (let t = 0; t < lang && !signal?.aborted; t += 100) await sleep(100);
      if (signal?.aborted) throw new Error('aborted');
      const files: string[] = [];
      if (!repair && (rolle === 'bauer' || rolle === 'schreiber')) {
        const { writeFileSync } = await import('node:fs');
        const { execFileSync } = await import('node:child_process');
        for (const m of flags.matchAll(/MOCK-DATEI ([\w./-]+)=(\S+)/g)) { writeFileSync(`${cwd}/${m[1]}`, m[2] + '\n'); files.push(m[1]); }
        if (files.length && !flags.includes('MOCK-UNCOMMITTET')) {
          const genv = { ...process.env, ...options.env } as NodeJS.ProcessEnv;
          execFileSync('git', ['-C', cwd, 'add', ...files], { env: genv });
          execFileSync('git', ['-C', cwd, 'commit', '-q', '-m', 'mock: Worker-Änderung'], { env: genv });
        }
      }
      const block = { abschluss: { ziel: true, dateien: flags.includes('MOCK-LUEGE') ? ['anders.txt'] : files, pruefungen: [{ befehl: 'npm test', ausgabe: 'ok (Mock)' }], annahmen: ['keine'], widersprueche: [],
        ...(rolle === 'pruefer' ? { urteil: flags.includes('MOCK-MAENGEL') ? 'maengel' : 'ok', befunde: flags.includes('MOCK-MAENGEL') ? ['a.txt:1 — Mangel (Mock)'] : [] } : {}) } };
      const ohne = flags.includes('MOCK-OHNE-BLOCK') && !(repair && flags.includes('MOCK-REPARIERBAR'));
      yield text(`Erledigt (Mock).${ohne ? '' : `\n\n\`\`\`json\n${JSON.stringify(block)}\n\`\`\``}`);
      yield { type: 'result', subtype: 'success', session_id, is_error: false, usage: { input_tokens: 400, output_tokens: 80 } };
      return;
    }
    if (mel) {
      yield text(`(Mock) Melious über ${options.env?.ANTHROPIC_BASE_URL}; OAuth: ${options.env?.CLAUDE_CODE_OAUTH_TOKEN ? 'ja' : 'nein'}; Betas aus: ${options.env?.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS ?? '-'}; Modell: ${options.model ?? 'Standard'}; Teilagenten: ${options.env?.ANTHROPIC_DEFAULT_SONNET_MODEL ?? '-'}; MCP: ${Object.keys(options.mcpServers ?? {}).join(',') || '-'}; Datenregel: ${String(options.systemPrompt?.append ?? '').includes('Datenregel (dieser Zug') ? 'ja' : 'nein'}; Push gesperrt: ${(options.disallowedTools ?? []).includes('Bash(git push:*)') ? 'ja' : 'nein'}; Jira gesperrt: ${(options.disallowedTools ?? []).includes('mcp__werkbank__jira_update') ? 'ja' : 'nein'}; Modus: ${options.permissionMode}${String(options.systemPrompt?.append ?? '').includes('Über Melious gilt der Auto-Modus nicht') ? ' (Auto aus)' : ''}. `);
      if (/leer/.test(mel)) {
        // Echter Befund 14.10.2026: Melious ohne Guthaben, so wie Claude Code es meldet.
        yield { type: 'assistant', parent_tool_use_id: null, session_id, error: 'authentication_failed', message: { content: [{ type: 'text', text: 'Failed to authenticate. API Error: 403 {"type":"error","error":{"type":"permission_error","message":"Insufficient credits…"}}' }] } };
        yield { type: 'result', subtype: 'success', session_id, is_error: true, result: 'Failed to authenticate. API Error: 403 Insufficient credits', usage: { input_tokens: 0, output_tokens: 0 } };
        return;
      }
      if (/pleite/.test(mel)) {
        yield { type: 'assistant', parent_tool_use_id: null, session_id, error: 'billing_error', message: { content: [{ type: 'text', text: 'API Error: 402 {"error":{"code":"BILLING_2003","message":"Out of credits"}}' }] } };
        yield { type: 'result', subtype: 'success', session_id, is_error: true, result: '402', usage: { input_tokens: 0, output_tokens: 0 } };
        return;
      }
      if (/viel/.test(mel)) {
        for (let i = 0; i < 3; i++) {
          if (options.abortController?.signal.aborted) throw new Error('aborted');
          yield { type: 'assistant', parent_tool_use_id: null, session_id, message: { id: `msg_${i}`, usage: { input_tokens: 30000, cache_read_input_tokens: 8000, output_tokens: 2000 }, content: [{ type: 'tool_use', id: randomUUID(), name: 'Read', input: { file_path: '/tmp/x' } }] } };
          await new Promise((r) => setTimeout(r, 30));
        }
      }
      yield { type: 'assistant', parent_tool_use_id: null, session_id, message: { id: 'msg_end', usage: { input_tokens: 1200, cache_read_input_tokens: 300, output_tokens: 40 }, content: [] } };
      yield text('OK');
      yield { type: 'result', subtype: 'success', session_id, is_error: false, usage: { input_tokens: 1200, cache_read_input_tokens: 300, cache_creation_input_tokens: 0, output_tokens: 40 } };
      return;
    }
    if (/bad-auth/.test(tok)) {
      yield { type: 'assistant', parent_tool_use_id: null, session_id, error: 'authentication_failed', message: { content: [{ type: 'text', text: 'Invalid token' }] } };
      yield { type: 'result', subtype: 'success', session_id, is_error: true, result: 'auth', usage: { input_tokens: 0, output_tokens: 0 } };
      return;
    }
    if (/midlimit/.test(tok)) {
      yield toolUse('Grep', { pattern: 'Vorarbeit', path: VAULT_DIR });
      yield text('(Mock) Erste Schritte erledigt. ');
      yield* limited();
      return;
    }
    if (/limit/.test(tok)) { yield* limited(); return; }
    if (/acct/.test(tok)) yield text(`(Mock) Konto: …${tok.slice(-4)}. `);
    if (prompt === 'Antworte nur mit: ok') { yield text('ok'); yield { type: 'result', subtype: 'success', session_id, is_error: false, usage: { input_tokens: 5, output_tokens: 1 } }; return; }
    if (prompt.startsWith('WERKBANK-MCP-AUFRUF')) {
      // Ein bestätigter MCP-Aufruf: Werkzeug + Argumente aus dem Prompt, Ergebnis ins Protokoll (für Tests).
      const tool = prompt.match(/`(mcp__[^`]+)`/)?.[1] ?? '';
      const input = JSON.parse(prompt.match(/```json\n(.+)\n```/)?.[1] ?? '{}');
      const id = randomUUID();
      yield { type: 'assistant', parent_tool_use_id: null, session_id, message: { content: [{ type: 'tool_use', id, name: tool, input }] } };
      const ok = await options.canUseTool?.(tool, input);
      if (ok?.behavior !== 'allow') { yield { type: 'user', session_id, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: 'abgelehnt' }] } }; return; }
      if (JSON.stringify(input).includes('401-TEST')) { yield { type: 'user', session_id, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: 'Error: 401 Unauthorized — please re-authenticate' }] } }; return; }
      const { appendFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const inp: any = ok.updatedInput;
      appendFileSync(join(process.env.BRIDGE_STATE_DIR ?? '.', 'mock-mcp-calls.jsonl'), JSON.stringify({ tool, input: inp }) + '\n');
      if (tool.endsWith('createJiraIssue')) {
        // Anlegen gegen den Jira-Nachbau; die Antwort trägt den Schlüssel wie der echte MCP (JSON mit id/key/self).
        const created = await replayCreate(inp);
        yield { type: 'user', session_id, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: !created.ok, content: [{ type: 'text', text: created.text }] }] } };
        return;
      }
      const err = await replayJira(tool, inp);
      if (err) { yield { type: 'user', session_id, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: err }] } }; return; }
      yield { type: 'user', session_id, message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: 'OK (Mock)' }] }] } };
      return;
    }
    const lines = prompt.split('\n');
    const anh = lines.filter((l) => /^- anhaenge\//.test(l)).map((l) => l.slice(2).split(' (')[0]);
    const last = [...lines].reverse().find((l) => l.trim() && !/^- anhaenge\//.test(l) && !/^(---|Angehängte Dateien)/.test(l)) ?? '';
    if (/^Vorgabe für diesen Chat/.test(prompt)) yield text('(Mock) Vorlage erkannt. ');
    const append = String(options.systemPrompt?.append ?? '');
    if (append.includes('Werkbank-Kontext')) {
      const q = append.match(/^1\. (.+)$/m)?.[1];
      yield text(`(Mock) Kontext-Paket: ${append.length} Zeichen, Werkzeuge: ${Object.keys(options.mcpServers ?? {}).join(', ') || '—'}.${q ? ` Erste Frage: ${q}` : ''} `);
    }
    if (Array.isArray(options.skills)) yield text(`(Mock) Skills: ${options.skills.length} [${options.skills.join(',')}]. `);
    if (anh.length) {
      const { existsSync } = await import('node:fs');
      const { join } = await import('node:path');
      yield text(`(Mock) Anhänge im Arbeitsverzeichnis: ${anh.map((a) => a + (existsSync(join(options.cwd ?? '.', a)) ? ' ✓' : ' ✗')).join(', ')}. `);
    }
    if (/zeitmessung/i.test(last)) {
      // Nachbau eines echten Zuges mit Zeiten wie gemessen: Start des CLI + erster Token (~2 s),
      // ein Satz, ein Werkzeug (~1,2 s), dann die eigentliche Antwort Wort für Wort (~60 ms je Wort).
      await sleep(600);
      yield { type: 'stream_event', parent_tool_use_id: null, session_id, event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } } };
      await sleep(1400);
      for (const w of 'Ich schaue kurz im Vault nach. '.split(/(?<= )/)) { yield text(w); await sleep(60); }
      yield { type: 'assistant', parent_tool_use_id: null, session_id, message: { content: [{ type: 'text', text: 'Ich schaue kurz im Vault nach. ' }] } };
      yield toolUse('mcp__vault-search__search', { query: 'Zeitmessung' });
      await sleep(1200);
      const answer = Array.from({ length: 40 }, (_, i) => `Wort${i + 1} `);
      for (const w of answer) { if (signal?.aborted) throw new Error('aborted'); yield text(w); await sleep(60); }
      yield { type: 'assistant', parent_tool_use_id: null, session_id, message: { content: [{ type: 'text', text: answer.join('') }] } };
      yield { type: 'result', subtype: 'success', session_id, is_error: false, usage: { input_tokens: 100, output_tokens: 60 } };
      return;
    }
    if (/live-test/i.test(last)) {
      // Live-Anzeige (07.10.2026): Gedanken als Deltas, Werkzeugbeginn vor fertiger Eingabe, Lebenszeichen nach 5 s.
      // Ereignisformen wie die Anthropic-Streaming-API (content_block_start/-delta), die das SDK als stream_event durchreicht.
      const ev = (event: Record<string, unknown>) => ({ type: 'stream_event', parent_tool_use_id: null, session_id, event });
      yield text(`(Mock) thinking-display: ${options.extraArgs?.['thinking-display'] ?? '—'}. `);
      yield ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } });
      for (const t of ['Ich überlege, ', 'wo das steht.']) { yield ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: t } }); await sleep(30); }
      const id = randomUUID();
      yield ev({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id, name: 'Task', input: {} } });
      for (const part of ['{"description":', '"Recherche",', '"prompt":"…"}']) { yield ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: part } }); await sleep(300); }
      yield { type: 'assistant', parent_tool_use_id: null, session_id, message: { content: [{ type: 'tool_use', id, name: 'Task', input: { description: 'Recherche', prompt: '…' } }] } };
      yield { type: 'tool_progress', parent_tool_use_id: null, session_id, tool_use_id: id, tool_name: 'Task', elapsed_time_seconds: 6 };
      yield { type: 'user', session_id, message: { content: [{ type: 'tool_result', tool_use_id: id, content: [{ type: 'text', text: 'ok' }] }] } };
      yield text('(Mock) Fertig.');
      yield { type: 'result', subtype: 'success', session_id, is_error: false, usage: { input_tokens: 10, output_tokens: 5 } };
      return;
    }
    const orch = last.match(/^orchestrator-(test|viele)$/i);
    if (orch && guard) {
      // Orchestrator (P2): der Haupt-Faden startet Teilagenten (Task), deren Werkzeuge kommen mit parent_tool_use_id und
      // feuern den Hook mit agent_id/agent_type (wie sdk.d.ts BaseHookInput). Danach die Ergebnisse und die Zusammenfassung.
      yield text(`(Mock) Rollen: ${Object.keys(options.agents ?? {}).join(',') || '—'}. `);
      const plan: [string, string][] = orch[1] === 'viele'
        ? Array.from({ length: 6 }, (_, i) => ['leser', `Recherche ${i + 1}`])
        : [['ticket-pruefer', 'PM-321 prüfen'], ['ticket-pruefer', 'PM-322 prüfen'], ['schreiber', 'Notiz anlegen']];
      const started: { id: string; role: string; desc: string; agentId: string }[] = [];
      for (const [role, desc] of plan) {
        const id = randomUUID();
        const input = { description: desc, subagent_type: role, prompt: '…' };
        yield { type: 'assistant', parent_tool_use_id: null, session_id, message: { content: [{ type: 'tool_use', id, name: 'Task', input }] } };
        const r = await guard({ hook_event_name: 'PreToolUse', tool_name: 'Task', tool_input: input }, id, { signal });
        if (r?.hookSpecificOutput?.permissionDecision === 'deny') { yield { type: 'user', session_id, parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: 'abgelehnt' }] } }; continue; }
        started.push({ id, role, desc, agentId: randomUUID() });
      }
      const results: string[] = [];
      for (const a of started) {
        const sub = (name: string, input: Record<string, unknown>) => ({ type: 'assistant', parent_tool_use_id: a.id, session_id, message: { content: [{ type: 'tool_use', id: randomUUID(), name, input }] } });
        const hook = (name: string, input: Record<string, unknown>) => guard({ hook_event_name: 'PreToolUse', tool_name: name, tool_input: input, agent_id: a.agentId, agent_type: a.role }, randomUUID(), { signal });
        const g = { pattern: a.desc.split(' ')[0], path: VAULT_DIR };
        yield sub('Grep', g); await hook('Grep', g);
        if (a.desc === 'PM-322 prüfen') {
          const w = { file_path: `${VAULT_DIR}/_werkbank-mock/pruefer.md`, content: 'x' };
          yield sub('Write', w);
          const r = await hook('Write', w);
          results.push(`${a.desc}: Schreiben ${r?.hookSpecificOutput?.permissionDecision === 'allow' ? 'erlaubt' : 'abgelehnt'}`);
        } else if (a.role === 'schreiber') {
          const w = { file_path: `${VAULT_DIR}/_werkbank-mock/orchestrator.md`, content: '# Ergebnis\n' };
          yield sub('Write', w);
          const r = await hook('Write', w);
          results.push(`${a.desc}: ${r?.hookSpecificOutput?.permissionDecision === 'allow' ? 'geschrieben' : 'nicht geschrieben'}`);
        } else results.push(`${a.desc}: ok`);
        yield { type: 'user', session_id, parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: a.id, content: [{ type: 'text', text: results.at(-1) }] }] } };
      }
      yield text(`\n\n(Mock) Zusammenfassung von ${started.length} Teilagenten: ${results.join('; ')}.`);
      yield { type: 'result', subtype: 'success', session_id, is_error: false, usage: { input_tokens: 300, output_tokens: 90 } };
      return;
    }
    // „mock-antwort <Text>“: genau dieser Text als Antwort (\n = Zeilenumbruch), z. B. für Status-Marken der Orchestrator-Stränge.
    const ma = last.match(/^mock-antwort (.+)$/);
    if (ma) {
      yield text(ma[1].replaceAll('\\n', '\n'));
      yield { type: 'result', subtype: 'success', session_id, is_error: false, usage: { input_tokens: 5, output_tokens: 5 } };
      return;
    }
    if (last === 'mock-optionen') {
      // Für Tests: womit die Sitzung gestartet wurde (ohne Geheimnisse).
      const append = String(options.systemPrompt?.append ?? '');
      yield text('OPTIONEN ' + JSON.stringify({ maxTurns: options.maxTurns, disallowed: options.disallowedTools, mcp: Object.keys(options.mcpServers ?? {}).sort(),
        leitstand: append.includes('Dieser Chat ist der HAUPTCHAT') || append.includes('Dieser Chat ist der LEITSTAND'), strang: append.includes('Orchestrator-Strang'), werkbankLeit: options.mcpServers?.werkbank?.env?.WERKBANK_LEITSTAND ?? null, werkbankStrang: options.mcpServers?.werkbank?.env?.WERKBANK_STRANG ?? null,
        gitConfig: !!options.env?.GIT_CONFIG_GLOBAL }));
      yield { type: 'result', subtype: 'success', session_id, is_error: false, usage: { input_tokens: 5, output_tokens: 5 } };
      return;
    }
    if (last === 'mock-verdichten') {
      // Verdichtung des Kontexts wie das echte CLI (Plan 132): status compacting → compact_boundary → Antwort.
      yield { type: 'system', subtype: 'status', status: 'compacting', session_id };
      yield { type: 'system', subtype: 'compact_boundary', session_id, compact_metadata: { trigger: 'auto', pre_tokens: 900000, post_tokens: 20000 } };
      yield text('(Mock) Verdichtet.');
      yield { type: 'result', subtype: 'success', session_id, is_error: false, usage: { input_tokens: 5, output_tokens: 5 } };
      return;
    }
    const slow = last.match(/^langsam (\d+)$/);
    if (slow) {
      // Ein langer Zug (Sperre je Person, E5): wartet N ms, dann eine Zeile.
      await sleep(Math.min(Number(slow[1]), 10000));
      yield text('(Mock) Langsamer Zug fertig.');
      yield { type: 'result', subtype: 'success', session_id, is_error: false, usage: { input_tokens: 5, output_tokens: 5 } };
      return;
    }
    if (/skill-test/i.test(last)) yield toolUse('Skill', { skill: 'olaf-jira' });
    if (/konfig-test/i.test(last)) {
      yield text(`(Mock) Konfig: ${options.env?.CLAUDE_CONFIG_DIR ?? 'geteilt'}; strict: ${options.strictMcpConfig === true}; Nutzer-Hooks aus: ${options.settings?.disableAllHooks === true}; MCP: ${Object.keys(options.mcpServers ?? {}).join(',')}. `);
      yield text(`(Mock) Modus: ${options.permissionMode}; Deny-Regeln: ${options.settings?.permissions?.deny?.length ?? 0}; bypass aus: ${options.settings?.permissions?.disableBypassPermissionsMode === 'disable'}. `);
    }
    const mt = last.match(/^mock-tool (\S+) (\{.*\})\s*$/);
    if (mt) {
      const name = mt[1];
      const input = JSON.parse(mt[2].replaceAll('$CWD', String(options.cwd ?? '.')));
      const denials: any[] = [];
      yield text(`(Mock) Modus: ${options.permissionMode}. `);
      const id = randomUUID();
      yield { type: 'assistant', parent_tool_use_id: null, session_id, message: { content: [{ type: 'tool_use', id, name, input }] } };
      const r = guard ? await guard({ hook_event_name: 'PreToolUse', tool_name: name, tool_input: input }, id, { signal }) : {};
      let d: string | undefined = r?.hookSpecificOutput?.permissionDecision;
      if (!d) {
        const mode = options.permissionMode ?? 'default';
        const what = JSON.stringify(input);
        const v = mode === 'auto' ? (/VERBOTEN/.test(what) ? 'deny' : /RISKANT/.test(what) ? 'ask' : 'allow') : mode === 'dontAsk' ? 'deny' : 'ask';
        if (v === 'ask') {
          const c = await options.canUseTool?.(name, input, { signal, toolUseID: id, decisionReason: mode === 'auto' ? '\u001b[1mKlassifikator\u001b[0m: Löschen außerhalb von Build-Artefakten' : undefined });
          d = c?.behavior === 'allow' ? 'allow' : 'deny';
        } else if (v === 'deny') {
          d = 'deny';
          denials.push({ tool_name: name, tool_use_id: id, tool_input: input });
          yield { type: 'system', subtype: 'permission_denied', tool_name: name, tool_use_id: id, decision_reason_type: mode === 'auto' ? 'classifier' : 'mode', message: 'abgelehnt', session_id };
        } else d = 'allow';
      }
      yield { type: 'user', session_id, message: { content: [{ type: 'tool_result', tool_use_id: id, ...(d === 'allow' ? { content: [{ type: 'text', text: 'ok' }] } : { is_error: true, content: 'abgelehnt' }) }] } };
      yield text(d === 'allow' ? `(Mock) ${name} ausgeführt.` : `(Mock) ${name} nicht ausgeführt.`);
      yield { type: 'result', subtype: 'success', session_id, is_error: false, usage: { input_tokens: 10, output_tokens: 5 }, permission_denials: denials };
      return;
    }
    // „jira-kommentar PM-123“: Claude kommentiert im Chat über den Atlassian-MCP (Rückfrage → ja → Ergebnis).
    const jk = last.match(/jira-kommentar ([A-Z][A-Z0-9]+-\d+)/);
    if (jk && guard) {
      const tool = 'mcp__atlassian__addCommentToJiraIssue';
      const input = { cloudId: 'x', issueIdOrKey: jk[1], commentBody: '(Mock) Kommentar aus dem Chat', contentFormat: 'markdown' };
      const id = randomUUID();
      yield { type: 'assistant', parent_tool_use_id: null, session_id, message: { content: [{ type: 'tool_use', id, name: tool, input }] } };
      const r = await guard({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: input }, id, { signal });
      if (r?.hookSpecificOutput?.permissionDecision === 'allow') {
        const err = await replayJira(tool, input);
        yield { type: 'user', session_id, message: { content: [{ type: 'tool_result', tool_use_id: id, ...(err ? { is_error: true, content: err } : { content: [{ type: 'text', text: 'Kommentar angelegt' }] }) }] } };
        yield text(err ? '(Mock) Jira hat abgelehnt.' : `(Mock) Kommentar auf ${jk[1]} geschrieben.`);
      } else yield text('(Mock) Kein Jira-Kommentar.');
      yield { type: 'result', subtype: 'success', session_id, is_error: false, usage: { input_tokens: 10, output_tokens: 5 } };
      return;
    }
    // „langsam-test [n]“: ein langer Zug mit n Werkzeugschritten (Plan 154: schreiben während der Arbeit, Bilder/Video).
    const lang = last.match(/langsam-test(?:\s+(\d+))?/i);
    if (lang) {
      const n = Math.min(60, Number(lang[1] || 6));
      const ms = Number(process.env.BRIDGE_MOCK_SLOW_MS || 1500);
      for (let i = 1; i <= n; i++) {
        if (signal?.aborted) throw new Error('aborted');
        yield toolUse('Bash', { command: `sleep 1 # Schritt ${i} von ${n}`, description: `Schritt ${i} von ${n}` });
        await sleep(ms);
        yield { type: 'user', session_id, parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } };
        yield text(`Schritt ${i} erledigt. `);
      }
      yield text('(Mock) Langer Zug fertig.');
      yield { type: 'result', subtype: 'success', session_id, is_error: false, usage: { input_tokens: 10, output_tokens: 10 } };
      return;
    }
    yield toolUse('Grep', { pattern: last.slice(0, 40), path: VAULT_DIR });
    await sleep(50);
    // Rundenende für die Review-Schlange: Schrittlimit bzw. Absturz der Sitzung.
    // „maxturns-immer“: diese Sitzung endet ab jetzt jeden Zug am Schrittlimit (Deckel der automatischen Fortsetzung).
    if (/maxturns-immer/i.test(last)) alwaysLimit.add(session_id);
    if (alwaysLimit.has(session_id)) { yield text('(Mock) Immer noch viel zu tun. '); yield { type: 'result', subtype: 'error_max_turns', session_id, is_error: true, usage: { input_tokens: 1, output_tokens: 1 } }; return; }
    if (/maxturns-test/i.test(last)) { yield text('(Mock) Viel zu tun. '); yield { type: 'result', subtype: 'error_max_turns', session_id, is_error: true, usage: { input_tokens: 1, output_tokens: 1 } }; return; }
    if (/absturz-test/i.test(last)) throw new Error('Mock: Sitzung abgestürzt');
    const words = `(Mock, kein Claude-Aufruf${options.resume ? ', Sitzung fortgesetzt' : ''}) Du hast geschrieben: ${last}`.split(/(?<= )/);
    for (const w of words) {
      if (signal?.aborted) throw new Error('aborted');
      yield text(w);
      await sleep(15);
    }
    if (/schreib/i.test(last) && guard) {
      const input = { file_path: `${VAULT_DIR}/_werkbank-mock/notiz.md`, content: `# Mock\n\n${last}\n` };
      yield toolUse('Write', input);
      const r = await guard({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: input }, undefined, { signal });
      const ok = r?.hookSpecificOutput?.permissionDecision === 'allow';
      yield text(ok ? '(Mock) Ich hätte die Datei jetzt geschrieben — im Mock wird nichts angefasst.' : '(Mock) Gut, ich schreibe nichts.');
    }
    yield { type: 'result', subtype: 'success', session_id, is_error: false, usage: { input_tokens: prompt.length >> 2, output_tokens: 20 } };
  }
  return run();
}

/** MCP-Server, wie Claude Code sie in der Init-Nachricht meldet — nur die übergebenen (strictMcpConfig). */
function mcpList(options: Record<string, any>) {
  return Object.keys(options.mcpServers ?? {}).map((name) => ({ name, status: name === 'atlassian' ? process.env.BRIDGE_MOCK_ATLASSIAN || 'connected' : 'connected' }));
}

/** createJiraIssue gegen den Jira-Nachbau (POST /issue). Ohne Nachbau: fester Schlüssel PM-9000. */
async function replayCreate(inp: any): Promise<{ ok: boolean; text: string }> {
  const base = process.env.BRIDGE_MOCK_JIRA_BASE;
  if (!base) return { ok: true, text: JSON.stringify({ id: '9000', key: 'PM-9000', self: 'mock' }) };
  const fields: any = { project: { key: inp.projectKey }, issuetype: { name: inp.issueTypeName }, summary: inp.summary, description: inp.description, ...(inp.parent ? { parent: { key: inp.parent } } : {}), ...(inp.assignee_account_id ? { assignee: { accountId: inp.assignee_account_id } } : {}), ...(inp.additional_fields ?? {}) };
  const r = await fetch(base + '/issue', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from('mcp:mock').toString('base64') }, body: JSON.stringify({ fields }) });
  const text = await r.text();
  return r.ok ? { ok: true, text } : { ok: false, text: `Jira ${r.status}: ${text.slice(0, 200)}` };
}

/** Mit BRIDGE_MOCK_JIRA_BASE spielt der Mock den Atlassian-MCP gegen einen Jira-Nachbau (REST) nach. Fehlertext oder ''. */
async function replayJira(tool: string, inp: any): Promise<string> {
  const base = process.env.BRIDGE_MOCK_JIRA_BASE;
  if (!base) return '';
  const k = encodeURIComponent(String(inp.issueIdOrKey));
  const [method, path, body] = tool.endsWith('addCommentToJiraIssue') ? ['POST', `/issue/${k}/comment`, { body: { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: inp.commentBody }] }] } }]
    : tool.endsWith('transitionJiraIssue') ? ['POST', `/issue/${k}/transitions`, { transition: inp.transition }]
    : tool.endsWith('editJiraIssue') ? ['PUT', `/issue/${k}`, { fields: inp.fields }] : ['GET', `/issue/${k}`, undefined];
  const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from('mcp:mock').toString('base64') }, body: body ? JSON.stringify(body) : undefined });
  return r.ok ? '' : `Jira ${r.status}: ${(await r.text()).slice(0, 200)}`;
}
