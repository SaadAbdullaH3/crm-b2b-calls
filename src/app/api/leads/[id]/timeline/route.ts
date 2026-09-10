import { prisma } from "@/lib/db";
import { requireAuth } from "@/lib/auth/rbac";
import { ok, notFound } from "@/lib/api";
import { buildLeadTimeline } from "@/server/leads/timeline";

/**
 * SF-03 — one lead's full history.
 *
 * ACCESS: `leads.timeline` (Management/Admin) sees any lead. An agent sees the
 * timeline of a lead ASSIGNED TO THEM — deliberately, because "what did the
 * last person say?" is the single most useful thing to know before dialling,
 * and it leaks nothing: they already hold the lead.
 *
 * Implemented as a route-level ownership check rather than a new permission
 * key, so the AD-02 matrix is untouched and Management can still revoke
 * `leads.timeline` without affecting agents' access to their own work.
 */
export const GET = requireAuth(async (_req, { user, params }) => {
  const id = params?.id as string;

  if (!user.permissions.includes("leads.timeline")) {
    const owned = await prisma.lead.count({ where: { id, assignedToId: user.id } });
    if (owned === 0) return notFound("No such lead.");
  }

  const timeline = await buildLeadTimeline(id);
  if (!timeline) return notFound("No such lead.");

  return ok(timeline);
});
