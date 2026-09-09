import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, notFound } from "@/lib/api";
import { loadMappingTargets } from "@/lib/import/load-targets";
import { suggestTarget, IGNORE_COLUMN } from "@/lib/import/target-fields";

/**
 * One import: everything the column-mapping screen needs in a single request —
 * the detected headers, the available targets, and either the mapping already
 * saved or a suggestion for each column.
 */
export const GET = requirePermission("leads.import", async (_req, { params }) => {
  const id = params?.id as string;

  const record = await prisma.leadImport.findUnique({
    where: { id },
    include: { uploadedBy: { select: { id: true, fullName: true } } },
  });
  if (!record) return notFound("No such import.");

  const headers = Array.isArray(record.detectedColumns)
    ? (record.detectedColumns as string[])
    : [];

  const targets = await loadMappingTargets();

  // A saved mapping wins; otherwise suggest from the header text so Management
  // is confirming a guess rather than filling in ten empty selects.
  const saved = (record.columnMapping ?? null) as Record<string, string> | null;
  const mapping: Record<string, string> = {};
  headers.forEach((header, index) => {
    const key = String(index);
    mapping[key] = saved?.[key] ?? suggestTarget(header, targets);
  });

  const rowCounts = await prisma.leadImportRow.groupBy({
    by: ["status"],
    where: { importId: id },
    _count: { _all: true },
  });

  return ok({
    import: record,
    headers,
    targets,
    mapping,
    ignoreValue: IGNORE_COLUMN,
    rowCounts: Object.fromEntries(rowCounts.map((r) => [r.status, r._count._all])),
  });
});
