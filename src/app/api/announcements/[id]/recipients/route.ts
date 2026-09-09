import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, notFound } from "@/lib/api";

/**
 * CM-06 — who has and hasn't acknowledged.
 *
 * Author-side view, so it needs comms.broadcast rather than plain auth.
 */
export const GET = requirePermission("comms.broadcast", async (_req, { params }) => {
  const announcementId = params?.id as string;

  const announcement = await prisma.announcement.findUnique({
    where: { id: announcementId },
    select: { id: true, title: true, requiresAcknowledgement: true },
  });
  if (!announcement) return notFound("No such announcement.");

  const [recipients, acks] = await Promise.all([
    prisma.announcementRecipient.findMany({
      where: { announcementId },
      include: { user: { select: { id: true, fullName: true, email: true } } },
    }),
    prisma.announcementAcknowledgement.findMany({
      where: { announcementId },
      select: { userId: true, acknowledgedAt: true },
    }),
  ]);

  const ackByUser = new Map(acks.map((a) => [a.userId, a.acknowledgedAt]));

  const rows = recipients.map((r) => ({
    ...r.user,
    acknowledgedAt: ackByUser.get(r.userId) ?? null,
  }));

  return ok({
    announcement,
    acknowledged: rows.filter((r) => r.acknowledgedAt),
    outstanding: rows.filter((r) => !r.acknowledgedAt),
  });
});
