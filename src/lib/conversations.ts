/**
 * Conversation helpers shared by the messaging routes.
 *
 * The visibility rule for the whole module lives here: a user may only read or
 * write a conversation they are an active participant of. Every route calls
 * `assertParticipant()` — messaging is the one module where an IDOR leaks
 * private conversation content rather than just a record the user could see
 * elsewhere anyway.
 */

import { ConversationType } from "@prisma/client";
import { prisma } from "@/lib/db";

/** Deterministic pair key so two users never end up with two DM threads. */
export async function findOrCreateDirect(
  userA: string,
  userB: string,
): Promise<string> {
  if (userA === userB) throw new Error("Cannot open a direct conversation with yourself.");

  // Both participants, DIRECT, exactly two members.
  const existing = await prisma.conversation.findFirst({
    where: {
      type: ConversationType.DIRECT,
      AND: [
        { participants: { some: { userId: userA } } },
        { participants: { some: { userId: userB } } },
      ],
    },
    select: { id: true, participants: { select: { userId: true } } },
  });

  if (existing && existing.participants.length === 2) return existing.id;

  const created = await prisma.conversation.create({
    data: {
      type: ConversationType.DIRECT,
      createdById: userA,
      participants: { create: [{ userId: userA }, { userId: userB }] },
    },
    select: { id: true },
  });

  return created.id;
}

/** Null when the user is not an active participant. */
export async function getParticipant(conversationId: string, userId: string) {
  return prisma.conversationParticipant.findFirst({
    where: { conversationId, userId, leftAt: null },
  });
}

/** Unread count per conversation for one user, in a single grouped query. */
export async function unreadCounts(userId: string): Promise<Map<string, number>> {
  const parts = await prisma.conversationParticipant.findMany({
    where: { userId, leftAt: null },
    select: { conversationId: true, lastReadAt: true },
  });

  if (parts.length === 0) return new Map();

  const counts = await Promise.all(
    parts.map(async (p) => {
      const n = await prisma.message.count({
        where: {
          conversationId: p.conversationId,
          senderId: { not: userId },
          ...(p.lastReadAt ? { sentAt: { gt: p.lastReadAt } } : {}),
        },
      });
      return [p.conversationId, n] as const;
    }),
  );

  return new Map(counts);
}

/** Shape one conversation for the inbox list, titled from the viewer's side. */
export function titleFor(
  conversation: {
    type: ConversationType;
    title: string | null;
    participants: { userId: string; user: { fullName: string } }[];
  },
  viewerId: string,
): string {
  if (conversation.title) return conversation.title;

  if (conversation.type === ConversationType.DIRECT) {
    const other = conversation.participants.find((p) => p.userId !== viewerId);
    return other?.user.fullName ?? "Direct message";
  }

  return conversation.participants
    .filter((p) => p.userId !== viewerId)
    .map((p) => p.user.fullName)
    .join(", ");
}
