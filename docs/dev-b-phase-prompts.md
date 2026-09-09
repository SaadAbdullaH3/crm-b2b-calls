# Dev B — Phase-by-Phase Claude Code Prompts

Counterpart to `dev-a-phase-prompts.md`. One prompt block per day — paste the block for today's day
number into Claude Code at the start of that day's session.

Each prompt assumes Claude Code has already read `DEV-B.md` (automatic, via the gitignored
`CLAUDE.local.md`). That file carries the stack, ownership boundaries and architectural rules, so
these prompts stay focused on *what to build today*.

At the end of each day, say **"wrap up today's session"** — that triggers the Session Log append in
`DEV-B.md` and the `GLOBAL.md` row update from the instructions already in `DEV-B.md`.

**Day 1 is not listed.** Dev A built and pushed the shared foundation; Dev B clones it rather than
rebuilding it. See `GLOBAL.md` → Project for the setup block.

---

## Day 2 — Admin Configuration

```
Read DEV-B.md and GLOBAL.md fully before starting. Check GLOBAL.md's Cross-Cutting
Decisions Log for anything Dev A changed since my last session.

Today is Day 2 — Admin Configuration (AD-01 through AD-09). Everything lands under
/admin, permission-gated with the admin.* keys already in permissions.ts.

First: the Day 1 schema has no table for four of these. Add to prisma/schema.prisma
and migrate:
  - groups + group_members       (AD-03; Day 3's messaging also needs this)
  - system_settings              (AD-06 dialer, AD-07 time/break, AD-08 notifications,
                                  AD-09 reports — key/value + Json, not a column per
                                  setting, so new settings never need a migration)
  - lead_field_definitions       (AD-05; writes into the existing leads.custom_fields)
Do NOT touch leads' ownership columns, lead_assignments, audit_log, notifications or
activity_events — those are Dev A's. Log the migration in GLOBAL.md when done.

Then build:
1. AD-01 User CRUD — create/edit/activate/deactivate/reset password. bcryptjs cost 12,
   reuse src/lib/auth/password.ts. Never expose password hashes through an API.
2. AD-02 Roles & permissions matrix — a role x permission grid the Admin can toggle,
   persisting to role_permissions. Seed values in permissions.ts are the BASELINE, not
   a runtime rule; the DB is the source of truth after this screen exists.
3. AD-03 Groups — create/manage groups, add/remove members.
4. AD-05 Dynamic lead field builder — define a field (key, label, type, required,
   options for selects) that Dev A's import mapper can then map a column onto.
5. AD-06 Dialer settings screen — store VC Dialer connection config + fallback
   behaviour in system_settings. Credentials must not be readable back through the
   API once saved (write-only from the UI's perspective).
6. AD-07 Time & break settings — inactivity threshold (default 5 min), shift times,
   break rules. My Day 4 Monitoring Engine reads these, so agree the keys now.

Guard rails:
  - Every route uses requirePermission() with an admin.* key, not requireRole().
  - An Admin must not be able to delete or deactivate their own account, or strip
    admin.roles.manage from the last admin — that locks everyone out permanently.
  - Deactivating a user must revoke their live sessions (sessions table), not just
    set a flag.

Don't build the audit-log search screen — that's Day 8.

End of session: wrap up.
```

---

## Day 3 — Communication Module

