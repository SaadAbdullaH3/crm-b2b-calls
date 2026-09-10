import { requirePageAuth } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/rbac";
import { redirect } from "next/navigation";
import { EmployeesClient } from "./employees-client";

/**
 * HR-01/HR-02/HR-06 — employee profiles, documents and history.
 *
 * Reading needs `hr.employees.read` (HR and Management). Documents are gated
 * separately on `hr.documents.manage`, which Management does NOT hold — the
 * documents tab simply isn't offered to them, and the API refuses regardless.
 * That split is HR-07.
 */
export default async function HrEmployeesPage() {
  const user = await requirePageAuth();
  if (!hasPermission(user, "hr.employees.read")) redirect("/403");

  return (
    <EmployeesClient
      canManage={hasPermission(user, "hr.employees.manage")}
      canSeeDocuments={hasPermission(user, "hr.documents.manage")}
    />
  );
}
