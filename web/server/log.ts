// Einzeiliges JSON-Log auf stdout (→ .runtime/logs/werkbank-web.log). Nie Tokens oder Inhalte loggen.
export function log(msg: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...data }));
}
