import ExcelJS from "exceljs";

const OUT = process.argv[2] ?? "fixture.xlsx";

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Leads");

// Deliberately messy headers, to exercise the auto-suggestion matcher.
ws.addRow([
  "Company Name",
  "Primary Contact",
  "Phone Number",
  "E-Mail Address",
  "Web Site",
  "City",
  "Notes Column",
]);

const rows = [
  // 1 clean
  ["Acme Corp", "John Smith", "(415) 555-0132", "john@acme.com", "https://www.acme.com/about", "San Francisco", "hot lead"],
  // 2 clean
  ["Globex Inc", "Jane Doe", "212-555-0178", "jane@globex.com", "globex.com", "New York", ""],
  // 3 in-file duplicate of row 1 by phone, written differently
  ["ACME Corporation", "J. Smith", "+1 415 555 0132", "", "", "SF", "dupe by phone"],
  // 4 invalid US phone format (area code starts with 1)
  ["Initech", "Peter Gibbons", "123-45-678", "peter@initech.com", "initech.com", "Austin", "bad phone"],
  // 5 missing phone entirely
  ["Umbrella Ltd", "Alice Wong", "", "alice@umbrella.com", "", "Raccoon City", "no phone"],
  // 6 missing identity (no company, no contact)
  ["", "", "(305) 555-0190", "unknown@example.com", "", "Miami", "who?"],
  // 7 clean, phone as a NUMBER cell (Excel strips formatting)
  ["Soylent Co", "Bill Lumbergh", 3125550142, "bill@soylent.com", "www.soylent.com", "Chicago", "numeric phone"],
  // 8 in-file duplicate of row 2 by company+contact pair
  ["Globex, Inc.", "Jane Doe", "(212) 555-9999", "", "", "New York", "dupe by company+contact"],
  // 9 non-US number: well-formed but not callable by this system
  ["Wayne Enterprises", "Bruce Wayne", "+44 20 7946 0958", "bruce@wayne.co.uk", "wayne.co.uk", "London", "UK number"],
  // 10 same company as row 1 but a different person — must NOT be a duplicate
  ["Acme Corp", "Karen Fields", "(415) 555-0177", "karen@acme.com", "acme.com", "San Francisco", "different person"],
  // 11 bad email format, otherwise fine
  ["Stark Industries", "Tony Stark", "(212) 555-0111", "tony@@stark", "stark.com", "New York", "bad email"],
];

for (const r of rows) ws.addRow(r);

// Trailing blank rows, as exported files often have — must not count as rows.
ws.addRow([]);
ws.addRow([]);

await wb.xlsx.writeFile(OUT);
console.log(`wrote ${OUT} with ${rows.length} data rows`);
