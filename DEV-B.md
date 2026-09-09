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
