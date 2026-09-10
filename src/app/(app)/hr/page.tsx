import { requirePageAuth } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import { HrOverviewClient } from "./hr-overview-client";

/**
 * HR overview — counts server-side, attendance client-side.
 *
 * The document count is only fetched for someone holding
 * `hr.documents.manage`. Showing Management "18 documents on file" would leak
 * the existence and volume of records HR-07 restricts from them, even without
 * showing a single one.
 */
export default async function HrPage() {
  const user = await requirePageAuth();
  const canSeeDocuments = hasPermission(user, "hr.documents.manage");

  const [employees, former, pendingLeave, holidays, documents] = await Promise.all([
    prisma.hrEmployee.count({ where: { exitedAt: null } }),
    prisma.hrEmployee.count({ where: { exitedAt: { not: null } } }),
    prisma.leaveRequest.count({ where: { status: "PENDING" } }),
    prisma.holiday.count(),
    canSeeDocuments ? prisma.hrDocument.count() : Promise.resolve(null),
  ]);

  // HR-03 expiry tracking: documents lapsing in the next 30 days are the whole
  // reason the expiry field exists, so surface them rather than making someone
  // go looking.
  const soon = new Date();
  soon.setDate(soon.getDate() + 30);
  const expiring = canSeeDocuments
    ? await prisma.hrDocument.findMany({
        where: { expiresAt: { not: null, lte: soon } },
        orderBy: { expiresAt: "asc" },
        take: 10,
        select: {
          id: true,
          fileName: true,
          docType: true,
          expiresAt: true,
          employee: { select: { user: { select: { fullName: true } } } },
        },
      })
    : [];

  return (
    <HrOverviewClient
      canSeeAttendance={hasPermission(user, "hr.attendance.read")}
      stats={{ employees, former, pendingLeave, holidays, documents }}
      expiring={expiring.map((d) => ({
        id: d.id,
        fileName: d.fileName,
        docType: d.docType,
        expiresAt: d.expiresAt!.toISOString(),
        employeeName: d.employee.user.fullName,
      }))}
    />
  );
}
