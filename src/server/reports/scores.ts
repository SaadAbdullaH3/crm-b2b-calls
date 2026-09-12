import { Prisma, ScoreEventType, ScoreStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { REPORTABLE_AGENT_WHERE } from "@/server/reports/definitions";

/**
 * RP-03 — the Management Score.
 *
 * "Editable with an audit trail" is the requirement, and the trail is the hard
 * half: an overwrite with no history satisfies "editable" and fails the clause.
 * So every state change here writes TWO rows in one transaction — the new state
 * of `management_scores`, and an append-only `management_score_events` row
 * carrying who, when, from what, to what, and WHY. Nothing in this module
 * updates or deletes an event. A correction is another event, the way a ledger
 * is corrected — the same rule as the HR employment history on Day 5.
 *
 * LIFECYCLE: DRAFT -> APPROVED -> (reopen) -> DRAFT -> ...
 * An approved score cannot be edited in place. Approval means nothing if the
 * number can change afterwards without anyone deciding to change it, so
 * reopening is an explicit act that carries its own reason and its own event.
 */

export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

export type ScoreOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; code: "NOT_FOUND" | "CONFLICT" | "INVALID"; message: string; scoreId?: string };

const scoreInclude = {
  subject: { select: { id: true, fullName: true, email: true } },
  author: { select: { id: true, fullName: true } },
  approvedBy: { select: { id: true, fullName: true } },
} satisfies Prisma.ManagementScoreInclude;

export type ScoreWithPeople = Prisma.ManagementScoreGetPayload<{ include: typeof scoreInclude }>;

/** The subject must be someone whose work these reports describe. */
async function assertScorableSubject(subjectId: string): Promise<boolean> {
  const user = await prisma.user.findFirst({
    where: { id: subjectId, ...REPORTABLE_AGENT_WHERE },
    select: { id: true },
  });
  return user !== null;
}

export interface CreateScoreInput {
  subjectId: string;
  periodStart: Date;
  periodEnd: Date;
  score: number;
  notes?: string | null;
  reason: string;
  actorId: string;
}

export async function createScore(input: CreateScoreInput): Promise<ScoreOutcome<ScoreWithPeople>> {
  if (input.score < SCORE_MIN || input.score > SCORE_MAX) {
    return {
      ok: false,
      code: "INVALID",
      message: `Score must be between ${SCORE_MIN} and ${SCORE_MAX}.`,
    };
  }
  if (input.periodStart > input.periodEnd) {
    return { ok: false, code: "INVALID", message: "The period start must not be after its end." };
  }
  if (!(await assertScorableSubject(input.subjectId))) {
    return {
      ok: false,
      code: "INVALID",
      message: "Scores can only be recorded for agents whose work these reports cover.",
    };
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const score = await tx.managementScore.create({
        data: {
          subjectId: input.subjectId,
          authorId: input.actorId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          score: input.score,
          notes: input.notes ?? null,
        },
        include: scoreInclude,
      });

      await tx.managementScoreEvent.create({
        data: {
          scoreId: score.id,
          actorId: input.actorId,
          type: ScoreEventType.CREATED,
          toScore: score.score,
          reason: input.reason,
          changes: { notes: { from: null, to: score.notes } },
        },
      });

      return score;
    });

    return { ok: true, value: created };
  } catch (e) {
    // The unique index is the guarantee, not the lookup: two managers scoring
    // the same person for the same period at the same moment must not produce
    // two answers to one question. Re-read and point the caller at the winner.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existing = await prisma.managementScore.findFirst({
        where: {
          subjectId: input.subjectId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
        },
        select: { id: true },
      });
      return {
        ok: false,
        code: "CONFLICT",
        message: "This agent already has a score for that period. Edit the existing one instead.",
        scoreId: existing?.id,
      };
    }
    throw e;
  }
}

export interface UpdateScoreInput {
  id: string;
  score?: number;
  notes?: string | null;
  reason: string;
  actorId: string;
}

