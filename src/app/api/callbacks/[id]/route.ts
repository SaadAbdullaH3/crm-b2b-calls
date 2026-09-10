import { z } from "zod";
import { CallbackStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, notFound, conflict, parseBody } from "@/lib/api";

/** CL-07 — complete, cancel or reschedule one callback. */

const UpdateSchema = z
  .object({
    status: z.enum(["COMPLETED", "CANCELLED", "SCHEDULED"]).optional(),
    scheduledFor: z.string().datetime({ offset: true }).optional(),
    notes: z.string().max(2000).trim().nullable().optional(),
  })
  .refine((v) => v.status || v.scheduledFor || v.notes !== undefined, {
    message: "Nothing to update.",
  });

export const PATCH = requirePermission(
  "callbacks.manage",
  async (req, { user, params }) => {
    const id = params?.id as string;

    const parsed = await parseBody(req, UpdateSchema);
    if (!parsed.success) return parsed.res;
    const { status, scheduledFor, notes } = parsed.data;

    // Scoped by agentId as well as id: a callback belongs to the agent who
    // scheduled it, and one agent must not be able to close another's task.
    const callback = await prisma.callback.findFirst({
      where: { id, agentId: user.id },
      select: { id: true, status: true, leadId: true },
    });
    if (!callback) return notFound("No such callback.");

    if (callback.status === CallbackStatus.COMPLETED && status !== "SCHEDULED") {
      return conflict("That callback is already completed.");
    }

    const when = scheduledFor ? new Date(scheduledFor) : undefined;
    if (when && when.getTime() <= Date.now()) {
      return conflict("A rescheduled callback must be in the future.");
    }

    const updated = await prisma.callback.update({
      where: { id },
      data: {
        ...(status ? { status: status as CallbackStatus } : {}),
        ...(status === "COMPLETED" ? { completedAt: new Date() } : {}),
        ...(when ? { scheduledFor: when, remindedAt: null } : {}),
        ...(notes !== undefined ? { notes } : {}),
      },
    });

    // Keep the lead's denormalised pointer honest: it drives the call-list
    // ordering, so a completed callback must stop sorting to the top.
    if (status === "COMPLETED" || status === "CANCELLED") {
      const nextOpen = await prisma.callback.findFirst({
        where: { leadId: callback.leadId, status: CallbackStatus.SCHEDULED },
        orderBy: { scheduledFor: "asc" },
        select: { scheduledFor: true },
      });
      await prisma.lead.update({
        where: { id: callback.leadId },
        data: { nextCallbackAt: nextOpen?.scheduledFor ?? null },
      });
    } else if (when) {
      await prisma.lead.update({
        where: { id: callback.leadId },
        data: { nextCallbackAt: when },
      });
    }

    return ok({ callback: updated });
  },
);
