import { z } from "zod";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, badRequest, notFound, conflict, parseBody } from "@/lib/api";
import { approveScore, reopenScore } from "@/server/reports/scores";

/**
 * RP-03 — approve a score, or reopen an approved one.
 *
 * Both carry a mandatory reason and both write an event. Reopening is
 * deliberately a separate act rather than a side effect of editing: approval
 * means nothing if an approved number can change without someone choosing to
 * unfreeze it first.
 */
const DecisionSchema = z.object({
  action: z.enum(["approve", "reopen"]),
  reason: z.string().min(5).max(500).trim(),
});

export const POST = requirePermission("reports.score.manage", async (req, { params, user }) => {
  const id = params?.id as string;
  const parsed = await parseBody(req, DecisionSchema);
  if (!parsed.success) return parsed.res;

  const outcome =
    parsed.data.action === "approve"
      ? await approveScore(id, user.id, parsed.data.reason)
      : await reopenScore(id, user.id, parsed.data.reason);

  if (!outcome.ok) {
    if (outcome.code === "NOT_FOUND") return notFound(outcome.message);
    if (outcome.code === "CONFLICT") return conflict(outcome.message);
    return badRequest(outcome.message);
  }

  return ok({ score: outcome.value });
});
