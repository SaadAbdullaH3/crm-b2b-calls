import cron, { type ScheduledTask } from "node-cron";

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

/** Day 4 (Dev A) — LA-05: auto-assign requests older than 5 minutes. */
async function autoAssignSweep() {
  // Day 4 implementation:
  //   1. SELECT ... FROM lead_requests
  //        WHERE status = 'PENDING' AND auto_assign_at <= now()
  //   2. For each, run the assignment transaction (see the Day 1 Session Log
  //      entry in .claude/CLAUDE.md for the exact recipe).
  //   3. Emit EVENTS.REQUEST_RESOLVED with resolvedBy: "SYSTEM".
  if (process.env.CRON_VERBOSE === "true") {
    console.log("[cron] auto-assign sweep tick (no-op until Day 4)");
  }
}

/** Day 4 (Dev B) — TM-03: mark agents idle after 5 minutes without a heartbeat. */
async function idleSweep() {
  // Dev B's Monitoring Engine fills this in. Left registered so the wiring is
  // proven on Day 1 and they only have to write the body.
  if (process.env.CRON_VERBOSE === "true") {
    console.log("[cron] idle sweep tick (no-op until Dev B's Day 4)");
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

  console.log("[cron] registered 2 jobs: lead auto-assign sweep, idle sweep");
}

export function stopCronJobs() {
  for (const task of tasks) void task.stop();
  tasks.length = 0;
}
