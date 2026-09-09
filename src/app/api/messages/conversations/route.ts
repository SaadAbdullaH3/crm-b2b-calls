import { z } from "zod";
import { ConversationType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, badRequest, parseBody } from "@/lib/api";
import { findOrCreateDirect, unreadCounts, titleFor } from "@/lib/conversations";
import { userIdsByGroup } from "@/lib/notifications";

/**
 * CM-01 / CM-04 / CM-05 — the inbox, and starting a conversation.
 *
 * Everything is scoped to the signed-in user's own participation. There is no
 * "all conversations" view for any role, including Admin: CM-08 says messages
 * retain sender/recipients/timestamps for audit, not that an administrator can
 * browse everyone's private threads from the UI.
 */

export const GET = requirePermission("comms.message", async (_req, { user }) => {
  const conversations = await prisma.conversation.findMany({
    where: { participants: { some: { userId: user.id, leftAt: null } } },
    include: {
      participants: {
        where: { leftAt: null },
        include: { user: { select: { id: true, fullName: true, email: true } } },
      },
      messages: {
        orderBy: { sentAt: "desc" },
        take: 1,
        select: { body: true, sentAt: true, senderId: true },
      },
      group: { select: { id: true, name: true } },
    },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
  });

  const unread = await unreadCounts(user.id);

  return ok({
    conversations: conversations.map((c) => ({
      id: c.id,
      type: c.type,
      title: titleFor(c, user.id),
      group: c.group,
      participants: c.participants.map((p) => p.user),
      lastMessage: c.messages[0] ?? null,
      lastMessageAt: c.lastMessageAt,
      unreadCount: unread.get(c.id) ?? 0,
    })),
  });
});

const CreateSchema = z
  .object({
    type: z.nativeEnum(ConversationType).default(ConversationType.DIRECT),
    /** DIRECT: the other user. */
    userId: z.string().min(1).optional(),
    /** GROUP: explicit members, or a groupId to expand. */
    userIds: z.array(z.string().min(1)).optional(),
    groupId: z.string().min(1).optional(),
    title: z.string().max(120).trim().optional(),
  })
  .refine((v) => v.type !== ConversationType.DIRECT || Boolean(v.userId), {
    message: "A direct conversation needs userId.",
  });

export const POST = requirePermission("comms.message", async (req, { user }) => {
  const parsed = await parseBody(req, CreateSchema);
  if (!parsed.success) return parsed.res;
  const { type, userId, userIds, groupId, title } = parsed.data;

  if (type === ConversationType.DIRECT) {
    const other = await prisma.user.findFirst({
      where: { id: userId!, isActive: true },
      select: { id: true },
    });
    if (!other) return badRequest("That user does not exist or is inactive.");
    if (other.id === user.id) return badRequest("You cannot message yourself.");

    const id = await findOrCreateDirect(user.id, other.id);
    return ok({ conversationId: id }, 201);
  }

  // GROUP — from an AD-03 group, or an ad-hoc member list.
  let members = userIds ?? [];
  if (groupId) {
    const group = await prisma.group.findUnique({ where: { id: groupId } });
    if (!group) return badRequest("That group does not exist.");
    members = await userIdsByGroup(groupId);
  }

  members = [...new Set([...members, user.id])];
  if (members.length < 2) return badRequest("A group conversation needs at least two people.");

  const created = await prisma.conversation.create({
    data: {
      type: ConversationType.GROUP,
      title: title || null,
      groupId: groupId ?? null,
      createdById: user.id,
      participants: { create: members.map((id) => ({ userId: id })) },
    },
    select: { id: true },
  });

  return ok({ conversationId: created.id }, 201);
});
