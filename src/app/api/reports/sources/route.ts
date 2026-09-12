import { requirePermission } from "@/lib/auth/rbac";
import { ok } from "@/lib/api";
import { parseReportRequest, reportEnvelope } from "@/server/reports/request";
import { getSourceReport } from "@/server/reports/sources";

/** Lead Source report — imported / assigned / worked / contacted / qualified. */
export const GET = requirePermission("reports.view", async (req) => {
  const parsed = parseReportRequest(req);
  if (!parsed.ok) return parsed.res;

  const data = await getSourceReport(parsed.value.range, parsed.value.filters);
  return ok(reportEnvelope(parsed.value, data));
});
