# CRM — B2B Calls: Feature Correlation & 10-Day Build Plan

Stack: **Next.js (App Router, custom server) + React + TypeScript + PostgreSQL + Prisma + Socket.io + Tailwind/shadcn**, self-hosted on a VPS (not Vercel) behind Nginx, process-managed with PM2/Docker.

Team: 2 developers, module/domain split, 10 working days.

---

## Part 1 — Feature Correlation with the Reference CRMs

Mapping the SRS's 11 recommended modules to the CRMs we researched earlier tells you *which parts of your build have a proven pattern to copy, and which parts are genuinely custom.*

| Your Module | Closest Reference(s) | What to Borrow | What's Custom (no direct reference) |
|---|---|---|---|
| **Lead Import Engine** (dynamic Excel mapping, duplicate detection, validation summary) | SuiteCRM's import wizard, Frappe CRM's field mapping | Column-mapping UI pattern, "review before import" step | Pre-import validation *summary with reject/keep-both/update/manual-review choice per duplicate* — none of the reference CRMs do this as a first-class workflow; you're building this from scratch |
| **Lead Assignment Engine** (preset/custom qty requests, 5-min auto-assign, locking, logout-return) | **VICIdial** — closest 1:1 match in the whole reference set | VICIdial's lead-hopper/locking model (a lead is leased to one agent and excluded from the pool) is exactly this requirement's LA-07/LA-08 | The *request → 5-minute Management-approval-or-auto-assign* flow is not how VICIdial works (VICIdial just pulls from the hopper automatically) — this approval step is your own addition |
| **Agent Calling Workspace** (call button, VC Dialer handoff/clipboard fallback, dispositions, callbacks) | ictCRM's CTI screen-pop pattern; SuiteCRM/EspoCRM/Zammad's "CRM sits in front of an external dialer" pattern | You are NOT building a dialer (unlike VICIdial/GOautodial, which built Asterisk in-house) — you're a thin integration layer, same architectural role as a CTI connector in SuiteCRM/EspoCRM | The 6-disposition set (No Answer / Call Back Later / Not Interested / Do Not Call / Email / Successful-Qualify) is a simplified, opinionated version of VICIdial's much larger disposition-code system |
| **Management Console** (dashboard, approvals, lead controls, agent drill-down) | Genesys Cloud CX / NICE CXone supervisor views | KPI-tile + drill-down layout pattern | — |
| **Monitoring Engine** (screen time, idle/active, breaks, activity events) | NICE CXone / Genesys workforce-optimization layer | Conceptual model only (idle detection, break tracking) | **No open-source CRM in our list has this at all.** SuiteCRM/EspoCRM/Zammad/YetiForce/Frappe/ictCRM/Odoo are all "no" on this. This is the most custom-built module in your entire spec — budget real time for it |
| **HR Module** (employee profiles, documents, leave/holiday) | Bitrix24 (the only reference CRM that bundles CRM + HR + collaboration in one product) | Bitrix24's "everything in one suite" philosophy validates that this belongs alongside the CRM rather than as a separate system | Nearly all of it — call-center CRMs generally don't ship HR features; this is closer to a mini-HRIS bolted onto a CRM |
| **Communication Module** (DM, groups, broadcasts, announcements, acknowledgement) | Zammad's ticket-communication model; Bitrix24's internal chat/announcements | Read/unread + timestamp + searchable-history pattern | Acknowledgement-required announcements are a specific addition |
| **Reporting Engine** (Daily/Weekly/15-Day/Monthly/Punctuality/Source/Custom + Management Score) | Genesys/NICE reporting & QA dashboards (scoring, punctuality); SuiteCRM/YetiForce report builders (export formats) | Export-to-Excel/PDF pattern, raw-data-view-before-scoring principle | The 15-Day report cadence and the editable-with-audit-trail "Management Score" are specific to your spec |
| **Admin Configuration** (users, roles, groups, dynamic fields, dispositions, dialer config) | **SuiteCRM / EspoCRM / YetiForce admin panels** — best template to copy UI/UX from | Role-permission matrix screens, custom-field builder, module settings pages | — |
| **Audit & History** (immutable log, before/after values, searchable) | SuiteCRM's and Odoo's audit-trail modules | Before/after JSON-diff storage pattern | — |
| **Authentication & RBAC** | Every reference CRM does this; SuiteCRM/EspoCRM/YetiForce/Frappe CRM all have mature, copyable RBAC models | Role → permission → module mapping structure | — |

**Bottom line:** your two hardest, least-precedented modules are **Monitoring Engine** and **HR Module** — neither has a real open-source reference to lean on. Your best-precedented module is **Lead Assignment/Locking**, which VICIdial has been refining for 15+ years — model your DB schema and locking logic directly on that concept (a lead row has an `assigned_to`, `locked_at`, `status`, and returns to an "available pool" query when unlocked).

---

## Part 2 — Foundational Architecture Decisions (Day 0/1, before splitting)

Both of you should agree on these together before diverging into separate modules, since every module touches them:

- **DB schema core tables:** `users`, `roles`, `permissions`, `leads`, `lead_imports`, `lead_assignments` (with full history, not overwrites), `dispositions`, `callbacks`, `messages`, `announcements`, `notifications`, `activity_events`, `audit_log`, `hr_employees`, `hr_documents`, `leave_requests`, `reports_generated`, `management_scores`.
- **Lead locking = a status + assigned_to + locked_at column, never a separate "lock table."** Keep it simple; wrap assignment writes in a DB transaction to avoid the double-assignment race condition (NF-07).
- **Real-time layer:** one Socket.io namespace, custom Next.js server. Every lead-lock change, new assignment, notification, and message pushes an event — this is what makes the 5-minute countdown and "no answer" style updates feel live instead of requiring polling.
- **The 5-minute auto-assign timer and 5-minute idle sweep are both jobs, not requests.** Use `node-cron` (or `bullmq` if you want retry-safety) running in the same custom-server process. Don't try to implement these as browser-side `setTimeout`s — they must survive the agent closing their tab.
- **RBAC middleware once, used everywhere:** a single `requireRole()`/`requirePermission()` check at the API-route level, driven by the permissions matrix in SRS §17, so Agent/Management/Admin/HR visibility rules are enforced in one place instead of re-implemented per screen.