```
Read DEV-B.md Session Log and check GLOBAL.md for Dev A's Day 2/3 progress.

Today is Day 3 — Communication Module (CM-01 through CM-08) plus the notification
pipeline Dev A consumes from Day 4 onward.

1. CM-01 Direct messages — user to user, using the messages/message_recipients tables
   framed on Day 1. Reshape them if needed; they're mine.
2. CM-02/CM-04 Broadcast + group messaging — Management to all agents, one agent,
   selected agents, or a group (groups came from Day 2).
3. CM-06 Announcements with optional required acknowledgement, and a view showing
   who has and hasn't acknowledged.
4. CM-07 Timestamps, read/unread state, searchable conversation history, unread
   counts. DEFER file attachments — that's #3 on GLOBAL.md's Scope Watch list.
5. Notification pipeline — write to the notifications table and emit
   EVENTS.NOTIFICATION_NEW / MESSAGE_NEW / ANNOUNCEMENT_NEW over Socket.io to the
   right rooms. This is the piece Dev A plugs lead-assignment alerts into, so the
   helper must be importable and take (userId, type, title, body, payload).

Critical: the socket layer runs under the custom server, NOT Next's bundler. Any
module the emit helper touches must not import `server-only`. Follow the
session-core.ts / session.ts split pattern.

Rooms and payload shapes are already defined in src/lib/realtime/events.ts — import
from there, never a string literal. REQUEST_SUBMITTED is already specced for Dev A's
Day 3; if it needs to change, change it in that file and log it in GLOBAL.md.

End of session: wrap up.
```

---

## Day 4 — Monitoring Engine

```
Read DEV-B.md Session Log and GLOBAL.md before starting.

Today is Day 4 — Monitoring Engine (TM-01 through TM-07). This is the module with no
open-source reference to copy, per the build plan. Budget the whole day.

Schema first — add work_sessions and break_periods (agreed Day 2 as pending).

1. TM-01 CRM screen time — measure time logged in, keyed off the sessions table so
   logout/expiry are real server-side events.
2. TM-03 Idle detection — browser heartbeat every ~30s carrying "qualifying activity
   since last beat". After 5 continuous minutes with no qualifying activity, Active
   Time stops and the user flips to Idle; activity resumes it. The threshold comes
   from Day 2's system_settings, NOT a hard-coded 5.
   THE SWEEP MUST BE A CRON JOB. Dev A registered an idle-sweep job on Day 1 with a
   no-op body — fill that in. A browser setTimeout is not acceptable: a closed tab
   must still flip the user to idle.
3. TM-04 Breaks — agent-side start/end break control, plus Admin-configured break
   rules from system_settings. Break time is neither active nor idle.
4. TM-06 Activity event capture — write to activity_events (Dev A's table — read the
   shape, don't reshape it without telling him). Capture login/logout, navigation,
   break transitions, idle transitions.
5. Management-side monitoring view at /management/monitoring — live active/idle/break
   per agent.

!! TM-05 — THE HARDEST BOUNDARY IN THIS PROJECT !!
Active/Idle/Break/Productivity must NEVER reach an Agent screen. The agent's break
button is allowed (they need to press it), but it must not display accumulated
active/idle totals or a productivity figure. Do not add a monitoring entry to
NAV.agent. Do not grant agents a monitoring.* permission. Before finishing, verify:
an Agent's resolved permission set still contains zero monitoring.* keys.

End of session: wrap up.
```

---

## Day 5 — HR Module

```
Read DEV-B.md Session Log and GLOBAL.md before starting.

Today is Day 5 — HR Module (HR-01 through HR-08). Second-least-precedented module in
the project; the Day 1 tables are framed thin and are mine to reshape.

1. HR-01 Employee profiles — employee ID, name, contact, joining date, job title,
   department/team, shift. Extend hr_employees as needed; it links 1:1 to users.
2. HR-02/HR-03 Documents — upload with metadata (type, upload date, uploader,
   employee, notes, optional expiry). Store OUTSIDE the repo: /uploads is already
   gitignored. Serve through a permission-checked route handler, never as a static
   file — a guessable path is a data leak.
3. HR-05 Leave & holiday — leave requests with type/dates/reason, approve/reject
   workflow, holiday calendar, leave history. leave_requests already exists.
4. HR-04 Attendance view — read-only, fed by Day 4's work_sessions.
5. HR-06 Employee history — employment changes, warnings, reviews.
6. HR-08 HR communication — wire HR into Day 3's messaging.

HR-07 is the requirement that matters most here: HR documents are the most sensitive
data in the system. Agents must not see other agents' records at all, and Management
does NOT automatically get HR document access — it is permission-gated separately
(hr.documents.manage). Check the SRS §17 matrix: HR documents are "Restricted" for
Management, "Permission-based" for Admin.

Validate uploads: extension allowlist, size cap, and never trust the client-supplied
filename when building a path.

End of session: wrap up.
```

