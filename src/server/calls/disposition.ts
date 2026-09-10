import {
  CallbackStatus,
  DispositionCode,
  LeadStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { notify, NOTIFICATION } from "@/lib/notifications";
import { EVENTS, emitToUser, emitToRole } from "@/server/socket";

/**
 * CL-04 / CL-05 / CL-06 / CL-07 — recording what happened on a call.
 *
 * THE ONE WRITE PATH for call outcomes. Everything that records a disposition
 * goes through `recordDisposition`, for the same reason lead ownership goes
 * through assignment.ts: the `calls` row and the denormalised columns on
 * `leads` must move together or two screens start disagreeing.
 *
 * WHAT EACH SAVE WRITES, and why both halves matter:
 *   1. the `calls` row  — disposition_id + duration_sec. Dev B's Management
 *      dashboard aggregates call volume and talk time from exactly these two
 *      columns, joined through `dispositions` so the code is authoritative.
 *   2. `leads.last_disposition_code` + `last_disposition_at` — the *worked*
 *      signal. Dev B's agreed definition is "a lead with last_disposition_code
 *      set", NOT "a lead with a calls row": a dialled-and-abandoned attempt is
 *      not a worked lead. Day 4's logout-return rule reads the same column.
 *
 * Writing one without the other is the single most likely way this module goes
 * wrong, so they happen in one transaction.
 */

/** Per-outcome behaviour, from the SRS disposition table. */
interface OutcomeRule {
  /** Lead status after this outcome. */
  status: LeadStatus;
  /** CL-05: blocks all future normal calling and reassignment. */
  setsDoNotCall?: boolean;
  /** CL-06: a date and time is mandatory, not merely prompted. */
  requiresCallback?: boolean;
}

const OUTCOME: Record<DispositionCode, OutcomeRule> = {
  // Rang out. Still callable, still the agent's — the attempt is recorded and
  // the lead stays workable.
  NO_ANSWER: { status: LeadStatus.IN_PROGRESS },
  // CL-06. The date/time is required by the API, not just prompted in the UI:
  // a Call Back Later with no time is a promise nobody can keep.
  CALL_BACK_LATER: { status: LeadStatus.CALLBACK_SCHEDULED, requiresCallback: true },
  // Spoke to them, declined. Closed rather than returned to the pool — putting
  // it back would mean the next agent calls someone who already said no.
  NOT_INTERESTED: { status: LeadStatus.CLOSED_NOT_INTERESTED },
  // CL-05. Sets the sticky do_not_call flag, which Day 4's pool claim and
  // manual-assignment paths both already exclude. Only an explicit
  // Admin/Management override clears it (Day 6).
  DO_NOT_CALL: { status: LeadStatus.DO_NOT_CALL, setsDoNotCall: true },
  // Follow-up moved to email; stays with the agent through logout (LA-10).
  EMAIL: { status: LeadStatus.IN_PROGRESS },
  QUALIFIED: { status: LeadStatus.CLOSED_QUALIFIED },
};

export class DispositionError extends Error {
  constructor(
    message: string,
    public code:
      | "CALLBACK_REQUIRED"
      | "CALLBACK_IN_PAST"
      | "NOT_YOUR_LEAD"
      | "ALREADY_DISPOSITIONED"
      | "UNKNOWN_DISPOSITION",
  ) {
    super(message);
  }
}

export interface StartCallArgs {
  leadId: string;
  agentId: string;
  channel: "DIALER" | "CLIPBOARD";
  phoneDialed: string;
}

/**
 * CL-04 — opens a call record at the moment the agent places the call, so
 * `started_at` is a real timestamp rather than something back-filled when they
 * remember to save the outcome. Duration is computed from it on save.
 */
export async function startCall(args: StartCallArgs) {
  const lead = await prisma.lead.findUnique({
    where: { id: args.leadId },
    select: { id: true, assignedToId: true, doNotCall: true, currentAssignmentId: true },
  });

  if (!lead || lead.assignedToId !== args.agentId) {
    throw new DispositionError("That lead is not assigned to you.", "NOT_YOUR_LEAD");
  }

  if (lead.doNotCall) {
    // Belt and braces: the call list already filters these out, but a stale tab
    // must not be able to open a call against a suppressed contact.
    throw new DispositionError(
      "This lead is marked Do Not Call and cannot be dialled.",
      "NOT_YOUR_LEAD",
    );
  }

  return prisma.call.create({
    data: {
      leadId: lead.id,
      agentId: args.agentId,
      assignmentId: lead.currentAssignmentId,
      channel: args.channel,
      phoneDialed: args.phoneDialed,
      startedAt: new Date(),
    },
    select: { id: true, startedAt: true },
  });
}

export interface RecordDispositionArgs {
  /** Omit to record an outcome without a preceding "Call" click. */
  callId?: string | null;
  leadId: string;
  agentId: string;
  code: DispositionCode;
  notes?: string | null;
  /** Required when code is CALL_BACK_LATER. */
  callbackAt?: Date | null;
}

export interface DispositionResult {
  callId: string;
  leadStatus: LeadStatus;
  durationSec: number | null;
  callbackId: string | null;
  doNotCall: boolean;
}

export async function recordDisposition(
  args: RecordDispositionArgs,
): Promise<DispositionResult> {
  const rule = OUTCOME[args.code];
  if (!rule) {
    throw new DispositionError(`Unknown outcome ${args.code}.`, "UNKNOWN_DISPOSITION");
  }

  if (rule.requiresCallback) {
    if (!args.callbackAt) {
      throw new DispositionError(
        "Call Back Later needs a date and time for the callback.",
        "CALLBACK_REQUIRED",
      );
    }
    if (args.callbackAt.getTime() <= Date.now()) {
      throw new DispositionError(
        "The callback time must be in the future.",
        "CALLBACK_IN_PAST",
      );
    }
  }

  const lead = await prisma.lead.findUnique({
    where: { id: args.leadId },
    select: { id: true, assignedToId: true, currentAssignmentId: true, companyName: true, contactName: true },
  });
  if (!lead || lead.assignedToId !== args.agentId) {
    throw new DispositionError("That lead is not assigned to you.", "NOT_YOUR_LEAD");
  }

  const disposition = await prisma.disposition.findUnique({
    where: { code: args.code },
    select: { id: true, label: true },
  });
  if (!disposition) {
    throw new DispositionError(
      `Outcome ${args.code} is not configured.`,
      "UNKNOWN_DISPOSITION",
    );
  }

  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    // --- the call row -------------------------------------------------------
    let callId = args.callId ?? null;
    let durationSec: number | null = null;

    if (callId) {
      const existing = await tx.call.findUnique({
        where: { id: callId },
        select: { id: true, agentId: true, leadId: true, startedAt: true, dispositionId: true },
      });
      if (!existing || existing.agentId !== args.agentId || existing.leadId !== lead.id) {
        throw new DispositionError("That call does not belong to you.", "NOT_YOUR_LEAD");
      }
      if (existing.dispositionId) {
        throw new DispositionError(
          "That call already has an outcome recorded.",
          "ALREADY_DISPOSITIONED",
        );
      }
      if (existing.startedAt) {
        durationSec = Math.max(
          0,
          Math.round((now.getTime() - existing.startedAt.getTime()) / 1000),
        );
      }
      await tx.call.update({
        where: { id: callId },
        data: {
          dispositionId: disposition.id,
          notes: args.notes ?? null,
          endedAt: now,
          durationSec,
        },
      });
    } else {
      // No "Call" click preceded this — the agent is recording an outcome for a
      // conversation that happened elsewhere. Still a real call row so the
      // dashboard's volume counts include it; duration stays null rather than
      // being invented.
      const created = await tx.call.create({
        data: {
          leadId: lead.id,
          agentId: args.agentId,
          assignmentId: lead.currentAssignmentId,
          dispositionId: disposition.id,
          notes: args.notes ?? null,
          startedAt: now,
          endedAt: now,
          durationSec: null,
          channel: "MANUAL",
        },
        select: { id: true },
      });
      callId = created.id;
    }

    // --- the callback (CL-06) ----------------------------------------------
    let callbackId: string | null = null;
    if (rule.requiresCallback && args.callbackAt) {
      const callback = await tx.callback.create({
        data: {
          leadId: lead.id,
          agentId: args.agentId,
          callId,
          scheduledFor: args.callbackAt,
          status: CallbackStatus.SCHEDULED,
          notes: args.notes ?? null,
        },
        select: { id: true },
      });
      callbackId = callback.id;
    }

    // --- the lead -----------------------------------------------------------
    // last_disposition_code / _at are what make this a "worked" lead for Dev B's
    // dashboard, Day 7's reports and Day 4's logout rule. Never skip them.
    const leadUpdate: Prisma.LeadUpdateInput = {
      status: rule.status,
      lastDispositionCode: args.code,
      lastDispositionAt: now,
      callAttempts: { increment: 1 },
      nextCallbackAt: rule.requiresCallback ? args.callbackAt : null,
    };

    if (rule.setsDoNotCall) {
      leadUpdate.doNotCall = true;
      leadUpdate.doNotCallAt = now;
      leadUpdate.doNotCallBy = { connect: { id: args.agentId } };
    }

    await tx.lead.update({ where: { id: lead.id }, data: leadUpdate });

    return { callId: callId!, durationSec, callbackId };
  });

  // Best effort, outside the transaction — a failed notification must not roll
  // back a recorded outcome.
  void announce({
    code: args.code,
    label: disposition.label,
    agentId: args.agentId,
    leadId: lead.id,
    leadName: lead.companyName ?? lead.contactName ?? "a lead",
    doNotCall: Boolean(rule.setsDoNotCall),
  });

  return {
    callId: result.callId,
    leadStatus: rule.status,
    durationSec: result.durationSec,
    callbackId: result.callbackId,
    doNotCall: Boolean(rule.setsDoNotCall),
  };
}

async function announce(args: {
  code: DispositionCode;
  label: string;
  agentId: string;
  leadId: string;
  leadName: string;
  doNotCall: boolean;
}) {
  try {
    const payload = {
      leadId: args.leadId,
      agentId: args.agentId,
      code: args.code,
      at: new Date().toISOString(),
    };
    emitToUser(args.agentId, EVENTS.LEAD_DISPOSITIONED, payload);
    emitToRole("management", EVENTS.LEAD_DISPOSITIONED, payload);

    // A Do-Not-Call is the one outcome Management would want to know about
    // without going looking: it permanently removes a lead from the callable
    // pool.
    if (args.doNotCall) {
      const approvers = await prisma.user.findMany({
        where: {
          isActive: true,
          role: { permissions: { some: { permission: { key: "leads.approve" } } } },
        },
        select: { id: true },
      });
      for (const approver of approvers) {
        await notify({
          userId: approver.id,
          type: NOTIFICATION.DNC_WARNING,
          title: `${args.leadName} marked Do Not Call`,
          body: "The lead has been removed from the callable pool.",
          payload: { leadId: args.leadId },
        });
      }
    }
  } catch (e) {
    console.error("[disposition] announce failed", e);
  }
}
