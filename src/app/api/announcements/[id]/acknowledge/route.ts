import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth/rbac";
import { ok, notFound, conflict } from "@/lib/api";

/**
 * CM-06 — acknowledge an announcement.
 *
 * Only a resolved recipient may acknowledge, and only once. The upsert makes a
 * double-click idempotent rather than a unique-constraint error.
 */
export const POST = requireAuth(async (_req, { user, params }) => {
  const announcementId = params?.id as string;

  const recipient = await prisma.announcementRecipient.findUnique({
    where: { announcementId_userId: { announcementId, userId: user.id } },
    include: { announcement: { select: { requiresAcknowledgement: true } } },
  });

  if (!recipient) return notFound("No such announcement.");
  if (!recipient.announcement.requiresAcknowledgement) {
    return conflict("This announcement does not require acknowledgement.");
  }

  const ack = await prisma.announcementAcknowledgement.upsert({
    where: { announcementId_userId: { announcementId, userId: user.id } },
    create: { announcementId, userId: user.id },
    update: {},
  });

  return ok({ acknowledgedAt: ack.acknowledgedAt });
});
