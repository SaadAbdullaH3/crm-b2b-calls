# CRM — B2B Calls — Global Project Tracker

This file lives at the **project root** (outside `.claude/`) and tracks progress for **both developers**. Unlike `.claude/CLAUDE.md` (which is Dev A's private session memory for Claude Code), this file is the shared source of truth both of you update and both of you read before starting a new day.

**Rule: update the relevant row in the table below at the end of every work session, on both machines.** Keep entries short — one line of what shipped, one line of what's blocking, nothing more. Full detail belongs in each dev's own `.claude/CLAUDE.md`, not here.

---

## Project

- **Name:** CRM — B2B Calls (web-based CRM for a B2B call center)
- **Repo:** `git@github.com:SaadAbdullaH3/crm-b2b-calls.git` (public). Day 1 foundation is pushed — **Dev B clones this rather than rebuilding Day 1.** First-time setup: `cp .env.example .env && docker compose up -d && npm ci && npx prisma migrate dev && npm run db:seed && npm run dev`. Use `npm ci`, not `npm install`, so the lockfile pins hold (notably Prisma 6.19.3).
- **Spec:** `docs/crm-b2b-build-plan.md` (feature correlation + 10-day plan) — original SRS was `CRM_B2B_Calls_Final_Requirements.docx`, v1.0
- **Stack:** Next.js (App Router, custom server) + TypeScript + PostgreSQL + Prisma + Socket.io + Tailwind/shadcn
- **Deployment target:** self-hosted VPS (not Vercel) — Nginx + PM2/Docker
- **Timeline:** 10 working days
- **Team:** Dev A = Saad — "Core Calling Pipeline". Dev B = teammate — "Ops & People Console".
- **VC Dialer API status:** ⚠️ unconfirmed as of plan creation — assumed NOT available; clipboard fallback is being built first. Update this line the moment it's confirmed either way, since it affects Day 5 and Day 9 for Dev A.

---

## Day-by-Day Status

| Day | Dev A (Saad) — Core Calling Pipeline | Status | Dev B (Teammate) — Ops & People Console | Status | Blockers / Notes |
|---|---|---|---|---|---|
| 1 | Shared: repo scaffold, Prisma schema, Postgres setup, Auth/RBAC middleware, base layouts, Socket.io skeleton, seed 8 users | **Done (Dev A)** — 25 tables migrated, auth + RBAC live, 4 role shells, 8 users seeded, Socket.io + cron running | Shared foundation reused, not rebuilt — Dev B clones the repo and runs the setup in the Project section above | In progress (Dev B setting up) | Day 1 shipped by Dev A and pushed 2026-09-09; Dev B skips rebuilding it so both tracks can start Day 2 in parallel. **Use `npm ci`** — a fresh `npm install prisma` resolves to 7.x, which is a different product. |
| 2 | Lead Import Engine: upload, column mapping, parsing, duplicate detection, phone-format validation | Not started | Admin Configuration: user CRUD, roles/permissions, groups, dynamic field builder, dialer settings | Not started | |
| 3 | Import: validation summary, error export, import history, lead source tagging. Start Lead Assignment: request UI | Not started | Communication Module: DMs, groups, broadcasts, announcements, notification schema + Socket.io wiring | Not started | |
| 4 | Lead Assignment: approval screen, 5-min auto-assign cron, transactional locking, logout-return, manual assign/reassign | Not started | Monitoring Engine: screen time, idle detection, break/pause control, activity event capture | Not started | |
| 5 | Agent Calling Workspace: Call List, Call button/clipboard fallback, disposition modal, callback scheduling | Not started | HR Module: employee profiles, documents+metadata, leave/holiday workflow, HR comms | Not started | |
| 6 | Agent Dashboard (no mgmt-only metrics), Do-Not-Call protection, Lead Timeline/Assignment History | Not started | Management Dashboard: KPIs, agent drill-down, approval queue, call recording access | Not started | |
| 7 | Reporting Engine — backend aggregation queries | Not started | Reporting Engine — frontend UI, exports, Management Score | Not started | |
| 8 | Audit & History: log capture, before/after diffing | Not started | Global Search/Filters, notification wiring, audit-log search UI | Not started | |
| 9 | VC Dialer real integration (or harden fallback), race-condition testing | Not started | NFR pass: HTTPS/sessions/hashing/validation/backups | Not started | |
| 10 | Shared: regression vs. 27 Acceptance Criteria, permission boundary testing | Not started | Shared: deployment, seed accounts, smoke test, handover | Not started | |

---

## Cross-Cutting Decisions Log

*(Append here whenever a decision affects both devs — schema changes, shared API contracts, naming conventions, library choices made mid-sprint. One line each, dated.)*

- 2026-09-08 — Stack finalized: Next.js + Postgres + Prisma + Socket.io, self-hosted VPS. (both devs agreed)
- 2026-09-08 — Split confirmed: Saad = Dev A (Core Calling Pipeline), teammate = Dev B (Ops & People Console).
- 2026-09-09 — **Lead locking model finalized (Dev A).** Current owner lives on `leads` (`status` / `assigned_to_id` / `locked_at` / `current_assignment_id`); `lead_assignments` is append-only history where `released_at IS NULL` marks the current holder. A hand-written **partial unique index** `lead_assignments_one_active_holder` makes a second open assignment impossible at the database level. It lives in the migration SQL because Prisma cannot express it — **do not drop it, and re-add it if a future migration ever recreates that table.**
- 2026-09-09 — **Auth = server-side `sessions` table + httpOnly cookie** (not stateless JWT). Logout and expiry are therefore real server-side events, which both LA-09 (return uncalled leads on logout) and the Monitoring Engine (screen time) depend on. Only the SHA-256 hash of the session token is stored.
- 2026-09-09 — **RBAC contract:** `requireRole()` / `requirePermission()` / `requireAuth()` in `src/lib/auth/rbac.ts`, applied at the API-route level. Permission keys and the default role matrix live in `src/lib/auth/permissions.ts` (33 keys). Prefer permission keys over role names so Admin can re-map at runtime. Page guards in `src/lib/auth/guard.ts` are UX only, never the boundary.
- 2026-09-09 — **Socket.io event contract lives in `src/lib/realtime/events.ts`** — both devs import from it, no string literals in routes. Path `/api/socket`, authenticated on the handshake, rooms `user:<id>` and `role:<name>`. Dev B: the `REQUEST_SUBMITTED` payload is already defined there for your Day 3 notification wiring — change it in that file, not locally.
- 2026-09-09 — **Prisma pinned to 6.19.3.** `npm install prisma` now resolves to 7.x ("Prisma Next"), a redesigned product with a different migration workflow (contracts, db signing). Both devs stay on 6.19.3 for this sprint.
- 2026-09-09 — **Next.js 16 note:** `middleware.ts` is renamed `proxy.ts`, and with a `src/` directory it must sit at `src/proxy.ts`. At the repo root it is silently ignored — no error, it just never runs.
- 2026-09-09 — **Dev B owns the final shape of these 9 framed tables** (drafted thin by Dev A on Day 1 only so the schema compiles): `messages`, `message_recipients`, `announcements`, `announcement_acknowledgements`, `hr_employees`, `hr_documents`, `leave_requests`, `reports_generated`, `management_scores`. Reshape freely. **Please coordinate before changing** `audit_log`, `notifications` or `activity_events` — Dev A writes to those from Day 3 / Day 8.
- 2026-09-09 — **Tables added beyond the original Day 1 list:** `sessions` (required by the auth model), `lead_requests` (LA-02/03 needs somewhere to record a request; your Day 6 approval queue reads it), `calls` (per-call capture — `dispositions` is the config lookup table, not the event), `role_permissions` (join table).

---

## Scope Watch (from the build plan's honest scope warning)

If time gets tight near Day 9–10, these are the pre-agreed items to stub/defer first — don't cut anything else without flagging it here first:

1. Desktop workstation activity/screen-content monitoring — keep CRM screen-time + idle detection only.
2. 15-Day and Custom report types — ship after Daily/Weekly/Monthly/Punctuality.
3. Message file/document attachments — text messaging first.
4. Report scheduling — manual generation first.