export async function updateScore(input: UpdateScoreInput): Promise<ScoreOutcome<ScoreWithPeople>> {
  if (input.score !== undefined && (input.score < SCORE_MIN || input.score > SCORE_MAX)) {
    return {
      ok: false,
      code: "INVALID",
      message: `Score must be between ${SCORE_MIN} and ${SCORE_MAX}.`,
    };
  }

  const current = await prisma.managementScore.findUnique({
    where: { id: input.id },
    select: { id: true, score: true, notes: true, status: true },
  });
  if (!current) return { ok: false, code: "NOT_FOUND", message: "Score not found." };
  if (current.status === ScoreStatus.APPROVED) {
    return {
      ok: false,
      code: "CONFLICT",
      message: "This score is approved. Reopen it before changing it.",
    };
  }

  const nextScore = input.score ?? current.score;
  const nextNotes = input.notes === undefined ? current.notes : input.notes;
  if (nextScore === current.score && nextNotes === current.notes) {
    return { ok: false, code: "INVALID", message: "Nothing changed." };
  }

  const updated = await prisma.$transaction(async (tx) => {
    // Conditional on the status we read, so an approval landing between the
    // read and the write cannot be silently overwritten.
    const claimed = await tx.managementScore.updateMany({
      where: { id: input.id, status: ScoreStatus.DRAFT },
      data: { score: nextScore, notes: nextNotes, version: { increment: 1 } },
    });
    if (claimed.count !== 1) return null;

    await tx.managementScoreEvent.create({
      data: {
        scoreId: input.id,
        actorId: input.actorId,
        type: ScoreEventType.UPDATED,
        fromScore: current.score,
        toScore: nextScore,
        reason: input.reason,
        changes:
          nextNotes === current.notes ? Prisma.DbNull : { notes: { from: current.notes, to: nextNotes } },
      },
    });

    return tx.managementScore.findUniqueOrThrow({
      where: { id: input.id },
      include: scoreInclude,
    });
  });

  if (!updated) {
    return {
      ok: false,
      code: "CONFLICT",
      message: "This score was approved while you were editing it. Reload and reopen it to change it.",
    };
  }
  return { ok: true, value: updated };
}

export async function approveScore(
  id: string,
  actorId: string,
  reason: string,
): Promise<ScoreOutcome<ScoreWithPeople>> {
  const approved = await prisma.$transaction(async (tx) => {
    const claimed = await tx.managementScore.updateMany({
      where: { id, status: ScoreStatus.DRAFT },
      data: { status: ScoreStatus.APPROVED, approvedById: actorId, approvedAt: new Date() },
    });
    if (claimed.count !== 1) return null;

    const score = await tx.managementScore.findUniqueOrThrow({
      where: { id },
      include: scoreInclude,
    });

    await tx.managementScoreEvent.create({
      data: {
        scoreId: id,
        actorId,
        type: ScoreEventType.APPROVED,
        toScore: score.score,
        reason,
      },
    });

    return score;
  });

  if (!approved) {
    const exists = await prisma.managementScore.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!exists) return { ok: false, code: "NOT_FOUND", message: "Score not found." };
    return { ok: false, code: "CONFLICT", message: "This score has already been approved." };
  }
  return { ok: true, value: approved };
}

export async function reopenScore(
  id: string,
  actorId: string,
  reason: string,
): Promise<ScoreOutcome<ScoreWithPeople>> {
  const reopened = await prisma.$transaction(async (tx) => {
    const claimed = await tx.managementScore.updateMany({
      where: { id, status: ScoreStatus.APPROVED },
      data: { status: ScoreStatus.DRAFT, approvedById: null, approvedAt: null },
    });
    if (claimed.count !== 1) return null;

    const score = await tx.managementScore.findUniqueOrThrow({
      where: { id },
      include: scoreInclude,
    });

    await tx.managementScoreEvent.create({
      data: {
        scoreId: id,
        actorId,
        type: ScoreEventType.REOPENED,
        toScore: score.score,
        reason,
      },
    });

    return score;
  });

  if (!reopened) {
    const exists = await prisma.managementScore.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!exists) return { ok: false, code: "NOT_FOUND", message: "Score not found." };
    return { ok: false, code: "CONFLICT", message: "This score is not approved, so there is nothing to reopen." };
  }
  return { ok: true, value: reopened };
}

export interface ScoreFilter {
  subjectId?: string | null;
  from?: Date | null;
  to?: Date | null;
  status?: ScoreStatus | null;
}

export async function listScores(filter: ScoreFilter = {}) {
  return prisma.managementScore.findMany({
    where: {
      ...(filter.subjectId ? { subjectId: filter.subjectId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.from ? { periodEnd: { gte: filter.from } } : {}),
      ...(filter.to ? { periodStart: { lte: filter.to } } : {}),
    },
    include: { ...scoreInclude, _count: { select: { events: true } } },
    orderBy: [{ periodStart: "desc" }, { subject: { fullName: "asc" } }],
  });
}

/** One score with its full, ordered history — the RP-03 audit trail itself. */
export async function getScoreWithHistory(id: string) {
  return prisma.managementScore.findUnique({
    where: { id },
    include: {
      ...scoreInclude,
      events: {
        orderBy: { createdAt: "asc" },
        include: { actor: { select: { id: true, fullName: true } } },
      },
    },
  });
}

/** Agents a score may be recorded against, for the picker. */
export async function listScorableAgents() {
  return prisma.user.findMany({
    where: { ...REPORTABLE_AGENT_WHERE, isActive: true },
    select: { id: true, fullName: true, email: true },
    orderBy: { fullName: "asc" },
  });
}
