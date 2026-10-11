# Plan 125 — RAM in the Werkbank and this Coder workspace

Owner Knut · drafted 11.10.2026 · status: council HOLD → conditions met for B, D, E; C deferred · related: release branch
`release/werkbank-2026-10-11` (`~/work/knut/werkbank-release`, other agent: idle reaping of Claude processes,
memory warning in Heute, memory-based parallel limit — referenced here, not duplicated).

## Goal

Knut, 11.10.: *"Are we hitting RAM limits per chat for parallelism? Anything else we must watch so the box
doesn't OOM? … look for RAM-friendly options … and do this regularly (aware of what is up and what we still need)."*

Done means: we know where the memory goes (measured, not guessed), the box has a standing report of what runs and
what could go, the cheap wins are either done or waiting on one OK each, and there is a clear answer on parallel
chats and on a separate VM for the team Werkbank.

## Measurements (11.10.2026 ~14:00, read-only)

Method: `/proc/<pid>/smaps_rollup`, **PSS + SwapPss** (proportional). Plain `Swap`/`RSS` double-counts shared
memory — Postgres looked like 3.9 GB swap that way; proportionally it is 66 MB.

**cgroup:** memory.max 16 GiB · memory.current 13.4 GB · swap 15.9 GB · `max` events 35 979 · oom_kill 0 ·
PSI full avg60 ≈ 2–4 %. Of memory.current: **anon 3.6 GB**, file cache 5.1 GB (reclaimable), **slab 3.9 GB
reclaimable** (dentry/inode cache — whole-filesystem `bfs`/`find` runs by agents feed it), zswap 0.48 GB holding
2.0 GB. Host: 32 GB RAM, 64 GB swap files, 40.8 GB used host-wide (shared with other workspaces).
`memory.swap.max = max` → the cgroup cannot OOM while host swap has room; the real cost today is latency
(major faults, PSI), and the OOM risk is host swap filling up or one runaway process.

**By category (MB, PSS / SwapPss):**

| Category | RAM | Swap | Procs | Note |
|---|---:|---:|---:|---|
| Next previews | 66 | **7 346** | 22 | one `next dev --webpack` (3131, flex-interview, 2 days) alone 3 559 swap |
| Meilisearch | 1 052 | 257 | 5 | **indexing spikes 0.6–2.1 GB per instance** (release 1 176, werkbank-gh 2 089 while measuring) |
| LibreChat | 640 | 695 | 4 | 4 instances (live, orchestrator, release, eine-oberfläche); fresh ≈ 320 RSS |
| MongoDB | 488 | 614 | 6 | 2 of them are test mongods (27117, 27217); fresh ≈ 180 MB each |
| Claude Code CLI | 497 | 316 | 17 | 350–500 MB per interactive session |
| compartment (MCP per Claude session) | ~10 | ~1 000 | 6 | one python per Claude CLI session, 115–390 MB each, almost all swapped |
| Werkbank SDK chat (claude binary) | 260 | 232 | 2 | ≈ 170–270 MB per **active** turn |
| claude-bridge / tsx bots | 108 | 561 | 6 | 3 bot-gespraech instances (3065, 3066, 3121/3122) |
| Werkbank web | 228 | 152 | 4 | |
| Postgres (55433) | 34 | 66 | 42 | shared_buffers 128 MB, max_connections 100, work_mem 4 MB; 254 DBs (7 GB disk); 37 client conns, all idle, 6 per preview |
| python proxies/http.server/uvicorn | 25 | ~250 | 19 | |
| coder agent / editor / kandev | 260 | 150 | 6 | infrastructure |

**Werkbank chat cost.** The bridge runs one `claude` (Agent SDK binary) **per turn** with `resume`; between turns
a chat costs **0 MB**. A turn costs ≈ 170–270 MB (PSS+swap) plus tool children it spawns (Bash, builds — these can
be far larger). A chat waiting for "ja" keeps its process up to `BRIDGE_CONFIRM_TIMEOUT_S` (30 min).
`BRIDGE_MAX_PARALLEL_CHATS` = 3 per person already exists (dev/release). Bridge-spawned Claude does **not** start a
compartment child (unlike CLI sessions).

**Werkbank stack** (Mongo + Meili + LibreChat + web + bridge): ≈ 0.7–0.9 GB steady, 1.6 GB+ during first indexing.
Four stacks run today (live + three agent instances).

**Mongo cache.** mongod 8.0.20, no `--wiredTigerCacheSizeGB`. Default = max(0.25 GB, 50 % × (limit − 1 GB));
inside a cgroup Mongo uses the container limit → **≈ 7.5 GB ceiling per instance**, × 6 instances. Data is tiny so
actual use is ~70–190 MB; the cap is protection, not a saving today.

