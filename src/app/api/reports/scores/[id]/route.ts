import { z } from "zod";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, badRequest, notFound, conflict, parseBody } from "@/lib/api";
import { SCORE_MAX, SCORE_MIN, getScoreWithHistory, updateScore } from "@/server/reports/scores";

/** RP-03 — one score, with the full change history that makes it auditable. */
export const GET = requirePermission("reports.view", async (_req, { params }) => {
  const id = params?.id as string;
  const score = await getScoreWithHistory(id);
  if (!score) return notFound("No such score.");

  return ok({
    score: {
      id: score.id,
      subject: score.subject,
      author: score.author,
      periodStart: score.periodStart.toISOString(),
      periodEnd: score.periodEnd.toISOString(),
      score: score.score,
      notes: score.notes,
      status: score.status,
      version: score.version,
      approvedBy: score.approvedBy,
      approvedAt: score.approvedAt?.toISOString() ?? null,
      createdAt: score.createdAt.toISOString(),
      updatedAt: score.updatedAt.toISOString(),
    },
    history: score.events.map((e) => ({
      id: e.id,
      type: e.type,
      actor: e.actor.fullName,
      fromScore: e.fromScore,
      toScore: e.toScore,
      reason: e.reason,
      changes: e.changes,
      at: e.createdAt.toISOString(),
    })),
  });
});

const UpdateSchema = z
  .object({
    score: z.number().int().min(SCORE_MIN).max(SCORE_MAX).optional(),
    notes: z.string().max(2000).trim().nullable().optional(),
    reason: z.string().min(5).max(500).trim(),
  })
  .refine((v) => v.score !== undefined || v.notes !== undefined, {
    message: "Change the score, the notes, or both.",
  });

export const PATCH = requirePermission("reports.score.manage", async (req, { params, user }) => {
  const id = params?.id as string;
  const parsed = await parseBody(req, UpdateSchema);
  if (!parsed.success) return parsed.res;

  const outcome = await updateScore({
    id,
    score: parsed.data.score,
    notes: parsed.data.notes,
    reason: parsed.data.reason,
    actorId: user.id,
  });

  if (!outcome.ok) {
    if (outcome.code === "NOT_FOUND") return notFound(outcome.message);
    if (outcome.code === "CONFLICT") return conflict(outcome.message);
    return badRequest(outcome.message);
  }

  return ok({ score: outcome.value });
});
