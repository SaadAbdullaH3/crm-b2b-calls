# SRS Requirements Traceability Matrix

**Source of truth:** `CRM_B2B_Calls_Final_Requirements.docx` v1.0, September 2026 — extracted and counted directly from the document, not from the build plan's summary of it.
**Created:** 2026-09-12 (end of Day 7). **Owner:** shared — both devs update their own rows.
**Purpose:** Day 10 is a full regression against §21. This is that checklist, plus the evidence trail for every numbered requirement underneath it.

---

## 0. Two corrections to the build plan, found while writing this

These matter because Day 10's scope was written against the wrong numbers.

| Claim in `crm-b2b-build-plan.md` | Actual, counted from the SRS | Consequence |
|---|---|---|
| "the **27**-point Acceptance Criteria (SRS §21)" | **§21 contains 16 criteria.** | Day 10's regression target has been overstated by 11 items since Day 1. There is no missing set of 11 — the number was simply wrong. Nothing has been skipped. |
| "~**150** individually numbered requirements across 22 sections" | **92 numbered requirements** (AD 10, AU 4, CL 8, CM 8, HR 8, LA 10, LM 9, MG 10, NF 10, RP 4, SF 4, TM 7), plus roughly 35 unnumbered obligations in §6.1, §8.1, §15, §17 and §19. | ~127 total obligations. "~150" was an estimate and is close enough; **"27" was a hard number used for planning and is not.** |

Neither correction changes what has to be built. Both change what "done" is measured against, which is the entire point of writing this before Day 10 rather than during it.

---

## 1. How to read this

| Mark | Meaning |
|---|---|
| ✅ | Built **and** verified. Evidence column names the artefact and how it was proven. |
| 🟡 | Partially built. The gap is stated explicitly — never "mostly done". |
| ⬜ | Not started. The planned day is named. |
| ⏸ | Consciously descoped, per the build plan's Part 4 or SRS §20. Must be told to the client, not silently cut. |
| 🔴 | **Gap found by this audit** — believed done or not previously tracked, actually missing. |

"Verified" means someone checked the behaviour, not that the code exists. Where a status rests on the other dev's own report rather than an independent check, the Evidence column says so.

---

## 2. §21 Acceptance Criteria — the Day 10 regression checklist

All 16, verbatim in substance, each with the requirements it depends on so a failure points somewhere.

