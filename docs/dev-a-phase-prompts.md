# Dev A (Saad) — Phase-by-Phase Claude Code Prompts

One prompt block per day. Paste the block for today's day number directly into Claude Code at the start of that day's session. Each prompt assumes Claude Code has already read `.claude/CLAUDE.md` (automatic) — that file has the stack, ownership boundaries, and architectural rules, so these prompts stay focused on *what to build today* rather than re-explaining context.

At the end of each day: tell Claude Code to append a Session Log entry to `.claude/CLAUDE.md` and update your row in `GLOBAL.md` before you close the session — or just say "wrap up today's session" and it should do both from the instructions already in CLAUDE.md.

---

## Day 1 — Foundation (shared with Dev B)

```
Read docs/crm-b2b-build-plan.md and .claude/CLAUDE.md fully before starting.

Today is Day 1 — shared foundation work, coordinate with Dev B on schema so we don't
diverge (check GLOBAL.md for anything they've already decided).

Set up:
1. Next.js (App Router, TypeScript) project scaffold with a custom server.js that
   attaches Socket.io to the underlying HTTP server (do not use default `next start`
   for dev/prod — we need the custom server for realtime + cron).
2. Prisma + PostgreSQL connection. Draft the core schema: users, roles, permissions,
   leads, lead_imports, lead_assignments (append-only history, not overwrite),
   dispositions, callbacks, messages, announcements, notifications, activity_events,
   audit_log, hr_employees, hr_documents, leave_requests, reports_generated,
   management_scores. My modules need leads/lead_imports/lead_assignments/
   dispositions/callbacks especially solid — model lead_assignments so a lead's
   current owner + lock state is derivable without ambiguity.
3. Auth: session-based or JWT login, bcrypt password hashing, and a
   requireRole()/requirePermission() middleware driven off the roles/permissions
   tables — this will be used by every API route on both our tracks.
4. Base role-aware layout shells for /agent, /management, /admin, /hr routes
   (empty pages are fine today, just the routing + role-gated layout).
5. Tailwind + shadcn/ui installed and configured.
6. Seed script creating the 8 initial users (5 Agent, 1 Management, 1 Admin, 1 HR).

Stop and ask me before finalizing the leads/lead_assignments schema shape — I want
to sanity check it against the VICIdial-style locking model described in the build
plan before we build on top of it.

When done, append a dated Session Log entry to .claude/CLAUDE.md summarizing what
was built and any schema decisions made, and update the Day 1 row for Dev A in
GLOBAL.md.
```

---

## Day 2 — Lead Import Engine (part 1)

```
Read .claude/CLAUDE.md Session Log for what's been built so far, and check
GLOBAL.md for Dev B's Day 2 progress (Admin Configuration) in case anything I need
(e.g. dynamic field definitions from Admin) isn't ready yet — if so, stub it and
note the dependency.

Build the Lead Import Engine, first half (LM-01, LM-02, LM-04, LM-05 from the SRS):
1. Excel upload endpoint (accept .xlsx, parse with a library like `exceljs`).
2. Dynamic column-mapping UI: after upload, show detected columns and let
   Management map each to a CRM lead field (or "ignore column").
3. Duplicate detection: match on phone number, email, company name, contact name,
   website — whichever of these are present in the mapped columns. Must degrade
   gracefully when some fields are absent, not error out.
4. Missing-information detection: flag rows with blank required-ish fields without
   discarding them.
5. U.S. phone number FORMAT validation only (regex/libphonenumber format check) —
   do not attempt to verify the number is live or reachable, that's explicitly out
   of scope.

Don't build the validation summary screen or error export yet — that's Day 3.

End of session: append to .claude/CLAUDE.md Session Log and update GLOBAL.md.
```

---

## Day 3 — Lead Import Engine (finish) + Lead Assignment Engine (start)

