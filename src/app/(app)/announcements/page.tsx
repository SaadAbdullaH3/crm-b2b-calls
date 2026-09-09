import { requirePageAuth } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/rbac";
import { AnnouncementsClient } from "./announcements-client";

/** CM-06 — announcements, readable by every role; publishing needs comms.broadcast. */
export default async function AnnouncementsPage() {
  const user = await requirePageAuth();
  return <AnnouncementsClient canPublish={hasPermission(user, "comms.broadcast")} />;
}