| # | Acceptance criterion | Depends on | Status | How Day 10 proves it |
|---|---|---|---|---|
| 1 | All 8 initial users can be created with correct role-based access | AD-01, AD-02, §17 | ✅ | Seed creates 8 users / 4 roles / 37 permissions. Log in as each of 4 roles; confirm each is 307'd to `/403` from the other three. Done on Day 1; **re-run on Day 10 against the real accounts, not the dev seed.** |
| 2 | Management can upload an Excel file with changing columns, map fields, and receive duplicate/missing/phone-format validation | LM-01…LM-06 | ✅ | 11-row fixture (`scripts/make-import-fixture.mjs`) exercises every validation branch. Re-run end to end. |
| 3 | Agents request preset or custom quantities; Management approves; unanswered requests auto-assign after 5 minutes | LA-02…LA-05 | ✅ | Submit a request, leave it, watch the cron assign it. Must be proven **with no browser tab open** — the countdown is cosmetic. |
| 4 | Assigned leads are locked and do not appear in another agent's pool | LA-07, NF-07 | ✅ | `scripts/assignment-concurrency-test.ts` — 5 agents × 10 leads × 5 runs. The single strongest-evidenced requirement in the project. |
| 5 | Logout returns only uncalled/unprocessed leads; active follow-up/qualified stay assigned | LA-08, LA-09 | ✅ | Verified both ways on a 7 untouched / 3 No Answer / 3 Call Back Later mix. **See open question Q1 — the No Answer case is a client decision, not a bug.** |
| 6 | Agents can call through VC Dialer where available, or the number is copied automatically when it is not | CL-01, CL-02, CL-03 | 🟡 | Clipboard path ✅ and is the live implementation. **Dialer path unproven — no credentials.** Day 9 decides: real integration or a documented, hardened fallback. |
| 7 | Disposition interface includes all 6 outcomes plus callback date/time and notes | CL-06, CL-07, §7.1 | ✅ | All six checked in psql for status, `last_disposition_*`, attempts, DNC flag and callback row. |
| 8 | Management can monitor calls, login/logout, CRM screen time, computer activity status, active/idle/break time and detailed activity logs | TM-01…TM-06, MG-09, MG-10 | 🟡 | Everything ✅ **except computer activity status**, which needs the desktop component and is descoped (⏸ TM-02). **This criterion cannot be fully passed as scoped — flag it to the client rather than failing it silently on Day 10.** |
| 9 | Five minutes of no activity stops Active Time and records Idle Time | TM-03 | ✅ | Dev B proved the idle sweep firing from cron with no browser open. |
| 10 | Agents do not see Management-only productivity metrics | TM-05 | ✅ | Verified two ways with a positive control: agent payload 0 forbidden fields, Management 20, same scanner. Plus a rendered-DOM sweep of all 4 agent screens. |
| 11 | Management can generate Daily, Weekly, 15-Day, Monthly, Punctuality and Custom reports, and approve/change Management Scores with change history | MG-06, MG-07, RP-01…RP-04, TM-07 | 🟡 | All six report types ✅, score + history ✅. **Two gaps: 🔴 TM-07 (no monitoring metrics in any report) and 🟡 MG-07 (punctuality missing 4 of its 6 required fields).** Both below. |
| 12 | HR can store employee documents and holiday/leave details, and communicate with agents and Management | HR-01…HR-08 | ✅ | Dev B's Day 5. HR-07 verified: Management gets 403 on documents. Not independently re-checked by Dev A. |
| 13 | Internal messaging supports individual users, groups, broadcasts and notifications | CM-01…CM-06, CM-08 | ✅ | Dev B's Day 3. ⏸ attachments (CM-07) descoped. |
| 14 | Admin can manage users, permissions, groups, dispositions, fields, system settings, reports and dialer configuration | AD-01…AD-07, AD-09 | 🟡 | Users/roles/groups/dispositions/fields/dialer/time settings ✅. **⬜ AD-08 notification configuration does not exist; 🟡 AD-09 report settings exist only as permissions.** |
| 15 | Audit history is available for important operational, administrative and HR actions | AU-01…AU-04 | ⬜ | **Day 8, entirely.** `audit_log` currently holds **0 rows**. This is the single largest outstanding block of work against §21. |
| 16 | The platform can scale beyond the initial five agents without architectural redesign | NF-03 | ✅ | Nothing is hard-coded to 5/8: roles, permissions, groups and quantities are all data. **Day 10 should assert this rather than assume it** — seed a 9th user and a second group. |

**Day 10 arithmetic as it stands: 11 of 16 pass outright, 5 are partial, and 4 of those 5 resolve on Days 8–9.** Criterion 8 is the one that cannot fully pass as scoped.

---

## 3. Requirement matrix

### §4 Lead Import — LM (Dev A, Days 2–3) — 9/9 ✅

| ID | Requirement | Day | Status | Evidence |
|---|---|---|---|---|
| LM-01 | Dynamic Excel columns, mapped before import | 2 | ✅ | `src/lib/import/parse.ts`, `target-fields.ts`; `/management/imports/[id]`. All 7 messy fixture headers auto-suggested correctly |
| LM-02 | Duplicate detection on phone/email/company/contact/website, tolerant of absent columns | 2 | ✅ | `src/lib/import/analyze.ts`. Person-level (phone/email = strong) split from org-level (company/website, only paired with contact name) |
| LM-03 | Reject / keep both / update existing / manual review | 3 | ✅ | `POST /api/leads/imports/[id]/resolutions`, applied in `commit.ts` |
| LM-04 | Missing info surfaced, never silently discarded | 2 | ✅ | `lead_import_rows` retains every parsed row with its verdict |
| LM-05 | U.S. phone **format** only, no reachability check | 2 | ✅ | `src/lib/import/phone.ts` (libphonenumber-js). UK `+44` rejected; numeric Excel cells parsed |
| LM-06 | Pre-import summary: total / valid / duplicate / missing / invalid-phone / ready | 3 | ✅ | `/management/imports/[id]/review` tiles |
| LM-07 | Downloadable validation/error report with a reason per row | 3 | ✅ | `src/lib/import/report.ts` — .xlsx, Summary + per-row sheets. Excel not CSV, because CSV mangles phone numbers |
| LM-08 | Every import carries a source/campaign label | 3 | ✅ | Enforced at **commit**, not upload — 409 without a label |
| LM-09 | Import history: file, uploader, date, counts, results, status, source | 2–3 | ✅ | `GET /api/leads/imports`, `/management/imports` |

