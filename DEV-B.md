# DEV-B.md — Dev B Session Memory

This file is **Dev B's context file** for Claude Code in this repo — the counterpart to Dev A's
`.claude/CLAUDE.md`. It is committed so Dev A can read it, but it auto-loads only in Dev B's
sessions via a gitignored `CLAUDE.local.md` containing `@DEV-B.md`.

**Update rule: at the end of every work session, append a dated entry to the Session Log at the
bottom — never delete prior entries, only add.** Then update the Dev B column of your row in
`GLOBAL.md` so Dev A sees status without reading this file.

> **Why not `.claude/CLAUDE.md`?** Claude Code auto-loads the **root** `CLAUDE.md` (which here
> only contains `@AGENTS.md`) plus any file it `@`-imports — not `.claude/CLAUDE.md`. Dev A's
> context file is therefore likely never being read automatically; it has to be opened by hand.
> Flagged to Dev A on Day 2. Don't copy that layout.

---

## Who I am

**Dev B — "Ops & People Console."** Dev A (Saad) owns the Core Calling Pipeline. We split
full-stack by module so we rarely touch the same files.

| I own | Dev A owns |
|---|---|
| Admin Configuration | Lead Import Engine |
| Communication Module | Lead Assignment Engine |
| Monitoring Engine | Agent Calling Workspace |
| HR Module | Agent Dashboard |
| Management Console | Search / Lead Timeline / Assignment History |
| Reporting Engine (frontend + score) | Reporting Engine (backend aggregation) |
| Audit Log **search UI** | Audit Log **capture** |

**Don't build in Dev A's territory.** If something crosses the line, coordinate through
`GLOBAL.md`'s Cross-Cutting Decisions Log.

## Stack

- **Next.js 16.3.4**, App Router, TypeScript, React 19.2.8, Tailwind v4, `src/` directory
- **Custom server** `server.ts` run through `tsx` — *not* `next start`. Owns the Next handler,
  Socket.io, and node-cron in one process.
- **PostgreSQL 16** in Docker via `docker-compose.yml`; **Prisma 6.19.3 (pinned)**
- **Socket.io** at `/api/socket`, authenticated on the handshake
- **shadcn/ui on Base UI** (not Radix) + `sonner` for toasts
- **Deployment:** self-hosted VPS, Nginx + PM2/Docker

---

## Rules I must not violate

1. **TM-05 — the hardest boundary in the project.** Active Time, Idle Time, Break/Pause Time and
   Productivity % are **Management-only**. They must never appear on an Agent screen, in
   `NAV.agent`, or in any component an Agent-role page imports. The Agent role holds no
   `monitoring.*` permission — the boundary already holds at the data layer, and it must stay that
   way. I own the Monitoring Engine, so I am the one most likely to break this.

2. **RBAC is checked once, at the API-route level**, via `requireRole()` / `requirePermission()`
   from `src/lib/auth/rbac.ts`. Page guards in `src/lib/auth/guard.ts` are UX only, never the
   boundary. **Prefer permission keys over role names** so Admin can re-map at runtime.

3. **New permission keys go in `src/lib/auth/permissions.ts`** and must be added to the seed. Never
   invent a permission string inline in a route.

4. **Socket events come from `src/lib/realtime/events.ts`.** No string literals in routes. Adding an
   event = edit that file + log it in `GLOBAL.md`.

5. **Coordinate before touching `audit_log`, `notifications`, or `activity_events`.** Dev A writes
   to all three from Day 3/Day 8. My 9 framed tables (`messages`, `message_recipients`,
   `announcements`, `announcement_acknowledgements`, `hr_employees`, `hr_documents`,
   `leave_requests`, `reports_generated`, `management_scores`) are mine to reshape freely.

6. **Never touch the lead ownership block** (`leads.status` / `assigned_to_id` / `locked_at` /
   `current_assignment_id`) or `lead_assignments`. The partial unique index
   `lead_assignments_one_active_holder` is Dev A's NF-07 guarantee. Read those tables; never write
   them.

7. **Prisma stays at 6.19.3.** `npm install prisma` resolves to 7.x ("Prisma Next") — a different
   product with a different migration workflow. Use `npm ci`, never a bare `npm install prisma`.

