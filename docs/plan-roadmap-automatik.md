---
status: Plan, freigegeben (Knut, 08.10.2026), im Bau
quelle: Knut, 07.10.2026: „Roadmap sollte auch automatisch aktualisiert werden, also der View und was für mich offen ist“ (Plan 81, Schnitt 8) · 08.10.2026: „kannst du in der werkbank mal auch automatisch die product roadmap und so aktualisieren auch im vault“ · Freigabe 08.10.: „Ja nach jedem agenten lauf gezielt nachziehen, offene entscheidungen surfacen … und die anderen punkte auch“
---

# Roadmap-Automatik: Vault und Werkbank ziehen sich selbst nach

## Ziel

Die Produkt-Roadmap im Vault und die Roadmap-Seite der Werkbank zeigen jederzeit, was wirklich offen ist —
ohne dass jemand von Hand nachzieht. Was eine Maschine nicht allein entscheiden darf (löschen, Specs
verschieben, Menschentext umschreiben), steht als Frage mit ✅ Ja / ✖️ Nein unter **„Für mich offen“** und wird
nach dem Ja ausgeführt.

## Stand heute

- **Vault-Sync** (`olaf-produkt-roadmap/scripts/vault-sync.sh`, Cron werktags 07:30 und 13:30): Snapshot aus
  GitHub und lokalen Worktrees → Claude ohne Sitzung (nur Datei-Werkzeuge) zieht PR-Register, Übersichten, Specs
  und Timeline nach, schreibt ins Protokoll `1-Projects/daily-debrief/vault-sync-protokoll.md`. Er löscht nie,
  verschiebt selten, schreibt Menschentext nie um; was er so nicht darf, landet als „Offen/unklar“ im Protokoll —
  und bleibt dort liegen (z. B. am 08.10.: 14 Cockpit-Zeilen, E0 in Plan, „Woran wir gerade arbeiten“ vom 01.10.).
- **Der Snapshot kennt die Werkbank nicht:** keine Jira-Status, keine Agentenläufe, keine Projekte.
- **Werkbank-Roadmap** (`web/server/roadmap.ts`, `web/src/pages/Roadmap.tsx`): liest den Vault, zeigt Rangliste,
  Zustände, Live-PRs (GitHub alle 5 min, „wer ist dran“), offene `- Knut:`-Zeilen, Konsistenz. Keine Sicht
  „Für mich offen“; ein Agentenlauf löst keinen Nachzug aus.

## Entscheidungen (Knut, 08.10.2026)

| | Frage | Entscheidung |
|---|---|---|
| E1 | Auslöser | Cron bleibt; **zusätzlich gezielter Nachzug nach jedem fertigen Karten-Agenten** (nur dessen Ticket) |
| E2 | Offene Punkte des Syncs | **als Ja/Nein-Fragen unter „Für mich offen“**; Ja → der nächste Sync führt genau diesen Punkt aus |
| E3 | Werkbank-Daten im Snapshot | **Jira-Status, Agentenläufe, Projekte je Workstream** |
| E4 | „Woran wir gerade arbeiten“ | **täglich 07:30 als Entwurf**, übernommen erst nach Ja |

## Schnitte

1. **Werkbank-Feed für den Snapshot (E3).** Die Werkbank schreibt alle 5 Minuten und vor jedem Sync-Start `~/.cache/vault-sync/werkbank-feed.md` (Pfad per `WERKBANK_ROADMAP_FEED`): offene PM-Tickets mit
   Status/Owner/Datum (geändert in den letzten 3 Tagen zuerst), fertige Agentenläufe der letzten 3 Tage (Ticket,
   Projekt, geschriebene Vault-Notizen, PR-Links aus diesen Notizen), Projekte je Workstream. Keine Zugangsdaten,
   keine Kundendaten, keine Chat-Inhalte. `vault-sync-snapshot.sh` hängt die Datei an, wenn sie jünger als 24 h ist.
2. **Gezielter Nachzug nach Agentenlauf (E1).** Ein Karten-Agent mit Ticket ist fertig → Ticket in eine
   Warteschlange; höchstens alle 20 Minuten startet die Werkbank `vault-sync.sh --scope PM-1,PM-2` im Hintergrund
   (der flock im Skript verhindert Doppelläufe). Mit `--scope` arbeitet der Sync nur an Specs, Übersichten und
   Timeline, die diese Tickets oder ihre PRs nennen. Schalter `WERKBANK_ROADMAP_AUTOSYNC=0` schaltet ab.
3. **„Für mich offen“ oben auf der Roadmap-Seite (Schnitt 8).** Live über die vorhandenen Server-Events:
   - offene `- Knut:`-Zeilen (Link in die Spec),
   - PRs, bei denen ich laut „wer ist dran“ dran bin (Review angefragt, Antwort auf Kommentar),
   - eigene PM-Tickets überfällig oder ohne Datum,
   - **Fragen des Syncs** (E2): die „Offen/unklar“-Punkte des letzten Protokollabschnitts, je mit ✅ Ja / ✖️ Nein,
   - **Entwurf „Woran wir gerade arbeiten“** (E4) mit „Übernehmen“ / „Verwerfen“.
   Sichtbar für jede angemeldete Person mit ihren eigenen PRs/Tickets; Ja/Nein und Übernehmen nur für Admins.
