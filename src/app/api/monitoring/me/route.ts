import { requireAuth } from "@/lib/auth/rbac";
import { getCurrentSessionId } from "@/lib/auth/session";
import { ok } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";

/**
 * The agent's own monitoring state — deliberately almost empty.
 *
 * !! TM-05 !! This is the route an Agent screen calls, so it must return
 * NOTHING that reveals Active Time, Idle Time, Break totals or Productivity.
 * It returns whether a break is currently open and when it started, which is
 * the minimum needed to render a "You are on break — 04:12" button, plus the
 * configured allowance so the button can warn before an agent overruns.
 *
 * Accumulated totals live on /api/monitoring/live, behind `monitoring.view`,
 * which no agent holds.
 */
export const GET = requireAuth(async () => {
  const sessionId = await getCurrentSessionId();
  if (!sessionId) return ok({ onBreak: false, breakStartedAt: null });

  const ws = await prisma.workSession.findUnique({
    where: { sessionId },
    select: { id: true, state: true },
  });

  if (!ws) return ok({ onBreak: false, breakStartedAt: null });

  const onBreak = ws.state === "BREAK";
  const open = onBreak
    ? await prisma.breakPeriod.findFirst({
        where: { workSessionId: ws.id, endedAt: null },
        orderBy: { startedAt: "desc" },
        select: { startedAt: true },
      })
    : null;

  const cfg = await getSetting("monitoring.config");

  // NOT returned, deliberately: accumulated break minutes for the day.
  //
  // TM-05 names "Break/Pause Time" among the Management-only metrics, so an
  // agent-facing route must not serve a running total even though it would be
  // useful for pacing. `breakStartedAt` is a timestamp for the CURRENT break,
  // which the agent plainly already knows, and the two limits below are
  // configured RULES rather than measurements of this person.
  //
  // The tension is real and worth putting to the call-centre owner alongside
  // Dev A's returnNoAnswerOnLogout question: an agent who cannot see their
  // remaining allowance can only overrun it by accident. Flagged in GLOBAL.md;
  // strict reading kept until someone decides otherwise.
  return ok({
    onBreak,
    breakStartedAt: open?.startedAt ?? null,
    breakMinutesAllowed: cfg.breakMinutesPerShift,
    maxSingleBreakMinutes: cfg.maxSingleBreakMinutes,
  });
});
