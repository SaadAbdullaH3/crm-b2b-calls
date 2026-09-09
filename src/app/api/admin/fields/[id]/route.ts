import { z } from "zod";
import { LeadFieldType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, badRequest, notFound, parseBody } from "@/lib/api";

/**
 * AD-05 — edit or retire one dynamic field.
 *
 * `key` and `type` are deliberately NOT editable:
 *   * renaming the key orphans every value already stored under it in
 *     `leads.custom_fields`, silently, with no migration to catch it;
 *   * changing the type leaves stored values in the old shape (a SELECT's
 *     string where a NUMBER is now expected).
 * Retire the field and create a new one instead.
 */

const CHOICE_TYPES: LeadFieldType[] = [LeadFieldType.SELECT, LeadFieldType.MULTISELECT];

const UpdateFieldSchema = z.object({
  label: z.string().min(1).max(80).trim().optional(),
  isRequired: z.boolean().optional(),
  isActive: z.boolean().optional(),
  options: z.array(z.string().min(1).max(120)).optional(),
  helpText: z.string().max(300).trim().nullable().optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export const PATCH = requirePermission(
  "admin.fields.manage",
  async (req, { params }) => {
    const id = params?.id as string;
    const parsed = await parseBody(req, UpdateFieldSchema);
    if (!parsed.success) return parsed.res;
    const { options, helpText, ...rest } = parsed.data;

    const field = await prisma.leadFieldDefinition.findUnique({ where: { id } });
    if (!field) return notFound("No such field.");

    if (options !== undefined) {
      if (!CHOICE_TYPES.includes(field.type)) {
        return badRequest(`Options only apply to SELECT and MULTISELECT fields.`);
      }
      if (options.length === 0) return badRequest("A choice field needs at least one option.");
      if (new Set(options).size !== options.length) return badRequest("Options must be unique.");
    }

    const updated = await prisma.leadFieldDefinition.update({
      where: { id },
      data: {
        ...rest,
        ...(helpText !== undefined ? { helpText: helpText || null } : {}),
        ...(options !== undefined ? { options } : {}),
      },
    });

    return ok({ field: updated });
  },
);

/**
 * Soft delete. Historical leads keep values under this key in
 * `leads.custom_fields`, so a hard delete would leave rows rendering an
 * unlabelled value forever. Deactivating hides it from new imports and forms
 * while keeping old data readable.
 */
export const DELETE = requirePermission(
  "admin.fields.manage",
  async (_req, { params }) => {
    const id = params?.id as string;
    const field = await prisma.leadFieldDefinition.findUnique({ where: { id } });
    if (!field) return notFound("No such field.");

    const updated = await prisma.leadFieldDefinition.update({
      where: { id },
      data: { isActive: false },
    });

    return ok({ field: updated, deactivated: true });
  },
);
