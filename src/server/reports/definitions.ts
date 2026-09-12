import { DispositionCode, Prisma } from "@prisma/client";
import type { DateRange } from "@/server/dashboard/metrics";

/**
 * THE DEFINITIONS. One place, so the Management Dashboard and the Reports
 * cannot disagree about what a word means.
 *
 * Dev B set these on Day 6 and they are repeated here as executable predicates
 * rather than prose, because a definition written only in a comment drifts the
 * first time someone writes a slightly different WHERE clause:
 *
 *   "worked"     a lead carrying `last_disposition_code` — NOT the existence of
 *                a `calls` row. A dialled-and-abandoned attempt is not a worked
 *                lead.
 *   "contacted"  worked, with an outcome other than NO_ANSWER. Somebody
 *                actually spoke to them.
 *   conversion   qualified ÷ WORKED, never ÷ imported. A source with a large
 *                untouched backlog is unworked, not underperforming.
 *   avgTalkSec   total talk time ÷ calls THAT HAVE A DURATION. `MANUAL`-channel
 *                rows (an outcome recorded without dialling) carry
 *                `duration_sec = null` by design; counting them in the
 *                denominator understates the average.
 *
 * DEV B: `src/server/dashboard/metrics.ts` currently spells these out inline.
 * Importing from here would make the shared definition literal rather than a
 * convention — worth doing on Day 8 or 9. Not edited today to avoid a conflict
 * while you are working in that file.
 */

export interface ReportFilters {
  agentId?: string | null;
  source?: string | null;
  disposition?: DispositionCode | null;
}

/** Leads worked in a range, honouring the optional filters. */
export function workedLeadWhere(
  range: DateRange,
  filters: ReportFilters = {},
): Prisma.LeadWhereInput {
  return {
    lastDispositionAt: { gte: range.from, lte: range.to },
    ...(filters.agentId ? { assignedToId: filters.agentId } : {}),
    ...(filters.source ? { sourceLabel: filters.source } : {}),
    ...(filters.disposition ? { lastDispositionCode: filters.disposition } : {}),
  };
}

/** Calls placed in a range, honouring the optional filters. */
export function callWhere(
  range: DateRange,
  filters: ReportFilters = {},
): Prisma.CallWhereInput {
  return {
    createdAt: { gte: range.from, lte: range.to },
    ...(filters.agentId ? { agentId: filters.agentId } : {}),
    ...(filters.source ? { lead: { sourceLabel: filters.source } } : {}),
    ...(filters.disposition ? { disposition: { code: filters.disposition } } : {}),
  };
}

/**
 * Average talk time over calls that actually have one.
 * Returns 0 rather than NaN when nothing qualifies — a report cell showing NaN
 * is worse than one showing zero.
 */
export function avgTalkSec(totalSec: number, callsWithDuration: number): number {
  if (callsWithDuration <= 0) return 0;
  return Math.round(totalSec / callsWithDuration);
}

/** qualified ÷ worked, as a percentage to one decimal. */
export function conversionPct(qualified: number, worked: number): number {
  if (worked <= 0) return 0;
  return Math.round((qualified / worked) * 1000) / 10;
}

/** Outcomes that mean a human conversation happened. */
export const CONTACTED_CODES: DispositionCode[] = [
  DispositionCode.CALL_BACK_LATER,
  DispositionCode.NOT_INTERESTED,
  DispositionCode.DO_NOT_CALL,
  DispositionCode.EMAIL,
  DispositionCode.QUALIFIED,
];

/**
 * "Is this user an agent whose numbers belong on a report?"
 *
 * Permission-based, not role-name-based, so a second calling role an Admin
 * creates is included for free. The `leads.approve` exclusion is what keeps
 * the Admin account out: Admin is granted EVERY permission, `leads.read.own`
 * included, so a naive check puts the person who configures the system into
 * the agent leaderboard and the punctuality report.
 *
 * Day 4 hit this with the assign-to-agent picker; it recurred on Day 7 in the
 * punctuality report. Same predicate everywhere from here on.
 */
export const REPORTABLE_AGENT_WHERE = {
  role: {
    permissions: { some: { permission: { key: "leads.read.own" } } },
    NOT: { permissions: { some: { permission: { key: "leads.approve" } } } },
  },
} as const;
