import { requirePageRole } from "@/lib/auth/guard";
import { LeadDetail } from "@/components/leads/lead-detail";

/**
 * SF-03 for the agent holding the lead. The API refuses any lead not assigned
 * to them, so this page cannot be used to browse.
 *
 * Deliberately no assignment history and no Do-Not-Call override: who else has
 * held a lead is a supervision question, and clearing a DNC needs
 * `leads.dnc.override`, which agents do not hold.
 */
export default async function AgentLeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePageRole(["agent"]);

  return (
    <LeadDetail
      leadId={id}
      canOverrideDnc={false}
      canSeeAssignments={false}
      backHref="/agent/call-list"
    />
  );
}
