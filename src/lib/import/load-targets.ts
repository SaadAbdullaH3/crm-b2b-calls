import { prisma } from "@/lib/db";
import { FIXED_TARGETS, type MappingTarget } from "@/lib/import/target-fields";

/**
 * The full set of mapping targets: the fixed `leads` columns plus every active
 * Admin-defined dynamic field (AD-05).
 *
 * Reads `lead_field_definitions` through Prisma rather than calling Dev B's
 * `GET /api/admin/fields`, because that route requires `admin.fields.manage`
 * and imports are run by Management, who don't hold it. The contract between
 * the two tracks is the field's `key` — values for these land in
 * `leads.custom_fields` under exactly that key.
 */
export async function loadMappingTargets(): Promise<MappingTarget[]> {
  const custom = await prisma.leadFieldDefinition.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
  });

  const customTargets: MappingTarget[] = custom.map((f) => ({
    key: f.key,
    label: f.label,
    kind: "CUSTOM",
    type: f.type,
    required: f.isRequired,
    // Admin already chose a human label; match on it and on the raw key.
    aliases: [f.label, f.key],
    helpText: f.helpText ?? undefined,
  }));

  return [...FIXED_TARGETS, ...customTargets];
}
