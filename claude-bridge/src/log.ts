// Eine JSON-Zeile je Ereignis. Nie Tokens oder Nachrichteninhalte loggen.
export function log(event: string, data: Record<string, unknown> = {}) {
  process.stdout.write(JSON.stringify({ t: new Date().toISOString(), event, ...data }) + '\n');
}
