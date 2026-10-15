// Konfiguration der Werkbank-Web-App — alles über Umgebungsvariablen, Vorgaben für den Pilot.
// Geheimnisse (CREDS_KEY, WERKBANK_CREDS_KEY, MEILI_MASTER_KEY …) kommen aus .env.local, das
// scripts/start.sh lädt. Hier wird nichts davon geloggt.

import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;

export const WEB_DIR = resolve(here, '..');
export const WB_ROOT = resolve(WEB_DIR, '..');
export const RT = env.WERKBANK_RUNTIME_DIR || join(WB_ROOT, '.runtime');

const list = (s: string | undefined) => (s ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);

export const cfg = {
  port: Number(env.WERKBANK_PORT || 3070),
  host: env.WERKBANK_HOST || '127.0.0.1',
  publicUrl: (env.WERKBANK_PUBLIC_URL || 'http://127.0.0.1:3070').replace(/\/$/, ''),
  librechatPublicUrl: (env.LIBRECHAT_PUBLIC_URL || env.DOMAIN_CLIENT || 'http://127.0.0.1:3080').replace(/\/$/, ''),
  librechatUrl: (env.LIBRECHAT_URL || 'http://127.0.0.1:3080').replace(/\/$/, ''),
  bridgeUrl: (env.BRIDGE_URL || 'http://127.0.0.1:3090').replace(/\/$/, ''),
  mongoUri: env.MONGO_URI_WERKBANK || 'mongodb://127.0.0.1:27017',
  db: env.WERKBANK_DB || 'werkbank',
  librechatDb: env.LIBRECHAT_DB || 'LibreChat',
  meiliHost: (env.MEILI_HOST || 'http://127.0.0.1:7700').replace(/\/$/, ''),
  meiliKey: env.MEILI_MASTER_KEY || '',
  meiliIndex: env.WERKBANK_MEILI_INDEX || 'werkbank_vault',
  vaultDir: resolve(env.WERKBANK_VAULT_DIR || '/vault'),
  // „Heute“: Release-Stand der Stränge (Paket 141) — Live-Log der Instanz und Quell-Repo mit den release/*-Zweigen, nur lesen.
  liveRoot: env.WERKBANK_LIVE_ROOT || WB_ROOT,
  sourceRepo: env.WERKBANK_SOURCE_REPO || join(homedir(), 'work', 'knut', 'werkbank-gh'),
  sprintRoot: env.WERKBANK_SPRINT_ROOT || '', // leer = <vault>/olaf/1-Projects
  allowedEmails: list(env.WERKBANK_ALLOWED_EMAILS ?? env.BRIDGE_ALLOWED_EMAILS ?? 'knut.peters@maxenergy.at'),
  // Konto, dessen Jira-Zugang aus dem Vaultwarden der VM kommen darf (nur Pilot, nur dieser Nutzer).
  pilotEmail: (env.WERKBANK_PILOT_EMAIL || 'knut.peters@maxenergy.at').toLowerCase(),
  pilotJira: env.WERKBANK_PILOT_JIRA !== '0',
  jiraCloudId: env.JIRA_CLOUD_ID || '606f753a-fd3a-4d69-9b8b-ef9574984080',
  jiraBase: env.WERKBANK_JIRA_BASE || '', // leer = https://api.atlassian.com/ex/jira/<cloud>/rest/api/3
  jiraSite: env.WERKBANK_JIRA_SITE || 'https://maxenergy.atlassian.net',
  jiraProject: env.WERKBANK_JIRA_PROJECT || 'PM',
  jiraSyncMinutes: Number(env.WERKBANK_JIRA_SYNC_MIN || 15),
  // Inkrementeller Abgleich (nur kürzlich Geändertes): alle N Minuten, 0 = aus. Fenster = 2 × N Minuten.
  jiraIncMinutes: Number(env.WERKBANK_JIRA_INC_MIN ?? 1),
  jiraScripts: env.WERKBANK_JIRA_SCRIPTS || join(homedir(), '.claude/skills/maxenergy-jira/scripts'),
  skillsSource: env.WERKBANK_SKILLS_SOURCE || '/vault/_meta/dist-skill',
  skillsTarget: env.WERKBANK_SKILLS_TARGET || join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'skills'),
  bridgeState: env.BRIDGE_STATE_DIR || join(RT, 'bridge'),
  dataDir: env.WERKBANK_DATA_DIR || join(RT, 'werkbank'),
  librechatDist: env.WERKBANK_LIBRECHAT_DIR || join(RT, 'librechat'),
  credsKey: env.CREDS_KEY || '',
  credsIv: env.CREDS_IV || '',
  werkbankKey: env.WERKBANK_CREDS_KEY || '',
  demo: env.WERKBANK_DEMO === '1',
  fileMaxBytes: Number(env.WERKBANK_FILE_MAX_MB || 25) * 1024 * 1024,
  // Plan 81: eine Ablage (Knuts ~/work/dokumente), Arbeitsordner aufräumen, Backup.
  docsDir: resolve(env.WERKBANK_DOCS_DIR || join(homedir(), 'work', 'dokumente')),
  // Agenten-Ergebnisse (docs/plan-dateien-vollstaendig.md, S3): Review-Pakete der Haupt-Sitzung und der Stränge, nur lesen.
  reviewDir: resolve(env.WERKBANK_REVIEW_DIR || join(homedir(), 'work', 'knut', 'review-pakete')),
  scratchDays: Number(env.WERKBANK_SCRATCH_DAYS ?? 30), // 0 = nie aufräumen
  backupKey: env.WERKBANK_BACKUP_KEY || '', // 64 Hex-Zeichen; verschlüsselt Personendaten-Dateien im Backup
  backupKeep: Number(env.WERKBANK_BACKUP_KEEP || 7),
  backupHour: Number(env.WERKBANK_BACKUP_HOUR ?? 2), // Nachtarchiv ab dieser Stunde; -1 = aus
  secureCookies: env.WERKBANK_INSECURE_COOKIES !== '1',
};

export const sprintRoot = () => cfg.sprintRoot || join(cfg.vaultDir, 'olaf', '1-Projects');
export const jiraBase = () => cfg.jiraBase || `https://api.atlassian.com/ex/jira/${cfg.jiraCloudId}/rest/api/3`;
export const browseUrl = (key: string) => `${cfg.jiraSite}/browse/${key}`;
