import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, badRequest, parseBody } from "@/lib/api";
import { findOrCreateDirect } from "@/lib/conversations";
import {
  notify,
  NOTIFICATION,
  userIdsByRole,
  userIdsByGroup,
  allActiveUserIds,
} from "@/lib/notifications";
import { EVENTS, emitToUser } from "@/server/socket";

/**
 * CM-02 — Management/HR broadcast to all agents, one agent, a selection, or a
 * group.
 *
 * Delivered as N separate DIRECT conversations rather than one shared thread.
 * That is deliberate: a reply to a broadcast should reach the sender only, not
 * every other recipient. A shared thread would turn "please update your call
 * notes" into a fifty-person group chat.
 */

const BroadcastSchema = z
  .object({
    target: z.enum(["all", "role", "group", "users"]),
    roleName: z.string().min(1).optional(),
    groupId: z.string().min(1).optional(),
    userIds: z.array(z.string().min(1)).optional(),
    body: z.string().min(1).max(5000).trim(),
  })
  .refine((v) => v.target !== "role" || Boolean(v.roleName), {
    message: "target 'role' needs roleName.",
  })
  .refine((v) => v.target !== "group" || Boolean(v.groupId), {
    message: "target 'group' needs groupId.",
  })
  .refine((v) => v.target !== "users" || (v.userIds?.length ?? 0) > 0, {
    message: "target 'users' needs at least one userId.",
  });

export const POST = requirePermission("comms.broadcast", async (req, { user }) => {
  const parsed = await parseBody(req, BroadcastSchema);
  if (!parsed.success) return parsed.res;
  const { target, roleName, groupId, userIds, body } = parsed.data;

  let recipients: string[] = [];
  switch (target) {
    case "all":
      recipients = await allActiveUserIds(user.id);
      break;
    case "role":
      recipients = await userIdsByRole(roleName!);
      break;
    case "group":
      recipients = await userIdsByGroup(groupId!);
      break;
    case "users": {
      const found = await prisma.user.findMany({
        where: { id: { in: userIds! }, isActive: true },
        select: { id: true },
      });
      recipients = found.map((u) => u.id);
      break;
    }
  }

  recipients = recipients.filter((id) => id !== user.id);
  if (recipients.length === 0) return badRequest("That target matches nobody active.");

  let delivered = 0;
  for (const recipientId of recipients) {
    const conversationId = await findOrCreateDirect(user.id, recipientId);

    const message = await prisma.$transaction(async (tx) => {
      const created = await tx.message.create({
        data: { conversationId, senderId: user.id, body },
      });
      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: created.sentAt },
      });
      return created;
    });

    emitToUser(recipientId, EVENTS.MESSAGE_NEW, {
      conversationId,
      messageId: message.id,
      senderId: user.id,
      senderName: user.fullName,
      preview: body.slice(0, 140),
      sentAt: message.sentAt.toISOString(),
    });

    await notify({
      userId: recipientId,
      type: NOTIFICATION.MESSAGE,
      title: `Message from ${user.fullName}`,
      body: body.slice(0, 140),
      payload: { conversationId, messageId: message.id, broadcast: true },
    });

    delivered++;
  }

  return ok({ delivered, target }, 201);
});

/** Targets the composer can offer: roles and groups with live member counts. */
export const GET = requirePermission("comms.broadcast", async () => {
  const [roles, groups] = await Promise.all([
    prisma.role.findMany({
      select: {
        name: true,
        label: true,
        _count: { select: { users: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.group.findMany({
      select: { id: true, name: true, _count: { select: { members: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const totalActive = await prisma.user.count({ where: { isActive: true } });

  return ok({
    roles: roles.map((r) => ({ name: r.name, label: r.label, users: r._count.users })),
    groups: groups.map((g) => ({ id: g.id, name: g.name, members: g._count.members })),
    totalActive,
  });
});
