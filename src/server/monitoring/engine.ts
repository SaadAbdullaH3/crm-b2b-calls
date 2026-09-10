/**
 * Monitoring Engine — TM-01, TM-03, TM-04, TM-06.
 *
 * The build plan flags this as the least-precedented module in the project:
 * none of the reference CRMs have it, so the model here is our own.
 *
 * THE MODEL, in one paragraph. Each signed-in auth session gets one
 * `work_sessions` row holding three counters — active, idle, break — plus a
 * marker (`lastHeartbeatAt`) meaning "everything before this instant is
 * already counted". Any event that could change the picture first *accrues*
 * the interval since the marker into whichever bucket the current state names,
 * then moves the marker and applies the transition. Time is therefore never
 * double-counted and never lost, and a month of monitoring is a few hundred
 * rows instead of millions of heartbeats.
 *
 * WHERE ACTIVE TIME STOPS (TM-03). "If no qualifying activity is detected for
 * 5 continuous minutes, Active Time must stop." We stop it at the moment
 * activity was last seen, not five minutes later — the intervening five
 * minutes were, in hindsight, not worked. Counting them as active would
 * reward idling in exactly 4-minute increments.
 *
 * Safe to import from the custom server: no `server-only`, no `next/*`. The
 * idle sweep runs from cron, which is the whole point — a closed browser must
 * still go idle. See session-core.ts for why that constraint exists.
 */

import { WorkSessionState, type WorkSession } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";

/** TM-06 activity event types. Written to Dev A's `activity_events` table. */
export const ACTIVITY = {
  LOGIN: "session.login",
  LOGOUT: "session.logout",
  SESSION_EXPIRED: "session.expired",
  IDLE_START: "monitoring.idle.start",
  IDLE_END: "monitoring.idle.end",
  BREAK_START: "monitoring.break.start",
  BREAK_END: "monitoring.break.end",
  NAVIGATION: "ui.navigation",
} as const;

export type ActivityType = (typeof ACTIVITY)[keyof typeof ACTIVITY];

/**
 * TM-06 — record a meaningful event. Best-effort: a failed audit write must
 * never break the action it describes.
 */
export async function recordActivity(
  userId: string,
  type: ActivityType | string,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.activityEvent.create({
      data: { userId, type, payload: (payload ?? undefined) as never },
    });
  } catch (e) {
    console.error("[monitoring] activity event failed", { userId, type }, e);
  }
}

/**
 * Adds the interval since the marker to the bucket named by `state`.
 *
 * `upTo` lets a caller split an interval across a transition — the idle sweep
 * accrues ACTIVE up to the last activity, then starts IDLE from there, so the
 * boundary lands in the right place rather than at sweep time.
 */
function accrual(
  ws: Pick<WorkSession, "state" | "lastHeartbeatAt">,
  upTo: Date,
): { activeMs?: { increment: number }; idleMs?: { increment: number }; breakMs?: { increment: number } } {
  const delta = upTo.getTime() - ws.lastHeartbeatAt.getTime();
  // Clock skew or a duplicate call: contribute nothing rather than a negative.
  if (delta <= 0) return {};

  switch (ws.state) {
    case WorkSessionState.ACTIVE:
      return { activeMs: { increment: delta } };
    case WorkSessionState.IDLE:
      return { idleMs: { increment: delta } };
    case WorkSessionState.BREAK:
      return { breakMs: { increment: delta } };
    default:
      // ENDED accrues nothing — the session is closed.
      return {};
  }
}

/** TM-01 — begin measuring screen time. Called from the login route. */
export async function startWorkSession(
  sessionId: string,
  userId: string,
): Promise<void> {
  const now = new Date();
  try {
    await prisma.workSession.create({
      data: {
        sessionId,
        userId,
        state: WorkSessionState.ACTIVE,
        startedAt: now,
        lastHeartbeatAt: now,
        lastActivityAt: now,
      },
    });
  } catch (e) {
    // Unique violation = the session already has one. Harmless.
    if ((e as { code?: string }).code !== "P2002") {
      console.error("[monitoring] startWorkSession failed", { sessionId }, e);
      return;
    }
  }
  await recordActivity(userId, ACTIVITY.LOGIN, { sessionId });
}

export interface HeartbeatResult {
  state: WorkSessionState;
  /** True if this heartbeat brought the user back from idle. */
  resumed: boolean;
}

/**
 * TM-03 — a heartbeat from the browser.
 *
 * `hadActivity` is the important flag: a heartbeat only proves the tab is
 * open, so a page left on a locked screen keeps beating forever. Only real
 * input moves `lastActivityAt`, and only that stops the user going idle.
 *
 * A heartbeat carrying activity while on BREAK does NOT end the break — the
 * agent ends it deliberately. Otherwise moving the mouse past a laptop would
 * silently end someone's lunch.
 */
