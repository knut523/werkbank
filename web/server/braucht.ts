// „Braucht dich“-Klassifikation (R30b Teil A, Knut 02.11.: „ich weiß nicht, was ich in diesen Situationen
// tun soll … wir sollten das systematisch fixen“): jede „Braucht Knut“-Zeile eines Strangs wird sortiert in
//  (a) echte Entscheidung für Knut → Entscheidungsseite (Kontext · Optionen · Empfehlung · Knöpfe),
//  (b) Aktion, die der Hauptchat selbst kann (Push nach Gate, Merge im Worktree, Skill installieren,
//      CLI laufen lassen, Strang neu starten) → Aufgabe an den Hauptchat, keine Frage an Knut,
//      ABER (R30b-Nachbesserung, echter Fall 574aa7bb, Knut 02.11.): Zugänge/Zugangsdaten/Tunnel, Prod- oder DEV-DB,
//      Geld, Recht, externe Personen und offene D-Entscheidungen sind immer (a) — auch wenn die Zeile zusätzlich
//      „Push“ sagt. Unsicher → (a).
//  (c) erledigt/veraltet (schon beantwortet, Commit/Paket im Live-Stand, PR geschlossen/gemergt,
//      neuerer Strang mit gleichem Ziel) → automatisch schließen mit Begründung.
// Rein: alle Prüfungen kommen als Fakten herein (beantwortet, paketLive, prZu, laufNeuere), damit das ohne
// Netz, Git und Mongo testbar ist — die Fakten liefert der Aufrufer aus den bestehenden Quellen
// (Inbox-Log, releasestand.ts, GitHub-Kopie, orchestrator_runs). Schalter WERKBANK_BRAUCHT_DICH (Vorgabe aus).

export const BRAUCHT_AN = (env: NodeJS.ProcessEnv | undefined = process.env) => (env?.WERKBANK_BRAUCHT_DICH ?? '') === 'an';

export type BrauchtArt = 'entscheidung' | 'aktion' | 'veraltet';

export interface BrauchtKontext {
  /** Kennung der Zeile (Inbox- oder Berichtskennung) — für die „schon beantwortet“-Prüfung. */
  kennung: string;
  /** Ist diese Kennung (oder eine genannte D-Nummer) schon beantwortet? (Entscheidungs-Log, antwort-Feld) */
  beantwortet: (kennung: string) => boolean;
  /** Ist die genannte Paketnummer im Live-Stand? (Inhalt: Merge-Commit nach Paketnummer, releasestend.ts — nie nur Git-Abstammung) */
  paketLive: (nr: number) => boolean;
  /** Status eines genannten PRs: true = geschlossen/gemergt, false = offen, null = unbekannt. */
  prZu: (pr: string) => boolean | null;
  /** Gibt es einen neueren Strang mit demselben Ziel/Lauf? */
  laufNeuere: (lauf: string) => boolean;
  /** Aktionen, die der Hauptchat in dieser Instanz ausführen darf (leer = alle bleiben Entscheidungen). */
  hauptchatAktionen: string[];
  /** Nummern, die in der Zeile/Umgebung genannt sind (Paketnummer) und D-Kennungen — aus der Karte, wenn da. */
  paket?: number | null;
  pr?: string | null;
  lauf?: string | null;
  /** Alle PRs, die Karte oder Zeile nennen (repo#nr) — Nachtrag 02.11. (tariff-app#193). */
  prs?: string[];
  /** Ist der PR offen UND konfliktfrei (GitHub mergeable)? Dann ist ein Merge-/Konflikt-Anlass weg. */
  prKonfliktfrei?: (pr: string) => boolean;
  /** Strang ist angehalten/abgebrochen/erledigt: ein Satz, warum — dann gilt keine Bitte mehr (null = läuft/wartet normal). */
  strangZu?: string | null;
  /** Titel und Auftragsanfang des Unter-Chats — nur für die Frage „war der Anlass ein Konflikt?“. */
  anlassText?: string | null;
}

export interface BrauchtErgebnis {
  art: BrauchtArt;
  /** (c): warum geschlossen wird — ein Satz, mit dem Knut die Karte wiedererkennt. */
  grund?: string;
  /** (b): welche Hauptchat-Aktion das ist (push-nach-gate, merge-im-worktree, skill-installieren, strang-neustarten, cli-lesen). */
  aktion?: string;
  /** (a)/(b): ein Satz „Was du tun musst“ — nie Rohbericht. */
  wasTun: string;
  /** (a) aus einer harten Regel: warum das nur Knut kann (zugang, datenbank, geld, recht, extern, entscheidung). */
  nurKnut?: NurKnut;
}