8. **Cron jobs are jobs, not requests.** My idle sweep must fire server-side even with every browser
   closed. `ENABLE_CRON=true` on exactly one process.

---

## Environment gotchas (learned the hard way)

- **Next 16 renamed `middleware.ts` → `proxy.ts`**, and with a `src/` dir it must be at
  `src/proxy.ts`. At the repo root it is silently ignored — no error, it just never runs. Confirm
  `ƒ Proxy (Middleware)` appears in `npm run build` output.
- **`server-only` throws** if imported by anything `server.ts` loads, because the custom server runs
  through tsx, not Next's bundler. Session logic is split for this reason: `session-core.ts` (no
  Next imports, safe for `socket.ts`) and `session.ts` (cookie-bound, `server-only`). Follow the
  same split for any lib the cron jobs or socket layer need.
- **shadcn here is on Base UI, not Radix — there is no `asChild`.** Use the `render` prop, or apply
  `buttonVariants()` directly to the element.
- Docker Desktop must be running before `npm run db:*`. On Windows the daemon does not auto-start.

---

## Files to read at the start of a new session

1. This file (automatic).
2. `GLOBAL.md` — Dev A's latest status + the Cross-Cutting Decisions Log.
3. `docs/dev-b-phase-prompts.md` — the prompt block for today's day number.
4. `docs/crm-b2b-build-plan.md` — if unsure how a feature should behave.
5. `.claude/CLAUDE.md` — Dev A's session log. **Not auto-loaded; open it by hand** when I need to
   know what he actually built (e.g. before consuming one of his APIs).

---

## Daily workflow

```bash
docker compose up -d                       # Postgres must be up first
git checkout main && git pull               # get Dev A's latest
git checkout -b devb/day-N-<slug>           # one branch per day
npm ci                                      # only if package-lock.json changed
npx prisma migrate dev                      # only if the schema changed
npm run dev                                 # http://localhost:3000
```

End of day: `npm run typecheck` → commit → push → merge to main → append a Session Log entry here →
update `GLOBAL.md`.

**Dev accounts** — password from `SEED_PASSWORD` (default `ChangeMe123!`):
`agent1@crm.local` … `agent5@crm.local`, `management@crm.local`, `admin@crm.local`, `hr@crm.local`

---

## Session Log