**Meilisearch.** v1.35.1, no `--max-indexing-memory` → default is 2/3 of available RAM. That is what we saw
(2.1 GB spike for one index build).

**Stale services** (from `dienste --vorschlag`, registry = Monday overview): 17 listening services, ≈ 2.6 GB
(mostly swap) — previews 9–12 days old, two with deleted build dirs, azurite ×2 (12 days), http.servers
8100/8110, calc-api 8079, test mongod 27117, an 18-day-old kandev opencode (4096). Plus unregistered young ones:
`next dev` 3131 (3.5 GB), bot 3065/3066 (0.2 GB), test mongod 27217 (0.2 GB). **Stray:** `bfs -S dfs … / -name
meilisearch*` (pid 3384108, started by the werkbank-vault-suche agent, 213 MB + slab growth) — reported, not killed.

## Options

Saving = MB of RAM+swap freed, measured today. Risk = what breaks if wrong.

| # | Option | Saving | Risk | Reversible |
|---|---|---:|---|---|
| A | Stop stale previews/servers from the `--vorschlag` list | **2 600** (+3 500 for `next dev` 3131) | low — nobody uses them; rebuild via start scripts | yes (restart) |
| B | Service registry + `dienste` report + weekday cron | 0 directly; keeps A from regrowing | none (read-only) | delete file/cron |
| C | `oom_score_adj` +800 for previews | 0; decides who dies first on OOM | low; inherited by children; wrong target if the registry is stale | yes — `echo 0 > /proc/<pid>/oom_score_adj` (oom_score_adj_min is 0) |
| D | Meilisearch `--max-indexing-memory 256MiB` in werkbank start scripts | **0.4–1.8 GB per indexing spike** | indexing slower; data size tiny | yes |
| E | Mongo `--wiredTigerCacheSizeGB 0.25` | ~0 today, caps 7.5 GB ceiling × n | slower if data grows past cache (not foreseeable) | yes |
| F | Node `--max-old-space-size` for LibreChat/web/bridge | 0 today | **turns slow growth into a crash; no supervisor restarts the live Werkbank** | yes |
| G | One shared mongod for all Werkbank instances | ~300–500 (3 instances) | isolation of agent test instances lost; port/db-name coupling; release agent mid-switch | medium |
| H | Prisma `connection_limit=3` in preview DATABASE_URL on next restart | ~50–100 (idle backends) | none | yes |
| I | PgBouncer, lower max_connections / shared_buffers | ~100 | config of the shared cluster, all previews | yes, but restart of PG |
| J | Preview-on-demand launcher (start on first request, stop after idle) | ≈ A, automatically | proxy + login-proxies + iframe proxy chains; cold start 5–20 s during review | medium |
| K | Claude: idle reaping, memory-based parallel limit, memory warning | per waiting chat 170–270 | — | **release agent owns it** |
| L | Shorter `BRIDGE_CONFIRM_TIMEOUT_S` (30 → 10 min) | 170–270 per abandoned "ja?" | user loses a pending question sooner | yes (env) |
| M | zram instead of disk swap | — | needs root; zswap is already on (2.0 GB → 0.48 GB) | n/a |
| N | Stop whole-filesystem searches (`bfs`/`find /`) | slab 1–4 GB (reclaimable anyway) | none | — |
| O | compartment MCP: one shared server instead of one per CLI session | ~600–900 | not our code; tool config | — |
| P | Team Werkbank on its own VM / workspace | isolates team from agent builds entirely | cost, ops | yes |

## Chosen cut

**Now, in this workspace (no live-Werkbank change):**
1. **B** — registry `~/work/knut/review-pakete/00-dienste.yaml`, script `~/bin/dienste`
   (list · `--vorschlag` · `--stop PORT` only for listed · `--ram` · `--bericht FILE`), cron weekdays 06:50 writing
   `~/work/knut/review-pakete/00-dienste-bericht.md` (visible via the 8098 review-package server).
2. **C** — `dienste --oom` exists (raises `oom_score_adj` to 800 for listening processes not `schutz: live`) but is
   **not applied** until the release agent has switched the live Werkbank and the registry says which ports are live
   (council condition 3).
3. Report the stray `bfs` and the stop list to Knut — **A is executed only after his OK** (other agents' and his
   own previews).

