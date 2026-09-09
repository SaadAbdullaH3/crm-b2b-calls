import { AssignmentMethod, LeadRequestStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { assignLeadsFromPool } from "@/server/leads/assignment";
import { notify, NOTIFICATION } from "@/lib/notifications";
import { EVENTS, emitToUser, emitToRole } from "@/server/socket";
import type { RequestResolvedPayload } from "@/lib/realtime/events";

/**
 * LA-04 / LA-05 — resolving a lead request, from either direction.
 *
 * Two things can resolve the same PENDING request: a human on the approval
 * screen, and the 5-minute auto-assign job. They can collide — Management can
 * click Approve in the same second the sweep fires.
 *
 * The guard is a conditional status transition: claim the request with an
 * UPDATE ... WHERE status = 'PENDING', and only continue if exactly one row
 * changed. The loser does nothing. Without it, an agent gets two batches for
 * one request and the pool drains twice as fast as anyone intended.
 */

export type ResolveAction = "APPROVE" | "REJECT" | "AUTO_ASSIGN";

export interface ResolveArgs {
  requestId: string;
  action: ResolveAction;
  /** APPROVE only: a different quantity than the agent asked for (LA-04 "modify"). */
  quantity?: number;
  /** Null for the system. */
  actorId: string | null;
  note?: string | null;
}

export interface ResolveResult {
  status: LeadRequestStatus;
  requested: number;
  assigned: number;
  agentId: string;
  /** False when someone else resolved it first. */
  claimed: boolean;
}

/**
 * Atomically moves a request out of PENDING. Returns null if it was already
 * resolved by the other path.
 */
async function claimRequest(
  requestId: string,
  next: LeadRequestStatus,
): Promise<{ agentId: string; quantityRequested: number } | null> {
  const claimed = await prisma.leadRequest.updateMany({
    where: { id: requestId, status: LeadRequestStatus.PENDING },
    data: { status: next },
  });
  if (claimed.count !== 1) return null;

  const request = await prisma.leadRequest.findUniqueOrThrow({
    where: { id: requestId },
    select: { agentId: true, quantityRequested: true },
  });
  return request;
}

export async function resolveRequest(args: ResolveArgs): Promise<ResolveResult> {
  const { requestId, action, actorId, note } = args;

  if (action === "REJECT") {
    const claimed = await claimRequest(requestId, LeadRequestStatus.REJECTED);
    if (!claimed) {
      return { status: LeadRequestStatus.REJECTED, requested: 0, assigned: 0, agentId: "", claimed: false };
    }

    await prisma.leadRequest.update({
      where: { id: requestId },
      data: { reviewedById: actorId, reviewedAt: new Date(), reviewNote: note ?? null, resolvedAt: new Date() },
    });

    await announceResolved({
      requestId,
      agentId: claimed.agentId,
      status: LeadRequestStatus.REJECTED,
      assigned: 0,
      by: actorId ? "MANAGEMENT" : "SYSTEM",
      title: "Your lead request was declined",
      body: note ?? undefined,
    });

    return {
      status: LeadRequestStatus.REJECTED,
      requested: claimed.quantityRequested,
      assigned: 0,
      agentId: claimed.agentId,
      claimed: true,
    };
  }

  const isAuto = action === "AUTO_ASSIGN";

  // Claim into the terminal status up front. If assignment then comes up short
  // because the pool is empty, the status still reflects that it was actioned —
  // quantityAssigned carries the truth about how many actually landed.
  const target = isAuto ? LeadRequestStatus.AUTO_ASSIGNED : LeadRequestStatus.APPROVED;
  const claimed = await claimRequest(requestId, target);
  if (!claimed) {
    return { status: target, requested: 0, assigned: 0, agentId: "", claimed: false };
  }

  const quantity = args.quantity ?? claimed.quantityRequested;
  const modified = !isAuto && quantity !== claimed.quantityRequested;

  const result = await assignLeadsFromPool({
    agentId: claimed.agentId,
    quantity,
    method: isAuto ? AssignmentMethod.AUTO_ASSIGN : AssignmentMethod.REQUEST_APPROVED,
    actorId,
    requestId,
  });

  await prisma.leadRequest.update({
    where: { id: requestId },
    data: {
      status: modified ? LeadRequestStatus.MODIFIED : target,
      quantityApproved: quantity,
      quantityAssigned: result.assigned,
      reviewedById: actorId,
      reviewedAt: new Date(),
      reviewNote: note ?? null,
      resolvedAt: new Date(),
    },
  });

  // The agent is told by assignLeadsFromPool's LEAD_BATCH_ASSIGNED notification;
  // this one carries the request outcome, including a short-fill.
  const shortfall = result.assigned < quantity;
  await announceResolved({
    requestId,
    agentId: claimed.agentId,
    status: modified ? LeadRequestStatus.MODIFIED : target,
    assigned: result.assigned,
    by: isAuto ? "SYSTEM" : "MANAGEMENT",
    title: shortfall
      ? `${result.assigned} of ${quantity} leads assigned`
      : `${result.assigned} leads assigned`,
    body: shortfall ? "The available lead pool ran out." : undefined,
  });

  return {
    status: modified ? LeadRequestStatus.MODIFIED : target,
    requested: claimed.quantityRequested,
    assigned: result.assigned,
    agentId: claimed.agentId,
    claimed: true,
  };
}

async function announceResolved(args: {
  requestId: string;
  agentId: string;
  status: LeadRequestStatus;
  assigned: number;
  by: "MANAGEMENT" | "SYSTEM";
  title: string;
  body?: string;
}) {
  const payload: RequestResolvedPayload = {
    requestId: args.requestId,
    agentId: args.agentId,
    status: args.status,
    quantityAssigned: args.assigned,
    resolvedBy: args.by,
    at: new Date().toISOString(),
  };

  emitToUser(args.agentId, EVENTS.REQUEST_RESOLVED, payload);
  emitToRole("management", EVENTS.REQUEST_RESOLVED, payload);
  emitToRole("admin", EVENTS.REQUEST_RESOLVED, payload);

  await notify({
    userId: args.agentId,
    type: NOTIFICATION.LEAD_REQUEST_RESOLVED,
    title: args.title,
    body: args.body,
    payload: { requestId: args.requestId },
  });
}

/**
 * LA-05 — the 5-minute sweep. Called from the cron job in server.ts.
 *
 * Selects on `auto_assign_at`, a column, rather than tracking timers in memory,
 * so a request submitted before a restart still gets filled afterwards. The
 * countdown an agent sees in the browser is decoration; this is the mechanism.
 */
export async function runAutoAssignSweep(): Promise<{
  processed: number;
  assigned: number;
}> {
  const due = await prisma.leadRequest.findMany({
    where: { status: LeadRequestStatus.PENDING, autoAssignAt: { lte: new Date() } },
    orderBy: { autoAssignAt: "asc" },
    select: { id: true },
    take: 100,
  });

  let processed = 0;
  let assigned = 0;

  for (const request of due) {
    try {
      const result = await resolveRequest({
        requestId: request.id,
        action: "AUTO_ASSIGN",
        actorId: null,
      });
      if (result.claimed) {
        processed++;
        assigned += result.assigned;
      }
    } catch (e) {
      // One bad request must not stop the sweep for everyone else.
      console.error("[auto-assign] request failed", request.id, e);
    }
  }

  return { processed, assigned };
}
