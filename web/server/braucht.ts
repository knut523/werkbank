// „Braucht dich“-Klassifikation (R30b Teil A, Knut 02.11.: „ich weiß nicht, was ich in diesen Situationen
// tun soll … wir sollten das systematisch fixen“): jede „Braucht Knut“-Zeile eines Strangs wird sortiert in
//  (a) echte Entscheidung für Knut → Entscheidungsseite (Kontext · Optionen · Empfehlung · Knöpfe),
//  (b) Aktion, die der Hauptchat selbst kann (Push nach Gate, Merge im Worktree, Skill installieren,
//      CLI laufen lassen, Strang neu starten) → Aufgabe an den Hauptchat, keine Frage an Knut,
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
}

export interface BrauchtErgebnis {
  art: BrauchtArt;
  /** (c): warum geschlossen wird — ein Satz, mit dem Knut die Karte wiedererkennt. */
  grund?: string;
  /** (b): welche Hauptchat-Aktion das ist (push-nach-gate, merge-im-worktree, skill-installieren, strang-neustarten, cli-lesen). */
  aktion?: string;
  /** (a)/(b): ein Satz „Was du tun musst“ — nie Rohbericht. */
  wasTun: string;
}

const ein = (s: string) => s.replace(/\s+/g, ' ').trim();
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
  if (k.pr != null) { const zu = k.prZu(k.pr); if (zu === true) gruende.push(`PR ${k.pr} ist geschlossen oder gemergt`); }
  if (k.lauf != null && k.laufNeuere(k.lauf)) gruende.push('ein neuerer Strang mit demselben Ziel hat das übernommen');
  if (gruende.length) return { art: 'veraltet', grund: gruende.join('; '), wasTun: '' };

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

