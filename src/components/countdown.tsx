"use client";

import { useEffect, useState } from "react";

/**
 * Cosmetic countdown to a request's auto-assign deadline.
 *
 * COSMETIC IS THE POINT: the real deadline is `lead_requests.auto_assign_at`
 * and the server-side sweep acts on it. Closing this tab changes nothing.
 *
 * Renders h:mm:ss once the remaining time passes an hour. The default window is
 * 5 minutes, but `assignment.config.autoAssignMinutes` is Admin-configurable —
 * and a plain mm:ss formatter showed a two-hour window as "119:31", which reads
 * as under two minutes.
 */
export function Countdown({ target }: { target: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const ms = new Date(target).getTime() - now;
  if (ms <= 0) return <span className="text-muted-foreground">due</span>;

  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  return (
    <span className="tabular-nums">
      {hours > 0
        ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
        : `${minutes}:${String(seconds).padStart(2, "0")}`}
    </span>
  );
}