### §5 Lead Assignment — LA (Dev A, Days 3–4) — 9 ✅, 1 🟡

| ID | Requirement | Day | Status | Evidence / gap |
|---|---|---|---|---|
| LA-01 | Central lead DB with status, assignment history, source, activity, last modification | 1 | ✅ | `leads` (+ `updatedAt`) and append-only `lead_assignments` |
| LA-02 | Agents request leads from dashboard or Import Leads screen | 3 | ✅ | `/agent/request-leads`, `POST /api/leads/requests` |
| LA-03 | Preset buttons (15/30) fill the field; custom quantity allowed | 3–4 | ✅ | Presets served from `assignment.config.presetQuantities` — Day 4 fixed them being hard-coded |
| LA-04 | Approve / reject / adjust quantity | 4 | ✅ | `POST /api/leads/requests/[id]/resolve`; "modify" is APPROVE at a different quantity, so requested and approved both survive |
| LA-05 | 5-minute auto-assignment | 4 | ✅ | `runAutoAssignSweep()` on cron, selecting on `auto_assign_at`; reads `getAutoAssignMs()`, not a literal 5 |
| LA-06 | Manual assignment to a specific agent **or group** | 4 | 🟡 | `POST /api/leads/assign` takes `agentId` + `leadIds` — individual and **batch** work. **Group assignment is not implemented**, though `groups` exists and holds 4 rows. Small: resolve group → member ids, then the existing path |
| LA-07 | Lead locking, excluded from other agents' pool | 4 | ✅ | `FOR UPDATE SKIP LOCKED` + partial unique index `lead_assignments_one_active_holder`, re-verified after all 9 migrations |
| LA-08 | Logout returns uncalled leads | 4 | ✅ | Synchronous in `POST /api/auth/logout`, plus an expired-session cron for the closed-browser case. Only fires with **no remaining active session** |
| LA-09 | Retained follow-up leads stay with the agent | 4 | ✅ | See **Q1** — the No Answer boundary is a client decision, exposed as `assignment.config.returnNoAnswerOnLogout` (default `false` = spec-literal) |
| LA-10 | Release / reassign / transfer, preserving full history | 4 | ✅ | Transfer closes the old row and opens the new one in one transaction — never two open rows |

### §7 Calling — CL (Dev A, Day 5) — 5 ✅, 3 🟡

| ID | Requirement | Day | Status | Evidence / gap |
|---|---|---|---|---|
| CL-01 | VC Dialer integration | 5, 9 | 🟡 | `resolveDialerHandoff` implemented; `dialer.config.enabled = false`. **No credentials have ever been supplied.** Day 9 decides |
| CL-02 | Clear Call action per lead | 5 | ✅ | Call List |
| CL-03 | Dialer handoff, else clipboard | 5 | ✅ | Returns CLIPBOARD for **every** non-configured case, including when an Admin sets `clipboardFallback: false`. There is deliberately no configuration that leaves an agent unable to call |
| CL-04 | Capture start/end/duration/agent/number/result/recording ref | 5 | 🟡 | Everything except **`recordingRef` and `dialerCallId`, which are never populated** — they need the dialer. Columns exist, so no migration on Day 9 |
| CL-05 | Management access to recordings | 6 | 🟡 | Permission `calls.recording.access` and Dev B's screen exist; **no recordings exist to access** without the dialer |
| CL-06 | Notes on every disposition | 5 | ✅ | Enforced in the modal and server-side |
| CL-07 | Callback date/time, reminder, task view | 5 | ✅ | `callbacks` + reminder cron (guarded by `reminded_at`), `/agent/callbacks`. Past times rejected server-side |
| CL-08 | Do-Not-Call blocked from standard calling unless Management changes it | 6 | ✅ | Asymmetric by design: an agent can **set** DNC, only `leads.dnc.override` clears it. Blocked in 3 places — dial, call list, reassignment |

### §14 Search & History — SF — 2 ✅, 2 🟡

