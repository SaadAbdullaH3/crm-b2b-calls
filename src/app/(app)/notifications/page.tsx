import { NotificationsClient } from "./notifications-client";

/**
 * SRS §15 — the full notification history.
 *
 * The bell's fallback destination. Notification categories that carry no
 * conversation or announcement id (lead batches, callbacks, DNC warnings,
 * system alerts) land here, so this route must exist for every role.
 */
export default function NotificationsPage() {
  return <NotificationsClient />;
}
