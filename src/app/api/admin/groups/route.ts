import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, conflict, parseBody, isUniqueViolation } from "@/lib/api";

/**
 * AD-03 — user groups. Also the addressing unit for Day 3's group messages
 * and broadcasts (CM-05).
 */

export const GET = requirePermission("admin.groups.manage", async () => {
  const groups = await prisma.group.findMany({
    include: {
      members: {
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              email: true,
              isActive: true,
              role: { select: { name: true, label: true } },
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });

  return ok({
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      description: g.description,
      isSystem: g.isSystem,
      createdAt: g.createdAt,
      members: g.members.map((m) => ({ ...m.user, addedAt: m.addedAt })),
    })),
  });
});

const CreateGroupSchema = z.object({
  name: z.string().min(1).max(80).trim(),
  description: z.string().max(400).trim().optional().nullable(),
  memberIds: z.array(z.string().min(1)).default([]),
});

export const POST = requirePermission(
  "admin.groups.manage",
  async (req, { user: actor }) => {
    const parsed = await parseBody(req, CreateGroupSchema);
    if (!parsed.success) return parsed.res;
    const { name, description, memberIds } = parsed.data;

    const ids = [...new Set(memberIds)];
    if (ids.length > 0) {
      const found = await prisma.user.count({ where: { id: { in: ids } } });
      if (found !== ids.length) return conflict("One or more users do not exist.");
    }

    try {
      const group = await prisma.group.create({
        data: {
          name,
          description: description || null,
          createdById: actor.id,
          members: {
            create: ids.map((userId) => ({ userId, addedById: actor.id })),
          },
        },
        include: { members: true },
      });
      return ok({ group }, 201);
    } catch (e) {
      if (isUniqueViolation(e)) return conflict("A group with that name already exists.");
      throw e;
    }
  },
);
