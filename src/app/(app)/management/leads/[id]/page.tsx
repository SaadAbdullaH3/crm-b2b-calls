import { requirePageRole } from "@/lib/auth/guard";
import { LeadDetail } from "@/components/leads/lead-detail";

export default async function ManagementLeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePageRole(["management", "admin"]);

  return (
    <LeadDetail
      leadId={id}
      canOverrideDnc={user.permissions.includes("leads.dnc.override")}
      canSeeAssignments={user.permissions.includes("leads.assignment.history")}
      backHref="/management/leads"
    />
  );
}
