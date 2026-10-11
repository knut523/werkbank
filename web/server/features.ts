// Freigabe je Funktion fürs Team (Release 11.10.2026, Knut: „Review mit mir … was wir für das Team zur Verfügung
// stellen“). Admins sehen alles. Alle anderen sehen nur, was in WERKBANK_TEAM_FEATURES steht (Komma-Liste der IDs
// unten; Vorgabe leer = nichts außer Chat und Einrichtung). Gesperrt wird in der Oberfläche (Navigation, Seiten, Leiste
// in LibreChat) UND in der API (403), damit ein ausgeblendeter Eintrag nicht über die Adresse erreichbar bleibt.

export const FEATURES = [
  { id: 'heute', label: 'Heute' },
  { id: 'roadmap', label: 'Roadmap' },
  { id: 'board', label: 'Board' },
  { id: 'sprint', label: 'Sprint' },
  { id: 'wissen', label: 'Wissen' },
  { id: 'timebox', label: 'Mein Tag' },
  { id: 'ziele', label: 'Ziele' },
  { id: 'skills', label: 'Skills' },
  { id: 'dateien', label: 'Dateien & Teilen' },
  { id: 'orchestrator', label: 'Rückfragen des Orchestrators' },
  { id: 'ansetzen', label: 'Agent ansetzen' },
  { id: 'leitstand', label: 'Leitstand (Orchestrator-Chat)' },
] as const;
// Nur für Admins, auch nicht über WERKBANK_TEAM_FEATURES freigebbar (Plan 132: der Leitstand arbeitet mit Knuts Rechten).
const ADMIN_ONLY = new Set<string>(['leitstand']);
export type FeatureId = typeof FEATURES[number]['id'];

// API-Pfad → Funktion. Nicht aufgeführt (Anmeldung, Einrichtung, Konfiguration, Ereignisse, Einstellungen, Pflege der
// eigenen Tickets, Links) bleibt für alle Freigeschalteten offen.
const API: [RegExp, FeatureId][] = [
  [/^\/api\/(today|runs)(\/|$)/, 'heute'],
  [/^\/api\/roadmap\/ansetzen(\/|$)/, 'ansetzen'],
  [/^\/api\/roadmap(\/|$)/, 'roadmap'],
  [/^\/api\/(board|dryrun|jira)(\/|$)/, 'board'],
  [/^\/api\/(sprint|team)(\/|$)/, 'sprint'],
  [/^\/api\/vault(\/|$)/, 'wissen'],
  [/^\/api\/timebox(\/|$)/, 'timebox'],
  [/^\/api\/goals(\/|$)/, 'ziele'],
  [/^\/api\/skills(\/|$)/, 'skills'],
  [/^\/api\/(files|chats|sharelog|scratch)(\/|$)/, 'dateien'],
  [/^\/api\/leitstand(\/|$)/, 'leitstand'],
  [/^\/api\/orchestrator(\/|$)/, 'orchestrator'],
];

export function teamFeatures(env = process.env): Set<string> {
  const known = new Set<string>(FEATURES.map((f) => f.id).filter((id) => !ADMIN_ONLY.has(id)));
  return new Set(String(env.WERKBANK_TEAM_FEATURES ?? '').split(',').map((s) => s.trim()).filter((s) => known.has(s)));
}

const isAdmin = (u: { role?: string } | null | undefined) => u?.role === 'ADMIN';

/** Sichtbarkeit je Funktion für diese Person (Admins: alles). */
export function featuresFor(u: { role?: string } | null | undefined, env = process.env): Record<FeatureId, boolean> {
  const team = teamFeatures(env);
  return Object.fromEntries(FEATURES.map((f) => [f.id, isAdmin(u) || team.has(f.id)])) as Record<FeatureId, boolean>;
}

/** Welche Funktion gehört zu diesem API-Pfad (null = immer offen)? */
export function featureOfPath(path: string): FeatureId | null {
  for (const [re, id] of API) if (re.test(path)) return id;
  return null;
}

/** null = erlaubt, sonst die gesperrte Funktion. */
export function blockedFeature(u: { role?: string } | null | undefined, path: string, env = process.env): FeatureId | null {
  const f = featureOfPath(path);
  if (!f || isAdmin(u)) return null;
  return teamFeatures(env).has(f) ? null : f;
}
