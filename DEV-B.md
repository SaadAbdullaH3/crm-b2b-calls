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
