import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, badRequest, notFound, conflict, parseBody, isUniqueViolation } from "@/lib/api";

/**
 * AD-01 — edit / activate / deactivate one user.
 *
 * Two lockout guards live here. Both exist because the failure mode is
 * permanent: an Admin who deactivates themselves, or demotes the last
 * remaining Admin, locks the whole organisation out of configuration with no
 * in-app way back.
 */

const USER_SELECT = {
  id: true,
  email: true,
  fullName: true,
  employeeCode: true,
  phone: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  role: { select: { id: true, name: true, label: true } },
} as const;

/** Would this change leave the system with no active Admin? */
async function wouldOrphanAdmins(
  targetId: string,
  next: { roleId?: string; isActive?: boolean },
): Promise<boolean> {
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    include: { role: true },
  });
  if (!target || target.role.name !== "admin" || !target.isActive) return false;

  const stillAdmin =
    next.roleId !== undefined ? next.roleId === target.roleId : true;
  const stillActive = next.isActive !== undefined ? next.isActive : true;
  if (stillAdmin && stillActive) return false;

  const otherActiveAdmins = await prisma.user.count({
    where: { role: { name: "admin" }, isActive: true, id: { not: targetId } },
  });
  return otherActiveAdmins === 0;
}

export const GET = requirePermission("admin.users.manage", async (_req, { params }) => {
  const id = params?.id as string;
  const user = await prisma.user.findUnique({ where: { id }, select: USER_SELECT });
  if (!user) return notFound("No such user.");
  return ok({ user });
});

const UpdateUserSchema = z.object({
  email: z.string().email().transform((s) => s.toLowerCase().trim()).optional(),
  fullName: z.string().min(1).max(120).trim().optional(),
  roleId: z.string().min(1).optional(),
  employeeCode: z.string().max(40).trim().nullable().optional(),
  phone: z.string().max(40).trim().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const PATCH = requirePermission(
  "admin.users.manage",
  async (req, { user: actor, params }) => {
    const id = params?.id as string;
    const parsed = await parseBody(req, UpdateUserSchema);
    if (!parsed.success) return parsed.res;
    const data = parsed.data;

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return notFound("No such user.");

    if (id === actor.id && data.isActive === false) {
      return conflict("You cannot deactivate your own account.");
    }

    if (data.roleId) {
      const role = await prisma.role.findUnique({ where: { id: data.roleId } });
      if (!role) return badRequest("That role does not exist.");
    }

    if (await wouldOrphanAdmins(id, data)) {
      return conflict(
        "This is the last active Admin. Promote another user to Admin first.",
      );
    }

    try {
      const updated = await prisma.user.update({
        where: { id },
        data: {
          ...data,
          employeeCode: data.employeeCode === "" ? null : data.employeeCode,
          phone: data.phone === "" ? null : data.phone,
        },
        select: USER_SELECT,
      });

      // A deactivated account must lose its live sessions immediately —
      // otherwise the flag only takes effect at the next login, and an already
      // signed-in user keeps full access.
      if (data.isActive === false) {
        await prisma.session.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }

      return ok({ user: updated });
    } catch (e) {
      if (isUniqueViolation(e)) {
        return conflict("That email address or employee code is already in use.");
      }
      throw e;
    }
  },
);

/**
 * Deactivate, not delete. Users are referenced by audit_log, calls,
 * lead_assignments and HR records; a hard delete would either cascade history
 * away or fail on a foreign key. AD-01 says "deactivate", and audit integrity
 * (AU-01) requires the row to survive.
 */
export const DELETE = requirePermission(
  "admin.users.manage",
  async (_req, { user: actor, params }) => {
    const id = params?.id as string;

    if (id === actor.id) {
      return conflict("You cannot deactivate your own account.");
    }

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return notFound("No such user.");

    if (await wouldOrphanAdmins(id, { isActive: false })) {
      return conflict(
        "This is the last active Admin. Promote another user to Admin first.",
      );
    }

    const [user] = await prisma.$transaction([
      prisma.user.update({
        where: { id },
        data: { isActive: false },
        select: USER_SELECT,
      }),
      prisma.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return ok({ user, deactivated: true });
  },
);
