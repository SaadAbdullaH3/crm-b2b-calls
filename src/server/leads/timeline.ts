import { prisma } from "@/lib/db";

/**
 * SF-03 — the chronological history of one lead.
 *
 * Merges every strand the SRS names — imports, assignments, calls,
 * dispositions, notes, callbacks, communications, modifications — into a single
 * ordered list. Each strand is queried separately and merged in memory rather
 * than being one heroic UNION: the sources have genuinely different shapes, and
 * a readable query that runs six small indexed lookups beats an unreadable one
 * that runs a single large scan.
 *
 * NOTE ON "modifications": these come from `audit_log`, which Day 8 fills in.
 * The strand is wired up now and returns nothing until then — so when the audit
 * capture lands, the timeline lights up with no further work here. An empty
 * strand is deliberately not an error.
 */

export type TimelineKind =
  | "IMPORTED"
  | "CREATED"
  | "ASSIGNED"
  | "RELEASED"
  | "CALL"
  | "CALLBACK_SCHEDULED"
  | "CALLBACK_DONE"
  | "CALLBACK_MISSED"
  | "DO_NOT_CALL"
  | "DNC_CLEARED"
  | "MODIFIED";

export interface TimelineEvent {
  at: string;
  kind: TimelineKind;
  title: string;
  detail?: string;
  /** Who did it. Null means the system (a cron sweep, or the importer). */
  actor?: { id: string; fullName: string } | null;
  meta?: Record<string, unknown>;
}

