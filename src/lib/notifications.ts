/**
 * Notification pipeline (SRS §15) — SHARED BETWEEN DEV A AND DEV B.
 *
 * One write path for every in-app notification in the system: persist to
 * `notifications`, then push over Socket.io so the bell updates without
 * polling. Dev A calls `notify()` / `notifyMany()` from the lead-assignment
 * and callback code paths; Dev B calls it from messaging, announcements, HR
 * and system alerts.
 *
 * DEV A: import { notify, NOTIFICATION } from "@/lib/notifications".
 * Use a NOTIFICATION.* constant rather than a string literal so the type shows
 * up in the notification filter UI and the Day 8 wiring audit.
 *
 * Safe to import from the custom server (cron, sockets): no `server-only`, no
 * `next/*`. See session-core.ts for why that matters — the idle sweep and the
 * 5-minute auto-assign job both need to notify from outside a request.
 */

import { prisma } from "@/lib/db";
import { EVENTS, emitToUser } from "@/server/socket";

/**
 * The 9 notification categories from SRS §15. AD-08 lets an Admin configure
 * which categories a user receives; that filtering reads these keys.
 */
export const NOTIFICATION = {
  /** Dev A — a batch of leads was assigned to this agent. */
  LEAD_BATCH_ASSIGNED: "lead.batch.assigned",
  /** Dev A — a lead request was approved, rejected, modified or auto-approved. */
  LEAD_REQUEST_RESOLVED: "lead.request.resolved",
  /** Dev A — a lead request is waiting on Management (fires at Management). */
  LEAD_REQUEST_SUBMITTED: "lead.request.submitted",
  /** Dev A — a scheduled callback is due. */
  CALLBACK_DUE: "callback.due",
  /** Dev A — a scheduled callback was missed. */
  CALLBACK_OVERDUE: "callback.overdue",
  /** Dev A — an attempt was made against a Do-Not-Call lead. */
  DNC_WARNING: "lead.dnc.warning",
  /** Dev B — a direct or group message arrived. */
  MESSAGE: "comms.message",
  /** Dev B — an announcement was published. */
  ANNOUNCEMENT: "comms.announcement",
  /** Dev B — HR notification (leave decision, document expiry). */
  HR: "hr.notification",
  /** Either track — operational/system alert. */
  SYSTEM: "system.alert",
} as const;

export type NotificationType = (typeof NOTIFICATION)[keyof typeof NOTIFICATION];

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  /** Small, non-sensitive payload: ids the client needs to build a link. */
  payload?: Record<string, unknown>;
}

/**
 * Creates one notification and pushes it to that user's sockets.
 *
 * Never throws into the caller's flow: a failed notification must not roll
 * back the business action that triggered it. A lead assignment that succeeded
 * has succeeded even if the bell never lights up.
 */
export async function notify(input: NotifyInput): Promise<string | null> {
  try {
    const row = await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        payload: (input.payload ?? undefined) as never,
      },
    });

    emitToUser(input.userId, EVENTS.NOTIFICATION_NEW, {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body ?? undefined,
      createdAt: row.createdAt.toISOString(),
    });

    return row.id;
  } catch (e) {
    console.error("[notify] failed", { type: input.type, userId: input.userId }, e);
    return null;
  }
}

/**
 * Fan-out helper. One `createMany` rather than N inserts, then one emit per
 * user — a broadcast to 200 agents should be two queries, not four hundred.
 */
export async function notifyMany(
  userIds: string[],
  input: Omit<NotifyInput, "userId">,
): Promise<number> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return 0;

  try {
    await prisma.notification.createMany({
      data: ids.map((userId) => ({
        userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        payload: (input.payload ?? undefined) as never,
      })),
    });

    const at = new Date().toISOString();
    for (const userId of ids) {
      emitToUser(userId, EVENTS.NOTIFICATION_NEW, {
        // No row id: createMany doesn't return them. The client refetches the
        // list on this event, so the id is only a hint anyway.
        type: input.type,
        title: input.title,
        body: input.body ?? undefined,
        createdAt: at,
      });
    }

    return ids.length;
  } catch (e) {
    console.error("[notifyMany] failed", { type: input.type, count: ids.length }, e);
    return 0;
  }
}

/** Everyone holding a role, active accounts only. Used by broadcasts. */
export async function userIdsByRole(roleName: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true, role: { name: roleName } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** Every active member of an AD-03 group. */
export async function userIdsByGroup(groupId: string): Promise<string[]> {
  const members = await prisma.groupMember.findMany({
    where: { groupId, user: { isActive: true } },
    select: { userId: true },
  });
  return members.map((m) => m.userId);
}

/** Every active user. Used by an ALL-audience announcement. */
export async function allActiveUserIds(excludeUserId?: string): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: { isActive: true, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
    select: { id: true },
  });
  return users.map((u) => u.id);
}
