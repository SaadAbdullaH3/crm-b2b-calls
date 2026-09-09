import type { LeadFieldType } from "@prisma/client";

/**
 * LM-02 — the CRM fields a spreadsheet column can be mapped onto.
 *
 * Two sources:
 *   1. FIXED_TARGETS below — real columns on `leads`.
 *   2. Admin-defined dynamic fields (AD-05) from `lead_field_definitions`,
 *      whose values land in `leads.custom_fields` keyed by the field's `key`.
 *
 * On (2): the shared contract is documented as `GET /api/admin/fields`, but that
 * route requires `admin.fields.manage`, which Management does NOT hold — and
 * Management is who runs imports. So the importer reads `lead_field_definitions`
 * directly through Prisma instead of calling Dev B's route over HTTP. Same
 * contract (the `key`), no permission mismatch, no self-HTTP round trip.
 */

export const IGNORE_COLUMN = "__ignore__";

export interface MappingTarget {
  /** Prisma field name for fixed columns; the definition `key` for custom ones. */
  key: string;
  label: string;
  kind: "FIXED" | "CUSTOM";
  type: LeadFieldType | "PHONE_PRIMARY";
  /** Blank values in this field make the row MISSING_INFO. */
  required: boolean;
  /** Lowercased header spellings used to auto-suggest a mapping. */
  aliases: string[];
  helpText?: string;
}

/**
 * `phone` is a pseudo-field: one mapped column produces both `phoneRaw` (what
 * the sheet said) and `phoneE164` (normalised), so the original is preserved
 * for the error report while queries use the canonical form.
 */
export const FIXED_TARGETS: MappingTarget[] = [
  {
    key: "companyName",
    label: "Company Name",
    kind: "FIXED",
    type: "TEXT",
    required: false,
    aliases: ["company", "company name", "companyname", "organisation", "organization", "org", "business", "business name", "account", "account name", "firm", "employer"],
  },
  {
    key: "contactName",
    label: "Contact Name",
    kind: "FIXED",
    type: "TEXT",
    required: false,
    aliases: ["contact", "contact name", "contactname", "name", "full name", "fullname", "person", "lead name", "prospect"],
  },
  {
    key: "jobTitle",
    label: "Job Title",
    kind: "FIXED",
    type: "TEXT",
    required: false,
    aliases: ["title", "job title", "jobtitle", "position", "role", "designation"],
  },
  {
    key: "phone",
    label: "Phone Number",
    kind: "FIXED",
    type: "PHONE_PRIMARY",
    required: true,
    aliases: ["phone", "phone number", "phonenumber", "telephone", "tel", "mobile", "cell", "cell phone", "contact number", "primary phone", "work phone", "business phone"],
    helpText: "Validated for U.S. format only — never checked for reachability.",
  },
  {
    key: "email",
    label: "Email",
    kind: "FIXED",
    type: "EMAIL",
    required: false,
    aliases: ["email", "e-mail", "email address", "emailaddress", "mail", "contact email"],
  },
  {
    key: "website",
    label: "Website",
    kind: "FIXED",
    type: "URL",
    required: false,
    aliases: ["website", "web", "url", "site", "web site", "domain", "web address", "homepage"],
  },
  {
    key: "addressLine",
    label: "Address",
    kind: "FIXED",
    type: "TEXT",
    required: false,
    aliases: ["address", "street", "street address", "address line", "address 1", "address1"],
  },
  {
    key: "city",
    label: "City",
    kind: "FIXED",
    type: "TEXT",
    required: false,
    aliases: ["city", "town", "locality"],
  },
  {
    key: "state",
    label: "State",
    kind: "FIXED",
    type: "TEXT",
    required: false,
    aliases: ["state", "province", "region", "st"],
  },
  {
    key: "postalCode",
    label: "ZIP / Postal Code",
    kind: "FIXED",
    type: "TEXT",
    required: false,
    aliases: ["zip", "zip code", "zipcode", "postal", "postal code", "postcode", "post code"],
  },
];

/** Fields duplicate detection can match on, when they were mapped (LM-04). */
export const DUPLICATE_MATCH_FIELDS = [
  "phone",
  "email",
  "companyName",
  "contactName",
  "website",
] as const;

export type DuplicateMatchField = (typeof DUPLICATE_MATCH_FIELDS)[number];

/** Lowercase, strip punctuation and collapse whitespace, for header matching. */
export function normalizeHeader(header: string): string {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Same, with separators removed entirely, so a header's internal punctuation
 * can't defeat an exact match: "E-Mail Address" and "email address" both become
 * "emailaddress". Without this, "E-Mail Address" normalises to "e mail address",
 * misses the `email` alias, and is then captured by `addressLine` on the
 * containment pass below — mapping every email column onto the street address.
 */
function compactHeader(header: string): string {
  return normalizeHeader(header).replace(/ /g, "");
}

/**
 * Suggests a mapping target for a detected column header. Exact alias match
 * first, then a containment check, so "Primary Contact Email" still finds
 * `email`. Returns IGNORE_COLUMN when nothing looks right — a wrong guess is
 * worse than making Management choose.
 */
export function suggestTarget(header: string, targets: MappingTarget[]): string {
  const normalized = normalizeHeader(header);
  if (!normalized) return IGNORE_COLUMN;

  const compact = compactHeader(header);
  for (const t of targets) {
    if (t.aliases.some((a) => compactHeader(a) === compact)) return t.key;
  }

  // Longest alias first, so "email address" beats "email" on a header that
  // contains both.
  const byLength = targets
    .flatMap((t) => t.aliases.map((a) => ({ key: t.key, alias: normalizeHeader(a) })))
    .sort((a, b) => b.alias.length - a.alias.length);

  for (const { key, alias } of byLength) {
    if (alias.length >= 4 && normalized.includes(alias)) return key;
  }

  return IGNORE_COLUMN;
}
