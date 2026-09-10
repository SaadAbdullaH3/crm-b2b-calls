import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok } from "@/lib/api";
import {
  resolveRange,
  getLeadTotals,
  getSourcePerformance,
  getAgentPerformance,
  getOutcomeMix,
} from "@/server/dashboard/metrics";

/**
 * SRS §8.1 — the Management dashboard payload.
 *
 * Gated on `dashboard.management`. The monitoring block inside it is gated
 * SEPARATELY on `monitoring.view`: an Admin who strips that key from
 * Management through AD-02 must actually stop seeing active/idle/productivity
 * here, not merely lose the /management/monitoring page. Checking the role
 * would have made that impossible.
 */
export const GET = requirePermission("dashboard.management", async (req, { user }) => {
  const scope = new URL(req.url).searchParams.get("scope") ?? "today";
  const range = resolveRange(scope);
  const canSeeMonitoring = user.permissions.includes("monitoring.view");

  const [leads, sources, agents, outcomes, pendingRequests, unreadCounts] =
    await Promise.all([
      getLeadTotals(),
      getSourcePerformance(),
      getAgentPerformance(range, canSeeMonitoring),
      getOutcomeMix(range),
      prisma.leadRequest.count({ where: { status: "PENDING" } }),
      prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    ]);

  return ok({
    scope,
    range: { from: range.from, to: range.to },
    canSeeMonitoring,
    leads,
    sources,
    agents,
    outcomes,
    pendingRequests,
    unreadNotifications: unreadCounts,
    generatedAt: new Date().toISOString(),
  });
});
