import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { notFound } from "@/lib/api";
import { readDocument, mimeForPath } from "@/server/hr/documents";

/**
 * HR-02/HR-07 — download one document.
 *
 * THE reason /uploads is outside the public tree. Serving these statically
 * would mean anyone holding a URL could read a warning letter, which is
 * exactly what HR-07 forbids; here the permission is checked before a single
 * byte is read from disk.
 *
 * Always `attachment`, never `inline`. An inline PDF or image renders in the
 * browser under this app's origin, which turns any malicious upload into
 * same-origin content.
 */
export const GET = requirePermission("hr.documents.manage", async (_req, { params }) => {
  const id = params?.id as string;

  const doc = await prisma.hrDocument.findUnique({
    where: { id },
    select: { fileName: true, storedPath: true, mimeType: true },
  });
  if (!doc) return notFound("No such document.");

  const buffer = await readDocument(doc.storedPath);
  if (!buffer) {
    // Row exists, file does not — a restored database without its uploads, or
    // a failed write. Say so plainly rather than returning an empty file.
    return notFound("The stored file is missing. It may not have survived a restore.");
  }

  // RFC 5987 so non-ASCII names survive; the quoted fallback is stripped of
  // anything that could break out of the header.
  const ascii = doc.fileName
    .replace(/[^\x20-\x7e]/g, "_")
    .split('"')
    .join("")
    .split("\\")
    .join("");

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": doc.mimeType ?? mimeForPath(doc.storedPath),
      "Content-Length": String(buffer.byteLength),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
      // Never let a shared cache hold an HR document.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
