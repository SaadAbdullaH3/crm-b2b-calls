import path from "node:path";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { ReportFormat } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ReportRange } from "@/server/reports/range";
import type { ReportFilters } from "@/server/reports/definitions";
import { getPerformanceReport } from "@/server/reports/performance";
import { getSourceReport } from "@/server/reports/sources";
import { getPunctualityReport } from "@/server/reports/punctuality";
import { getRawReport, RAW_MAX_LIMIT } from "@/server/reports/raw";
import {
  EXTENSION,
  MIME,
  REPORT_TITLES,
  performanceDocument,
  punctualityDocument,
  rawDocument,
  sourcesDocument,
  toPdf,
  toXlsx,
  type ExportContext,
  type ExportDocument,
  type ReportKind,
} from "@/server/reports/export";

/**
 * RP-04 — generated reports stay reachable afterwards.
 *
 * A report someone showed a client in March and cannot open in June is not a
 * record of anything. So generating one writes THREE things: the file on disk,
 * a `reports_generated` row carrying the period, the filters and the frozen
 * range label, and — on request — an approval stamp naming the manager who
 * signed it off.
 *
 * Storage follows the HR-document rules exactly (`src/server/hr/documents.ts`):
 * the file is named from the record id, never from anything a client sent, it
 * lives outside the web root, and it is served only through a permission-checked
 * route as an attachment. An export contains contact names, phone numbers and
 * call notes; it is the most sensitive artefact this module produces.
 */

const REPORT_DIR = path.join(process.cwd(), "uploads", "reports");

/**
 * An export of a quarter is tens of thousands of rows. Paging to a hard cap is
 * the honest middle: the document says how many rows it holds out of how many
 * exist, so a truncated export announces itself instead of looking complete.
 */
const RAW_EXPORT_CAP = 20_000;

export interface GenerateInput {
  kind: ReportKind;
  format: ReportFormat;
  range: ReportRange;
  filters: ReportFilters;
  user: { id: string; fullName: string };
}

export interface GeneratedReport {
  id: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}

/** Filter ids are unreadable in an export header; resolve them to names once. */
async function describeFilters(filters: ReportFilters): Promise<ExportContext["filters"]> {
  let agent: string | null = null;
  if (filters.agentId) {
    const user = await prisma.user.findUnique({
      where: { id: filters.agentId },
      select: { fullName: true },
    });
    agent = user?.fullName ?? filters.agentId;
  }
  return {
    agent,
    source: filters.source ?? null,
    disposition: filters.disposition ? filters.disposition.replace(/_/g, " ") : null,
  };
}

/** Every raw row in the range, up to the cap, so an export is not one page. */
async function collectRawRows(range: ReportRange, filters: ReportFilters) {
  const first = await getRawReport(range, filters, { offset: 0, limit: RAW_MAX_LIMIT });
  const rows = [...first.rows];
  const target = Math.min(first.total, RAW_EXPORT_CAP);

  while (rows.length < target) {
    const next = await getRawReport(range, filters, {
      offset: rows.length,
      limit: RAW_MAX_LIMIT,
    });
    if (next.rows.length === 0) break;
    rows.push(...next.rows);
  }

  return { ...first, rows, offset: 0, limit: rows.length };
}

async function buildDocument(
  input: GenerateInput,
  ctx: ExportContext,
): Promise<{ doc: ExportDocument; rowCount: number }> {
  switch (input.kind) {
    case "performance": {
      const data = await getPerformanceReport(input.range, input.filters);
      return { doc: performanceDocument(data, ctx), rowCount: data.byAgent.length };
    }
    case "sources": {
      const data = await getSourceReport(input.range, input.filters);
      return { doc: sourcesDocument(data, ctx), rowCount: data.sources.length };
    }
    case "punctuality": {
      const data = await getPunctualityReport(input.range, input.filters);
      return { doc: punctualityDocument(data, ctx), rowCount: data.rows.length };
    }
    case "raw": {
      const data = await collectRawRows(input.range, input.filters);
      return { doc: rawDocument(data, ctx), rowCount: data.rows.length };
    }
  }
}

function fileNameFor(kind: ReportKind, range: ReportRange, format: ReportFormat): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `${kind}-${range.scope}-${stamp}${EXTENSION[format]}`;
}

export async function generateReport(input: GenerateInput): Promise<GeneratedReport> {
  const generatedAt = new Date();
  const ctx: ExportContext = {
    rangeLabel: input.range.label,
    generatedAt,
    generatedBy: input.user.fullName,
    filters: await describeFilters(input.filters),
  };

  const { doc, rowCount } = await buildDocument(input, ctx);
  const buffer = input.format === ReportFormat.PDF ? await toPdf(doc) : await toXlsx(doc);

  // The row is created first so the file can be named from its id — the same
  // rule as HR documents: nothing a client supplied ever reaches the filesystem.
  const record = await prisma.reportGenerated.create({
    data: {
      generatedById: input.user.id,
      reportType: input.kind,
      periodStart: input.range.from,
      periodEnd: input.range.to,
      scope: input.range.scope,
      rangeLabel: input.range.label,
      format: input.format,
      rowCount,
      filters: {
        agentId: input.filters.agentId ?? null,
        source: input.filters.source ?? null,
        disposition: input.filters.disposition ?? null,
      },
    },
    select: { id: true },
  });

  await mkdir(REPORT_DIR, { recursive: true });
  const storedPath = path.join(REPORT_DIR, `${record.id}${EXTENSION[input.format]}`);
  await writeFile(storedPath, buffer);

  await prisma.reportGenerated.update({
    where: { id: record.id },
    data: { storedPath, fileSize: buffer.byteLength },
  });

  return {
    id: record.id,
    fileName: fileNameFor(input.kind, input.range, input.format),
    mimeType: MIME[input.format],
    buffer,
  };
}

/**
 * Read a stored report back.
 *
 * Re-checks that the resolved path is inside REPORT_DIR before reading. The
 * path in the database was written by this module and not by a user, but a
 * check that costs nothing is worth keeping between the database and the disk.
 */
export async function readStoredReport(
  storedPath: string,
): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string }> {
  const root = path.resolve(REPORT_DIR);
  const resolved = path.resolve(storedPath);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return { ok: false, error: "Stored file is outside the reports directory." };
  }
  try {
    await stat(resolved);
  } catch {
    return { ok: false, error: "The stored file is missing from disk." };
  }
  return { ok: true, buffer: await readFile(resolved) };
}

export function downloadNameFor(record: {
  reportType: string;
  scope: string | null;
  format: ReportFormat;
  createdAt: Date;
}): string {
  const stamp = record.createdAt.toISOString().slice(0, 10);
  const scope = record.scope ?? "range";
  return `${record.reportType}-${scope}-${stamp}${EXTENSION[record.format]}`;
}

export function titleFor(reportType: string): string {
  return REPORT_TITLES[reportType as ReportKind] ?? reportType;
}
