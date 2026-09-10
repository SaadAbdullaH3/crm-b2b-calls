import { z } from "zod";
import { LeaveStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, conflict, notFound, parseBody } from "@/lib/api";
import { notify, NOTIFICATION } from "@/lib/notifications";

/**
 * HR-05 — approve or reject a leave request.
 *
 * The transition is a conditional update (`WHERE status = 'PENDING'`) rather
 * than a read-then-write: two approvers acting at once would otherwise both
 * succeed, and the second would overwrite the first's decision and comment
 * with no trace. Same pattern Dev A used for lead-request resolution.
 */

const ReviewSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  comment: z.string().max(1000).trim().optional().nullable(),
});

export const POST = requirePermission(
  "hr.leave.approve",
  async (req, { user, params }) => {
    const id = params?.id as string;
    const parsed = await parseBody(req, ReviewSchema);
    if (!parsed.success) return parsed.res;

    const existing = await prisma.leaveRequest.findUnique({
      where: { id },
      include: { requester: { select: { id: true, fullName: true } } },
    });
    if (!existing) return notFound("No such leave request.");

    const nextStatus =
      parsed.data.decision === "approve" ? LeaveStatus.APPROVED : LeaveStatus.REJECTED;

    // Claim it. `count` tells us whether we were the one who moved it.
    const claim = await prisma.leaveRequest.updateMany({
      where: { id, status: LeaveStatus.PENDING },
      data: {
        status: nextStatus,
        reviewedById: user.id,
        reviewedAt: new Date(),
        reviewComment: parsed.data.comment || null,
      },
    });

    if (claim.count === 0) {
      return conflict(
        `This request is already ${existing.status.toLowerCase()}. Refresh to see the current state.`,
      );
    }

    const request = await prisma.leaveRequest.findUnique({
      where: { id },
      include: {
        requester: { select: { id: true, fullName: true } },
        reviewedBy: { select: { id: true, fullName: true } },
      },
    });

    await notify({
      userId: existing.requesterId,
      type: NOTIFICATION.HR,
      title: `Leave ${nextStatus.toLowerCase()}`,
      body: parsed.data.comment
        ? parsed.data.comment
        : `Your ${existing.leaveType.toLowerCase()} leave request was ${nextStatus.toLowerCase()}.`,
      payload: { leaveRequestId: id, status: nextStatus },
    });

    return ok({ request });
  },
);
