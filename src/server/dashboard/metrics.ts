/**
 * Management Console aggregation — SRS §8.1.
 *
 * Every figure here is computed by the database. The temptation on a dashboard
 * is `findMany()` then `.filter().reduce()`, which works fine against a seeded
 * hundred rows and collapses at fifty thousand — and a dashboard is the screen
 * most likely to be left open on a wall display, refetching all day.
 *
 * READ-ONLY over Dev A's tables. Nothing in this module writes. Approving a
 * lead request means calling his endpoint, because the ownership columns and
 * the `lead_assignments_one_active_holder` index belong to his transaction.
 */

import { DispositionCode, LeadStatus, WorkSessionState } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface DateRange {
  from: Date;
  to: Date;
}

/** Named ranges the dashboard offers. `today` means since local midnight. */
export function resolveRange(scope: string): DateRange {
  const to = new Date();
  const from = new Date();

  switch (scope) {
    case "today":
      from.setHours(0, 0, 0, 0);
      break;
    case "7d":
      from.setDate(from.getDate() - 7);
      break;
    case "30d":
      from.setDate(from.getDate() - 30);
      break;
    default:
      from.setTime(0);
  }

  return { from, to };
}

// --- lead pipeline (SRS §8.1 line 1) ----------------------------------------

export interface LeadTotals {
  total: number;
  available: number;
  assigned: number;
  called: number;
  remaining: number;
  doNotCall: number;
  qualified: number;
  byStatus: { status: LeadStatus; count: number }[];
}

export async function getLeadTotals(): Promise<LeadTotals> {
  const [byStatus, total, called, doNotCall] = await Promise.all([
    prisma.lead.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.lead.count(),
    // "Called" means a disposition was recorded, not that a call row exists —
    // a dialled-and-abandoned attempt is not a worked lead.
    prisma.lead.count({ where: { lastDispositionCode: { not: null } } }),
    prisma.lead.count({ where: { doNotCall: true } }),
  ]);

  const counts = new Map(byStatus.map((s) => [s.status, s._count._all]));
  const get = (s: LeadStatus) => counts.get(s) ?? 0;

  return {
    total,
    available: get(LeadStatus.AVAILABLE),
    assigned:
      get(LeadStatus.ASSIGNED) +
      get(LeadStatus.IN_PROGRESS) +
      get(LeadStatus.CALLBACK_SCHEDULED),
    called,
    // What is left to work: available now, plus assigned but never dispositioned.
    remaining: get(LeadStatus.AVAILABLE),
    doNotCall,
    qualified: get(LeadStatus.CLOSED_QUALIFIED),
    byStatus: byStatus.map((s) => ({ status: s.status, count: s._count._all })),
  };
}

// --- per-source performance (SRS §8.1 line 2, LM-08) ------------------------

export interface SourceRow {
  source: string;
  imported: number;
  called: number;
  qualified: number;
  notInterested: number;
  doNotCall: number;
  /** Qualified as a share of CALLED, not of imported — a source with 900
   *  uncalled leads is not performing badly, it is untouched. */
  conversionPct: number | null;
}

export async function getSourcePerformance(): Promise<SourceRow[]> {
  const rows = await prisma.$queryRaw<
    {
      source: string | null;
      imported: bigint;
      called: bigint;
      qualified: bigint;
      not_interested: bigint;
      do_not_call: bigint;
    }[]
  >`
    SELECT
      COALESCE(source_label, '(no source)') AS source,
      COUNT(*)                                                          AS imported,
      COUNT(*) FILTER (WHERE last_disposition_code IS NOT NULL)         AS called,
      COUNT(*) FILTER (WHERE last_disposition_code = 'QUALIFIED')       AS qualified,
      COUNT(*) FILTER (WHERE last_disposition_code = 'NOT_INTERESTED')  AS not_interested,
      COUNT(*) FILTER (WHERE do_not_call)                               AS do_not_call
    FROM leads
    GROUP BY 1
    ORDER BY imported DESC
  `;

  return rows.map((r) => {
    const called = Number(r.called);
    const qualified = Number(r.qualified);
    return {
      source: r.source ?? "(no source)",
      imported: Number(r.imported),
      called,
      qualified,
      notInterested: Number(r.not_interested),
      doNotCall: Number(r.do_not_call),
      conversionPct: called > 0 ? Math.round((qualified / called) * 100) : null,
    };
  });
}

