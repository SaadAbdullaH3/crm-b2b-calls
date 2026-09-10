import { z } from "zod";
import { LeadStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, notFound, conflict, parseBody } from "@/lib/api";

/**
 * Do-Not-Call override.
 *
 * Setting the flag is something an agent does through the disposition modal.
 * CLEARING it is not: a contact who asked not to be called stays suppressed
 * unless a Management/Admin user with `leads.dnc.override` explicitly restores
 * them. That asymmetry is the protection — anything less makes Do Not Call a
 * suggestion.
 *
 * Restoring returns the lead to the AVAILABLE pool unassigned, rather than back
 * to whoever last held it: it has usually been sitting suppressed for a while,
 * and silently re-appearing in someone's call list is worse than letting the
 * normal assignment flow pick it up.
 */

const OverrideSchema = z.object({
  doNotCall: z.boolean(),
  reason: z.string().max(500).trim().optional(),
});

export const PATCH = requirePermission(
  "leads.dnc.override",
  async (req, { user, params }) => {
    const id = params?.id as string;

    const parsed = await parseBody(req, OverrideSchema);
    if (!parsed.success) return parsed.res;
    const { doNotCall } = parsed.data;

    const lead = await prisma.lead.findUnique({
      where: { id },
      select: { id: true, doNotCall: true, assignedToId: true, companyName: true },
    });
    if (!lead) return notFound("No such lead.");
    if (lead.doNotCall === doNotCall) {
      return conflict(
        doNotCall
          ? "That lead is already marked Do Not Call."
          : "That lead is not marked Do Not Call.",
      );
    }

    const updated = await prisma.lead.update({
      where: { id },
      data: doNotCall
        ? {
            doNotCall: true,
            doNotCallAt: new Date(),
            doNotCallById: user.id,
            status: LeadStatus.DO_NOT_CALL,
          }
        : {
            doNotCall: false,
            doNotCallAt: null,
            doNotCallById: null,
            // Only reset the status if DNC is what was holding it there;
            // a lead suppressed while already closed stays closed.
            ...(lead.assignedToId
              ? { status: LeadStatus.ASSIGNED }
              : { status: LeadStatus.AVAILABLE }),
          },
      select: { id: true, doNotCall: true, status: true },
    });

    return ok({ lead: updated });
  },
);
