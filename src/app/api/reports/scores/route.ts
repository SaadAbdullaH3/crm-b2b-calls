import { z } from "zod";
import { ScoreStatus } from "@prisma/client";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, badRequest, conflict, parseBody } from "@/lib/api";
import {
  SCORE_MAX,
  SCORE_MIN,
  createScore,
  listScorableAgents,
  listScores,
} from "@/server/reports/scores";

/**
 * RP-03 — Management Scores.
 *
 * Reading a score needs `reports.view`; recording one needs
 * `reports.score.manage`. A manager who may look at the numbers is not
 * automatically someone who may put a number against a person's name.
 */
export const GET = requirePermission("reports.view", async (req) => {
  const url = new URL(req.url);
  const statusRaw = url.searchParams.get("status");
  if (statusRaw && !(statusRaw in ScoreStatus)) {
    return badRequest(`Unknown status "${statusRaw}". Expected DRAFT or APPROVED.`);
  }

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const [scores, agents] = await Promise.all([
    listScores({
      subjectId: url.searchParams.get("subjectId"),
      status: (statusRaw as ScoreStatus | null) ?? null,
      from: from ? new Date(from) : null,
      to: to ? new Date(to) : null,
    }),
    listScorableAgents(),
  ]);

  return ok({
    scores: scores.map((s) => ({
      id: s.id,
      subject: s.subject,
      author: s.author,
      periodStart: s.periodStart.toISOString(),
      periodEnd: s.periodEnd.toISOString(),
      score: s.score,
      notes: s.notes,
      status: s.status,
      version: s.version,
      approvedBy: s.approvedBy,
      approvedAt: s.approvedAt?.toISOString() ?? null,
      changeCount: s._count.events,
      updatedAt: s.updatedAt.toISOString(),
    })),
    agents,
    bounds: { min: SCORE_MIN, max: SCORE_MAX },
  });
});

const CreateSchema = z.object({
  subjectId: z.string().min(1),
  periodStart: z.string().min(8),
  periodEnd: z.string().min(8),
  score: z.number().int().min(SCORE_MIN).max(SCORE_MAX),
  notes: z.string().max(2000).trim().nullable().optional(),
  // Mandatory, and long enough to be a sentence rather than a shrug. A score
  // the subject cannot see a reason for is not reviewable.
  reason: z.string().min(5).max(500).trim(),
});

function startOfDay(value: string): Date {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(value: string): Date {
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
}

export const POST = requirePermission("reports.score.manage", async (req, { user }) => {
  const parsed = await parseBody(req, CreateSchema);
  if (!parsed.success) return parsed.res;

  const periodStart = startOfDay(parsed.data.periodStart);
  const periodEnd = endOfDay(parsed.data.periodEnd);
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    return badRequest("The period must be two valid dates.");
  }

  const outcome = await createScore({
    subjectId: parsed.data.subjectId,
    periodStart,
    periodEnd,
    score: parsed.data.score,
    notes: parsed.data.notes ?? null,
    reason: parsed.data.reason,
    actorId: user.id,
  });

  if (!outcome.ok) {
    if (outcome.code === "CONFLICT") return conflict(outcome.message);
    return badRequest(outcome.message);
  }

  return ok({ score: outcome.value });
});
