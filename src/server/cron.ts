import cron, { type ScheduledTask } from "node-cron";
import { runAutoAssignSweep } from "@/server/leads/requests";
import { runExpiredSessionSweep } from "@/server/leads/sessions";
import { runIdleSweep } from "@/server/monitoring/engine";
import { runCallbackSweep } from "@/server/calls/callbacks";

/**
 * Server-side scheduled jobs, running inside the custom server process.
 *
 * Architectural rule (.claude/CLAUDE.md): the 5-minute lead auto-assign and the
 * 5-minute idle sweep are JOBS, not requests. They must fire whether or not any
 * browser tab is open. The countdown an agent sees in the UI is cosmetic; this
 * is what actually does the work.
 *
 * The sweeps run every minute and select on a timestamp column
 * (lead_requests.auto_assign_at) rather than sleeping for five minutes, so a
 * server restart cannot drop a pending request on the floor.
 *
 * ENABLE_CRON must be true on exactly ONE process. Under PM2 cluster mode every
 * worker would otherwise run the sweep and race to assign the same leads.
 */

const tasks: ScheduledTask[] = [];

/**
 * LA-05 — auto-assign lead requests that have passed their deadline.
 *
 * Runs every minute and selects on `lead_requests.auto_assign_at`, so the
 * deadline lives in the database rather than in a timer. A request submitted
 * before a restart is still filled afterwards, and closing the browser changes
 * nothing — the countdown an agent sees is cosmetic.
 */
async function autoAssignSweep() {
  const result = await runAutoAssignSweep();
  if (result.processed > 0) {
    console.log(
      `[cron] auto-assigned ${result.assigned} lead(s) across ${result.processed} request(s)`,
    );
  } else if (process.env.CRON_VERBOSE === "true") {
    console.log("[cron] auto-assign sweep tick — nothing due");
  }
}

/**
 * LA-09 — return uncalled leads for agents whose session expired without an
 * explicit logout.
 *
 * The logout route handles the deliberate case. This catches the browser that
 * was simply closed: without it those leads stay locked to someone who is no
 * longer signed in, and nobody else can call them.
 */
async function expiredSessionSweep() {
  const result = await runExpiredSessionSweep();
  if (result.released > 0) {
    console.log(
      `[cron] returned ${result.released} uncalled lead(s) from ${result.agents} expired session(s)`,
    );
  }
}

/**
 * TM-03 (Dev B, Day 4) — mark agents idle after the configured window without
 * qualifying activity, and close work sessions whose auth session has gone.
 *
 * This has to be a job. An agent who shuts their laptop sends no further
 * heartbeat, so nothing browser-side would ever mark them idle and their
 * shift would read as 100% active. The window comes from
 * `monitoring.config.inactivityMinutes` (AD-07), not a constant.
 */
async function idleSweep() {
  const result = await runIdleSweep();
  if (result.markedIdle > 0 || result.closed > 0) {
    console.log(
      `[cron] idle sweep: ${result.markedIdle} marked idle, ${result.closed} work session(s) closed`,
    );
  } else if (process.env.CRON_VERBOSE === "true") {
    console.log("[cron] idle sweep tick — nothing due");
  }
}

/**
 * CL-07 — remind agents about callbacks that have come due, and mark ones left
 * an hour past their time as missed.
 *
 * Server-side for the same reason the auto-assign sweep is: a callback promised
 * for 3pm must fire whether or not the agent has the tab open. Reminders are
 * guarded by `callbacks.reminded_at` so a due callback notifies once, not every
 * minute until it is actioned.
 *
 * Deliberately never reassigns or releases the lead — a missed callback is the
 * agent's to fix, not a reason to move a lead out from under them.
 */
async function callbackSweep() {
  const result = await runCallbackSweep();
  if (result.due > 0 || result.missed > 0) {
    console.log(
      `[cron] callbacks: ${result.due} reminder(s) sent, ${result.missed} marked missed`,
    );
  }
}

export function startCronJobs() {
  if (process.env.ENABLE_CRON === "false") {
    console.log("[cron] disabled on this process (ENABLE_CRON=false)");
    return;
  }

  tasks.push(
    cron.schedule("* * * * *", () => {
      void autoAssignSweep().catch((err) =>
        console.error("[cron] auto-assign sweep failed:", err),
      );
    }),
  );

  tasks.push(
    cron.schedule("* * * * *", () => {
      void idleSweep().catch((err) =>
        console.error("[cron] idle sweep failed:", err),
      );
    }),
  );

  tasks.push(
    cron.schedule("* * * * *", () => {
      void expiredSessionSweep().catch((err) =>
        console.error("[cron] expired-session sweep failed:", err),
      );
    }),
  );

  tasks.push(
    cron.schedule("* * * * *", () => {
      void callbackSweep().catch((err) =>
        console.error("[cron] callback sweep failed:", err),
      );
    }),
  );

  console.log(
    "[cron] registered 4 jobs: lead auto-assign sweep, idle sweep, expired-session lead return, callback reminders",
  );
}

export function stopCronJobs() {
  for (const task of tasks) void task.stop();
  tasks.length = 0;
}
