import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok } from "@/lib/api";

/**
 * AD-02 — the role x permission matrix.
 *
 * Returns every role with its granted permission keys, plus the full
 * permission catalogue grouped by module, which is everything the matrix
 * screen needs in one round trip.
 *
 * Note the source of truth: PERMISSIONS in permissions.ts is the SEED
 * baseline. Once this screen exists, `role_permissions` in the database is
 * authoritative — which is why requirePermission() resolves keys from the DB
 * rather than from that file.
 */

export const GET = requirePermission("admin.roles.manage", async () => {
  const [roles, permissions, userCounts] = await Promise.all([
    prisma.role.findMany({
      include: { permissions: { select: { permissionId: true } } },
      orderBy: { name: "asc" },
    }),
    prisma.permission.findMany({ orderBy: [{ module: "asc" }, { key: "asc" }] }),
    prisma.user.groupBy({
      by: ["roleId"],
      _count: { _all: true },
      where: { isActive: true },
    }),
  ]);

  const countByRole = new Map(userCounts.map((c) => [c.roleId, c._count._all]));

  const modules = [...new Set(permissions.map((p) => p.module))].map((module) => ({
    module,
    permissions: permissions
      .filter((p) => p.module === module)
      .map((p) => ({ id: p.id, key: p.key, description: p.description })),
  }));

  return ok({
    roles: roles.map((r) => ({
      id: r.id,
      name: r.name,
      label: r.label,
      description: r.description,
      isSystem: r.isSystem,
      activeUsers: countByRole.get(r.id) ?? 0,
      permissionIds: r.permissions.map((p) => p.permissionId),
    })),
    modules,
  });
});
