import { ImportRowStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { checkUsPhone } from "@/lib/import/phone";
import { IGNORE_COLUMN, type MappingTarget } from "@/lib/import/target-fields";

/**
 * LM-03 / LM-04 / LM-05 — turn mapped spreadsheet rows into validated
 * `lead_import_rows`, without discarding anything.
 *
 * Every row is stored with a verdict. A row that is a duplicate, is missing
 * information, or has an unusable phone number is flagged, never dropped —
 * Management resolves those on Day 3 (LM-06) and the error report on Day 3
 * reads the same rows. Nothing here writes to `leads`.
 */

// --- normalisation ----------------------------------------------------------

export function normalizeText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim().replace(/\s+/g, " ");
}

function lower(v: unknown): string {
  return normalizeText(v).toLowerCase();
}

/**
 * Company names vary by legal suffix and punctuation far more than they vary by
 * identity: "Acme Corp.", "ACME Corporation" and "Acme, Inc" are one company to
 * a human. Strip that noise before comparing.
 */
export function normalizeCompany(v: unknown): string {
  const base = lower(v)
    .replace(/[.,]/g, " ")
    .replace(/\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|gmbh|pvt|private)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return base;
}

/** Compare websites by host, so a path or protocol difference isn't a new lead. */
export function normalizeWebsite(v: unknown): string {
  const raw = lower(v);
  if (!raw) return "";
  const withProtocol = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withProtocol).hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^www\./, "").split("/")[0] ?? "";
  }
}

// Format check only, matching the spirit of LM-05 for phone: shape, not
// deliverability. No MX lookup, no verification call.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export function isEmailFormatValid(v: unknown): boolean {
  return EMAIL_RE.test(normalizeText(v));
}

// --- types ------------------------------------------------------------------

/** Column index (0-based) -> target key, or IGNORE_COLUMN. */
export type ColumnMapping = Record<string, string>;

export interface AnalyzedRow {
  rowNumber: number;
  data: Record<string, unknown>;
  status: ImportRowStatus;
  issues: string[];
  duplicateOfLeadId: string | null;
  duplicateOfRowNumber: number | null;
  duplicateMatchedOn: string[] | null;
}

export interface AnalysisSummary {
  totalRows: number;
  readyRows: number;
  duplicateRows: number;
  missingInfoRows: number;
  invalidPhoneRows: number;
}

interface MatchKeys {
  phoneE164: string;
  email: string;
  website: string;
  company: string;
  contact: string;
}

interface CandidateLead {
  id: string;
  company_name: string | null;
  contact_name: string | null;
  phone_e164: string | null;
  email: string | null;
  website: string | null;
}

// --- row extraction ---------------------------------------------------------

function extractRow(
  values: unknown[],
  mapping: ColumnMapping,
  targetsByKey: Map<string, MappingTarget>,
): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  for (const [indexStr, targetKey] of Object.entries(mapping)) {
    if (targetKey === IGNORE_COLUMN) continue;
    if (!targetsByKey.has(targetKey)) continue;

    const value = values[Number(indexStr)];
    if (value === null || value === undefined) continue;

    // Dates survive as ISO strings so the stored JSON round-trips.
    data[targetKey] = value instanceof Date ? value.toISOString() : value;
  }

  return data;
}

function matchKeysFor(data: Record<string, unknown>): MatchKeys {
  const phone = checkUsPhone(data.phone);
  return {
    phoneE164: phone.ok ? phone.e164 : "",
    email: lower(data.email),
    website: normalizeWebsite(data.website),
    company: normalizeCompany(data.companyName),
    contact: lower(data.contactName),
  };
}

// --- duplicate lookup -------------------------------------------------------

/**
 * One query for the whole file rather than one per row: collect every candidate
 * value first, then fetch matching leads in a single round trip (NF-02).
 *
 * Uses raw SQL because the company/contact comparison is case- and
 * suffix-insensitive, which Prisma's `in` cannot express. Note for Day 9's
 * performance pass: `lower(company_name)` cannot use the plain btree index on
 * `company_name`; add functional indexes if import time becomes a problem on a
 * large existing lead table.
 */
