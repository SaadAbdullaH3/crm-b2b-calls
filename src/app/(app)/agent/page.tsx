import { DayPlaceholder } from "@/components/day-placeholder";

// TM-05: this dashboard must never render Active Time, Idle Time, Break/Pause
// Time or Productivity %. Those are Management-only metrics.
export default function AgentPage() {
  return (
    <DayPlaceholder
      title="Agent Dashboard"
      description="Operational stats only — assigned leads, calls, outcomes and callbacks."
      upcoming={[
        { day: 3, label: "Request leads (preset 15/30 + custom quantity)" },
        { day: 5, label: "Call List, dialer handoff / clipboard fallback, dispositions" },
        { day: 5, label: "Callback scheduling and callback view" },
        { day: 6, label: "Dashboard tiles, Do-Not-Call protection, lead timeline" },
      ]}
    />
  );
}