---

## Day 6 — Management Dashboard

```
Read DEV-B.md Session Log and GLOBAL.md before starting. Dev A finishes his Agent
Dashboard today, so check what lead/call query helpers already exist rather than
writing parallel ones.

Today is Day 6 — Management Console (SRS §8.1, §8.2).

1. KPI tiles — total imported/available/assigned/called/remaining leads; calls by
   agent; answered/no-answer/callback/not-interested/DNC/email/qualified counts;
   call duration and total call time per agent.
2. Lead performance by source/campaign (LM-08 tagging feeds this).
3. MG-05 Agent drill-down — one agent's calls, leads, callbacks, notes, activity,
   monitoring metrics, attendance and history on a single profile page.
4. Pending lead-request queue with the live 5-minute approval countdown. The
   countdown is COSMETIC — Dev A's cron does the actual auto-assign. Subscribe to
   EVENTS.REQUEST_SUBMITTED / REQUEST_RESOLVED so it updates without polling.
5. Login/logout and punctuality indicators (from Day 4's work_sessions).
6. MG-10 Activity feed — chronological, drill-downable.
7. Call recording access screen (CL-05), permission-gated on
   calls.recording.access. VC Dialer capability is still unconfirmed — build the UI
   against a stub and check GLOBAL.md's VC Dialer status line first.

Read-only over Dev A's tables. Approving a request means calling HIS endpoint, not
writing leads/lead_assignments myself — the assignment transaction has a specific
recipe (FOR UPDATE SKIP LOCKED) and a partial unique index behind it.

Watch dashboard query cost: aggregate in SQL, don't pull rows into JS and reduce.

End of session: wrap up.
```

---

## Day 7 — Reporting Engine (frontend + scoring)

```
Read DEV-B.md Session Log and GLOBAL.md. Dev A builds the aggregation queries today
on his side — agree the function signatures with him EARLY, before either of us has
written much, or we'll spend the evening reconciling two shapes.

Today is Day 7 — Reporting Engine, my half (RP-01 through RP-04).

1. Report UI with date-range and filter controls for: Daily, Weekly, Monthly,
   Punctuality, Lead Source. Ship those five first — 15-Day and Custom are #2 on
   GLOBAL.md's Scope Watch and are the same aggregation with a different range.
2. RP-01 Export to Excel and PDF. Excel first (exceljs is already a dependency for
   Dev A's importer). PDF second.
3. RP-02 Raw data view — Management must see the underlying rows before any score,
   per the SRS's "raw data first" principle.
4. RP-03 Management Score — enter/adjust a score with a mandatory reason, approve it,
   and keep full change history. management_scores exists but has no history table;
   either add one or write every change to audit_log. Decide and log it in GLOBAL.md.
   "Editable with an audit trail" is the requirement — an overwrite with no history
   fails it.
5. RP-04 Historical reports — keep generated reports accessible with generation date,
   period and approving user. reports_generated exists for this.

Report scheduling is #4 on the Scope Watch — manual generation only for now.

End of session: wrap up.
```

---

## Day 8 — Global search, notification wiring, audit-log UI

