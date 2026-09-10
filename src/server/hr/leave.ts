/**
 * HR-05 — leave day computation.
 *
 * "How many days is this request?" is not `endDate - startDate`. A Friday-to-
 * Monday request is two working days, not four, and a week containing a public
 * holiday is four. Getting this wrong doesn't fail loudly — it quietly
 * miscounts everyone's leave balance for a year.
 *
 * The count is computed once, at submission, and STORED on the row. Deriving
 * it at read time would mean that adding a holiday in December silently
 * rewrites how many days someone took in March.
 *
 * Safe to import from the custom server: no `server-only`, no `next/*`.
 */

import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";

/** Midnight UTC for a date, so day arithmetic isn't shifted by a timezone. */
function startOfDayUtc(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function sameMonthDay(a: Date, b: Date): boolean {
  return a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

export interface LeaveDayBreakdown {
  /** Working days actually consumed. */
  days: number;
  /** Calendar days spanned, for display. */
  calendarDays: number;
  weekendDays: number;
  /** Names of holidays that fell inside the range. */
  holidays: string[];
}

/**
 * Counts working days between two dates inclusive, skipping non-working
 * weekdays (from `shift.config.workingDays`) and holidays.
 *
 * A recurring holiday matches on month+day in any year; a one-off matches the
 * exact date.
 */
export async function computeLeaveDays(
  startDate: Date,
  endDate: Date,
): Promise<LeaveDayBreakdown> {
  const start = startOfDayUtc(startDate);
  const end = startOfDayUtc(endDate);

  if (end < start) {
    return { days: 0, calendarDays: 0, weekendDays: 0, holidays: [] };
  }

  const shift = await getSetting("shift.config");
  const workingDays = new Set(shift.workingDays);

  // Pull one-off holidays in range, plus every recurring one (a recurring
  // holiday's stored year is arbitrary, so it can't be range-filtered in SQL).
  const holidayRows = await prisma.holiday.findMany({
    where: {
      OR: [{ date: { gte: start, lte: end } }, { isRecurring: true }],
    },
    select: { name: true, date: true, isRecurring: true },
  });

  const breakdown: LeaveDayBreakdown = {
    days: 0,
    calendarDays: 0,
    weekendDays: 0,
    holidays: [],
  };

  const seenHolidays = new Set<string>();

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    breakdown.calendarDays++;

    if (!workingDays.has(d.getUTCDay())) {
      breakdown.weekendDays++;
      continue;
    }

    const holiday = holidayRows.find((h) =>
      h.isRecurring
        ? sameMonthDay(h.date, d)
        : startOfDayUtc(h.date).getTime() === d.getTime(),
    );

    if (holiday) {
      if (!seenHolidays.has(holiday.name)) {
        seenHolidays.add(holiday.name);
        breakdown.holidays.push(holiday.name);
      }
      continue;
    }

    breakdown.days++;
  }

  return breakdown;
}

/**
 * Approved or pending leave for this user that overlaps the given range.
 *
 * Two overlapping requests for the same person is almost always a mistake —
 * a double-booked absence, or a resubmission of something already approved.
 * The route surfaces this as a conflict rather than silently accepting it.
 */
export async function findOverlappingLeave(
  requesterId: string,
  startDate: Date,
  endDate: Date,
  excludeId?: string,
) {
  return prisma.leaveRequest.findMany({
    where: {
      requesterId,
      id: excludeId ? { not: excludeId } : undefined,
      status: { in: ["PENDING", "APPROVED"] },
      // Overlap test: existing.start <= new.end AND existing.end >= new.start
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
    select: { id: true, startDate: true, endDate: true, status: true, leaveType: true },
  });
}
