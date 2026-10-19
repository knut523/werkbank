Empfehlung: approve

Delta review, 55131d4..b94ee94 (four commits: 51f4e09, f9ff76a, 8086663, b94ee94). Static review of the six changed files plus the paths around them (send-otp, the customer opt-out handler, the claims route, `displayActors`, `appendAdminAudit`); nothing executed here.

**Verdict: approve — every point of the previous review is addressed in code, and the delta introduces nothing blocking.**

| # | Point | Source | Done? | Evidence |
|---|---|---|---|---|
| 1 | DSGVO inventory: `admin_audit_log` holds lead rows | previous review | yes | `AGENTS.md:271-276` — `target_type = 'form_user'`, found by `target_id = form_users.id`, no retention (K7), plus `follow_up_revoked_by` / `follow_up_started_at` |
| 2 | send-otp silently clears a team stop; no hint, no test | previous review | yes (behaviour kept, as decided) | `src/lib/follow-up-staff-opt-out.ts:164` (`reactivatedByCustomer`), `src/components/FollowUpStaffControls.tsx:105-109`, DB test through the real send-otp `POST` at `tools/follow-up-staff-opt-out-db.test.ts:267` |
| 3 | Changelog shows raw e-mails of former colleagues | previous review | yes | `src/lib/follow-up-staff-opt-out.ts:158,172` via `displayActors`; DB test `tools/follow-up-staff-opt-out-db.test.ts:285` |
| 4 | `'admin'` placeholder actor in the route | previous review | yes | `src/app/api/admin/follow-up/staff-opt-out/route.ts:31-35` — 500 when the session lacks id or e-mail, no placeholder |
| 5 | Prefill's two statements not one transaction | previous review | yes | `src/app/api/bank/prefill/route.ts:167-185`, one interactive `prisma.$transaction` |
| 6 | Restart-from-attempt-0 race (nit) | previous review | yes (documented) | PR body, known limits; the plan 132 edit in olaf-docs was not checked in this review |

Checked around the delta:

- **The hint's premise.** Three writers touch `follow_up_revoked_*`: send-otp clears every stop (`src/app/api/auth/send-otp/route.ts:179-180`), the bank prefill clears every stop except a team one (`src/app/api/bank/prefill/route.ts:180-183`), and the customer opt-out sets `'kunde'` **unconditionally** (`src/app/api/follow-up/opt-out/handlers.ts:8-16`, `where: { id }` only). `rows` is ordered `at desc, id desc`, so `rows[0]` is the latest entry. See nit 1 for the one sequence where the hint names the wrong cause.
- **The transaction does what the comment says.** Under READ COMMITTED the first `UPDATE` takes the row lock; a customer opt-out `UPDATE` or the staff action's `FOR UPDATE` read waits and lands afterwards, so neither is cleared by the second statement. It stays inside the existing best-effort `try`.
- **`displayActors`** maps `actor_label`, which `appendAdminAudit` fills with `actor.email`; an active colleague is still shown by address, as in the cockpit.

Nits (non-blocking):

1. **`reactivatedByCustomer` can name the wrong cause for a bank lead** (`src/lib/follow-up-staff-opt-out.ts:164`). The sequence: staff stop (audit row `stop`, `revoked_by = 'team'`), then the customer's opt-out link, which overwrites it with `'kunde'` because the update has no condition, then an advisor re-enrolment through `bank/prefill`, which clears a non-team stop and writes no audit row. The latest log row is still the stop and `revokedBy` is null, so the controls say "Durch eine neue Code-Anforderung der Kund:in wieder aktiv." In fact the advisor re-activated the lead, and against the customer's own opt-out, which is the decided prefill behaviour. This is rare and only on screen; no data is wrong. A neutral wording ("Erinnerungen laufen wieder, ohne Eintrag hier") or `lead_source`/`otp_requested_at` would tell the two apart. The code comment at `:163` names send-otp as the only cause, so it would need the same fix.
2. **Test leftovers.** The new send-otp test reserves an `outbound_emails` row (`kind = 'otp'`, `src/app/api/auth/send-otp/route.ts:82`), and `cleanup()` (`tools/follow-up-staff-opt-out-db.test.ts:40-43`) removes only `form_users` and `prefill_data`. The address is unique per run (`Date.now()`), so the 5-per-hour limit never trips. It only leaves rows behind in the test database. Adding `outbound_emails` with `recipient endsWith DOMAIN` to `cleanup()` would tidy it.
3. The 500 check in `gate()` also applies to the read-only GET. It never fires for a 2FA session, so this is harmless.

Tests to run before merge (not run in this review; the author reports them green): `npm run typecheck`, `npm run follow-up:test`, `npm run follow-up:test:db` (now includes the send-otp and departed-colleague cases), `leads:test:db`, `benutzer:test:db`, `app-role:test:db`, `service:test`, `nav:test`, `permissions:test`.

---
_Automated review (OLAF Workspace) · commit `b94ee94` · recommendation: approve. Approval or change requests are decided by Knut._
