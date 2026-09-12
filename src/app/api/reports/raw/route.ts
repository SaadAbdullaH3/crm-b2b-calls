import { requirePermission } from "@/lib/auth/rbac";
import { ok } from "@/lib/api";
import { parseReportRequest, reportEnvelope } from "@/server/reports/request";
import { getRawReport } from "@/server/reports/raw";

/**
 * Row-level call data for the raw-data view and Excel/PDF export.
 *
 * Gated on `reports.export` rather than `reports.view`: a summary is a
 * management overview, but row-level data with contact names, phone numbers
 * and call notes is the underlying personal data. Someone allowed to read a
 * chart is not automatically allowed to walk out with the list.
 */
export const GET = requirePermission("reports.export", async (req) => {
  const parsed = parseReportRequest(req);
  if (!parsed.ok) return parsed.res;

  const data = await getRawReport(
    parsed.value.range,
    parsed.value.filters,
    parsed.value.page,
  );
  return ok(reportEnvelope(parsed.value, data));
});
