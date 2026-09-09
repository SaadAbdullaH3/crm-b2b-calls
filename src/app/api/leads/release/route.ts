import { z } from "zod";
import { ReleaseReason } from "@prisma/client";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, parseBody } from "@/lib/api";
import { releaseLeads } from "@/server/leads/assignment";

/** LA-06 — Management returns leads to the available pool. */

const ReleaseSchema = z.object({
  leadIds: z.array(z.string().min(1)).min(1).max(500),
});

export const POST = requirePermission("leads.release", async (req, { user }) => {
  const parsed = await parseBody(req, ReleaseSchema);
  if (!parsed.success) return parsed.res;

  const released = await releaseLeads({
    leadIds: [...new Set(parsed.data.leadIds)],
    reason: ReleaseReason.RELEASED_BY_MANAGEMENT,
    actorId: user.id,
  });

  return ok({ released: released.length, leadIds: released });
});