**As branch `feat/ram-sparsam` from `origin/dev` (not applied live, merge notes for the release):**
4. **D** Meili `--max-indexing-memory 256MiB` (env-overridable `WB_MEILI_INDEXING_MEMORY`).
5. **E** Mongo `--wiredTigerCacheSizeGB 0.25` (env-overridable `WB_MONGO_CACHE_GB`).

**Plan only (needs OK or belongs elsewhere):** H on the next preview restart, L (decision for Knut), K (release
agent), daily-debrief line from the report (see below), P (recommendation).

**Report surfacing — decision:** the lighter path is the **vault daily debrief**: one line
("Dienste: N zum Aufräumen, ≈ X MB → 00-dienste-bericht.md") appended by `jira-daily-vault.sh` when N > 0. It
touches one existing cron script instead of Werkbank code that the release agent is changing. Wired later, after
Knut's OK — today only the report file is written.

## Settings table

| Setting | Where | Today | Proposed | Status |
|---|---|---|---|---|
| `--max-indexing-memory` | werkbank `scripts/start.sh` (+ isoliert.sh on release) | default (2/3 RAM) | `256MiB` | branch `feat/ram-sparsam` |
| `--wiredTigerCacheSizeGB` | same | default (≈7.5 GB ceiling) | `0.25` | branch `feat/ram-sparsam` |
| `oom_score_adj` | previews/proxies/test stacks | 0 | 800 | `dienste --oom` |
| `connection_limit` | preview DATABASE_URL | Prisma default 25 | 3 | on next preview restart |
| `BRIDGE_CONFIRM_TIMEOUT_S` | bridge env | 1800 | 600 | Knut decides |
| `BRIDGE_MAX_PARALLEL_CHATS` | bridge env | 3 per person | keep 3 here; memory-based limit from release | release agent |
| Node heap caps | — | default | **none** (see Deliberately not) | — |

## DoD

- [ ] `~/bin/dienste` lists every listening port ≤ 45000 plus registered higher ports with pid, command, cwd,
      PSS, SwapPss, registry entry and flags UNREG / ABGELAUFEN / GELOESCHT / IDLE / ALT.
- [ ] `--vorschlag` never lists a `schutz: live` entry or a registered entry before its `bis`; `--stop` refuses
      anything not on that list (tested against port 3070 → refused).
- [ ] `--bericht` runs under a cron-like empty environment and writes atomically; command lines in the report are
      redacted (`key=`, `token=`, `password=`, long secrets).
- [ ] Registry holds the live Werkbank, the three agent Werkbank instances, infrastructure and every service the
      Monday overview links to.
- [ ] Crontab entry weekdays 06:50 present; first file exists.
- [ ] `dienste --oom` implemented, not applied (deferred, council condition 3).
- [ ] Branch `feat/ram-sparsam` in its own worktree from `origin/dev`, `bash -n` clean, a throwaway mongod and
      meilisearch start with the new flags on spare ports, merge notes for the release in the commit message.
- [ ] `~/work/knut/review-pakete/123-ram/bericht.md` (German) with stop list for OK.
- [ ] Nothing killed that this session didn't start; nothing pushed; no Jira.

## Rollback

- Registry/report: `crontab -e` remove the 06:50 line; delete `~/bin/dienste`, `00-dienste.yaml`, `00-dienste-bericht.md`.
- `oom_score_adj`: `echo 0 > /proc/<pid>/oom_score_adj` for the process and its children (inherited at fork).
- Branch: do not merge / `git worktree remove ~/work/knut/werkbank-ram-sparsam`. After merge: drop the two flags
  or set `WB_MEILI_INDEXING_MEMORY=` / `WB_MONGO_CACHE_GB=` empty to get defaults back.

## Deliberately not

- **Node heap caps (F)** — saves nothing today and turns a slow leak into a crash of a process nothing restarts.
  Revisit only together with a supervisor (systemd user unit or a restart loop) — not on this box.
- **Shared mongod (G)** — agent test instances rely on isolation; the release agent is switching the live stack.
- **Preview-on-demand (J)** — previews sit behind login proxies and iframe proxies; a cold start during review is
  worse than a stopped preview plus a `start` line in the registry. Registry + weekly cleanup gets most of the gain.
- **PgBouncer / PG tuning (I)** — 100 MB for a restart of the cluster every preview depends on.
- **Killing anything automatically** — `dienste` never stops by itself.
- **Claude process lifecycle (K)** — release agent.
- **zram (M)** — needs root; zswap already compresses.

## Addendum 11.10. (coordinator data point): Meilisearch of isolated instances

