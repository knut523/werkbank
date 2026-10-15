# Werkbank: weitere Personen aufnehmen

Stand Release 11.10.2026. Kurz: wie Knut jemanden aufnimmt, was die Person einmal tut, was (noch) nicht geht.

## Erst lesen: noch niemanden aufnehmen

Zwei Dinge fehlen noch, bevor andere Personen dazukommen:

1. **Knuts Review der Funktionen.** Jede Werkbank-Seite ist für Nicht-Admins ausgeblendet, bis Knut sie in
   `WERKBANK_TEAM_FEATURES` freigibt. Ohne Freigabe sieht eine neue Person nur den Chat und die Einrichtung.
2. **Ordnergrenzen für Agenten (S0) sind nur zum Teil eine Grenze.**
   - **Was gilt:** Datei-Werkzeuge (Lesen, Suchen, Schreiben) fragen nach, sobald ein Agent in den Arbeitsordner
     einer anderen Person, in eine fremde Claude-Konfiguration oder in den Dateispeicher der Werkbank greift.
     Personen mit eigener Claude-Konfiguration lesen ohne Rückfrage nur ihre eigenen Ordner und den Vault.
   - **Was nicht gilt:** Bash erkennt nur Muster. Über Umwege, etwa `cd ..; cat *`, kommt ein Agent trotzdem an
     andere Pfade. Alle Agenten laufen als derselbe Linux-Nutzer, eine Sandbox gibt es auf der VM nicht.
   - **Das heißt:** Die Werkbank trennt die Daten von Personen nicht sicher. Sie ist „sichtbar für Berechtigte“,
     nicht „geschützt“. Knut entscheidet, ob er das Restrisiko für das Team trägt oder vorher eine
     Betriebssystem-Sandbox will.

## So nimmt Knut eine Person auf

1. **Registrieren lassen.** Die Person öffnet den Chat-Link und klickt „Registrieren“.
   - Es gehen nur Adressen mit `@maxenergy.at` oder `@konekto.energy`, alle anderen lehnt der Chat ab (geprüft).
   - Der Hinweis „Please check your email“ kann sie übergehen: Es geht keine Mail raus, die Anmeldung klappt sofort.
2. **Freischalten.** Die Adresse in `~/work/werkbank-dev/.env.local` ergänzen:
   `BRIDGE_ALLOWED_EMAILS=knut.peters@maxenergy.at,neu@maxenergy.at`. Die Werkbank übernimmt diese Liste.
   Danach `scripts/werkbank.sh restart`. **Laufende Chats brechen dabei ab.**
3. **Funktionen freigeben, wenn reviewt.** In `.env.local`, zum Beispiel `WERKBANK_TEAM_FEATURES=heute,wissen`.
   - Mögliche Werte: `heute`, `roadmap`, `board`, `sprint`, `wissen`, `timebox`, `ziele`, `skills`, `dateien`,
     `orchestrator`, `ansetzen`.
   - Danach `scripts/werkbank.sh restart-web`.
4. **Rolle.** Admin bleibt nur Knut. Ein Admin sieht alle Funktionen, die Fragen des Vault-Syncs, Knuts offene
   Entscheidungen, das Backup und die Speicherwarnung.

## Was die Person einmal tut

1. **Anmelden** im Chat. Links in der Leiste steht dann 🚀 „Werkbank-Einrichtung“, solange noch nichts freigegeben
   ist. Sonst findet sie die Einrichtung im Kontomenü.
2. **Claude verbinden.** Auf dem eigenen Rechner im Terminal `claude setup-token` ausführen, den Token
   (`sk-ant-oat…`) einfügen und speichern. Dafür braucht sie ein eigenes Claude-Abo (Pro oder Max). Ohne Token
   endet jeder Chat mit „Kein API-Key gefunden“.
3. **Jira lesen.** Einen Atlassian-API-Token mit dem Bereich `read:jira-work` anlegen und in der Einrichtung
   hinterlegen.
4. **Jira schreiben.** Die Atlassian-Anmeldung (OAuth) im Chat einmal bestätigen, wie es die Einrichtung in
   Schritt 4 zeigt.
5. **Optional: weitere eigene Claude-Konten.** Ist das Kontingent eines Kontos erschöpft, übernimmt das nächste.
   Gewechselt wird nur dann, die Last wird nicht verteilt.

## Grenzen, die man kennen muss

- **Claude-Zugang ist persönlich.** Jede Person nutzt ihr eigenes Abo, und die Werkbank verwaltet Konten nur je
  Person. Knuts zweites Konto bleibt Knuts Ersatzkonto für ausgeschöpftes Kontingent. Gemeinsame Konten sind nicht
  vorgesehen.
- **Gleichzeitige Chats.**
  - **Je Person:** höchstens `BRIDGE_MAX_PARALLEL_CHATS` (Release: 4) Züge, LibreChat dazu
    `CONCURRENT_MESSAGE_MAX` (5).
  - **Insgesamt:** Es gibt keine Obergrenze über alle Personen.
  - **Speicher:** Ein laufender Chat braucht ≈ 420 MB (Claude ≈ 275 MB plus MCP-Server). Die Workspace hat
    16 GiB, die Grundlast liegt bei 9–13 GiB. Bei ≥ 3 GB Reserve sind das zusammen etwa 6–8 Chats.
  - **Warnung:** Ab 85 % Speicher sieht Knut eine Warnung auf „Heute“.
- **Wartende Rückfragen.** Wartet ein Chat 15 Minuten ohne Antwort auf „ja/nein“, beendet die Werkbank ihn, um
  Speicher zu sparen (`BRIDGE_IDLE_REAP_S`). Mit der nächsten Nachricht geht es weiter.
- **Board, Sprint, Roadmap und Wissen zeigen Teamdaten:** die Jira-Kopie des Projekts PM und den ganzen Vault.
  Persönlich sind nur Chats, „Mein Tag“, die eigenen Dateien und die eigenen Rückfragen.
- **Neue Personen freischalten** geht nur mit Neustart. Danach den Chat neu laden.
