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

### 2026-09-09 — Day 2: Lead Import Engine, part 1 (LM-01/02/04/05)

Branch `deva/day-2-lead-import`. Adopted Dev B's convention: one branch per day, merged to main at end of day.

**Synced with Dev B first**
- Pulled 8 commits (their Day 2 Admin Config + Day 3 Communication). `npm ci` as they asked — `socket.io-client` moved to runtime deps.
- `npx prisma migrate dev` applied their 3 migrations. **31 tables before my work, 32 after.** NF-07 index `lead_assignments_one_active_holder` re-verified present after every migration, theirs and mine.
- Re-seeded for their 2 new permission keys (35 total). Safe here because this database's permission matrix was never customised through AD-02 — their warning about re-seeding still stands generally.
- Their `notify()` / `NOTIFICATION.*` pipeline is confirmed ready for my Day 4. Import chain is clean of `server-only`, so it is genuinely callable from the auto-assign cron.

**Shipped**
- `lead_import_rows` table (new, mine): every parsed row stored with a verdict, plus `resolution` for Day 3's LM-06 decisions and `duplicate_of_lead_id` / `duplicate_of_row_number`. **Nothing is ever discarded during analysis** — the row survives with its issues, which is what LM-04 requires and what Day 3's error export reads.
- `detectedColumns` added to `lead_imports`.
- `src/lib/import/` — `phone.ts` (libphonenumber-js, U.S. format only), `parse.ts` (exceljs), `target-fields.ts` (mapping targets + header auto-suggestion), `load-targets.ts`, `analyze.ts` (validation + duplicate detection).
- API: `POST/GET /api/leads/imports`, `GET /api/leads/imports/[id]`, `POST /api/leads/imports/[id]/mapping`.
- UI: `/management/imports` (upload + history) and `/management/imports/[id]` (column mapper), reusing Dev B's `PageHeader`/`NativeSelect`/`EmptyState`/`ErrorNote`/`api` helpers.
- `scripts/make-import-fixture.mjs` — generates a messy 11-row .xlsx covering every validation branch. Day 3 will want it.

**Design decisions**
1. **The AD-05 contract is the TABLE, not the HTTP route.** `GET /api/admin/fields` requires `admin.fields.manage`, which Management does not hold — and Management is who runs imports. So `load-targets.ts` reads `lead_field_definitions` through Prisma directly. Same contract (the field `key`), no permission mismatch, no self-HTTP hop. Flagged to Dev B in GLOBAL.md.
2. **Duplicate matching splits person-level from organisation-level identifiers.** Phone and email are strong (either alone = duplicate). Company name and website are organisation-level and only count *paired with a matching contact name*. Found this the hard way: with website treated as strong, "Karen Fields at Acme" was flagged as a duplicate of "John Smith at Acme" purely because they share a company website — which would suppress exactly the multi-contact-per-company leads the client is paying to call. Contact name alone is also insufficient (every "John Smith").
3. **Unmapped required field = import-level warning, not a per-row flag.** Flagging all 5,000 rows because a required custom field wasn't mapped makes the import look broken. The mapper warns at mapping time instead. A mapped-but-blank required field *does* flag its row.
4. **Analysis re-reads the stored .xlsx** rather than trusting row data from the browser. The client only ever sends the mapping.
5. Re-mapping deletes and rebuilds that import's rows — a stale verdict from a previous mapping would corrupt Day 3's counts.

**Verified end to end** (11-row fixture, per-row verdicts checked in psql)
- Auto-suggestion mapped all 7 messy headers correctly.
- Phone duplicate detected across formatting: `(415) 555-0132` ≡ `+1 415 555 0132`.
- Company duplicate across legal suffix: `Globex, Inc.` ≡ `Globex Inc`.
- Different contact at same company → correctly NOT a duplicate.
- Numeric Excel phone cell (`3125550142`) parsed; UK `+44` rejected as non-U.S.; trailing blank rows excluded from the count.
- Duplicate against an **existing DB lead** confirmed separately (`duplicate_of_lead_id` set, matched on all 5 fields).
- Admin-created dynamic field appeared as a mapping target and its required-blank row was flagged.
- RBAC: agent 403 on upload and on history; unauthenticated 401; agent 307 → /403 on the page.
- **Zero rows written to `leads`** — correct, that is Day 3.
- Error paths: non-.xlsx, corrupt .xlsx, field mapped twice, unknown target — all 400 with usable messages.

