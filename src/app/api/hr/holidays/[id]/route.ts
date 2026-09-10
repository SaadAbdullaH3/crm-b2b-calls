import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, notFound } from "@/lib/api";

/**
 * HR-05 — remove a holiday.
 *
 * A real delete, unlike HR documents and history. A holiday is a forward-
 * looking calendar entry rather than a record of something that happened, and
 * leave already taken is unaffected: `leave_requests.days` was computed and
 * stored at submission precisely so that editing the calendar later cannot
 * rewrite how many days someone took.
 */
export const DELETE = requirePermission("hr.holidays.manage", async (_req, { params }) => {
  const id = params?.id as string;

  const holiday = await prisma.holiday.findUnique({ where: { id } });
  if (!holiday) return notFound("No such holiday.");

  await prisma.holiday.delete({ where: { id } });
  return ok({ deleted: true, id });
});