export type NurKnut = 'zugang' | 'datenbank' | 'geld' | 'recht' | 'extern' | 'entscheidung';

/** Was nur Knut kann — der Hauptchat hat dafür keine Werkzeuge und keine Zugangsdaten (Knut 02.11.: „Unsicher → (a)“).
 *  Reihenfolge = Vorrang beim Text: die DB-Bitte („Zugang zu DEV … SQL“) ist eine Datenbank-Bitte, nicht nur ein Zugang. */
/** Ganze Wörter auch mit Umlauten (\b kennt nur ASCII); `~` am Wortende = beliebige Buchstaben danach. */
const wort = (alts: string[]) => new RegExp(`(?<![\\p{L}\\d_])(?:${alts.map((x) => x.replace(/~$/, '\\p{L}*')).join('|')})(?![\\p{L}\\d_])`, 'iu');
const NUR_KNUT: { re: RegExp; art: NurKnut; warum: string }[] = [
  { re: wort(['sql', 'select', 'datenbank~', 'db', 'query', 'abfrage~', 'ergebniszeile~', 'mongo~', 'postgres~', 'psql', '(prod|dev|uat)[- ]?(db|datenbank)']), art: 'datenbank', warum: 'Abfrage auf einer Datenbank (DEV/UAT/Prod) — dafür hat der Hauptchat keinen Zugang' },
  { re: wort(['zugang', 'zugänge', 'zugangsdaten', 'credentials?', 'passw(o|ö)rt~', 'token', 'api[-_ ]?key~', '(?!foreign|primary)[a-z0-9]+_(api_)?key', 'schlüssel~', 'secrets?', 'tunnel~', 'vpn', 'ssh', 'login', 'lesende[nr]? rolle', 'berechtigung~', 'freischalt~']), art: 'zugang', warum: 'Zugang oder Zugangsdaten — die gibt nur du' },
  { re: wort(['geld', 'zahlung~', 'bezahl~', 'überweis~', 'rechnung~', 'kosten~', 'budget~', 'euro', 'kauf~', 'bestell~', 'lizenz~', '€']), art: 'geld', warum: 'es geht um Geld' },
  { re: wort(['vertr(a|ä)g~', 'avv', 'dsgvo', 'rechtlich~', 'jurist~', 'anwalt~', 'unterschr~', 'zeichn~', 'kündig~', 'datenschutz~', 'haftung~']), art: 'recht', warum: 'es geht um Recht oder Verträge' },
  { re: wort(['extern~', 'kund(e|in|en)', 'partner~', 'anruf~', 'anrufen', 'e-?mail an', 'mail an', 'nachfragen bei', 'bei \\p{Lu}\\p{L}+ (nachfragen|anfragen|fragen)', 'ausführen lassen']), art: 'extern', warum: 'dafür braucht es eine andere Person' },
];

/** „Was du tun musst“ je Art — ein Satz, den Knut ohne den Strang versteht. */
const WAS_TUN: Record<Exclude<NurKnut, 'entscheidung'>, string> = {
  datenbank: 'DEV-Abfrage ausführen lassen (etwa Christoph) oder lesenden Zugang geben — oder die Zahlen selbst liefern.',
  zugang: 'Zugang geben (oder jemanden bitten) — der Hauptchat hat keine Zugangsdaten.',
  geld: 'Entscheiden, ob das Geld ausgegeben wird — der Hauptchat darf das nicht.',
  recht: 'Rechtlich entscheiden oder freigeben — der Hauptchat darf das nicht.',
  extern: 'Die genannte Person ansprechen — der Hauptchat kann niemanden außerhalb erreichen.',
};

/** Erster SQL-Block (```sql … ```) aus einem Text — für „zum Kopieren“ auf der Karte. Höchstens 4000 Zeichen. */
export function sqlAus(text: string | null | undefined): string | null {
  const m = /```sql[^\n]*\n([\s\S]*?)```/i.exec(String(text ?? ''));
  const s = m?.[1]?.trim() ?? '';
  return s ? s.slice(0, 4000) : null;
}

