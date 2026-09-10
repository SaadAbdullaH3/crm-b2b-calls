import { HrDocumentType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, badRequest, notFound } from "@/lib/api";
import { validateUpload, storeDocument, MAX_DOCUMENT_BYTES } from "@/server/hr/documents";

/**
 * HR-02/HR-03 — list and upload employee documents.
 *
 * `hr.documents.manage` throughout, which per SRS §17 is HR (and Admin), NOT
 * Management. This is the narrowest permission in the app and it stays that
 * way.
 */

export const GET = requirePermission("hr.documents.manage", async (_req, { params }) => {
  const employeeId = params?.id as string;

  const employee = await prisma.hrEmployee.findUnique({ where: { id: employeeId } });
  if (!employee) return notFound("No such employee.");

  const documents = await prisma.hrDocument.findMany({
    where: { employeeId },
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      docType: true,
      fileName: true,
      mimeType: true,
      sizeBytes: true,
      expiresAt: true,
      notes: true,
      uploadedAt: true,
      uploadedBy: { select: { id: true, fullName: true } },
      // storedPath is deliberately never selected: the client has no use for a
      // server filesystem path, and shipping it invites someone to build a URL
      // out of it.
    },
  });

  return ok({ documents });
});

export const POST = requirePermission(
  "hr.documents.manage",
  async (req, { user: actor, params }) => {
    const employeeId = params?.id as string;

    const employee = await prisma.hrEmployee.findUnique({ where: { id: employeeId } });
    if (!employee) return notFound("No such employee.");

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return badRequest("Expected a multipart form upload.");
    }

    const file = form.get("file");
    if (!(file instanceof File)) return badRequest("No file was uploaded.");

    const check = validateUpload(file);
    if (!check.ok) return badRequest(check.error);

    const rawType = String(form.get("docType") ?? "OTHER");
    const docType = (Object.values(HrDocumentType) as string[]).includes(rawType)
      ? (rawType as HrDocumentType)
      : HrDocumentType.OTHER;

    const expiresRaw = String(form.get("expiresAt") ?? "").trim();
    const expiresAt = expiresRaw ? new Date(expiresRaw) : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      return badRequest("Expiry date is not a valid date.");
    }

    const notes = String(form.get("notes") ?? "").trim() || null;
    const buffer = Buffer.from(await file.arrayBuffer());

    // Row first, so the id exists to name the file with. If the write below
    // fails the row is removed rather than left pointing at nothing.
    const record = await prisma.hrDocument.create({
      data: {
        employeeId,
        docType,
        fileName: check.displayName,
        storedPath: "",
        mimeType: check.mimeType,
        sizeBytes: buffer.byteLength,
        expiresAt,
        notes,
        uploadedById: actor.id,
      },
    });

    try {
      const storedPath = await storeDocument(record.id, check.ext, buffer);
      const saved = await prisma.hrDocument.update({
        where: { id: record.id },
        data: { storedPath },
        select: {
          id: true,
          docType: true,
          fileName: true,
          sizeBytes: true,
          expiresAt: true,
          uploadedAt: true,
        },
      });
      return ok({ document: saved }, 201);
    } catch (e) {
      await prisma.hrDocument.delete({ where: { id: record.id } }).catch(() => undefined);
      console.error("[hr] document write failed", record.id, e);
      return badRequest("The file could not be stored. Try again.");
    }
  },
);

export const maxDocumentBytes = MAX_DOCUMENT_BYTES;
