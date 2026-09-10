import { z } from "zod";
import { LeaveType, LeaveStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, badRequest, conflict, parseBody } from "@/lib/api";
import { computeLeaveDays, findOverlappingLeave } from "@/server/hr/leave";
import { notify, NOTIFICATION, userIdsByRole } from "@/lib/notifications";

/**
 * HR-05 — leave requests.
 *
 * Gated on `hr.leave.request`, which every role holds including agents: this
 * is the one HR surface an agent uses. The visibility rule is inside the
 * handler rather than in the permission — an approver sees everyone, everyone
 * else sees only their own — because "which rows" is not something a
 * permission key can express.
 */

export const GET = requirePermission("hr.leave.request", async (req, { user }) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const canApprove = user.permissions.includes("hr.leave.approve");

  const requests = await prisma.leaveRequest.findMany({
    where: {
      // An agent may only ever see their own requests, whatever they ask for.
      ...(canApprove ? {} : { requesterId: user.id }),
      ...(status && status !== "all"
        ? { status: status as LeaveStatus }
        : {}),
    },
    orderBy: [{ status: "asc" }, { startDate: "desc" }],
    include: {
      requester: {
        select: {
          id: true,
          fullName: true,
          email: true,
          role: { select: { label: true } },
        },
      },
      reviewedBy: { select: { id: true, fullName: true } },
    },
  });

  return ok({ requests, canApprove });
});

const CreateSchema = z
  .object({
    leaveType: z.nativeEnum(LeaveType).default(LeaveType.ANNUAL),
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
    reason: z.string().max(1000).trim().optional().nullable(),
    /** Approvers may file leave on someone else's behalf (phoned in sick). */
    requesterId: z.string().min(1).optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "The end date cannot be before the start date.",
  });

export const POST = requirePermission("hr.leave.request", async (req, { user }) => {
  const parsed = await parseBody(req, CreateSchema);
  if (!parsed.success) return parsed.res;
  const { leaveType, startDate, endDate, reason, requesterId } = parsed.data;

  // Filing for someone else requires the approve permission. Without this
  // check any agent could submit leave under a colleague's name.
  const canApprove = user.permissions.includes("hr.leave.approve");
  const targetId = requesterId && canApprove ? requesterId : user.id;

  if (requesterId && requesterId !== user.id && !canApprove) {
    return badRequest("You can only submit leave for yourself.");
  }

  const breakdown = await computeLeaveDays(startDate, endDate);
  if (breakdown.days === 0) {
    return badRequest(
      breakdown.holidays.length > 0
        ? `That range is entirely non-working days and holidays (${breakdown.holidays.join(", ")}).`
        : "That range contains no working days.",
    );
  }

  const overlapping = await findOverlappingLeave(targetId, startDate, endDate);
  if (overlapping.length > 0) {
    const clash = overlapping[0];
    return conflict(
      `This overlaps an existing ${clash.status.toLowerCase()} request (${clash.startDate.toISOString().slice(0, 10)} to ${clash.endDate.toISOString().slice(0, 10)}).`,
    );
  }

  const request = await prisma.leaveRequest.create({
    data: {
      requesterId: targetId,
      leaveType,
      startDate,
      endDate,
      days: breakdown.days,
      reason: reason || null,
    },
    include: { requester: { select: { id: true, fullName: true } } },
  });

  // Approvers need to know without watching the screen.
  const approvers = await userIdsByRole("hr");
  for (const approverId of approvers) {
    if (approverId === user.id) continue;
    await notify({
      userId: approverId,
      type: NOTIFICATION.HR,
      title: `Leave request from ${request.requester.fullName}`,
      body: `${breakdown.days} working day(s), ${leaveType.toLowerCase()}`,
      payload: { leaveRequestId: request.id },
    });
  }

  return ok({ request, breakdown }, 201);
});