```
Read .claude/CLAUDE.md Session Log before starting.

Part 1 — finish Lead Import Engine (LM-03, LM-06, LM-07, LM-08, LM-09):
1. Pre-import validation summary screen: total rows, valid rows, duplicate/existing
   rows, missing-info rows, invalid-phone-format rows, rows ready to import.
2. For each detected duplicate, let Management choose: reject, keep both, update
   existing, or flag for manual review.
3. Error/validation report, exportable (CSV or Excel) showing rejected/flagged rows
   and the reason for each.
4. Every import tagged with a lead source/campaign label.
5. Import history log: file name, uploader, date/time, record count, validation
   results, import status, source.

Part 2 — start Lead Assignment Engine (LA-02, LA-03):
1. Agent-facing lead request UI: preset quantity buttons (15, 30) that populate a
   quantity field, plus a custom quantity input.
2. Submitting a request creates a pending request record Management can see
   (the approval screen itself is tomorrow — today just get requests captured and
   listed).

Check GLOBAL.md — Dev B should have the notification schema + Socket.io event
wiring in progress this same day (their Day 3). Coordinate the event names/payload
shape for "lead request submitted" now so we don't have to refactor later.

End of session: append to .claude/CLAUDE.md Session Log and update GLOBAL.md.
```

---

## Day 4 — Lead Assignment Engine (core)

```
Read .claude/CLAUDE.md Session Log before starting. This is the most important
correctness-critical day on my track — take the transactional locking seriously.

Build (LA-04 through LA-10):
1. Management approval screen: approve, reject, or modify quantity on pending
   requests.
2. 5-minute auto-assignment: a server-side cron/queue job (not a browser timer)
   that, if a request sits un-actioned for 5 minutes, automatically assigns
   available leads up to the requested quantity.
3. Lead locking: assignment writes must be wrapped in a DB transaction so two
   agents can never end up owning the same lead (NF-07). Write a quick concurrent-
   request test to prove this before moving on.
4. Logout-return rule: when an agent logs out, any of their leads with no
   disposition yet return to the available pool automatically.
5. Retained follow-up rule: leads with an active disposition (Call Back Later,
   Email, Successful-Qualify, etc.) stay with the agent through logout — only
   truly untouched leads return.
6. Manual assignment: Management can directly assign/release/transfer/reassign
   leads or batches outside the request flow, and every reassignment preserves
   full history (never overwrite).

End of session: append to .claude/CLAUDE.md Session Log (call out the locking
implementation specifically since Dev B's Monitoring Engine idle logic on their
Day 4 might interact with login/logout state) and update GLOBAL.md.
```

---

## Day 5 — Agent Calling Workspace

```
Read .claude/CLAUDE.md Session Log before starting.
Check GLOBAL.md for VC Dialer API status — if it's still unconfirmed, build the
clipboard-fallback path as the real path today (not a stub), since it's mandatory
regardless of dialer availability (CL-03).

Build (CL-01 through CL-08):
1. Call List screen: assigned leads with contact/company details.
2. Call action per lead: if VC Dialer integration is configured, hand off to it;
   otherwise copy the phone number to clipboard automatically and give clear
   visual confirmation it copied.
3. Disposition modal covering all 6 required outcomes: No Answer, Call Back Later,
   Not Interested, Do Not Call, Email, Successful-Qualify — each with correct
   behavior per the SRS table (e.g. Do Not Call must block future normal
   calling/reassignment; Call Back Later must require/strongly prompt a date+time).
4. Notes field on every disposition.
5. Callback scheduling (date/time) tied to Call Back Later, with a callback/task
   view (due, overdue, upcoming, completed).
6. Call data capture fields (start/end time, duration, result, recording
   reference) — store these even if VC Dialer isn't wired up yet, so the schema is
   ready.

End of session: append to .claude/CLAUDE.md Session Log and update GLOBAL.md,
including the VC Dialer status you found.
```

---

## Day 6 — Agent Dashboard + Do-Not-Call + Lead History

```
Read .claude/CLAUDE.md Session Log before starting.

Build:
1. Agent Dashboard: today's assigned leads, calls made/answered/no-answer,
   callbacks, not-interested, do-not-call, email outcomes, qualified/successful
   outcomes, pending callbacks, notifications. Double-check against TM-05: this
   screen must NOT show Active Time, Idle Time, Break/Pause Time, or Productivity %
   — those belong only to Dev B's Management reports.
2. Do-Not-Call protection: a lead marked Do Not Call is clearly flagged and
   excluded from standard assignment/calling flows unless an Admin/Management user
   explicitly overrides it.
3. Lead Timeline (SF-03): chronological view per lead of imports, assignments,
   calls, dispositions, notes, callbacks, communications, modifications.
4. Assignment History (SF-04): all previous assignment/reassignment events for a
   lead, visible to authorized roles.

End of session: append to .claude/CLAUDE.md Session Log and update GLOBAL.md.
```

