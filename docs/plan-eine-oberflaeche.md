---
status: Plan 11.10.2026 — Council (nur Claude) siehe unten; Wochenend-Regel: Entscheidungen im Sinne Knuts getroffen, markiert „Für Knut zur Nachprüfung“
quelle: Knut, 11.10.2026: „Kannst du die Werkbank nochmal anschauen und die beiden Sachen Chat und Werkbank so integrieren, dass man nicht merkt, dass es 2 Repos sind.“
basis: feat/heute-review-schlange @ 7043b46 (fünf Einträge, „Heute“)
---

# Eine Oberfläche: Chat und Werkbank ohne sichtbare Naht

## Ziel

Wer die Werkbank benutzt, merkt nicht, dass Chat (LibreChat) und Werkbank-Seiten (web/) zwei Programme sind:
eine Navigation, ein Kontomenü für alle Einstellungen, eine Sprache, dieselben Farben hell und dunkel, und kein
Neuladen der ganzen Seite zwischen Chat und Werkbank. Am Handy kommt man von jeder Seite überallhin.

## Stand heute (Seam-Audit auf einer isolierten Instanz, 1440 und 390, hell und dunkel)

Bilder und Messungen: `~/work/knut/review-pakete/120-werkbank-eine-oberflaeche/vorher/`.
Schwere nach ux-expert (4 blockiert · 3 schwer · 2 Reibung · 1 kosmetisch).

| # | Naht | Schwere | Beleg (Bild + Quelle) |
|---|---|---|---|
| N1 | **Handy: Sackgasse auf jeder Werkbank-Seite.** Kein Knopf zum Öffnen der Leiste; zurück zum Chat oder zu anderen Seiten nur über „Zurück“ im Browser. | 4 | `390-light-wb_heute.png`; `WerkbankRoute.tsx` rendert nur den iframe, LibreChats Leisten-Knopf (`OpenSidebar`) steckt im Chat-Kopf (`Chat/Header.tsx:48`). |
| N2 | **Handy: Leiste bleibt nach Tipp auf „Heute“ offen** und deckt die Seite zu (Hauptbereich ist `inert`). | 3 | `390-mobil-2-nach-tipp-heute.png`; `WerkbankNav.tsx` navigiert nur, LibreChat schließt bei Chats selbst (`ConversationsSection.tsx:81`). |
| N3 | **Werkbank → Chat lädt die ganze App neu** („Chat öffnen“, „Im Chat besprechen“, Tagesabschluss, Vorlagen): `target=_top` bzw. `top.location.href`. | 3 | `api.ts:38-41`, 14 Stellen mit `target={chatTarget}`; Messung: „→ Chat“ 1004 ms, 2 Dokument-Ladevorgänge. |
| N4 | **Fünf Seiten nur über eine Zeile ganz unten** (Mein Tag, Ziele, Skills, Dateien, Einrichtung) — bei „Heute“ unter dem Falz; in der Leiste ist dann nichts aktiv, man weiß nicht, wo man ist. | 3 | `1440-light-wb_skills.png`; `App.tsx:96-100` (`more-row`), `WerkbankNav.tsx` zeigt nur `nav: true`. |
| N5 | **Einstellungen an zwei Orten:** Kontomenü → Einstellungen (Design, Sprache, Chat) vs. Werkbank-„Einrichtung“ (Claude, Jira), die nur über die Zeile unten erreichbar ist. | 3 | `AccountSettings.tsx` (LibreChat), `Setup.tsx`. |
| N6 | **Zwei Sprachen:** LibreChat folgt der Browsersprache (englischer Browser → „Search messages“, „New chat“), die Werkbank ist immer Deutsch. | 3 (bei englischem Browser; sonst 0) | `1440-light-c_new.png`; `store/language.ts:23-27`. |
| N7 | **Fußzeile unter jedem Chat verlinkt die Werkbank als zweite App** (`:3070`, eigenes Login, eigene Leiste). | 3 | `scripts/setup.sh:80` (`CUSTOM_FOOTER` mit `$WEB_URL/#/…`). Auch `werkbank.sh` „Werkbank öffnen: :3070“. |
| N8 | Jeder Klick in der Leiste lädt den iframe neu (`key={page}`): Zwischenbild ~200–300 ms leer (dunkel gemessen, kein Weißblitz), Scroll/Zustand weg. | 2 | `WerkbankRoute.tsx:41`; `vorher/flash.txt`, `messung.txt` (1 Dokument je Klick). |
| N9 | Farben doppelt gepflegt: `styles.css` kopiert LibreChats Werte von Hand; driftet beim nächsten LibreChat-Update. | 2 | `styles.css:3-33` vs. LibreChat `client/src/style.css:69-165`. |
| N10 | Zwei „Dateien“: LibreChat „Meine Dateien“ (Kontomenü) und Werkbank „Dateien & Teilen“ — andere Zwecke, ähnlicher Name. | 2 | `AccountSettings.tsx:163`, `Dateien.tsx`. |
| N11 | Symbole: Werkbank-Seiten nutzen Emojis (🧹 🌙 📋), LibreChat Linien-Symbole (lucide). | 2 | durchgehend in `web/src/pages/*`. |
| N12 | Leiste: Panel-Knöpfe (Chats, Prompts, Lesezeichen, Dateien) und Seiten-Knöpfe (Heute …) sehen gleich aus; auf `/wb/*` sind „Chats“ und die Seite gleichzeitig hervorgehoben. | 2 | `ExpandedPanel.tsx` + `WerkbankNav.tsx`. |
| N13 | Kein Kopf über Werkbank-Seiten am Desktop (Chat hat einen) — fällt kaum auf. | 1 | — |

