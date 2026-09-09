import { z } from "zod";
import { LeadRequestStatus, RequestQuantitySource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAuth, requirePermission } from "@/lib/auth/rbac";
import { ok, badRequest, conflict, parseBody } from "@/lib/api";
import { getSetting } from "@/lib/settings";
import { notifyMany, NOTIFICATION } from "@/lib/notifications";
import { EVENTS, emitToRole } from "@/server/socket";
import type { RequestSubmittedPayload } from "@/lib/realtime/events";

/**
 * LA-02 / LA-03 — an agent asks for more leads.
 *
 * Creating the request is all that happens here. The approval screen is Day 4,
 * and so is the job that assigns leads when nobody acts — but `autoAssignAt` is
 * stamped now, because that column is the only thing the 5-minute sweep will
 * query on. Stamping it at creation means a request survives a server restart:
 * the deadline lives in the database, not in a timer.
 */

const CreateRequestSchema = z.object({
  quantity: z.number().int().positive(),
  source: z.nativeEnum(RequestQuantitySource).optional(),
});

export const GET = requireAuth(async (req, { user }) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status");

  // An agent sees only their own requests; anyone who can approve sees all of
  // them. The permission, not the role name, decides.
  const canSeeAll = user.permissions.includes("leads.approve");
  const mineOnly = url.searchParams.get("scope") === "mine";

  const requests = await prisma.leadRequest.findMany({
    where: {
      ...(canSeeAll && !mineOnly ? {} : { agentId: user.id }),
      ...(status && status in LeadRequestStatus
        ? { status: status as LeadRequestStatus }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      agent: { select: { id: true, fullName: true, email: true } },
      reviewedBy: { select: { id: true, fullName: true } },
    },
  });

  return ok({ requests, canSeeAll });
});

export const POST = requirePermission("leads.request", async (req, { user }) => {
  const parsed = await parseBody(req, CreateRequestSchema);
  if (!parsed.success) return parsed.res;
  const { quantity } = parsed.data;

  const config = await getSetting("assignment.config");

  if (quantity > config.maxRequestQuantity) {
    return badRequest(
      `You can request at most ${config.maxRequestQuantity} leads at a time.`,
    );
  }

  // One open request per agent. Without this an agent can queue five requests
  // while waiting, and the Day 4 auto-assign job would hand them five batches
  // at once — draining the available pool from other agents.
  const existing = await prisma.leadRequest.findFirst({
    where: { agentId: user.id, status: LeadRequestStatus.PENDING },
    select: { id: true, createdAt: true },
  });
  if (existing) {
    return conflict(
      "You already have a lead request waiting for Management. Wait for it to be actioned before requesting more.",
    );
  }

  // The source is derived from the quantity rather than trusted from the
  // client, so the two can never disagree in the record.
  const source = config.presetQuantities.includes(quantity)
    ? quantity === 15
      ? RequestQuantitySource.PRESET_15
      : quantity === 30
        ? RequestQuantitySource.PRESET_30
        : RequestQuantitySource.CUSTOM
    : RequestQuantitySource.CUSTOM;

  const autoAssignAt = new Date(Date.now() + config.autoAssignMinutes * 60_000);

  const request = await prisma.leadRequest.create({
    data: {
      agentId: user.id,
      quantityRequested: quantity,
      quantitySource: source,
      status: LeadRequestStatus.PENDING,
      autoAssignAt,
    },
    include: { agent: { select: { id: true, fullName: true, email: true } } },
  });

  // Tell everyone who can approve. Notification and socket event are both
  // best-effort: a failure here must not lose the request itself.
  const approvers = await prisma.user.findMany({
    where: {
      isActive: true,
      role: { permissions: { some: { permission: { key: "leads.approve" } } } },
    },
    select: { id: true },
  });

  await notifyMany(
    approvers.map((a) => a.id),
    {
      type: NOTIFICATION.LEAD_REQUEST_SUBMITTED,
      title: `${request.agent.fullName} requested ${quantity} leads`,
      body: `Auto-assigns at ${autoAssignAt.toLocaleTimeString()} if not actioned.`,
      payload: { requestId: request.id, agentId: user.id },
    },
  );

  const payload: RequestSubmittedPayload = {
    requestId: request.id,
    agentId: user.id,
    agentName: request.agent.fullName,
    quantityRequested: quantity,
    autoAssignAt: autoAssignAt.toISOString(),
    createdAt: request.createdAt.toISOString(),
  };
  emitToRole("management", EVENTS.REQUEST_SUBMITTED, payload);
  emitToRole("admin", EVENTS.REQUEST_SUBMITTED, payload);

  return ok({ request, autoAssignMinutes: config.autoAssignMinutes }, 201);
});
