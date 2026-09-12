import type { DateRange } from "@/server/dashboard/metrics";

/**
 * Report date scopes.
 *
 * WHY THIS IS NOT `metrics.resolveRange`: the dashboard's scopes are ROLLING
 * windows — "7d" means the last seven days from now. Reports need CALENDAR
 * periods: "This month" must mean the 1st to today, not the last 30 days. A
 * monthly report that silently means "last 30 days" is the kind of thing a
 * client notices in a board meeting, and it is a different question from the
 * one the dashboard answers.
 *
 * Both produce the same `DateRange` shape, so every aggregation in
 * `metrics.ts` is reusable against either. That is the point: shared
 * aggregations, different windows.
 *
 * TIMEZONE: ranges are computed in the server's local time, matching the
 * dashboard. `shift.config.timeZone` exists and NF-09 wants display in the
 * business zone; making every boundary timezone-correct is a bigger job than
 * one day and touches both tracks. Flagged for Day 9 rather than half-done
 * here — a half-applied timezone is worse than a consistent local one.
 */

export const REPORT_SCOPES = [
  "today",
  "yesterday",
  "week",
  "last-week",
  "month",
  "last-month",
  "15d",
  "custom",
] as const;

export type ReportScope = (typeof REPORT_SCOPES)[number];

export interface ReportRange extends DateRange {
  scope: ReportScope;
  /** Rendered server-side so the report header and the query cannot disagree. */
  label: string;
}

export class RangeError extends Error {}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

/** Monday-start, matching `shift.config.workingDays` defaulting to Mon–Fri. */
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 = Sunday
  const diff = day === 0 ? 6 : day - 1;
  x.setDate(x.getDate() - diff);
  return x;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function shortDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "7–12 Sep" when the month matches, "28 Aug – 3 Sep" when it doesn't. */
function rangeLabel(from: Date, to: Date): string {
  if (from.toDateString() === to.toDateString()) return shortDate(from);
  if (from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear()) {
    return `${from.getDate()}–${to.getDate()} ${MONTHS[to.getMonth()]}`;
  }
  return `${shortDate(from)} – ${shortDate(to)}`;
}

export function resolveReportRange(
  scopeInput: string | null,
  fromInput?: string | null,
  toInput?: string | null,
): ReportRange {
  const scope = (scopeInput ?? "today") as ReportScope;
  if (!REPORT_SCOPES.includes(scope)) {
    throw new RangeError(
      `Unknown scope "${scopeInput}". Expected one of: ${REPORT_SCOPES.join(", ")}.`,
    );
  }

  const now = new Date();

  if (scope === "custom") {
    if (!fromInput || !toInput) {
      throw new RangeError("A custom range needs both `from` and `to` (YYYY-MM-DD).");
    }
    const from = startOfDay(new Date(fromInput));
    const to = endOfDay(new Date(toInput));
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new RangeError("`from` and `to` must be valid dates (YYYY-MM-DD).");
    }
    if (from > to) {
      throw new RangeError("`from` must not be after `to`.");
    }
    return { from, to, scope, label: `${rangeLabel(from, to)}` };
  }

  switch (scope) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now), scope, label: `Today (${shortDate(now)})` };

    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { from: startOfDay(y), to: endOfDay(y), scope, label: `Yesterday (${shortDate(y)})` };
    }

    case "week": {
      const from = startOfWeek(now);
      const to = endOfDay(now);
      return { from, to, scope, label: `This week (${rangeLabel(from, to)})` };
    }

    case "last-week": {
      const thisWeek = startOfWeek(now);
      const from = new Date(thisWeek);
      from.setDate(from.getDate() - 7);
      const to = endOfDay(new Date(thisWeek.getTime() - 1));
      return { from, to, scope, label: `Last week (${rangeLabel(from, to)})` };
    }

    case "month": {
      const from = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
      const to = endOfDay(now);
      return {
        from,
        to,
        scope,
        label: `${MONTHS[now.getMonth()]} ${now.getFullYear()} to date`,
      };
    }

    case "last-month": {
      const from = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1));
      const to = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
      return {
        from,
        to,
        scope,
        label: `${MONTHS[from.getMonth()]} ${from.getFullYear()}`,
      };
    }

    case "15d": {
      // The SRS's 15-day cadence: the last 15 whole days including today.
      const from = startOfDay(new Date(now.getTime() - 14 * 86_400_000));
      const to = endOfDay(now);
      return { from, to, scope, label: `Last 15 days (${rangeLabel(from, to)})` };
    }

    default:
      throw new RangeError(`Unhandled scope "${scope}".`);
  }
}

/** Every day in the range, for filling gaps in a trend line. */
export function eachDay(range: DateRange): string[] {
  const days: string[] = [];
  const cursor = startOfDay(range.from);
  const last = startOfDay(range.to);
  while (cursor <= last) {
    days.push(
      `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`,
    );
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}
