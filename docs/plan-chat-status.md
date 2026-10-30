---
status: gebaut, hinter Schalter (aus) — Knut entscheidet am 29.10.2026
quelle: Knut, 26.10.2026: „Chats bekommen den Status ‚braucht Knut‘ – dann muss ich was machen, alles lesen und dann Entscheidungen geben …? Das sollte irgendwie einfach gehen, wenn wir es an den Chat anlegen … und der Status muss klar sein (braucht Knut / in Review / done oder so)“
---

# Chat-Status und Entscheidungen am Chat (Release 29, Strang B)

## Ziel / DoD (wörtlich aus dem Auftrag)

1. Genau ein klarer Status je Chat/Strang mit kleiner, fester Menge, z. B. „läuft“ · „braucht Knut“ · „in Review“ · „fertig“ · (ggf. „hängt“). Abbildung aller heutigen Zustände darauf dokumentiert. Sichtbar in Leiste, Arbeit-Liste und im Chatkopf.
2. „braucht Knut“ heißt immer: oben im Chat eine Karte mit genau den offenen Fragen (D1…), je Frage Worum (1 Satz), Optionen, Empfehlung, Knöpfe Ja/Nein/Anders/Später + Notizfeld. Kein Lesen des ganzen Verlaufs nötig. Antwort geht in den Strang zurück, der Strang macht weiter, Status wechselt automatisch. Dieselben Fragen erscheinen auf der Entscheidungsseite (eine Quelle).
3. „in Review“ = Paket fertig, wartet auf Knuts Durchsicht: Karte mit Link zum Paket, Screenshots, Knöpfe „passt“ (→ fertig) / „Änderung“ (Textfeld → Strang läuft weiter).
4. Hinter Schalter (Vorgabe aus), Tests, Screenshots (Playwright) aller Zustände, Desktop + Handy.

## Ist-Stand (gegen den Code belegt, Basis f68bd4d)

Heute gibt es fünf Vokabulare für „wie steht der Chat“:

| Vokabular | Werte | Stelle |
|---|---|---|
| Brücken-Status | running · waiting · done · failed · blocked_g0 | `web/server/orchestrator.ts` `orchStatus` |
| Stand-Marke im Antworttext (`Status:`) | fertig · braucht Antwort · blockiert | `statusMark` |
| Zustand (Plan 213) | läuft · in der Schlange · wartet auf dich · Stand fehlt · hängt? · blockiert · fertig · erledigt | `web/server/zustand.ts`, gespeichert als `zustand` am Lauf |
| Hauptchat-Wort (Leiste) | läuft · wartet · fertig · gestoppt · erledigt | `statusWord` in `leitstand.ts` |
| Ampel der Übersicht | push · review · laeuft · blockiert | `ampel` in `uebersicht.ts` |

Fragen an Knut landen in **einer** Inbox (`inbox.ts`: Rückfragen, Bericht-Entscheidungen D1…, „Braucht Knut“ im Stand, Push, Vault …); die Entscheidungsseite `#/entscheidungen` (`entscheidungsseite.ts`, Paket 213/266) zeigt sie als Karten mit Ja · Alternativen (Klick, Paket 266) · Nein · Später · Anders + Notiz; die Antwort geht an die Quelle (`/api/entscheidungen/fragen/antwort`), ein Strang arbeitet nach der letzten Antwort weiter. Berichte tragen Fragen im Kopf `fragen:` (`berichtkopf.ts`). Paket 213 hat Leiste (Lead · Entscheidungen · Arbeit · Heute · Mehr) und Arbeit-Liste gebracht.
Lücke: Auf der Entscheidungsseite sind die Fragen aller Chats gemischt, im Chat selbst sieht Knut nur Text; und jede Ansicht nennt den Zustand anders.

## Der eine Status — Abbildung (Code: `web/server/chatstatus.ts`, Tabelle `ABBILDUNG`)

Fünf Werte. Abgeleitet aus dem Zustand (Plan 213) plus offene Fragen plus „von Knut geprüft“; nichts Neues wird gespeichert.

| Chat-Status | Zeigt | Entsteht aus |
|---|---|---|
| **läuft** | blau | Zustand läuft · in der Schlange · Stand fehlt |
| **braucht Knut** | gelb | mindestens eine offene Frage (Rückfrage, D…, „Braucht Knut“) — egal was der Zustand sagt; sonst Zustand wartet · blockiert |
| **in Review** | neutral | Zustand fertig (Agent meldet „fertig“), keine offene Frage, noch nicht von Knut geprüft |
| **fertig** | grün | von Knut „passt“ gesagt, oder automatisch weggeräumt (erledigt) |
| **hängt** | rot | Zustand hängt? (technisch festgefahren) |

Brücken-Status, Marke, Hauptchat-Wort und Ampel bleiben unverändert (Brücke, Tests, Gruppierung der Leiste hängen daran).

## Schnitte

- S1 `chatstatus.ts` (rein, getestet) + Schalter `WERKBANK_CHAT_STATUS` (Vorgabe aus).
- S2 Server: `GET /api/chatstatus` (Liste) und `GET /api/chatstatus/<Strang|Unterhaltung>` (Karte); Arbeit-Liste liefert `cs` je Zeile. „Passt“/„Änderung“/Freitext-Antwort nutzen die vorhandenen Endpunkte `/api/leitstand/strands/<id>/passt|reply`, Antworten auf Fragen den vorhandenen `/api/entscheidungen/fragen/antwort`.
- S3 Oberfläche: `chatkarte.tsx` (Karte, Seite `#/chatkarte/<id>`), Chip in Arbeit-Liste, wiederverwendete Frage-Karte der Entscheidungsseite (`kurz`: „Worum“ in einem Satz).
- S4 LibreChat: Overlay `ChatStatusKopf.tsx` + Patch `85-client-chatstatus-kopf.patch` (Streifen oben im Chat, Karte als iframe); Leiste zeigt das Wort aus `/api/chatstatus` (`HauptchatSection.tsx`).
- S5 Tests, Playwright-Aufnahmen (`web/e2e/chat-status-shots.ts`).

## Bewusst nicht gebaut

- Gruppierung und Zähler der Themen in der Leiste bleiben beim alten Status (nur das Wort je Chat ändert sich).
- Ausrollen/Schalter setzen: macht Knut am 29.10.
