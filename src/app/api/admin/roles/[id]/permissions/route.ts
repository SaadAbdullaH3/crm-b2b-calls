import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, badRequest, notFound, conflict, parseBody } from "@/lib/api";

/**
 * AD-02 — replace a role's permission set.
 *
 * Two invariants are enforced here, both protecting against a permanent
 * lockout or a silent breach of the SRS:
 *
 *  1. The admin role may not lose `admin.roles.manage`. That is the only key
 *     that reaches this endpoint, so dropping it would make the permission
 *     matrix unreachable and unfixable from inside the app.
 *
 *  2. TM-05 — the agent role may not be granted any `monitoring.*` key.
 *     Active/Idle/Break/Productivity are Management-only. The UI hides these
 *     checkboxes for the agent row, but the UI is not the boundary: without
 *     this check a crafted request would re-open the leak the whole build has
 *     been careful to keep closed.
 */

const SetPermissionsSchema = z.object({
  permissionIds: z.array(z.string().min(1)),
});

export const PUT = requirePermission(
  "admin.roles.manage",
  async (req, { params }) => {
    const roleId = params?.id as string;
    const parsed = await parseBody(req, SetPermissionsSchema);
    if (!parsed.success) return parsed.res;

    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) return notFound("No such role.");

    const ids = [...new Set(parsed.data.permissionIds)];
    const permissions = await prisma.permission.findMany({
      where: { id: { in: ids } },
      select: { id: true, key: true },
    });

    if (permissions.length !== ids.length) {
      return badRequest("One or more permission ids do not exist.");
    }

    const keys = new Set(permissions.map((p) => p.key));

    if (role.name === "admin" && !keys.has("admin.roles.manage")) {
      return conflict(
        "The Admin role must keep admin.roles.manage — removing it would make this screen unreachable.",
      );
    }

    if (role.name === "agent") {
      const monitoring = [...keys].filter((k) => k.startsWith("monitoring."));
      if (monitoring.length > 0) {
        return conflict(
          `TM-05: agents must not hold monitoring permissions (${monitoring.join(", ")}). ` +
            "Active, Idle, Break and Productivity metrics are Management-only.",
        );
      }
    }

    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId } }),
      prisma.rolePermission.createMany({
        data: ids.map((permissionId) => ({ roleId, permissionId })),
      }),
    ]);

    return ok({ roleId, granted: ids.length });
  },
);
