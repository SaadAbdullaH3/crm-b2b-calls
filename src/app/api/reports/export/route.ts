import { ReportFormat } from "@prisma/client";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, badRequest } from "@/lib/api";
import { parseReportRequest } from "@/server/reports/request";
import { REPORT_KINDS, type ReportKind } from "@/server/reports/export";
import { generateReport } from "@/server/reports/history";

/**
 * RP-01 — generate an export.
 *
 * POST, because it creates something: a file on disk and a `reports_generated`
 * row. The filters ride in the QUERY STRING rather than a JSON body so this
 * endpoint can use Dev A's `parseReportRequest` unchanged — one parser for all
 * five report endpoints and this one, which is the entire point of agreeing a
 * contract. A second parser here is a second definition of "this week".
 *
 * It returns JSON, not the file. The download then goes through the history
 * route, so the bytes a user gets now and the bytes they get from the archive
 * in March come off exactly the same code path — RP-04's "accessible
 * afterwards" is proven by every export, not by a separate feature.
 *
 * Gated on `reports.export` rather than `reports.view`: a summary on screen is
 * a management overview, an export is the underlying data leaving the building.
 */
export const POST = requirePermission("reports.export", async (req, { user }) => {
  const url = new URL(req.url);

  const kind = (url.searchParams.get("kind") ?? "performance") as ReportKind;
  if (!REPORT_KINDS.includes(kind)) {
    return badRequest(`Unknown report "${kind}". Expected one of: ${REPORT_KINDS.join(", ")}.`);
  }

  const formatRaw = (url.searchParams.get("format") ?? "XLSX").toUpperCase();
  if (!(formatRaw in ReportFormat)) {
    return badRequest(`Unknown format "${formatRaw}". Expected XLSX or PDF.`);
  }
  const format = formatRaw as ReportFormat;

  const parsed = parseReportRequest(req);
  if (!parsed.ok) return parsed.res;

  const generated = await generateReport({
    kind,
    format,
    range: parsed.value.range,
    filters: parsed.value.filters,
    user: { id: user.id, fullName: user.fullName },
  });

  return ok({
    id: generated.id,
    fileName: generated.fileName,
    format,
    kind,
    rangeLabel: parsed.value.range.label,
    sizeBytes: generated.buffer.byteLength,
  });
});
