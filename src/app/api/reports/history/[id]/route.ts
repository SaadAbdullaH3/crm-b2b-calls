import { z } from "zod";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, notFound, conflict, parseBody } from "@/lib/api";
import { MIME } from "@/server/reports/export";
import { downloadNameFor, readStoredReport } from "@/server/reports/history";

/**
 * RP-04 — download a stored report, or sign one off.
 *
 * Download headers match the HR-document rules: always `attachment`, never
 * `inline`, plus `nosniff` and `no-store`. An export is a spreadsheet of contact
 * names, phone numbers and call notes; rendering one inline would put it under
 * this app's own origin, and a shared cache holding it is a leak that outlives
 * the session.
 */
export const GET = requirePermission("reports.export", async (_req, { params }) => {
  const id = params?.id as string;

  const record = await prisma.reportGenerated.findUnique({ where: { id } });
  if (!record) return notFound("No such report.");
  if (!record.storedPath) {
    return notFound("This report has no stored file. It may predate report storage.");
  }

  const read = await readStoredReport(record.storedPath);
  if (!read.ok) return notFound(read.error);

  const fileName = downloadNameFor(record);
  const ascii = fileName
    .replace(/[^\x20-\x7e]/g, "_")
    .split('"')
    .join("")
    .split("\\")
    .join("");

  return new Response(new Uint8Array(read.buffer), {
    headers: {
      "Content-Type": MIME[record.format],
      "Content-Length": String(read.buffer.byteLength),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

const ApproveSchema = z.object({ approve: z.literal(true) });

/**
 * RP-04's "approving user".
 *
 * Gated on `reports.score.manage` — the reporting module's existing sign-off
 * permission — rather than a 38th permission key. Adding one would need a
 * re-seed, and re-seeding resets any AD-02 runtime permission changes an Admin
 * has made. If the client ever wants report sign-off delegated separately from
 * scoring, it is a one-line split. Logged in GLOBAL.md.
 *
 * Sign-off is one-way and conditional: the first approval wins and a second
 * returns 409 rather than quietly restamping someone else's name on it.
 */
export const PATCH = requirePermission("reports.score.manage", async (req, { params, user }) => {
  const id = params?.id as string;
  const parsed = await parseBody(req, ApproveSchema);
  if (!parsed.success) return parsed.res;

  const claimed = await prisma.reportGenerated.updateMany({
    where: { id, approvedById: null },
    data: { approvedById: user.id, approvedAt: new Date() },
  });

  if (claimed.count !== 1) {
    const existing = await prisma.reportGenerated.findUnique({
      where: { id },
      include: { approvedBy: { select: { fullName: true } } },
    });
    if (!existing) return notFound("No such report.");
    return conflict(`Already approved by ${existing.approvedBy?.fullName ?? "someone else"}.`);
  }

  const record = await prisma.reportGenerated.findUniqueOrThrow({
    where: { id },
    include: { approvedBy: { select: { fullName: true } } },
  });

  return ok({
    id: record.id,
    approvedBy: record.approvedBy?.fullName ?? null,
    approvedAt: record.approvedAt?.toISOString() ?? null,
  });
});
