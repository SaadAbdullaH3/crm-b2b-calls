import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, notFound } from "@/lib/api";
import { getParticipant } from "@/lib/conversations";

/** CM-07 — mark a conversation read up to now. */
export const POST = requirePermission("comms.message", async (_req, { user, params }) => {
  const conversationId = params?.id as string;

  const participant = await getParticipant(conversationId, user.id);
  if (!participant) return notFound("No such conversation.");

  await prisma.conversationParticipant.update({
    where: { conversationId_userId: { conversationId, userId: user.id } },
    data: { lastReadAt: new Date() },
  });

  return ok({ ok: true });
});
