import { requirePermission } from "@/lib/auth/rbac";
import { ok } from "@/lib/api";
import { listCallbacksForAgent } from "@/server/calls/callbacks";

/** CL-07 — the agent's callback/task view, grouped into working buckets. */
export const GET = requirePermission("callbacks.manage", async (_req, { user }) => {
  const grouped = await listCallbacksForAgent(user.id);
  return ok({
    callbacks: grouped,
    counts: {
      overdue: grouped.overdue.length,
      due: grouped.due.length,
      upcoming: grouped.upcoming.length,
      completed: grouped.completed.length,
    },
  });
});