**Bug found and fixed in shared code:** `<Toaster />` was never mounted, so every `toast()` call in the app — including all six of Dev B's Day 2 Admin screens — was a silent no-op. Added to `src/app/(app)/layout.tsx` (my Day 1 file). Told Dev B.

**Known issue, not mine to fix alone:** `npx eslint src` reports 13 errors — 11 pre-existing in Dev B's client components (`react-hooks/set-state-in-effect` on the standard `useEffect(() => { void load() })` loader, plus a ref-during-render in `use-socket.ts`), and 2 in my two new client components which follow the same house pattern. `next build` and `tsc --noEmit` are both clean. Fixing only mine would make two files diverge from nine siblings, so this is logged in GLOBAL.md as a shared cleanup for Day 9's NFR pass.

**Next session — Day 3:** finish the import engine (LM-03 validation summary screen, LM-06 per-duplicate resolution, LM-07 error export, LM-08 source tagging, LM-09 import history) and start the Lead Assignment Engine request UI (LA-02/03). The `lead_import_rows` verdicts and `resolution` column are already in place for all of it. Coordinate the `request:submitted` event shape with Dev B — it is already defined in `src/lib/realtime/events.ts`.

### 2026-09-09 — Day 3: Import Engine finished (LM-03/06/07/08/09) + Lead Requests started (LA-02/03)

Branch `deva/day-3-import-finish-assignment-start`. Nothing new from Dev B to pull — their Day 3 was already merged before this session, so the "coordinate the notification contract with Dev B" step in the Day 3 prompt was already settled: their pipeline is live and I consumed it as-is.

**Part 1 — Lead Import Engine, finished**
- `src/lib/import/commit.ts` — the ONLY place the import engine writes to `leads`. Rows become leads per: READY → create; DUPLICATE + KEEP_BOTH → create; DUPLICATE + UPDATE_EXISTING → merge; REJECT / MANUAL_REVIEW → skip; MISSING_INFO / INVALID_PHONE / INVALID → skip and report.
- `src/lib/import/report.ts` — LM-07 validation report as .xlsx (Summary sheet + per-row sheet with plain-English reasons). Excel not CSV, because the person fixing the data opens it beside the original and CSV mangles phone numbers.
- Routes: `GET .../rows`, `POST .../resolutions` (single + `applyToAllPending`), `POST .../commit`, `GET .../report`.
- `/management/imports/[id]/review` — LM-03 summary tiles, per-duplicate decision selects, bulk apply, source label, report download, commit.
- LM-08 enforced at commit, not upload: an import cannot become leads without a source/campaign label.
- LM-09 import history already existed from Day 2; the review screen completes it.

