# Plan: „Mein Tag“ schlägt den Tag vor (statt leerer Tag)

Anlass: Knut, 30.10.2026 — „kannst du im Workspace einmal mein Tag einen Vorschlag machen (Prios vorschlagen und anstatt
leeren Tag)“. Am 30.10. von Hand einmal gemacht (8 Blöcke, Prio 1–3, Feld `quelle: 'Vorschlag Hauptsitzung'`).

## Ziel

Öffnet Knut morgens „Mein Tag“ und der Tag ist leer, steht dort ein Vorschlag: Blöcke mit Uhrzeit, Dauer und
Tagespriorität (1 Muss · 2 Soll · 3 Kann), abgeleitet aus dem, was ohnehin bekannt ist. Ein Klick übernimmt, einzelne
Blöcke lassen sich verwerfen oder verschieben. Nichts wird ungefragt in Jira oder in den Kalender geschrieben.

## Quellen (alles schon vorhanden, nur lesen)

- Morgenlage des Chief of Staff (Zusagen mit Fälligkeit, Themen, OLAF-Jira lesend).
- „Wartet auf dich“: offene Rückfragen des Orchestrators, Entscheidungen an Chats, Push-Freigaben.
- Fertige Stränge mit „Braucht Knut“ (Übersicht).
- Übertrag von gestern (`carryOver`), Termine aus dem ICS-Feed, sobald `COS_ICS` an ist (Lücken statt Überlappung).

## Regeln

1. Prio 1 = fällig heute/morgen oder blockiert einen laufenden Strang; Prio 2 = Review/Feedback, das Arbeit freigibt;
   Prio 3 = Rest. Höchstens 3 Muss-Blöcke.
2. Entscheidungen werden gebündelt (ein Block „Morgenlage durcharbeiten“), nicht je Frage ein Block.
3. Vorschlag nur, wenn der Tag leer ist; sonst ein Hinweis „Vorschlag ansehen“.
4. Vorschlagsblöcke tragen `quelle: 'vorschlag'` und sind bis zur Übernahme grau.
5. Erzeugt wird regelbasiert; ein Modell formuliert höchstens die Titel (Melious, Abo).

## DoD

- Leerer Tag → Vorschlag sichtbar; „Übernehmen“ legt die Blöcke an; „Verwerfen“ je Block.
- Test mit echten Daten aus der Morgenlage (Fixtures aus dem echten Erzeuger), aktiver Test im Browser mit Screenshot.
- Schalter `WERKBANK_TAGESVORSCHLAG` (aus = heutiges Verhalten).