Was schon passt (nicht anfassen): eine Anmeldung (Refresh-Cookie über `/werkbank/*`), Hell/Dunkel folgt dem Chat,
Inter + gleiche Grautöne, Adresse `/wb/<seite>?h=…` übersteht Neuladen, Zurück-Knopf zwischen Seiten.

## Entscheidungen (Wochenend-Regel: im Sinne Knuts entschieden — Für Knut zur Nachprüfung)

- **E1 iframe bleibt.** Die Werkbank-Seiten werden nicht in LibreChats Bundle gezogen (anderes CSS, andere
  Abhängigkeiten, jedes LibreChat-Update würde zur Baustelle). Die Naht wird an den Rändern geschlossen.
  Empfehlung: so lassen.
  - Knut:
- **E2 „Mehr“ in der Leiste** statt der Zeile unten: ein Knopf unter den fünf Einträgen öffnet ein Menü mit Mein Tag,
  Ziele, Skills, Dateien & Teilen. Die fünf Hauptpunkte bleiben (Council-Bedingung 11 aus dem Heute-Plan).
  - Knut:
- **E3 Einrichtung ins Kontomenü**, direkt über LibreChats „Einstellungen“: „Werkbank-Einrichtung“ (Claude, Jira).
  Damit ist das Kontomenü der eine Ort für alles, was man einstellt. Die Einrichtungsseite verweist für Design/Sprache
  auf „Einstellungen“.
  - Knut:
- **E4 Deutsch als Vorgabe** für LibreChat, solange niemand selbst eine Sprache gewählt hat (Cookie `lang` fehlt).
  Wer in den Einstellungen Englisch wählt, behält Englisch.
  - Knut:
- **E5 Fußzeile ohne Links, aber mit Text** (Navigation steht in der Leiste): `CUSTOM_FOOTER` bleibt im verwalteten
  Block als reiner Text — ganz ohne zeigte LibreChat „LibreChat vX – Every AI for Everyone“ mit Link auf librechat.ai
  (Council, UX). `werkbank.sh`/`start.sh` zeigen als Einstieg `<Chat-URL>/wb/heute`. Die direkte Web-App auf :3070
  bleibt für Health/Debug, wird aber nirgends mehr beworben.
  - Knut:

## Änderung je Datei

LibreChat (Overlay/Patches, wie bisher von `scripts/librechat-patch.sh` eingespielt):

- `librechat/overlay/client/src/components/Werkbank/WerkbankRoute.tsx`
  - ein iframe für alle Werkbank-Seiten (kein `key={page}`): Seitenwechsel setzt nur den Hash im iframe
    (`location.replace`, keine zweite Verlaufszeile) → kein Neuladen, Zustand bleibt;
  - Adresszeile folgt dem iframe immer mit `replace` (Verlauf führt der iframe; ein Eintrag je Klick);
  - Handy (≤ 768 px, wie LibreChat): Kopfzeile mit LibreChats `OpenSidebar` und Seitentitel (N1);
  - `werkbank-open` nimmt auch absolute Adressen desselben Ursprungs an (N3).
- `…/Werkbank/WerkbankNav.tsx`
  - „Mehr“-Menü (Ariakit-Menü wie LibreChats Kontomenü), aktiv markiert, wenn eine der vier Seiten offen ist (N4);
  - am Handy schließt ein Tipp die Leiste (N2);
  - Deutsch-Vorgabe (E4): ohne Cookie `lang` einmal `de-DE` setzen (wie LibreChats eigene Sprachwahl).
