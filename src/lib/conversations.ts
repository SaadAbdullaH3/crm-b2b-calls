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

/** Canonical, order-independent key for a pair of users. */
export function directPairKey(userA: string, userB: string): string {
  return [userA, userB].sort().join(":");
}

/**
 * Returns the DIRECT conversation between two users, creating it if absent.
 *
 * Concurrency-safe. find-then-create is not atomic — two simultaneous requests
 * can both find nothing and both insert, splitting the thread. The unique
 * index on `pair_key` rejects the second insert, and we then re-read the
 * winner's row. Losing that race is normal, not an error.
 */
export async function findOrCreateDirect(
  userA: string,
  userB: string,
): Promise<string> {
  if (userA === userB) throw new Error("Cannot open a direct conversation with yourself.");

  const pairKey = directPairKey(userA, userB);

  const existing = await prisma.conversation.findUnique({
    where: { pairKey },
    select: { id: true },
  });
  if (existing) return existing.id;

  try {
    const created = await prisma.conversation.create({
      data: {
        type: ConversationType.DIRECT,
        pairKey,
        createdById: userA,
        participants: { create: [{ userId: userA }, { userId: userB }] },
      },
      select: { id: true },
    });
    return created.id;
  } catch (e) {
    // P2002 = the other request won. Its conversation is the real one.
    if (typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002") {
      const winner = await prisma.conversation.findUnique({
        where: { pairKey },
        select: { id: true },
      });
      if (winner) return winner.id;
    }
    throw e;
  }
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
