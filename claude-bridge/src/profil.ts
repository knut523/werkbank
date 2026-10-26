// Rollen-Profil „leser“ (R29 D, Schnitt S4): was ein Leser-Strang kann. Rein, damit es testbar ist; sessions.ts wendet es an.
// Vorgabe unverändert (nur Read/Grep/Glob/Bash, keine Skills, keine Teilagenten, kein Web). Mit BRIDGE_LESER_ERWEITERT=on und
// einem Claude-Konto kommen WebSearch/WebFetch, Skills und lesende Teilagenten dazu — Schreiben und curl/wget bleiben gesperrt
// (LESER_DENY, readOnlyBash, READONLY_ROLES). Über Melious (`--bare`) bleibt alles wie bisher: kein Skill-Lader, kein Anthropic-Web.

import { AGENTS } from './agents.ts';

export const LESER_BASIS = ['Read', 'Grep', 'Glob', 'Bash'];
const LESER_PLUS = ['WebSearch', 'WebFetch', 'Skill', 'Agent'];

export const leserErweitert = (env: Record<string, string | undefined> = process.env) => env.BRIDGE_LESER_ERWEITERT === 'on';

export function leserOptionen(o: { erweitert: boolean; melious: boolean }) {
  const plus = o.erweitert && !o.melious;
  return { tools: plus ? [...LESER_BASIS, ...LESER_PLUS] : [...LESER_BASIS], skills: plus, agents: plus, settingSources: plus ? ['user'] : ([] as string[]) };
}

/** Hauptchat: Hinweis auf das Werkzeug „github_schreiben“ — nur mit WERKBANK_HAUPTCHAT_GITHUB=on (S5), sonst bleibt „gesperrt“ der Stand. */
export const githubAppend = (env: Record<string, string | undefined> = process.env) => env.WERKBANK_HAUPTCHAT_GITHUB === 'on'
  ? 'GitHub schreiben (Ausnahme zur Regel oben, Knut 26.10.): nur über das Werkzeug github_schreiben (Kommentar, PR öffnen, Branch pushen). Es zeigt Knut eine Karte mit Ja/Nein; erst nach seinem Klick passiert es. Texte für GitHub auf Englisch, ohne lokale Pfade. Mergen bleibt gesperrt, ebenso Push auf main/develop/dev/release.'
  : '';

/** Teilagenten des erweiterten Lesers: nur die rein lesenden Rollen (strang-leser gibt es nur im Hauptchat). */
export const leserAgents = () => ({ leser: AGENTS.leser, 'ticket-pruefer': AGENTS['ticket-pruefer'] });
