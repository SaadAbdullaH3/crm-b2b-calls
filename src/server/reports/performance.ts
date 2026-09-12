import { DispositionCode, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { DateRange } from "@/server/dashboard/metrics";
import { eachDay } from "@/server/reports/range";
import {
  avgTalkSec,
  callWhere,
  conversionPct,
  REPORTABLE_AGENT_WHERE,
  workedLeadWhere,
  type ReportFilters,
} from "@/server/reports/definitions";

/**
 * The Daily / Weekly / Monthly / 15-day / Custom report.
 *
 * One aggregation, five date scopes. They differ only in the window, which is
 * why there is one endpoint rather than five — see the Day 7 contract.
 *
 * Every count here goes through the shared predicates in `definitions.ts`, so
 * "worked" means the same thing as it does on Dev B's dashboard.
 */

export interface PerformanceTotals {
  leadsAssigned: number;
  leadsWorked: number;
  callsMade: number;
  talkTimeSec: number;
  avgTalkSec: number;
  callbacksSet: number;
  callbacksDone: number;
  qualified: number;
  conversionPct: number;
}

export interface PerformanceAgentRow {
  agentId: string;
  fullName: string;
  leadsWorked: number;
  calls: number;
  talkTimeSec: number;
  avgTalkSec: number;
  qualified: number;
  conversionPct: number;
  callbacksSet: number;
  callbacksDone: number;
}

export interface PerformanceDayRow {
  date: string;
  calls: number;
  leadsWorked: number;
  qualified: number;
}

export interface PerformanceReport {
  totals: PerformanceTotals;
  outcomes: Record<string, number>;
  byAgent: PerformanceAgentRow[];
  byDay: PerformanceDayRow[];
}

export async function getPerformanceReport(
  range: DateRange,
  filters: ReportFilters = {},
): Promise<PerformanceReport> {
  const leadWhere = workedLeadWhere(range, filters);
  const calls = callWhere(range, filters);

  const [
    leadsAssigned,
    leadsWorked,
    qualified,
    callAgg,
    durationAgg,
    callbacksSet,
    callbacksDone,
    outcomeRows,
  ] = await Promise.all([
    // Assignments OPENED in the range, not leads currently held: a report about
    // a past week must not change because someone was reassigned since.
    prisma.leadAssignment.count({
      where: {
        assignedAt: { gte: range.from, lte: range.to },
        ...(filters.agentId ? { assignedToId: filters.agentId } : {}),
        ...(filters.source ? { lead: { sourceLabel: filters.source } } : {}),
      },
    }),
    prisma.lead.count({ where: leadWhere }),
    // NOT `{...leadWhere, lastDispositionCode: QUALIFIED}` — that spread
    // silently overrides an active disposition filter, so filtering to
    // NO_ANSWER reported the qualified count anyway and conversion came out at
    // 100%. When a disposition filter is set, "qualified" only makes sense if
    // that filter IS QUALIFIED; otherwise it is zero by definition.
    filters.disposition && filters.disposition !== DispositionCode.QUALIFIED
      ? Promise.resolve(0)
      : prisma.lead.count({
          where: { ...leadWhere, lastDispositionCode: DispositionCode.QUALIFIED },
        }),
    prisma.call.aggregate({ where: calls, _count: { _all: true } }),
    // Separate aggregate over calls WITH a duration, so the average is not
    // diluted by MANUAL rows that legitimately have none.
    prisma.call.aggregate({
      where: { ...calls, durationSec: { not: null } },
      _sum: { durationSec: true },
      _count: { _all: true },
    }),
    prisma.callback.count({
      where: {
        createdAt: { gte: range.from, lte: range.to },
        ...(filters.agentId ? { agentId: filters.agentId } : {}),
        ...(filters.source ? { lead: { sourceLabel: filters.source } } : {}),
      },
    }),
    prisma.callback.count({
      where: {
        status: "COMPLETED",
        completedAt: { gte: range.from, lte: range.to },
        ...(filters.agentId ? { agentId: filters.agentId } : {}),
        ...(filters.source ? { lead: { sourceLabel: filters.source } } : {}),
      },
    }),
    prisma.call.groupBy({
      by: ["dispositionId"],
      where: calls,
      _count: { _all: true },
    }),
  ]);

  // groupBy returns disposition ids; the report wants stable codes.
  const dispositions = await prisma.disposition.findMany({
    select: { id: true, code: true },
  });
  const codeById = new Map(dispositions.map((d) => [d.id, d.code as string]));

  const outcomes: Record<string, number> = { undispositioned: 0 };
  for (const code of Object.values(DispositionCode)) outcomes[code] = 0;
  for (const row of outcomeRows) {
    const code = row.dispositionId ? codeById.get(row.dispositionId) : null;
    if (code) outcomes[code] = (outcomes[code] ?? 0) + row._count._all;
    // A call with no outcome yet is counted, not dropped: the buckets must sum
    // to callsMade or the report silently loses rows.
    else outcomes.undispositioned += row._count._all;
  }

  const talkTimeSec = durationAgg._sum.durationSec ?? 0;

  const totals: PerformanceTotals = {
    leadsAssigned,
    leadsWorked,
    callsMade: callAgg._count._all,
    talkTimeSec,
    avgTalkSec: avgTalkSec(talkTimeSec, durationAgg._count._all),
    callbacksSet,
    callbacksDone,
    qualified,
    conversionPct: conversionPct(qualified, leadsWorked),
  };

  const [byAgent, byDay] = await Promise.all([
    getByAgent(range, filters),
    getByDay(range, filters),
  ]);

  return { totals, outcomes, byAgent, byDay };
}

// ---------------------------------------------------------------------------

async function getByAgent(
  range: DateRange,
  filters: ReportFilters,
): Promise<PerformanceAgentRow[]> {
  const agents = await prisma.user.findMany({
    where: {
      ...REPORTABLE_AGENT_WHERE,
      ...(filters.agentId ? { id: filters.agentId } : {}),
    },
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
  });
  if (agents.length === 0) return [];

  const ids = agents.map((a) => a.id);

  const [worked, qualified, callAgg, durationAgg, cbSet, cbDone] = await Promise.all([
    prisma.lead.groupBy({
      by: ["assignedToId"],
      where: { ...workedLeadWhere(range, filters), assignedToId: { in: ids } },
      _count: { _all: true },
    }),
    // Same trap as the totals above: only count qualified when the active
    // disposition filter allows it.
    filters.disposition && filters.disposition !== DispositionCode.QUALIFIED
      ? Promise.resolve([] as { assignedToId: string | null; _count: { _all: number } }[])
      : prisma.lead.groupBy({
          by: ["assignedToId"],
          where: {
            ...workedLeadWhere(range, filters),
            assignedToId: { in: ids },
            lastDispositionCode: DispositionCode.QUALIFIED,
          },
          _count: { _all: true },
        }),
    prisma.call.groupBy({
      by: ["agentId"],
      where: { ...callWhere(range, filters), agentId: { in: ids } },
      _count: { _all: true },
    }),
    prisma.call.groupBy({
      by: ["agentId"],
      where: {
        ...callWhere(range, filters),
        agentId: { in: ids },
        durationSec: { not: null },
      },
      _sum: { durationSec: true },
      _count: { _all: true },
    }),
    prisma.callback.groupBy({
      by: ["agentId"],
      where: {
        agentId: { in: ids },
        createdAt: { gte: range.from, lte: range.to },
      },
      _count: { _all: true },
    }),
    prisma.callback.groupBy({
      by: ["agentId"],
      where: {
        agentId: { in: ids },
        status: "COMPLETED",
        completedAt: { gte: range.from, lte: range.to },
      },
      _count: { _all: true },
    }),
  ]);

  const num = <T extends { _count: { _all: number } }>(
    rows: T[],
    key: keyof T,
    id: string,
  ): number => rows.find((r) => r[key] === id)?._count._all ?? 0;

  return agents.map((a) => {
    const dur = durationAgg.find((r) => r.agentId === a.id);
    const talk = dur?._sum.durationSec ?? 0;
    const w = num(worked, "assignedToId" as never, a.id);
    const q = num(qualified, "assignedToId" as never, a.id);

    return {
      agentId: a.id,
      fullName: a.fullName,
      leadsWorked: w,
      calls: num(callAgg, "agentId" as never, a.id),
      talkTimeSec: talk,
      avgTalkSec: avgTalkSec(talk, dur?._count._all ?? 0),
      qualified: q,
      conversionPct: conversionPct(q, w),
      callbacksSet: num(cbSet, "agentId" as never, a.id),
      callbacksDone: num(cbDone, "agentId" as never, a.id),
    };
  });
}

async function getByDay(
  range: DateRange,
  filters: ReportFilters,
): Promise<PerformanceDayRow[]> {
  // Grouped in SQL by calendar day. Prisma's groupBy cannot truncate a
  // timestamp, so this is raw — but it is still the same predicates.
  const agentFilter = filters.agentId
    ? Prisma.sql`AND c.agent_id = ${filters.agentId}`
    : Prisma.empty;
  const sourceFilter = filters.source
    ? Prisma.sql`AND l.source_label = ${filters.source}`
    : Prisma.empty;
  const dispFilter = filters.disposition
    ? Prisma.sql`AND d.code::text = ${filters.disposition}`
    : Prisma.empty;

  const callRows = await prisma.$queryRaw<{ day: string; n: bigint }[]>(Prisma.sql`
    SELECT to_char(c.created_at, 'YYYY-MM-DD') AS day, count(*) AS n
    FROM calls c
    JOIN leads l ON l.id = c.lead_id
    LEFT JOIN dispositions d ON d.id = c.disposition_id
    WHERE c.created_at BETWEEN ${range.from} AND ${range.to}
      ${agentFilter} ${sourceFilter} ${dispFilter}
    GROUP BY 1
  `);

  const leadAgentFilter = filters.agentId
    ? Prisma.sql`AND l.assigned_to_id = ${filters.agentId}`
    : Prisma.empty;
  const leadSourceFilter = filters.source
    ? Prisma.sql`AND l.source_label = ${filters.source}`
    : Prisma.empty;
  const leadDispFilter = filters.disposition
    ? Prisma.sql`AND l.last_disposition_code::text = ${filters.disposition}`
    : Prisma.empty;

  const leadRows = await prisma.$queryRaw<
    { day: string; worked: bigint; qualified: bigint }[]
  >(Prisma.sql`
    SELECT to_char(l.last_disposition_at, 'YYYY-MM-DD') AS day,
           count(*) AS worked,
           count(*) FILTER (WHERE l.last_disposition_code = 'QUALIFIED') AS qualified
    FROM leads l
    WHERE l.last_disposition_at BETWEEN ${range.from} AND ${range.to}
      ${leadAgentFilter} ${leadSourceFilter} ${leadDispFilter}
    GROUP BY 1
  `);

  const callsByDay = new Map(callRows.map((r) => [r.day, Number(r.n)]));
  const leadsByDay = new Map(
    leadRows.map((r) => [r.day, { worked: Number(r.worked), qualified: Number(r.qualified) }]),
  );

  // Every day in the window, including empty ones — a trend line with holes in
  // it reads as missing data rather than as a quiet day.
  return eachDay(range).map((date) => ({
    date,
    calls: callsByDay.get(date) ?? 0,
    leadsWorked: leadsByDay.get(date)?.worked ?? 0,
    qualified: leadsByDay.get(date)?.qualified ?? 0,
  }));
}