const ein = (s: string) => s.replace(/\s+/g, ' ').trim();
/** Zeile hängt an einem Merge/Konflikt (dann zählt „PR konfliktfrei“ als erledigt). */
const MERGE_ANLASS = /\b(merge\w*|konflikt\w*|conflict\w*|rebase\w*)\b/i;
/** … und zwar ein Konflikt bzw. ein Merge von develop/main in den Zweig (Zeile, Titel oder Auftrag des Unter-Chats). */
const KONFLIKT_ANLASS = /\b(konflikt\w*|conflict\w*|rebase\w*)\b|\bmerge\s+(origin\/)?(develop|main|dev)\b/i;
/** PR-Kennungen „repo#123“ (ohne Org) aus einem Text oder einer GitHub-Adresse — dieselbe Form wie github_prs (github.ts). */
export function prsAus(...texte: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const t of texte) {
    const s = String(t ?? '');
    for (const m of s.matchAll(/github\.com\/[\w.-]+\/([\w.-]+)\/pull\/(\d+)/g)) out.add(`${m[1]}#${m[2]}`);
    for (const m of s.matchAll(/(?:[\w.-]+\/)?((?=[\w.-]*[a-z]{3})[\w.-]+)\s?#(\d{1,6})\b/gi)) out.add(`${m[1]}#${m[2]}`);
  }
  return [...out];
}
const D_RE = /\bD\d+\b/g;

/** Aktionen des Hauptchats, die nie Knut selbst tun muss: Muster → Aktionsname. */
const AKTIONEN: { re: RegExp; aktion: string }[] = [
  { re: /\bpush(en)?\b|\bpush-ok\b|\bfreigeben und pushen\b/i, aktion: 'push-nach-gate' },
  { re: /\bmerge\b/i, aktion: 'merge-im-worktree' },
  { re: /\bskill\b.*\b(kopieren|installieren|einrichten)\b|\b(kopieren|installieren)\b.*\bskill\b/i, aktion: 'skill-installieren' },
  { re: /\bstrang\b.*\bneu starten\b|\bneu starten\b.*\bstrang\b|\bneustart\b/i, aktion: 'strang-neustarten' },
  { re: /\bcli\b.*\b(laufen|ausführen)\b|\b(laufen|ausführen)\b.*\bcli\b|audit.*\blaufen\b/i, aktion: 'cli-lesen' },
];

/** (b) nur, wenn der Hauptchat die Aktion ausführen DARF: Freigabe-Weg (WERKBANK_HAUPTCHAT_GITHUB, orch-Aktionen). */
const aktionErlaubt = (a: string | undefined, erlaubt: string[]) => !!a && erlaubt.includes(a);

/**
 * Eine „Braucht Knut“-Zeile einordnen. Reihenfolge: (c) schlägt (b) schlägt (a) — ist etwas erledigt, kommt
 * keine Frage mehr; kann der Hauptchat es selbst, fragt Knut nicht.
 */
export function klassifiziere(zeile: string, k: BrauchtKontext): BrauchtErgebnis {
  const z = ein(zeile);
  const t = z.replace(/[.!?]$/, '').slice(0, 200);

  // ---- (c) veraltet/erledigt: Gründe sammeln, jeder mit einem Satz Begründung ----
  const gruende: string[] = [];
  // Pass C: matchAll je Aufruf (ein /g-Regex mit test() davor ließ lastIndex stehen und übersprang D-Nummern).
  const ds = [...z.matchAll(D_RE)].map((m) => m[0]);
  if (k.beantwortet(k.kennung) || (ds.length > 0 && ds.every((d) => k.beantwortet(d)))) gruende.push('schon beantwortet (steht im Entscheidungs-Log bzw. als antwort im Kopf)');
  if (k.paket != null && k.paketLive(k.paket)) gruende.push(`Paket ${k.paket} ist im Live-Stand (Merge-Commit nach Paketnummer)`);
  // Nachtrag 02.11. (tariff-app#193 „Merge muss erlaubt werden“, heute konfliktfrei): Anlass weg → (c). Jeder genannte PR zählt.
  const prs = [...new Set([k.pr, ...(k.prs ?? [])].filter((p): p is string => !!p))];
  for (const pr of prs) if (k.prZu(pr) === true) gruende.push(`PR ${pr} ist geschlossen oder gemergt`);
  if (k.lauf != null && k.laufNeuere(k.lauf)) gruende.push('ein neuerer Strang mit demselben Ziel hat das übernommen');
  if (gruende.length) return { art: 'veraltet', grund: gruende.join('; '), wasTun: '' };

  // ---- (a) harte Regel: was nur Knut kann, schlägt jede erkannte Aktion (echter Fall 574aa7bb: „Zugang zu DEV … SQL“
  //      war als push-nach-gate eingeordnet). Offene D-Entscheidungen in der Zeile ebenso. ----
  const hart = NUR_KNUT.find((r) => r.re.test(z));
  const offenD = ds.some((d) => !k.beantwortet(d)) || /\bentscheid(en|ung)\b/i.test(z);

  // ---- (c) aus schwächeren Belegen (Pass C): nur, wenn keine harte Regel und keine offene D-Frage greift ----
  if (!hart && !offenD) {
    // Konfliktfrei heißt nur für einen Konflikt-/develop-Merge-Anlass „erledigt“ — eine Bitte „PR mergen“ bleibt (Pass C).
    const konflikt = MERGE_ANLASS.test(z) && KONFLIKT_ANLASS.test(`${z} ${k.anlassText ?? ''}`);
    for (const pr of prs) if (konflikt && k.prKonfliktfrei?.(pr)) gruende.push(`PR ${pr} ist heute konfliktfrei (GitHub: mergeable) — der Merge-Anlass ist weg`);
    if (k.strangZu) gruende.push(k.strangZu);
    if (gruende.length) return { art: 'veraltet', grund: gruende.join('; '), wasTun: '' };
  }
  if (hart) return { art: 'entscheidung', nurKnut: hart.art, wasTun: `${WAS_TUN[hart.art as Exclude<NurKnut, 'entscheidung'>]} Warum du: ${hart.warum}. Bitte des Unter-Chats: „${t}“` };
  if (offenD) return { art: 'entscheidung', nurKnut: 'entscheidung', wasTun: t };

  // ---- (b) Hauptchat-Aktion ----
  // Eine Frage mit Alternative („pushen oder warten?“) ist eine Entscheidung, keine Aufgabe (Pass C).
  const wahl = /\?/.test(z) && /\boder\b/i.test(z);
  const akt = wahl ? undefined : AKTIONEN.find((a) => a.re.test(z))?.aktion;
  if (aktionErlaubt(akt, k.hauptchatAktionen)) {
    return { art: 'aktion', aktion: akt, wasTun: `Nichts für dich — der Hauptchat kann das ausführen (${akt}).` };
  }

  // ---- (a) echte Entscheidung ----
  return { art: 'entscheidung', wasTun: t };
}

/** Hauptchat-Aktionen dieser Instanz (für BrauchtKontext.hauptchatAktionen): GitHub-Weg frei + Strang-Aktionen immer.
 *  Derselbe Wert wie githubAktionAn (githubaktion.ts) und githubAppend (Brücke, profil.ts): nur „on“ — hier kein Import,
 *  damit die Klassifikation rein bleibt. */
export function hauptchatAktionen(env: NodeJS.ProcessEnv = process.env): string[] {
  const basis = ['skill-installieren', 'strang-neustarten', 'cli-lesen'];
  return env.WERKBANK_HAUPTCHAT_GITHUB === 'on' ? [...basis, 'push-nach-gate', 'merge-im-worktree'] : basis;
}

// ---- Budget-Knöpfe (S3, Knut 30.10.): Knuts Wortlaut „schließen“ / „+50 % Budget“ -----------------

/** Knöpfe einer Budget-Frage. Schalter aus: die alten („Weiter mit +50 %“, „Anhalten“) — Faktor 1,5 bleibt gleich. */
export function budgetOptionen(budget: number, env: NodeJS.ProcessEnv = process.env): { label: string; consequence: string }[] {
  if (!BRAUCHT_AN(env)) return [
    { label: 'Weiter mit +50 %', consequence: `Hebt das Budget auf ${fmt(Math.ceil(budget * 1.5))} Tokens und schickt „weiter“.` },
    { label: 'Anhalten', consequence: 'Der Unter-Chat gilt als geprüft und läuft nicht weiter.' },
  ];
  return [
    { label: '+50 % Budget', consequence: `Hebt das Budget auf ${fmt(Math.ceil(budget * 1.5))} Tokens und schickt „weiter“.` },
    { label: 'schließen', consequence: 'Schließt die Frage — der Unter-Chat gilt als geprüft und läuft nicht weiter.' },
  ];
}

/** Wirkung eines gewählten Knopfes — neue und alte Labels, damit offene Fragen nach einem Schalterwechsel beantwortbar bleiben. */
export function budgetWirkung(label: string): 'weiter' | 'anhalten' | null {
  if (label === '+50 % Budget' || label === 'Weiter mit +50 %') return 'weiter';
  if (label === 'schließen' || label === 'Anhalten') return 'anhalten';
  return null;
}

/** Empfehlung einer Budget-Frage — Knöpfe und Empfehlung müssen dieselben Worte benutzen. */
export function budgetEmpfehlung(env: NodeJS.ProcessEnv = process.env): string {
  return BRAUCHT_AN(env)
    ? 'Chat ansehen: kommt der Unter-Chat voran und der Rest ist klein, „+50 % Budget“; sonst „schließen“ und den Auftrag schärfen.'
    : 'Chat ansehen: kommt der Unter-Chat voran und der Rest ist klein, „Weiter mit +50 %“; sonst „Anhalten“ und den Auftrag schärfen.';
}

const fmt = (n: number) => new Intl.NumberFormat('de-DE').format(n).replace(/ | /g, ' ');