- neu `…/Werkbank/WerkbankSetupItem.tsx` + neuer Patch `40-client-konto-einrichtung.patch` (3 Zeilen in
  `Nav/AccountSettings.tsx`): Eintrag „Werkbank-Einrichtung“ im Kontomenü (N5).

Werkbank-Web:

- `web/src/api.ts`: `openChat` und Links zum Chat gehen eingebettet als `werkbank-open` an LibreChat (Router-Wechsel,
  kein Neuladen); nur wenn das nicht geht, wie bisher `top.location`.
- `web/src/App.tsx`: eingebettet ein Klick-Abfänger für `a[target=_top]` desselben Ursprungs (N3, alle 14 Stellen
  ohne sie einzeln anzufassen); Zeile „Weitere Seiten“ entfällt (N4); Farben: eingebettet werden die gemeinsamen
  Variablen (`--text-*`, `--surface-*`, `--border-*`, `--presentation`, Grau/Grün/Rot) aus LibreChats `<html>`
  übernommen — LibreChat ist die eine Quelle, `styles.css` nur noch Rückfall für die direkte Web-App (N9).
- `web/src/pages/Setup.tsx`: eingebettet ein Satz „Design und Sprache: Kontomenü → Einstellungen“.
- `web/src/pages/Board.tsx`: leerer Zustand verlinkt die Werkbank-Einrichtung (Council, UX: Einrichtung nicht nur im Kontomenü).

Skripte/Doku:

- `scripts/librechat-patch.sh`: eine im Repo **geänderte** Fassung eines schon angewandten Patches wird ersetzt (Dateien des
  Patches zurück auf LibreChat, neu angewandt) statt mit „passt nicht“ abzubrechen — nötig schon für die Basis (Patch 20
  von `feat/heute-review-schlange` ≠ Live-Stand), sonst ließe sich nichts davon auf die Live-Instanz bringen (Council, Devil).

- `scripts/setup.sh`: `CUSTOM_FOOTER` ohne Links, nur Text (N7); `werkbank.sh`, `start.sh`: Einstieg
  `<Chat>/wb/heute`.
- `README.md`: Abschnitt „Die Werkbank im Chat“ nachziehen (Mehr, Kontomenü, Handy, Upgrade-Hinweis).
- `web/e2e/eine-oberflaeche.mjs` (neu): Playwright-Prüfung gegen eine laufende (isolierte) Instanz.

## DoD

1. Handy 390: auf jeder `/wb/*`-Seite ist der Knopf „Leiste öffnen“ sichtbar; Tipp auf einen Werkbank-Eintrag schließt die Leiste.
2. Leiste → Werkbank-Seite → andere Werkbank-Seite: **0** Dokument-Ladevorgänge beim zweiten Wechsel (gemessen).
3. „Chat öffnen“/„Im Chat besprechen“ aus einer Werkbank-Seite: **0** Dokument-Ladevorgänge im Hauptfenster (gemessen).
4. Mein Tag, Ziele, Skills, Dateien in höchstens zwei Klicks von jeder Seite (Leiste → Mehr); „Mehr“ ist aktiv, wenn eine davon offen ist; keine Zeile „Weitere Seiten“ mehr.
5. Kontomenü enthält „Werkbank-Einrichtung“ und öffnet `/wb/einrichtung` ohne Neuladen.
6. Ohne Cookie `lang` erscheint LibreChat deutsch (englischer Browser im Test); mit `lang=en-US` bleibt es englisch.
7. Zurück-Knopf: Heute → Board → Zurück landet auf Heute (ein Klick), Adresszeile stimmt.
8. Dunkel: Werkbank-Flächen haben dieselben Werte wie LibreChats Variablen (Stichprobe `--surface-primary`, `--text-primary`).
9. Patches 10–40 lassen sich auf ein frisches LibreChat v0.8.7 anwenden; Client-Build grün; Web-Tests und Brücken-Tests nicht schlechter als die Basis; `vite build` grün.
10. Vorher/Nachher-Bilder und Bericht in `review-pakete/120-werkbank-eine-oberflaeche/`.

## Bewusst nicht

- Werkbank-Seiten nicht in LibreChats React-Baum ziehen (E1); kein dauerhaft versteckter iframe im LibreChat-`Root`
  (Chat → Werkbank lädt weiter einmal, ~0,5 s; spart einen Patch an `routes/Root.tsx`).
