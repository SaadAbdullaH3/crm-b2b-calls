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
 * reward idling in exactly 4-minute increments. Every path that closes an
 * interval applies this same rule; see `splitStaleInterval`.
 *
 * CONCURRENCY. Every mutation takes a row lock on the work session first
 * (`withLockedSession`). Read-then-increment without one is not safe here: a
 * heartbeat and the cron sweep touching the same row would each compute their
 * delta from a stale marker, double-counting the overlap and letting the
 * later write clobber the other's state transition. The counters themselves
 * are atomic increments, but the *marker* is last-write-wins, and that is what
 * corrupts the numbers. Same reasoning as Dev A's assignment transaction.
 *
 * Safe to import from the custom server: no `server-only`, no `next/*`. The
 * idle sweep runs from cron, which is the whole point — a closed browser must
 * still go idle. See session-core.ts for why that constraint exists.
 */

import { WorkSessionState, type Prisma, type WorkSession } from "@prisma/client";
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
 * Ceiling on any single accrual, 24 hours.
 *
 * No legitimate interval comes close: a session lives `SESSION_TTL_HOURS`
 * (8 by default) and the sweep closes it at expiry. A larger delta means the
 * clock jumped, the machine resumed from hibernation, or the server was down
 * for days — none of which is time anyone worked. Recording it would both
 * poison the report and, at genuinely absurd values, overflow the INTEGER
 * columns. Clamping fixes the data-quality problem; widening the column to
 * BIGINT would only have raised the ceiling on the garbage.
 */
const MAX_ACCRUAL_MS = 24 * 60 * 60 * 1000;

function clampDelta(ms: number, context: string): number {
  if (ms <= 0) return 0;
  if (ms > MAX_ACCRUAL_MS) {
    console.warn(
      `[monitoring] implausible interval clamped (${Math.round(ms / 60_000)} min) at ${context} — clock jump, resume from sleep, or a long outage`,
    );
    return MAX_ACCRUAL_MS;
  }
  return ms;
}

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
 * Runs `fn` with an exclusive row lock on the work session.
 *
 * `SELECT ... FOR UPDATE` blocks any other transaction touching the same row
 * until this one commits, which is what makes read-compute-write safe. We take
 * the lock with a raw statement and then re-read through Prisma so the
 * callback still gets typed, camelCased data.
 *
 * Returns null when the session does not exist.
 */
