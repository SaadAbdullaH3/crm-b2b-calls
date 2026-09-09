import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, notFound, parseBody } from "@/lib/api";
import { getParticipant, titleFor } from "@/lib/conversations";
import { EVENTS, emitToUser } from "@/server/socket";
import { notify, NOTIFICATION } from "@/lib/notifications";

/**
 * CM-01 / CM-07 — read one conversation, and post into it.
 *
 * Both handlers gate on active participation. A non-participant gets 404
 * rather than 403: confirming that a conversation exists but is off-limits
 * leaks who is talking to whom.
 */

export const GET = requirePermission("comms.message", async (req, { user, params }) => {
  const conversationId = params?.id as string;

  const participant = await getParticipant(conversationId, user.id);
  if (!participant) return notFound("No such conversation.");

  const url = new URL(req.url);
  const search = url.searchParams.get("q")?.trim();

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      participants: {
        where: { leftAt: null },
        include: { user: { select: { id: true, fullName: true, email: true } } },
      },
      group: { select: { id: true, name: true } },
    },
  });
  if (!conversation) return notFound("No such conversation.");

  const messages = await prisma.message.findMany({
    where: {
      conversationId,
      // CM-07 searchable history.
      ...(search ? { body: { contains: search, mode: "insensitive" } } : {}),
    },
    orderBy: { sentAt: "asc" },
    take: 500,
    include: { sender: { select: { id: true, fullName: true } } },
  });

  return ok({
    conversation: {
      id: conversation.id,
      type: conversation.type,
      title: titleFor(conversation, user.id),
      group: conversation.group,
      participants: conversation.participants.map((p) => p.user),
    },
    messages,
    lastReadAt: participant.lastReadAt,
  });
});

const SendSchema = z.object({
  body: z.string().min(1).max(5000).trim(),
});

export const POST = requirePermission("comms.message", async (req, { user, params }) => {
  const conversationId = params?.id as string;

  const participant = await getParticipant(conversationId, user.id);
  if (!participant) return notFound("No such conversation.");

  const parsed = await parseBody(req, SendSchema);
  if (!parsed.success) return parsed.res;

  const others = await prisma.conversationParticipant.findMany({
    where: { conversationId, leftAt: null, userId: { not: user.id } },
    select: { userId: true },
  });

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: { conversationId, senderId: user.id, body: parsed.data.body },
      include: { sender: { select: { id: true, fullName: true } } },
    });

    // Denormalized for inbox ordering, and the sender has by definition read
    // their own message.
    await tx.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: created.sentAt },
    });
    await tx.conversationParticipant.update({
      where: { conversationId_userId: { conversationId, userId: user.id } },
      data: { lastReadAt: created.sentAt },
    });

    return created;
  });

  // Live push to the thread, plus a bell notification for the inbox.
  for (const { userId } of others) {
    emitToUser(userId, EVENTS.MESSAGE_NEW, {
      conversationId,
      messageId: message.id,
      senderId: user.id,
      senderName: user.fullName,
      preview: message.body.slice(0, 140),
      sentAt: message.sentAt.toISOString(),
    });

    await notify({
      userId,
      type: NOTIFICATION.MESSAGE,
      title: `Message from ${user.fullName}`,
      body: message.body.slice(0, 140),
      payload: { conversationId, messageId: message.id },
    });
  }

  return ok({ message }, 201);
});