| ID | Requirement | Day | Status | Evidence / gap |
|---|---|---|---|---|
| SF-01 | Global search on **any available mapped field** | 8 (Dev B) | 🟡 | `GET /api/leads?q=` searches a **fixed** set of columns. Dynamic/custom fields (AD-05, stored in `leads.custom_fields`) are **not searchable** — which is precisely what "any mapped field" asks for |
| SF-02 | Filters: agent, source, disposition/status, import date, call date, callback date | 8 (Dev B) | 🟡 | Only `status` and `assignedTo` exist. **Missing: source, disposition, and all three date filters** |
| SF-03 | Lead timeline of imports, assignments, calls, dispositions, notes, callbacks, communications, modifications | 6 | ✅ | `src/server/leads/timeline.ts`, 6 indexed lookups merged in memory, deterministic tie-break on same-millisecond events. **The `MODIFIED` strand reads `audit_log` and stays empty until Day 8** |
| SF-04 | All previous assignment/reassignment events retained | 6 | ✅ | Reads the append-only chain directly — it *is* the history, not a reconstruction. Management/Admin only |

### §9 Monitoring — TM (Dev B, Day 4) — 5 ✅, 1 ⏸, 1 🔴

| ID | Requirement | Day | Status | Evidence / gap |
|---|---|---|---|---|
| TM-01 | CRM screen time | 4 | ✅ | `work_sessions` accrual, exact to the millisecond per Dev B |
| TM-02 | Workstation activity monitoring via desktop component | — | ⏸ | **Descoped** — build plan Part 4, item 1. Needs a separate install. Client must be told |
| TM-03 | 5 minutes idle → Active Time stops | 4 | ✅ | Idle sweep cron, proven firing with no browser open |
| TM-04 | Configurable breaks + agent self-toggle | 4 | ✅ | `monitoring.config` + break control |
| TM-05 | No Active/Idle/Break/Productivity on the Agent dashboard | 6 | ✅ | Verified two ways with a positive control. `agent-metrics.ts` does not import the monitoring engine **at all** — a boundary you can check by reading the import list |
| TM-06 | Activity event capture across CRM events | 4 | ✅ | `activity_events` pipeline |
| TM-07 | Idle/break/active/screen/call-time **reflected in weekly, 15-day, monthly and custom reports** | 7 | 🔴 | **GAP. No report payload carries any monitoring field.** Grep of `src/server/reports/` finds active/idle/break only in a comment saying they are excluded. §10's report table names these as minimum content for Daily/Weekly/15-Day/Monthly. **The exclusion was correct for TM-05 and over-applied: TM-05 forbids them on the *Agent dashboard*, and TM-07 requires them in *Management reports*.** Fix is small — `getAgentPerformance()` already accepts `includeMonitoring`; the report endpoints must pass it, gated on `monitoring.view` |

### §8 Management — MG — 8 ✅, 2 🟡

