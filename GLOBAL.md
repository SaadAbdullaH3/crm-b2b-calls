# CRM — B2B Calls — Global Project Tracker

This file lives at the **project root** (outside `.claude/`) and tracks progress for **both developers**. Unlike `.claude/CLAUDE.md` (which is Dev A's private session memory for Claude Code), this file is the shared source of truth both of you update and both of you read before starting a new day.

**Rule: update the relevant row in the table below at the end of every work session, on both machines.** Keep entries short — one line of what shipped, one line of what's blocking, nothing more. Full detail belongs in each dev's own `.claude/CLAUDE.md`, not here.

---

## Project

- **Name:** CRM — B2B Calls (web-based CRM for a B2B call center)
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
| 1 | Shared: repo scaffold, Prisma schema, Postgres setup, Auth/RBAC middleware, base layouts, Socket.io skeleton, seed 8 users | Not started | (same, shared) | Not started | |
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

---

## Scope Watch (from the build plan's honest scope warning)

If time gets tight near Day 9–10, these are the pre-agreed items to stub/defer first — don't cut anything else without flagging it here first:

1. Desktop workstation activity/screen-content monitoring — keep CRM screen-time + idle detection only.
2. 15-Day and Custom report types — ship after Daily/Weekly/Monthly/Punctuality.
3. Message file/document attachments — text messaging first.
4. Report scheduling — manual generation first.
