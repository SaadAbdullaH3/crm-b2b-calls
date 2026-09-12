import { DispositionCode } from "@prisma/client";
import { badRequest } from "@/lib/api";
import { resolveReportRange, RangeError, type ReportRange } from "@/server/reports/range";
import type { ReportFilters } from "@/server/reports/definitions";

/**
 * Shared query-parameter parsing for every report endpoint.
 *
 * One parser so the four endpoints cannot disagree about what `scope=week`
 * means, and so Dev B can send the same filter object to any of them.
 *
 * Unknown filters are IGNORED rather than rejected — the frontend keeps one
 * filter state object and posts it everywhere; erroring on a filter an endpoint
 * happens not to use would make that impossible.
 */

export interface ParsedReportRequest {
  range: ReportRange;
  filters: ReportFilters;
  page: { offset: number; limit: number };
}

export type ParseResult =
  | { ok: true; value: ParsedReportRequest }
  | { ok: false; res: Response };

export function parseReportRequest(req: Request): ParseResult {
  const url = new URL(req.url);
  const p = url.searchParams;

  let range: ReportRange;
  try {
    range = resolveReportRange(p.get("scope"), p.get("from"), p.get("to"));
  } catch (e) {
    if (e instanceof RangeError) return { ok: false, res: badRequest(e.message) };
    throw e;
  }

  const dispositionRaw = p.get("disposition");
  if (dispositionRaw && !(dispositionRaw in DispositionCode)) {
    return {
      ok: false,
      res: badRequest(
        `Unknown disposition "${dispositionRaw}". Expected one of: ${Object.values(DispositionCode).join(", ")}.`,
      ),
    };
  }

  return {
    ok: true,
    value: {
      range,
      filters: {
        agentId: p.get("agentId") || null,
        source: p.get("source") || null,
        disposition: (dispositionRaw as DispositionCode | null) || null,
      },
      page: {
        offset: Math.max(Number(p.get("offset") ?? 0) || 0, 0),
        limit: Number(p.get("limit") ?? 200) || 200,
      },
    },
  };
}

/**
 * The envelope every report shares, so the frontend can render the header and
 * the active-filter chips generically.
 */
export function reportEnvelope<T>(
  parsed: ParsedReportRequest,
  data: T,
): {
  range: { scope: string; from: string; to: string; label: string };
  filters: ReportFilters;
  generatedAt: string;
  data: T;
} {
  return {
    range: {
      scope: parsed.range.scope,
      from: parsed.range.from.toISOString(),
      to: parsed.range.to.toISOString(),
      label: parsed.range.label,
    },
    filters: parsed.filters,
    generatedAt: new Date().toISOString(),
    data,
  };
}
