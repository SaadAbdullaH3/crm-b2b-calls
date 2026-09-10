"use client";

import { useEffect, useRef } from "react";

/**
 * TM-01/TM-03 — the browser half of the Monitoring Engine.
 *
 * Mounted once in the app shell, so it runs for every signed-in role.
 *
 * It reports two different things and the distinction is the whole point:
 *   * that the tab is open (the beat itself), and
 *   * whether any real input happened since the last beat (`hadActivity`).
 * A page left open on a locked screen keeps beating but reports no activity,
 * so the server still marks it idle. Only the second signal stops TM-03.
 *
 * This component NEVER renders anything and never reads back a metric. It is
 * mounted on Agent screens, and TM-05 forbids exposing active/idle totals
 * there — so the response is deliberately ignored beyond the interval.
 */

/** Events that count as a human being present. */
const ACTIVITY_EVENTS = ["mousedown", "keydown", "wheel", "touchstart", "pointermove"] as const;

export function Heartbeat() {
  const activityRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalMsRef = useRef(30_000);
  const stoppedRef = useRef(false);

  useEffect(() => {
    const markActive = () => {
      activityRef.current = true;
    };

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, markActive, { passive: true });
    }

    // Returning to a backgrounded tab is itself activity.
    const onVisibility = () => {
      if (document.visibilityState === "visible") activityRef.current = true;
    };
    document.addEventListener("visibilitychange", onVisibility);

    async function beat() {
      if (stoppedRef.current) return;

      const hadActivity = activityRef.current;
      activityRef.current = false;

      try {
        const res = await fetch("/api/monitoring/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hadActivity }),
          keepalive: true,
        });

        if (res.status === 401) {
          // Signed out in another tab — stop beating rather than looping on 401.
          stoppedRef.current = true;
          return;
        }

        if (res.ok) {
          const data = await res.json();
          if (typeof data.heartbeatSeconds === "number") {
            // AD-07: Admin can retune the cadence without a deploy.
            intervalMsRef.current = Math.max(5, data.heartbeatSeconds) * 1000;
          }
        }
      } catch {
        // Offline or server restarting. Keep the schedule; the idle sweep is
        // the server-side backstop and does not depend on this succeeding.
      }

      timerRef.current = setTimeout(() => void beat(), intervalMsRef.current);
    }

    timerRef.current = setTimeout(() => void beat(), intervalMsRef.current);

    return () => {
      stoppedRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, markActive);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
