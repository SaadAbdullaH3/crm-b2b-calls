import { z } from "zod";
import { requireAuth } from "@/lib/auth/rbac";
import { getCurrentSessionId } from "@/lib/auth/session";
import { ok, badRequest, conflict, notFound, parseBody } from "@/lib/api";
import { startBreak, endBreak } from "@/server/monitoring/engine";

/**
 * TM-04 — the agent's own break control.
 *
 * requireAuth and self-scoped, for the same reason as the heartbeat: TM-04
 * says agents "must also have a control to mark themselves on break", while
 * TM-05 says they hold no monitoring permission. Both hold because the route
 * acts only on the caller's session and never accepts a userId.
 *
 * Management configures the RULES (monitoring.breaks.configure, AD-07);
 * agents exercise the CONTROL. Different things, different gates.
 */

const BreakSchema = z.object({
  action: z.enum(["start", "end"]),
  reason: z.string().max(200).trim().optional(),
});

export const POST = requireAuth(async (req) => {
  const sessionId = await getCurrentSessionId();
  if (!sessionId) return notFound("No active session.");

  const parsed = await parseBody(req, BreakSchema);
  if (!parsed.success) return parsed.res;

  if (parsed.data.action === "start") {
    const result = await startBreak(sessionId, parsed.data.reason);
    if (!result.ok) return conflict(result.error);
    return ok({ onBreak: true, breakId: result.breakId }, 201);
  }

  const result = await endBreak(sessionId, false);
  if (!result.ok) return conflict(result.error);
  return ok({ onBreak: false, durationMs: result.durationMs });
});

export const GET = requireAuth(async () => badRequest("Use POST with action start|end."));
