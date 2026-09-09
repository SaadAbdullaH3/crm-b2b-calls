import { z } from "zod";
import { AssignmentMethod } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, badRequest, conflict, parseBody } from "@/lib/api";
import { assignSpecificLeads } from "@/server/leads/assignment";

/**
 * LA-06 / LA-07 — Management assigns, transfers or reassigns specific leads
 * outside the request flow.
 *
 * One endpoint covers assign / transfer / reassign because they are the same
 * operation: give these leads to this agent. Whether a lead was previously
 * unowned or held by someone else only changes which history rows get written,
 * and assignSpecificLeads decides that per lead inside one transaction.
 */

const AssignSchema = z.object({
  leadIds: z.array(z.string().min(1)).min(1).max(500),
  agentId: z.string().min(1),
  note: z.string().max(500).trim().nullable().optional(),
});

export const POST = requirePermission("leads.assign", async (req, { user }) => {
  const parsed = await parseBody(req, AssignSchema);
  if (!parsed.success) return parsed.res;
  const { leadIds, agentId, note } = parsed.data;

  const agent = await prisma.user.findUnique({
    where: { id: agentId },
    include: { role: true },
  });
  if (!agent) return badRequest("No such user.");
  if (!agent.isActive) return conflict("That user is deactivated.");

  // Assigning leads to someone who cannot call them is almost certainly a
  // mistake, and it would strand the leads outside every call list.
  //
  // Must match the filter in /api/leads/agents exactly, or the picker hides a
  // user the API still accepts — which is how a lead ends up assigned to the
  // Admin account and invisible to everyone. Admin holds every permission,
  // `leads.read.own` included, so the `leads.approve` exclusion is what
  // separates "can call leads" from "administers the pipeline".
  const [canCall, isApprover] = await Promise.all([
    prisma.rolePermission.count({
      where: { roleId: agent.roleId, permission: { key: "leads.read.own" } },
    }),
    prisma.rolePermission.count({
      where: { roleId: agent.roleId, permission: { key: "leads.approve" } },
    }),
  ]);

  if (canCall === 0 || isApprover > 0) {
    return conflict(
      `${agent.fullName} is ${agent.role.label} and cannot be assigned leads to call.`,
    );
  }

  const result = await assignSpecificLeads({
    leadIds: [...new Set(leadIds)],
    agentId,
    actorId: user.id,
    method: AssignmentMethod.MANUAL,
    notes: note,
  });

  return ok({
    assigned: result.assigned.length,
    skipped: result.skipped,
    leadIds: result.assigned,
  });
});
