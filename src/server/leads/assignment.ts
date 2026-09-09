import {
  AssignmentMethod,
  DispositionCode,
  LeadStatus,
  Prisma,
  ReleaseReason,
} from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { notify, notifyMany, NOTIFICATION } from "@/lib/notifications";
import { EVENTS, emitToUser, emitToRole } from "@/server/socket";
import type { LeadAssignedPayload, LeadReleasedPayload } from "@/lib/realtime/events";

/**
 * THE lead ownership primitive (NF-07). Everything that changes who owns a lead
 * goes through this file — the approval screen, the 5-minute auto-assign job,
 * manual assignment, and the logout-return rule.
 *
 * THE RULE, from .claude/CLAUDE.md and the Day 1 log:
 *   Inside ONE transaction:
 *     1. claim candidate leads with FOR UPDATE SKIP LOCKED
 *     2. insert the append-only lead_assignments row
 *     3. update the lead's ownership columns, including current_assignment_id
 *   Releasing is the mirror image: stamp released_at + release_reason on the
 *   open row, then clear the lead's ownership columns.
 *
 * SKIP LOCKED is the part that makes concurrency work. Two agents requesting at
 * the same instant do not block each other and do not receive the same rows —
 * the second transaction simply skips whatever the first has locked and takes
 * the next available leads.
 *
 * The partial unique index `lead_assignments_one_active_holder` is the backstop
 * underneath all of this, not the mechanism: if a bug ever tried to open a
 * second assignment for one lead, Postgres rejects the write.
 *
 * No `server-only` and no `next/*` imports: the cron job in server.ts loads
 * this outside a request.
 */

type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export interface AssignResult {
  leadIds: string[];
  /** Fewer than requested means the available pool ran out. */
  requested: number;
  assigned: number;
}

/** Longer than Prisma's 5s default: a 100-lead batch does 100 inserts + updates. */
const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };

// ---------------------------------------------------------------------------
// Claiming from the available pool
// ---------------------------------------------------------------------------

/**
 * Locks up to `quantity` available leads and hands them to one agent.
 *
 * Do-Not-Call leads are excluded here rather than filtered later, so a DNC
 * contact can never enter a call list by accident (CL-05 / Day 6).
 */
