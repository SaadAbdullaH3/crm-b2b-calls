import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth/rbac";
import { ok } from "@/lib/api";

/**
 * CL-05 — the outcome list the disposition modal renders.
 *
 * Served from `dispositions` rather than hard-coded in the client so the
 * behaviour flags (`requiresCallback`, `blocksCalling`) come from the same rows
 * the server enforces against. A modal that disagrees with the API about which
 * outcome needs a callback is how a required field becomes optional.
 */
export const GET = requireAuth(async () => {
  const dispositions = await prisma.disposition.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      code: true,
      label: true,
      description: true,
      isFollowUp: true,
      requiresCallback: true,
      blocksCalling: true,
    },
  });

  return ok({ dispositions });
});
