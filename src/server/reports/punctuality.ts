import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import type { DateRange } from "@/server/dashboard/metrics";
import { REPORTABLE_AGENT_WHERE, type ReportFilters } from "@/server/reports/definitions";

/**
 * MG-07 Punctuality — first login of the day against the configured shift start.
 *
 * THE LATENESS RULE LIVES HERE, ONCE. It was previously written inline inside
 * `src/app/api/hr/attendance/route.ts` (Dev B, Day 5). Two copies of "how late
 * is late" drift the first time either is tweaked — the same failure Dev B
 * flagged for the definition of "worked" — so this is the shared version and
 * that route should call it. Flagged in GLOBAL.md; same output either way.
 *
 * TM-05: first login, lateness and session count only. No active, idle, break
 * or productivity value appears here. HR-04 grants "attendance and punctuality
 * records", which is the narrower thing, and a punctuality report is not a
 * back door into monitoring metrics.
 */

export interface PunctualityRow {
  agentId: string;
  fullName: string;
  email: string;
  /** YYYY-MM-DD, local. */
  date: string;
  firstLoginAt: string;
  lastSeenAt: string | null;
  sessionCount: number;
  /** Minutes past shift start AFTER the grace period. 0 means on time. */
  lateMinutes: number;
  onTime: boolean;
}

export interface PunctualitySummaryRow {
  agentId: string;
  fullName: string;
  daysPresent: number;
  daysLate: number;
  totalLateMinutes: number;
  onTimePct: number;
}

export interface PunctualityReport {
  shift: { startTime: string; graceMinutes: number; timeZone: string };
  rows: PunctualityRow[];
  summary: PunctualitySummaryRow[];
}

/**
 * How late one login was, in minutes past the grace period.
 *
 * Exported so the HR attendance route can use the same maths. Grace is
 * subtracted rather than compared: arriving 8 minutes late with a 10-minute
 * grace is 0 late, not "late but forgiven", because the report totals minutes.
 */
export function lateMinutesFor(
  loginAt: Date,
  shiftStartTime: string,
  graceMinutes: number,
): number {
  const [hour, minute] = shiftStartTime.split(":").map(Number);
  const expected = new Date(loginAt);
  expected.setHours(hour ?? 9, minute ?? 0, 0, 0);
  const lateMs = loginAt.getTime() - expected.getTime();
  return Math.max(0, Math.round(lateMs / 60_000) - graceMinutes);
}

export async function getPunctualityReport(
  range: DateRange,
  filters: ReportFilters = {},
): Promise<PunctualityReport> {
  const shift = await getSetting("shift.config");

  // Work sessions rather than raw auth sessions: a work session is 1:1 with a
  // login and is what Dev B's monitoring already treats as "was here".
  const sessions = await prisma.workSession.findMany({
    where: {
      startedAt: { gte: range.from, lte: range.to },
      ...(filters.agentId ? { userId: filters.agentId } : {}),
      user: REPORTABLE_AGENT_WHERE,
    },
    orderBy: { startedAt: "asc" },
    select: {
      userId: true,
      startedAt: true,
      lastHeartbeatAt: true,
      endedAt: true,
      user: { select: { id: true, fullName: true, email: true } },
    },
  });

  const byKey = new Map<string, PunctualityRow>();

  for (const s of sessions) {
    const date = `${s.startedAt.getFullYear()}-${String(s.startedAt.getMonth() + 1).padStart(2, "0")}-${String(s.startedAt.getDate()).padStart(2, "0")}`;
    const key = `${s.userId}:${date}`;
    const existing = byKey.get(key);
    const lastSeen = s.endedAt ?? s.lastHeartbeatAt ?? null;

    if (!existing) {
      const lateMinutes = lateMinutesFor(
        s.startedAt,
        shift.startTime,
        shift.graceMinutes,
      );
      byKey.set(key, {
        agentId: s.user.id,
        fullName: s.user.fullName,
        email: s.user.email,
        date,
        firstLoginAt: s.startedAt.toISOString(),
        lastSeenAt: lastSeen?.toISOString() ?? null,
        sessionCount: 1,
        lateMinutes,
        onTime: lateMinutes === 0,
      });
      continue;
    }

    // Later sessions on the same day extend presence but never change lateness:
    // punctuality is about the FIRST login. Signing in again at 4pm does not
    // make someone late twice.
    existing.sessionCount++;
    if (lastSeen && (!existing.lastSeenAt || lastSeen.toISOString() > existing.lastSeenAt)) {
      existing.lastSeenAt = lastSeen.toISOString();
    }
  }

  const rows = [...byKey.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.fullName.localeCompare(b.fullName),
  );

  const summaryByAgent = new Map<string, PunctualitySummaryRow>();
  for (const r of rows) {
    const s = summaryByAgent.get(r.agentId) ?? {
      agentId: r.agentId,
      fullName: r.fullName,
      daysPresent: 0,
      daysLate: 0,
      totalLateMinutes: 0,
      onTimePct: 0,
    };
    s.daysPresent++;
    if (!r.onTime) s.daysLate++;
    s.totalLateMinutes += r.lateMinutes;
    summaryByAgent.set(r.agentId, s);
  }

  const summary = [...summaryByAgent.values()]
    .map((s) => ({
      ...s,
      onTimePct:
        s.daysPresent > 0
          ? Math.round(((s.daysPresent - s.daysLate) / s.daysPresent) * 1000) / 10
          : 0,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  return {
    shift: {
      startTime: shift.startTime,
      graceMinutes: shift.graceMinutes,
      timeZone: shift.timeZone,
    },
    rows,
    summary,
  };
}
