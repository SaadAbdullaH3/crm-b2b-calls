/**
 * Socket.io event contract — SHARED BETWEEN DEV A AND DEV B.
 *
 * Both tracks import from this file so event names cannot drift. If you need a
 * new event, add it here first and note it in GLOBAL.md's Cross-Cutting
 * Decisions Log rather than emitting a string literal from a route.
 *
 * Rooms
 *   user:<userId>   every socket belonging to one signed-in user
 *   role:<roleName> every socket whose user holds that role
 */

export const ROOM = {
  user: (userId: string) => `user:${userId}`,
  role: (roleName: string) => `role:${roleName}`,
} as const;

export const EVENTS = {
  // --- Dev A: lead assignment pipeline -------------------------------------
  /** Leads have just been locked to an agent. Sent to that agent + management. */
  LEAD_ASSIGNED: "lead:assigned",
  /** Leads returned to the available pool (logout, release, reassignment). */
  LEAD_RELEASED: "lead:released",
  /** An agent submitted a lead request (Day 3 -> Dev B's approval queue). */
  REQUEST_SUBMITTED: "request:submitted",
  /** Management approved/rejected/modified a request, or the cron auto-assigned. */
  REQUEST_RESOLVED: "request:resolved",
  /** A disposition was saved against a lead. */
  LEAD_DISPOSITIONED: "lead:dispositioned",

  // --- Dev B: comms & monitoring -------------------------------------------
  NOTIFICATION_NEW: "notification:new",
  MESSAGE_NEW: "message:new",
  ANNOUNCEMENT_NEW: "announcement:new",

  // --- session lifecycle (both tracks consume) -----------------------------
  /** A user signed in. Dev B's monitoring engine starts screen time here. */
  SESSION_STARTED: "session:started",
  /** A user signed out or their session expired. Triggers the LA-09 lead return. */
  SESSION_ENDED: "session:ended",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

// --- Payload shapes ---------------------------------------------------------
// Kept deliberately small: identifiers plus what a client needs to decide
// whether to refetch. Never put anything permission-sensitive in a payload
// that is broadcast to a role room.

export interface LeadAssignedPayload {
  agentId: string;
  leadIds: string[];
  requestId?: string;
  method: "REQUEST_APPROVED" | "AUTO_ASSIGN" | "MANUAL" | "REASSIGN";
  at: string;
}

export interface LeadReleasedPayload {
  leadIds: string[];
  previousAgentId: string;
  reason: string;
  at: string;
}

export interface RequestSubmittedPayload {
  requestId: string;
  agentId: string;
  agentName: string;
  quantityRequested: number;
  /** When the 5-minute server-side auto-assign fires if nobody acts. */
  autoAssignAt: string;
  createdAt: string;
}

export interface RequestResolvedPayload {
  requestId: string;
  agentId: string;
  status: string;
  quantityAssigned: number;
  resolvedBy: "MANAGEMENT" | "SYSTEM";
  at: string;
}

export interface NotificationPayload {
  id: string;
  type: string;
  title: string;
  body?: string;
  createdAt: string;
}

export interface SessionLifecyclePayload {
  userId: string;
  sessionId: string;
  at: string;
}
