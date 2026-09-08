# CLAUDE.md — Dev A (Saad) Session Memory

This file is **Dev A's private context file** for Claude Code in this repo. It is read automatically at the start of every Claude Code session in this folder. Its job is to give a fresh session everything it needs to keep working without re-explaining the project, and to accumulate a running log of what's actually been built so nothing gets re-explained or re-decided twice.

**Update rule: at the end of every work session (or every time a meaningful decision is made mid-session), append a new dated entry to the "Session Log" section at the bottom — never delete prior entries, only add.** Also update your row in `../GLOBAL.md` (outside this folder) so Dev B can see status without reading this file.

---

## Project

CRM — B2B Calls: a production-grade, web-based CRM for a B2B call center. Full spec and feature correlation live in `../docs/crm-b2b-build-plan.md`. Day-by-day prompts for this role live in `../docs/dev-a-phase-prompts.md`.

## Stack

- **Framework:** Next.js, App Router, TypeScript, custom Node server (for Socket.io + cron — do not deploy to Vercel, this app needs a persistent process)
- **DB:** PostgreSQL via Prisma ORM
- **Realtime:** Socket.io attached to the custom server
- **Styling/UI:** Tailwind CSS + shadcn/ui
- **Background jobs:** `node-cron` (5-minute lead auto-assign timer, 5-minute idle sweep — these must run server-side, never as a browser `setTimeout`)
- **Deployment:** self-hosted VPS, Nginx reverse proxy, PM2 or Docker

## My ownership (Dev A — "Core Calling Pipeline")

- Lead Import Engine (dynamic Excel mapping, duplicate detection, validation summary, import history)
- Lead Assignment Engine (preset/custom quantity requests, 5-minute approval/auto-assign, transactional locking, logout-return rule, reassignment with history)
- Agent Calling Workspace (Call List, VC Dialer handoff / clipboard fallback, the 6 required dispositions, callback scheduling)
- Agent Dashboard (operational stats only — **never** show Active/Idle/Break/Productivity, those are Dev B's Management-only metrics)
- Search/Lead Timeline/Assignment History (SF-01 through SF-04)
- VC Dialer integration (real API once available; clipboard fallback is mandatory regardless)

Dev B owns: Admin Configuration, Management Console, Monitoring Engine, HR Module, Communication Module, Reporting Engine, Audit Log. Don't build in that territory — coordinate through `../GLOBAL.md` if something crosses the line (e.g., I consume Dev B's notification/Socket.io events for lead-assignment alerts).

## Key architectural rules to not violate

- **Lead locking is a status + `assigned_to` + `locked_at` column on the `leads` table, not a separate lock table.** Wrap every assignment write in a DB transaction — this is the #1 place a race condition (double-assignment) can sneak in (NF-07).
- **The 5-minute auto-assign timer is a server-side job, not a UI countdown that "does" the assignment.** The UI countdown is cosmetic; the actual auto-assign must fire from a cron/queue job even if no browser tab is open.
- **Agent dashboard must never render Active Time, Idle Time, Break/Pause Time, or Productivity %** (TM-05). If a shared component from Dev B's Monitoring Engine exposes these, do not import them into any Agent-role screen.
- **U.S. phone format validation only — never attempt to verify the number is live/reachable** (LM-05, explicitly out of scope).
- **RBAC check at the API-route level**, using the shared `requireRole()`/`requirePermission()` middleware — don't re-implement per-screen checks.

## Files to read at the start of a new session

1. This file, fully (you're already doing that).
2. `../GLOBAL.md` — check Dev B's latest status and any Cross-Cutting Decisions that might affect shared schema/contracts.
3. `../docs/crm-b2b-build-plan.md` — the day you're on, and the feature-correlation table if unsure how a feature should behave.
4. `../docs/dev-a-phase-prompts.md` — the prompt block for today's day number.

---

## Session Log

*(Newest entries at the bottom. One entry per session: date, what shipped, decisions made, what's next.)*

### 2026-09-08 — Project scaffolding
- Project folder created: `crm-b2b-calls/` with `docs/`, `.claude/`, and root `GLOBAL.md`.
- Build plan imported to `docs/crm-b2b-build-plan.md`.
- Day-by-day prompts written to `docs/dev-a-phase-prompts.md`.
- Stack confirmed with Dev B: Next.js + Postgres + Prisma + Socket.io, self-hosted.
- Day 1 not yet started — next session should open with the Day 1 prompt.
