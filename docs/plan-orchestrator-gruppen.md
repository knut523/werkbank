# Plan 128 (Entwurf) — Orchestrator-Chats gruppieren

**Status:** Idee, Knut 11.10.2026, noch nicht gebaut, noch kein Council.
**Repo:** knut523/werkbank (privat, nicht WirStrom) · lokal.

> Knut, 11.10.2026: „wir sollten für orchestrator chats die funktion der chat ordner nutzen oder die zumindest
> wenn man drei spawnt irgendwie zusammenfassen ansonsten wird es hart sein auf dauer den überblick zu bewahren"

## Befund

- Jeder vom Orchestrator gestartete Chat bekommt dasselbe Lesezeichen `Orchestrator`
  (`web/server/orchestrator.ts:19`, gesetzt in Z. 126–139). Alle Stränge aller Aufträge landen in einer flachen Liste.
- LibreChat (unsere Version) hat keine Chat-Ordner; vorhanden sind Lesezeichen (Tags) und die Werkbank-Projekte
  (`web/server/projects.ts`).

## Vorschlag (kleinster Schnitt)

1. **Ein Lauf = eine Gruppe.** `orch start` bekommt einen Lauf-Namen (Standard: Datum + Kurztitel des Auftrags);
   jeder Strang erhält zusätzlich das Lesezeichen `Orch · <Lauf>` → in LibreChat filterbar wie ein Ordner.
2. **Werkbank „Heute“ / Orchestrator-Ansicht:** Stränge nach Lauf zusammengeklappt — eine Zeile je Lauf mit
   „3 Stränge · 2 fertig · 1 wartet auf dich“, aufklappbar.
3. **Aufräumen:** ist ein Lauf vollständig reviewt, wandert er in „Erledigt“ (Lesezeichen bleibt, Liste wird leer).
4. Optional später: Lauf an ein Werkbank-Projekt hängen (Workstream), damit Dateien und Chats zusammenliegen
   (Bezug Plan 126 Zusammenarbeit).

## Offene Punkte

1. Gruppe über Lesezeichen je Lauf (sofort, nutzt LibreChat) oder eigener Ordner-Baum in der Werkbank-Seitenleiste
   (mehr Bau, ein Patch an LibreChat). Empfehlung: Lesezeichen je Lauf + Gruppierung in der Werkbank-Ansicht.
  - Knut:
