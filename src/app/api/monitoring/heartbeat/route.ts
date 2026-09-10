import { z } from "zod";
import { requireAuth } from "@/lib/auth/rbac";
import { getCurrentSessionId } from "@/lib/auth/session";
import { ok, parseBody, notFound } from "@/lib/api";
import { recordHeartbeat } from "@/server/monitoring/engine";
import { getSetting } from "@/lib/settings";

/**
 * TM-01/TM-03 — browser heartbeat.
 *
 * requireAuth, NOT requirePermission. Agents hold no `monitoring.*` key by
 * design (TM-05) and must not gain one, or the AD-02 matrix guard would have
 * to be weakened. This route never accepts a userId: it acts only on the
 * caller's own session, so there is nothing to authorise beyond being signed
 * in and nothing to enumerate.
 *
 * The RESPONSE is deliberately minimal — a state string and the heartbeat
 * interval. No active/idle/break totals, because an agent may call this and
 * TM-05 forbids showing them those numbers.
 */

const HeartbeatSchema = z.object({
  /** Real input since the last beat. A beat alone only proves the tab is open. */
  hadActivity: z.boolean().default(false),
});

export const POST = requireAuth(async (req) => {
  const sessionId = await getCurrentSessionId();
  if (!sessionId) return notFound("No active session.");

  const parsed = await parseBody(req, HeartbeatSchema);
  const hadActivity = parsed.success ? parsed.data.hadActivity : false;

  const result = await recordHeartbeat(sessionId, hadActivity);
  if (!result) return notFound("No active work session.");

  const cfg = await getSetting("monitoring.config");

  return ok({
    state: result.state,
    resumed: result.resumed,
    heartbeatSeconds: cfg.heartbeatSeconds,
  });
});
