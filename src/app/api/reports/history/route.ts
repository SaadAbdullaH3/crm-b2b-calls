import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok } from "@/lib/api";
import { titleFor } from "@/server/reports/history";

/**
 * RP-04 — the list of reports that were actually generated.
 *
 * Metadata only: what was generated, for which period, by whom, and who signed
 * it off. The file itself needs `reports.export` and goes through
 * `/api/reports/history/[id]` — seeing that a report exists is a weaker thing
 * than walking away with the contact list inside it.
 */
export const GET = requirePermission("reports.view", async (req) => {
  const url = new URL(req.url);
  const type = url.searchParams.get("type");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50) || 50, 1), 200);

  const records = await prisma.reportGenerated.findMany({
    where: type ? { reportType: type } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      generatedBy: { select: { id: true, fullName: true } },
      approvedBy: { select: { id: true, fullName: true } },
    },
  });

  return ok({
    reports: records.map((r) => ({
      id: r.id,
      reportType: r.reportType,
      title: titleFor(r.reportType),
      scope: r.scope,
      rangeLabel: r.rangeLabel,
      periodStart: r.periodStart.toISOString(),
      periodEnd: r.periodEnd.toISOString(),
      format: r.format,
      rowCount: r.rowCount,
      fileSize: r.fileSize,
      filters: r.filters,
      generatedAt: r.createdAt.toISOString(),
      generatedBy: r.generatedBy.fullName,
      approvedBy: r.approvedBy?.fullName ?? null,
      approvedAt: r.approvedAt?.toISOString() ?? null,
      /** A record whose file never landed cannot be downloaded; say so up front. */
      downloadable: Boolean(r.storedPath),
    })),
  });
});