export async function buildLeadTimeline(leadId: string): Promise<{
  lead: {
    id: string;
    companyName: string | null;
    contactName: string | null;
    phoneE164: string | null;
    phoneRaw: string | null;
    email: string | null;
    status: string;
    doNotCall: boolean;
    sourceLabel: string | null;
    assignedTo: { id: string; fullName: string } | null;
  } | null;
  events: TimelineEvent[];
} | null> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      companyName: true,
      contactName: true,
      phoneE164: true,
      phoneRaw: true,
      email: true,
      status: true,
      doNotCall: true,
      doNotCallAt: true,
      sourceLabel: true,
      createdAt: true,
      assignedTo: { select: { id: true, fullName: true } },
      doNotCallBy: { select: { id: true, fullName: true } },
      import: {
        select: { id: true, fileName: true, sourceLabel: true, uploadedBy: { select: { id: true, fullName: true } } },
      },
    },
  });
  if (!lead) return null;

  const [assignments, calls, callbacks, audits] = await Promise.all([
    prisma.leadAssignment.findMany({
      where: { leadId },
      orderBy: { assignedAt: "asc" },
      include: {
        assignedTo: { select: { id: true, fullName: true } },
        assignedBy: { select: { id: true, fullName: true } },
      },
    }),
    prisma.call.findMany({
      where: { leadId },
      orderBy: { createdAt: "asc" },
      include: {
        agent: { select: { id: true, fullName: true } },
        disposition: { select: { code: true, label: true } },
      },
    }),
    prisma.callback.findMany({
      where: { leadId },
      orderBy: { createdAt: "asc" },
      include: { agent: { select: { id: true, fullName: true } } },
    }),
    // Day 8 fills this. Empty today, and that is fine.
    prisma.auditLog.findMany({
      where: { entityType: "lead", entityId: leadId },
      orderBy: { createdAt: "asc" },
      include: { actor: { select: { id: true, fullName: true } } },
    }),
  ]);

  const events: TimelineEvent[] = [];

  // --- origin --------------------------------------------------------------
  if (lead.import) {
    events.push({
      at: lead.createdAt.toISOString(),
      kind: "IMPORTED",
      title: `Imported from ${lead.import.fileName}`,
      detail: lead.import.sourceLabel ? `Source: ${lead.import.sourceLabel}` : undefined,
      actor: lead.import.uploadedBy,
      meta: { importId: lead.import.id },
    });
  } else {
    events.push({
      at: lead.createdAt.toISOString(),
      kind: "CREATED",
      title: "Lead created",
      detail: lead.sourceLabel ? `Source: ${lead.sourceLabel}` : undefined,
      actor: null,
    });
  }

  // --- ownership (SF-04 shares this strand) --------------------------------
  for (const a of assignments) {
    events.push({
      at: a.assignedAt.toISOString(),
      kind: "ASSIGNED",
      title: `Assigned to ${a.assignedTo.fullName}`,
      detail: describeMethod(a.method),
      // No actor means the 5-minute auto-assign job did it, not a person.
      actor: a.assignedBy,
      meta: { assignmentId: a.id, method: a.method, requestId: a.requestId },
    });

    if (a.releasedAt) {
      events.push({
        at: a.releasedAt.toISOString(),
        kind: "RELEASED",
        title: `Released from ${a.assignedTo.fullName}`,
        detail: describeRelease(a.releaseReason),
        actor: null,
        meta: { assignmentId: a.id, reason: a.releaseReason },
      });
    }
  }

  // --- calls, dispositions and their notes ---------------------------------
  for (const c of calls) {
    const outcome = c.disposition?.label ?? "No outcome recorded";
    const bits: string[] = [];
    if (c.durationSec !== null) bits.push(`${formatDuration(c.durationSec)} on the call`);
    bits.push(`placed via ${c.channel.toLowerCase()}`);
    if (c.notes) bits.push(`“${c.notes}”`);

    events.push({
      at: (c.startedAt ?? c.createdAt).toISOString(),
      kind: "CALL",
      title: `Call — ${outcome}`,
      detail: bits.join(" · "),
      actor: c.agent,
      meta: {
        callId: c.id,
        code: c.disposition?.code ?? null,
        durationSec: c.durationSec,
        channel: c.channel,
        recordingRef: c.recordingRef,
      },
    });
  }

  // --- callbacks -----------------------------------------------------------
  for (const cb of callbacks) {
    events.push({
      at: cb.createdAt.toISOString(),
      kind: "CALLBACK_SCHEDULED",
      title: `Callback scheduled for ${cb.scheduledFor.toLocaleString()}`,
      detail: cb.notes ?? undefined,
      actor: cb.agent,
      meta: { callbackId: cb.id },
    });

    if (cb.status === "COMPLETED" && cb.completedAt) {
      events.push({
        at: cb.completedAt.toISOString(),
        kind: "CALLBACK_DONE",
        title: "Callback completed",
        actor: cb.agent,
        meta: { callbackId: cb.id },
      });
    }
    if (cb.status === "MISSED") {
      events.push({
        at: cb.updatedAt.toISOString(),
        kind: "CALLBACK_MISSED",
        title: "Callback missed",
        detail: "More than an hour past the scheduled time.",
        actor: null,
        meta: { callbackId: cb.id },
      });
    }
  }

  // --- Do-Not-Call ---------------------------------------------------------
  if (lead.doNotCall && lead.doNotCallAt) {
    events.push({
      at: lead.doNotCallAt.toISOString(),
      kind: "DO_NOT_CALL",
      title: "Marked Do Not Call",
      detail: "Excluded from assignment and calling until Management restores it.",
      actor: lead.doNotCallBy,
    });
  }

  // --- modifications (Day 8) ----------------------------------------------
  for (const a of audits) {
    events.push({
      at: a.createdAt.toISOString(),
      kind: "MODIFIED",
      title: a.summary ?? a.action,
      detail: describeDiff(a.before, a.after),
      actor: a.actor,
      meta: { auditId: a.id, action: a.action },
    });
  }

  /**
   * Timestamp first, then a fixed rank within the same instant.
   *
   * A transfer writes the release and the new assignment inside one
   * transaction, so both land on the same millisecond; sorting on time alone
   * leaves their order to chance and the timeline can read "assigned to B" then
   * "released from A", which is backwards. The rank makes an identical-second
   * sequence deterministic and causally sensible.
   */
  const RANK: Record<TimelineKind, number> = {
    IMPORTED: 0,
    CREATED: 0,
    ASSIGNED: 1,
    CALL: 2,
    CALLBACK_SCHEDULED: 3,
    CALLBACK_DONE: 4,
    CALLBACK_MISSED: 4,
    DO_NOT_CALL: 5,
    DNC_CLEARED: 5,
    MODIFIED: 6,
    RELEASED: 7,
  };

  events.sort((x, y) => x.at.localeCompare(y.at) || RANK[x.kind] - RANK[y.kind]);

  // Built explicitly rather than destructured-and-discarded: the fields left
  // out (doNotCallAt, doNotCallBy, createdAt, import) are already represented
  // as timeline events, and naming what goes out beats naming what doesn't.
  return {
    lead: {
      id: lead.id,
      companyName: lead.companyName,
      contactName: lead.contactName,
      phoneE164: lead.phoneE164,
      phoneRaw: lead.phoneRaw,
      email: lead.email,
      status: lead.status,
      doNotCall: lead.doNotCall,
      sourceLabel: lead.sourceLabel,
      assignedTo: lead.assignedTo,
    },
    events,
  };
}

function describeMethod(method: string): string {
  switch (method) {
    case "REQUEST_APPROVED":
      return "Management approved the agent's request";
    case "AUTO_ASSIGN":
      return "Auto-assigned — the request reached its 5-minute deadline";
    case "MANUAL":
      return "Assigned directly by Management";
    case "REASSIGN":
      return "Transferred from another agent";
    default:
      return method;
  }
}

function describeRelease(reason: string | null): string {
  switch (reason) {
    case "LOGOUT_RETURN":
      return "Returned to the pool when the agent signed out";
    case "REASSIGNED":
      return "Moved to another agent";
    case "RELEASED_BY_MANAGEMENT":
      return "Returned to the pool by Management";
    case "COMPLETED":
      return "Work finished";
    case "ADMIN_OVERRIDE":
      return "Released by an administrator";
    default:
      return reason ?? "";
  }
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

/** Renders an audit before/after pair as "field: old → new". */
function describeDiff(before: unknown, after: unknown): string | undefined {
  if (!before && !after) return undefined;
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  if (keys.length === 0) return undefined;
  return keys
    .map((k) => `${k}: ${format(b[k])} → ${format(a[k])}`)
    .join(" · ");
}

function format(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}
