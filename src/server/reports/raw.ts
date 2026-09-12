import { prisma } from "@/lib/db";
import type { DateRange } from "@/server/dashboard/metrics";
import { callWhere, type ReportFilters } from "@/server/reports/definitions";

/**
 * Row-level call data for Dev B's raw-data view and Excel/PDF export.
 *
 * Deliberately FLAT and PRE-LABELLED: `outcome` is the human label, not an id,
 * and the lead's company/contact/phone are inlined. The export should be able
 * to map a row straight onto spreadsheet columns without a second lookup or a
 * client-side join — an export that needs the frontend to resolve ids is where
 * the two screens start disagreeing about what a row means.
 *
 * Paginated because an export over a quarter is tens of thousands of rows and
 * an unbounded query would be the slowest thing in the app.
 */

export interface RawCallRow {
  callId: string;
  at: string;
  agent: string;
  company: string | null;
  contact: string | null;
  phone: string | null;
  source: string | null;
  outcome: string | null;
  outcomeCode: string | null;
  durationSec: number | null;
  channel: string;
  notes: string | null;
  callbackAt: string | null;
}

export interface RawReport {
  rows: RawCallRow[];
  total: number;
  offset: number;
  limit: number;
}

export const RAW_MAX_LIMIT = 1000;

export async function getRawReport(
  range: DateRange,
  filters: ReportFilters = {},
  page: { offset?: number; limit?: number } = {},
): Promise<RawReport> {
  const where = callWhere(range, filters);
  const limit = Math.min(Math.max(page.limit ?? 200, 1), RAW_MAX_LIMIT);
  const offset = Math.max(page.offset ?? 0, 0);

  const [rows, total] = await Promise.all([
    prisma.call.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
      select: {
        id: true,
        createdAt: true,
        durationSec: true,
        channel: true,
        notes: true,
        agent: { select: { fullName: true } },
        disposition: { select: { code: true, label: true } },
        lead: {
          select: {
            companyName: true,
            contactName: true,
            phoneE164: true,
            phoneRaw: true,
            sourceLabel: true,
          },
        },
        callbacks: {
          orderBy: { scheduledFor: "asc" },
          take: 1,
          select: { scheduledFor: true },
        },
      },
    }),
    prisma.call.count({ where }),
  ]);

  return {
    rows: rows.map((c) => ({
      callId: c.id,
      at: c.createdAt.toISOString(),
      agent: c.agent.fullName,
      company: c.lead.companyName,
      contact: c.lead.contactName,
      // Raw form for the spreadsheet: it is what the agent saw and what a human
      // reading the export will recognise.
      phone: c.lead.phoneRaw ?? c.lead.phoneE164,
      source: c.lead.sourceLabel,
      outcome: c.disposition?.label ?? null,
      outcomeCode: c.disposition?.code ?? null,
      durationSec: c.durationSec,
      channel: c.channel,
      notes: c.notes,
      callbackAt: c.callbacks[0]?.scheduledFor.toISOString() ?? null,
    })),
    total,
    offset,
    limit,
  };
}
