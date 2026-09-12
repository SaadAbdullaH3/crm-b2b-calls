import { DispositionCode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok } from "@/lib/api";
import { REPORT_SCOPES } from "@/server/reports/range";
import { listSources } from "@/server/reports/sources";
import { REPORTABLE_AGENT_WHERE } from "@/server/reports/definitions";

/**
 * Everything the report screen's filter controls need, in one request:
 * the scopes this backend actually supports, the agents that can be filtered
 * on, the source labels in use, and the outcome codes.
 *
 * Served rather than hard-coded so the frontend's dropdowns cannot offer a
 * scope the backend rejects, or miss a source label that appeared after an
 * import.
 */
export const GET = requirePermission("reports.view", async () => {
  const [agents, sources] = await Promise.all([
    prisma.user.findMany({
      where: REPORTABLE_AGENT_WHERE,
      select: { id: true, fullName: true, isActive: true },
      orderBy: { fullName: "asc" },
    }),
    listSources(),
  ]);

  return ok({
    scopes: REPORT_SCOPES,
    agents,
    sources,
    dispositions: Object.values(DispositionCode),
  });
});