4. **Freigaben ausführen (E2).** Ja schreibt den Punkt in `~/.cache/vault-sync/freigaben.md` (Abschnitt
   „Freigegeben“, mit Kennung, Datum, wer) und stößt einen Sync an. Der Sync-Prompt bekommt die Regel: Punkte unter
   „Freigegeben“ darf er ausführen, auch Löschen von Zeilen, Verschieben von Specs und Umschreiben, genau im
   beschriebenen Umfang, und meldet sie im Protokoll als „erledigt: <Kennung>“. Die Werkbank hakt den Punkt ab,
   sobald die Kennung im Protokoll steht. Nein legt die Kennung als verworfen ab; der Punkt erscheint nicht wieder.
5. **Entwurf „Woran wir gerade arbeiten“ (E4).** Der 07:30-Lauf schreibt zusätzlich
   `0-Overview/entwurf-woran-wir-arbeiten.md` (nur aus Snapshot und Feed, jede Zeile mit Quelle). „Übernehmen“
   ersetzt in der Hub-Seite den Block zwischen `<!-- werkbank:woran-wir-arbeiten -->` und
   `<!-- /werkbank:woran-wir-arbeiten -->` (deterministisch, `replaceWorkBlock`; fehlen die Marker oder stehen sie doppelt, wird nichts geschrieben), atomar.
6. **README und Tests.**

## Definition of Done

- [ ] `werkbank-feed.md` entsteht nach Jira-Abgleich und Agentenlauf, enthält Tickets, Läufe, Projekte, keine
      Zugangsdaten/Kundendaten; der Snapshot enthält ihn.
- [ ] Nach einem fertigen Karten-Agenten mit Ticket startet höchstens alle 20 min ein Sync mit `--scope`;
      abschaltbar per Env.
- [ ] Roadmap-Seite zeigt oben „Für mich offen“ mit den fünf Quellen, aktualisiert ohne Neuladen.
- [ ] Ja auf eine Sync-Frage → Freigabe-Datei + Sync; nach „erledigt“ im Protokoll verschwindet die Frage;
      Nein → kommt nicht wieder. Nur Admins.
- [ ] Entwurf „Woran wir gerade arbeiten“ erscheint; Übernehmen ersetzt genau den Markerblock im Hub.
- [ ] Tests für Feed, Warteschlange/Drossel, Protokoll-Parser, Freigaben, Markerblock; Suiten grün.
- [ ] Unabhängiges Review vor dem Ausrollen; ausgerollt; README-Abschnitt „Roadmap-Automatik“.

## Fertig heißt

Gebaut, getestet, reviewt, auf der Werkbank ausgerollt, README nachgezogen, Vault-Sync-Skripte (Vault-Skill
`olaf-produkt-roadmap`) angepasst, im PR auf knut523/werkbank.

## Risiken

- Ein Sync-Lauf kostet ein Claude-Kontingent; die 20-min-Drossel und `--scope` halten das klein.
- Freigegebene Punkte sind Text; der Sync führt sie nur im beschriebenen Umfang aus und protokolliert jede Datei.
- Gleichzeitiges Schreiben Mensch/Sync im Vault: der Sync lässt widersprüchlich wirkende Dateien in Ruhe (Regel
  bleibt).
- **Fremde Schreiber:** Protokoll und `freigaben.md` sind normale Dateien. Ein Chat-Agent (läuft als derselbe
  OS-Nutzer) könnte Fragen ins Protokoll schreiben oder per „erledigt: S…“ eine Freigabe abhaken. Der Admin sieht
  jeden Fragetext vor dem Ja; wer in den Vault schreiben darf, kann ohnehin ändern. Bewusst so gelassen.

## Review (08.10.2026) und Korrekturen

Unabhängiges Review: kein Blocker. Behoben: „erledigt“ in allen Schreibweisen (Backticks, fett) und „nicht erledigt“
mit Grund; „Nein“ wirkt über Läufe hinweg (Textschlüssel + Abschnitt „Verworfen“ in `freigaben.md`, Prompt
erweitert); Nachzug-Abschnitte verdrängen die Morgenfragen nicht, „- keine“ ist keine Frage; ein Planer für alle
Starts mit Sperrprüfung (`flock`), nichts geht verloren; PR-Links aus den geschriebenen Notizen; Live-Ereignis bei
neuem Protokoll/Entwurf; hängende Freigaben sichtbar mit Zurücknehmen; Werkbank-Läufe schreiben keinen Entwurf
(`VAULT_SYNC_NO_DRAFT`); „Besprechen“-Läufe und der erste Durchlauf nach dem Start lösen keinen Nachzug aus;
Knut-Zeilen nur für Admins.
