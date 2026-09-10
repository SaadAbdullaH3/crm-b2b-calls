import { CallbackStatus, DispositionCode, LeadStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * The Agent Dashboard's numbers.
 *
 * !! TM-05 BOUNDARY — THE WHOLE POINT OF THIS FILE !!
 * Nothing here may compute or return Active Time, Idle Time, Break/Pause Time
 * or Productivity %. Those live in `work_sessions` and belong exclusively to
 * Management's monitoring view.
 *
 * This is deliberately a SEPARATE module from Dev B's
 * `src/server/dashboard/metrics.ts` rather than a filtered call into it. A
 * shared function that returns monitoring fields and trusts every caller to
 * strip them is one forgotten spread operator away from leaking — and the leak
 * would be invisible in review. Not importing the monitoring engine at all is
 * a boundary you can check by reading the import list.
 *
 * Everything below is operational: leads held, calls made, outcomes recorded,
 * callbacks owed.
 */

export interface AgentDashboard {
  today: {
    callsMade: number;
    leadsWorked: number;
    /** Outcome mix for today, keyed by DispositionCode. */
    outcomes: Record<string, number>;
  };
  leads: {
    held: number;
    /** Assigned but never dispositioned — the actual queue. */
    toCall: number;
    inProgress: number;
    closedQualified: number;
    closedNotInterested: number;
    doNotCall: number;
  };
  callbacks: {
    overdue: number;
    dueToday: number;
    upcoming: number;
    completedToday: number;
  };
  unreadNotifications: number;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

export async function getAgentDashboard(agentId: string): Promise<AgentDashboard> {
  const from = startOfToday();
  const to = endOfToday();
  const now = new Date();

  const [
    callsMade,
    leadsWorked,
    outcomeRows,
    held,
    toCall,
    inProgress,
    closedQualified,
    closedNotInterested,
    doNotCall,
    overdue,
    dueToday,
    upcoming,
    completedToday,
    unreadNotifications,
  ] = await Promise.all([
    prisma.call.count({ where: { agentId, createdAt: { gte: from, lte: to } } }),
    // "Worked" matches the definition agreed with Dev B: a lead carrying a
    // disposition, not merely one with a call row against it.
    prisma.lead.count({
      where: { assignedToId: agentId, lastDispositionAt: { gte: from, lte: to } },
    }),
    prisma.call.groupBy({
      by: ["dispositionId"],
      where: { agentId, createdAt: { gte: from, lte: to }, dispositionId: { not: null } },
      _count: { _all: true },
    }),

    prisma.lead.count({ where: { assignedToId: agentId } }),
    prisma.lead.count({
      where: { assignedToId: agentId, lastDispositionCode: null, doNotCall: false },
    }),
    prisma.lead.count({ where: { assignedToId: agentId, status: LeadStatus.IN_PROGRESS } }),
    prisma.lead.count({
      where: { assignedToId: agentId, status: LeadStatus.CLOSED_QUALIFIED },
    }),
    prisma.lead.count({
      where: { assignedToId: agentId, status: LeadStatus.CLOSED_NOT_INTERESTED },
    }),
    prisma.lead.count({ where: { assignedToId: agentId, doNotCall: true } }),

    prisma.callback.count({
      where: {
        agentId,
        OR: [
          { status: CallbackStatus.SCHEDULED, scheduledFor: { lt: now } },
          { status: CallbackStatus.MISSED },
        ],
      },
    }),
    prisma.callback.count({
      where: {
        agentId,
        status: CallbackStatus.SCHEDULED,
        scheduledFor: { gte: now, lte: to },
      },
    }),
    prisma.callback.count({
      where: { agentId, status: CallbackStatus.SCHEDULED, scheduledFor: { gt: to } },
    }),
    prisma.callback.count({
      where: { agentId, status: CallbackStatus.COMPLETED, completedAt: { gte: from, lte: to } },
    }),

    prisma.notification.count({ where: { userId: agentId, readAt: null } }),
  ]);

  // groupBy gives disposition ids; the dashboard wants the stable codes, so
  // resolve them through the lookup table rather than guessing from labels.
  const dispositions = await prisma.disposition.findMany({
    select: { id: true, code: true },
  });
  const codeById = new Map(dispositions.map((d) => [d.id, d.code]));

  const outcomes: Record<string, number> = {};
  for (const code of Object.values(DispositionCode)) outcomes[code] = 0;
  for (const row of outcomeRows) {
    const code = row.dispositionId ? codeById.get(row.dispositionId) : null;
    if (code) outcomes[code] = (outcomes[code] ?? 0) + row._count._all;
  }

  return {
    today: { callsMade, leadsWorked, outcomes },
    leads: {
      held,
      toCall,
      inProgress,
      closedQualified,
      closedNotInterested,
      doNotCall,
    },
    callbacks: { overdue, dueToday, upcoming, completedToday },
    unreadNotifications,
  };
}