**Part 2 — Lead Assignment Engine, started**
- `POST/GET /api/leads/requests` (LA-02/03). `autoAssignAt` is stamped at creation, so the Day 4 sweep queries a column rather than relying on a timer surviving a restart.
- `/agent/request-leads` — presets 15/30 fill the quantity field (they don't submit), plus free-text quantity, plus a cosmetic countdown.
- `/management/requests` — live queue, refreshes on the `REQUEST_SUBMITTED` socket event.
- One PENDING request per agent, enforced server-side. Without it an agent could queue several and have Day 4's job hand them several batches at once, draining the pool from everyone else.
- Added `assignment.config` to Dev B's settings registry (`autoAssignMinutes: 5`, `presetQuantities`, `maxRequestQuantity: 100`) + `getAutoAssignMs()`. Uses their sanctioned mechanism — a registry entry, not a migration — and `getSetting` falls back to the catalogue default, so no re-seed is needed. **Day 4 must read this, not hard-code 5 minutes.**

**TWO REAL BUGS FOUND AND FIXED — both were silent**

1. **Socket emits from API routes never reached anyone.** `src/server/socket.ts` held the Socket.io instance in a module-level `let`. `server.ts` runs through tsx and imports that file directly; Next bundles its own separate copy for route handlers. Two modules, two bindings — the custom server set one, every `getIO()` inside a route read the other and got `null`. Emits vanished with no error, and the handshake still worked, so it looked healthy. **This silently broke Dev A's session + lead-request events AND every `notify()` push behind Dev B's notification bell.** Fixed by parking the instance on `globalThis`. Verified: a management socket now receives both `notification:new` and `request:submitted`. Note this requires a dev-server restart to take effect — `socket.ts` is not hot-reloaded, since tsx loads it outside Next.

2. **Duplicate matching picked an arbitrary lead when several matched.** `fetchCandidates` had no ORDER BY and the matcher took the first hit. With two leads sharing a phone number, a row that matched one of them on all five fields merged into the other, which matched on phone alone — non-deterministic and wrong. Fixed with `ORDER BY created_at ASC, id ASC` plus a `bestMatch()` that scores candidates by number of matched fields and tie-breaks on the oldest. Caught only because the UPDATE_EXISTING test asserted on which lead changed.

**Merge safety (verified, matters for Day 4):** `UPDATE_EXISTING` merges only non-empty incoming fields and **never touches `assigned_to_id`, `locked_at`, `current_assignment_id` or `do_not_call`.** Proven with a lead that was ASSIGNED + DNC before the merge: data updated, ownership and the DNC flag survived. An import must not steal a lead from an agent mid-call or silently un-suppress a Do-Not-Call contact.

**Verified end to end**
- Full lifecycle: upload → map → analyse → resolve → commit. 11-row fixture → 7 leads created, 4 skipped; re-import with UPDATE_EXISTING → 0 created, 7 updated, lead count unchanged.
- Commit blocked without a source label (400) and with unresolved duplicates (409).
- Report downloads as real .xlsx with correct MIME + filename; two sheets; reasons render.
- Leads land AVAILABLE and unassigned, phones E.164-normalised (including numeric Excel cells), emails lowercased, websites host-normalised, source label applied.
- Requests: preset → PRESET_15, second pending → 409, over-max → 400, management → 403 (no `leads.request`), agent sees only their own, notification reached both approvers.
- Review screen rendered in a real browser against live data.
- Build + typecheck clean. Lint: 16 errors, all the same two pre-existing classes (15 `set-state-in-effect`, 1 `refs`) — 3 more than Day 2 because my 3 new client components follow the same house pattern. Still logged as a joint cleanup for Day 9.

**Next session — Day 4:** the correctness-critical day. Approval screen, the 5-minute auto-assign cron (read `getAutoAssignMs()`), transactional locking, logout-return (LA-09) and retained-follow-up (LA-10), manual assign/reassign. The assignment transaction recipe is in the Day 1 entry above — `FOR UPDATE SKIP LOCKED`, insert assignment row, update lead ownership, all in one transaction. There are now real leads to assign and real requests to approve.

### 2026-09-09 — Day 4: Lead Assignment Engine core (LA-04…LA-10, NF-07)

Branch `deva/day-4-assignment-engine`. **Held uncommitted at Saad's request pending review.**

**The locking implementation — read this before touching assignment**

`src/server/leads/assignment.ts` is the single place lead ownership changes. Approval, the auto-assign job, manual assignment and the logout-return rule all route through it. The transaction, exactly as recorded on Day 1:

1. `SELECT ... FROM leads WHERE status='AVAILABLE' AND assigned_to_id IS NULL AND do_not_call=false ORDER BY created_at LIMIT n FOR UPDATE SKIP LOCKED`
2. insert the append-only `lead_assignments` row
3. update the lead's ownership columns including `current_assignment_id`

`SKIP LOCKED` is what makes simultaneous requests safe: the second transaction doesn't block, it skips whatever the first has locked and takes the next rows. Release is the mirror image — stamp `released_at` + `release_reason`, then clear the lead's ownership columns. The partial unique index is the backstop underneath, never the mechanism.

Transaction timeout is raised to 30s (`TX_OPTIONS`): a 100-lead batch is 100 inserts plus 100 updates and blows Prisma's 5s default.

**FOR DEV B — login/logout state now has consequences.** Their Monitoring Engine and my lead-return rule read the same `sessions` table:
- Logout returns uncalled leads synchronously, inside `POST /api/auth/logout`.
- Return only fires when the agent has **no remaining active session** (`returnUncalledLeadsIfSignedOut`). Someone signed in on two machines who closes one has not logged out, and pulling their leads mid-call would be worse than leaving them.
- A third cron job (`expired-session lead return`) catches the closed-browser case, where no logout request is ever sent. **Cron count is now 3.** If Dev B changes session semantics — shorter expiry, forced single session — it changes when leads come back.

**Built**
- LA-04 approval: `POST /api/leads/requests/[id]/resolve` with APPROVE / REJECT. "Modify" is APPROVE with a different quantity, so `quantityRequested` and `quantityApproved` both survive on the row.
- LA-05 auto-assign: `runAutoAssignSweep()` on the every-minute cron, selecting on `auto_assign_at`. Reads `getAutoAssignMs()` — **not hard-coded**.
- LA-06/07/08 manual: `POST /api/leads/assign` (assign / transfer / reassign) and `POST /api/leads/release`, plus `/management/leads` to drive them. A transfer closes the old assignment and opens a new one in one transaction, so history shows both and there is never a moment with two open rows.
- LA-09/LA-10 logout return, described above.
- `GET /api/leads` (minimal listing, grows into Day 6's SF-01/02) and `GET /api/leads/agents`.
- `scripts/assignment-concurrency-test.ts` — the NF-07 proof.

**Two races, both closed**
1. *Two agents, same lead* — solved by SKIP LOCKED. Proven by the concurrency script.
2. *Management and the cron resolving the same request* — solved by a conditional claim: `UPDATE lead_requests ... WHERE status='PENDING'`, continue only if exactly one row changed. Verified with 6 concurrent approvals of one request: exactly one 200, five 409s, and the agent received one batch of 5 rather than six batches.

**RESOLVED — now a setting, not a guess.** (See the follow-up note at the end of this entry.) Originally written as a judgement call: LA-09/LA-10 return leads where `last_disposition_code IS NULL`, i.e. **only never-touched leads return**. That follows the brief literally ("only truly untouched leads return"), and it means a lead dispositioned **No Answer stays locked to the agent overnight** rather than going back for someone else to retry. The alternative — return anything whose disposition is not an active follow-up, using the `dispositions.is_follow_up` flag I added on Day 1 — would re-pool No Answer leads at the risk of a prospect hearing from two agents. Management's manual release covers the stranded case either way. Flagged in GLOBAL.md too.

**A test-harness bug worth remembering.** The first concurrency script asserted against its own tagged rows and reported 3 failures the moment the database also held other available leads — the product was correct, the harness was lying. It now snapshots the real available pool, asserts against that, and returns any pre-existing lead it borrowed. **A flaky correctness test is worse than none**: if this ever fails, read which assertion failed before assuming the product is broken. "No lead handed to two agents" is the one that matters.

**Also fixed:** the agent picker listed **Admin**, who holds every permission including `leads.read.own`. Leads assigned there sit outside every call list. Both `/api/leads/agents` and `POST /api/leads/assign` now exclude roles holding `leads.approve` — and they must keep matching, or the picker hides someone the API still accepts.

**Verified**
- Concurrency: 5 agents × 10 requested against a 30-lead pool, ×5 runs — no lead twice, pool exhausted exactly, DB invariants hold, pool restored after.
- Approve (15/15), modify (30 requested → 5 approved → 5 assigned), reject, double-resolve → 409.
- Auto-assign fired from cron: `AUTO_ASSIGNED`, 8 assigned, `reviewed_by_id` null (system), resolved.
- Logout: 7 uncalled returned, 5 Call Back Later + 3 No Answer retained, history rows stamped `LOGOUT_RETURN`.
- Expired-session sweep: 3 returned, 2 Email follow-ups retained.
- Transfer history for one lead: original row closed `REASSIGNED`, new `REASSIGN` row open, pointer correct.
- Guards: DNC skipped, HR/Admin refused, agent 403 on assign/release/agents, agent 307 → /403 on `/management/leads`.
- Build + typecheck clean. Lint 17 (was 16) — same two pre-existing classes.


**UI gap-closing pass (same day, after Saad asked for it)**

Drove every Day 4 screen in a real browser rather than trusting that a 200 from the API meant the button was wired. All four previously-untested paths work: approve / reject / **modify quantity** (typed 3 against a request for 10 → `MODIFIED`, approved 3, assigned 3), manual transfer and release (history chain intact: `REQUEST_APPROVED` → `REASSIGNED` → `REASSIGN` → `RELEASED_BY_MANAGEMENT`), both socket subscriptions (queue repainted 5→6 rows on a new request, and cleared when a request was resolved from a different client), and the agent form (preset fills the field without submitting, countdown runs, presets disable while a request is pending).

Note for future browser testing on this machine: coordinate clicks silently miss in the hidden preview pane — the first Approve click reported success and did nothing. Dispatching the click through `javascript_tool` fires the same React handler and is reliable. **If a UI click appears to do nothing here, check the network panel before concluding the product is broken.**

**Two real defects found by that pass, both fixed — and both introduced by making the window configurable:**
1. **Preset buttons ignored the setting.** `assignment.config.presetQuantities` existed and the API validated against it, but the agent page hard-coded `[15, 30]` — configurable in name only. `GET /api/leads/requests` now returns `presetQuantities` / `maxRequestQuantity` / `autoAssignMinutes` and the form renders from them. Verified: setting `[10,25,50]` changed what the API serves, and deleting the row fell back to the catalogue default.
2. **Countdown broke past an hour.** A two-hour window rendered as `119:31`, which reads as under two minutes. Extracted a shared `src/components/countdown.tsx` that switches to `h:mm:ss`; both screens use it instead of duplicating the formatter. Only reachable because Admin can now raise `autoAssignMinutes` — at the default 5 minutes it never showed.


**Follow-up: the No Answer question is now `assignment.config.returnNoAnswerOnLogout`, default `false`.**

Saad approved returning No Answer leads to the pool *conditional on it aligning with the spec*. Re-reading the source documents, it does not — three of four phrasings favour keeping them:
- Day 4 rule 4: "leads with **no disposition yet** return"
- Day 4 rule 5: "only **truly untouched** leads return"
- Build plan: "logout-**returns-uncalled-leads** rule" — a No Answer lead *was* called
- Only rule 5's list, "an active disposition (Call Back Later, Email, Successful-Qualify)", points the other way, since No Answer is absent from it

The condition wasn't met, so the default was NOT changed on my own judgement. But the tension is real: as built, that enumerated list does no work at all, because every disposition retains. A spec clause that changes nothing usually means something narrower was intended.

So it is a flag. `false` is exactly the previous, spec-aligned behaviour — nothing changes unless someone deliberately turns it on — and when the call-centre owner answers, it is a config change rather than a code change. Call Back Later / Email / Qualified stay with the agent in both positions.

Verified both ways against a 7 untouched + 3 No Answer + 3 Call Back Later mix: off → 7 returned; on → 10 returned, only Call Back Later retained.

**This is a question for the client, not for us.** Whoever runs the call centre should decide whether a lead that rang out belongs to the agent who dialled it. Put it to them before Day 10.

**Next — Day 5:** Agent Calling Workspace. Call List, VC Dialer handoff with mandatory clipboard fallback, the 6 dispositions, callback scheduling. Day 5 is what finally writes `last_disposition_code`, which is the field the whole logout-return rule keys off — so the retained-follow-up behaviour becomes real then. Check `GLOBAL.md` for VC Dialer status first, and read `dialer.config` rather than assuming.

**End-of-day addendum (2026-09-09, Day 4)**
- Day 4 merged to `main` as `d6dcde8` and pushed. Branch `deva/day-4-assignment-engine` (`a5aae84` + `9fc5b0a`) is on the remote. `main` now carries Dev A Days 1–4 and Dev B Days 1–3; `git branch -r --no-merged origin/main` is empty.
- **No PR was opened.** `gh` is not installed on this machine and a GitHub token is not something to handle here, so PRs have to be created by hand from the compare URL. Saad chose a direct `--no-ff` merge instead, same as Days 2 and 3. If a PR record is wanted for a future day, open it *before* asking for the merge — once the commits are on `main` a PR is pointless.
- **The `.claude/skills/` directory is gone** (removed on Day 1 with the Prisma 7 rollback). Nothing depends on it.
- Local state left running: dev server on :3000 and the Postgres container (`restart: unless-stopped`). 50 leads with a realistic ownership/disposition spread, 136 assignment-history rows, `assignment.config` using the catalogue default. `docker compose down` to stop the database.
- Carried into Day 5, all recorded in GLOBAL.md: (1) the `returnNoAnswerOnLogout` question for the call-centre owner; (2) the shared-lint cleanup, now 17 problems across both tracks, queued for Day 9's NFR pass; (3) the SRS requirements-traceability doc still does not exist, and Day 10 is a regression against exactly that list.
- **Day 5 is the day `last_disposition_code` starts being written.** Every retained-follow-up behaviour built on Day 4 is currently exercised only by hand-set values — it becomes real when the disposition modal ships. Check the VC Dialer status line in GLOBAL.md before starting; it is still marked unconfirmed, which means the clipboard fallback is the real path, not a stub.

### 2026-09-10 — Day 5: Agent Calling Workspace (CL-01…CL-08)

Branch `deva/day-5-calling-workspace`. Pulled Dev B's Days 4–6 first (36 tables); my `day5_callback_reminded_at` makes it 36 still (column only). NF-07 index re-verified after all four migrations.

**VC DIALER STATUS: STILL UNCONFIRMED.** `dialer.config.enabled` is `false`, so the clipboard path is the live implementation, not a stub — exactly what CL-03 demands.

**The one write path for call outcomes: `src/server/calls/disposition.ts`**

Same principle as `assignment.ts`. Every saved outcome writes BOTH halves in one transaction:
1. the `calls` row — `disposition_id` + `duration_sec`, which is what Dev B's dashboard aggregates;
2. `leads.last_disposition_code` + `last_disposition_at` — the agreed *worked* signal, which the dashboard, Day 7 reports and Day 4's logout rule all read.

Writing one without the other is the most likely way this module goes wrong, which is why they cannot be written separately.

**Outcome behaviour, all verified against the SRS table**
| Outcome | Lead status | Extra |
|---|---|---|
| No Answer | IN_PROGRESS | stays callable |
| Call Back Later | CALLBACK_SCHEDULED | date+time **required server-side**, creates a `callbacks` row |
| Not Interested | CLOSED_NOT_INTERESTED | closed, not re-pooled |
| Do Not Call | DO_NOT_CALL | sets sticky `do_not_call`; notifies approvers |
| Email | IN_PROGRESS | follow-up, stays with agent |
| Successful — Qualify | CLOSED_QUALIFIED | |

**CL-03, the part that matters:** `resolveDialerHandoff` returns CLIPBOARD for *every* case that is not a fully configured dialer — including when an Admin sets `clipboardFallback: false`. There is deliberately no configuration that leaves an agent unable to place a call. Verified: dialer off → clipboard; dialer on with a baseUrl → dial URL; **dialer on with no baseUrl and fallback off → still clipboard**.

**Cron count is now 4** — added the callback reminder sweep. Reminds once when a callback comes due (guarded by the new `callbacks.reminded_at`), and marks anything an hour past its time MISSED. Never reassigns or releases the lead: a missed callback is the agent's to fix, not a reason to move a lead out from under them.

**`calls.channel` now has a third value, `MANUAL`** — an outcome recorded without pressing Call first. Those rows deliberately carry `duration_sec = null` rather than an invented duration.

**Dev B's open assumption is now closed.** Their Day 6 note said "your Day 5 is my last unverified assumption". Their dashboard, run against real rows for the first time, reconciles exactly: `worked=6`, `qualified=1`, `doNotCall=1`, `agent.calls=6`, `totalTalkSec=15`. **One nuance to tell them:** `avgTalkSec` divides total talk time by *all* calls, including MANUAL ones with null duration, so the average is diluted. With mostly-dialled calls it barely shows; it is their aggregation to decide on.

**Verified**
- All 6 outcomes, each checked in psql for status, `last_disposition_*`, attempts, DNC flag and callback row.
- CL-06 enforced three ways: missing time → 400, past time → 400, and the modal's Save stays locked.
- CL-05 blocks in all three places: cannot dial (409), excluded from the call list, refused on reassignment.
- Cross-agent isolation: agent2 gets 409 on agent1's lead for both call and disposition. HR gets 403 on `calls.log` and `callbacks.manage`. Unauthenticated 401. Management 307 → /403 on agent screens.
- Double-save on one call → 409.
- Callback sweep observed firing from cron: 1 reminded, 1 marked missed, both notified; `reminded_at` stops it repeating.
- Driven in a real browser: Call → clipboard **blocked by the browser**, fallback field shown and toast warned (the real-world failure path, tested for free); modal validation; Call Back Later saved with notes; callback marked Done moved buckets and cleared the lead's pointer.
- NF-07 concurrency test still passes. Build + typecheck clean.

**Two defects I introduced and fixed in the same session**
1. **`callbackInPast` was computed during render.** An agent sitting on the modal past the time they picked kept an enabled Save button on stale data, with only the server's 400 catching it. Now ticked from state every 15s. Flagged by `react-hooks/purity`, a rule class nobody had tripped before — worth heeding rather than adding to the lint pile.
2. Same root cause on the call list's overdue flag, plus a dead `startedAt` field. Both gone.

Lint is **30**, up from Dev B's 26 baseline; the 4 added are all the pre-existing `set-state-in-effect` house pattern. **No new rule classes** — the 2 `purity` ones I introduced were fixed, not absorbed.

**Next — Day 6:** Agent Dashboard (TM-05: no Active/Idle/Break/Productivity anywhere), Do-Not-Call protection surfacing, Lead Timeline (SF-03) and Assignment History (SF-04). Real `calls` and `callbacks` rows now exist to build those views on, and `lead_assignments` already carries the full ownership chain.

### 2026-09-10 — Day 6: Agent Dashboard, Do-Not-Call protection, Lead Timeline, Assignment History

Branch `deva/day-6-agent-dashboard-timeline`. **Held unmerged at Saad's request pending review of the draft PR.** No new migration; no Dev B table touched. NF-07 index re-verified.

**TM-05 — the boundary, and how it is actually held**

`src/server/dashboard/agent-metrics.ts` is a SEPARATE module from Dev B's `metrics.ts`, not a filtered call into it. A shared function that returns monitoring fields and trusts each caller to strip them is one forgotten spread away from leaking, and the leak would be invisible in review. **Not importing the monitoring engine at all is a boundary you can verify by reading the import list.**

Verified two ways, both with a positive control so a passing test means something:
- **API scan** — the agent dashboard payload contains 0 fields matching `/active|idle|break|productiv/i`; Management's contains 20. Same scanner, so it demonstrably detects them.
- **Rendered-DOM sweep** across `/agent`, `/agent/call-list`, `/agent/callbacks`, `/agent/request-leads` — all clean, scripts and styles stripped so it tests visible copy rather than bundled identifiers.

**Built**
- **Agent Dashboard** (`/agent`, replacing the Day 1 placeholder): today's calls and leads worked, the six-outcome mix, leads held / to call / in progress / qualified / not interested / DNC, callbacks overdue-due-upcoming-completed, unread notifications. `leadsWorked` uses Dev B's agreed definition — a lead carrying `last_disposition_at`, not the existence of a call row.
- **Do-Not-Call protection** — `PATCH /api/leads/[id]/do-not-call`, gated on `leads.dnc.override` (Management/Admin). Asymmetric by design: an agent can *set* DNC through the disposition modal, but only Management can *clear* it. Anything less makes Do Not Call a suggestion. Restoring returns the lead unassigned to the AVAILABLE pool rather than to whoever last held it — it has usually been suppressed a while, and silently reappearing in someone's call list is worse.
- **SF-03 Lead Timeline** — `src/server/leads/timeline.ts` merges imports, assignments, releases, calls, dispositions, notes, callbacks and modifications into one ordered list. Six small indexed lookups merged in memory rather than one heroic UNION.
- **SF-04 Assignment History** — reads the append-only `lead_assignments` chain straight through, so it IS the history rather than a reconstruction.

**Two access decisions worth recording**
1. **Agents can see the timeline of their own leads.** "What did the last person say?" is the most useful thing to know before dialling, and it leaks nothing — they already hold the lead. Implemented as a route-level ownership check (`leads.timeline` OR assigned agent) rather than a new permission key, so **the AD-02 matrix is untouched** and Management can still revoke `leads.timeline` without affecting agents' access to their own work.
2. **Assignment history stays Management/Admin only.** Who *else* has held a lead is a supervision question, not something an agent needs. Verified: agent → 403.

**Verified**
- DNC round trip end to end: suppress → cannot dial (409), absent from call list, skipped by assignment → Management restores → back in the call list and dialable (201) → re-suppress → 409 again.
- Timeline access: agent on their own lead 200; agent2 on agent1's lead 404; HR 404; unauthenticated 401. (404 not 403 — a lead an agent may not see should not be confirmed to exist.)
- SF-04: management/admin 200, agent 403. 8 holder events and 3 distinct holders on a churned test lead.
- Role split in the browser: agent sees timeline only, no assignment history, no DNC controls; Management sees all three.
- Build, typecheck, NF-07 concurrency test all clean.

**One fix during the session:** timeline events sorted on timestamp alone, so a transfer — which writes the release and the new assignment in the same transaction, on the same millisecond — could render "assigned to B" before "released from A". Added a deterministic rank as the tie-break. Only visible on same-instant pairs, which is exactly where a history view must not lie.

**Known limitation, resolved by Day 8:** the timeline shows the *current* Do-Not-Call marking (derived from `leads.do_not_call_at`), not the full history of DNC changes — a suppress → restore → re-suppress sequence shows only the latest. The `MODIFIED` strand already reads `audit_log`, which is empty until Day 8 wires audit capture; once it does, that history appears with **no further work in this file**. Deliberately not instrumented ad hoc now — one action audited in isolation is worse than none.

Lint is **32** (was 30). The 2 added are the same `set-state-in-effect` house pattern; I removed 4 `no-unused-vars` of my own by projecting the timeline's lead object explicitly instead of destructuring-to-discard. The remaining 2 unused-vars and 1 refs are Dev B's.

**Next — Day 7:** Reporting Engine backend — aggregation queries for Daily/Weekly/Monthly/Punctuality plus Lead Source, exposed as filterable endpoints for Dev B's frontend. **Reuse `src/server/dashboard/metrics.ts` rather than writing a second set of aggregations** — Dev B flagged that explicitly, and two definitions of "worked" would put the dashboard and the reports permanently at odds.