| ID | Requirement | Day | Status | Evidence / gap |
|---|---|---|---|---|
| MG-01 | Excel lead import | 2–3 | ✅ | Dev A's engine behind Management screens |
| MG-02 | Approve/reject/modify before the 5-minute deadline | 4 | ✅ | Race with the cron closed by a conditional claim: 6 concurrent approvals → one 200, five 409s |
| MG-03 | Assign, release, transfer, reassign — individually or in batches | 4 | ✅ | `leadIds` array. (Group targeting is LA-06's gap, not this one) |
| MG-04 | Search/filter by company, contact, phone, email, website, status, agent, source, date, city, industry | 8 | 🟡 | Same gap as SF-01/SF-02 |
| MG-05 | Agent drill-down: calls, leads, callbacks, notes, activity, metrics, attendance, history | 6 | ✅ | Dev B. Every total reconciles against a 120-lead fixture |
| MG-06 | Daily, Weekly, 15-Day, Monthly, Custom reports | 7 | ✅ | One aggregation over 8 calendar scopes, not five reports. Week+last-week = month = 15d reconciled |
| MG-07 | Punctuality: scheduled shift, actual login/logout, late minutes, **early logout, break time, total scheduled time, total recorded working time** | 7 | 🟡 | Has shift, first login, last seen, late minutes, on-time, session count. **Missing 4 of the named fields: early logout, break time, total scheduled time, total recorded working time.** All three inputs exist (`work_sessions`, `break_periods`, `shift.config`) — this is assembly, not new capture |
| MG-08 | Raw data first; Management approves and can adjust a score with reason | 7 | ✅ | Dev B — `management_scores` + append-only `management_score_events` |
| MG-09 | CRM screen-time **and** configurable computer activity monitoring | 4 | 🟡 | CRM half ✅; computer-activity half ⏸ with TM-02 |
| MG-10 | Chronological per-agent activity log | 6 | ✅ | Dev B's drill-down activity feed |

### §10 Reporting — RP (Dev B, Day 7) — 4/4 ✅

| ID | Requirement | Day | Status | Evidence |
|---|---|---|---|---|
| RP-01 | Export in Excel and PDF | 7 | ✅ | One neutral document model → both formats. `pdfkit` + `serverExternalPackages` |
| RP-02 | View and export the underlying raw data | 7 | ✅ | `GET /api/reports/raw`, gated on `reports.export` not `reports.view` — reading a chart is not permission to walk out with the list |
| RP-03 | Score entry/change, approval, reason and change history | 7 | ✅ | `management_score_events`, append-only; a correction is another row |
| RP-04 | Historical reports accessible with generation date, period, approver | 7 | ✅ | `reports_generated` + `/management/reports/history`. Downloads go through the same code path as a fresh export |

### §11 Communication — CM (Dev B, Day 3) — 7 ✅, 1 🟡

| ID | Requirement | Status | Note |
|---|---|---|---|
| CM-01 | Direct messages | ✅ | |
| CM-02 | Broadcast to all / one / selected / group | ✅ | |
| CM-03 | HR ↔ agents and Management | ✅ | |
| CM-04 | Agent ↔ Management/HR/agents per role | ✅ | |
| CM-05 | Groups (B2B Team, Senior Agents, …) | ✅ | 4 groups seeded |
| CM-06 | Announcements, optional acknowledgement | ✅ | |
| CM-07 | Timestamps, read/unread, searchable history, notifications, **attachments** | 🟡 | Everything except **attachments** — ⏸ descoped, build plan Part 4 item 3 |
| CM-08 | Retain sender, recipients, timestamp, read status | ✅ | |

### §12 HR — HR (Dev B, Day 5) — 8/8 ✅

HR-01 profiles · HR-02 documents · HR-03 metadata · HR-04 attendance · HR-05 leave/holiday · HR-06 employee history · HR-07 restricted access · HR-08 HR messaging — all ✅ per Dev B's Day 5 verification (path traversal, extension allowlist, leave-day maths and a concurrent-approval race all tested; Management 403 on documents).

**Dev A note on HR-04:** the attendance figures were wrong until Day 7 — lateness was computed from the *latest* login of the day rather than the first, overstating it for anyone signing in twice (593 vs a true 561 minutes for one agent). Fixed; HR attendance and the Punctuality report now share `lateMinutesFor()` and return identical values on every shared row.

### §13 Admin — AD (Dev B, Day 2) — 7 ✅, 1 🟡, 2 ⬜

| ID | Requirement | Status | Evidence / gap |
|---|---|---|---|
| AD-01 | User CRUD, activate/deactivate, reset password | ✅ | + 4 lockout guards |
| AD-02 | Configure role permissions for all roles | ✅ | 37 permissions × 4 roles. ⚠️ **re-seeding still resets runtime changes** — open for Day 9 |
| AD-03 | Groups | ✅ | |
| AD-04 | Manage dispositions, preserving the required 6 | ✅ | `isSystem` blocks deletion |
| AD-05 | Dynamic fields + Excel column mapping | ✅ | Consumed by the import mapper via Prisma, not over HTTP (permission mismatch — Management runs imports but lacks `admin.fields.manage`) |
| AD-06 | Dialer connection settings and fallback behaviour | ✅ | `dialer.config`, `dialer.credentials` |
| AD-07 | Inactivity threshold, shifts, break rules | ✅ | `monitoring.config`, `shift.config`; default 5 min |
| AD-08 | Configure notification categories, recipients, priority | ⬜ | **Not implemented.** No settings key exists — categories, recipients and priority are all hard-coded at each `notify()` call site. (Separately, Dev B's Day 8 includes "finish wiring all 9 notification types end to end"; 7 distinct types have fired in the dev database, and `/api/announcements` has no `notify()` call site at all.) **Unassigned to a day** |
| AD-09 | Report access, **schedules**, fields | 🟡 | Access ✅ via `reports.view` / `reports.export`. **Schedules ⏸ descoped** (Part 4 item 4). **Configurable report fields not implemented** |
| AD-10 | View security and operational audit logs | ⬜ | Day 8 (Dev B's audit search UI) — blocked on AU-01 |

### §16 Audit — AU (Dev A capture Day 8, Dev B UI Day 8) — 0/4

| ID | Requirement | Day | Status | Note |
|---|---|---|---|---|
| AU-01 | Immutable record of who/what/when | 8 | ⬜ | Table exists, correct shape, **0 rows** |
| AU-02 | Track logins, user changes, imports, assignments, dispositions, notes, callbacks, DNC changes, report approvals/scores, HR document actions, setting changes | 8 | ⬜ | The list is long and spans **both** tracks — Dev A cannot wire HR or Admin actions alone. Split it before starting |
| AU-03 | Before/after values where practical | 8 | ⬜ | |
| AU-04 | Filter by user, action, module, date range | 8 | ⬜ | Dev B's UI, blocked on AU-01 |

Two things unblock automatically once AU-01 lands: SF-03's `MODIFIED` timeline strand (no further work in that file) and the DNC change history it currently cannot show.

### §18 Non-Functional — NF — 3 ✅, 5 🟡, 1 ⬜, 1 🔴

| ID | Requirement | Day | Status | Evidence / gap |
|---|---|---|---|---|
| NF-01 | Usable in modern desktop browsers | 1 | ✅ | |
| NF-02 | Common actions complete promptly | 9 | 🟡 | **Never measured.** No numbers exist for call-list load, assignment, disposition save or dashboard. Day 9 should record baselines, if only to have something to point at |
| NF-03 | Not hard-coded to 5 agents / 8 users | 1 | ✅ | Roles, permissions, groups, quantities all data-driven. Day 10 should *assert* it: add a 9th user and a 2nd group |
| NF-04 | Sessions, hashed passwords, RBAC, HTTPS, server-side validation, protected storage | 1, 9 | 🟡 | Sessions ✅ (token hashed, never stored raw), bcrypt cost 12 ✅, RBAC ✅ at the API layer, server-side validation ✅. **HTTPS is a Day 10 deployment concern and is not yet in place** |
| NF-05 | Secure login/logout, configurable session timeout, controlled concurrent sessions | 1, 9 | 🟡 | Login/logout ✅. Timeout configurable **via `SESSION_TTL_HOURS` env (default 8), not through the Admin UI**. Concurrent sessions are *detected* (the logout rule requires no remaining active session) but not *limited* |
| NF-06 | Scheduled, recoverable DB and document backups | 9 | ⬜ | Dev B. **Now covers two upload subtrees** — `uploads/hr` and `uploads/reports` |
| NF-07 | No duplicate ownership or conflicting writes | 4 | ✅ | Partial unique index + `SKIP LOCKED` + a repeatable concurrency test. Index re-verified after every one of 9 migrations |
| NF-08 | Application errors and integration failures logged for support | 9 | 🟡 | `console` only. No structured or persisted error log, which matters most for the dialer integration on Day 9 |
| NF-09 | Timestamps stored consistently, displayed in the configured business time zone | 9 | 🔴 | **Known gap.** Every report and dashboard boundary uses **server-local** time. `shift.config.timeZone` exists and is not honoured. Deliberately not half-applied on Day 7. Touches both tracks |
| NF-10 | Monitoring and HR data limited to authorized roles, with retention policy | 5, 6 | 🟡 | Role limits ✅ and verified. **No retention policy or purge exists** for monitoring data or HR documents |

### §17 Permissions matrix

The 8 rows of §17 are enforced through `requireRole()` / `requirePermission()` at the API layer only — page guards are UX. Verified per-day; **Day 10 owes one systematic pass of all 4 roles × every endpoint**, which no single day has yet done end to end.

One deliberate divergence to raise with the client: §17 gives Admin "Configurable" access to leads. In practice Admin holds every permission, which is why Admin kept appearing in agent pickers and reports. `REPORTABLE_AGENT_WHERE` (`leads.read.own` AND NOT `leads.approve`) now excludes them in four places. **Admin is treated as a configurator, not a caller.**

---

## 4. Gaps, ranked by what they cost

| # | Gap | Requirement | Cost if not fixed | Where it belongs |
|---|---|---|---|---|
| 1 | Audit logging entirely absent | AU-01…04, AD-10, AC-15 | An acceptance criterion fails outright, and SF-03's timeline stays half-blind | **Day 8** — already planned |
| 2 | No monitoring metrics in any report | 🔴 TM-07, §10, AC-11 | §10 names them as minimum content for four of six report types. The client asked for reports that show idle and break time; they do not | Day 8 or 9. Small — `includeMonitoring` already exists |
| 3 | Timezone: all boundaries server-local | 🔴 NF-09 | A report labelled "Today" is wrong for anyone in another zone. Client-visible | **Day 9** |
| 4 | Global search ignores dynamic mapped fields | SF-01, SF-02, MG-04 | "Search by any mapped field" is the requirement; a fixed column list is not that | **Day 8** — Dev B |
| 5 | Punctuality missing 4 of 6 named fields | MG-07 | Named explicitly in §10's report table. The data already exists | Day 8/9 |
| 6 | No notification configuration | AD-08 | Named in AC-14's list of what Admin manages | Unassigned — **needs a day** |
| 7 | Group assignment not implemented | LA-06 | "assign to a specific agent **or group**" — groups exist and are unused for this | Day 8/9, small |
| 8 | Performance never measured | NF-02 | Nothing to show if challenged | Day 9 |
| 9 | No error/failure logging | NF-08 | Bites hardest during the Day 9 dialer integration | Day 9 |
| 10 | No retention policy | NF-10 | Named in the requirement; a policy statement may satisfy it | Day 9, possibly documentation only |

**AD-08 (#6) is the only gap with no day assigned to it.** Everything else has a home.

---

## 5. Descope register — must be told to the client, not silently cut

| Item | Requirement | Authority | Status |
|---|---|---|---|
| Desktop workstation activity/screen monitoring | TM-02, half of MG-09, part of AC-8 | Build plan Part 4, item 1 | ⏸ Descoped. **Blocks full pass of Acceptance Criterion 8** |
| Message file/document attachments | CM-07 | Build plan Part 4, item 3 | ⏸ Descoped |
| Report scheduling | AD-09 (partial) | Build plan Part 4, item 4 | ⏸ Descoped |
| 15-Day and Custom report types | MG-06 | Build plan Part 4, item 2 | ✅ **Not descoped — both shipped** on Day 7 |
| Phone reachability verification | §20 | SRS itself | 🔵 Out of scope by the SRS |
| Direct email-provider integration | §20 | SRS itself | 🔵 Out of scope. The Email *outcome* exists, as required |
| Anything the VC Dialer API cannot do | §20 | SRS itself | 🔵 Out of scope; clipboard fallback stays mandatory and is implemented |

---

## 6. Open questions for the client

These block nothing today but each changes behaviour, and all three are cheaper to answer than to guess.

**Q1 — Should a lead dispositioned "No Answer" return to the pool at logout, or stay with the agent overnight?**
Three of four SRS phrasings favour keeping it (LA-08 "not been called or otherwise processed"; §19 "Uncalled/unprocessed"; the build plan's "logout-returns-uncalled-leads" — a No Answer lead *was* called). Only LA-09's enumerated list of active follow-ups points the other way by omitting No Answer. Built as `assignment.config.returnNoAnswerOnLogout`, default `false` (spec-literal). **Genuinely a business call:** does a lead that rang out belong to the agent who dialled it, or to whoever is free next? Raised Day 4.

**Q2 — May agents see their own break time?**
TM-05 forbids Active/Idle/Break/Productivity on the Agent dashboard. Dev B asks whether an agent seeing *their own* break total violates the intent or just the letter. Currently: not shown. Raised Day 6.

**Q3 — Is Acceptance Criterion 8 accepted without computer activity monitoring?**
It requires "computer activity status", which needs the descoped desktop component. Everything else in that criterion is built. **This should be confirmed before Day 10, not discovered during it.**

---

## 7. Maintenance

Update this file **on the day a requirement's status changes**, not at the end. A traceability matrix that lags the code is worse than none — it will be trusted and be wrong.

- Change the ✅/🟡/⬜ and the Evidence cell together. A status with no evidence is an opinion.
- When a gap in §4 closes, strike it there too.
- Day 10 works from §2. If a criterion cannot pass, say so against the criterion rather than quietly re-scoping it.
