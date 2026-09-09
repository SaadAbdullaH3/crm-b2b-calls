import { z } from "zod";
import { AnnouncementAudience } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAuth, requirePermission } from "@/lib/auth/rbac";
import { ok, badRequest, parseBody } from "@/lib/api";
import {
  notifyMany,
  NOTIFICATION,
  userIdsByRole,
  userIdsByGroup,
  allActiveUserIds,
} from "@/lib/notifications";
import { EVENTS, emitToUser } from "@/server/socket";

/**
 * CM-06 — announcements, optionally requiring acknowledgement.
 *
 * The audience is RESOLVED AT PUBLISH TIME into `announcement_recipients`.
 * Storing only the intent ("all agents") would mean an agent hired next month
 * silently joins the outstanding-acknowledgement list for an announcement that
 * predates them — and an audit of "who was told" would change over time.
 */

/** Anyone signed in can read the announcements addressed to them. */
export const GET = requireAuth(async (_req, { user }) => {
  const announcements = await prisma.announcement.findMany({
    where: { recipients: { some: { userId: user.id } } },
    include: {
      author: { select: { id: true, fullName: true } },
      audienceGroup: { select: { id: true, name: true } },
      acknowledgements: { where: { userId: user.id }, select: { acknowledgedAt: true } },
      _count: { select: { recipients: true, acknowledgements: true } },
    },
    orderBy: { publishedAt: "desc" },
    take: 100,
  });

  return ok({
    announcements: announcements.map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      audience: a.audience,
      audienceRole: a.audienceRole,
      audienceGroup: a.audienceGroup,
      requiresAcknowledgement: a.requiresAcknowledgement,
      publishedAt: a.publishedAt,
      author: a.author,
      acknowledgedAt: a.acknowledgements[0]?.acknowledgedAt ?? null,
      recipientCount: a._count.recipients,
      acknowledgedCount: a._count.acknowledgements,
    })),
  });
});

const CreateSchema = z
  .object({
    title: z.string().min(1).max(160).trim(),
    body: z.string().min(1).max(10000).trim(),
    audience: z.nativeEnum(AnnouncementAudience).default(AnnouncementAudience.ALL),
    audienceRole: z.string().min(1).optional(),
    audienceGroupId: z.string().min(1).optional(),
    requiresAcknowledgement: z.boolean().default(false),
  })
  .refine((v) => v.audience !== AnnouncementAudience.ROLE || Boolean(v.audienceRole), {
    message: "A ROLE announcement needs audienceRole.",
  })
  .refine((v) => v.audience !== AnnouncementAudience.GROUP || Boolean(v.audienceGroupId), {
    message: "A GROUP announcement needs audienceGroupId.",
  });

export const POST = requirePermission("comms.broadcast", async (req, { user }) => {
  const parsed = await parseBody(req, CreateSchema);
  if (!parsed.success) return parsed.res;
  const { title, body, audience, audienceRole, audienceGroupId, requiresAcknowledgement } =
    parsed.data;

  let recipients: string[] = [];
  if (audience === AnnouncementAudience.ALL) {
    recipients = await allActiveUserIds();
  } else if (audience === AnnouncementAudience.ROLE) {
    const role = await prisma.role.findUnique({ where: { name: audienceRole! } });
    if (!role) return badRequest("That role does not exist.");
    recipients = await userIdsByRole(audienceRole!);
  } else {
    const group = await prisma.group.findUnique({ where: { id: audienceGroupId! } });
    if (!group) return badRequest("That group does not exist.");
    recipients = await userIdsByGroup(audienceGroupId!);
  }

  if (recipients.length === 0) return badRequest("That audience matches nobody active.");

  const announcement = await prisma.announcement.create({
    data: {
      authorId: user.id,
      title,
      body,
      audience,
      audienceRole: audienceRole ?? null,
      audienceGroupId: audienceGroupId ?? null,
      requiresAcknowledgement,
      recipients: { create: recipients.map((userId) => ({ userId })) },
    },
    select: { id: true, publishedAt: true },
  });

  for (const userId of recipients) {
    emitToUser(userId, EVENTS.ANNOUNCEMENT_NEW, {
      announcementId: announcement.id,
      title,
      requiresAcknowledgement,
      publishedAt: announcement.publishedAt.toISOString(),
    });
  }

  await notifyMany(
    recipients.filter((id) => id !== user.id),
    {
      type: NOTIFICATION.ANNOUNCEMENT,
      title: requiresAcknowledgement ? `Action required: ${title}` : title,
      body: body.slice(0, 140),
      payload: { announcementId: announcement.id, requiresAcknowledgement },
    },
  );

  return ok({ id: announcement.id, recipients: recipients.length }, 201);
});
