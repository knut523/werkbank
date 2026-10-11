# 064 — Nachgespielte Vorgänge hinterlassen eine Spur

**Status (06.10.2026, nachgetragen):** offen — kein PR. Der Zweig `feat/service-replay-spur`
(zuletzt `99037be`, auf #177 rebased) wurde nie gepusht; #177 ist am 28.09.2026 über #176/#175 nach
`develop` gekommen. Auf `origin/develop` schreibt der Retrigger seither je Zählpunkt eine Startzeile
ins `submission_audit_log` (`meter_point_submit_started`, Handelnder und neue Durchlauf-ID,
`src/lib/retrigger.ts`) — die Replay-Spur dieses Plans (ursprüngliche Instanz, was wiederholt wurde,
Anzeige „nachgetragen am … durch …“) fehlt aber, und der Recovery-Repair schreibt gar keine
Audit-Zeile. Erledigt ist nur der Nebenpunkt: den Kommentar in `recover-submissions.ts` hat
olaf-admin#245 (Hotfix v1.4.6, 01.10.2026) korrigiert; die Retrigger-Route hat sich seither durch
olaf-admin#273 (Plan 093, gemergt 06.10.2026) stark verändert, der Zweig müsste neu aufgesetzt
werden. Kein späterer Plan löst ihn ab. Wo der Plantext darunter diesem Block widerspricht, gilt
dieser Block. Diese Datei lag bis 06.10.2026 nur auf einem lokalen Branch (`docs/plans-062-067`) und
wird unverändert nachgetragen; der Text darunter ist der Stand vom 25.09.2026.

**Spec:** `olaf-Vault → 1-Roadmap/Service-View/3-Plan/service-spec-replay-spur.md`
**Repo:** `WirStrom1/olaf-admin` · Zweig `feat/service-replay-spur` · Basis **`feat/service-akte-feedback`**
(`c7e4405`, Spitze von #177) — nicht `develop`, weil `src/lib/service/timeline.ts`,
`src/lib/retrigger.ts` und die Akte nur im Service-View-Stapel #175 → #176 → #177 existieren.
PR-Ziel damit ebenfalls `feat/service-akte-feedback`.
**Worktree:** `/home/knut/work/knut/olaf-admin-replay-spur`
