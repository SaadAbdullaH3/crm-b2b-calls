import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ImportStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, badRequest } from "@/lib/api";
import { parseWorkbook, ImportParseError, MAX_IMPORT_ROWS } from "@/lib/import/parse";
import { loadMappingTargets } from "@/lib/import/load-targets";
import { suggestTarget } from "@/lib/import/target-fields";

/**
 * LM-01 — upload a lead file.
 *
 * Parses immediately so Management gets the detected columns back in the same
 * response and can map them straight away. Nothing is written to `leads` here;
 * the upload only produces a `lead_imports` row in MAPPING state.
 */

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const UPLOAD_DIR = path.join(process.cwd(), "uploads", "imports");

export const GET = requirePermission("leads.import.history", async (req) => {
  const limit = Math.min(
    Number(new URL(req.url).searchParams.get("limit") ?? 50) || 50,
    200,
  );

  const imports = await prisma.leadImport.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { uploadedBy: { select: { id: true, fullName: true } } },
  });

  return ok({ imports });
});

export const POST = requirePermission("leads.import", async (req, { user }) => {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return badRequest("Expected a multipart form upload.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return badRequest("No file was uploaded.");

  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return badRequest(
      "Only .xlsx files are supported. If this is a .csv or .xls, open it in Excel and Save As .xlsx.",
    );
  }
  if (file.size === 0) return badRequest("That file is empty.");
  if (file.size > MAX_FILE_BYTES) {
    return badRequest(`That file is larger than ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let sheet;
  try {
    sheet = await parseWorkbook(buffer);
  } catch (e) {
    if (e instanceof ImportParseError) return badRequest(e.message);
    throw e;
  }

  if (sheet.rows.length === 0) {
    return badRequest("The sheet has column headers but no data rows.");
  }

  const sourceLabel = (form.get("sourceLabel") as string | null)?.trim() || null;

  const record = await prisma.leadImport.create({
    data: {
      fileName: file.name,
      uploadedById: user.id,
      sourceLabel,
      status: ImportStatus.MAPPING,
      detectedColumns: sheet.headers,
      totalRows: sheet.rows.length,
    },
  });

  // Keep the original file: the Day 3 error report quotes the source rows, and
  // an import that fails halfway needs to be re-runnable without a re-upload.
  await mkdir(UPLOAD_DIR, { recursive: true });
  const storedPath = path.join(UPLOAD_DIR, `${record.id}.xlsx`);
  await writeFile(storedPath, buffer);
  await prisma.leadImport.update({
    where: { id: record.id },
    data: { storedPath },
  });

  const targets = await loadMappingTargets();
  const suggested: Record<string, string> = {};
  sheet.headers.forEach((header, index) => {
    suggested[String(index)] = suggestTarget(header, targets);
  });

  return ok(
    {
      import: { ...record, storedPath },
      headers: sheet.headers,
      sheetName: sheet.sheetName,
      suggestedMapping: suggested,
      targets,
      truncated: sheet.truncated,
      maxRows: MAX_IMPORT_ROWS,
    },
    201,
  );
});
