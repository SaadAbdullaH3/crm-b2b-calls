import { requirePermission } from "@/lib/auth/rbac";
import { ok } from "@/lib/api";
import { parseReportRequest, reportEnvelope } from "@/server/reports/request";
import { getPunctualityReport } from "@/server/reports/punctuality";

/**
 * MG-07 Punctuality — first login against the configured shift start.
 *
 * TM-05: first login, lateness and session count only. No active, idle, break
 * or productivity value appears here; a punctuality report is not a back door
 * into monitoring metrics.
 */
export const GET = requirePermission("reports.view", async (req) => {
  const parsed = parseReportRequest(req);
  if (!parsed.ok) return parsed.res;

  const data = await getPunctualityReport(parsed.value.range, parsed.value.filters);
  return ok(reportEnvelope(parsed.value, data));
});
