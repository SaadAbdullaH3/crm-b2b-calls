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

### 2026-09-09 — Day 1: Shared foundation (scaffold, schema, auth, RBAC, layouts, seed)

**Shipped**
- Next.js **16.3.4** (App Router, TS, Tailwind v4, `src/`) + React 19.2.8, scaffolded into the existing docs folder.
- Custom server `server.ts` (run via `tsx`, not `next start`) owning all three long-lived concerns: Next request handler, Socket.io, node-cron. Graceful SIGTERM/SIGINT shutdown.
- Socket.io at path `/api/socket`, authenticated **on the handshake** via the same session cookie; sockets join `user:<id>` and `role:<name>` rooms. Verified: no cookie → rejected, bogus cookie → rejected, valid session → connected.
- `node-cron`: 2 jobs registered and ticking (lead auto-assign sweep, idle sweep), both no-op bodies until Day 4. Guarded by `ENABLE_CRON` — must be true on exactly ONE process under PM2 cluster.
- Postgres 16 via `docker-compose.yml` (`crm_b2b`, volume `pgdata`). **25 tables**, one migration applied.
- Auth: server-side `sessions` table + httpOnly cookie; token is random 32 bytes, only its SHA-256 hash is stored. bcryptjs cost 12. Login is timing-equalised and returns one generic error so the form can't enumerate accounts.
- `requireRole()` / `requirePermission()` / `requireAuth()` in `src/lib/auth/rbac.ts` — the single API-level RBAC boundary. Page-level guards in `src/lib/auth/guard.ts` are UX only.
- Role-gated shells for `/agent`, `/management`, `/admin`, `/hr` + `/login` + `/403`. shadcn/ui installed (11 components).
- Seed: 33 permissions, 4 roles, 6 system dispositions, **8 users** (5 Agent, 1 Management, 1 Admin, 1 HR). Idempotent. Dev password from `SEED_PASSWORD`.

**Decisions made (all confirmed with Saad before building)**
1. **Lock model** — denormalized ownership on `leads` (`status` / `assigned_to_id` / `locked_at` / `current_assignment_id`) for fast reads + append-only `lead_assignments` for history, and a **partial unique index** as the hard guarantee.
2. **Postgres** — local Docker per dev; only migrations are shared.
3. **Auth** — DB session table, not stateless JWT, so logout/expiry are real server-side events (LA-09 + Dev B's monitoring need this).
4. **Dev B's tables** — framed thin with correct FKs, theirs to reshape. `audit_log` / `notifications` / `activity_events` built properly since Dev A writes to them.
5. **Prisma pinned to 6.19.3.** `npm install prisma` now resolves to **7.x ("Prisma Next")**, which replaces the whole workflow (contracts, db signing, `prisma db update`) and has almost no community material yet. Not a risk worth taking on a 10-day deadline. **Do not let a future `npm update` drift this to 7.**

**THE ASSIGNMENT TRANSACTION RECIPE — Day 4 must follow this exactly**
Inside a single `prisma.$transaction`:
1. `SELECT ... FROM leads WHERE status='AVAILABLE' AND do_not_call=false ... FOR UPDATE SKIP LOCKED LIMIT n`
   — `SKIP LOCKED` is what lets two agents request simultaneously without blocking each other; they simply get different rows.
2. `INSERT` one `lead_assignments` row per lead (`released_at` NULL).
3. `UPDATE leads` setting `status`, `assigned_to_id`, `locked_at`, `current_assignment_id`.
Releasing ownership is the mirror image: set `released_at` + `release_reason` on the open row, then null out the lead's ownership columns. **Never** update any other column on an existing `lead_assignments` row, and never delete one.
If step 2 ever produces a second open row for a lead, Postgres rejects the write via `lead_assignments_one_active_holder` — that index is the backstop, not the primary mechanism.

**Verified before close of day**
- Partial unique index proven in psql: 1st assignment OK → 2nd open assignment for same lead **rejected** (`duplicate key ... lead_assignments_one_active_holder`) → release then reassign OK → history intact, exactly one open holder.
- All 4 roles log in and land on their own section; each is 307'd to `/403` from the other three; unauthenticated → `/login?next=...`.
- Logout writes `revoked_at`; `/api/auth/me` returns 401 afterwards.
- Agent's resolved permission set contains **no `monitoring.*` keys** (TM-05 boundary holds at the data layer, not just the UI).
- `npm run build` clean, `tsc --noEmit` clean.

**Gotchas hit — worth knowing before Day 2**
- **Next 16 renamed `middleware.ts` → `proxy.ts`**, and with a `src/` directory it must be at **`src/proxy.ts`**, not the repo root. At the root it is silently ignored — no error, it just never runs. Confirm it appears as `ƒ Proxy (Middleware)` in `npm run build` output.
- `server-only` throws if imported by anything the custom server loads, since `server.ts` runs through tsx rather than Next's bundler. Session logic is therefore split: `session-core.ts` (no Next imports, safe for `socket.ts`) and `session.ts` (cookie-bound, `server-only`).
- This shadcn build is on **Base UI**, not Radix — there is no `asChild`; use the `render` prop or apply `buttonVariants()` to the element directly.
- `npm audit` reports a high-severity `deepmerge-ts` advisory reaching us through the **Prisma CLI** (devDependency only, not in the app runtime). The offered fix downgrades Prisma to 6.12. Left as-is deliberately; revisit on Day 9's NFR pass.
- `package.json#prisma` is deprecated in favour of `prisma.config.ts`. Harmless on 6.x; left alone rather than risking the config file's different `.env` loading behaviour mid-setup.

**Next session — Day 2:** Lead Import Engine part 1 (LM-01/02/04/05): Excel upload, dynamic column mapping, duplicate detection, U.S. phone **format** validation only. Check `GLOBAL.md` first — Dev B's Day 2 dynamic-field builder feeds `leads.custom_fields`; stub it if not ready.

**End-of-day addendum (2026-09-09)**
- Day 1 pushed to `git@github.com:SaadAbdullaH3/crm-b2b-calls.git` (public repo, Saad's call). Two commits: `379f59e` docs baseline, `dde93e2` Day 1 foundation. 72 files; `.env` correctly untracked, only `.env.example` published.
- **Remote uses SSH, not HTTPS.** GitHub no longer accepts password auth over HTTPS and `gh` CLI isn't installed on this machine; the existing key at `~/.ssh/id_ed25519` already authenticates as SaadAbdullaH3. If a future session sees "Password authentication is not supported", the remote has been reset to HTTPS — switch it back with `git remote set-url origin git@github.com:SaadAbdullaH3/crm-b2b-calls.git`.
- **Dev B is NOT rebuilding Day 1.** They clone this repo and run the setup block in GLOBAL.md's Project section. That means the schema, RBAC middleware and Socket.io event contract are now genuinely shared code — a breaking change to any of them is a coordination event, not a local edit. Same rule as before: their 9 framed tables are theirs; `audit_log` / `notifications` / `activity_events` need a heads-up first.
- Local dev server stopped at end of session; the Postgres container is left running (`restart: unless-stopped`). `docker compose down` if the port is needed.
- Not built, deliberately: an SRS requirements-traceability doc mapping the ~150 numbered requirements and the 27 acceptance criteria to build days. Nothing in the repo tracks that yet, and Day 10 is a full regression against exactly that list — worth creating before then. Raised with Saad on Day 1; deferred, not forgotten.