---

## Day 7 — Reporting Engine (backend, my half)

```
Read .claude/CLAUDE.md Session Log before starting. Dev B is building the report
UI/exports on their side today — coordinate on the API contract for report data
(check GLOBAL.md / talk directly) before diverging.

Build the aggregation/query layer for:
1. Daily, Weekly, Monthly, and Punctuality reports — focus on the lead/call side
   of the data (leads assigned/handled, calls, outcomes, callbacks, call duration)
   since Dev B owns the activity/screen-time side.
2. Lead Source report: imported/called/contacted/qualified totals by source.
3. Expose these as clean, filterable API endpoints (date range, agent, source,
   disposition) that Dev B's frontend can call directly.

Don't build 15-Day or Custom reports yet if time is tight — those are explicitly
flagged as descope-first items in the build plan; Daily/Weekly/Monthly/Punctuality
are the priority.

End of session: append to .claude/CLAUDE.md Session Log and update GLOBAL.md.
```

---

## Day 8 — Audit & History

```
Read .claude/CLAUDE.md Session Log before starting.

Build (AU-01 through AU-03, my portion):
1. Wire audit-log capture into every lead/call/assignment/disposition action on my
   modules: who did it, what changed, when.
2. Before/after value diffing for important editable fields (e.g. disposition
   changes, reassignments, Do-Not-Call status changes) — store as a JSON diff on
   the audit_log row.

Dev B is building the searchable audit UI and Global Search/Filters (SF-01/02)
today — make sure my audit_log writes match whatever schema/shape they need to
query against (check GLOBAL.md, coordinate directly if unclear).

End of session: append to .claude/CLAUDE.md Session Log and update GLOBAL.md.
```

---

## Day 9 — VC Dialer Integration + Hardening

```
Read .claude/CLAUDE.md Session Log before starting. Check GLOBAL.md for current
VC Dialer API status.

If VC Dialer API access is available:
1. Implement the real integration for CL-01/CL-04 (call start/end time, duration,
   agent, phone number, result, recording reference) using whatever the VC Dialer
   API actually exposes. Keep the clipboard fallback path intact and automatically
   used if the dialer call fails or isn't configured for a given deployment.

If VC Dialer API access is still not available:
1. Harden the clipboard-fallback flow instead: edge cases (multiple phone numbers
   on one lead, missing phone number, clipboard permission denied in-browser),
   and make sure call-data-capture fields are populate-able manually as a
   temporary stand-in.

Either way, also do this today:
2. Concurrency/race-condition testing on lead locking (Day 4's work) — simulate
   two agents requesting/receiving leads simultaneously and confirm no double-
   assignment.
3. Review my modules against NF-07 (data integrity) and NF-02 (responsive
   performance on Call List / dashboard / disposition save) — fix anything slow
   or fragile.

End of session: append to .claude/CLAUDE.md Session Log (state clearly whether
real VC Dialer integration shipped or fallback-only) and update GLOBAL.md.
```

---

## Day 10 — Regression + Joint Integration (shared with Dev B)

```
Read .claude/CLAUDE.md Session Log before starting, and read GLOBAL.md fully —
today needs full visibility into both tracks.

Together with Dev B:
1. Walk the full 27-point Acceptance Criteria list in docs/crm-b2b-build-plan.md
   / the original SRS §21, one by one, and mark each as pass/fail against the
   actual running app.
2. Cross-role permission boundary testing using the SRS §17 matrix — confirm
   Agent/Management/Admin/HR each see exactly what they should and nothing more,
   especially: Agent dashboard has no Active/Idle/Break/Productivity metrics,
   HR documents aren't visible to Agents by default, Admin-only system config
   isn't reachable by Management.
3. Fix whatever fails.
4. Assist with deployment (PM2/Docker + Nginx + SSL) and seed the real 8 accounts
   if not already done.
5. Final smoke test logged in as each of the 4 roles.

End of session: append a final Session Log entry to .claude/CLAUDE.md and mark
Day 10 complete in GLOBAL.md for both devs, noting any acceptance criteria that
didn't pass and what's planned to fix them post-handover.
```
