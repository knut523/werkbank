// Sandbox Stufe 1 für Unter-Chats (Paket 436, Nachtrag 7 / Plan E13): ein Unter-Chat bekommt keinen Zugang zur
// Vaultwarden-Sitzung, zum SSH-Agenten, zu SSH-Schlüsseln für Git, zum Git-Credential-Helfer (orchGitEnv) und zu einem
// GitHub-Token mit Schreibrecht. Schreib-Token gibt es nur im Server-Prozess für freigegebene GitHub-Aktionen.
// Grenze (ehrlich): gleicher Unix-Nutzer — ein Shell-Befehl mit absolutem Pfad kann Dateien unter dem Home weiter lesen;
// dagegen stehen die Deny-Regeln (tools.ts) und der Klassifikator. Echte Trennung = Stufe 2 (eigener Nutzer, Plan D11).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

/** Umgebungsvariablen, die einen Zugang öffnen — im Unter-Chat immer weg. Dazu eingeschleuste Git-Einstellungen aus dem Elternprozess
 *  (GIT_CONFIG_PARAMETERS / GIT_CONFIG_COUNT…: könnten einen Credential-Helfer setzen) und der Session-Bus (Schlüsselbund). Pass C, GLM.
 *  ponytail: Sperrliste statt Erlaubnisliste — neue Variablennamen müssen hier nachgetragen werden; Upgrade = Erlaubnisliste in Stufe 2. */
export const SANDBOX_WEG = /^(SSH_AUTH_SOCK|SSH_AGENT_PID|BW_\w+|VAULTWARDEN\w*|GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN|GIT_CREDENTIAL\w*|GIT_CONFIG_PARAMETERS|GIT_CONFIG_COUNT|GIT_CONFIG_KEY_\d+|GIT_CONFIG_VALUE_\d+|GCM_\w+|DBUS_SESSION_BUS_ADDRESS|GNOME_KEYRING_\w+|GPG_AGENT_INFO)$/;

export function strangSandbox(env: Record<string, string | undefined>, o: { stateDir: string; leseToken?: string | null }): void {
  for (const k of Object.keys(env)) if (SANDBOX_WEG.test(k)) delete env[k];
  // gh ohne die Anmeldung aus ~/.config/gh (Knuts Token kann schreiben): leere eigene Konfiguration, höchstens ein Lesetoken.
  const gh = join(o.stateDir, 'sandbox-gh');
  mkdirSync(gh, { recursive: true, mode: 0o700 });
  env.GH_CONFIG_DIR = gh;
  if (o.leseToken) env.GH_TOKEN = o.leseToken;
  // Git über SSH ohne Schlüssel und ohne Agent (pushInsteadOf in orchGitEnv deckt nur github.com).
  env.GIT_SSH_COMMAND = 'ssh -F /dev/null -o IdentitiesOnly=yes -o IdentityFile=none -o IdentityAgent=none -o BatchMode=yes';
}
