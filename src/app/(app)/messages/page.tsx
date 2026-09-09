import { requirePageAuth } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/rbac";
import { MessagesClient } from "./messages-client";

/**
 * CM-01 / CM-02 / CM-04 — messaging, available to every signed-in role.
 *
 * `canBroadcast` only decides whether the composer offers the broadcast tab.
 * The API enforces comms.broadcast independently.
 */
export default async function MessagesPage() {
  const user = await requirePageAuth();
  return (
    <MessagesClient
      currentUserId={user.id}
      canBroadcast={hasPermission(user, "comms.broadcast")}
    />
  );
}
