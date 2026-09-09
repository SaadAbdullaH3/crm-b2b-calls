import ExcelJS from "exceljs";

/**
 * LM-01 — read an uploaded .xlsx into headers + raw row values.
 *
 * Deliberately dumb: this layer does no validation and no mapping. It turns a
 * workbook into `{ headers, rows }` and nothing else, so parsing bugs stay
 * separate from validation bugs.
 */

export const MAX_IMPORT_ROWS = 50_000;

export interface ParsedSheet {
  headers: string[];
  /** One entry per data row, aligned to `headers` by index. */
  rows: unknown[][];
  /** Rows present in the file beyond MAX_IMPORT_ROWS, which were not read. */
  truncated: number;
  sheetName: string;
}

/**
 * Excel cells arrive as strings, numbers, dates, formula results, hyperlinks or
 * rich text. Flatten to something a validator can reason about, without
 * stringifying numbers and dates prematurely — the phone and date coercions
 * downstream want the original type.
 */
function cellValue(cell: ExcelJS.Cell): unknown {
  const v = cell.value;
  if (v === null || v === undefined) return null;

  if (typeof v === "object") {
    // Formula cell: take the computed result, not the formula text.
    if ("result" in v) return (v as ExcelJS.CellFormulaValue).result ?? null;
    // Hyperlink cell: the visible text is what was typed.
    if ("text" in v && "hyperlink" in v) return (v as ExcelJS.CellHyperlinkValue).text ?? null;
    // Rich text: concatenate the runs.
    if ("richText" in v) {
      return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join("");
    }
    if (v instanceof Date) return v;
    if ("error" in v) return null;
  }

  return v;
}

function isBlankRow(values: unknown[]): boolean {
  return values.every(
    (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === ""),
  );
}

export class ImportParseError extends Error {}

/** Parses the first worksheet of an .xlsx buffer. */
export async function parseWorkbook(buffer: Buffer): Promise<ParsedSheet> {
  const workbook = new ExcelJS.Workbook();

  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ImportParseError(
      "That file could not be read as an .xlsx workbook. Re-save it from Excel as .xlsx and try again.",
    );
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new ImportParseError("The workbook contains no worksheets.");

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  // `actualColumnCount` ignores trailing empties; use the header row's own width
  // so a column with a header but no data still appears in the mapper.
  const columnCount = Math.max(headerRow.cellCount, sheet.actualColumnCount ?? 0);

  for (let c = 1; c <= columnCount; c++) {
    const raw = cellValue(headerRow.getCell(c));
    const text = raw === null ? "" : String(raw).trim();
    // Keep positional alignment: an unnamed column still occupies its index.
    headers.push(text || `Column ${c}`);
  }

  if (headers.length === 0) {
    throw new ImportParseError("The first row of the sheet is empty — it must contain column headers.");
  }

  const rows: unknown[][] = [];
  let truncated = 0;

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header

    if (rows.length >= MAX_IMPORT_ROWS) {
      truncated++;
      return;
    }

    const values: unknown[] = [];
    for (let c = 1; c <= columnCount; c++) values.push(cellValue(row.getCell(c)));

    // A spreadsheet exported from another system often carries trailing blank
    // rows; they are not "missing information", they are not rows at all.
    if (isBlankRow(values)) return;

    rows.push(values);
  });

  return { headers, rows, truncated, sheetName: sheet.name };
}
