# Plan: Heute — nur aktuelle Fragen („Wartet auf dich“)

Auftrag Knut, 11.10.2026: „mein Tag/Heute hat sehr viele offene Fragen — sind die auch aktuell?“ Antwort: nein.
„Wartet auf dich“ zeigt 465 leere `- Knut:`-Zeilen aus allen Specs aller Zustände plus Register und Übersichten.
Branch `feat/heute-fragen-aktuell`, Basis `release/werkbank-2026-10-11` @ `31cb95d`. Review-Paket 126.

## Befund

- `server/roadmap.ts:16,45` — `parseDecisions` liefert jede leere `- Knut:`-Zeile, ohne Zustand, Alter oder Herkunft.
- `server/main.ts:874-895` — `/api/roadmap` sammelt sie aus allen Zustandsordnern (`server/vault.ts:181-205` nimmt
  auch `5-Live` und `6-Archive`) und aus allen Übersichtsseiten, ohne Dublettenerkennung.
- `src/pages/Heute.tsx:118` holt `/api/roadmap` und reicht `decisions` ungefiltert an `WartetAufDich` (`src/beimir.tsx:108`).
- Aufschlüsselung 11.10.: Overview 193 (Register 175, Priorisierung 18), 2-Pre-Plan 133, 5-Live 54, 1-Backlog 46,
  3-Plan 19, 4-Review 10, Themen-Übersichten 10.
- Zusätzlich im Register gefunden: Einträge mit leerer `- Knut:` **und** darunter `- Entschieden (Knut, …)` (z. B. A3),
  und ein Absatz „**Überholt laut Prüfung 11.10.**“, der IDs aufzählt (A3, A5, B4, N2 … — „N12 bleibt offen“).

## Definition of Done (wörtlich aus dem Auftrag)

Ziel: „Wartet auf dich“ zeigt nur Fragen, die heute wirklich offen sind, jede genau einmal.
Mindestens:
1. 5-Live und 6-Archive ausblenden (als „überholt?“ in einen eingeklappten Block „Aufräumen“, nicht still löschen).
2. Dubletten: Register-Einträge (offene-fragen-…md), die per [[wikilink]] auf eine Spec mit eigener offener Knut-Zeile zeigen, nur einmal zeigen (Spec gewinnt, Register-ID als Etikett). Einträge in Abschnitten „Überholt“, „Zuletzt beantwortet“, „Davor beantwortet“ und durchgestrichene (~~…~~) zählen nicht.
3. Alter sichtbar (Datei last-verified/created), > 14 Tage markiert; Sortierung: Knut-Fragen aus dem Abschnitt „Neu am …“ und Plan/Review-Specs zuerst.
4. Zahl im Block = bereinigte Zahl; im Release-Audit (Heute.tsx:126) mitziehen.
5. Kein Rückschreiben in den Vault in diesem Schnitt (Inbox-Entscheidung E3 ist bei Knut offen).
Messung vorher/nachher mit dem echten Vault (nur lesend) in den Bericht. Bericht + Screenshots nach ~/work/knut/review-pakete/126-heute-fragen-aktuell/bericht.md mit Abschnitt „Für Knut zur Nachprüfung“.

Zusätzlich (Plan): Tests im Fixture-Vault für jede Regel; `npm test` grün; Screenshots vorher/nachher/Aufräumen offen.

## Schnitt (ein Slice, durch alle Schichten)

1. **`server/fragen.ts` (neu, rein):**
   - `collectDecisions(idx, read, base)` — die bisherige Sammlung aus `/api/roadmap`, unverändert im Ergebnis
     (Roadmap-Seite „Entscheidungen“ bleibt bei allen Zeilen). `main.ts` nutzt sie statt der Inline-Schleifen.
   - `todayQuestions(decisions, ctx)` → `{ open, cleanup, duplicates, raw }`. Regeln:
     - **überholt?** (→ `cleanup` mit Grund): Spec in `5-Live`/`6-Archive`; Register/Übersicht-Eintrag unter einer
       Überschrift „Überholt“/„Zuletzt beantwortet“/„Davor beantwortet“ (auch als Eltern-H2); Kopf des Eintrags
       durchgestrichen (`~~`); direkt unter der leeren Knut-Zeile steht `- Entschieden …`/`- Beantwortet …`;
       Register-ID steht im Absatz „**Überholt …**“ (ohne Teile mit „bleibt offen“); Register-Eintrag, dessen
       Spec-Links alle auf `5-Live`/`6-Archive` zeigen.
     - **doppelt** (→ nicht gezeigt, gezählt): Register-Eintrag mit `[[Link]]` auf eine Spec, die selbst eine
       offene, nicht überholte Knut-Zeile hat. Die Register-ID kommt als Etikett an die erste offene Frage der Spec.
     - **Alter:** Spec/Übersicht: `last-verified`, sonst `created` der Datei; Register-Einträge unter „Neu am TT.MM.JJJJ“:
       dieses Datum (die Register-Datei ist heute verifiziert, sagt also nichts über die Frage). `> 14` Tage → markiert.
     - **Sortierung:** zuerst „Neu am …“-Einträge und Specs in `3-Plan`/`4-Review`, dann der Rest; darin jüngere zuerst.
     - **Anzeigetext Register:** Kopfzeile des Eintrags (`**A1 · …**`) statt der Empfehlungszeile.
