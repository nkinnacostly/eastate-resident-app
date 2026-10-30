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
 * seen, and rejecting their file because the column says "Plot" rather than
 * "house_number" means they go and edit a spreadsheet instead of onboarding
 * an estate. `plot` is what most estates call it; `flat` and `unit` are what a
 * block of flats calls it.
 */
const ALIASES: Record<keyof HouseInput, string[]> = {
  house_number: [
    'housenumber', 'house', 'houseno', 'number', 'no', 'unit', 'unitnumber',
    'address', 'plot', 'plotnumber', 'plotno',
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

/** Which file column feeds each field. null means "not in this file". */
export type ColumnMapping = Record<keyof HouseInput, number | null>;

export interface Detection {
  /** One label per column, for the mapping controls. */
  headers: string[];
  /** Whether row 1 is column names rather than a house. */
  hasHeader: boolean;
  mapping: ColumnMapping;
  /**
   * True when house_number was not matched by name and we fell back to a
   * column by position. Surfaced so the UI can say the choice is a guess
   * rather than presenting it with the same confidence as a real match.
   */
  assumedHouseColumn: boolean;
}

const EMPTY_MAPPING: ColumnMapping = {
  house_number: null, landlord_name: null, landlord_phone: null, landlord_email: null,
};

/**
 * Work out how to read a file — a STARTING POINT, not a verdict.
 *
 * Detection is separate from application on purpose. The admin's file comes
 * from a system we have never seen, so any mapping we infer is a guess, and a
 * guess the person cannot correct is worse than no guess at all: their only
 * recourse would be to go and edit the spreadsheet, which is the work this
 * feature exists to remove. So this proposes, `applyMapping` disposes, and the
 * UI lets the two disagree.
 *
 * HEADERLESS FILES ARE SUPPORTED DELIBERATELY. The likeliest input is a bare
 * column of house numbers pasted out of a levy statement. Requiring a header
 * would mean the commonest file is the one that fails.
 */
export function detectMapping(rows: CsvRow[]): Detection {
  if (rows.length === 0) {
    return { headers: [], hasHeader: false, mapping: { ...EMPTY_MAPPING }, assumedHouseColumn: false };
  }

  // Ragged rows are normal in exported files, so the column count is the
  // widest row rather than the first one.
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  const first = rows[0];
  const matched = Array.from({ length: width }, (_, c) => matchColumn(first[c] ?? ''));
  const hasHeader = matched.some((m) => m !== null);

  const mapping: ColumnMapping = { ...EMPTY_MAPPING };
  let assumedHouseColumn = false;

  if (hasHeader) {
    matched.forEach((field, col) => {
      if (field && mapping[field] === null) mapping[field] = col;
    });

    // A header we only PARTLY understand is the dangerous case. "Ref,Phone"
    // matches on phone, so row 1 is eaten as a header — but nothing maps to
    // house_number, every row is then skipped, and the admin is told their
    // file has no house numbers when it plainly does. The house number is
    // essentially always the leftmost column, so claim the first one nothing
    // else took, and flag that it was a guess.
    if (mapping.house_number === null) {
      const taken = new Set(Object.values(mapping).filter((v): v is number => v !== null));
      for (let col = 0; col < width; col++) {
        if (!taken.has(col)) {
          mapping.house_number = col;
          assumedHouseColumn = true;
          break;
        }
      }
    }
  } else {
    // Positional: number, name, phone, email.
    const order: (keyof HouseInput)[] = [
      'house_number', 'landlord_name', 'landlord_phone', 'landlord_email',
    ];
    order.forEach((field, col) => {
      if (col < width) mapping[field] = col;
    });
  }

  const headers = Array.from({ length: width }, (_, c) =>
    hasHeader ? (first[c] ?? '').trim() || `Column ${c + 1}` : `Column ${c + 1}`,
  );

  return { headers, hasHeader, mapping, assumedHouseColumn };
}

export interface AppliedRows {
  houses: HouseInput[];
  /** Rows dropped for having no house number, by 1-based line in the file. */
  skipped: number[];
}

/**
 * Turn the file into house rows using whatever mapping is in force — ours or
 * the one the admin corrected it to.
 */
export function applyMapping(
  rows: CsvRow[],
  hasHeader: boolean,
  mapping: ColumnMapping,
): AppliedRows {
  const cell = (r: CsvRow, field: keyof HouseInput): string => {
    const col = mapping[field];
    return col === null ? '' : (r[col] ?? '').trim();
  };

  const body = hasHeader ? rows.slice(1) : rows;
  const offset = hasHeader ? 2 : 1; // 1-based file line of body[0]

  const houses: HouseInput[] = [];
  const skipped: number[] = [];

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

  return { houses, skipped };
}

/** Human label for a field, used in the mapping controls and the preview. */
export const FIELD_LABELS: Record<keyof HouseInput, string> = {
  house_number: 'House number',
  landlord_name: 'Landlord name',
  landlord_phone: 'Landlord phone',
  landlord_email: 'Landlord email',
};

export const FIELD_ORDER: (keyof HouseInput)[] = [
  'house_number', 'landlord_name', 'landlord_phone', 'landlord_email',
];
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
