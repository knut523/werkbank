Empfehlung: comment

Danke, das ist sauber geschnitten: die Migration ist additiv (eine Art mehr im CHECK, eine nullable Spalte), das Geburtsdatum der Zeilen-Kund:in ist über `pii-fields.ts` versiegelt und steht nicht in `raw`. Die Admin-only-Grenze ist an jedem Eingang gezogen (`createBulk`/`updateBulk` bei `source = 'kunde'`, `ownedBulk`, `customerList`, Kunden-Vorlage). Ein Durchlauf ist genau eine Kund:in, über `runKey` im Planer und `runCustomer` als zweite Sicherung. Die Tests decken die neuen Regeln breit ab. Ich habe statisch geprüft und nichts ausgeführt. Code-Blocker habe ich keine gefunden, dafür einen kleinen Fehler und ein paar Hinweise:

**1. Geburtsdatum: eine reine Jahreszahl wird still zu einem Datum in 1905** — `src/lib/bulk/validate.ts:181`, `:524`
Die Regex liest Text jetzt mit `/^\d{4,5}$/` als Excel-Seriennummer, und für das Geburtsdatum ist `minSerial = 1`. Schreibt jemand nur „1980“ in die Zelle (die Vorlage typisiert die Zellen als Text), wird daraus Seriennummer 1980, also der 02.06.1905. Das ist volljährig, die Zeile ist „ok“, und MAXENERGY bekommt ein falsches Geburtsdatum. Dasselbe gilt für eine Zahl 1980 in einer Zelle im Standardformat. Ein Datum als Text hat außerdem keine Untergrenze („01.01.1850“ geht durch).
Vorschlag: Für das Geburtsdatum Text nur als `TT.MM.JJJJ`/ISO lesen, Seriennummern nur aus echten Zahl-Zellen. Dazu eine Plausibilitätsgrenze (z. B. nicht älter als 120 Jahre) und ein Test mit „1980“.

**2. Report: die Spalten „Kund:in / E-Mail“ hängen an den Daten statt an der Art** — `src/app/api/admin/bulk-registrations/[id]/report/route.ts:33`
`rows.some((r) => r.kunde !== null)` ist bei einer `einzelkunden`-Liste, in der keine Zeile eine lesbare Kundenart hat, `false`. Dann fehlen genau die Spalten, die man für die Fehlersuche braucht. Besser `bulk.kind === 'einzelkunden'` laden und verwenden.

**3. Einwilligungstext v2 ist ein Platzhalter** — `src/lib/bulk/sammel-texte.v2.json:153`
Das ist im PR offen dokumentiert und mit einem Test markiert. Trotzdem: Solange `BULK_REGISTRATION_ENABLED` irgendwo außerhalb von Dev an ist, kann eine bevollmächtigte Person „[Wortlaut ausstehend …]“ bestätigen, und das wird als verbindliche Vollmacht samt SEPA-Mandat gespeichert. Ich würde die Art bis zum finalen Wortlaut zusätzlich serverseitig sperren (oder ein Test/Start-Check schlägt fehl, wenn ein `required`-Text „Wortlaut ausstehend“ enthält und die Art angeboten wird). Inhaltlich passt der letzte Satz „Ich habe diese Vollmacht hochgeladen“ nicht zum Ablauf, denn hochgeladen wird im Admin vom Service-Team.
Nebenwirkung des Wechsels auf v2: `TEXTE_SHA256` geht in die Prüfsumme ein, also müssen bereits verschickte Codes für Bündel/HV nach dem Deploy neu gesendet werden. Das ist harmlos, gehört aber in die Ausroll-Notiz.

**4. Rechtlich/fachlich offen (keine Code-Änderung, nur zur Klärung vor dem Pilot)**
- `Einwilligungen.SepaLastschrift` wird für jede Zeilen-Kund:in aus der Listen-Vollmacht gesetzt (`src/lib/bulk/dto.ts`, `SepaLastschrift: accepted.includes(einzel ? CONSENT.vollmachtEinzel : …)`). Ob ein SEPA-Mandat über eine Vollmacht des Hochladenden wirksam erteilt ist, sollte die Rechtsberatung bestätigen.
- Die Zeilen-Kund:innen bekommen von uns nichts: `_skipActivities: ['sendTemplateToThirdParty']` unterdrückt die Anmeldebestätigung mit Vertrags-PDF, und der Code geht an die bevollmächtigte Person. Ob Verbraucher:innen bei einer Anmeldung per Vollmacht eine eigene Bestätigung brauchen (FAGG, Informationspflichten), ist eine Produkt- und Rechtsfrage.

**Kleinigkeiten**
- `knownCustomerEmails` (`src/lib/bulk/store.ts:156`) verlässt sich darauf, dass der Aufrufer klein schreibt. Heute stimmt das, weil `cleanCustomer` die gespeicherte E-Mail klein schreibt. Das `toLowerCase()` gehört aber in die Funktion selbst, dann ist der Aufruf in `confirm` (`:576`) nicht von der Speicherform abhängig.
- Neue Texte verwenden das Schrägstrich-Paar („Kundin / Kunde“, z. B. `src/lib/bulk/process.ts:109`, `src/components/bulk/BulkDetailView.tsx:276`, die Meldungen in `validate.ts`). Laut Stilregel in `AGENTS.md` soll es bei neuen Texten der Doppelpunkt sein („Kund:in“). Die älteren Bulk-Texte sind ein eigenes Thema.
- Vorbestehend, nicht von diesem PR: `PII_STORES` (`src/lib/pii-encrypt-run.ts:31`) enthält die Bulk-Tabellen nicht. Nach einer Schlüsselrotation bleiben also `iban`/`kontoinhaber` und jetzt auch `kunde.geburtsdatum` unter der alten kid. `residue-scan.sql` zählt sie richtig mit, aber eine kid darf erst nach einem Re-Seal dieser Tabellen zurückgezogen werden.

Tests zum Laufenlassen: `npm run bulk-registration:test`, `npm run bulk-registration:test:db` (Scratch-DB), `npm run app-role:test:db`, und wegen `pii-fields.ts` `npm run pii:test` / `npm run pii:test:db`.
