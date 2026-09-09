import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok } from "@/lib/api";

/**
 * CM-04 — who this user may start a conversation with.
 *
 * Everyone active except self. The SRS lets agents message Management, HR and
 * each other, so there is no role restriction here; if that ever needs
 * narrowing it belongs in this one query rather than scattered through the UI.
 */
export const GET = requirePermission("comms.message", async (_req, { user }) => {
  const users = await prisma.user.findMany({
    where: { isActive: true, id: { not: user.id } },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: { select: { name: true, label: true } },
    },
    orderBy: { fullName: "asc" },
  });

  return ok({ users });
});
