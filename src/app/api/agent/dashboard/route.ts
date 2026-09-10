import { requirePermission } from "@/lib/auth/rbac";
import { ok } from "@/lib/api";
import { getAgentDashboard } from "@/server/dashboard/agent-metrics";

/**
 * The agent's own dashboard.
 *
 * TM-05: the payload carries no Active Time, Idle Time, Break/Pause Time or
 * Productivity %. That is enforced by `agent-metrics.ts` never importing the
 * monitoring engine at all, rather than by filtering fields out here — a filter
 * is one forgotten field away from leaking.
 *
 * Self-scoped with no userId parameter: an agent can only ever read their own
 * numbers, and there is no argument that would widen it.
 */
export const GET = requirePermission("dashboard.agent", async (_req, { user }) => {
  const dashboard = await getAgentDashboard(user.id);
  return ok({ dashboard });
});
