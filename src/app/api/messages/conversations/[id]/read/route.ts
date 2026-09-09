import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, notFound, parseBody } from "@/lib/api";
import { getParticipant } from "@/lib/conversations";

/**
 * CM-07 — mark a conversation read.
 *
 * The client sends `upTo`: the timestamp of the newest message it actually
 * rendered. Using `now()` here instead would swallow anything that arrived
 * between the thread GET and this request — the user would never see those
 * messages, and the inbox would report nothing unread. In a call centre that
 * means a silently missed instruction from Management.
 *
 * `upTo` is clamped to now (a client cannot mark the future read) and never
 * moves `lastReadAt` backwards, so an out-of-order request cannot resurrect
 * already-read messages as unread.
 */

const ReadSchema = z.object({
  upTo: z.coerce.date().optional(),
});

export const POST = requirePermission("comms.message", async (req, { user, params }) => {
  const conversationId = params?.id as string;

  const participant = await getParticipant(conversationId, user.id);
  if (!participant) return notFound("No such conversation.");

  // Body is optional: a bare POST still means "read everything up to now",
  // which is the correct behaviour when the caller has no message list.
  const parsed = await parseBody(req, ReadSchema).catch(() => null);
  const requested = parsed?.success ? parsed.data.upTo : undefined;

  const now = new Date();
  let target = requested && requested < now ? requested : now;

  if (participant.lastReadAt && target < participant.lastReadAt) {
    target = participant.lastReadAt;
  }

  await prisma.conversationParticipant.update({
    where: { conversationId_userId: { conversationId, userId: user.id } },
    data: { lastReadAt: target },
  });

  return ok({ lastReadAt: target });
});
