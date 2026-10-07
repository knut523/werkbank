// Orchestrator-Chat (Plan docs/plan-orchestrator-chat.md, P2): feste Rollen für Teilagenten.
// Durchgesetzt wird im Wächter (sessions.ts, makeGuard) über agent_type — disallowedTools ist nur die erste Schicht.

const WRITE_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash'];
const NO_NESTING = ['Task', 'Agent'];

const KURZ = 'Antworte am Ende mit einem kurzen Ergebnis (höchstens 15 Zeilen, Belege als Pfad oder Ticket-Schlüssel), das der Koordinator direkt übernehmen kann. Deutsch.';

export const AGENTS = {
  leser: {
    description: 'Liest und sucht nur: Vault (vault-search), Dateien, Jira/Confluence lesen. Für Recherche-Teilaufgaben, deren Ergebnis zusammengefasst zurückkommt. Schreibt nichts.',
    prompt: `Du bist ein lesender Teilagent der OLAF-Werkbank. Du liest und suchst nur (Vault zuerst über vault-search, dann Dateien, Jira lesen). Du schreibst, änderst und führst nichts aus; solche Aufrufe werden abgelehnt. ${KURZ}`,
    disallowedTools: [...WRITE_TOOLS, ...NO_NESTING],
  },
  'ticket-pruefer': {
    description: 'Prüft ein oder mehrere PM-Tickets (Board „OLAF“): Status, Owner, Fälligkeit, Ziel/DoD, Sub-tasks, Widersprüche zum Vault. Schreibt nichts.',
    prompt: `Du bist ein lesender Teilagent der OLAF-Werkbank und prüfst Jira-Tickets im Board PM (Projekt „OLAF“). Je Ticket: Status, Owner, Fälligkeit, Ziel/DoD vorhanden, Sub-tasks, letzter Kommentar, und ob der Vault etwas anderes sagt. Du änderst nichts in Jira oder im Vault; solche Aufrufe werden abgelehnt. Schlag Änderungen nur vor. ${KURZ}`,
    disallowedTools: [...WRITE_TOOLS, ...NO_NESTING],
  },
  schreiber: {
    description: 'Setzt eine klar umrissene Änderung um (Datei, Notiz, Jira). Jede Änderung bestätigt die Person im Chat.',
    prompt: `Du bist ein schreibender Teilagent der OLAF-Werkbank. Setz genau den Auftrag um, nicht mehr. Jede Änderung (Dateien, Bash, Jira) bestätigt die Person im Chat; frag nicht selbst nach, ruf das Werkzeug direkt auf. Wird ein Aufruf abgelehnt, hör auf und melde das. GitHub schreiben, pushen und mergen ist gesperrt. ${KURZ}`,
    disallowedTools: [...NO_NESTING],
  },
} as const;

/** Rollen, die nur lesen dürfen (Wächter lehnt alles außer Klasse „read“ ab). */
export const READONLY_ROLES = new Set(['leser', 'ticket-pruefer']);

export function maxSubagents(): number {
  const n = Number(process.env.BRIDGE_MAX_SUBAGENTS || 4);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 4;
}

/** Hinweis im System-Prompt: welche Rollen es gibt und wie viele Teilagenten je Nachricht. */
export function orchestratorAppend(): string {
  return `Teilagenten (Werkzeug Task/Agent): Für unabhängige Teilaufgaben gibt es die Rollen ${Object.keys(AGENTS).map((k) => `\`${k}\``).join(', ')} (lesend: leser, ticket-pruefer). Höchstens ${maxSubagents()} Teilagenten je Nachricht; die Ergebnisse fasst du selbst zusammen.`;
}
