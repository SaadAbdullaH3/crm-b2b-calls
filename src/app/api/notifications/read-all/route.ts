import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth/rbac";
import { ok } from "@/lib/api";

/** Mark every unread notification read for the signed-in user. */
export const POST = requireAuth(async (_req, { user }) => {
  const result = await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });

  return ok({ marked: result.count });
});
