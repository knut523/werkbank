---
status: Plan, nicht gebaut
quelle: Knut, 07.10.2026: „und gib mir einen Button zum Klicken oder Tappen“ (zu den Rückfragen der Werkbank) · „auch hier sollten wir plan-to-pr machen und reviewen“
---

# Ja/Nein-Knöpfe für Rückfragen

## Ziel

Eine Rückfrage der Werkbank („Soll ich …?“) lässt sich mit einem Tipp beantworten — auf dem Handy wie am Rechner —,
statt „ja“ zu tippen. Ergebnis: unter jeder Rückfrage zwei Knöpfe **✅ Ja** und **✖️ Nein**; ein Tipp schickt genau
die Antwort, die man sonst tippen würde.

## Stand heute

- Die Brücke stellt die Rückfrage als Text (`confirmQuestion`, `claude-bridge/src/tools.ts`) und endet mit
  „Antworte mit **ja** oder **nein**“. Die nächste Nachricht in diesem Chat löst die wartende Rückfrage auf
  (`existing.pending.resolve(req.prompt)`, `sessions.ts`), und ihre Antwort streamt in diese neue Nachricht.
- LibreChat rendert Links in Antworten über `MarkdownAnchor` (`client/src/components/Chat/Messages/Content/MarkdownComponents.tsx`);
  `useSubmitMessage().submitMessage({ text })` schickt eine Nachricht wie das Eingabefeld (genutzt u. a. von den
  Gesprächsstartern).
- Die Werkbank passt LibreChat schon über `librechat/patches/*.patch` + `librechat/overlay/` an (Werkbank-Leiste);
  `scripts/librechat-patch.sh` spielt sie ein und baut den Client neu.

## Optionen

| | Was | Bewertung |
|---|---|---|
| A | Links auf eine Werkbank-Seite, die die Rückfrage serverseitig beantwortet | öffnet einen Tab; die Antwort des Agenten streamt dann in keinen offenen Chat (sie hängt an der nächsten Nachricht) — bricht die Live-Ansicht |
| **B** | **Die Brücke hängt `[✅ Ja](#werkbank-antwort:ja)` `[✖️ Nein](#werkbank-antwort:nein)` an; ein LibreChat-Patch rendert solche Links als Knöpfe, die „ja“/„nein“ als Chat-Nachricht senden** | **gleicher Ablauf wie Tippen, Live-Ansicht bleibt; ohne Patch (andere Clients) sind es harmlose Anker** |
| C | Eigene Rückfrage-Leiste über dem Eingabefeld (Overlay-Komponente, die offene Rückfragen der Brücke abfragt) | mehr Bau, zweite Quelle für „offen“; erst nötig, wenn B nicht reicht |

**Gewählt: B** (Knut: „nimm die beste Option“ für die Werkbank).

## Schnitte

1. **Brücke:** `confirmQuestion` und die Jira-Rückfrage enden mit einer Knopfzeile
   `[✅ Ja](#werkbank-antwort:ja) · [✖️ Nein](#werkbank-antwort:nein)` (Text „Antworte mit ja oder nein“ bleibt
   darunter als Rückfall). Auch für die „Teilagent … möchte“-Rückfragen und „Der Auto-Modus fragt nach“.
2. **LibreChat-Patch `30-client-antwort-knoepfe.patch`:** in `MarkdownAnchor` ein Zweig für `href` mit
   `#werkbank-antwort:` → `<button>` (Raiffeisen-Gelb für Ja, neutral für Nein, ≥ 44 px Tippfläche), Klick →
   `submitMessage({ text })`. Nur die zwei Werte `ja`/`nein` sind erlaubt; alles andere bleibt ein normaler Link.
   Knopf ist gesperrt, solange der Chat noch streamt, und nach dem ersten Tipp (kein Doppelsenden).
3. **Nur die letzte Rückfrage:** Knöpfe in älteren, schon beantworteten Rückfragen werden als gesperrt dargestellt
   (die Nachricht ist nicht die letzte Assistenten-Nachricht des Chats).
4. **README** (Abschnitt Rückfragen) und Tests.

## Definition of Done

- [ ] Jede Rückfrage der Brücke endet mit den zwei Knöpfen; Tests in `claude-bridge/test` prüfen die Knopfzeile.
- [ ] In LibreChat: Tipp auf ✅ Ja sendet „ja“, auf ✖️ Nein sendet „nein“, die Antwort des Agenten streamt wie gewohnt.
- [ ] Knöpfe gesperrt während des Streamens, nach dem ersten Tipp und in älteren Rückfragen.
- [ ] Auf dem Handy (390 px) gut tippbar; hell und dunkel lesbar.
- [ ] `href`s außer `#werkbank-antwort:ja|nein` bleiben normale Links (kein beliebiger Text per Link sendbar).
- [ ] Patch passt auf den LibreChat-Stand der Werkbank; Client-Build grün; ausgerollt.
- [ ] Review (unabhängig) vor dem Ausrollen.

## Fertig heißt

Gebaut, getestet, reviewt, auf der Werkbank ausgerollt, README nachgezogen, im PR auf knut523/werkbank.

## Risiken

- Ein LibreChat-Update kann den Patch brechen — `librechat-patch.sh` bricht dann mit Hinweis ab, ohne halb anzuwenden.
- Der Klassifikator-Modus fragt seltener; die Knöpfe helfen dort, wo bewusst gefragt wird (Jira, GitHub, Geheimnisse).