2. **`GET /api/roadmap/heute`** (neu, schlank, ~200 KB statt der ganzen Roadmap samt GitHub): `{ raw, open, cleanup,
   duplicates }`. `/api/roadmap` liefert `decisions` unverändert (gleiche Liste, Test gegen die alte Inline-Logik).
3. **`Heute.tsx` / `beimir.tsx`:** „Offene Entscheidungen im Vault (n)“ mit n = bereinigt; erste 5, Rest per
   „alle n zeigen“ aufklappbar; Etiketten (Register-ID, Zustand, Alter, „> 14 T.“ markiert); eingeklappter Block
   „Aufräumen — überholt? (m)“ mit Grund je Zeile. Kommentar Release-Audit (Heute.tsx:126) auf die bereinigte Zahl.
   Die Plakette „Heute (n)“ zählt Vault-Entscheidungen weiter nicht mit (Release-Audit 11.10.).
4. **Messung:** `scripts/fragen-messung.ts` (nur lesend, beliebiger Vault-Pfad) → Zahlen vorher/nachher je Quelle.

Nicht im Schnitt: Rückschreiben in den Vault (E3), Roadmap-Seite „Entscheidungen“ filtern, Textdubletten ohne
Wikilink (z. B. Priorisierung U2 ↔ Register A3), Zähler `/api/today/count`.

## Infra

Keine neuen Umgebungsvariablen, Einstellungen oder Schalter. No infra change.

## Council (11.10.2026)

Ablauf offen gelegt: drei Rollen-Agenten (Proponent/Specialist, UX, Devil's Advocate) liefen, gaben aber keinen
Bericht zurück (Rolle `leser` endet ohne Übergabe), danach war das Limit von vier Teilagenten erreicht. Die Stimmen
liefen deshalb nacheinander in der Sitzung selbst, jede gegen echte Daten (Messskript) statt gegen den Plantext.

- **Proponent:** reine Funktion, nichts wird geschrieben, Roadmap-Seite bleibt vollständig, jede Zeile landet in
  genau einem Topf (offen / überholt? / doppelt) — nachprüfbar über die Summe.
- **Devil's Advocate (Funde, alle eingearbeitet):** (1) reine Link-Regel versteckt Register-Fragen, die etwas
  anderes über die Spec fragen (B2 „Wer sieht in die Prod-DB?“, Rang 1; D3/D4/D7 Vault-Pflege) → Dublette nur bei
  Textähnlichkeit ≥ 0,3 **und** ≥ 2 gemeinsamen Wörtern, Etikett an genau die passende Spec-Frage; (2) Register-IDs
  A93/A94 doppelt vergeben → mehrdeutige IDs nie über den Überholt-Absatz ausblenden; (3) „N12 bleibt offen“ ging
  über die Live-Link-Regel trotzdem ins Aufräumen → „bleibt offen“ im Überholt-Absatz gewinnt; (4) „Entschieden
  (…, teilweise)“ ist nicht beantwortet → bleibt offen mit Etikett; (5) Register ist heute verifiziert, sein
  `last-verified` sagt nichts über den Eintrag → „Neu am“-Datum, sonst `created`.
- **Specialist:** Sammlung als `collectDecisions` verhaltensgleich (deepEqual gegen die alte Logik, echter und
  Fixture-Vault); +355 KB an `/api/roadmap` zu viel → eigener schlanker Endpunkt; Überschriften in Codeblöcken
  ignorieren; Laufzeit ~25 ms.
- **UX:** Zählzeile „465 → n offen · m überholt? · k doppelt“ als Vertrauensanker; erste 5, Rest aufklappbar;
  „Aufräumen“ eingeklappt mit Grund je Zeile und dem Satz, dass nichts gelöscht wird; rohe `[[Links]]` als Text,
  Notiztitel ohne „olaf — “, ID nicht doppelt als Chip; Datums-Chip „neu / eingetragen / geprüft TT.MM.“, ab 15 Tagen
  gelb mit Alter; Handy 390 px ohne waagrechtes Rollen.

**VERDICT: PASS** nach HOLD (confidence 0.75) — die fünf DA-Funde waren blockierend und sind mit Tests behoben.

Bindende Bedingungen (alle erfüllt, Belege im Bericht 126):
1. `open + cleanup + duplicates = raw` als Test. ✓
2. Je Regel ein Fixture-Fall, inkl. B2-artiger Nicht-Dublette, doppelter ID, „bleibt offen“, „teilweise“. ✓
3. Volle Listen (offen / überholt? / doppelt) als Dateien im Review-Paket, damit Knut stichprobenartig prüfen kann. ✓
4. Bilder Desktop + Handy vorher/nachher/Aufräumen offen/Randfall, kein waagrechtes Rollen. ✓
5. Kein Schreibzugriff auf `/vault` (Bilder auf einer Kopie). ✓

Entscheidungen (umkehrbar, Council): Plakette „Heute (n)“ zählt Vault-Fragen weiter nicht mit; Roadmap-Seite
„Entscheidungen“ bleibt ungefiltert (Folgepunkt); Schwelle 0,3/2 Wörter; Alter Register = „Neu am“ bzw. `created`.
