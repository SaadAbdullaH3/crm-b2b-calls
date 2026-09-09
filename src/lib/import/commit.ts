import {
  DuplicateResolution,
  ImportRowStatus,
  ImportStatus,
  LeadStatus,
  Prisma,
} from "@prisma/client";
import { prisma } from "@/lib/db";
import { checkUsPhone } from "@/lib/import/phone";
import { normalizeWebsite } from "@/lib/import/analyze";
import { FIXED_TARGETS } from "@/lib/import/target-fields";

/**
 * Commits a reviewed import: turns `lead_import_rows` into actual `leads`.
 *
 * This is the only place in the import engine that writes to `leads`.
 *
 * WHICH ROWS BECOME LEADS
 *   READY                                    -> created
 *   DUPLICATE + KEEP_BOTH                    -> created anyway
 *   DUPLICATE + UPDATE_EXISTING              -> merged onto the matched lead
 *   DUPLICATE + REJECT / MANUAL_REVIEW       -> skipped
 *   MISSING_INFO / INVALID_PHONE / INVALID   -> skipped, and reported (LM-07)
 *
 * A row that is flagged for a reason OTHER than being a duplicate is never
 * imported: a lead with no number, or with a number that isn't a valid U.S.
 * format, cannot be called, and silently creating it would put dead weight in
 * agents' call lists. It stays in `lead_import_rows` and appears in the error
 * report so Management can fix the source file and re-import.
 */

const FIXED_KEYS = new Set(FIXED_TARGETS.map((t) => t.key));

/** Fields an UPDATE_EXISTING merge is allowed to touch. */
const MERGEABLE_FIELDS = [
  "companyName",
  "contactName",
  "jobTitle",
  "email",
  "website",
  "addressLine",
  "city",
  "state",
  "postalCode",
] as const;

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Splits a row's mapped data into fixed lead columns and custom-field values. */
function shapeRow(data: Record<string, unknown>) {
  const phone = checkUsPhone(data.phone);
  const custom: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    if (FIXED_KEYS.has(key)) continue;
    const v = text(value) ?? value;
    if (v !== null && v !== undefined && v !== "") custom[key] = v;
  }

  return {
    companyName: text(data.companyName),
    contactName: text(data.contactName),
    jobTitle: text(data.jobTitle),
    phoneRaw: phone.ok ? phone.raw : text(data.phone),
    phoneE164: phone.ok ? phone.e164 : null,
    // Stored lowercased so duplicate detection can compare with an exact `in`.
    email: text(data.email)?.toLowerCase() ?? null,
    website: normalizeWebsite(data.website) || null,
    addressLine: text(data.addressLine),
    city: text(data.city),
    state: text(data.state),
    postalCode: text(data.postalCode),
    customFields: Object.keys(custom).length ? custom : null,
  };
}

export interface CommitResult {
  created: number;
  updated: number;
  skipped: number;
}

export class UnresolvedDuplicatesError extends Error {
  constructor(public count: number) {
    super(
      `${count} duplicate ${count === 1 ? "row" : "rows"} still need a decision before this import can run.`,
    );
  }
}

/** Rows are processed in sheet order so an in-file duplicate can reference the lead its original row created. */
const CHUNK = 200;

