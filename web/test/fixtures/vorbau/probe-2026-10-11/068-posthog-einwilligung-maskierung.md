# 068 — PostHog erst nach Einwilligung, Aufnahmen maskiert

**Status (06.10.2026, nachgetragen):** offen — kein PR; gebaut nur lokal auf olaf-tariff-app
`fix/posthog-einwilligung-maskierung` @ `59efd84` (25.09.2026, 5 Commits auf `develop` `d80f1f3`,
nie gepusht; `develop` ist inzwischen 26 Commits weiter). Auf `develop` sind DoD 1, 2 und 4 nicht
erfüllt: `opt_out_persistence_by_default`, `data-ph-mask` und
`e2e/specs/fast/posthog-consent.spec.ts` fehlen dort (geprüft gegen `origin/develop` @ `8259ae7`);
DoD 3 und 5 beschreiben Verhalten, das `develop` schon hat. Der Zweig braucht einen develop-Merge,
bevor ein PR geht; ein Probe-Merge hat Konflikte in `RegistrationForm.tsx` und `Screen3Booking.tsx`.
In PostHog 147335 maskiert die Projekteinstellung weiterhin nur Eingabefelder (B15 offen). Wo der
Plantext darunter diesem Block widerspricht, gilt dieser Block. Diese Datei lag bis 06.10.2026 nur
auf einem lokalen Branch (`docs/plans-062-067`) und wird unverändert nachgetragen; der Text darunter
ist der Stand vom 25.09.2026.

**Repo:** olaf-tariff-app · **Branch:** `fix/posthog-einwilligung-maskierung`, auf `develop` (`d80f1f3`)
**Worktree:** `~/work/knut/olaf-tariff-app-posthog-consent`
**Spec:** Vault `1-Roadmap/Anmeldestrecke/3-Plan/anmeldestrecke-spec-posthog-einwilligung-maskierung.md`
**Danach:** [069](069-experiment-grundgeruest.md) setzt auf diesem Branch auf (gestapelt).
