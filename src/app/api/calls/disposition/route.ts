import { z } from "zod";
import { DispositionCode } from "@prisma/client";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, badRequest, conflict, parseBody } from "@/lib/api";
import { recordDisposition, DispositionError } from "@/server/calls/disposition";

/**
 * CL-05 / CL-06 / CL-08 — save the outcome of a call.
 *
 * `callbackAt` is validated server-side for CALL_BACK_LATER, not merely
 * prompted in the modal: NF-04 says the server is the only validation that
 * counts, and a Call Back Later without a time is a promise nobody can keep.
 */

const DispositionSchema = z.object({
  leadId: z.string().min(1),
  /** Omit when recording an outcome without having pressed Call first. */
  callId: z.string().min(1).nullable().optional(),
  code: z.nativeEnum(DispositionCode),
  notes: z.string().max(2000).trim().nullable().optional(),
  /** ISO datetime; required for CALL_BACK_LATER. */
  callbackAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export const POST = requirePermission("calls.log", async (req, { user }) => {
  const parsed = await parseBody(req, DispositionSchema);
  if (!parsed.success) return parsed.res;
  const { leadId, callId, code, notes, callbackAt } = parsed.data;

  let when: Date | null = null;
  if (callbackAt) {
    when = new Date(callbackAt);
    if (Number.isNaN(when.getTime())) return badRequest("Invalid callback date/time.");
  }

  try {
    const result = await recordDisposition({
      leadId,
      callId: callId ?? null,
      agentId: user.id,
      code,
      notes: notes ?? null,
      callbackAt: when,
    });
    return ok({ result });
  } catch (e) {
    if (e instanceof DispositionError) {
      // A missing or past callback time is the agent's mistake to correct, so
      // it is a 400 the modal can show inline; the rest are conflicts.
      const isValidation =
        e.code === "CALLBACK_REQUIRED" || e.code === "CALLBACK_IN_PAST";
      return isValidation ? badRequest(e.message) : conflict(e.message);
    }
    throw e;
  }
});
