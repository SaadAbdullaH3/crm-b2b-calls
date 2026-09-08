import { DayPlaceholder } from "@/components/day-placeholder";

export default function HrPage() {
  return (
    <DayPlaceholder
      title="HR"
      description="Employee profiles, documents and leave management."
      upcoming={[
        { day: 5, label: "Employee profile CRUD" },
        { day: 5, label: "Document upload with type/expiry metadata" },
        { day: 5, label: "Leave and holiday records with approval workflow" },
      ]}
    />
  );
}