// --- per-agent performance (SRS §8.1 lines 3-4) -----------------------------

export interface AgentRow {
  agentId: string;
  fullName: string;
  email: string;
  /** Leads currently locked to them. */
  leadsHeld: number;
  calls: number;
  totalTalkSec: number;
  avgTalkSec: number;
  noAnswer: number;
  callBackLater: number;
  notInterested: number;
  doNotCall: number;
  email_: number;
  qualified: number;
  pendingCallbacks: number;
  overdueCallbacks: number;
  /** Present only for a viewer holding monitoring.view — see below. */
  monitoring?: {
    state: WorkSessionState | null;
    activeMs: number;
    idleMs: number;
    breakMs: number;
    productivityPct: number | null;
  };
}

/**
 * Per-agent operational figures for a date range.
 *
 * `includeMonitoring` is a parameter rather than always-on because TM-05 keeps
 * active/idle/break/productivity behind `monitoring.view`. The caller passes
 * whether the viewer holds it; an Admin who removed that key from Management
 * through AD-02 must actually see the columns disappear.
 */
export async function getAgentPerformance(
  range: DateRange,
  includeMonitoring: boolean,
): Promise<AgentRow[]> {
  const agents = await prisma.user.findMany({
    where: { role: { name: "agent" } },
    select: { id: true, fullName: true, email: true, isActive: true },
    orderBy: { fullName: "asc" },
  });
  if (agents.length === 0) return [];

  const agentIds = agents.map((a) => a.id);
  const now = new Date();

  const [callStats, dispositionStats, heldCounts, callbackStats, sessions] =
    await Promise.all([
      prisma.call.groupBy({
        by: ["agentId"],
        where: { agentId: { in: agentIds }, createdAt: { gte: range.from, lte: range.to } },
        _count: { _all: true },
        _sum: { durationSec: true },
      }),

      // Outcome mix, joined through `dispositions` so the code is authoritative
      // rather than re-derived from the denormalised column on `leads`.
      prisma.$queryRaw<{ agent_id: string; code: DispositionCode; n: bigint }[]>`
        SELECT c.agent_id, d.code, COUNT(*) AS n
        FROM calls c
        JOIN dispositions d ON d.id = c.disposition_id
        WHERE c.created_at BETWEEN ${range.from} AND ${range.to}
        GROUP BY 1, 2
      `,

      prisma.lead.groupBy({
        by: ["assignedToId"],
        where: { assignedToId: { in: agentIds } },
        _count: { _all: true },
      }),

      prisma.$queryRaw<{ agent_id: string; pending: bigint; overdue: bigint }[]>`
        SELECT
          agent_id,
          COUNT(*) FILTER (WHERE status = 'SCHEDULED')                              AS pending,
          COUNT(*) FILTER (WHERE status = 'SCHEDULED' AND scheduled_for < ${now})   AS overdue
        FROM callbacks
        GROUP BY 1
      `,

      includeMonitoring
        ? prisma.workSession.findMany({
            where: { userId: { in: agentIds }, startedAt: { gte: range.from } },
            select: {
              userId: true,
              state: true,
              activeMs: true,
              idleMs: true,
              breakMs: true,
              lastHeartbeatAt: true,
            },
          })
        : Promise.resolve([]),
    ]);

  const callByAgent = new Map(callStats.map((c) => [c.agentId, c]));
  const heldByAgent = new Map(
    heldCounts.map((h) => [h.assignedToId as string, h._count._all]),
  );
  const cbByAgent = new Map(callbackStats.map((c) => [c.agent_id, c]));

  const dispByAgent = new Map<string, Map<DispositionCode, number>>();
  for (const row of dispositionStats) {
    const inner = dispByAgent.get(row.agent_id) ?? new Map();
    inner.set(row.code, Number(row.n));
    dispByAgent.set(row.agent_id, inner);
  }

  // Roll multiple sessions per agent into one, topping up the in-flight
  // interval so a currently-idle agent reads as idle now rather than as of
  // their last heartbeat.
  const monByAgent = new Map<
    string,
    { state: WorkSessionState | null; activeMs: number; idleMs: number; breakMs: number }
  >();
  for (const s of sessions) {
    const pending =
      s.state === WorkSessionState.ENDED
        ? 0
        : Math.max(0, now.getTime() - s.lastHeartbeatAt.getTime());

    const prev = monByAgent.get(s.userId) ?? {
      state: null,
      activeMs: 0,
      idleMs: 0,
      breakMs: 0,
    };

    prev.activeMs += s.activeMs + (s.state === WorkSessionState.ACTIVE ? pending : 0);
    prev.idleMs += s.idleMs + (s.state === WorkSessionState.IDLE ? pending : 0);
    prev.breakMs += s.breakMs + (s.state === WorkSessionState.BREAK ? pending : 0);
    if (s.state !== WorkSessionState.ENDED) prev.state = s.state;
    else if (prev.state === null) prev.state = WorkSessionState.ENDED;

    monByAgent.set(s.userId, prev);
  }

  return agents.map((a) => {
    const calls = callByAgent.get(a.id);
    const disp = dispByAgent.get(a.id) ?? new Map<DispositionCode, number>();
    const cb = cbByAgent.get(a.id);
    const n = calls?._count._all ?? 0;
    const talk = calls?._sum.durationSec ?? 0;

    const row: AgentRow = {
      agentId: a.id,
      fullName: a.fullName,
      email: a.email,
      leadsHeld: heldByAgent.get(a.id) ?? 0,
      calls: n,
      totalTalkSec: talk,
      avgTalkSec: n > 0 ? Math.round(talk / n) : 0,
      noAnswer: disp.get(DispositionCode.NO_ANSWER) ?? 0,
      callBackLater: disp.get(DispositionCode.CALL_BACK_LATER) ?? 0,
      notInterested: disp.get(DispositionCode.NOT_INTERESTED) ?? 0,
      doNotCall: disp.get(DispositionCode.DO_NOT_CALL) ?? 0,
      email_: disp.get(DispositionCode.EMAIL) ?? 0,
      qualified: disp.get(DispositionCode.QUALIFIED) ?? 0,
      pendingCallbacks: Number(cb?.pending ?? 0),
      overdueCallbacks: Number(cb?.overdue ?? 0),
    };

    if (includeMonitoring) {
      const m = monByAgent.get(a.id);
      row.monitoring = {
        state: m?.state ?? null,
        activeMs: m?.activeMs ?? 0,
        idleMs: m?.idleMs ?? 0,
        breakMs: m?.breakMs ?? 0,
        productivityPct:
          m && m.activeMs + m.idleMs > 0
            ? Math.round((m.activeMs / (m.activeMs + m.idleMs)) * 100)
            : null,
      };
    }

    return row;
  });
}

// --- overall call outcome mix -----------------------------------------------

export async function getOutcomeMix(range: DateRange) {
  const rows = await prisma.$queryRaw<{ code: DispositionCode; n: bigint }[]>`
    SELECT d.code, COUNT(*) AS n
    FROM calls c
    JOIN dispositions d ON d.id = c.disposition_id
    WHERE c.created_at BETWEEN ${range.from} AND ${range.to}
    GROUP BY 1
  `;

  const totals = await prisma.call.aggregate({
    where: { createdAt: { gte: range.from, lte: range.to } },
    _count: { _all: true },
    _sum: { durationSec: true },
  });

  return {
    totalCalls: totals._count._all,
    totalTalkSec: totals._sum.durationSec ?? 0,
    byCode: rows.map((r) => ({ code: r.code, count: Number(r.n) })),
  };
}
