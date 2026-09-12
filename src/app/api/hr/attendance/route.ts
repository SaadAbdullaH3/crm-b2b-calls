import { WorkSessionState } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok } from "@/lib/api";
import { getSetting } from "@/lib/settings";
import { lateMinutesFor } from "@/server/reports/punctuality";

/**
 * HR-04 — attendance and punctuality, read-only.
 *
 * Fed entirely by Day 4's `work_sessions`. HR does not measure anything of its
 * own here; it reads what the Monitoring Engine already recorded.
 *
 * !! TM-05 !! This route is reachable with `hr.attendance.read`, which HR and
 * Management hold — and agents do not. It returns login/logout and lateness,
 * which are attendance facts, but NOT active/idle/break totals or
 * productivity: those stay behind `monitoring.view` on /api/monitoring/live.
 * The distinction is deliberate — HR-04 grants "attendance and punctuality
 * records", not the productivity metrics.
 */
export const GET = requirePermission("hr.attendance.read", async (req) => {
  const url = new URL(req.url);
  const days = Math.min(Number(url.searchParams.get("days")) || 7, 90);

  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  const sessions = await prisma.workSession.findMany({
    where: { startedAt: { gte: since } },
    select: {
      userId: true,
      startedAt: true,
      endedAt: true,
      state: true,
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
          role: { select: { label: true } },
        },
      },
    },
    orderBy: { startedAt: "desc" },
  });

  const shift = await getSetting("shift.config");

  // One row per user per day: first login, last activity, and how late the
  // first login was against the configured shift start (MG-07).
  const byKey = new Map<
    string,
    {
      user: (typeof sessions)[number]["user"];
      date: string;
      firstLoginAt: Date;
      lastSeenAt: Date | null;
      sessionCount: number;
      lateMinutes: number;
      stillIn: boolean;
    }
  >();

  for (const s of sessions) {
    const date = s.startedAt.toISOString().slice(0, 10);
    const key = `${s.userId}:${date}`;
    const existing = byKey.get(key);

    if (!existing) {
      // Shared with the MG-07 Punctuality report (Dev A, Day 7). Two copies of
      // "how late is late" drift the first time either is tweaked, and this
      // screen and that report must never disagree.
      const lateMinutes = lateMinutesFor(
        s.startedAt,
        shift.startTime,
        shift.graceMinutes,
      );

      byKey.set(key, {
        user: s.user,
        date,
        firstLoginAt: s.startedAt,
        lastSeenAt: s.endedAt,
        sessionCount: 1,
        lateMinutes,
        stillIn: s.state !== WorkSessionState.ENDED,
      });
      continue;
    }

    existing.sessionCount++;
    if (s.state !== WorkSessionState.ENDED) existing.stillIn = true;
    if (s.endedAt && (!existing.lastSeenAt || s.endedAt > existing.lastSeenAt)) {
      existing.lastSeenAt = s.endedAt;
    }
    if (s.startedAt < existing.firstLoginAt) {
      existing.firstLoginAt = s.startedAt;
      // Recompute, don't just move the timestamp. Sessions arrive newest-first,
      // so the lateness was originally calculated from the LAST login of the
      // day; finding an earlier one without recalculating left the row showing
      // a true first-login time next to a lateness derived from a later one.
      // That overstated lateness for anyone who signed in more than once —
      // common when an agent uses two machines or signs back in after a break.
      // Caught on Day 7 when the punctuality report disagreed with this screen.
      existing.lateMinutes = lateMinutesFor(
        s.startedAt,
        shift.startTime,
        shift.graceMinutes,
      );
    }
  }

  const rows = [...byKey.values()].sort(
    (a, b) => b.firstLoginAt.getTime() - a.firstLoginAt.getTime(),
  );

  return ok({
    days,
    shiftStart: shift.startTime,
    graceMinutes: shift.graceMinutes,
    attendance: rows,
  });
});