export async function commitImport(importId: string): Promise<CommitResult> {
  const record = await prisma.leadImport.findUniqueOrThrow({ where: { id: importId } });

  // LM-06: every pure duplicate must have a decision. Committing with PENDING
  // duplicates would silently drop them, which is the failure mode this whole
  // review step exists to prevent.
  const unresolved = await prisma.leadImportRow.count({
    where: {
      importId,
      status: ImportRowStatus.DUPLICATE,
      resolution: DuplicateResolution.PENDING,
    },
  });
  if (unresolved > 0) throw new UnresolvedDuplicatesError(unresolved);

  await prisma.leadImport.update({
    where: { id: importId },
    data: { status: ImportStatus.IMPORTING },
  });

  const result: CommitResult = { created: 0, updated: 0, skipped: 0 };
  /** rowNumber -> id of the lead that row produced, for in-file duplicates. */
  const leadByRow = new Map<number, string>();

  try {
    let cursor = 0;
    for (;;) {
      const rows = await prisma.leadImportRow.findMany({
        where: { importId, rowNumber: { gt: cursor } },
        orderBy: { rowNumber: "asc" },
        take: CHUNK,
      });
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1]!.rowNumber;

      // Chunked rather than one transaction for the whole file: a 50,000-row
      // import in a single transaction would hold locks for minutes and blow
      // Prisma's timeout. Each chunk is atomic; a mid-import failure leaves the
      // import in FAILED with importedRows showing how far it got.
      await prisma.$transaction(async (tx) => {
        for (const row of rows) {
          const data = (row.data ?? {}) as Record<string, unknown>;
          const shaped = shapeRow(data);

          const isDuplicate = row.status === ImportRowStatus.DUPLICATE;
          const flaggedForOtherReasons =
            row.status === ImportRowStatus.MISSING_INFO ||
            row.status === ImportRowStatus.INVALID_PHONE ||
            row.status === ImportRowStatus.INVALID;

          if (flaggedForOtherReasons) {
            result.skipped++;
            continue;
          }

          if (isDuplicate) {
            if (
              row.resolution === DuplicateResolution.REJECT ||
              row.resolution === DuplicateResolution.MANUAL_REVIEW
            ) {
              result.skipped++;
              continue;
            }

            if (row.resolution === DuplicateResolution.UPDATE_EXISTING) {
              const targetId =
                row.duplicateOfLeadId ??
                (row.duplicateOfRowNumber
                  ? leadByRow.get(row.duplicateOfRowNumber)
                  : undefined);

              if (!targetId) {
                // The original was itself rejected, so there is nothing to
                // update. Treat as skipped rather than inventing a lead.
                result.skipped++;
                continue;
              }

              // Merge only fields the sheet actually provided. An import must
              // never blank out data a human already entered, and must never
              // touch ownership (assigned_to_id / locked_at /
              // current_assignment_id) or the do_not_call flag — that would let
              // a spreadsheet steal a lead from an agent mid-call or silently
              // un-suppress a Do-Not-Call contact.
              const patch: Prisma.LeadUpdateInput = {};
              for (const field of MERGEABLE_FIELDS) {
                const value = shaped[field];
                if (value !== null) patch[field] = value;
              }
              if (shaped.phoneE164) {
                patch.phoneE164 = shaped.phoneE164;
                patch.phoneRaw = shaped.phoneRaw;
              }
              if (shaped.customFields) {
                const existing = await tx.lead.findUnique({
                  where: { id: targetId },
                  select: { customFields: true },
                });
                patch.customFields = {
                  ...((existing?.customFields as Record<string, unknown>) ?? {}),
                  ...shaped.customFields,
                } as Prisma.InputJsonValue;
              }
              if (record.sourceLabel) patch.sourceLabel = record.sourceLabel;

              await tx.lead.update({ where: { id: targetId }, data: patch });
              await tx.leadImportRow.update({
                where: { id: row.id },
                data: { importedLeadId: targetId },
              });
              leadByRow.set(row.rowNumber, targetId);
              result.updated++;
              continue;
            }
            // KEEP_BOTH falls through to create.
          }

          const lead = await tx.lead.create({
            data: {
              ...shaped,
              customFields: (shaped.customFields ?? undefined) as Prisma.InputJsonValue,
              sourceLabel: record.sourceLabel,
              importId,
              status: LeadStatus.AVAILABLE,
            },
          });

          await tx.leadImportRow.update({
            where: { id: row.id },
            data: { importedLeadId: lead.id },
          });
          leadByRow.set(row.rowNumber, lead.id);
          result.created++;
        }
      });

      await prisma.leadImport.update({
        where: { id: importId },
        data: { importedRows: result.created + result.updated },
      });
    }

    await prisma.leadImport.update({
      where: { id: importId },
      data: {
        status: ImportStatus.COMPLETED,
        importedRows: result.created + result.updated,
        completedAt: new Date(),
      },
    });

    return result;
  } catch (e) {
    await prisma.leadImport.update({
      where: { id: importId },
      data: { status: ImportStatus.FAILED },
    });
    throw e;
  }
}
