import { ReleaseReason } from "@prisma/client";
import { prisma } from "@/lib/db";
import { returnUncalledLeadsIfSignedOut } from "@/server/leads/assignment";

/**
 * LA-09, the case the logout button doesn't cover.
 *
 * An agent who closes the browser never hits /api/auth/logout. Their session
 * simply expires, and without this their uncalled leads stay locked to someone
 * who is no longer signed in — invisible to every other agent until Management
 * notices and releases them by hand.
 *
 * Runs from the cron in server.ts. Shares the `sessions` table with Dev B's
 * Monitoring Engine, so "no longer signed in" means the same thing on both
 * tracks.
 */
export async function runExpiredSessionSweep(): Promise<{
  agents: number;
  released: number;
}> {
  // Agents still holding leads who have no live session left. Checking
  // ownership first keeps this cheap: it is a small set, and the common case
  // (nobody holding stale leads) costs one indexed query per minute.
  const holders = await prisma.lead.findMany({
    where: { assignedToId: { not: null }, lastDispositionCode: null },
    select: { assignedToId: true },
    distinct: ["assignedToId"],
  });

  if (holders.length === 0) return { agents: 0, released: 0 };

  let agents = 0;
  let released = 0;

  for (const holder of holders) {
    const agentId = holder.assignedToId;
    if (!agentId) continue;

    const ids = await returnUncalledLeadsIfSignedOut(
      agentId,
      ReleaseReason.LOGOUT_RETURN,
    );
    if (ids.length > 0) {
      agents++;
      released += ids.length;
    }
  }

  return { agents, released };
}
