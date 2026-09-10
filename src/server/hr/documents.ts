/**
 * HR-02/HR-03/HR-07 — employee document storage.
 *
 * HR documents are the most sensitive data in this system: warning letters,
 * performance reviews, ID proofs. Three rules follow from that, and all three
 * are enforced here rather than being left to each route:
 *
 *  1. **The uploaded filename never touches the filesystem.** Files are stored
 *     as `<document id>.<ext>` under /uploads/hr. A client-supplied name is an
 *     attacker-supplied path: "../../.env" and a 300-character Unicode name are
 *     both the caller's choice, and neither should be. The original name is
 *     kept in the database and reattached at download time.
 *  2. **Extension allowlist, not a blocklist.** A blocklist is a promise to
 *     have thought of every dangerous extension.
 *  3. **Nothing is served statically.** /uploads is outside the Next public
 *     tree, and every read goes through a route that checks permission first.
 *     A guessable static URL would make HR-07 decorative.
 *
 * Deletion is deliberately absent from this module: HR documents are retained,
 * not removed. See the route for the reasoning.
 */

import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import path from "node:path";

/** Same 10 MB ceiling Dev A used for import files. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

const UPLOAD_DIR = path.join(process.cwd(), "uploads", "hr");

/**
 * Allowlist of extension -> MIME type.
 *
 * Documents and images only. Deliberately excluded: anything executable or
 * script-like, and archives — a .zip is an unopenable black box to whoever
 * has to review the file later, and a decompression bomb to whatever opens it.
 */
const ALLOWED: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".txt": "text/plain",
};

export const ALLOWED_EXTENSIONS = Object.keys(ALLOWED);

export interface ValidationFailure {
  ok: false;
  error: string;
}
export interface ValidationSuccess {
  ok: true;
  ext: string;
  mimeType: string;
  /** The original name, sanitised for DISPLAY only — never used as a path. */
  displayName: string;
}

/**
 * Validates an uploaded file before anything touches disk.
 *
 * Note what this does NOT claim: the extension is trusted for storage and
 * download naming, not as proof of content. A .pdf holding something else is
 * still stored — but because it is only ever returned as an attachment, with
 * a fixed Content-Type and never executed, that is a data-quality problem
 * rather than a security one.
 */
export function validateUpload(file: File): ValidationSuccess | ValidationFailure {
  if (file.size === 0) return { ok: false, error: "That file is empty." };

  if (file.size > MAX_DOCUMENT_BYTES) {
    return {
      ok: false,
      error: `That file is larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB.`,
    };
  }

  // basename() first: a name like "../../etc/passwd.pdf" must not reach extname
  // with its path intact.
  const base = path.basename(file.name ?? "");
  const ext = path.extname(base).toLowerCase();

  if (!ext || !(ext in ALLOWED)) {
    return {
      ok: false,
      error: `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(", ")}.`,
    };
  }

  // Strip anything that could confuse a Content-Disposition header or a
  // filesystem, and cap the length. Display only — the stored path ignores it.
  const displayName =
    base
      .replace(/[\r\n"\\]/g, "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .slice(0, 200) || `document${ext}`;

  return { ok: true, ext, mimeType: ALLOWED[ext], displayName };
}

/**
 * Writes the file under a name derived ONLY from the document id.
 *
 * Returns the absolute path to store on the row. Caller creates the database
 * record first so the id exists.
 */
export async function storeDocument(
  documentId: string,
  ext: string,
  buffer: Buffer,
): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true });
  const storedPath = path.join(UPLOAD_DIR, `${documentId}${ext}`);
  await writeFile(storedPath, buffer);
  return storedPath;
}

/**
 * Reads a stored document back.
 *
 * Re-checks that the resolved path is inside UPLOAD_DIR before reading. The
 * path comes from our own database rather than from a request, so this is
 * belt-and-braces — but a stored path is exactly the kind of value that a
 * future bug, or a restored-from-elsewhere backup, could make untrustworthy,
 * and the check costs nothing.
 */
export async function readDocument(storedPath: string): Promise<Buffer | null> {
  const resolved = path.resolve(storedPath);
  const root = path.resolve(UPLOAD_DIR);

  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    console.error("[hr] refused to read a document outside the upload root", storedPath);
    return null;
  }

  try {
    await stat(resolved);
    return await readFile(resolved);
  } catch {
    return null;
  }
}

/** MIME type for a stored extension, defaulting to a safe binary type. */
export function mimeForPath(storedPath: string): string {
  return ALLOWED[path.extname(storedPath).toLowerCase()] ?? "application/octet-stream";
}
