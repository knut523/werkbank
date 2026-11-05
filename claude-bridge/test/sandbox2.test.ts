// Sandbox Stufe 2 (D11, Plan §19; Council-Check der Hauptsitzung 05.11., bindende Bedingung zu C13): Der Unix-Nutzer der
// Unter-Chats (`werkbank-agent`) darf Vaultwarden-Helfer und -Daten, Git-Anmeldedaten und Knuts Claude-Konfiguration (~/.claude)
// NICHT lesen können — per Dateirecht, nicht nur per Sperrregel. Geprüft wird nur das Leserecht (test -r / -x), nie ein Inhalt.
//
// Ohne eingerichteten Nutzer wird der Negativtest übersprungen (die Einrichtung macht Knut, Runbook §19); die Kontrolle läuft
// immer: als Knut sind die vorhandenen Ziele lesbar — der Test schlägt also an, wenn das Recht da ist.
// Weitere Ziele (z. B. der Pfad des Vaultwarden-Helfers auf einer anderen Box): SANDBOX2_ZIELE="/pfad/a:/pfad/b".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessSync, constants, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const AGENT = process.env.SANDBOX2_NUTZER ?? 'werkbank-agent';

/** Die Ziele, die der Agent-Nutzer nicht lesen darf (je mit Art, damit der Bericht sagt, WAS lesbar wäre). */
export function ziele(home: string, extra = process.env.SANDBOX2_ZIELE ?? ''): { art: string; pfad: string }[] {
  return [
    { art: 'Claude-Konfiguration', pfad: join(home, '.claude') },
    { art: 'Claude-Anmeldung', pfad: join(home, '.claude.json') },
    { art: 'Git-Anmeldedaten', pfad: join(home, '.git-credentials') },
    { art: 'Git-Anmeldedaten', pfad: join(home, '.config', 'git', 'credentials') },
    { art: 'GitHub-CLI-Anmeldung', pfad: join(home, '.config', 'gh') },
    { art: 'Vaultwarden-Daten (CLI)', pfad: join(home, '.config', 'Bitwarden CLI') },
    // Pfad laut Skill konekto-team-secrets: der Helfer hält dort die Sitzung des Tresors.
    { art: 'Vaultwarden-Helfer', pfad: join(home, '.config', 'vw') },
    ...extra.split(':').filter(Boolean).map((p) => ({ art: 'zusätzlich (SANDBOX2_ZIELE)', pfad: p })),
  ];
}

/** Lesbar heißt: Datei lesbar bzw. Ordner lesbar UND betretbar. */
function lesbarIch(p: string): boolean {
  try { accessSync(p, statSync(p).isDirectory() ? constants.R_OK | constants.X_OK : constants.R_OK); return true; } catch { return false; }
}

function agentDa(): boolean {
  try { execFileSync('id', ['-u', AGENT], { stdio: 'ignore' }); return true; } catch { return false; }
}

/** Als Agent-Nutzer prüfen (sudo-Regel aus Runbook §19, Schritt 4b: nur /usr/bin/test). */
function lesbarAlsAgent(p: string): boolean {
  const ordner = (() => { try { return statSync(p).isDirectory(); } catch { return false; } })();
  try {
    execFileSync('sudo', ['-n', '-u', AGENT, '/usr/bin/test', '-r', p], { stdio: 'ignore' });
    if (ordner) execFileSync('sudo', ['-n', '-u', AGENT, '/usr/bin/test', '-x', p], { stdio: 'ignore' });
    return true;
  } catch { return false; }
}

test('Kontrolle: als Knut sind die vorhandenen Ziele lesbar — der Test erkennt ein Leserecht', () => {
  const da = ziele(homedir()).filter((z) => existsSync(z.pfad));
  assert.ok(da.some((z) => z.art === 'Claude-Konfiguration'), '~/.claude fehlt — ohne Ziel ist der Negativtest wertlos');
  for (const z of da) assert.equal(lesbarIch(z.pfad), true, `${z.art} (${z.pfad}) sollte für Knut lesbar sein`);
});

test(`Negativtest Stufe 2: ${AGENT} kann Vaultwarden-Helfer, Git-Anmeldedaten und ~/.claude nicht lesen`, { skip: agentDa() ? false : `Nutzer ${AGENT} ist nicht eingerichtet (Runbook §19 — macht Knut)` }, () => {
  // Ohne sudo-Regel wäre jedes „nicht lesbar“ ein Scheintreffer: erst beweisen, dass der Aufruf als Agent überhaupt geht.
  try { execFileSync('sudo', ['-n', '-u', AGENT, '/usr/bin/test', '-d', '/'], { stdio: 'ignore' }); }
  catch { assert.fail(`sudo -u ${AGENT} /usr/bin/test geht nicht — sudo-Regel aus Runbook §19, Schritt 4b fehlt`); }
  const lesbar = ziele(homedir()).filter((z) => existsSync(z.pfad) && lesbarAlsAgent(z.pfad));
  assert.deepEqual(lesbar.map((z) => `${z.art}: ${z.pfad}`), [], `${AGENT} darf keines dieser Ziele lesen`);
});

test('Zielliste: alle drei Pflichtarten sind drin, zusätzliche Pfade kommen dazu', () => {
  const z = ziele('/home/x', '/opt/helfer:/srv/y');
  for (const art of ['Claude-Konfiguration', 'Git-Anmeldedaten', 'Vaultwarden-Helfer']) assert.ok(z.some((x) => x.art === art), art);
  assert.deepEqual(z.slice(-2).map((x) => x.pfad), ['/opt/helfer', '/srv/y']);
});
