import { readFile } from "node:fs/promises";
import { z } from "zod";
import { ImportStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, badRequest, notFound, conflict, parseBody } from "@/lib/api";
import { parseWorkbook, ImportParseError } from "@/lib/import/parse";
import { loadMappingTargets } from "@/lib/import/load-targets";
import { IGNORE_COLUMN } from "@/lib/import/target-fields";
import { analyzeRows, type ColumnMapping } from "@/lib/import/analyze";

/**
 * LM-02 — save the column mapping, then run validation and duplicate detection
 * over the whole file (LM-03/04/05).
 *
 * Re-reads the stored .xlsx rather than trusting anything the browser sends
 * back: the client only ever supplies the mapping, never the row data.
 *
 * Still writes nothing to `leads`. The output is `lead_import_rows` — every row
 * with a verdict — which Day 3's summary screen, duplicate resolution and error
 * export all read from.
 */

const MappingSchema = z.object({
  /** Column index (as a string) -> target key, or the ignore sentinel. */
  mapping: z.record(z.string().regex(/^\d+$/), z.string().min(1)),
  sourceLabel: z.string().max(120).trim().nullable().optional(),
});

export const POST = requirePermission("leads.import", async (req, { params }) => {
  const id = params?.id as string;

  const parsed = await parseBody(req, MappingSchema);
  if (!parsed.success) return parsed.res;
  const { mapping, sourceLabel } = parsed.data;

  const record = await prisma.leadImport.findUnique({ where: { id } });
  if (!record) return notFound("No such import.");
  if (!record.storedPath) {
    return conflict("The uploaded file for this import is no longer available.");
  }
  if (record.status === ImportStatus.COMPLETED) {
    return conflict("This import has already been committed and cannot be re-mapped.");
  }

  const targets = await loadMappingTargets();
  const targetKeys = new Set(targets.map((t) => t.key));

  // Reject unknown targets rather than silently dropping the column: a mapping
  // that points at a dynamic field an Admin retired mid-import should be an
  // error Management sees, not data that vanishes.
  for (const [index, key] of Object.entries(mapping)) {
    if (key !== IGNORE_COLUMN && !targetKeys.has(key)) {
      return badRequest(`Column ${index} is mapped to an unknown field "${key}".`);
    }
  }

  const assigned = Object.values(mapping).filter((k) => k !== IGNORE_COLUMN);
  const duplicated = assigned.filter((k, i) => assigned.indexOf(k) !== i);
  if (duplicated.length) {
    return badRequest(
      `Each CRM field can only be mapped once. Mapped more than once: ${[...new Set(duplicated)].join(", ")}.`,
    );
  }

  let sheet;
  try {
    sheet = await parseWorkbook(await readFile(record.storedPath));
  } catch (e) {
    if (e instanceof ImportParseError) return badRequest(e.message);
    throw e;
  }

  await prisma.leadImport.update({
    where: { id },
    data: {
      status: ImportStatus.VALIDATING,
      columnMapping: mapping as Prisma.InputJsonValue,
      ...(sourceLabel !== undefined ? { sourceLabel } : {}),
      startedAt: new Date(),
    },
  });

  try {
    const { rows, summary } = await analyzeRows({
      rows: sheet.rows,
      mapping: mapping as ColumnMapping,
      targets,
    });

    // Re-mapping replaces the previous verdicts wholesale; a stale row from an
    // earlier mapping would corrupt Day 3's counts.
    await prisma.leadImportRow.deleteMany({ where: { importId: id } });

    const CHUNK = 1000;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await prisma.leadImportRow.createMany({
        data: rows.slice(i, i + CHUNK).map((r) => ({
          importId: id,
          rowNumber: r.rowNumber,
          data: r.data as Prisma.InputJsonValue,
          status: r.status,
          issues: r.issues as Prisma.InputJsonValue,
          duplicateOfLeadId: r.duplicateOfLeadId,
          duplicateOfRowNumber: r.duplicateOfRowNumber,
          duplicateMatchedOn: (r.duplicateMatchedOn ?? undefined) as Prisma.InputJsonValue,
        })),
      });
    }

    const updated = await prisma.leadImport.update({
      where: { id },
      data: {
        status: ImportStatus.PENDING_REVIEW,
        totalRows: summary.totalRows,
        validRows: summary.readyRows,
        duplicateRows: summary.duplicateRows,
        missingInfoRows: summary.missingInfoRows,
        invalidPhoneRows: summary.invalidPhoneRows,
      },
    });

    return ok({ import: updated, summary });
  } catch (e) {
    // Leave a failed analysis visibly failed rather than stuck in VALIDATING.
    await prisma.leadImport.update({
      where: { id },
      data: { status: ImportStatus.FAILED },
    });
    throw e;
  }
});
