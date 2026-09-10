import { WorkSessionState } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, notFound } from "@/lib/api";
import { resolveRange, getAgentPerformance } from "@/server/dashboard/metrics";

/**
 * MG-05 / MG-10 — one agent's profile: calls, leads, callbacks, notes,
 * activity, monitoring, attendance and history in a single view.
 *
 * Three separate permission checks live in here, and they are not the same:
 *   * `dashboard.management` to open it at all;
 *   * `monitoring.view` for active/idle/break (TM-05);
 *   * `calls.recording.access` for recording references (CL-05).
 * Rolling them into one would mean the least sensitive gate governing the most
 * sensitive data.
 */
export const GET = requirePermission("dashboard.management", async (req, { user, params }) => {
  const agentId = params?.id as string;
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") ?? "7d";
  const range = resolveRange(scope);

  const canSeeMonitoring = user.permissions.includes("monitoring.view");
  const canSeeRecordings = user.permissions.includes("calls.recording.access");

  const agent = await prisma.user.findFirst({
    where: { id: agentId, role: { name: "agent" } },
    select: {
      id: true,
      fullName: true,
      email: true,
      employeeCode: true,
      phone: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
      role: { select: { name: true, label: true } },
      hrEmployee: {
        select: { department: true, designation: true, shift: true, joinedAt: true },
      },
    },
  });
  if (!agent) return notFound("No such agent.");

  const now = new Date();

  const [performance, calls, leads, callbacks, activity, sessions, requests] =
    await Promise.all([
      getAgentPerformance(range, canSeeMonitoring),

      prisma.call.findMany({
        where: { agentId, createdAt: { gte: range.from, lte: range.to } },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          durationSec: true,
          startedAt: true,
          channel: true,
          notes: true,
          createdAt: true,
          // CL-05: only surfaced to a holder of calls.recording.access. A
          // reference is not the recording itself, but it is the handle that
          // fetches one, so it belongs behind the same gate.
          recordingRef: canSeeRecordings,
          disposition: { select: { code: true, label: true } },
          lead: { select: { id: true, companyName: true, contactName: true } },
        },
      }),

      prisma.lead.findMany({
        where: { assignedToId: agentId },
        orderBy: { lockedAt: "desc" },
        take: 50,
        select: {
          id: true,
          companyName: true,
          contactName: true,
          status: true,
          lastDispositionCode: true,
          lastDispositionAt: true,
          nextCallbackAt: true,
          callAttempts: true,
          doNotCall: true,
          sourceLabel: true,
        },
      }),

      prisma.callback.findMany({
        where: { agentId, status: "SCHEDULED" },
        orderBy: { scheduledFor: "asc" },
        take: 25,
        select: {
          id: true,
          scheduledFor: true,
          notes: true,
          lead: { select: { id: true, companyName: true, contactName: true } },
        },
      }),

      // MG-10 chronological activity feed.
      prisma.activityEvent.findMany({
        where: { userId: agentId, occurredAt: { gte: range.from } },
        orderBy: { occurredAt: "desc" },
        take: 100,
        select: { id: true, type: true, payload: true, occurredAt: true },
      }),

      prisma.workSession.findMany({
        where: { userId: agentId, startedAt: { gte: range.from } },
        orderBy: { startedAt: "desc" },
        take: 30,
        select: {
          id: true,
          startedAt: true,
          endedAt: true,
          state: true,
          // TM-05 gate. `idleCount` and `breakCount` belong INSIDE it: "went
          // idle 40 times today" is a monitoring measurement, not an
          // attendance fact, and leaving them above this line was how they
          // escaped it in the first place.
          idleCount: canSeeMonitoring,
          breakCount: canSeeMonitoring,
          activeMs: canSeeMonitoring,
          idleMs: canSeeMonitoring,
          breakMs: canSeeMonitoring,
        },
      }),

      prisma.leadRequest.findMany({
        where: { agentId },
        orderBy: { createdAt: "desc" },
        take: 15,
        select: {
          id: true,
          quantityRequested: true,
          quantityApproved: true,
          status: true,
          createdAt: true,
          reviewedAt: true,
          reviewedBy: { select: { fullName: true } },
        },
      }),
    ]);

  const stats = performance.find((p) => p.agentId === agentId) ?? null;

  // Attendance for the range, derived from work sessions — the same source
  // HR-04 reads, so the two screens can never disagree.
  //
  // Attendance is login / logout / still-in — facts about whether someone
  // turned up, which `dashboard.management` is enough to see. The idle and
  // break COUNTS are spread in only for a monitoring.view holder: they are
  // derived from the Monitoring Engine and TM-05 reserves that class of
  // measurement for Management, not for anyone who can open this page.
  const attendance = sessions.map((s) => ({
    date: s.startedAt.toISOString().slice(0, 10),
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    stillIn: s.state !== WorkSessionState.ENDED,
    ...(canSeeMonitoring
      ? { idleCount: s.idleCount, breakCount: s.breakCount }
      : {}),
  }));

  return ok({
    agent,
    scope,
    canSeeMonitoring,
    canSeeRecordings,
    stats,
    calls,
    leads,
    callbacks,
    activity,
    attendance,
    sessions: canSeeMonitoring ? sessions : [],
    requests,
    now: now.toISOString(),
  });
});