---

## Part 3 — 10-Day Plan, Split by Module/Domain

**Dev A — Saad — "Core Calling Pipeline"** owns: Lead Import, Lead Assignment/Locking, Agent Calling Workspace, Search/Lead Timeline, VC Dialer integration.
**Dev B — Teammate — "Ops & People Console"** owns: Admin Configuration, Management Console, Monitoring Engine, HR Module, Communication Module, Reporting Engine, Audit Log.

Each owns full-stack (API + UI) for their column — minimizes merge conflicts since you're rarely editing the same files.

| Day | Dev A — Saad (Core Calling Pipeline) | Dev B — Teammate (Ops & People Console) |
|---|---|---|
| **1** | *Together:* repo scaffold, Prisma schema, Postgres setup, Auth/RBAC middleware, base Next.js layout shells for all 4 roles, Socket.io custom server skeleton, seed 8 users. | *Together (same as left column).* |
| **2** | Lead Import Engine: Excel upload, dynamic column-mapping UI, parser (`exceljs`), duplicate-detection logic (phone/email/company/name matching), missing-field + U.S. phone-format validation. | Admin Configuration: user CRUD, roles/permissions matrix screens, groups, dynamic lead-field builder, dialer-settings storage screen. |
| **3** | Finish Import: validation summary screen, error-report export, import history log, lead-source/campaign tagging. Start Lead Assignment Engine: agent request UI (preset 15/30 buttons + custom qty). | Communication Module: direct messages, groups, broadcasts, announcements w/ optional acknowledgement, notification schema + Socket.io event wiring (Dev A will consume these events). |
| **4** | Lead Assignment Engine: Management approval/reject/modify screen, 5-minute auto-assign cron job, transactional lead-locking, logout-returns-uncalled-leads rule, manual assignment + reassignment with full history. | Monitoring Engine: CRM screen-time tracking, heartbeat-based 5-minute inactivity → idle-state detection, break/pause control (agent-side toggle + Admin-configured break rules), activity-event capture pipeline. |
| **5** | Agent Calling Workspace: Call List screen, Call button → VC Dialer handoff or clipboard-copy fallback, disposition modal (6 required outcomes + notes), callback date/time scheduling + callback/task view. | HR Module: employee profile CRUD, document upload with metadata (type/expiry/notes), leave & holiday records with approval workflow, HR ↔ Agent/Management communication tie-in. |
| **6** | Agent Dashboard (today's leads/calls/outcomes/callbacks — **no** Active/Idle/Break/Productivity metrics per TM-05); Do-Not-Call protection logic; Lead Timeline (SF-03) and Assignment History (SF-04) views. | Management Dashboard: aggregate KPIs by agent/source, agent drill-down profile, pending-request queue with live approval countdown, call-recording access screen (permission-gated, pending VC Dialer capability). |
| **7** | Reporting Engine — backend: aggregation queries for Daily/Weekly/15-Day/Monthly/Punctuality/Lead-Source/Custom reports (call/lead data side). | Reporting Engine — frontend: report UI, date-range/filter controls, Excel/PDF export, raw-data view, Management Score entry + approval + change-history UI. |
| **8** | Audit & History: immutable audit-log capture wired into every lead/call/assignment/disposition action, before/after value diffing. | Global Search & Filters (SF-01/02) across leads on dynamic mapped fields; finish wiring all 9 notification types end-to-end; Admin audit-log search screen (AU-04). |
| **9** | VC Dialer real integration if credentials are available (else harden clipboard-fallback + call-data capture stub); race-condition testing on lead locking. | Non-functional pass: HTTPS/session timeout/concurrent-session handling, bcrypt password hashing, server-side validation audit, scheduled DB + document backup script (NF-06). |
| **10** | *Together:* full regression against the 27-point Acceptance Criteria (SRS §21), cross-role permission boundary testing (SRS §17 matrix), bug fixing. | *Together:* production deployment (PM2/Docker + Nginx + SSL), seed real 8 accounts, smoke test all 4 roles, handover notes. |

---

## Part 4 — Honest Scope Warning

This SRS has ~150 individually numbered requirements across 22 sections — that is realistically a 6–10 week build for a team of two if done to full "production-grade" polish on every line. Ten days gets you a working, demo/pilot-ready system that satisfies the **27 Acceptance Criteria in §21**, which is the right target to aim at rather than every nice-to-have in the body text. If day 9–10 gets tight, the first things to consciously descope to "stub or defer" (and tell the call center owner explicitly, don't silently cut) are, in order:

1. Desktop workstation activity/screen-content monitoring (TM-02's optional application/screen detail) — keep only CRM screen-time + idle detection, which needs no separate desktop install.
2. 15-Day and Custom report types — ship Daily/Weekly/Monthly/Punctuality first; 15-Day and Custom are the same aggregation engine with a different date range, so they're fast follow-ups.
3. Message file/document attachments (CM-07) — text messaging first, attachments after.
4. Report scheduling (AD-09) — manual generation first, scheduled generation later.

Everything else in the plan above maps directly to an Acceptance Criterion, so nothing on the day-by-day table is optional.

---

*Prepared September 2026, based on CRM_B2B_Calls_Final_Requirements.docx v1.0 and the previously compiled call-center CRM reference document.*
