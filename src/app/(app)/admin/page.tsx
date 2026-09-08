import { DayPlaceholder } from "@/components/day-placeholder";

export default function AdminPage() {
  return (
    <DayPlaceholder
      title="Admin Configuration"
      description="Users, roles and permissions, dynamic lead fields, dialer settings."
      upcoming={[
        { day: 2, label: "User CRUD, roles/permissions matrix, groups" },
        { day: 2, label: "Dynamic lead-field builder and dialer settings" },
        { day: 8, label: "Audit log search" },
      ]}
    />
  );
}
