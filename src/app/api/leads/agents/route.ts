import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok } from "@/lib/api";

/**
 * Agents who can be given leads, for the manual assignment picker.
 *
 * Exists because Management runs assignment but does NOT hold
 * `admin.users.manage`, so Dev B's /api/admin/users is a 403 for them. Gated on
 * `leads.assign` instead, and returns only what the picker needs — id, name,
 * and how many leads they currently hold.
 *
 * "Can be given leads" is defined by permission, not by role name: any role
 * granted `leads.read.own` can hold and call leads, so an Admin who creates a
 * second calling role gets it here for free.
 *
 * Roles that also hold `leads.approve` are excluded. The Admin role is granted
 * every permission, `leads.read.own` included, so without this it appears in
 * the assign-to picker alongside the real agents — and leads handed to the
 * person who administers the pipeline sit outside every call list. Whoever
 * approves lead requests is not a target for them.
 */
export const GET = requirePermission("leads.assign", async () => {
  const agents = await prisma.user.findMany({
    where: {
      isActive: true,
      role: {
        permissions: { some: { permission: { key: "leads.read.own" } } },
        NOT: { permissions: { some: { permission: { key: "leads.approve" } } } },
      },
    },
    orderBy: { fullName: "asc" },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: { select: { name: true, label: true } },
      _count: { select: { leadsAssigned: true } },
    },
  });

  return ok({
    agents: agents.map((a) => ({
      id: a.id,
      fullName: a.fullName,
      email: a.email,
      roleLabel: a.role.label,
      currentLeadCount: a._count.leadsAssigned,
    })),
  });
});
