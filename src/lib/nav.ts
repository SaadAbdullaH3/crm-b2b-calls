/**
 * Sidebar navigation per role.
 *
 * !! TM-05 BOUNDARY !!
 * The `agent` list must never gain an entry that leads to Active Time, Idle
 * Time, Break/Pause Time or Productivity %. Those are Management-only metrics
 * from Dev B's Monitoring Engine. Setting the boundary here, on Day 1, is what
 * stops it leaking into the Agent Dashboard on Day 6.
 */

export interface NavItem {
  href: string;
  label: string;
  /** Which day of the build plan delivers this screen. */
  day?: number;
}

export const NAV: Record<string, NavItem[]> = {
  agent: [
    { href: "/agent", label: "Dashboard", day: 6 },
    { href: "/agent/call-list", label: "Call List", day: 5 },
    { href: "/agent/callbacks", label: "Callbacks", day: 5 },
    { href: "/agent/request-leads", label: "Request Leads", day: 3 },
    { href: "/messages", label: "Messages", day: 3 },
    { href: "/announcements", label: "Announcements", day: 3 },
    { href: "/leave", label: "My Leave", day: 5 },
    // No monitoring/productivity entries here. See the TM-05 note above.
  ],
  management: [
    { href: "/management", label: "Dashboard", day: 6 },
    { href: "/management/imports", label: "Lead Imports", day: 2 },
    { href: "/management/requests", label: "Lead Requests", day: 4 },
    { href: "/management/leads", label: "All Leads", day: 6 },
    { href: "/management/monitoring", label: "Agent Monitoring", day: 4 },
    { href: "/management/reports", label: "Reports", day: 7 },
    { href: "/management/scores", label: "Management Scores", day: 7 },
    { href: "/messages", label: "Messages", day: 3 },
    { href: "/announcements", label: "Announcements", day: 3 },
  ],
  admin: [
    { href: "/admin", label: "Overview", day: 2 },
    { href: "/admin/users", label: "Users", day: 2 },
    { href: "/admin/roles", label: "Roles & Permissions", day: 2 },
    { href: "/admin/groups", label: "Groups", day: 2 },
    { href: "/admin/fields", label: "Lead Fields", day: 2 },
    { href: "/admin/dialer", label: "Dialer Settings", day: 2 },
    { href: "/admin/settings", label: "Time & Breaks", day: 2 },
    { href: "/admin/audit", label: "Audit Log", day: 8 },
    { href: "/messages", label: "Messages", day: 3 },
    { href: "/announcements", label: "Announcements", day: 3 },
  ],
  hr: [
    { href: "/hr", label: "Overview", day: 5 },
    { href: "/hr/employees", label: "Employees", day: 5 },
    { href: "/hr/holidays", label: "Holidays", day: 5 },
    { href: "/leave", label: "Leave Requests", day: 5 },
    { href: "/messages", label: "Messages", day: 3 },
    { href: "/announcements", label: "Announcements", day: 3 },
  ],
};