- Keine Emojis durch Symbole ersetzen (N11), keine Umbenennung „Dateien & Teilen“ (N10), keine Trennung von Panel- und
  Seitenknöpfen in der Leiste (N12) — je Schwere 2, eigener Schnitt.
- Kein Weiterleiten der direkten Web-App (:3070) in den Chat (Smoke-Test und Health nutzen sie).
- Keine Änderung an Brücke, Login oder Daten.

## Prüfung

- Isolierte Instanz aus diesem Worktree (LibreChat 3480, Web 3470, Brücke 3490 Mock, Mongo 27480, Meili 7890,
  Fixture-Vault, Jira-Nachbau); Live (3070/3080/3090) und Orchestrator-Test (3170/3180/3190) unberührt.
- `web/e2e/eine-oberflaeche.mjs` gegen 3480 (DoD 1–8), Vorher/Nachher-Bilder je Route bei 1440 und 390, hell und dunkel.
- `npm test` in `claude-bridge` und `web`, `npx vite build`, Patches auf frischem `git worktree` von LibreChat v0.8.7
  (`git apply --check`), LibreChat-Client-Build.

## Council (11.10.2026, nur Claude: Proponent, Spezialist, Devil's Advocate, UX-Experte — getrennte Läufe)

**Urteil: HOLD (0,80)** — Richtung und Schnitt stimmen (iframe bleibt, Naht an den Rändern schließen, messbare DoD);
die Bedingungen unten waren vor dem Bauen offen und sind jetzt eingebaut und geprüft.

| # | Bindende Bedingung | Stand |
|---|---|---|
| K1 | [must-fix] iframe-`src` einmal setzen (nicht `useMemo([page])`), Adresszeile → iframe per `location.replace` nur bei anderem Hash; gemischte Folge (Link in der Seite, Leiste, 2× Zurück) im e2e | erledigt, e2e ✓ |
| K2 | [must-fix] Deutsch nur, wenn **weder** Cookie `lang` **noch** gespeicherte Wahl (localStorage) da ist; kein Cookie setzen | erledigt, e2e ✓ (englischer Browser → „Neuer Chat“) |
| K3 | [must-fix] Klick-Abfänger lässt Strg/Cmd/Umschalt/Alt/Mitte und `defaultPrevented` in Ruhe; Ursprung = Chat-Fenster **oder** `librechatUrl` aus der Konfiguration; LibreChat nimmt nur eigenen Ursprung, `/c/` und `/wb/` über den Router, anderes normal geladen, Fremdes nie | erledigt, e2e ✓ (Strg-Klick → neuer Tab) |
| K4 | [must-fix] Fußzeile nicht leer lassen (sonst LibreChat-Werbung) | erledigt (Text), e2e ✓ |
| K5 | [must-fix] Handy: auch „Mehr“-Einträge und der Kontomenü-Eintrag schließen die Leiste; „Mehr“ als Portal über der Schublade | erledigt, e2e ✓ |
| K6 | [must-fix] Patch-Skript muss geänderte Patches ersetzen können (Live hat ältere Fassung von Patch 20) | erledigt, geprüft: alte Fassung 20 eingespielt → „↻ erneuert“ |
| K7 | [verify] Vorlagen-Link (`/c/new?spec=…&prompt=…&submit=true`) per Router: genau eine Nachricht | ✓ (1 Sende-Aufruf) |
| K8 | [verify] Farben nach Theme-Wechsel neu übernommen (Inline-Werte überdecken sonst `[data-theme=dark]`) | ✓ (Kopie im MutationObserver; e2e dunkel gleich) |
| K9 | [must-fix] „Mehr“ nicht mit Präfix `werkbank-nav-` (smoke.mjs zählt genau fünf) | erledigt (`werkbank-mehr`) |
| K10 | [verify] Klick auf die offene Seite lädt sie neu (früher Nebeneffekt jedes Klicks) | erledigt (`werkbank-reload`) |

Stärkster Einwand (Devil), sichtbar gelassen: Der dauerhafte iframe hält Seitenzustand nur innerhalb einer Seite;
Daten einer Seite sind bis zum nächsten Wechsel/Klick auf die offene Seite so alt wie beim Öffnen — wie vorher.
UX-Hinweise ohne Bedingung (Schwere 2, eigener Schnitt): Chat-Liste (300 px) bleibt auf `/wb/*` offen und kostet Breite
am Board; Sprint-Symbol `RefreshCw` liest sich wie „neu laden“; Einrichtung für Neue: der leere Zustand am Board verlinkt jetzt
die Werkbank-Einrichtung; weitere leere Zustände eigener Schnitt.