async function fetchCandidates(keys: MatchKeys[]): Promise<CandidateLead[]> {
  const phones = [...new Set(keys.map((k) => k.phoneE164).filter(Boolean))];
  const emails = [...new Set(keys.map((k) => k.email).filter(Boolean))];
  const websites = [...new Set(keys.map((k) => k.website).filter(Boolean))];
  const companies = [...new Set(keys.map((k) => k.company).filter(Boolean))];

  if (!phones.length && !emails.length && !websites.length && !companies.length) {
    return [];
  }

  // ORDER BY is not cosmetic here. Several existing leads can match one row —
  // two contacts sharing a switchboard number, say — and without a defined
  // order the merge target would be whatever Postgres happened to return
  // first, so the same file could merge into a different lead on each run.
  // Oldest-first makes "the original record" the stable tie-break.
  return prisma.$queryRaw<CandidateLead[]>(Prisma.sql`
    SELECT id, company_name, contact_name, phone_e164, email, website
    FROM leads
    WHERE phone_e164 = ANY(${phones})
       OR lower(email) = ANY(${emails})
       OR lower(website) = ANY(${websites})
       OR lower(company_name) = ANY(${companies.length ? companies : [""]})
    ORDER BY created_at ASC, id ASC
  `);
}

/**
 * Picks the BEST match rather than the first one found.
 *
 * A row matching an existing lead on phone + email + company + contact must win
 * over one matching on phone alone. Taking the first match instead sent an
 * exact five-field match to a one-field match that merely sorted earlier — so
 * "update the existing lead" updated the wrong lead, silently.
 *
 * `candidates` must already be in a deterministic order; ties keep the earlier
 * entry, which is the oldest lead (or the earliest row, in-file).
 */
function bestMatch<T>(
  rowKeys: MatchKeys,
  candidates: { ref: T; keys: MatchKeys }[],
): { ref: T; matched: string[] } | null {
  let best: { ref: T; matched: string[] } | null = null;

  for (const candidate of candidates) {
    const matched = matchedFields(rowKeys, candidate.keys);
    if (matched.length === 0) continue;
    if (!best || matched.length > best.matched.length) {
      best = { ref: candidate.ref, matched };
    }
  }

  return best;
}

/**
 * Which mapped fields make two records "the same lead".
 *
 * PERSON-level identifiers — phone and email — are STRONG: sharing one is
 * enough on its own, because a direct line or mailbox belongs to one person.
 *
 * ORGANISATION-level identifiers — company name and website — are WEAK, and
 * only count when the CONTACT NAME matches too. This distinction matters more
 * than it looks: importing eight people at one company is ordinary B2B work,
 * and every one of them shares that company's website and name. Treating the
 * shared website as sufficient flagged "Karen Fields at Acme" as a duplicate of
 * "John Smith at Acme" — suppressing exactly the leads the client paid for.
 *
 * Contact name alone is also insufficient: it would collide every "John Smith"
 * in the country.
 *
 * So: phone OR email OR (company-or-website AND contact name). Where this still
 * guesses wrong, LM-06's "keep both" is Management's escape hatch.
 */
function matchedFields(a: MatchKeys, b: MatchKeys): string[] {
  const matched: string[] = [];

  if (a.phoneE164 && a.phoneE164 === b.phoneE164) matched.push("phone");
  if (a.email && a.email === b.email) matched.push("email");

  const companyMatch = Boolean(a.company) && a.company === b.company;
  const websiteMatch = Boolean(a.website) && a.website === b.website;
  const contactMatch = Boolean(a.contact) && a.contact === b.contact;

  if (contactMatch && (companyMatch || websiteMatch)) {
    matched.push("contactName");
    if (companyMatch) matched.push("companyName");
    if (websiteMatch) matched.push("website");
  }

  return matched;
}

function keysForCandidate(c: CandidateLead): MatchKeys {
  return {
    phoneE164: c.phone_e164 ?? "",
    email: lower(c.email),
    website: normalizeWebsite(c.website),
    company: normalizeCompany(c.company_name),
    contact: lower(c.contact_name),
  };
}

// --- validation -------------------------------------------------------------

function validateRow(
  data: Record<string, unknown>,
  mappedTargets: MappingTarget[],
): { issues: string[]; missingInfo: boolean; invalidPhone: boolean } {
  const issues: string[] = [];
  let missingInfo = false;
  let invalidPhone = false;

  const phoneMapped = mappedTargets.some((t) => t.key === "phone");
  if (phoneMapped) {
    const check = checkUsPhone(data.phone);
    if (!check.ok && check.reason === "MISSING") {
      issues.push("MISSING_PHONE");
      missingInfo = true;
    } else if (!check.ok) {
      issues.push("INVALID_PHONE_FORMAT");
      invalidPhone = true;
    }
  } else {
    // A calling CRM without a number to call cannot work the lead.
    issues.push("PHONE_COLUMN_NOT_MAPPED");
    missingInfo = true;
  }

  // A lead needs something to identify who is being called.
  const hasCompany = Boolean(normalizeText(data.companyName));
  const hasContact = Boolean(normalizeText(data.contactName));
  if (!hasCompany && !hasContact) {
    issues.push("MISSING_IDENTITY");
    missingInfo = true;
  }

  if (normalizeText(data.email) && !isEmailFormatValid(data.email)) {
    issues.push("INVALID_EMAIL_FORMAT");
    // Not fatal and not "missing": recorded so the Day 3 report can show it.
  }

  // Admin-defined fields flagged required in the AD-05 builder.
  for (const t of mappedTargets) {
    if (t.kind !== "CUSTOM" || !t.required) continue;
    if (!normalizeText(data[t.key])) {
      issues.push(`MISSING_REQUIRED_FIELD:${t.key}`);
      missingInfo = true;
    }
  }

  return { issues, missingInfo, invalidPhone };
}

