import { z } from "zod";
import { LeadFieldType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requirePermission } from "@/lib/auth/rbac";
import { ok, badRequest, conflict, parseBody, isUniqueViolation } from "@/lib/api";

/**
 * AD-05 — Admin-defined dynamic lead fields.
 *
 * The definition lives in `lead_field_definitions`; the per-lead value lives in
 * `leads.custom_fields` keyed by `key`. Dev A's import column-mapper reads the
 * active rows here to offer mapping targets beyond the fixed columns on
 * `leads`, so `key` is effectively a public contract between the two tracks.
 */

/**
 * `key` becomes a JSON property name and appears in import mappings and report
 * filters, so it is restricted to a safe identifier and is immutable after
 * creation (see the PATCH handler).
 */
const FIELD_KEY = z
  .string()
  .min(1)
  .max(40)
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "Key must start with a lowercase letter and contain only lowercase letters, digits and underscores.",
  );

/** Reserved: these are real columns on `leads`, not custom fields. */
const RESERVED_KEYS = new Set([
  "id", "company_name", "companyname", "contact_name", "contactname",
  "job_title", "jobtitle", "phone_raw", "phone_e164", "phone", "email",
  "website", "address_line", "city", "state", "postal_code", "status",
  "source_label", "custom_fields", "notes",
]);

const CHOICE_TYPES: LeadFieldType[] = [LeadFieldType.SELECT, LeadFieldType.MULTISELECT];

export const GET = requirePermission("admin.fields.manage", async (req) => {
  // Dev A's mapper only wants live fields; the admin screen wants everything.
  const includeInactive =
    new URL(req.url).searchParams.get("includeInactive") === "true";

  const fields = await prisma.leadFieldDefinition.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    include: { createdBy: { select: { id: true, fullName: true } } },
  });

  return ok({ fields });
});

const CreateFieldSchema = z.object({
  key: FIELD_KEY,
  label: z.string().min(1).max(80).trim(),
  type: z.nativeEnum(LeadFieldType).default(LeadFieldType.TEXT),
  isRequired: z.boolean().default(false),
  options: z.array(z.string().min(1).max(120)).optional(),
  helpText: z.string().max(300).trim().optional().nullable(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
});

export const POST = requirePermission(
  "admin.fields.manage",
  async (req, { user: actor }) => {
    const parsed = await parseBody(req, CreateFieldSchema);
    if (!parsed.success) return parsed.res;
    const { key, type, options, helpText, ...rest } = parsed.data;

    if (RESERVED_KEYS.has(key)) {
      return badRequest(`"${key}" is a built-in lead column. Choose another key.`);
    }

    if (CHOICE_TYPES.includes(type)) {
      if (!options || options.length === 0) {
        return badRequest(`A ${type} field needs at least one option.`);
      }
      if (new Set(options).size !== options.length) {
        return badRequest("Options must be unique.");
      }
    }

    try {
      const field = await prisma.leadFieldDefinition.create({
        data: {
          ...rest,
          key,
          type,
          helpText: helpText || null,
          options: CHOICE_TYPES.includes(type) ? options : undefined,
          createdById: actor.id,
        },
      });
      return ok({ field }, 201);
    } catch (e) {
      if (isUniqueViolation(e)) return conflict(`A field with key "${key}" already exists.`);
      throw e;
    }
  },
);
