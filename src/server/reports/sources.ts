import { DispositionCode, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { DateRange } from "@/server/dashboard/metrics";
import { conversionPct, type ReportFilters } from "@/server/reports/definitions";

/**
 * Lead Source report — imported / assigned / worked / contacted / qualified,
 * grouped by `leads.source_label`.
 *
 * Definitions follow Dev B's Day 6 note exactly:
 *   worked      = has a last_disposition_code
 *   contacted   = worked, with an outcome other than NO_ANSWER
 *   conversion  = qualified ÷ WORKED, never ÷ imported
 *
 * That last one matters commercially: dividing by imported makes a source with
 * a large untouched backlog look like it converts badly, when in fact nobody
 * has called it yet. The client would then bin a source that was never worked.
 *
 * `imported` counts by `leads.created_at` in range, whereas the other columns
 * count by activity in range. A lead imported in August and worked in September
 * therefore appears in September's worked column and August's imported one —
 * which is correct, and worth saying out loud because the columns will not sum
 * to each other across periods.
 */

export interface SourceReportRow {
  source: string;
  imported: number;
  assigned: number;
  worked: number;
  contacted: number;
  qualified: number;
  doNotCall: number;
  conversionPct: number;
  workedPct: number;
}

export interface SourceReport {
  sources: SourceReportRow[];
  totals: Omit<SourceReportRow, "source">;
}

export async function getSourceReport(
  range: DateRange,
  filters: ReportFilters = {},
): Promise<SourceReport> {
  const agentFilter = filters.agentId
    ? Prisma.sql`AND l.assigned_to_id = ${filters.agentId}`
    : Prisma.empty;
  const sourceFilter = filters.source
    ? Prisma.sql`AND coalesce(l.source_label, '(none)') = ${filters.source}`
    : Prisma.empty;

  // One pass over leads with FILTER clauses, rather than six counts per source.
  const rows = await prisma.$queryRaw<
    {
      source: string;
      imported: bigint;
      assigned: bigint;
      worked: bigint;
      contacted: bigint;
      qualified: bigint;
      do_not_call: bigint;
    }[]
  >(Prisma.sql`
    SELECT
      coalesce(l.source_label, '(none)') AS source,
      count(*) FILTER (WHERE l.created_at BETWEEN ${range.from} AND ${range.to}) AS imported,
      count(*) FILTER (WHERE l.assigned_to_id IS NOT NULL) AS assigned,
      count(*) FILTER (WHERE l.last_disposition_at BETWEEN ${range.from} AND ${range.to}) AS worked,
      count(*) FILTER (
        WHERE l.last_disposition_at BETWEEN ${range.from} AND ${range.to}
          AND l.last_disposition_code <> 'NO_ANSWER'
      ) AS contacted,
      count(*) FILTER (
        WHERE l.last_disposition_at BETWEEN ${range.from} AND ${range.to}
          AND l.last_disposition_code = 'QUALIFIED'
      ) AS qualified,
      count(*) FILTER (WHERE l.do_not_call) AS do_not_call
    FROM leads l
    WHERE TRUE ${agentFilter} ${sourceFilter}
    GROUP BY 1
    ORDER BY 1
  `);

  const sources: SourceReportRow[] = rows
    .map((r) => {
      const worked = Number(r.worked);
      const qualified = Number(r.qualified);
      const imported = Number(r.imported);
      return {
        source: r.source,
        imported,
        assigned: Number(r.assigned),
        worked,
        contacted: Number(r.contacted),
        qualified,
        doNotCall: Number(r.do_not_call),
        conversionPct: conversionPct(qualified, worked),
        workedPct: imported > 0 ? Math.round((worked / imported) * 1000) / 10 : 0,
      };
    })
    // Sources with no activity at all in the window are noise on a report about
    // that window; a source that only has historical leads still shows if any
    // were worked or are suppressed.
    .filter((r) => r.imported > 0 || r.worked > 0 || r.assigned > 0 || r.doNotCall > 0);

  const sum = (key: keyof Omit<SourceReportRow, "source">) =>
    sources.reduce((acc, r) => acc + (r[key] as number), 0);

  const totalWorked = sum("worked");
  const totalQualified = sum("qualified");
  const totalImported = sum("imported");

  return {
    sources,
    totals: {
      imported: totalImported,
      assigned: sum("assigned"),
      worked: totalWorked,
      contacted: sum("contacted"),
      qualified: totalQualified,
      doNotCall: sum("doNotCall"),
      conversionPct: conversionPct(totalQualified, totalWorked),
      workedPct:
        totalImported > 0 ? Math.round((totalWorked / totalImported) * 1000) / 10 : 0,
    },
  };
}

/** Distinct source labels, for the frontend's filter dropdown. */
export async function listSources(): Promise<string[]> {
  const rows = await prisma.lead.findMany({
    distinct: ["sourceLabel"],
    select: { sourceLabel: true },
    orderBy: { sourceLabel: "asc" },
  });
  return rows.map((r) => r.sourceLabel ?? "(none)");
}

export { DispositionCode };