function statusFor(
  isDuplicate: boolean,
  missingInfo: boolean,
  invalidPhone: boolean,
): ImportRowStatus {
  const flags = [isDuplicate, missingInfo, invalidPhone].filter(Boolean).length;
  if (flags === 0) return ImportRowStatus.READY;
  if (flags > 1) return ImportRowStatus.INVALID;
  if (isDuplicate) return ImportRowStatus.DUPLICATE;
  if (missingInfo) return ImportRowStatus.MISSING_INFO;
  return ImportRowStatus.INVALID_PHONE;
}

// --- entry point ------------------------------------------------------------

export interface AnalyzeArgs {
  rows: unknown[][];
  mapping: ColumnMapping;
  targets: MappingTarget[];
}

export async function analyzeRows({
  rows,
  mapping,
  targets,
}: AnalyzeArgs): Promise<{ rows: AnalyzedRow[]; summary: AnalysisSummary }> {
  const targetsByKey = new Map(targets.map((t) => [t.key, t]));

  const mappedKeys = new Set(
    Object.values(mapping).filter((k) => k !== IGNORE_COLUMN && targetsByKey.has(k)),
  );
  const mappedTargets = targets.filter((t) => mappedKeys.has(t.key));

  const extracted = rows.map((values) => extractRow(values, mapping, targetsByKey));
  const keys = extracted.map(matchKeysFor);

  const candidates = await fetchCandidates(keys);
  const candidateKeys = candidates.map((c) => ({ ref: c.id, keys: keysForCandidate(c) }));

  // Earlier rows in the same file are also a duplicate source: importing one
  // sheet twice over shouldn't create two leads. Appended in row order, so
  // bestMatch's tie-break resolves to the earliest matching row.
  const seen: { ref: number; keys: MatchKeys }[] = [];

  const analyzed: AnalyzedRow[] = [];
  const summary: AnalysisSummary = {
    totalRows: rows.length,
    readyRows: 0,
    duplicateRows: 0,
    missingInfoRows: 0,
    invalidPhoneRows: 0,
  };

  for (let i = 0; i < extracted.length; i++) {
    const data = extracted[i]!;
    const rowKeys = keys[i]!;
    const rowNumber = i + 1;

    const { issues, missingInfo, invalidPhone } = validateRow(data, mappedTargets);

    let duplicateOfLeadId: string | null = null;
    let duplicateOfRowNumber: number | null = null;
    let duplicateMatchedOn: string[] | null = null;

    const existingMatch = bestMatch(rowKeys, candidateKeys);
    if (existingMatch) {
      duplicateOfLeadId = existingMatch.ref;
      duplicateMatchedOn = existingMatch.matched;
      issues.push("DUPLICATE_OF_EXISTING_LEAD");
    } else {
      const fileMatch = bestMatch(rowKeys, seen);
      if (fileMatch) {
        duplicateOfRowNumber = fileMatch.ref;
        duplicateMatchedOn = fileMatch.matched;
        issues.push("DUPLICATE_IN_FILE");
      }
    }

    seen.push({ ref: rowNumber, keys: rowKeys });

    const isDuplicate = Boolean(duplicateOfLeadId || duplicateOfRowNumber);
    const status = statusFor(isDuplicate, missingInfo, invalidPhone);

    if (status === ImportRowStatus.READY) summary.readyRows++;
    if (isDuplicate) summary.duplicateRows++;
    if (missingInfo) summary.missingInfoRows++;
    if (invalidPhone) summary.invalidPhoneRows++;

    analyzed.push({
      rowNumber,
      data,
      status,
      issues,
      duplicateOfLeadId,
      duplicateOfRowNumber,
      duplicateMatchedOn,
    });
  }

  return { rows: analyzed, summary };
}
