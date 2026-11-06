// Werkbank 2.0, S14 (Paket 436, Council C5): jeder Eintrag der alten Navigation hat hier einen Platz — entweder in 2.0 gebaut
// (ziel 'v2') oder als Link in die alte Werkbank (ziel 'alt', Stand „erreichbar (alte Seite)“, nie „in V2“). Der Test
// web/app/test/regeln.test.ts liest die alte Navigation (web/src/App.tsx) und verlangt für jeden Eintrag eine Zeile.

export interface MehrEintrag {
  /** Adresse in der alten Werkbank (Hash-Route). */
  alt: string;
  titel: string;
  /** Ein Satz in Klartext: was man dort tut. */
  satz: string;
  ziel: 'v2' | 'alt';
  /** v2: Pfad in 2.0; alt: Seite unter der alten Werkbank (…/wb/<seite>). */
  url: string;
}

export const MEHR: MehrEintrag[] = [
  { alt: '#/', titel: 'Übersicht / Heute', satz: 'Was jetzt auf dich wartet, was läuft und was heute fertig wurde.', ziel: 'v2', url: 'v2/' },
  { alt: '#/entscheidungen', titel: 'Entscheidungen', satz: 'Alle offenen Fragen mit Empfehlung, nach Thema.', ziel: 'v2', url: 'v2/entscheidungen' },
  { alt: '#/arbeit', titel: 'Unter-Chats', satz: 'Aufträge, an denen Agenten arbeiten, mit Stand und Fragen.', ziel: 'v2', url: 'v2/arbeit' },
  { alt: '#/lead', titel: 'Hauptchat und Unter-Chats (Lead)', satz: 'Den Hauptchat erreichst du über den Knopf „Chat“, die Unter-Chats unter „Arbeit“.', ziel: 'v2', url: 'v2/arbeit' },
  { alt: '#/arbeit/reviews', titel: 'Reviews und PRs', satz: 'Code-Änderungen zur Prüfung, wer dran ist, was der Prüf-Agent sagt.', ziel: 'v2', url: 'v2/prs' },
  { alt: '#/erledigt', titel: 'Heute erledigt', satz: 'Was an einem Tag fertig wurde — mit Datumswahl.', ziel: 'v2', url: 'v2/erledigt' },
  { alt: '#/wissen', titel: 'Wissen (Notizen)', satz: 'Notizen und Berichte lesen und suchen.', ziel: 'v2', url: 'v2/dokumente' },
  { alt: '#/ablage', titel: 'Berichte und Ablage', satz: 'Berichte liest du unter „Dokumente“; Dateien ablegen (mit Namensvorschlag) geht in der alten Werkbank.', ziel: 'alt', url: 'ablage' },
  { alt: '#/dateien', titel: 'Meine Dateien', satz: 'Dateien der Agenten, Downloads und Datensicherung.', ziel: 'v2', url: 'v2/dateien' },
  { alt: '#/lage', titel: 'Lage', satz: 'Gesamtbild über alle Unter-Chats, Dienste und Fristen.', ziel: 'v2', url: 'v2/lage' },
  { alt: '#/roadmap', titel: 'Roadmap', satz: 'Woran das Team arbeitet, nach Bereich und Stand.', ziel: 'v2', url: 'v2/roadmap' },
  { alt: '#/board', titel: 'Jira-Board', satz: 'Tickets auf beiden Boards, Pflege und Fälligkeiten.', ziel: 'v2', url: 'v2/board' },
  { alt: '#/sprint', titel: 'Sprint', satz: 'Sprint-Review und -Planung.', ziel: 'v2', url: 'v2/sprint' },
  { alt: '#/ziele', titel: 'Ziele', satz: 'Ziele und Schlüsselergebnisse mit Fälligkeit.', ziel: 'v2', url: 'v2/ziele' },
  { alt: '#/timebox', titel: 'Mein Tag', satz: 'Tagesvorschlag mit Zeitblöcken.', ziel: 'v2', url: 'v2/tag' },
  { alt: '#/skills', titel: 'Skills', satz: 'Welche Fähigkeiten die Agenten haben und welche für dich gelten.', ziel: 'v2', url: 'v2/skills' },
  // Runde 7 (Abgleich): Morgenlage, Tagesabschluss, Hygiene hingen an der alten Übersicht — ohne Link waren sie weg.
  { alt: '#/heute', titel: 'Morgenlage, Tagesabschluss, Hygiene', satz: 'Die alte Übersicht mit Morgenlage, Tagesabschluss und Hygiene-Liste.', ziel: 'alt', url: 'heute' },
  { alt: '#/einrichtung', titel: 'Einrichtung', satz: 'Claude verbinden, Jira und Melious einrichten, Team-Freigaben, Dienste.', ziel: 'v2', url: 'v2/einrichtung' },
];

/** Parität (Knut 06.11.): Seiten der alten Werkbank, die selbst in der 2.0 eingehängt sind (alt.tsx) — alte Hash-Route (wie im
 * Router von web/src/App.tsx), 2.0-Adresse und Freigabe-Schlüssel (web/server/features.ts; '' = immer). Eine Liste, eine Quelle. */
export const ALT_SEITEN: { hash: string; pfad: string; f: string }[] = [
  { hash: '#/board', pfad: 'v2/board', f: 'board' },
  { hash: '#/sprint', pfad: 'v2/sprint', f: 'sprint' },
  { hash: '#/ziele', pfad: 'v2/ziele', f: 'ziele' },
  { hash: '#/roadmap', pfad: 'v2/roadmap', f: 'roadmap' },
  { hash: '#/lage', pfad: 'v2/lage', f: 'leitstand' },
  { hash: '#/timebox', pfad: 'v2/tag', f: 'timebox' },
  { hash: '#/skills', pfad: 'v2/skills', f: 'skills' },
  { hash: '#/einrichtung', pfad: 'v2/einrichtung', f: '' },
  { hash: '#/dateien', pfad: 'v2/dateien', f: 'dateien' },
];
export const ALT_PFADE: Record<string, string> = Object.fromEntries(ALT_SEITEN.map((s) => [s.pfad, s.hash]));
