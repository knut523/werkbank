// Kontext-Paket auf stdout — für einen SessionStart-Hook in Claude Code (siehe README, wird NICHT
// automatisch eingerichtet). Nur lesend. Aufruf: node web/server/context-cli.ts <e-mail>
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { WB_ROOT } from './config.ts';

const envFile = join(WB_ROOT, '.env.local');
if (existsSync(envFile)) for (const l of readFileSync(envFile, 'utf8').split('\n')) {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const { connect, closeDb, lc } = await import('./db.ts');
const { packFor } = await import('./assist.ts');
const email = (process.argv[2] ?? '').toLowerCase();
try {
  await connect();
  const u: any = await lc().collection('users').findOne({ email }, { projection: { name: 1, email: 1 } });
  if (!u) { console.error(`Kein Werkbank-Konto für ${email}`); process.exit(0); }
  const { pack } = await packFor({ id: String(u._id), email, name: u.name ?? email });
  process.stdout.write(pack + '\n');
} catch (e: any) { console.error(`Kontext-Paket nicht verfügbar: ${e.message}`); }
finally { await closeDb(); }
