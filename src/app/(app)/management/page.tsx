import { DayPlaceholder } from "@/components/day-placeholder";

export default function ManagementPage() {
  return (
    <DayPlaceholder
      title="Management Console"
      description="Lead imports, request approvals, agent performance and reporting."
      upcoming={[
        { day: 2, label: "Lead import: upload, column mapping, duplicate detection" },
        { day: 3, label: "Validation summary, error export, import history" },
        { day: 4, label: "Request approval queue with 5-minute auto-assign" },
        { day: 6, label: "KPI dashboard and agent drill-down" },
        { day: 7, label: "Reporting engine" },
      ]}
    />
  );
}
