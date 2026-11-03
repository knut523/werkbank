// Werkbank 2.0: die Begriffe der Oberfläche — nur diese (docs/plan-werkbank-2.md §4). Kein Strang/Leitstand/Orchestrator/Vault/Inbox.
// Die Liste ist zugleich die Seite „Begriffe“ (Knopf „?“ oben rechts).

export interface Begriff { wort: string; heisst: string; beispiel: string }

/** „Was ist OLAF?“ ohne Chat (Persona Lisa): Quelle olaf/olaf-Home.md, Abschnitt „start here“. */
export const OLAF_KURZ = 'OLAF ist ein Venture des MAXENERGY Inno Teams: Wir bauen ein Angebot rund um Energiegemeinschaften für Haushalte — gemeinsam mit den Partnern Enlion und Raiffeisen Energy Ventures.';
export const OLAF_MEHR = 'v2/dokument?vault=' + encodeURIComponent('olaf/olaf-Home.md');

export const BEGRIFFE: Begriff[] = [
  { wort: 'OLAF', heisst: OLAF_KURZ, beispiel: 'Der Rechner, die Anmeldestrecke und der Service für Energiegemeinschaften gehören dazu.' },
  { wort: 'Wartet auf dich', heisst: 'Etwas, das ohne deine Antwort nicht weitergeht — eine Entscheidung, eine Freigabe oder ein Sammelposten zum Aufräumen (z. B. „8 Tickets brauchen Pflege“). Die Zahl oben rechts zählt genau diese Dinge; unter „Entscheidungen“ steht, woraus sie besteht.', beispiel: 'Ein Agent fragt, welche Variante er bauen soll.' },
  { wort: 'Entscheidung', heisst: 'Eine Frage mit Empfehlung. Du sagst „Ja, so“ (Empfehlung übernehmen) oder „Anders: …“ und schreibst, was stattdessen.', beispiel: '„Für alle Gemeinschaften regional rechnen?“ — Empfehlung: je Gemeinschaft hinterlegen.' },
  { wort: 'Freigabe', heisst: 'Eine Erlaubnis für einen Schritt nach außen, zum Beispiel Code auf GitHub hochladen. Freigaben gibst du (noch) in der alten Werkbank.', beispiel: '„Push freigeben: Kundenakte …“' },
  { wort: 'Unter-Chat', heisst: 'Ein Auftrag, an dem ein Agent selbstständig arbeitet — mit Bericht am Ende. Unter „Arbeit“ siehst du, was läuft, was wartet und was fertig ist.', beispiel: '„Netzentgelte 2027 recherchieren“' },
  { wort: 'Chat (Hauptchat)', heisst: 'Dein Gespräch mit dem Assistenten, der die Arbeit verteilt und Fragen beantwortet. Er ist auf jeder Seite rechts (am Handy: Knopf unten rechts).', beispiel: '„Was ist mit dem Rechner-Auftrag los?“' },
  { wort: 'Bericht', heisst: 'Das Ergebnis eines Unter-Chats: was gemacht wurde, was offen ist, welche Entscheidungen es braucht.', beispiel: 'Bericht 435 „Netzkostenabrechnung“' },
  { wort: 'Dokument', heisst: 'Alles Lesbare: Berichte, Notizen aus unserer Wissenssammlung, Dateien. Unter „Dokumente“ kannst du suchen.', beispiel: 'Datenschutzkonzept, Tarif-Übersicht' },
  { wort: 'PR (Pull Request)', heisst: 'Ein Code-Vorschlag auf GitHub, der geprüft werden muss, bevor er live geht. „Wartet auf“ sagt, wer gerade dran ist.', beispiel: 'olaf-admin#386 wartet auf Knut' },
  { wort: 'Review', heisst: 'Die Prüfung eines PRs — durch einen Menschen oder einen Agenten. Den Text des Agenten liest du direkt am PR.', beispiel: 'Empfehlung des Agenten: „approve“ (freigeben)' },
];

/** Wörter, die in sichtbaren Texten der App nicht vorkommen dürfen (Jargon der alten Werkbank). */
export const VERBOTEN = [/\bStrang\b/, /\bStränge\b/, /\bLeitstand\b/, /\bOrchestrator\b/, /\bVault\b/, /\bInbox\b/, /Braucht Knut/, /Braucht dich/, /\bLead\b/];
