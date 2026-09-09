import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { notFound } from "@/lib/api";
import { buildValidationReport } from "@/lib/import/report";

/** LM-07 — download the validation / error report for one import. */
export const GET = requirePermission("leads.import", async (_req, { params }) => {
  const id = params?.id as string;

  const record = await prisma.leadImport.findUnique({
    where: { id },
    select: { id: true, fileName: true },
  });
  if (!record) return notFound("No such import.");

  const buffer = await buildValidationReport(id);
  const base = record.fileName.replace(/\.xlsx$/i, "").replace(/[^\w.-]+/g, "_");

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${base}-validation-report.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
});
