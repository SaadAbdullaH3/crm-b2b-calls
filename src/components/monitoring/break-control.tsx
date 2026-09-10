"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Coffee } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * TM-04 — the agent's own break control, in the app shell.
 *
 * !! TM-05 BOUNDARY !!
 * This renders on Agent screens, so it must show NO accumulated metric.
 * Specifically absent, and deliberately so:
 *   * total break time today  (TM-05 names "Break/Pause Time")
 *   * active time, idle time, productivity %
 *
 * What it does show is the elapsed time of the break the agent is currently
 * taking — which is a clock they can already read — and the configured
 * single-break limit, which is a RULE Management set rather than a
 * measurement of this person. Anything beyond that belongs on
 * /management/monitoring, behind `monitoring.view`.
 */

interface MeState {
  onBreak: boolean;
  breakStartedAt: string | null;
  maxSingleBreakMinutes: number;
}

function elapsed(fromIso: string, now: number): string {
  const ms = Math.max(0, now - new Date(fromIso).getTime());
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function BreakControl() {
  const [state, setState] = useState<MeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/monitoring/me");
      if (!res.ok) return;
      setState(await res.json());
    } catch {
      // Non-critical chrome; a failed poll just leaves the button as it was.
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Only tick while a break is actually running.
  useEffect(() => {
    if (!state?.onBreak) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [state?.onBreak]);

  async function toggle() {
    setBusy(true);
    const action = state?.onBreak ? "end" : "start";
    try {
      const res = await fetch("/api/monitoring/break", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.message ?? "Could not change break state.");
        return;
      }
      toast.success(action === "start" ? "On break." : "Welcome back.");
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  const over =
    state.onBreak &&
    state.breakStartedAt &&
    now - new Date(state.breakStartedAt).getTime() > state.maxSingleBreakMinutes * 60_000;

  return (
    <div className="space-y-1.5">
      <Button
        variant={state.onBreak ? "default" : "outline"}
        size="sm"
        className="w-full justify-start"
        onClick={() => void toggle()}
        disabled={busy}
      >
        <Coffee className="mr-2 size-3.5" />
        {state.onBreak
          ? `On break · ${state.breakStartedAt ? elapsed(state.breakStartedAt, now) : ""}`
          : "Take a break"}
      </Button>

      {over ? (
        <p className="px-1 text-[11px] text-destructive">
          Over the {state.maxSingleBreakMinutes}-minute limit for one break.
        </p>
      ) : null}
    </div>
  );
}