async function withLockedSession<T>(
  sessionId: string,
  fn: (tx: Prisma.TransactionClient, ws: WorkSession) => Promise<T>,
): Promise<T | null> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM work_sessions WHERE session_id = ${sessionId} FOR UPDATE
    `;
    if (locked.length === 0) return null;

    // Re-read under the lock: this is the authoritative snapshot.
    const ws = await tx.workSession.findUnique({ where: { sessionId } });
    if (!ws) return null;

    return fn(tx, ws);
  });
}

/**
 * Adds the interval since the marker to the bucket named by `state`.
 *
 * `upTo` lets a caller split an interval across a transition — the idle path
 * accrues ACTIVE up to the last activity, then starts IDLE from there, so the
 * boundary lands where the work stopped rather than where we noticed.
 */
function accrual(
  ws: Pick<WorkSession, "state" | "lastHeartbeatAt">,
  upTo: Date,
): Prisma.WorkSessionUpdateInput {
  const delta = clampDelta(upTo.getTime() - ws.lastHeartbeatAt.getTime(), `state=${ws.state}`);
  if (delta === 0) return {};

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

/**
 * Splits an ACTIVE interval that has gone stale into its worked and unworked
 * halves: active up to the last activity, idle from there to `upTo`.
 *
 * Used by BOTH the idle transition and the "activity arrived after the window
 * had already elapsed" case. Keeping one implementation is the point — an
 * earlier version checked staleness only on the no-activity path, so a
 * heartbeat carrying input after a long gap silently booked the whole gap as
 * active.
 */
function splitStaleInterval(
  ws: Pick<WorkSession, "lastHeartbeatAt" | "lastActivityAt">,
  upTo: Date,
): { activeMs?: { increment: number }; idleMs?: { increment: number } } {
  // Guard a boundary that has already been counted (a sweep racing a beat).
  const boundary =
    ws.lastActivityAt > ws.lastHeartbeatAt ? ws.lastActivityAt : ws.lastHeartbeatAt;

  const activeDelta = clampDelta(boundary.getTime() - ws.lastHeartbeatAt.getTime(), "split/active");
  const idleDelta = clampDelta(upTo.getTime() - boundary.getTime(), "split/idle");

  return {
    ...(activeDelta > 0 ? { activeMs: { increment: activeDelta } } : {}),
    ...(idleDelta > 0 ? { idleMs: { increment: idleDelta } } : {}),
  };
}

/** TM-03/AD-07 — the configurable window. Never hard-code 5 minutes. */
async function getInactivityMs(): Promise<number> {
  const cfg = await getSetting("monitoring.config");
  return cfg.inactivityMinutes * 60_000;
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
  const inactivityMs = await getInactivityMs();
  const now = new Date();

  const outcome = await withLockedSession(sessionId, async (tx, ws) => {
    if (ws.state === WorkSessionState.ENDED) return null;

    // --- on break: accrue break time, change nothing else -----------------
    if (ws.state === WorkSessionState.BREAK) {
      await tx.workSession.update({
        where: { sessionId },
        data: { ...accrual(ws, now), lastHeartbeatAt: now },
      });
      return { result: { state: WorkSessionState.BREAK, resumed: false }, event: null };
    }

    const wasIdle = ws.state === WorkSessionState.IDLE;
    const staleFor = now.getTime() - ws.lastActivityAt.getTime();
    const isStale = staleFor >= inactivityMs;

    if (hadActivity) {
      if (wasIdle) {
        // Resuming from idle: everything since the marker was idle.
        await tx.workSession.update({
          where: { sessionId },
          data: {
            ...accrual(ws, now),
            state: WorkSessionState.ACTIVE,
            lastHeartbeatAt: now,
            lastActivityAt: now,
          },
        });
        return {
          result: { state: WorkSessionState.ACTIVE, resumed: true },
          event: ACTIVITY.IDLE_END,
        };
      }

      if (isStale) {
        // Still marked ACTIVE, but the window elapsed before this input
        // arrived and the sweep has not caught up — most likely the server
        // was down, or the machine slept. Book the gap honestly: active up to
        // the last real activity, idle for the rest, then resume active now.
        //
        // Without this the whole gap counted as active, which is exactly the
        // "reward idling in four-minute increments" failure the module is
        // supposed to prevent.
        await tx.workSession.update({
          where: { sessionId },
          data: {
            ...splitStaleInterval(ws, now),
            state: WorkSessionState.ACTIVE,
            idleCount: { increment: 1 },
            lastHeartbeatAt: now,
            lastActivityAt: now,
          },
        });
        return {
          result: { state: WorkSessionState.ACTIVE, resumed: true },
          event: ACTIVITY.IDLE_END,
        };
      }

      await tx.workSession.update({
        where: { sessionId },
        data: { ...accrual(ws, now), lastHeartbeatAt: now, lastActivityAt: now },
      });
      return { result: { state: WorkSessionState.ACTIVE, resumed: false }, event: null };
    }

    // --- no activity this tick --------------------------------------------
    if (!wasIdle && isStale) {
      await tx.workSession.update({
        where: { sessionId },
        data: {
          ...splitStaleInterval(ws, now),
          state: WorkSessionState.IDLE,
          idleCount: { increment: 1 },
          lastHeartbeatAt: now,
        },
      });
      return {
        result: { state: WorkSessionState.IDLE, resumed: false },
        event: ACTIVITY.IDLE_START,
      };
    }

    await tx.workSession.update({
      where: { sessionId },
      data: { ...accrual(ws, now), lastHeartbeatAt: now },
    });
    return { result: { state: ws.state, resumed: false }, event: null };
  });

  if (!outcome) return null;

  // Activity events are written outside the lock: they are audit, not state,
  // and must not extend a transaction that other heartbeats are queued behind.
  if (outcome.event) {
    const ws = await prisma.workSession.findUnique({
      where: { sessionId },
      select: { userId: true },
    });
    if (ws) await recordActivity(ws.userId, outcome.event, { sessionId });
  }

  return outcome.result;
}

// --- TM-04 breaks -----------------------------------------------------------

export async function startBreak(
  sessionId: string,
  reason?: string,
): Promise<{ ok: true; breakId: string } | { ok: false; error: string }> {
  const now = new Date();

  // The state check happens INSIDE the lock. Checking first and transacting
  // afterwards let two simultaneous requests both see "not on break", both
  // open a break period and both report success — leaving an orphan row that
  // endBreak would never close.
  const outcome = await withLockedSession(sessionId, async (tx, ws) => {
    if (ws.state === WorkSessionState.ENDED) {
      return { ok: false as const, error: "No active work session." };
    }
    if (ws.state === WorkSessionState.BREAK) {
      return { ok: false as const, error: "Already on break." };
    }

    await tx.workSession.update({
      where: { sessionId },
      data: {
        ...accrual(ws, now),
        state: WorkSessionState.BREAK,
        breakCount: { increment: 1 },
        lastHeartbeatAt: now,
      },
    });

    const created = await tx.breakPeriod.create({
      data: { workSessionId: ws.id, userId: ws.userId, startedAt: now, reason: reason ?? null },
    });

    return { ok: true as const, breakId: created.id, userId: ws.userId };
  });

  if (!outcome) return { ok: false, error: "No active work session." };
  if (!outcome.ok) return { ok: false, error: outcome.error };

  await recordActivity(outcome.userId, ACTIVITY.BREAK_START, { sessionId, reason });
  return { ok: true, breakId: outcome.breakId };
}

/**
 * Ends the open break. `autoClosed` marks breaks closed by logout or the
 * sweep rather than by the agent — an unclosed break is a data-quality signal,
 * not a nine-hour lunch, and reports should be able to tell them apart.
 *
 * `endAt` lets the expiry path close a break at the moment the auth session
 * actually died rather than whenever the sweep happened to run.
 */
export async function endBreak(
  sessionId: string,
  autoClosed = false,
  endAt?: Date,
): Promise<{ ok: true; durationMs: number } | { ok: false; error: string }> {
  const now = endAt ?? new Date();

  const outcome = await withLockedSession(sessionId, async (tx, ws) => {
    if (ws.state !== WorkSessionState.BREAK) return { ok: false as const, error: "Not on break." };

    const open = await tx.breakPeriod.findFirst({
      where: { workSessionId: ws.id, endedAt: null },
      orderBy: { startedAt: "desc" },
    });

    const durationMs = open
      ? clampDelta(now.getTime() - open.startedAt.getTime(), "break")
      : 0;

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

    return { ok: true as const, durationMs, userId: ws.userId };
  });

  if (!outcome) return { ok: false, error: "No work session." };
  if (!outcome.ok) return { ok: false, error: outcome.error };

  await recordActivity(outcome.userId, ACTIVITY.BREAK_END, {
    sessionId,
    durationMs: outcome.durationMs,
    autoClosed,
  });
  return { ok: true, durationMs: outcome.durationMs };
}

// --- session end ------------------------------------------------------------

/**
 * TM-01 — close the work session. Called on logout and by the expiry sweep.
 *
 * `endAt` is the moment the session actually ended. For a logout that is now;
 * for an expired or revoked session it is `expiresAt` / `revokedAt`, NOT sweep
 * time. Using sweep time would book the gap between expiry and the next cron
 * tick as idle — a minute in normal running, but a whole night if the server
 * was down, which would wreck a punctuality report.
 *
 * Idempotent: closing an already-ended session is a no-op, because logout and
 * the sweep can both reach the same session.
 */
export async function endWorkSession(
  sessionId: string,
  reason: "logout" | "expired" = "logout",
  endAt?: Date,
): Promise<void> {
  const now = new Date();
  // Never project into the future, and never before the interval already
  // counted — a clock skew must not produce a negative accrual.
  const effectiveEnd = endAt && endAt < now ? endAt : now;

  // An agent who logs out mid-break leaves an open break row behind. Closed
  // first, at the same effective instant, so break time and the period row
  // agree.
  const onBreak = await prisma.workSession.findUnique({
    where: { sessionId },
    select: { state: true },
  });
  if (onBreak?.state === WorkSessionState.BREAK) {
    await endBreak(sessionId, true, effectiveEnd);
  }

  const outcome = await withLockedSession(sessionId, async (tx, ws) => {
    if (ws.state === WorkSessionState.ENDED) return null;

    const closeAt = effectiveEnd > ws.lastHeartbeatAt ? effectiveEnd : ws.lastHeartbeatAt;

    await tx.workSession.update({
      where: { sessionId },
      data: {
        ...accrual(ws, closeAt),
        state: WorkSessionState.ENDED,
        endedAt: closeAt,
        lastHeartbeatAt: closeAt,
      },
    });

    return { userId: ws.userId };
  });

  if (!outcome) return;

  await recordActivity(
    outcome.userId,
    reason === "logout" ? ACTIVITY.LOGOUT : ACTIVITY.SESSION_EXPIRED,
    { sessionId, endedAt: effectiveEnd.toISOString() },
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
 *  2. Any open work session whose auth session is revoked or expired -> ENDED,
 *     closed at the moment the auth session died rather than at sweep time.
 */
export async function runIdleSweep(): Promise<IdleSweepResult> {
  const now = new Date();
  const inactivityMs = await getInactivityMs();
  const cutoff = new Date(now.getTime() - inactivityMs);

  const stale = await prisma.workSession.findMany({
    where: {
      state: WorkSessionState.ACTIVE,
      lastActivityAt: { lt: cutoff },
      // Skip sessions whose auth session is already dead — pass 2 closes those
      // and caps their final accrual at the moment they actually ended. If we
      // idled them here first we would accrue up to NOW, pushing the marker
      // past the termination time and defeating that cap.
      session: { revokedAt: null, expiresAt: { gt: now } },
    },
    select: { sessionId: true, userId: true },
  });

  let markedIdle = 0;
  for (const { sessionId, userId } of stale) {
    try {
      // Re-checked under the lock: a heartbeat may have arrived between the
      // query above and this update, in which case the session is no longer
      // stale and must be left alone.
      const flipped = await withLockedSession(sessionId, async (tx, ws) => {
        if (ws.state !== WorkSessionState.ACTIVE) return false;
        if (now.getTime() - ws.lastActivityAt.getTime() < inactivityMs) return false;

        await tx.workSession.update({
          where: { sessionId },
          data: {
            ...splitStaleInterval(ws, now),
            state: WorkSessionState.IDLE,
            idleCount: { increment: 1 },
            lastHeartbeatAt: now,
          },
        });
        return true;
      });

      if (flipped) {
        markedIdle++;
        await recordActivity(userId, ACTIVITY.IDLE_START, { sessionId });
      }
    } catch (e) {
      console.error("[monitoring] idle transition failed", sessionId, e);
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
    select: {
      sessionId: true,
      session: { select: { revokedAt: true, expiresAt: true } },
    },
  });

  let closed = 0;
  for (const row of orphaned) {
    try {
      // Close at whichever ended the session, not at sweep time.
      const { revokedAt, expiresAt } = row.session;
      const endedAt =
        revokedAt && revokedAt < expiresAt ? revokedAt : expiresAt;

      await endWorkSession(row.sessionId, "expired", endedAt);
      closed++;
    } catch (e) {
      console.error("[monitoring] session close failed", row.sessionId, e);
    }
  }

  return { markedIdle, closed };
}
