import { CallbackStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { notify, NOTIFICATION } from "@/lib/notifications";

/**
 * CL-07 — the callback/task view.
 *
 * Buckets are computed from `scheduled_for` rather than stored, so a callback
 * moves from upcoming to due to overdue on its own without anything having to
 * run. The cron sweep below only sends reminders; it never decides which bucket
 * a callback is in.
 */

export type CallbackBucket = "overdue" | "due" | "upcoming" | "completed";

export interface CallbackRow {
  id: string;
  scheduledFor: Date;
  status: CallbackStatus;
  notes: string | null;
  completedAt: Date | null;
  lead: {
    id: string;
    companyName: string | null;
    contactName: string | null;
    phoneE164: string | null;
    phoneRaw: string | null;
    doNotCall: boolean;
  };
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

export function bucketFor(row: {
  status: CallbackStatus;
  scheduledFor: Date;
}): CallbackBucket {
  if (row.status === CallbackStatus.COMPLETED) return "completed";
  const now = Date.now();
  if (row.scheduledFor.getTime() < now) return "overdue";
  if (row.scheduledFor.getTime() <= endOfToday().getTime()) return "due";
  return "upcoming";
}

/** Everything an agent needs for the callback screen, in one query. */
export async function listCallbacksForAgent(agentId: string) {
  const rows = await prisma.callback.findMany({
    where: {
      agentId,
      status: { in: [CallbackStatus.SCHEDULED, CallbackStatus.COMPLETED, CallbackStatus.MISSED] },
    },
    orderBy: { scheduledFor: "asc" },
    take: 500,
    include: {
      lead: {
        select: {
          id: true,
          companyName: true,
          contactName: true,
          phoneE164: true,
          phoneRaw: true,
          doNotCall: true,
        },
      },
    },
  });

  const grouped: Record<CallbackBucket, typeof rows> = {
    overdue: [],
    due: [],
    upcoming: [],
    completed: [],
  };

  for (const row of rows) {
    // A MISSED callback is still something the agent has to deal with, so it
    // sits with the overdue pile rather than disappearing into a fourth tab.
    const bucket =
      row.status === CallbackStatus.MISSED ? "overdue" : bucketFor(row);
    grouped[bucket].push(row);
  }

  return grouped;
}

/**
 * Reminder sweep, run from the cron in server.ts.
 *
 * Two passes, both idempotent via `reminderSentAt`-style guards expressed as
 * status transitions: a callback whose time has arrived notifies once, and one
 * left un-actioned past the grace window is marked MISSED and notified once.
 *
 * Deliberately does NOT reassign or release the lead. A missed callback is an
 * agent's problem to fix, not a reason to move the lead out from under them
 * mid-conversation.
 */
const MISSED_AFTER_MINUTES = 60;

export async function runCallbackSweep(): Promise<{
  due: number;
  missed: number;
}> {
  const now = new Date();
  const missedCutoff = new Date(now.getTime() - MISSED_AFTER_MINUTES * 60_000);

  // --- pass 1: due now, not yet reminded ----------------------------------
  const due = await prisma.callback.findMany({
    where: {
      status: CallbackStatus.SCHEDULED,
      scheduledFor: { lte: now, gt: missedCutoff },
      remindedAt: null,
    },
    select: {
      id: true,
      agentId: true,
      scheduledFor: true,
      lead: { select: { id: true, companyName: true, contactName: true } },
    },
    take: 200,
  });

  for (const cb of due) {
    await notify({
      userId: cb.agentId,
      type: NOTIFICATION.CALLBACK_DUE,
      title: `Callback due: ${cb.lead.companyName ?? cb.lead.contactName ?? "lead"}`,
      body: `Scheduled for ${cb.scheduledFor.toLocaleTimeString()}.`,
      payload: { callbackId: cb.id, leadId: cb.lead.id },
    });
    await prisma.callback.update({
      where: { id: cb.id },
      data: { remindedAt: now },
    });
  }

  // --- pass 2: past the grace window, still untouched -----------------------
  const overdue = await prisma.callback.findMany({
    where: { status: CallbackStatus.SCHEDULED, scheduledFor: { lte: missedCutoff } },
    select: {
      id: true,
      agentId: true,
      lead: { select: { id: true, companyName: true, contactName: true } },
    },
    take: 200,
  });

  for (const cb of overdue) {
    await prisma.callback.update({
      where: { id: cb.id },
      data: { status: CallbackStatus.MISSED },
    });
    await notify({
      userId: cb.agentId,
      type: NOTIFICATION.CALLBACK_OVERDUE,
      title: `Missed callback: ${cb.lead.companyName ?? cb.lead.contactName ?? "lead"}`,
      body: "It is more than an hour past the scheduled time.",
      payload: { callbackId: cb.id, leadId: cb.lead.id },
    });
  }

  return { due: due.length, missed: overdue.length };
}