*(Newest at the bottom. One entry per session: date, what shipped, decisions, what's next.)*

### 2026-09-09 — Day 2 setup: onboarding onto Dev A's foundation

**Environment**
- Cloned `SaadAbdullaH3/crm-b2b-calls` to `D:\crm\repo`. Node v24.14.0, npm 11.9.0,
  Docker 29.7.2. `npm ci` clean (501 packages, Prisma 6.19.3 held).
- Git identity on this machine is Muhammad Saif-ur-Rehman / i220923@nu.edu.pk. Remote is **HTTPS**
  (Dev A's machine uses SSH) with Git Credential Manager — first push opens a browser login.
- Branching agreed: **one branch per day**, `devb/day-N-<slug>`, merged to main at end of day.
  Keeps main deployable and avoids a 10-day merge on Day 10.

**Read and understood before starting**
- Day 1 foundation: 24 Prisma models, session-table auth, `requireRole`/`requirePermission`,
  4 role shells, Socket.io handshake auth, 2 registered cron jobs, 33 permissions / 4 roles /
  6 dispositions / 8 users seeded.

**Gap found on arrival — Day 2 cannot start without a schema migration.** The Day 1 schema has no
table for four of Day 2's requirements:

| Missing | Needed by |
|---|---|
| `groups` + `group_members` | AD-03 (groups), CM-05 (message groups, Day 3) |
| `system_settings` | AD-06 dialer config, AD-07 time/break rules, AD-08 notifications, AD-09 reports |
| `lead_field_definitions` | AD-05 dynamic field builder → writes `leads.custom_fields` |
| `work_sessions` + `break_periods` | TM-01 screen time, TM-04 breaks (Day 4 — not added yet) |

All four sit inside Dev B territory and touch none of Dev A's tables. Agreed with Dev B to add,
migrate, and record in `GLOBAL.md`'s Cross-Cutting Decisions Log so Dev A sees it before his next
pull.

**Also flagged to Dev A:** `.claude/CLAUDE.md` is almost certainly not auto-loading (root
`CLAUDE.md` only imports `AGENTS.md`), and there is no `docs/dev-b-phase-prompts.md` — Dev A wrote
phase prompts for his track only. Created as part of this session.

**Next:** Day 2 — Admin Configuration: user CRUD, roles/permissions matrix, groups, dynamic lead
field builder, dialer settings.

### 2026-09-09 — Day 2: Admin Configuration (AD-01 through AD-07)

**Schema — 4 new tables, 29 total (was 25)**
Migration `20260909031108_day2_admin_config_groups_settings_fields`:
- `groups` + `group_members` — AD-03, and the addressing unit for Day 3's CM-05 broadcasts.
- `system_settings` — key/value + Json, so a new setting never needs a migration.
- `lead_field_definitions` + `LeadFieldType` enum — AD-05; values go in `leads.custom_fields`.

**Verified the NF-07 partial unique index survived the migration.** Dev A flagged that
`lead_assignments_one_active_holder` is hand-written SQL Prisma doesn't know about, so a migration
recreating that table would silently drop the double-assignment guarantee. Confirmed still present
via `pg_indexes`. **Re-check this after every migration.**

**Shipped**
- 11 API routes under `/api/admin/*`, every one wrapped in `requirePermission()` with an `admin.*`
  key — never `requireRole()`, so the matrix stays re-mappable at runtime.
- 6 screens: Users, Roles & Permissions, Groups, Lead Fields, Dialer Settings, Time & Breaks, plus
  a live Overview. Nav gained `/admin/groups` and `/admin/settings`.
- `src/lib/settings-catalogue.ts` (pure data) + `src/lib/settings.ts` (Prisma-backed accessors),
  split for the same reason as `session-core.ts` / `session.ts`.
- `src/lib/api.ts` — shared `ok/badRequest/notFound/conflict/parseBody`, zod on every mutating route.
- 2 new permission keys: `admin.groups.manage`, `admin.settings.manage` (35 total, was 33).
- Seed extended: 4 system groups (the SRS's CM-05 examples) + 4 default settings.

**Decisions**
1. **`system_settings` is key/value + Json, not a column per setting.** AD-08/AD-09 are still
   unbuilt; this way they need a registry entry, not a migration.
2. **Secrets are write-only.** `dialer.credentials` is stored but GET returns `value: null` and only
   `isConfigured: true`. An Admin screen has no reason to read an API secret back, and returning it
   would put the credential in every browser cache and proxy log touching that endpoint. Verified:
   the value is in Postgres, absent from the response.
3. **`lead_field_definitions.key` and `.type` are immutable after creation.** Renaming a key orphans
   every value already in `leads.custom_fields`, silently. Retire and recreate instead — DELETE is a
   soft delete (`isActive=false`) so historical leads still render.
4. **Settings seeding is create-only** while permissions/roles are still overwrite. Settings are
   runtime operational values (the TM-03 threshold above all); re-seeding must not revert them.
5. **Native `<select>` over the shadcn Select** in these forms. This build is on Base UI, whose
   Select API differs from Radix; a native element is predictable and keyboard-accessible for free.

**TM-05 — enforced in two places, verified in both**
- UI: `monitoring.*` checkboxes are disabled on the agent row with a visible reason.
- API: `PUT /api/admin/roles/[id]/permissions` rejects any `monitoring.*` key for the agent role
  with a 409, independent of what the UI sends. Confirmed by direct curl bypassing the UI.

**Lockout guards (all verified by curl)**
- Admin role cannot lose `admin.roles.manage` → 409. Without this the matrix is unreachable forever.
- An Admin cannot deactivate themselves, via PATCH or DELETE → 409.
- The last active Admin cannot be demoted or deactivated → 409.
- **Deactivating a user revokes their live sessions in the same transaction.** Verified: a
  signed-in user's `/api/auth/me` goes 200 → 401 the moment they are deactivated. Without this the
  flag only bites at next login and an already-signed-in user keeps full access.

**⚠️ Found — told Dev A in GLOBAL.md.** `prisma/seed.ts` does `rolePermission.deleteMany()` then
rebuilds from the `permissions.ts` baseline. That was harmless on Day 1, but now that AD-02 lets an
Admin re-map permissions at runtime, **re-running the seed silently discards their configuration**.
Comment added at the call site; a real fix (create-only, or a `--reset-permissions` flag) belongs in
Day 9's NFR pass.

**Verified before close of day**
- `tsc --noEmit` clean; `next build` clean, 27 routes, `ƒ Proxy (Middleware)` present.
- Agent → admin API = 403. Management → admin API = 403. No `passwordHash` in any response.
- Validation rejects: 0-minute inactivity, heartbeat longer than the idle window, unknown setting
  keys, malformed shift times, reserved field keys (`email`), bad key format, SELECT with no
  options, duplicate field keys, deleting a system group.
- All 6 screens render against live data.
- Test artifacts cleaned from the dev DB: 8 users, 4 groups (3 members), 3 settings, 0 fields.

**Next — Day 3:** Communication Module (CM-01…CM-08) + the notification pipeline Dev A consumes.
Groups exist now, so group messaging has its target. The emit helper must not import `server-only`
— the socket layer runs under tsx, not Next's bundler.

### 2026-09-09 — Day 3: Communication Module (CM-01 … CM-08) + notification pipeline

**Shipped**
- **Schema reshaped** (`day3_conversations_announcement_targeting`, 31 tables now). Replaced the
  Day 1 `thread_key` + `message_recipients` frame with a proper conversation model:
  `conversations` / `conversation_participants` / `messages`. Unread state lives on the
  PARTICIPANT (`lastReadAt`), so an unread count is one indexed comparison instead of a
  per-message join. Added `announcement_recipients`, and `ConversationType` +
  `AnnouncementAudience` enums.
- **`src/lib/notifications.ts` — the shared pipeline Dev A consumes.** `notify()` /
  `notifyMany()` persist to `notifications` and emit `NOTIFICATION_NEW`. Ten `NOTIFICATION.*`
  type constants covering all of SRS §15. Deliberately never throws into the caller: a failed
  notification must not roll back the lead assignment that triggered it.
- CM-01/04 direct messages, CM-05 group conversations (from an AD-03 group or an ad-hoc list),
  CM-02 broadcast to all/role/group/selection, CM-06 announcements with optional required
  acknowledgement + who-has-and-hasn't tracking, CM-07 read state, unread counts and in-thread
  search.
- UI: `/messages` (inbox + thread + composer + broadcast) and `/announcements`, both reachable by
  **all four roles**; notification bell in the app shell, live over Socket.io.
- `src/lib/realtime/use-socket.ts` — one shared socket per tab, ref-counted so three subscribing
  components don't open three connections.

**Decisions**
1. **A broadcast is N private DIRECT conversations, not one shared thread.** A reply to
   "update your call notes" must reach the sender only — a shared thread would turn every
   broadcast into a fifty-person group chat.
2. **Announcement audience is resolved to concrete users at publish time** into
   `announcement_recipients`. Storing only the intent ("all agents") would mean an agent hired
   next month silently joins the outstanding-acknowledgement list for an announcement predating
   them, and "who was told" would change retroactively.
3. **Non-participants get 404, not 403**, on a conversation. 403 confirms the thread exists and
   leaks who is talking to whom.
4. **No cross-user message browsing for any role, Admin included.** CM-08 requires messages to
   *retain* sender/recipient/timestamp for audit — not that an administrator can read everyone's
   private threads from the UI.
5. `socket.io-client` moved **devDependencies → dependencies**. Client code imports it; a
   production `npm ci --omit=dev` would have failed the build.

**Verified end to end (curl, real server)**
- DM: conversation created → message sent → agent1 `unread=1` → notification row with type
  `comms.message` → mark-read clears to 0 → reply → management `unread=1`. ✓
- Broadcast to `role:agent` → delivered to 5. ✓
- Announcement `ROLE:agent` + requiresAck → 5 outstanding → agent1 acknowledges → 4 outstanding /
  1 acknowledged → double-acknowledge is idempotent (200, not a constraint error). ✓
- Management sees **0** announcements from an agent-only audience (audience scoping holds). ✓
- **IDOR:** agent2 requesting agent1's conversation → `404 NOT_FOUND`. ✓
- `tsc --noEmit` clean, `npm run build` clean, `ƒ Proxy (Middleware)` present, dev log free of
  errors. NF-07 index `lead_assignments_one_active_holder` re-verified after the migration.

**For Dev A — the contract you need**
```ts
import { notify, NOTIFICATION } from "@/lib/notifications";
await notify({
  userId: agentId,
  type: NOTIFICATION.LEAD_BATCH_ASSIGNED,   // never a string literal
  title: "15 new leads assigned",
  payload: { requestId },                    // ids only; this is broadcast-adjacent
});
```
`notifyMany(userIds, {...})` for fan-out. Safe to call from cron — no `server-only` in the import
chain. `NOTIFICATION.LEAD_*` / `CALLBACK_*` / `DNC_WARNING` are already defined for your paths.

**Next — Day 4: Monitoring Engine.** Add `work_sessions` + `break_periods`; fill in the idle-sweep
cron body Dev A stubbed on Day 1; read the threshold from `monitoring.config` via
`getInactivityMs()`, never a hard-coded 5. **Re-verify the TM-05 boundary before closing the day.**

**Day 3 addendum — Sourcery review fixes (3 of 4 accepted)**

1. **Duplicate DIRECT conversations under concurrency — REAL, fixed.** `findOrCreateDirect` was
   find-then-create with no constraint, so two simultaneous requests could both insert and split a
   thread. Added `conversations.pair_key` (sorted user ids, `"idA:idB"`) with a **unique index**,
   and the helper now catches P2002 and re-reads the winner. Migration
   `day3_fix_direct_pair_key` **backfills existing rows** — without that they keep a NULL key, and
   Postgres allows unlimited NULLs in a unique index, so old DMs would still be duplicable. Same
   philosophy as Dev A's `lead_assignments_one_active_holder`: the database is the guarantee, the
   application lookup is only the fast path. **Proved with 8 concurrent requests → 1 conversation.**
2. **Mark-read swallowed in-flight messages — REAL, fixed.** The route used `now()`, so anything
   arriving between the thread GET and the read request was marked read unseen. The client now
   sends `upTo` (the newest message it actually rendered); the server clamps it to now and never
   moves `lastReadAt` backwards. A bare POST with no body still means "everything up to now".
   **Reproduced the race and confirmed the unseen message survives as unread.**
3. **`/notifications` 404 — REAL, fixed.** The bell's fallback link pointed at a route that did not
   exist, so every lead-assignment, callback, HR and system notification led nowhere. Built the
   page (full history, type/unread filters, mark-all-read) plus a "See all" link in the bell.
   Verified 200 for all four roles. This mattered more from Day 4 on, when Dev A starts emitting
   `LEAD_BATCH_ASSIGNED`.
4. **Migration destroys existing messages/announcements — NOT ACCEPTED, unreachable.** Correct in
   the abstract, but no code path wrote to `messages` or `announcements` before Day 3 — `git log -S`
   confirms `d605bc0` is the first and only commit creating either. `ADD COLUMN ... NOT NULL` on a
   non-empty table also **fails loudly** in Postgres rather than corrupting silently, so the failure
   mode described cannot occur. Backfill SQL for provably-empty tables would be dead code.
   Documented here so it isn't re-raised.

### 2026-09-10 — Day 4: Monitoring Engine (TM-01, TM-03, TM-04, TM-06)

Branch `devb/day-4-monitoring`. Pulled Dev A's Days 2–4 first (he is caught up and merged);
`npm ci` for his `exceljs` + `libphonenumber-js`; his `lead_import_rows` migration applied.
**34 tables.** Both hand-written indexes re-verified after migrating:
`lead_assignments_one_active_holder` and `conversations_pair_key_key`.

**The model, in one paragraph.** Each signed-in auth session gets one `work_sessions` row holding
three counters — active / idle / break — plus a marker (`lastHeartbeatAt`) meaning "everything
before this is already counted". Any event that could change the picture first *accrues* the
interval since the marker into the bucket the current state names, then moves the marker and
applies the transition. Time is never double-counted or lost, and a month of monitoring is a few
hundred rows instead of millions of heartbeats — a report reads counters, not an event replay.

**Shipped**
- Schema: `work_sessions` (1:1 with Dev A's `sessions`) + `break_periods`, `WorkSessionState`
  enum. Keyed to the auth session, not the user, because that already has a definite start and
  end — and it is the same lifecycle Dev A's lead-return rules hang off.
- `src/server/monitoring/engine.ts` — accrual, idle transition, breaks, session close,
  `runIdleSweep()`. No `server-only` in the import chain, so cron can call it.
- **Filled in the idle-sweep cron body Dev A stubbed on Day 1.** Two passes: stale ACTIVE →
  IDLE, and open work sessions whose auth session is revoked/expired → ENDED.
- Login/logout hooked: `startWorkSession()` / `endWorkSession()`.
- `getCurrentSessionId()` added to `src/lib/auth/session.ts` — read-only and additive. Monitoring
  measures per SESSION (two machines = two work sessions), and `SessionUser` carries no session id.
- Routes: `/api/monitoring/heartbeat`, `/break`, `/me` (agent-safe), `/live` (Management).
- UI: `<Heartbeat />` + `<BreakControl />` in the app shell, `/management/monitoring`.

**Decisions**
1. **Active time stops at the last activity, not when the sweep notices.** "No activity for 5
   minutes → Active Time stops" — those five minutes were, in hindsight, not worked. Counting
   them active would reward idling in 4-minute increments. `transitionToIdle` splits the interval
   at `lastActivityAt`.
2. **A heartbeat and an activity signal are different things.** A beat proves the tab is open; a
   locked screen beats forever. Only real input moves `lastActivityAt`, and only that prevents idle.
3. **A heartbeat during a break does NOT end the break.** Otherwise brushing the trackpad past a
   laptop silently ends someone's lunch. Breaks end deliberately.
4. **Heartbeat and break routes are `requireAuth`, self-scoped — never `requirePermission`.**
   TM-04 gives agents the break *control*; TM-05 says they hold no `monitoring.*` key. Both hold
   because the routes act only on the caller's own session and never accept a userId. Creating a
   `monitoring.break.self` key would have tripped my own AD-02 guard.
5. **Productivity excludes break from the denominator** (active ÷ (active + idle)). A sanctioned
   break should not read as unproductive, or the number just punishes taking one.
6. **`breakMinutesUsedToday` removed from the agent route after I first wrote it.** TM-05 names
   "Break/Pause Time" explicitly. `/api/monitoring/me` now returns only: on-break flag, current
   break's start timestamp, and the two configured limits (rules, not measurements). See the open
   question below.

**Verified against a running server, cron included**
- Login creates a work session; heartbeat with activity keeps ACTIVE.
- **Idle sweep fired from cron with no browser open** — the whole point of TM-03. Precise accrual
  test: `lastHeartbeatAt` −10min, `lastActivityAt` −8min → **active_ms exactly 120000** (the 2-min
  gap) and idle accruing from the last activity. `idle_count` 1. Log: `idle sweep: 1 marked idle`.
- Resume: heartbeat with activity → ACTIVE, `resumed: true`.
- Break: start → BREAK + open period; double-start → 409; heartbeat stays BREAK; end → ACTIVE,
  `break_ms` == `duration_ms`, reason kept, `auto_closed` false.
- **Closed-laptop case:** auth session revoked without a logout → sweep pass 2 closed the work
  session. Log: `0 marked idle, 1 work session(s) closed`.
- Logout → ENDED with `ended_at` and final counters intact.
- TM-06: `session.login`, `session.logout`, `monitoring.idle.start/end`, `monitoring.break.start/end`
  all written to `activity_events`.
- **TM-05, both layers:** agent and HR → `/api/monitoring/live` = 403; `/management/monitoring` =
  307 → `/403`; management = 200. Agent's resolved permission set still holds **zero**
  `monitoring.*` keys. Agent route payload contains no active/idle/break/productivity value.
- `tsc --noEmit` clean, `npm run build` clean, `ƒ Proxy (Middleware)` present, dev log error-free.

**OPEN QUESTION for the call-centre owner** (pair it with Dev A's `returnNoAnswerOnLogout`):
should an agent be able to see how much break they have used today? TM-05 lists "Break/Pause Time"
as Management-only, so the strict reading — what is built — hides it. The cost is that an agent
can only overrun their allowance by accident. A one-line change to `/api/monitoring/me` if they
say yes.

**Deferred, as pre-agreed:** TM-02 desktop workstation/application monitoring is #1 on GLOBAL.md's
Scope Watch. CRM screen time + idle detection is built and needs no desktop install.

**Next — Day 5: HR Module.** `work_sessions` now exists, so HR-04's attendance view has real data
to read.

**Day 4 addendum — Sourcery review fixes (4 of 5 accepted)**

1. **Stale-ACTIVE + `hadActivity:true` booked the whole gap as active — REAL, fixed.** Only the
   no-activity path checked staleness. If the window had already elapsed and input arrived before
   the sweep caught it (server restart, machine resumed from sleep), the entire gap accrued as
   ACTIVE — exactly the "reward idling in four-minute increments" failure this module exists to
   prevent. Both paths now share one `splitStaleInterval()`. **Reproduced:** marker −10 min,
   activity −8 min → **120s active / 480s idle**, where the old code gave 600s active.
2. **Read-then-increment race between heartbeats and the sweep — REAL, fixed.** The counters were
   atomic increments, but the delta was computed from a stale snapshot and `lastHeartbeatAt` /
   `state` were last-write-wins, so an overlap double-counted and could clobber a transition. Every
   mutation now runs inside `withLockedSession()` (`SELECT … FOR UPDATE`, same idiom as Dev A's
   assignment transaction). **Reproduced:** 10 concurrent heartbeats against a 60s-old marker →
   **60s accrued once**, not up to 600s.
3. **Concurrent `startBreak` — REAL, fixed.** State was checked before the transaction, so two
   requests could both open a break period; `endBreak` closes only the newest, orphaning the other
   forever. The check now happens under the lock. **Reproduced:** 8 concurrent starts → 1 success,
   7×409, exactly one break row, `break_count` 1.
4. **Expiry sweep closed at sweep time, not termination time — REAL, fixed.** Time between an auth
   session actually dying and the next cron tick accrued as idle, and an open break's duration was
   inflated to match. A minute in normal running — but a whole night after an outage, which would
   wreck a punctuality report. `endWorkSession()` now takes an `endAt`, and the sweep passes
   `revokedAt`/`expiresAt`. **While fixing this I found a gap in my own fix:** pass 1 (idle) didn't
   exclude already-dead sessions, so it pushed the marker past the termination time and defeated
   the cap. Pass 1 now skips them. **Reproduced:** marker −20 min, expired −10 min → `ended_at`
   exactly equals `expires_at` (delta 0) and **600s accrued, not 1200s**.
5. **INTEGER overflow on the ms counters — NOT ACCEPTED as written.** Real arithmetic (INTEGER caps
   at 24.86 days) but unreachable: a work session is 1:1 with an auth session, and
   `SESSION_TTL_HOURS` is 8, so one bucket holds at most ~28.8M ms against a 2.1B limit. Reaching
   it needs a 600-hour TTL. Migrating to `BigInt` would also have rippled into JSON serialization
   (`BigInt` does not `JSON.stringify`) across the engine and the live route — real breakage risk
   for an unreachable bug. **The underlying danger is a bogus delta, not a long shift**, and BigInt
   would only have raised the ceiling on the garbage. Added `MAX_ACCRUAL_MS` (24h) instead: any
   single accrual beyond that is clamped and logged, which catches clock jumps, hibernation and
   multi-day outages — and incidentally makes overflow impossible.

Regression after all four: break lifecycle, heartbeat-during-break, TM-05 at both layers, agent
payload still metric-free, logout close. `tsc` + build clean, dev log free of errors and clamp
warnings.
