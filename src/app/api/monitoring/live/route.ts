import { WorkSessionState } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok } from "@/lib/api";
import { getSetting } from "@/lib/settings";

/**
 * MG-09 / TM-05 — the Management monitoring view.
 *
 * Gated on `monitoring.view`, which agents do not hold. THIS is where
 * active/idle/break totals and productivity live; the agent-facing
 * /api/monitoring/me deliberately exposes none of it.
 *
 * Totals are read from the accumulated counters and topped up with the
 * in-flight interval since the last heartbeat, so a session that has been
 * idle for four minutes reads as four minutes idle rather than as whatever it
 * was at the last beat.
 */

/** Elapsed time not yet folded into the counters. */
function inFlight(state: WorkSessionState, lastHeartbeatAt: Date, now: number) {
  if (state === WorkSessionState.ENDED) return 0;
  return Math.max(0, now - lastHeartbeatAt.getTime());
}

export const GET = requirePermission("monitoring.view", async (req) => {
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") ?? "today";

  const since = new Date();
  if (scope === "today") since.setHours(0, 0, 0, 0);
  else since.setTime(0);

  const sessions = await prisma.workSession.findMany({
    where: { startedAt: { gte: since } },
    include: {
      user: {
        select: {
          id: true,
          fullName: true,
          email: true,
          role: { select: { name: true, label: true } },
        },
      },
    },
    orderBy: { startedAt: "desc" },
  });

  const now = Date.now();
  const cfg = await getSetting("monitoring.config");

  // One row per USER, aggregating however many sessions they had today.
  const byUser = new Map<
    string,
    {
      user: (typeof sessions)[number]["user"];
      activeMs: number;
      idleMs: number;
      breakMs: number;
      screenMs: number;
      idleCount: number;
      breakCount: number;
      state: WorkSessionState;
      firstLoginAt: Date;
      lastActivityAt: Date;
      isLive: boolean;
    }
  >();

  for (const ws of sessions) {
    const pending = inFlight(ws.state, ws.lastHeartbeatAt, now);
    const active = ws.activeMs + (ws.state === WorkSessionState.ACTIVE ? pending : 0);
    const idle = ws.idleMs + (ws.state === WorkSessionState.IDLE ? pending : 0);
    const brk = ws.breakMs + (ws.state === WorkSessionState.BREAK ? pending : 0);
    const live = ws.state !== WorkSessionState.ENDED;

    const prev = byUser.get(ws.userId);
    if (!prev) {
      byUser.set(ws.userId, {
        user: ws.user,
        activeMs: active,
        idleMs: idle,
        breakMs: brk,
        screenMs: active + idle + brk,
        idleCount: ws.idleCount,
        breakCount: ws.breakCount,
        state: ws.state,
        firstLoginAt: ws.startedAt,
        lastActivityAt: ws.lastActivityAt,
        isLive: live,
      });
      continue;
    }

    prev.activeMs += active;
    prev.idleMs += idle;
    prev.breakMs += brk;
    prev.screenMs += active + idle + brk;
    prev.idleCount += ws.idleCount;
    prev.breakCount += ws.breakCount;
    if (ws.startedAt < prev.firstLoginAt) prev.firstLoginAt = ws.startedAt;
    if (ws.lastActivityAt > prev.lastActivityAt) prev.lastActivityAt = ws.lastActivityAt;
    // A live session anywhere wins over an ended one for the displayed state.
    if (live && !prev.isLive) {
      prev.isLive = true;
      prev.state = ws.state;
    }
  }

  const rows = [...byUser.values()]
    .map((r) => ({
      ...r,
      // Productivity = active as a share of time actually at the desk.
      // Break is excluded from the denominator: a sanctioned break should not
      // read as unproductive, or the number just punishes taking one.
      productivityPct:
        r.activeMs + r.idleMs > 0
          ? Math.round((r.activeMs / (r.activeMs + r.idleMs)) * 100)
          : null,
    }))
    .sort((a, b) => Number(b.isLive) - Number(a.isLive) || b.activeMs - a.activeMs);

  return ok({
    scope,
    inactivityMinutes: cfg.inactivityMinutes,
    generatedAt: new Date().toISOString(),
    agents: rows,
  });
});
