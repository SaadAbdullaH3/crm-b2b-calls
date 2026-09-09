import { z } from "zod";
import { LeadRequestStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, notFound, conflict, parseBody } from "@/lib/api";
import { resolveRequest } from "@/server/leads/requests";
import { getSetting } from "@/lib/settings";

/**
 * LA-04 — Management approves, rejects, or modifies the quantity on a pending
 * lead request.
 *
 * "Modify" is not a separate action: it is APPROVE with a different quantity,
 * which is what the SRS describes and what keeps the audit trail simple —
 * quantityRequested and quantityApproved both sit on the row.
 */

const ResolveSchema = z.object({
  action: z.enum(["APPROVE", "REJECT"]),
  /** APPROVE only. Omit to approve exactly what the agent asked for. */
  quantity: z.number().int().positive().optional(),
  note: z.string().max(500).trim().nullable().optional(),
});

export const POST = requirePermission("leads.approve", async (req, { user, params }) => {
  const id = params?.id as string;

  const parsed = await parseBody(req, ResolveSchema);
  if (!parsed.success) return parsed.res;
  const { action, quantity, note } = parsed.data;

  const request = await prisma.leadRequest.findUnique({ where: { id } });
  if (!request) return notFound("No such lead request.");
  if (request.status !== LeadRequestStatus.PENDING) {
    return conflict(
      `This request is already ${request.status.toLowerCase().replace(/_/g, " ")}.`,
    );
  }

  if (action === "APPROVE" && quantity !== undefined) {
    const config = await getSetting("assignment.config");
    if (quantity > config.maxRequestQuantity) {
      return conflict(`The maximum assignable in one go is ${config.maxRequestQuantity}.`);
    }
  }

  const result = await resolveRequest({
    requestId: id,
    action,
    quantity,
    actorId: user.id,
    note,
  });

  // The 5-minute job got there first. Report it rather than pretending the
  // click worked — the agent already has their leads.
  if (!result.claimed) {
    return conflict(
      "That request was already actioned — the auto-assign job resolved it first.",
    );
  }

  const updated = await prisma.leadRequest.findUniqueOrThrow({
    where: { id },
    include: {
      agent: { select: { id: true, fullName: true } },
      reviewedBy: { select: { id: true, fullName: true } },
    },
  });

  return ok({ request: updated, assigned: result.assigned });
});