export async function recordHeartbeat(
  sessionId: string,
  hadActivity: boolean,
): Promise<HeartbeatResult | null> {
  const ws = await prisma.workSession.findUnique({ where: { sessionId } });
  if (!ws || ws.state === WorkSessionState.ENDED) return null;

  const now = new Date();
  const inactivityMs = await getInactivityMs();

  if (ws.state === WorkSessionState.BREAK) {
    await prisma.workSession.update({
      where: { sessionId },
      data: { ...accrual(ws, now), lastHeartbeatAt: now },
    });
    return { state: WorkSessionState.BREAK, resumed: false };
  }

  const wasIdle = ws.state === WorkSessionState.IDLE;

  if (hadActivity) {
    if (wasIdle) {
      // Resuming: everything since the marker was idle; active restarts now.
      await prisma.workSession.update({
        where: { sessionId },
        data: {
          ...accrual(ws, now),
          state: WorkSessionState.ACTIVE,
          lastHeartbeatAt: now,
          lastActivityAt: now,
        },
      });
      await recordActivity(ws.userId, ACTIVITY.IDLE_END, { sessionId });
      return { state: WorkSessionState.ACTIVE, resumed: true };
    }

    await prisma.workSession.update({
      where: { sessionId },
      data: { ...accrual(ws, now), lastHeartbeatAt: now, lastActivityAt: now },
    });
    return { state: WorkSessionState.ACTIVE, resumed: false };
  }

  // No activity this tick. Has the window elapsed?
  const staleFor = now.getTime() - ws.lastActivityAt.getTime();
  if (!wasIdle && staleFor >= inactivityMs) {
    return { state: await transitionToIdle(ws, now), resumed: false };
  }

  await prisma.workSession.update({
    where: { sessionId },
    data: { ...accrual(ws, now), lastHeartbeatAt: now },
  });
  return { state: ws.state, resumed: false };
}

/**
 * Flips one session to IDLE, splitting the interval at the last activity so
 * active time stops where the work stopped rather than where we noticed.
 */
async function transitionToIdle(
  ws: Pick<WorkSession, "sessionId" | "userId" | "state" | "lastHeartbeatAt" | "lastActivityAt">,
  now: Date,
): Promise<WorkSessionState> {
  // Guard against an already-counted boundary (a sweep racing a heartbeat).
  const boundary =
    ws.lastActivityAt > ws.lastHeartbeatAt ? ws.lastActivityAt : ws.lastHeartbeatAt;

  const activeDelta = boundary.getTime() - ws.lastHeartbeatAt.getTime();
  const idleDelta = now.getTime() - boundary.getTime();

  await prisma.workSession.update({
    where: { sessionId: ws.sessionId },
    data: {
      activeMs: activeDelta > 0 ? { increment: activeDelta } : undefined,
      idleMs: idleDelta > 0 ? { increment: idleDelta } : undefined,
      state: WorkSessionState.IDLE,
      idleCount: { increment: 1 },
      lastHeartbeatAt: now,
    },
  });

  await recordActivity(ws.userId, ACTIVITY.IDLE_START, {
    sessionId: ws.sessionId,
    idleSince: boundary.toISOString(),
  });

  return WorkSessionState.IDLE;
}

/** TM-03/AD-07 — the configurable window. Never hard-code 5 minutes. */
async function getInactivityMs(): Promise<number> {
  const cfg = await getSetting("monitoring.config");
  return cfg.inactivityMinutes * 60_000;
}

// --- TM-04 breaks -----------------------------------------------------------

export async function startBreak(
  sessionId: string,
  reason?: string,
): Promise<{ ok: true; breakId: string } | { ok: false; error: string }> {
  const ws = await prisma.workSession.findUnique({ where: { sessionId } });
  if (!ws || ws.state === WorkSessionState.ENDED) {
    return { ok: false, error: "No active work session." };
  }
  if (ws.state === WorkSessionState.BREAK) {
    return { ok: false, error: "Already on break." };
  }

  const now = new Date();

  const created = await prisma.$transaction(async (tx) => {
    await tx.workSession.update({
      where: { sessionId },
      data: {
        ...accrual(ws, now),
        state: WorkSessionState.BREAK,
        breakCount: { increment: 1 },
        lastHeartbeatAt: now,
      },
    });
    return tx.breakPeriod.create({
      data: { workSessionId: ws.id, userId: ws.userId, startedAt: now, reason: reason ?? null },
    });
  });

  await recordActivity(ws.userId, ACTIVITY.BREAK_START, { sessionId, reason });
  return { ok: true, breakId: created.id };
}

