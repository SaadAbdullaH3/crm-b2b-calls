import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, notFound, conflict, parseBody, isUniqueViolation } from "@/lib/api";

/** AD-03 — rename, re-describe, replace membership, or delete one group. */

const UpdateGroupSchema = z.object({
  name: z.string().min(1).max(80).trim().optional(),
  description: z.string().max(400).trim().nullable().optional(),
  /** When present, replaces the whole membership list. */
  memberIds: z.array(z.string().min(1)).optional(),
});

export const PATCH = requirePermission(
  "admin.groups.manage",
  async (req, { user: actor, params }) => {
    const id = params?.id as string;
    const parsed = await parseBody(req, UpdateGroupSchema);
    if (!parsed.success) return parsed.res;
    const { name, description, memberIds } = parsed.data;

    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) return notFound("No such group.");

    if (memberIds) {
      const ids = [...new Set(memberIds)];
      if (ids.length > 0) {
        const found = await prisma.user.count({ where: { id: { in: ids } } });
        if (found !== ids.length) return conflict("One or more users do not exist.");
      }
    }

    try {
      const updated = await prisma.$transaction(async (tx) => {
        await tx.group.update({
          where: { id },
          data: {
            ...(name !== undefined ? { name } : {}),
            ...(description !== undefined ? { description: description || null } : {}),
          },
        });

        if (memberIds) {
          const ids = [...new Set(memberIds)];
          await tx.groupMember.deleteMany({ where: { groupId: id } });
          if (ids.length > 0) {
            await tx.groupMember.createMany({
              data: ids.map((userId) => ({ groupId: id, userId, addedById: actor.id })),
            });
          }
        }

        return tx.group.findUnique({ where: { id }, include: { members: true } });
      });

      return ok({ group: updated });
    } catch (e) {
      if (isUniqueViolation(e)) return conflict("A group with that name already exists.");
      throw e;
    }
  },
);

export const DELETE = requirePermission(
  "admin.groups.manage",
  async (_req, { params }) => {
    const id = params?.id as string;
    const group = await prisma.group.findUnique({ where: { id } });
    if (!group) return notFound("No such group.");

    // Seeded groups may be renamed but not removed — Day 3 broadcast targets
    // and any saved report filters would be left pointing at nothing.
    if (group.isSystem) {
      return conflict("System groups cannot be deleted. Rename it instead.");
    }

    // Memberships cascade; the group itself is genuinely gone. Unlike users,
    // a group carries no audit history of its own.
    await prisma.group.delete({ where: { id } });
    return ok({ deleted: true, id });
  },
);
