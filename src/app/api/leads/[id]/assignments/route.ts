import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, notFound } from "@/lib/api";

/**
 * SF-04 — every assignment and reassignment event for one lead.
 *
 * Management/Admin only (`leads.assignment.history`): unlike the timeline, this
 * is explicitly about who else has held the lead, which is a supervision view
 * rather than something an agent needs to do their job.
 *
 * Reads the append-only `lead_assignments` chain straight through. Nothing is
 * ever overwritten there, so this IS the history rather than a reconstruction
 * of it.
 */
export const GET = requirePermission(
  "leads.assignment.history",
  async (_req, { params }) => {
    const id = params?.id as string;

    const lead = await prisma.lead.findUnique({
      where: { id },
      select: {
        id: true,
        companyName: true,
        contactName: true,
        assignedToId: true,
        currentAssignmentId: true,
      },
    });
    if (!lead) return notFound("No such lead.");

    const assignments = await prisma.leadAssignment.findMany({
      where: { leadId: id },
      orderBy: { assignedAt: "desc" },
      include: {
        assignedTo: { select: { id: true, fullName: true, email: true } },
        assignedBy: { select: { id: true, fullName: true } },
        request: { select: { id: true, quantityRequested: true, status: true } },
      },
    });

    return ok({
      lead,
      assignments: assignments.map((a) => ({
        id: a.id,
        assignedAt: a.assignedAt,
        releasedAt: a.releasedAt,
        releaseReason: a.releaseReason,
        method: a.method,
        notes: a.notes,
        assignedTo: a.assignedTo,
        // Null means the 5-minute auto-assign job, not a person.
        assignedBy: a.assignedBy,
        request: a.request,
        /** The one row with releasedAt null is the current holder. */
        isCurrent: a.releasedAt === null,
      })),
      totalHolders: new Set(assignments.map((a) => a.assignedToId)).size,
    });
  },
);