/**
 * Ends the open break. `autoClosed` marks breaks closed by logout or the
 * sweep rather than by the agent — an unclosed break is a data-quality signal,
 * not a nine-hour lunch, and reports should be able to tell them apart.
 */
export async function endBreak(
  sessionId: string,
  autoClosed = false,
): Promise<{ ok: true; durationMs: number } | { ok: false; error: string }> {
  const ws = await prisma.workSession.findUnique({ where: { sessionId } });
  if (!ws) return { ok: false, error: "No work session." };
  if (ws.state !== WorkSessionState.BREAK) return { ok: false, error: "Not on break." };

  const now = new Date();
  const open = await prisma.breakPeriod.findFirst({
    where: { workSessionId: ws.id, endedAt: null },
    orderBy: { startedAt: "desc" },
  });

  const durationMs = open ? now.getTime() - open.startedAt.getTime() : 0;

  await prisma.$transaction(async (tx) => {
    await tx.workSession.update({
      where: { sessionId },
      data: {
        ...accrual(ws, now),
        // Returning from a break counts as activity: the agent is back.
        state: WorkSessionState.ACTIVE,
        lastHeartbeatAt: now,
        lastActivityAt: now,
      },
    });
    if (open) {
      await tx.breakPeriod.update({
        where: { id: open.id },
        data: { endedAt: now, durationMs, autoClosed },
      });
    }
  });

  await recordActivity(ws.userId, ACTIVITY.BREAK_END, { sessionId, durationMs, autoClosed });
  return { ok: true, durationMs };
}

// --- session end ------------------------------------------------------------

/**
 * TM-01 — close the work session. Called on logout and by the expiry sweep.
 *
 * Idempotent: closing an already-ended session is a no-op, because logout and
 * the sweep can both reach the same session.
 */
export async function endWorkSession(
  sessionId: string,
  reason: "logout" | "expired" = "logout",
): Promise<void> {
  const ws = await prisma.workSession.findUnique({ where: { sessionId } });
  if (!ws || ws.state === WorkSessionState.ENDED) return;

  // An agent who logs out mid-break leaves an open break row behind.
  if (ws.state === WorkSessionState.BREAK) {
    await endBreak(sessionId, true);
  }

  const fresh = await prisma.workSession.findUnique({ where: { sessionId } });
  if (!fresh || fresh.state === WorkSessionState.ENDED) return;

  const now = new Date();
  await prisma.workSession.update({
    where: { sessionId },
    data: {
      ...accrual(fresh, now),
      state: WorkSessionState.ENDED,
      endedAt: now,
      lastHeartbeatAt: now,
    },
  });

  await recordActivity(
    ws.userId,
    reason === "logout" ? ACTIVITY.LOGOUT : ACTIVITY.SESSION_EXPIRED,
    { sessionId },
  );
}

// --- TM-03 the cron body ----------------------------------------------------

export interface IdleSweepResult {
  markedIdle: number;
  closed: number;
}

/**
 * The idle sweep. THIS is what makes TM-03 real.
 *
 * A browser-side timer cannot do this job: an agent who closes their laptop
 * never sends another heartbeat, so nothing client-side would ever mark them
 * idle — their shift would read as 100% active. The sweep runs server-side
 * every minute regardless of who is connected.
 *
 * Two passes:
 *  1. ACTIVE sessions whose last activity is older than the window -> IDLE.
 *  2. Any open work session whose auth session is revoked or expired -> ENDED.
 *     Without this, a closed browser accrues idle time forever.
 */
export async function runIdleSweep(): Promise<IdleSweepResult> {
  const now = new Date();
  const inactivityMs = await getInactivityMs();
  const cutoff = new Date(now.getTime() - inactivityMs);

  const stale = await prisma.workSession.findMany({
    where: { state: WorkSessionState.ACTIVE, lastActivityAt: { lt: cutoff } },
    select: {
      sessionId: true,
      userId: true,
      state: true,
      lastHeartbeatAt: true,
      lastActivityAt: true,
    },
  });

  let markedIdle = 0;
  for (const ws of stale) {
    try {
      await transitionToIdle(ws, now);
      markedIdle++;
    } catch (e) {
      console.error("[monitoring] idle transition failed", ws.sessionId, e);
    }
  }

  // Pass 2 — the auth session is gone but the work session is still open.
  const orphaned = await prisma.workSession.findMany({
    where: {
      state: { not: WorkSessionState.ENDED },
      session: {
        OR: [{ revokedAt: { not: null } }, { expiresAt: { lte: now } }],
      },
    },
    select: { sessionId: true },
  });

  let closed = 0;
  for (const { sessionId } of orphaned) {
    try {
      await endWorkSession(sessionId, "expired");
      closed++;
    } catch (e) {
      console.error("[monitoring] session close failed", sessionId, e);
    }
  }

  return { markedIdle, closed };
}