async function claimAvailableLeads(
  tx: Tx,
  quantity: number,
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT id
    FROM leads
    WHERE status = 'AVAILABLE'
      AND assigned_to_id IS NULL
      AND do_not_call = false
    ORDER BY created_at ASC
    LIMIT ${quantity}
    FOR UPDATE SKIP LOCKED
  `);
  return rows.map((r) => r.id);
}

/**
 * Writes ownership for one lead: the append-only history row first, then the
 * denormalised columns pointing at it.
 */
async function openAssignment(
  tx: Tx,
  args: {
    leadId: string;
    agentId: string;
    actorId: string | null;
    method: AssignmentMethod;
    requestId?: string | null;
    notes?: string | null;
  },
): Promise<string> {
  const assignment = await tx.leadAssignment.create({
    data: {
      leadId: args.leadId,
      assignedToId: args.agentId,
      assignedById: args.actorId,
      method: args.method,
      requestId: args.requestId ?? null,
      notes: args.notes ?? null,
    },
  });

  await tx.lead.update({
    where: { id: args.leadId },
    data: {
      status: LeadStatus.ASSIGNED,
      assignedToId: args.agentId,
      lockedAt: new Date(),
      currentAssignmentId: assignment.id,
    },
  });

  return assignment.id;
}

/**
 * Closes the currently open assignment for each lead, if there is one.
 * Never deletes and never rewrites history — only stamps released_at.
 */
async function closeOpenAssignments(
  tx: Tx,
  leadIds: string[],
  reason: ReleaseReason,
): Promise<void> {
  if (leadIds.length === 0) return;
  await tx.leadAssignment.updateMany({
    where: { leadId: { in: leadIds }, releasedAt: null },
    data: { releasedAt: new Date(), releaseReason: reason },
  });
}

// ---------------------------------------------------------------------------
// Public operations
// ---------------------------------------------------------------------------

export interface AssignFromPoolArgs {
  agentId: string;
  quantity: number;
  method: AssignmentMethod;
  /** Null for the system (the auto-assign job). */
  actorId: string | null;
  requestId?: string | null;
}

/** LA-04 / LA-05 — give an agent N leads off the available pool. */
export async function assignLeadsFromPool(
  args: AssignFromPoolArgs,
): Promise<AssignResult> {
  const { agentId, quantity, method, actorId, requestId } = args;

  if (quantity <= 0) return { leadIds: [], requested: quantity, assigned: 0 };

  const leadIds = await prisma.$transaction(async (tx) => {
    const claimed = await claimAvailableLeads(tx, quantity);

    for (const leadId of claimed) {
      await openAssignment(tx, { leadId, agentId, actorId, method, requestId });
    }

    return claimed;
  }, TX_OPTIONS);

  if (leadIds.length > 0) {
    await announceAssignment({ agentId, leadIds, method, requestId });
  }

  return { leadIds, requested: quantity, assigned: leadIds.length };
}

export interface AssignSpecificArgs {
  leadIds: string[];
  agentId: string;
  actorId: string | null;
  method: AssignmentMethod;
  notes?: string | null;
}

/**
 * LA-06 / LA-07 — Management assigns, transfers or reassigns specific leads,
 * outside the request flow.
 *
 * A lead already held by someone else is released and re-opened in the same
 * transaction, so the history shows both events and there is never a moment
 * with two open assignment rows.
 */
export async function assignSpecificLeads(
  args: AssignSpecificArgs,
): Promise<{ assigned: string[]; skipped: { id: string; reason: string }[] }> {
  const { leadIds, agentId, actorId, method, notes } = args;
  if (leadIds.length === 0) return { assigned: [], skipped: [] };

  return prisma.$transaction(async (tx) => {
    // Lock the exact rows we are about to rewrite, so a concurrent pool claim
    // or another manual assignment cannot interleave with this one.
    const locked = await tx.$queryRaw<
      { id: string; assigned_to_id: string | null; do_not_call: boolean }[]
    >(Prisma.sql`
      SELECT id, assigned_to_id, do_not_call
      FROM leads
      WHERE id = ANY(${leadIds})
      ORDER BY id
      FOR UPDATE
    `);

    const found = new Set(locked.map((l) => l.id));
    const skipped: { id: string; reason: string }[] = leadIds
      .filter((id) => !found.has(id))
      .map((id) => ({ id, reason: "NOT_FOUND" }));

    const assignable: string[] = [];
    const previousOwners = new Map<string, string>();

    for (const lead of locked) {
      // A Do-Not-Call lead must not be handed to an agent to call. Overriding
      // that is an explicit Admin action (Day 6), not a side effect of a bulk
      // assignment.
      if (lead.do_not_call) {
        skipped.push({ id: lead.id, reason: "DO_NOT_CALL" });
        continue;
      }
      if (lead.assigned_to_id === agentId) {
        skipped.push({ id: lead.id, reason: "ALREADY_ASSIGNED_TO_AGENT" });
        continue;
      }
      if (lead.assigned_to_id) previousOwners.set(lead.id, lead.assigned_to_id);
      assignable.push(lead.id);
    }

    const reassigned = [...previousOwners.keys()];
    await closeOpenAssignments(tx, reassigned, ReleaseReason.REASSIGNED);

    for (const leadId of assignable) {
      await openAssignment(tx, {
        leadId,
        agentId,
        actorId,
        method: previousOwners.has(leadId) ? AssignmentMethod.REASSIGN : method,
        notes,
      });
    }

    if (assignable.length > 0) {
      // Fire-and-forget after the transaction commits; see announceAssignment.
      void announceAssignment({
        agentId,
        leadIds: assignable,
        method,
        previousOwners,
      });
    }

    return { assigned: assignable, skipped };
  }, TX_OPTIONS);
}

export interface ReleaseArgs {
  leadIds: string[];
  reason: ReleaseReason;
  actorId: string | null;
}

/** LA-06 — return specific leads to the available pool. */
export async function releaseLeads(args: ReleaseArgs): Promise<string[]> {
  const { leadIds, reason } = args;
  if (leadIds.length === 0) return [];

  const released = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<
      { id: string; assigned_to_id: string | null; do_not_call: boolean }[]
    >(Prisma.sql`
      SELECT id, assigned_to_id, do_not_call
      FROM leads
      WHERE id = ANY(${leadIds}) AND assigned_to_id IS NOT NULL
      ORDER BY id
      FOR UPDATE
    `);

    const ids = locked.map((l) => l.id);
    if (ids.length === 0) return [];

    await closeOpenAssignments(tx, ids, reason);

    // A released lead goes back to AVAILABLE unless it is Do-Not-Call, which
    // must never re-enter the pool.
    const dnc = locked.filter((l) => l.do_not_call).map((l) => l.id);
    const normal = locked.filter((l) => !l.do_not_call).map((l) => l.id);

    if (normal.length) {
      await tx.lead.updateMany({
        where: { id: { in: normal } },
        data: {
          status: LeadStatus.AVAILABLE,
          assignedToId: null,
          lockedAt: null,
          currentAssignmentId: null,
        },
      });
    }
    if (dnc.length) {
      await tx.lead.updateMany({
        where: { id: { in: dnc } },
        data: {
          status: LeadStatus.DO_NOT_CALL,
          assignedToId: null,
          lockedAt: null,
          currentAssignmentId: null,
        },
      });
    }

    return ids;
  }, TX_OPTIONS);

  if (released.length > 0) {
    const owners = await prisma.leadAssignment.findMany({
      where: { leadId: { in: released }, releaseReason: reason },
      orderBy: { assignedAt: "desc" },
      select: { assignedToId: true },
      take: 1,
    });
    const payload: LeadReleasedPayload = {
      leadIds: released,
      previousAgentId: owners[0]?.assignedToId ?? "",
      reason,
      at: new Date().toISOString(),
    };
    emitToRole("management", EVENTS.LEAD_RELEASED, payload);
  }

  return released;
}

/**
 * LA-09 / LA-10 — the logout-return rule.
 *
 * Returns leads the agent never actually worked. A lead counts as "touched"
 * once it carries ANY disposition, and touched leads stay with the agent.
 *
 * WHAT COUNTS AS TOUCHED is Admin-configurable, because the SRS is genuinely
 * ambiguous about it and the answer belongs to the call-centre owner:
 *
 *   default (returnNoAnswerOnLogout = false)
 *     Only leads with NO disposition return. Matches the SRS wording — "any of
 *     their leads with no disposition yet", "only truly untouched leads
 *     return", and the build plan's "logout-returns-UNCALLED-leads rule". A
 *     lead that was dialled and rang out stays with the agent.
 *
 *   returnNoAnswerOnLogout = true
 *     No Answer also returns. Supported by the same rule's other half, which
 *     protects "leads with an active disposition (Call Back Later, Email,
 *     Successful-Qualify)" — a list No Answer is absent from.
 *
 * This is not a cosmetic toggle: No Answer is the most common outcome in a call
 * centre, so it decides the fate of most worked leads every night. Left false,
 * an absent agent's leads stay frozen until Management releases them by hand.
 *
 * Call Back Later, Email and Qualified always stay with the agent either way —
 * those carry a promise to a specific person.
 */
export async function returnUncalledLeads(
  agentId: string,
  reason: ReleaseReason = ReleaseReason.LOGOUT_RETURN,
): Promise<string[]> {
  const { returnNoAnswerOnLogout } = await getSetting("assignment.config");

  const untouched = await prisma.lead.findMany({
    where: {
      assignedToId: agentId,
      OR: returnNoAnswerOnLogout
        ? [
            { lastDispositionCode: null },
            { lastDispositionCode: DispositionCode.NO_ANSWER },
          ]
        : [{ lastDispositionCode: null }],
    },
    select: { id: true },
  });

  if (untouched.length === 0) return [];

  const released = await releaseLeads({
    leadIds: untouched.map((l) => l.id),
    reason,
    actorId: null,
  });

  if (released.length > 0) {
    emitToUser(agentId, EVENTS.LEAD_RELEASED, {
      leadIds: released,
      previousAgentId: agentId,
      reason,
      at: new Date().toISOString(),
    } satisfies LeadReleasedPayload);
  }

  return released;
}

/**
 * Only returns leads once the agent has no active session left.
 *
 * An agent with the CRM open on two machines who closes one has not logged out
 * in any meaningful sense; pulling their leads mid-call would be worse than
 * leaving them. Dev B's Monitoring Engine reads the same `sessions` table, so
 * "still signed in" means the same thing on both tracks.
 */
export async function returnUncalledLeadsIfSignedOut(
  agentId: string,
  reason: ReleaseReason = ReleaseReason.LOGOUT_RETURN,
): Promise<string[]> {
  const active = await prisma.session.count({
    where: { userId: agentId, revokedAt: null, expiresAt: { gt: new Date() } },
  });
  if (active > 0) return [];
  return returnUncalledLeads(agentId, reason);
}

// ---------------------------------------------------------------------------
// Notifications — best effort, always after the transaction commits
// ---------------------------------------------------------------------------

async function announceAssignment(args: {
  agentId: string;
  leadIds: string[];
  method: AssignmentMethod;
  requestId?: string | null;
  previousOwners?: Map<string, string>;
}) {
  const { agentId, leadIds, method, requestId, previousOwners } = args;
  const at = new Date().toISOString();

  const payload: LeadAssignedPayload = {
    agentId,
    leadIds,
    requestId: requestId ?? undefined,
    method,
    at,
  };

  emitToUser(agentId, EVENTS.LEAD_ASSIGNED, payload);
  emitToRole("management", EVENTS.LEAD_ASSIGNED, payload);

  await notify({
    userId: agentId,
    type: NOTIFICATION.LEAD_BATCH_ASSIGNED,
    title: `${leadIds.length} new lead${leadIds.length === 1 ? "" : "s"} assigned`,
    body:
      method === AssignmentMethod.AUTO_ASSIGN
        ? "Your request reached the auto-assign deadline and was filled automatically."
        : undefined,
    payload: { leadIds: leadIds.slice(0, 50), requestId: requestId ?? null },
  });

  // Whoever lost the leads should know too, so a transfer isn't silent.
  if (previousOwners && previousOwners.size > 0) {
    const lost = new Map<string, number>();
    for (const owner of previousOwners.values()) {
      lost.set(owner, (lost.get(owner) ?? 0) + 1);
    }
    for (const [ownerId, count] of lost) {
      await notifyMany([ownerId], {
        type: NOTIFICATION.SYSTEM,
        title: `${count} lead${count === 1 ? "" : "s"} reassigned`,
        body: "Management moved them to another agent.",
        payload: {},
      });
    }
  }
}
