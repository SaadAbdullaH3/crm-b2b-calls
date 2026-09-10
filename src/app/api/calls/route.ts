import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, badRequest, conflict, parseBody } from "@/lib/api";
import { startCall, DispositionError } from "@/server/calls/disposition";
import { resolveDialerHandoff } from "@/server/calls/dialer";

/**
 * CL-02 / CL-03 / CL-04 — the agent presses Call.
 *
 * The server decides how the call is placed, not the browser: it resolves
 * `dialer.config`, opens the `calls` row so `started_at` is a real timestamp,
 * and hands back either a dial URL or the number to copy. The client's only job
 * is to act on that answer and show the confirmation.
 */

const StartCallSchema = z.object({ leadId: z.string().min(1) });

export const POST = requirePermission("calls.log", async (req, { user }) => {
  const parsed = await parseBody(req, StartCallSchema);
  if (!parsed.success) return parsed.res;

  const lead = await prisma.lead.findUnique({
    where: { id: parsed.data.leadId },
    select: {
      id: true,
      phoneE164: true,
      phoneRaw: true,
      companyName: true,
      contactName: true,
    },
  });
  if (!lead) return badRequest("No such lead.");

  // LM-05 only guarantees format at import; a lead can still reach here with no
  // number if the column was never mapped. Fail with something actionable
  // rather than putting an empty string on the agent's clipboard.
  if (!lead.phoneE164) {
    return conflict(
      "This lead has no valid U.S. phone number, so it cannot be dialled. Ask Management to correct the record.",
    );
  }

  const handoff = await resolveDialerHandoff({
    phoneE164: lead.phoneE164,
    display: lead.phoneRaw,
  });

  try {
    const call = await startCall({
      leadId: lead.id,
      agentId: user.id,
      channel: handoff.mode,
      phoneDialed: handoff.phone,
    });

    return ok({ call, handoff }, 201);
  } catch (e) {
    if (e instanceof DispositionError) return conflict(e.message);
    throw e;
  }
});
