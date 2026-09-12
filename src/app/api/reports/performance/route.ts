import { requirePermission } from "@/lib/auth/rbac";
import { ok } from "@/lib/api";
import { parseReportRequest, reportEnvelope } from "@/server/reports/request";
import { getPerformanceReport } from "@/server/reports/performance";

/**
 * Daily / Weekly / Monthly / 15-day / Custom — one aggregation, five scopes.
 *
 * They differ only in the date window, which is why there is one endpoint
 * rather than five. See docs/day7-reporting-api-contract.md.
 */
export const GET = requirePermission("reports.view", async (req) => {
  const parsed = parseReportRequest(req);
  if (!parsed.ok) return parsed.res;

  const data = await getPerformanceReport(parsed.value.range, parsed.value.filters);
  return ok(reportEnvelope(parsed.value, data));
});