```
Read DEV-B.md Session Log and GLOBAL.md before starting.

Today is Day 8 — three loose ends.

1. SF-01/SF-02 Global search and filters across leads, including Admin-defined
   dynamic fields from Day 2. Filters: assigned agent, source, disposition/status,
   import date, call date, callback date. Searching leads.custom_fields (Json) needs
   a real strategy — a Postgres GIN index on the jsonb column, not a table scan.
   Results MUST respect leads.read.own vs leads.read.all: an agent searching may
   only ever see their own leads.
2. Finish wiring all 9 notification types from SRS §15 end to end — new lead batch,
   request approved/rejected/modified/auto-approved, callback due, callback overdue,
   direct message, announcement, HR notification, system alert, DNC warning. Several
   fire from Dev A's code paths; confirm his side calls the helper from Day 3.
3. AU-04 Audit-log search screen at /admin/audit — filter by user, action, module,
   date range, with before/after diff rendering. Dev A writes the entries (his Day 8);
   I build the read UI. Agree the action-name vocabulary with him so the filter
   dropdown isn't full of near-duplicates.

The audit log is append-only. The UI must expose no edit or delete path, and no
route I add may write to it except through Dev A's capture helper.

End of session: wrap up.
```

---

## Day 9 — Non-functional pass

```
Read DEV-B.md Session Log and GLOBAL.md before starting.

Today is Day 9 — the NFR pass (NF-01 through NF-10). Hardening, not features.

1. NF-04 Security sweep — verify every one of my API routes has a requirePermission()
   or requireRole() wrapper. Grep for route handlers with neither and fix them. Check
   for IDOR: does any route trust a client-supplied userId/employeeId instead of
   deriving it from the session?
2. NF-04 Server-side validation — every mutating route validates its body with zod.
   Client-side validation is not validation.
3. NF-05 Session control — configurable timeout (SESSION_TTL_HOURS), clean expiry,
   and a decision on concurrent sessions. Verify a revoked session can't be replayed.
4. NF-06 Backups — a scheduled pg_dump + /uploads archive script, with a documented
   restore procedure. An untested backup is not a backup: prove a restore works.
5. NF-09 Time zone — confirm timestamps are stored in UTC and rendered in the
   configured business zone. Reports crossing a DST boundary are where this breaks.
6. NF-10 Privacy — monitoring data and HR records limited to authorised roles;
   confirm the retention settings are at least configurable.
7. Revisit the deepmerge-ts advisory Dev A deferred on Day 1 (Prisma CLI
   devDependency, not app runtime).

Also re-verify the TM-05 boundary end to end — log in as an agent and confirm no
active/idle/break/productivity value is reachable from any agent route or API.

End of session: wrap up.
```

---

## Day 10 — Deployment and handover (shared with Dev A)

```
Read DEV-B.md Session Log and GLOBAL.md. Dev A runs the acceptance-criteria
regression today; I run deployment. Coordinate — don't both edit GLOBAL.md at once.

Today is Day 10 — ship it.

1. Production deployment: VPS, Docker or PM2, Nginx reverse proxy, Let's Encrypt
   SSL. Remember ENABLE_CRON must be true on EXACTLY ONE process — under PM2 cluster
   mode, two processes means the 5-minute auto-assign fires twice.
2. Production env: real SESSION_SECRET (not the .env.example placeholder), real DB
   credentials, SEED_PASSWORD unset or changed.
3. Seed the 8 real accounts with real emails and forced password change.
4. Smoke test all 4 roles against the SRS §21 acceptance criteria, especially the
   cross-role permission boundaries in §17.
5. Handover notes: how to deploy, how to restore a backup, where logs live, what's
   descoped and why (GLOBAL.md's Scope Watch), and the VC Dialer integration status.
6. Confirm the descoped list is written down for the client explicitly — the build
   plan is emphatic that cuts get told, not silently made.

Before deploying, verify the partial unique index lead_assignments_one_active_holder
survived every migration since Day 1. It's hand-written SQL that Prisma doesn't know
about, so a migration that recreated that table would have silently dropped the NF-07
guarantee.

End of session: wrap up.
```

---

*Written Day 2 by Dev B, mirroring `dev-a-phase-prompts.md`. Day numbers track the 10-day plan in
`crm-b2b-build-plan.md` Part 3.*
