import { z } from "zod";
import { ImportStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, badRequest, notFound, conflict, parseBody } from "@/lib/api";
import { commitImport, UnresolvedDuplicatesError } from "@/lib/import/commit";

/**
 * Runs the reviewed import: creates and merges leads (LM-03 -> leads).
 *
 * LM-08 is enforced here rather than at upload: every import must carry a lead
 * source / campaign label, and this is the last point before rows become leads
 * that would otherwise be untraceable to a campaign.
 */

const CommitSchema = z.object({
  sourceLabel: z.string().min(1).max(120).trim().optional(),
});

export const POST = requirePermission("leads.import", async (req, { params }) => {
  const id = params?.id as string;

  const parsed = await parseBody(req, CommitSchema);
  if (!parsed.success) return parsed.res;

  const record = await prisma.leadImport.findUnique({ where: { id } });
  if (!record) return notFound("No such import.");

  if (record.status === ImportStatus.COMPLETED) {
    return conflict("This import has already been committed.");
  }
  if (record.status !== ImportStatus.PENDING_REVIEW && record.status !== ImportStatus.FAILED) {
    return conflict(
      `This import is ${record.status.toLowerCase().replace(/_/g, " ")}; map the columns and review it first.`,
    );
  }

  const sourceLabel = parsed.data.sourceLabel ?? record.sourceLabel;
  if (!sourceLabel) {
    return badRequest(
      "A lead source or campaign label is required before importing (LM-08).",
    );
  }
  if (sourceLabel !== record.sourceLabel) {
    await prisma.leadImport.update({ where: { id }, data: { sourceLabel } });
  }

  try {
    const result = await commitImport(id);
    const updated = await prisma.leadImport.findUniqueOrThrow({ where: { id } });
    return ok({ import: updated, result });
  } catch (e) {
    if (e instanceof UnresolvedDuplicatesError) return conflict(e.message);
    throw e;
  }
});
