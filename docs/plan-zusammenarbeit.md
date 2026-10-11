# Plan 126 — Werkbank Zusammenarbeit: team rooms with shared folders, versions, comments and a shared chat; live co-editing later

**Status:** PLAN ONLY (2026-10-11). No code written. Other agents are building `release/werkbank-2026-10-11` and
`feat/eine-oberflaeche` in the same repo, so this plan touches nothing until both have landed.
**Repo:** `~/work/knut/werkbank-gh` (base `origin/dev` `259f375`; also assumes `feat/ablage-dokumente` `8abd95e`, which is in
the release branch but not yet in dev).
**Request:** Knut, 11.10.2026: „Ich möchte mit meinem Team in der Werkbank gemeinsam an Dateien arbeiten können. Dafür
brauchen wir ein gutes Dateisystem und die Möglichkeit, zusammen in Chats und Dateien zu arbeiten. Check mal gute Repos
dafür ab oder baue einfache Sachen selber — plan-to-pr."
**Review package:** `~/work/knut/review-pakete/124-werkbank-zusammenarbeit/kurz.md` (German, decisions for Knut).

## 0. Decisions

All open. Each has a recommendation; nothing below is built on an assumption Knut has not confirmed.

| # | Question | Recommendation | Who |
|---|---|---|---|
| E1 | What is a "team room"? | **A Raum = one top-level team folder of the Ablage** (`olaf`, `konekto`, `intern`, …) plus a member list. Project rooms later, if asked for. | open → Knut |
| E2 | Where does the shared Ablage live? | Keep `WERKBANK_DOCS_DIR` (today `~/work/dokumente`) as the one store. The Werkbank runs on this workspace anyway; personal uploads go to `_personen/<userId>/` instead of the team folders. | open → Knut |
| E3 | Who manages membership? | **Werkbank admins only** (LibreChat role `ADMIN`) in S1; a `verwalten` member role later. | open → Knut |
| E4 | Shared chat: where? | **Our own Raum-Chat page in werkbank-web**, not a patch to LibreChat conversations (upstream has no multi-user chat, #10699 unanswered; a patch on the message model breaks on every update). | open → Knut |
| E5 | Whose Claude account answers in a shared chat? | **The person who writes `@Claude`.** Same principle as „Als Kopie weiterführen“: never use another person's session or token. | open → Knut |
| E6 | Agent access to files (precondition) | **S0 before anything else:** path guard in the bridge (file tools and Bash may read only the own working folder, the vault and the rooms the person belongs to). Real OS isolation (bubblewrap is not installed) stays a known residual risk. | open → Knut |
| E7 | Live co-editing | **Phase 2, after S1 has been used for two weeks:** Hocuspocus (MIT) inside the web process + CodeMirror 6 for Markdown only. S1 uses an edit lock instead. | open → Knut |
| E8 | Office/PDF files | **No browser editing.** Lock + versions + preview for PDF/images; Office stays download → edit → upload as new version. No OnlyOffice/Collabora (1–2 GiB). | open → Knut |
| E9 | Vault | Team notes do **not** go into the vault automatically. „In den Vault übernehmen“ is a confirmed write (existing pattern from the Sprint answer). | open → Knut |
| E10 | Personal data in rooms | A file flagged `personal` can be moved into a room only with a confirmation; the share-log records it; the Raum shows the flag. | open → Knut |

## 1. Goal

Two or more people of the team work on the same files and in the same conversation, with an agent in the loop:

1. A **Raum** has members. Its folder is visible to them (and only to them), in the web UI **and to their agents**.
2. Every change to a file is a **version**; any version can be opened and restored. Nothing is overwritten.
3. When someone works on a file, others see **„wird bearbeitet von Lisa (seit 10:42)“** and cannot silently overwrite it.
4. People can **comment** on a file or a message and **@mention** each other; mentions land in „Heute“.
5. A Raum has a **chat** in which several people write; `@Claude` hands the thread to an agent running under the writer's
   own account, in the Raum's folder; the answer is visible to everyone in the Raum.
6. Phase 2: two people edit the same Markdown note at the same time and see each other's cursors.

## 2. Current state (origin/dev `259f375` + `feat/ablage-dokumente` `8abd95e`)

Files (werkbank-web):
- Plain files on disk + metadata in Mongo `werkbank.files` (owner, `sharedWith[]`, `personal`, sha256, tickets, kind)
  (`web/server/sharing.ts:15,60-90`). On the ablage branch the store is `WERKBANK_DOCS_DIR/<team>/<vorgang>/JJJJ-MM-TT_<art>_<slug>.<ext>`
  with a filing suggestion (`web/server/ablage.ts`, `einsortieren.ts`), scratch cleanup (`scratch.ts`) and an admin backup (`backup.ts`).
- Permissions: one owner + individual read-only shares (`sharing.ts:86-118`). **No teams, no edit right, no link, no expiry.**
- **No versions:** an agent rewrite overwrites in place (`agentfiles.ts:8-9`); `_version` is only a file-name suffix.
- **No preview** (`web/src/pages/Dateien.tsx`); download always as attachment with CSP sandbox (`main.ts:1641-1653`).
- Append-only share-log `.runtime/werkbank/share-log.jsonl` (IDs only).

Chats:
- LibreChat v0.8.7, `sharedLinks {public:false}`, `peoplePicker {users:true, groups:false, roles:false}` (`librechat/librechat.yaml:39-47`).
  A shared link is a **read-only snapshot**; Werkbank lists shares from `sharedlinks`/`aclentries` and offers „Als Kopie
  weiterführen“ into the recipient's own Claude (`sharing.ts:139-198`). No patch touches sharing (`librechat/patches/10-*, 20-*`).
- Upstream v0.8.8 (2026-10-01) has ACLs for agents, prompts, MCP, skills, files and projects — **not for conversations**;
  multi-user chat is only a feature request (Discussion #10699).

Agents (claude-bridge):
- Per-person scratch `.runtime/bridge/scratch/<id>/chats/<conv>`, attachments to `anhaenge/<conv>/` (`sessions.ts:191-206`, `attachments.ts`).
- Written files are imported into „Meine Dateien“ every 2 min (`web/server/agentfiles.ts`, `main.ts:1920-1950`).
- **Gap (verified):** `Read/Glob/Grep` are class `read` with no path check (`claude-bridge/src/tools.ts`, `READ_TOOLS`); in
  `voll` mode (default, `scripts/start.sh:46`) Bash is `auto` unless it names a secret location (`tools.ts` `BASH_KEEP_CONFIRM_VOLL`).
  All sessions run as one OS user → **an agent can read every other person's scratch and every Ablage file.** Access
  control exists only in the web API. Any room model is cosmetic for agents until this is closed.
- No MCP tool for Werkbank files.

Realtime: `/api/events` SSE (`web/server/events.ts`) broadcasts `jira`/`github` keys to every logged-in client; single
process, no topic or user targeting. Plain `node:http` server (`main.ts:1833`), no WebSocket today.

Auth: LibreChat accounts + `WERKBANK_ALLOWED_EMAILS`; roles = LibreChat `role` (`ADMIN` via `needAdmin`, `main.ts:935`); no groups.

RAM (measured 2026-10-11): cgroup limit 16 GiB, `memory.current` 14.1 GiB, of which **anon 7.9 GiB, page cache 3.7 GiB**.
The biggest consumers are **three Meilisearch instances of parallel agent worktrees (1.8 + 1.3 + 1.2 GiB)**; the production
Meilisearch on :7700 uses 46 MB. Collaboration must add **≤ 150 MB** to the production stack; the dev-instance pressure is
a separate problem (Plan/Paket 123-ram).

## 3. Options

| | A — build on what exists | B — embed light OSS | C — heavy suite |
|---|---|---|---|
| What | Raum (members) on the Ablage, versions as files, edit lock, comments, Raum-Chat page, bridge path guard | A + Hocuspocus/Yjs in the web process with CodeMirror 6 (live Markdown), optional hacdias/webdav (MIT) for desktop mount, optional Excalidraw | Nextcloud + Collabora/OnlyOffice, or Outline/Docmost/AFFiNE |
| UX | One place (Werkbank), same login, agent inside; no live typing together in S1 | Google-Docs-like for notes; files still lock-based | Polished file/office UX, but a second login/app, agent not inside |
| RAM | +0–30 MB (existing processes) | +60–120 MB in-process (Hocuspocus est.), +15 MB webdav | 1.5–4 GiB + Postgres/Redis (AFFiNE min. 2 GiB, Outline stack ~500 MB+, Collabora ~1 GiB/session est.) |
| Effort | S0 2 d, S1 6–8 d | Phase 2 +5–7 d | 3–5 d setup, ongoing ops; integration with agents/ACL open-ended |
| License | own code | MIT (Yjs, Hocuspocus, y-codemirror.next, CodeMirror, Excalidraw, hacdias/webdav) | Nextcloud/Collabora/Docmost AGPL, Outline BSL, AFFiNE enterprise server |
| Risks | We own the code; conflict handling is only a lock | Agent writes vs. live doc need merging (§5.4); websocket through Coder proxy | Second permission model ≠ Werkbank; DSGVO copy of data; backups twice; does not fit the cgroup |

Rejected individually: filebrowser/filebrowser (archived 2026-09-01), tldraw (proprietary license key), HedgeDoc 2 (still
alpha), y-sweet (stalling), PartyKit (Cloudflare-only), Liveblocks self-host (AGPL dev server only), SilverBullet (single-user),
Seafile/SFTPGo (AGPL, second user store; SFTPGo would be the pick if desktop sync with per-folder rights becomes a must).

**Recommendation: A now (S0 + S1), B's live editor as Phase 2 once S1 is used.** C does not fit the RAM budget and splits
permissions away from the agents, which is the one thing the Werkbank is for.

## 4. Phased plan

### S0 — Agents respect the same boundaries as the web UI (precondition, own PR)

`claude-bridge/src/tools.ts`:
- `allowedRoots(user)` = own scratch, `VAULT_DIR`, and `WERKBANK_DOCS_DIR/<raum>` for each Raum the person belongs to
  (fetched from werkbank-web `/internal/raeume?user=` with the existing internal secret, cached 60 s).
- `READ_TOOLS` (`Read`, `Glob`, `Grep`, `NotebookRead`): target outside `allowedRoots` → `confirm` with reason
  „liegt außerhalb deiner Ordner“. Paths are resolved with `realish` (symlinks), as the write check already does.
- Bash in `voll`: add patterns for `.runtime/bridge/scratch/` (any id other than the own), `.runtime/werkbank/`, and
  `WERKBANK_DOCS_DIR` outside own rooms → `confirm`.
- Honest limit, written into README: Bash can still reach other paths by indirection (`cd ..; cat *`). Full isolation
  needs an OS sandbox (bubblewrap/uid per person), which this workspace does not have. Logged as residual risk.

### S1 — Raum: folder + members + versions + lock + comments + Raum-Chat (one PR, may split S1a files / S1b chat)

**Data model (Mongo `werkbank`)**

```
raeume        { _id: slug ('olaf'), name, folder: 'olaf', members: [{ userId, role: 'lesen'|'schreiben' }],
                createdBy, createdAt, archivedAt? }
files         + raumId?: string            // null = personal (_personen/<userId>/)
              + version: number            // current version number
              + lock?: { userId, name, since, heartbeatAt }
file_versions { _id, fileId, n, path /* .versionen/<fileId>/<n>.<ext>, relative to Ablage */, sha256, size,
                by: userId | 'agent:<userId>', at, note? }      // append-only
comments      { _id, target: { type: 'file'|'raumMsg', id }, raumId, author, body, mentions: [userId],
                createdAt, editedAt?, resolvedAt?, resolvedBy? }
raum_messages { _id, raumId, author: userId | 'claude', onBehalfOf?: userId, body, files: [fileId],
                mentions: [userId], createdAt, bridgeConv?: string }
notifications { _id, userId, kind: 'mention'|'lock-released'|'comment', ref, createdAt, readAt? }
```
Indexes: `files {raumId, path}`, `file_versions {fileId, n}` unique, `comments {target.id}`, `raum_messages {raumId, createdAt}`,
`notifications {userId, readAt}`.

**Rules (server, `web/server/raeume.ts`, new)**
- `canRead(u, file)` = owner ∨ `sharedWith` ∋ u ∨ member of `file.raumId`. `canWrite` = owner ∨ member with `schreiben`.
  Replaces the inline check in `sharing.ts:86-90`; every file route goes through it.
- New version on: upload to an existing file, agent write (`agentfiles.ts` no longer overwrites), restore (restore = copy of
  old version as a new version). The current file stays at its readable Ablage path; old versions move to
  `.versionen/<fileId>/<n>.<ext>` (hidden from the filing view, included in backup).
- Lock: `POST /api/files/:id/lock` (takes it if free or heartbeat older than `WERKBANK_LOCK_TTL_MIN`), heartbeat every 60 s from
  the open page, `DELETE` releases. Upload by someone else while locked → 409 with „wird bearbeitet von …“ and a
  „trotzdem als neue Version speichern“ button (never blocks forever, never overwrites).
- Agents: a write by the bridge into a locked file → stored as a version with note „Agent, während Lisa bearbeitet“; the
  lock holder sees it in the version list. No silent overwrite.
- Comments/mentions: mention of a non-member is rejected (would leak the file name). Mentions create `notifications` and an
  entry in „Heute“ (`/api/today`, branch `feat/heute-review-schlange`).
- SSE: `bus.emit('raum', { raumId, kind })`; the `/api/events` handler filters by membership (new: per-listener user filter).
  Presence („Lisa, Tom sind in diesem Raum“) = SSE listeners per Raum, no extra store.

**Raum-Chat**
- `/wb/raum/<slug>` page: left the folder (with lock/version badges), right the chat thread. Messages via
  `POST /api/raeume/:id/messages`, live via SSE.
- `@Claude <Auftrag>`: werkbank-web calls the bridge (`/internal/raum-turn`, new) with the **writer's** stored Claude token,
  `cwd` = `.runtime/bridge/raeume/<raumId>/` (a scratch for this Raum) with `additionalDirectories` = the Raum folder + vault,
  and a prompt that contains the last `WERKBANK_RAUM_CONTEXT_MSGS` messages. The streamed answer is stored as
  `author:'claude', onBehalfOf: writer`, shown as „Claude (für Lisa)“. Tool confirmations go to the writer only.
- „In den Raum holen“ on a LibreChat chat: reuses the „Als Kopie weiterführen“ export (`sharing.ts:180-198`) and posts it as a
  message with the Markdown attached, instead of a new private chat.
- No LibreChat patch. The left-bar entry „Räume“ is a nav item like the other `/wb` pages (coordinate with
  `feat/eine-oberflaeche`).

**Preview** (small, in S1): PDF via the browser's own viewer in a sandboxed iframe from a `inline` route with CSP
`sandbox`, images inline, Markdown/text rendered server-side with the existing sanitizer. Office: no preview.

### S2 — Live co-editing of Markdown (Phase 2, own PR, only after E7)

- Hocuspocus server **in the werkbank-web process** on the same port: `server.on('upgrade')` for `/api/collab`, `onAuthenticate`
  checks the `wb_session` cookie and `canWrite`/`canRead` (read-only connection for `lesen`).
- Persistence: Hocuspocus `database` extension → Mongo `ydocs {fileId, state: Binary, updatedAt}`; on `onStoreDocument`
  (debounced 5 s) the text is written to the Ablage file; **a new `file_versions` entry when the last editor leaves**
  (not on every keystroke).
- Editor: CodeMirror 6 + `y-codemirror.next` (raw Markdown, MIT, robust; WYSIWYG via Milkdown only if the team asks).
  Cursors and names via Yjs awareness.
- Agent writes to an open document: `agentfiles` detects `ydocs` presence → applies the agent's new text as a diff
  transaction through a Hocuspocus direct connection (`openDirectConnection`), so editors see it live and nothing is lost.
- RAM guard: unload documents 60 s after the last client; `WERKBANK_COLLAB_MAX_DOCS` (default 50).

### S3 — optional, only on demand
Excalidraw boards in a Raum (Yjs binding, same Hocuspocus); WebDAV mount via hacdias/webdav (MIT, ~15 MB) with per-Raum
rules generated from `raeume`; project rooms (E1).

## 5. Settings

| Setting | Default | Meaning |
|---|---|---|
| `WERKBANK_DOCS_DIR` | `~/work/dokumente` | the one Ablage (unchanged) |
| `WERKBANK_LOCK_TTL_MIN` | `15` | a lock without heartbeat expires after this |
| `WERKBANK_VERSIONS_KEEP` | `0` (= all) | versions kept per file; >0 prunes the oldest, never the current |
| `WERKBANK_RAUM_CONTEXT_MSGS` | `30` | messages passed to Claude on `@Claude` |
| `WERKBANK_RAUM_FROM_TEAMS` | `true` | create a Raum for each existing Ablage team folder on first start (members empty, admin adds) |
| `BRIDGE_PATH_GUARD` | `on` | S0 guard; `off` only for diagnosis |
| `WERKBANK_COLLAB` | `off` | S2 live editing |
| `WERKBANK_COLLAB_MAX_DOCS` | `50` | S2 open documents in memory |

## 6. Definition of Done

S0
1. An agent of person A asking to read a file in B's scratch or in a Raum A is not a member of gets a confirmation
   „liegt außerhalb deiner Ordner“; test in `claude-bridge/test/tools.test.ts` for Read, Glob, Grep and the Bash patterns.
2. Own scratch, vault and own rooms read without asking (no new prompts for normal work — measured on 3 real chats).
3. README states the residual Bash risk in one paragraph.

S1
4. Admin creates/edits a Raum and its members on `/wb/raum`; a non-member gets 404 for the Raum, its files and messages (API test).
5. Upload over an existing file, agent write and restore each create a version; `file_versions` is append-only; restoring
   v2 of v5 yields v6 with v2's sha256 (test).
6. Lock: B sees „wird bearbeitet von A (seit …)“ within 2 s (SSE); B's upload gets 409 + „trotzdem als neue Version“; a lock
   expires after TTL without heartbeat (test with fake clock).
7. Comment with @mention of a member appears in the member's „Heute“; mention of a non-member is rejected (test).
8. Raum-Chat: two browsers see each other's messages live; `@Claude` from A runs with A's token in the Raum folder, the
   answer shows „Claude (für A)“, a file Claude writes appears in the Raum folder as a version (e2e with bridge mock).
9. Backup (`/api/backup`) contains `raeume`, `file_versions`, `comments`, `raum_messages` and `.versionen/`; restore into an
   empty DB tested once.
10. RAM: production stack RSS (web + bridge) after 1 h with 3 users ≤ +30 MB vs. before (measured, numbers in the PR).
11. Screenshots 390×844 and desktop of `/wb/raum/<slug>` in the review package; `olaf-feedback-check` done.

S2 (when built)
12. Two browsers edit the same `.md` concurrently, see both cursors, the file on disk equals the editor text after 5 s.
13. An agent write while both edit is merged live, no text lost (e2e).
14. +≤ 120 MB RSS with 10 open documents (measured).

## 7. DSGVO, backups, vault

- Rooms are internal (allow-listed LibreChat accounts only, no public links, unchanged `ALLOW_SHARED_LINKS_PUBLIC=false`).
- `personal` files keep their flag in a Raum; moving one in needs a confirmation and writes the share-log (E10). Backup
  encrypts them as today (`WERKBANK_BACKUP_KEY`); versions of a personal file inherit the flag.
- Deleting a file deletes all its versions (Art. 17); a deleted Raum is archived, files stay until an admin deletes them.
- Removing a member: immediate loss of access (web and S0 guard via 60 s cache); their past messages stay, attributed.
- Vault stays read-mostly; „In den Vault übernehmen“ from a Raum note uses the confirm-with-preview pattern (E9).

## 8. Parallel work and overlaps

- `feat/ablage-dokumente` must be in dev first (S1 builds on its layout). `feat/eine-oberflaeche` owns the navigation —
  the „Räume“ entry is added after it lands. `feat/heute-review-schlange` provides `/api/today` for mentions.
- LibreChat upgrade to v0.8.8 is independent; nothing here depends on LibreChat ACLs.
- No change in the vault, in Jira or on GitHub from this plan.

## 9. Deliberately not

- No multi-user patch to LibreChat conversations; no LibreChat projects as rooms.
- No Office editing in the browser (OnlyOffice/Collabora), no Nextcloud, Outline, Docmost, AFFiNE, Seafile.
- No public or external share links, no guests outside the allow-list.
- No live co-editing in S1 (lock instead); no WYSIWYG editor in S2 unless asked.
- No per-person OS users/sandbox in this plan (residual risk documented in S0).
- No desktop sync client.

## 10. Council (Claude only, 2026-10-11, on this plan before any code)

**Proponent.** The Werkbank's value is that agents work inside the same permissions and files as people. Option A keeps one
permission model (`raeume` + `canRead/canWrite`) used by the web API, the S0 guard and later Hocuspocus. Versions-as-files
fit the Ablage and the existing backup. The Raum-Chat solves the real gap (LibreChat cannot do multi-user) with the pattern
the team already knows from „Als Kopie weiterführen“, and costs almost no RAM.

**Specialist (storage/realtime).** (1) Keep the current version at its human path and old ones under `.versionen/` —
otherwise the filing view and the agents' paths change on every save. (2) SSE needs a per-listener user filter before it
carries Raum events; today it broadcasts to all. (3) Hocuspocus needs a WebSocket upgrade through the Coder preview
proxy and the LibreChat `/werkbank` proxy (`librechat/patches/10-server-werkbank-proxy`) — verify upgrade passthrough
before committing to S2, or serve `/api/collab` on the direct 3070 link. (4) The bridge path guard must resolve symlinks
the same way as the write check (`realish`), or a symlink in scratch bypasses it.

**Devil's advocate.** (a) S0 is a speed bump, not a wall: in `voll` mode Bash can read anything; selling rooms as
„geschützt“ would be false — the UI must say „sichtbar für Mitglieder“, not „verschlüsselt/getrennt“. (b) A Raum-Chat beside
LibreChat makes two chat surfaces; people will lose threads. (c) The team is 5–10 people; do they really edit the same file
at the same time? Without evidence, S2 is gold-plating. (d) Putting the shared Ablage in Knut's home (`~/work/dokumente`)
ties team data to one person's workspace and one person's backups.

**UX expert** (per `~/.claude/skills/ux-expert/SKILL.md`; no screens yet, so findings on the flow):
- [major] One primary action per Raum page: „Datei hochladen“ on the folder side, the message box on the chat side; lock
  and version controls must be secondary (badges + menu), not a toolbar of six buttons.
- [major] The lock must explain itself in words and time („Lisa bearbeitet seit 10:42 — du kannst eine neue Version
  speichern“), never a bare padlock icon; 409 must not lose the user's file.
- [major] „Claude (für Lisa)“ must be visible on every agent message, or members will think the agent acts for the Raum.
- [minor] Mobile 390 px: folder and chat as two tabs, chat first (it is what people come for on the phone).
- [minor] Version list: date, person/agent, size change, „wiederherstellen“; no hashes in the UI. WCAG: lock/presence
  state also as text, not colour only.
- Consistency: reuse the existing „Dateien & Teilen“ list and building blocks; a Raum is a filter of the same list, not a
  new file browser.

**Finalizer — verdict: PASS for S0 + S1 with binding conditions; S2 HOLD until evidence.**
1. S0 ships before or with S1; the UI and README call rooms „sichtbar für Mitglieder“, never „getrennt/geschützt“ (DA a).
2. Versions: current file keeps its Ablage path; old versions in `.versionen/` (Specialist 1). DoD 5 tests this.
3. SSE gets per-listener filtering before any Raum event is emitted (Specialist 2).
4. The Raum-Chat links both ways: a LibreChat chat can be brought into a Raum, and every Raum appears in the left bar with an
   unread count — one place to find threads (DA b). Revisit after 4 weeks of use: if Raum-Chats stay unused, drop S1b.
5. S2 only after Knut decides E7 with usage evidence from S1 (how often a lock blocked someone), and after the WebSocket
   proxy passthrough is verified (Specialist 3).
6. E2 (Ablage location) is decided by Knut explicitly; if the team should not depend on his workspace, `WERKBANK_DOCS_DIR`
   moves to a team path before S1, not after (DA d).
7. UX majors above are acceptance criteria for the review package screenshots.
