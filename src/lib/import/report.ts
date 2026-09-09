import ExcelJS from "exceljs";
import { DuplicateResolution, ImportRowStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

/**
 * LM-07 — the validation / error report.
 *
 * One .xlsx listing every row that will NOT become a lead, with a plain-English
 * reason per row. Excel rather than CSV because the source file is Excel: the
 * person fixing the data opens it beside the original, and CSV would mangle the
 * phone numbers this report exists to show them.
 */

/** Machine issue code -> what Management should actually do about it. */
const ISSUE_TEXT: Record<string, string> = {
  MISSING_PHONE: "No phone number — a lead with no number cannot be called.",
  PHONE_COLUMN_NOT_MAPPED: "No column was mapped to Phone Number.",
  INVALID_PHONE_FORMAT:
    "Phone number is not a valid U.S. format. (Format only — we never check whether a line is reachable.)",
  MISSING_IDENTITY: "Neither a company name nor a contact name was provided.",
  INVALID_EMAIL_FORMAT: "Email address is not a valid format.",
  DUPLICATE_OF_EXISTING_LEAD: "Matches a lead already in the CRM.",
  DUPLICATE_IN_FILE: "Duplicates an earlier row in this same file.",
};

function explainIssue(code: string): string {
  if (code.startsWith("MISSING_REQUIRED_FIELD:")) {
    return `Required field "${code.split(":")[1]}" is blank.`;
  }
  return ISSUE_TEXT[code] ?? code;
}

const RESOLUTION_TEXT: Record<DuplicateResolution, string> = {
  PENDING: "Not yet decided",
  REJECT: "Rejected — not imported",
  KEEP_BOTH: "Kept as a separate lead",
  UPDATE_EXISTING: "Merged into the existing lead",
  MANUAL_REVIEW: "Flagged for manual review",
};

/** Whether a row was excluded from the import, and why in one phrase. */
function outcomeFor(row: {
  status: ImportRowStatus;
  resolution: DuplicateResolution;
  importedLeadId: string | null;
}): string {
  if (row.importedLeadId) {
    return row.resolution === DuplicateResolution.UPDATE_EXISTING
      ? "Merged into existing lead"
      : "Imported";
  }
  if (row.status === ImportRowStatus.DUPLICATE) {
    return RESOLUTION_TEXT[row.resolution];
  }
  return "Not imported — see reasons";
}

export async function buildValidationReport(importId: string): Promise<Buffer> {
  const record = await prisma.leadImport.findUniqueOrThrow({
    where: { id: importId },
    include: { uploadedBy: { select: { fullName: true } } },
  });

  // Everything except cleanly-imported rows: that is precisely the set someone
  // has to act on.
  const rows = await prisma.leadImportRow.findMany({
    where: { importId, NOT: { status: ImportRowStatus.READY } },
    orderBy: { rowNumber: "asc" },
    include: {
      duplicateOfLead: {
        select: { id: true, companyName: true, contactName: true, phoneE164: true },
      },
    },
  });

  const wb = new ExcelJS.Workbook();
  wb.creator = "CRM — B2B Calls";
  wb.created = new Date();

  // --- summary sheet --------------------------------------------------------
  const summary = wb.addWorksheet("Summary");
  summary.columns = [
    { header: "", key: "label", width: 34 },
    { header: "", key: "value", width: 48 },
  ];
  const summaryRows: [string, string | number][] = [
    ["File", record.fileName],
    ["Lead source / campaign", record.sourceLabel ?? "—"],
    ["Uploaded by", record.uploadedBy.fullName],
    ["Uploaded at", record.createdAt.toLocaleString()],
    ["Import status", record.status],
    ["", ""],
    ["Total rows", record.totalRows],
    ["Ready to import", record.validRows],
    ["Duplicates", record.duplicateRows],
    ["Missing information", record.missingInfoRows],
    ["Invalid phone format", record.invalidPhoneRows],
    ["Actually imported", record.importedRows],
    ["", ""],
    ["Rows in this report", rows.length],
  ];
  for (const [label, value] of summaryRows) summary.addRow({ label, value });
  summary.getColumn("label").font = { bold: true };

  // --- detail sheet ---------------------------------------------------------
  const sheet = wb.addWorksheet("Rows needing attention");
  sheet.columns = [
    { header: "Row", key: "rowNumber", width: 7 },
    { header: "Outcome", key: "outcome", width: 28 },
    { header: "Reasons", key: "reasons", width: 62 },
    { header: "Company", key: "company", width: 26 },
    { header: "Contact", key: "contact", width: 22 },
    { header: "Phone (as in file)", key: "phone", width: 22 },
    { header: "Email", key: "email", width: 28 },
    { header: "Matches", key: "matches", width: 34 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  for (const row of rows) {
    const data = (row.data ?? {}) as Record<string, unknown>;
    const issues = Array.isArray(row.issues) ? (row.issues as string[]) : [];

    let matches = "";
    if (row.duplicateOfLead) {
      const d = row.duplicateOfLead;
      matches = `Existing lead: ${d.companyName ?? "—"} / ${d.contactName ?? "—"} / ${d.phoneE164 ?? "—"}`;
    } else if (row.duplicateOfRowNumber) {
      matches = `Row ${row.duplicateOfRowNumber} of this file`;
    }
    const matchedOn = Array.isArray(row.duplicateMatchedOn)
      ? (row.duplicateMatchedOn as string[])
      : [];
    if (matchedOn.length) matches += ` (matched on ${matchedOn.join(", ")})`;

    sheet.addRow({
      rowNumber: row.rowNumber,
      outcome: outcomeFor(row),
      reasons: issues.map(explainIssue).join(" "),
      company: data.companyName ?? "",
      contact: data.contactName ?? "",
      // Kept as text so Excel doesn't reformat it back into a number.
      phone: data.phone === undefined || data.phone === null ? "" : String(data.phone),
      email: data.email ?? "",
      matches,
    });
  }

  if (rows.length === 0) {
    sheet.addRow({ rowNumber: "", outcome: "Every row passed validation.", reasons: "" });
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
