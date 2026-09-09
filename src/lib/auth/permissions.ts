/**
 * Permission catalogue and the default role -> permission matrix (SRS §17).
 *
 * This is the SEED baseline, not a hard-coded runtime rule: Admin can re-map
 * permissions to roles at runtime through Dev B's Admin Configuration screens.
 * Route handlers should therefore check permission keys via requirePermission()
 * rather than checking role names, wherever a choice exists.
 */

export interface PermissionDef {
  key: string;
  module: string;
  description: string;
}

export const PERMISSIONS: PermissionDef[] = [
  // --- Leads: import (Dev A, Day 2-3) --------------------------------------
  { key: "leads.import", module: "leads", description: "Upload and import lead files" },
  { key: "leads.import.history", module: "leads", description: "View import history" },

  // --- Leads: read ---------------------------------------------------------
  { key: "leads.read.own", module: "leads", description: "View leads assigned to self" },
  { key: "leads.read.all", module: "leads", description: "View all leads" },
  { key: "leads.timeline", module: "leads", description: "View a lead's full timeline (SF-03)" },
  { key: "leads.assignment.history", module: "leads", description: "View assignment history (SF-04)" },

  // --- Leads: assignment (Dev A, Day 3-4) ----------------------------------
  { key: "leads.request", module: "assignment", description: "Request leads (agent)" },
  { key: "leads.approve", module: "assignment", description: "Approve/reject/modify lead requests" },
  { key: "leads.assign", module: "assignment", description: "Manually assign or reassign leads" },
  { key: "leads.release", module: "assignment", description: "Release leads back to the pool" },

  // --- Calling (Dev A, Day 5-6) --------------------------------------------
  { key: "calls.log", module: "calling", description: "Log calls and save dispositions" },
  { key: "calls.recording.access", module: "calling", description: "Access call recordings" },
  { key: "leads.dnc.override", module: "calling", description: "Override Do-Not-Call protection" },
  { key: "callbacks.manage", module: "calling", description: "Schedule and complete callbacks" },

  // --- Dashboards ----------------------------------------------------------
  { key: "dashboard.agent", module: "dashboard", description: "View the agent dashboard" },
  { key: "dashboard.management", module: "dashboard", description: "View the management console" },

  // --- Monitoring (Dev B) — deliberately NOT granted to agents (TM-05) -----
  { key: "monitoring.view", module: "monitoring", description: "View active/idle/break/productivity metrics" },
  { key: "monitoring.breaks.configure", module: "monitoring", description: "Configure break rules" },

  // --- Reporting (Dev B, Day 7) --------------------------------------------
  { key: "reports.view", module: "reporting", description: "View and generate reports" },
  { key: "reports.export", module: "reporting", description: "Export reports to Excel/PDF" },
  { key: "reports.score.manage", module: "reporting", description: "Enter and approve Management Scores" },

  // --- Communication (Dev B, Day 3) ----------------------------------------
  { key: "comms.message", module: "communication", description: "Send direct messages" },
  { key: "comms.broadcast", module: "communication", description: "Send broadcasts and announcements" },

  // --- HR (Dev B, Day 5) ---------------------------------------------------
  { key: "hr.employees.read", module: "hr", description: "View employee profiles" },
  { key: "hr.employees.manage", module: "hr", description: "Create and edit employee profiles" },
  { key: "hr.documents.manage", module: "hr", description: "Upload and manage HR documents" },
  { key: "hr.leave.request", module: "hr", description: "Submit leave requests" },
  { key: "hr.leave.approve", module: "hr", description: "Approve or reject leave requests" },

  // --- Admin (Dev B, Day 2) ------------------------------------------------
  { key: "admin.users.manage", module: "admin", description: "Create, edit and deactivate users" },
  { key: "admin.roles.manage", module: "admin", description: "Manage roles and the permission matrix" },
  { key: "admin.groups.manage", module: "admin", description: "Create and manage user groups (AD-03)" },
  { key: "admin.fields.manage", module: "admin", description: "Manage dynamic lead fields" },
  { key: "admin.dialer.configure", module: "admin", description: "Configure VC Dialer settings" },
  { key: "admin.settings.manage", module: "admin", description: "Configure shifts, breaks and system settings (AD-07/08/09)" },
  { key: "admin.audit.read", module: "admin", description: "Search the audit log (AU-04)" },
];

export interface RoleDef {
  name: string;
  label: string;
  description: string;
  permissions: string[];
}

const AGENT_PERMISSIONS = [
  "leads.read.own",
  "leads.request",
  "calls.log",
  "callbacks.manage",
  "dashboard.agent",
  "comms.message",
  "hr.leave.request",
  // NOTE: no monitoring.* keys. TM-05 forbids showing Active/Idle/Break/
  // Productivity anywhere in an Agent-role screen.
];

const MANAGEMENT_PERMISSIONS = [
  "leads.import",
  "leads.import.history",
  "leads.read.all",
  "leads.timeline",
  "leads.assignment.history",
  "leads.approve",
  "leads.assign",
  "leads.release",
  "leads.dnc.override",
  "calls.recording.access",
  "dashboard.management",
  "monitoring.view",
  "reports.view",
  "reports.export",
  "reports.score.manage",
  "comms.message",
  "comms.broadcast",
];

const HR_PERMISSIONS = [
  "hr.employees.read",
  "hr.employees.manage",
  "hr.documents.manage",
  "hr.leave.request",
  "hr.leave.approve",
  "comms.message",
  "comms.broadcast",
];

// Admin holds everything: they configure the system itself.
const ADMIN_PERMISSIONS = PERMISSIONS.map((p) => p.key);

export const ROLES: RoleDef[] = [
  {
    name: "agent",
    label: "Agent",
    description: "Calls assigned leads and records outcomes.",
    permissions: AGENT_PERMISSIONS,
  },
  {
    name: "management",
    label: "Management",
    description: "Imports leads, approves requests, monitors performance.",
    permissions: MANAGEMENT_PERMISSIONS,
  },
  {
    name: "admin",
    label: "Admin",
    description: "Configures users, roles, fields and system settings.",
    permissions: ADMIN_PERMISSIONS,
  },
  {
    name: "hr",
    label: "HR",
    description: "Manages employee records, documents and leave.",
    permissions: HR_PERMISSIONS,
  },
];

/** Landing route per role, used after login and by the role guards. */
export const ROLE_HOME: Record<string, string> = {
  agent: "/agent",
  management: "/management",
  admin: "/admin",
  hr: "/hr",
};
