import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth/rbac";
import { ok } from "@/lib/api";

/**
 * SRS §15 — the signed-in user's own notifications.
 *
 * requireAuth, not requirePermission: everyone receives notifications, and the
 * query is scoped to the session's own userId so there is nothing to authorise
 * beyond being signed in.
 */
export const GET = requireAuth(async (req, { user }) => {
  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get("unread") === "true";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

  const [notifications, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: { userId: user.id, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
  ]);

  return ok({ notifications, unreadCount });
});
