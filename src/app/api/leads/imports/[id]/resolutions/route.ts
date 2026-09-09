import { z } from "zod";
import { DuplicateResolution, ImportRowStatus, ImportStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, badRequest, notFound, conflict, parseBody } from "@/lib/api";

/**
 * LM-06 — record Management's decision for detected duplicates.
 *
 * Accepts a batch so "reject all duplicates" is one request rather than one per
 * row; a 400-row file of duplicates should not need 400 round trips.
 */

const ResolutionsSchema = z.object({
  /** Explicit per-row decisions, keyed by row number. */
  resolutions: z
    .array(
      z.object({
        rowNumber: z.number().int().positive(),
        resolution: z.nativeEnum(DuplicateResolution),
      }),
    )
    .max(5000)
    .optional(),
  /** Applies to every duplicate row still PENDING. */
  applyToAllPending: z.nativeEnum(DuplicateResolution).optional(),
});

export const POST = requirePermission("leads.import", async (req, { params }) => {
  const id = params?.id as string;

  const parsed = await parseBody(req, ResolutionsSchema);
  if (!parsed.success) return parsed.res;
  const { resolutions, applyToAllPending } = parsed.data;

  if (!resolutions?.length && !applyToAllPending) {
    return badRequest("Provide either `resolutions` or `applyToAllPending`.");
  }

  const record = await prisma.leadImport.findUnique({ where: { id } });
  if (!record) return notFound("No such import.");
  if (record.status === ImportStatus.COMPLETED) {
    return conflict("This import has already been committed; decisions can no longer change.");
  }

  let updated = 0;

  if (applyToAllPending) {
    const res = await prisma.leadImportRow.updateMany({
      where: {
        importId: id,
        status: ImportRowStatus.DUPLICATE,
        resolution: DuplicateResolution.PENDING,
      },
      data: { resolution: applyToAllPending },
    });
    updated += res.count;
  }

  if (resolutions?.length) {
    // updateMany rather than update: scoping by importId as well as rowNumber
    // stops a row number from one import touching another's rows.
    for (const r of resolutions) {
      const res = await prisma.leadImportRow.updateMany({
        where: { importId: id, rowNumber: r.rowNumber, status: ImportRowStatus.DUPLICATE },
        data: { resolution: r.resolution },
      });
      updated += res.count;
    }
  }

  const pending = await prisma.leadImportRow.count({
    where: {
      importId: id,
      status: ImportRowStatus.DUPLICATE,
      resolution: DuplicateResolution.PENDING,
    },
  });

  return ok({ updated, pendingDuplicates: pending });
});
