/**
 * CSV in and out, for the estate roll.
 *
 * Hand-rolled rather than a dependency, because the hard part here is not
 * parsing — it is that the files are exported from Excel, Google Sheets and
 * whatever the estate's levy system is, and each has its own idea of a line
 * ending and a byte order mark. A parser that only handles `split(',')` works
 * on the file you tested with and fails on the one the admin actually has.
 */

/** A parsed row, in file order, with the raw cells. */
export type CsvRow = string[];

/**
 * RFC 4180 with the concessions reality requires.
 *
 * Handles: quoted fields containing commas, escaped quotes (`""`), newlines
 * INSIDE quoted fields, CRLF and LF line endings, and a leading UTF-8 BOM —
 * which Excel writes by default and which otherwise turns the first header
 * into `﻿house` and silently unmatches it.
 */
export function parseCsv(input: string): CsvRow[] {
  // Strip the BOM before anything looks at the first character.
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;

  const rows: CsvRow[] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const c = text[i];

    if (quoted) {
      if (c === '"') {
        // A doubled quote is a literal quote; a lone one closes the field.
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"') {
      quoted = true;
      i++;
      continue;
    }
    if (c === ',') {
      endField();
      i++;
      continue;
    }
    if (c === '\r') {
      // Swallow CRLF as one break rather than emitting an empty row between.
      if (text[i + 1] === '\n') i++;
      endRow();
      i++;
      continue;
    }
    if (c === '\n') {
      endRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }

  // A file not ending in a newline still has a last row.
  if (field.length > 0 || row.length > 0) endRow();

  // Drop rows that are entirely empty. Spreadsheets export trailing blank
  // lines constantly, and each one would otherwise become an "invalid" row in
  // the import report and make a clean file look broken.
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

/** The shape create_houses_bulk expects, one per CSV row. */
export interface HouseInput {
  house_number: string;
  landlord_name?: string;
  landlord_phone?: string;
  landlord_email?: string;
}

/**
 * Column names we accept, lower-cased and stripped of punctuation.
 *
 * Generous on purpose. The admin is exporting from a system we have never
 * seen, and rejecting their file because the column says "Erf" rather than
 * "house_number" means they go and edit a spreadsheet instead of onboarding
 * an estate. `erf` and `stand` are the South African terms for a plot; `unit`
 * is what a complex calls it.
 */
const ALIASES: Record<keyof HouseInput, string[]> = {
  house_number: [
    'housenumber', 'house', 'houseno', 'number', 'no', 'unit', 'unitnumber',
    'stand', 'standnumber', 'erf', 'erfnumber', 'address', 'plot',
    'property', 'propertynumber', 'door', 'doornumber', 'flat', 'apartment',
  ],
  landlord_name: [
    'landlordname', 'landlord', 'owner', 'ownername', 'name', 'fullname',
    'contactperson', 'resident', 'residentname',
  ],
  landlord_phone: [
    'landlordphone', 'phone', 'phonenumber', 'cell', 'cellphone', 'mobile',
    'contact', 'contactnumber', 'tel', 'telephone', 'whatsapp',
  ],
  landlord_email: [
    'landlordemail', 'email', 'emailaddress', 'mail',
  ],
};

const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function matchColumn(header: string): keyof HouseInput | null {
  const n = normalise(header);
  if (!n) return null;
  for (const [field, names] of Object.entries(ALIASES) as [keyof HouseInput, string[]][]) {
    if (names.includes(n)) return field;
  }
  return null;
}

export interface ReadHousesResult {
  houses: HouseInput[];
  /** True when row 1 was consumed as column names rather than data. */
  hadHeader: boolean;
  /** Which CSV column each field was taken from, for the preview. */
  mapping: Partial<Record<keyof HouseInput, string>>;
  /** Rows dropped for having no house number, by 1-based position in the file. */
  skipped: number[];
}

/**
 * Turn a parsed CSV into house rows.
 *
 * HEADERLESS FILES ARE SUPPORTED DELIBERATELY. The likeliest thing an admin
 * has is a bare column of house numbers pasted out of a levy statement, with
 * no header at all. Requiring one would mean the most common input is the one
 * that fails. So: if row 1 contains anything recognisable as a column name it
 * is treated as a header; otherwise the file is read positionally and row 1 is
 * data. Either way the caller previews the result before anything is written.
 */
export function readHouses(rows: CsvRow[]): ReadHousesResult {
  const mapping: Partial<Record<keyof HouseInput, string>> = {};
  const skipped: number[] = [];

  if (rows.length === 0) return { houses: [], hadHeader: false, mapping, skipped };

  const header = rows[0];
  const matched = header.map(matchColumn);
  const hadHeader = matched.some((m) => m !== null);

  // Column index per field. With a header, from the match. Without one, by
  // position: number, name, phone, email.
  const index: Partial<Record<keyof HouseInput, number>> = {};
  if (hadHeader) {
    matched.forEach((field, col) => {
      if (field && index[field] === undefined) {
        index[field] = col;
        mapping[field] = header[col].trim();
      }
    });

    // A header we PARTLY understand is the dangerous case. "Property,Phone"
    // matches on phone, so row 1 is eaten as a header — but nothing maps to
    // house_number, every row is then skipped, and the admin is told their
    // file has no house numbers when it plainly does.
    //
    // The house number is essentially always the first column, so fall back
    // to the leftmost column we did not otherwise claim. The preview is what
    // makes this safe to guess at: a wrong choice is visible before it writes
    // anything.
    if (index.house_number === undefined) {
      const taken = new Set(Object.values(index));
      for (let col = 0; col < header.length; col++) {
        if (!taken.has(col)) {
          index.house_number = col;
          mapping.house_number = `${header[col].trim() || `column ${col + 1}`} (assumed)`;
          break;
        }
      }
    }
  } else {
    const positional: (keyof HouseInput)[] = [
      'house_number', 'landlord_name', 'landlord_phone', 'landlord_email',
    ];
    positional.forEach((field, col) => {
      if (col < header.length) {
        index[field] = col;
        mapping[field] = `column ${col + 1}`;
      }
    });
  }

  const cell = (r: CsvRow, field: keyof HouseInput): string => {
    const col = index[field];
    return col === undefined ? '' : (r[col] ?? '').trim();
  };

  const body = hadHeader ? rows.slice(1) : rows;
  const offset = hadHeader ? 2 : 1; // 1-based file line of body[0]

  const houses: HouseInput[] = [];
  body.forEach((r, n) => {
    const number = cell(r, 'house_number');
    if (!number) {
      skipped.push(n + offset);
      return;
    }
    houses.push({
      house_number: number,
      landlord_name: cell(r, 'landlord_name') || undefined,
      landlord_phone: cell(r, 'landlord_phone') || undefined,
      landlord_email: cell(r, 'landlord_email') || undefined,
    });
  });

  return { houses, hadHeader, mapping, skipped };
}

/**
 * Serialise rows to CSV text.
 *
 * Quotes a field only when it needs it, so a plain export stays readable in a
 * text editor. A leading `=`, `+`, `-` or `@` is prefixed with a quote
 * character: Excel treats those as the start of a formula, so a house
 * legitimately named `-12` would execute rather than display, and a malicious
 * landlord name is a CSV injection straight into whoever opens the export.
 */
export function toCsv(rows: (string | null | undefined)[][]): string {
  const esc = (v: string | null | undefined): string => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // CRLF, because the consumer is Excel more often than not.
  return rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

/**
 * Hand the browser a file.
 *
 * The BOM is written on purpose: without it Excel reads a UTF-8 export as
 * Latin-1 and turns every accented landlord name into mojibake.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoked on the next tick rather than immediately: Safari has not always
  // finished reading the blob when click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `Acacia Park` -> `acacia-park-house-codes.csv` */
export function slugFilename(estate: string, suffix: string): string {
  const slug = estate.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug || 'estate'}-${suffix}.csv`;
}
