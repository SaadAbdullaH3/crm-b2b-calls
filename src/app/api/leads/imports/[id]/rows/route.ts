import { ImportRowStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok } from "@/lib/api";

/**
 * LM-03 — the rows behind the validation summary, paginated.
 *
 * Defaults to rows that need attention, because that is what the review screen
 * opens on; `?status=` narrows further and `?status=ALL` shows everything.
 */
export const GET = requirePermission("leads.import", async (req, { params }) => {
  const id = params?.id as string;
  const url = new URL(req.url);

  const status = url.searchParams.get("status");
  const take = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 500);
  const skip = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);

  const where =
    status === "ALL"
      ? { importId: id }
      : status && status in ImportRowStatus
        ? { importId: id, status: status as ImportRowStatus }
        : { importId: id, NOT: { status: ImportRowStatus.READY } };

  const [rows, total] = await Promise.all([
    prisma.leadImportRow.findMany({
      where,
      orderBy: { rowNumber: "asc" },
      skip,
      take,
      include: {
        duplicateOfLead: {
          select: {
            id: true,
            companyName: true,
            contactName: true,
            phoneE164: true,
            email: true,
            assignedToId: true,
          },
        },
      },
    }),
    prisma.leadImportRow.count({ where }),
  ]);

  return ok({ rows, total, offset: skip, limit: take });
});