Measured 14:25: live Meili (7700) **40 MB RAM** (+198 swap). The isolated ones: eine-oberfläche 7890 **1 172 MB**,
vault-suche 7797 **2 089 MB**, release 7795 **504 MB** — ≈ 3.8–4.3 GiB together, minutes after start. Cause: each
isolated instance starts with a copy of the live Mongo, LibreChat syncs every conversation/message into a fresh
Meili index at boot, and Meili's indexer takes up to 2/3 of the cgroup limit (default shown by `--help`:
"10.67 GiB"). LibreChat creates only two indexes (`convos`, `messages`); the size comes from the bulk first sync,
not from the number of indexes.

| # | Option | Saving | Risk | Decision |
|---|---|---:|---|---|
| Q1 | `--max-indexing-memory 256MiB` on every Meili start (start.sh **and** release `isoliert.sh`) | 0.3–1.8 GB per instance spike | indexing slower (seconds, data small) | **yes** — start.sh on `feat/ram-sparsam`; isoliert.sh as merge note (file only exists on the release) |
| Q2 | Isolated test instances run **without search**: LibreChat `SEARCH=false`, no Meili process | the whole 0.5–2.1 GB per instance | search in the test UI does not work — only matters when search itself is under test | **yes, as default for isoliert.sh** with opt-in `WB_ISO_SUCHE=1`; change belongs to the release agent's isoliert.sh → handed over as merge note, not applied |
| Q3 | One shared Meili for all isolated instances | ≈ Q2 minus one instance | LibreChat has fixed index names → instances would read each other's chats; needs a patch | **no** |
| Q4 | Stop isolated instances after use: every instance in the registry with owner + `bis`; `dienste` proposes them the day after | all of it, after `bis` | none | **yes** — registry now carries 7790/7795/7797/7890 with owner and `bis` |
| Q5 | Limit index count / `MEILI_EXPERIMENTAL_REDUCE_INDEXING_MEMORY_USAGE` | small | experimental flag | no (Q1 + Q2 suffice) |

Merge note for the release agent (isoliert.sh): add `--max-indexing-memory "${WB_MEILI_INDEXING_MEMORY-256MiB}"` to
`start_one meilisearch …`, and default `WB_ISO_SUCHE=0` → skip the Meili start and export `SEARCH=false` for that
LibreChat; `WB_ISO_SUCHE=1` keeps today's behaviour. Also: the vault-suche Meili (7797) passes `--master-key` on the
command line (visible in `ps`) — use `MEILI_MASTER_KEY` in the environment like start.sh does.

## Council (11.10.2026, Claude only: proponent, specialist, devil's advocate, finalizer)

```
VERDICT: HOLD (confidence 0.8)
WHY: Direction is right — measured with SwapPss, risky options (heap caps, shared mongod, on-demand previews)
     held back, nothing stops automatically. But the first script version would have proposed a kandev agent and
     registered previews (IDLE/GELOESCHT ignored `bis`), --stop left workers alive, and --oom could hit the
     release instance after the live switch.
BINDING CONDITIONS:
  1. [must-fix] Secret scrub on every command line in output (key/token/secret/password args, URL userinfo,
     long mixed tokens); fixture incl. `--master-key`.                                    → done, tested
  2. [must-fix] Registered entries are proposed only after `bis`; IDLE/GELOESCHT are hints there.
     Ephemeral range out (MAX_PORT 32767); kandev task agents flagged KANDEV, never ALT. → done
  3. [must-fix] Do not apply --oom until the live switch is finished and the registry lists the live ports;
     parent filter as strict as --stop's; docstring: reversible, inherited.             → done (not applied)
  4. [must-fix] --stop: whole process group, never own/shell/session group, verify port closed.
                                                                                        → done, tested on own dummy :8199
  5. [verify]   Host swap (all workspaces) in --ram with an 80 % warning; dated history copy outside 8098.
                                                                                        → done
  6. [must-fix] Branch: `${VAR-default}` so an empty value restores program defaults; merge notes name the
     start.sh conflict with the release and that isoliert.sh (release-only) needs the same two flags.
                                                                                        → done
NOTES: The report is write-only until the debrief line exists (devil). Accepted for one week; wire the line after
Knut's OK. Re-check the registry the day the release goes live — the 35xx entries expire 14.10.
```

Corrections taken from the specialist: unprivileged `oom_score_adj` can be lowered back to 0; Meili's
`--max-indexing-memory` is a soft limit on indexing, not a process cap (`MEILI_EXPERIMENTAL_REDUCE_INDEXING_MEMORY_USAGE`
is a further knob, not taken); `memory.high` ≈ 14 GiB would throttle before swap but needs the workspace template
(Coder admin) — listed for the VM discussion.
