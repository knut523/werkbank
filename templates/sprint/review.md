---
title: "Sprint {{DATUM}} — Review"
type: reference
team: olaf
area: meta
status: draft
created: {{HEUTE}}
last-verified: {{HEUTE}}
tags: []
sources: []
related: ["[[sprint-{{DATUM}}-summary]]", "[[sprint-{{DATUM}}-planning]]", "[[{{VORZYKLUS}}-planning]]", "[[Olaf-Sprint-MOC]]"]
---

# Sprint {{DATUM}} — Review

Review des Zyklus vom {{VORZYKLUS_DATUM}}, gemessen an dessen Sprint-Ziel: je Arbeitspaket, wo es steht, was
offen ist, wo es hängt.

**So ist die Notiz aufgebaut.** Jede Domäne hat zuerst ihre Pakete mit den **To-Do-Tickets**. To Do heißt: in
Arbeit, fällig bis zum Ende des neuen Sprints ({{ENDE_DE}}) oder schon überfällig. Darunter steht der
**Backlog** der Domäne: Tickets ohne Termin in diesem Sprint, je mit der Frage „In diesen Sprint mitnehmen?“.
**Laufende Aufgaben** (Status `Ongoing`) stehen gesammelt in einem eigenen Abschnitt.

**Woher die Angaben stammen.** {{QUELLENLAGE}}

**Fertig heißt: getestet, auf Dev, dann auf Prod.** Was nur gebaut ist, gilt noch nicht als erledigt.

> [!tip] Diese Notiz ist ein Arbeitsdokument, kein Protokoll
> Antworten direkt unter die Ticketzeile schreiben: `  - Name: Text` (in der aufklappbaren Liste mit `>   - Name: Text`).
> Ein Text wird zum Jira-Kommentar, `status:Done` zur Statusänderung, `→ mitnehmen: …` zur Mitnahme (nie nach Jira).
> Beim Backlog genügt `ja, fällig TT.MM.` oder `nein`. Freier Text ohne Antwortzeile geht nicht nach Jira.
> Jedes Ticket steht genau einmal, in seinem Paket.

## Soll-Ist zum Sprint-Ziel vom {{VORZYKLUS_DATUM}}

{{SOLL_IST}}

### Monatsziele — Halbzeitstand

…

## Mitnahme aus dem letzten Sprint

{{MITNAHME_ALT}}

## Die Updates

> [!abstract] Zuerst ansehen
> - … (die wichtigsten Themen dieser Runde — sie bekommen oben ihren eigenen, größeren Abschnitt, auch ohne Sub-tasks)

{{UPDATES}}

## Auffälligkeiten

{{AUFFAELLIG}}

## Unklar geblieben

## Mitnahme in den nächsten Sprint

## Pointers

- [[Olaf-Sprint-MOC]]
