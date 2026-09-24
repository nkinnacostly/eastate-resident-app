import { useMemo, useRef, useState } from 'react';

import { importHouses, type HouseRow, type ImportedHouse } from '../lib/api';
import {
  applyMapping, detectMapping, downloadCsv, parseCsv, slugFilename, toCsv,
  FIELD_LABELS, FIELD_ORDER,
  type ColumnMapping, type CsvRow, type HouseInput,
} from '../lib/csv';
import { Button, Card, Empty } from './ui';

const select =
  'mt-1.5 h-10 w-full rounded-[12px] bg-white px-3 text-[12.5px] font-semibold text-ink outline-none focus:ring-2 focus:ring-lime';
const fieldLabel = 'text-[10.5px] font-extrabold tracking-label text-muted';

/**
 * Import an estate roll, and get the house codes back out.
 *
 * WHY THE EXPORT IS THE IMPORTANT HALF
 *
 * Creating the houses is the obvious feature and the smaller one. Every house
 * gets a server-generated 4-glyph code, and the admin then has to deliver code
 * H4K2 to house 14 SPECIFICALLY — a resident joins with the estate code plus
 * their own house code, so a code sent to the wrong house puts somebody in the
 * wrong home. Without a file to mail-merge from, the admin reads three hundred
 * codes off a screen one at a time.
 *
 * WHY THE MAPPING IS EDITABLE AND NOT JUST SHOWN
 *
 * We guess which column is which, and the guess is good — it knows `Erf`,
 * `Stand`, `Unit`, and reads a bare headerless list. But it is still a guess
 * about a file exported from a system we have never seen, and a guess the
 * admin cannot correct is worse than no guess: their only recourse would be to
 * go and edit the spreadsheet, which is precisely the work this feature exists
 * to remove. So every column we picked is a dropdown, including whether row 1
 * is a header at all, and the preview re-renders as they change it.
 *
 * Getting that wrong is expensive in a specific way: hundreds of junk houses
 * that then have to be found and deactivated one at a time. Nothing is written
 * until they press the button.
 */
export function HouseImport({
  estateId,
  estateName,
  houses,
  onDone,
}: {
  estateId: string;
  estateName: string;
  /** The current roll, for the standalone export. */
  houses: HouseRow[];
  onDone: () => Promise<void> | void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const [rows, setRows] = useState<CsvRow[] | null>(null);
  const [filename, setFilename] = useState('');
  const [hasHeader, setHasHeader] = useState(true);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [assumed, setAssumed] = useState(false);

  const [result, setResult] = useState<ImportedHouse[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setRows(null);
    setMapping(null);
    setResult(null);
    setFilename('');
    setError(null);
    setAssumed(false);
    if (fileRef.current) fileRef.current.value = '';
  };

  const pick = async (file: File) => {
    setError(null);
    setResult(null);
    try {
      const parsed = parseCsv(await file.text());
      if (parsed.length === 0) {
        setError('That file has no rows in it.');
        return;
      }
      const d = detectMapping(parsed);
      setRows(parsed);
      setFilename(file.name);
      setHasHeader(d.hasHeader);
      setMapping(d.mapping);
      setAssumed(d.assumedHouseColumn);
    } catch (e) {
      setError(`Could not read that file: ${(e as Error).message}`);
    }
  };

  // Re-derived on every change to the controls, so the table below always
  // shows what pressing Import would actually create.
  const applied = useMemo(
    () => (rows && mapping ? applyMapping(rows, hasHeader, mapping) : null),
    [rows, hasHeader, mapping],
  );

  /**
   * Column labels, recomputed from the header toggle rather than frozen at
   * detection. Unticking "first row is column names" turns row 1 into a house,
   * so a dropdown still offering "House Number" as a column name would be
   * naming the option after a value that is now data.
   */
  const labels = useMemo(() => {
    if (!rows) return [];
    const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
    return Array.from({ length: width }, (_, c) =>
      hasHeader ? (rows[0]?.[c] ?? '').trim() || `Column ${c + 1}` : `Column ${c + 1}`,
    );
  }, [rows, hasHeader]);

  const setColumn = (field: keyof HouseInput, col: number | null) => {
    setAssumed(false); // they have looked at it; it is no longer our guess
    setMapping((m) => (m ? { ...m, [field]: col } : m));
  };

  const run = async () => {
    if (!applied || applied.houses.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await importHouses(estateId, applied.houses));
      setRows(null);
      setMapping(null);
      if (fileRef.current) fileRef.current.value = '';
      await onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  /** Codes for every house on the roll, whether or not it came from an import. */
  const exportAll = () => {
    downloadCsv(
      slugFilename(estateName, 'house-codes'),
      toCsv([
        ['house_number', 'house_code', 'landlord_name', 'landlord_phone', 'residents'],
        ...houses.map((h) => [
          h.house_number, h.house_code, h.landlord_name, h.landlord_phone, String(h.residents),
        ]),
      ]),
    );
  };

  /** Just this import's rows — what to hand out after adding a block of houses. */
  const exportResult = (list: ImportedHouse[]) => {
    downloadCsv(
      slugFilename(estateName, 'imported-house-codes'),
      toCsv([
        ['house_number', 'house_code', 'status'],
        ...list.filter((r) => r.house_code).map((r) => [r.house_number, r.house_code, r.status]),
      ]),
    );
  };

  const counts = result
    ? {
        created: result.filter((r) => r.status === 'created').length,
        duplicate: result.filter((r) => r.status === 'duplicate').length,
        invalid: result.filter((r) => r.status === 'invalid').length,
        failed: result.filter((r) => r.status === 'failed').length,
      }
    : null;

  /** A sample value from the first data row, so a bare "Column 3" is choosable. */
  const sampleFor = (col: number): string => {
    if (!rows) return '';
    const body = hasHeader ? rows.slice(1) : rows;
    const v = (body[0]?.[col] ?? '').trim();
    return v ? ` — ${v.length > 18 ? `${v.slice(0, 18)}…` : v}` : '';
  };

  return (
    <Card className="mt-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[14px] font-extrabold">Import the estate roll</div>
          <div className="mt-1 max-w-[62ch] text-[12px] leading-[1.55] text-muted">
            Any CSV with one row per house. It does not have to match a particular format — we
            work out which column is which and show you before anything is created, and you can
            correct it.
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <Button variant="quiet" onClick={exportAll} disabled={houses.length === 0}>
            Export all codes
          </Button>
          <Button variant="dark" onClick={() => fileRef.current?.click()}>
            Choose a CSV
          </Button>
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
        }}
      />

      {error ? (
        <div className="mt-4 rounded-[14px] bg-coral-soft px-4 py-3 text-[13px] font-semibold text-coral-ink">
          {error}
        </div>
      ) : null}

      {/* ── mapping + preview ───────────────────────────────────────────── */}
      {rows && mapping && applied ? (
        <div className="mt-4 rounded-[14px] bg-field p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[13px] font-extrabold">
              {filename} · {rows.length} {rows.length === 1 ? 'line' : 'lines'}
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-semibold text-ink">
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
                className="h-4 w-4 accent-lime"
              />
              First row is column names
            </label>
          </div>

          <div className="mt-3.5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {FIELD_ORDER.map((field) => (
              <label key={field} className={fieldLabel}>
                {FIELD_LABELS[field].toUpperCase()}
                {field === 'house_number' ? ' *' : ''}
                <select
                  value={mapping[field] === null ? '' : String(mapping[field])}
                  onChange={(e) =>
                    setColumn(field, e.target.value === '' ? null : Number(e.target.value))
                  }
                  className={select}
                >
                  <option value="">— not in this file —</option>
                  {labels.map((h, col) => (
                    <option key={col} value={col}>
                      {h}
                      {sampleFor(col)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {assumed ? (
            <div className="mt-3 text-[12px] text-coral-ink">
              We could not tell which column holds the house number, so we picked the first one.
              Check it below before importing.
            </div>
          ) : null}

          {mapping.house_number === null ? (
            <div className="mt-3 text-[12px] font-semibold text-coral-ink">
              Choose which column holds the house number. Nothing else is required.
            </div>
          ) : null}

          {applied.skipped.length > 0 ? (
            <div className="mt-2 text-[12px] text-coral-ink">
              {applied.skipped.length} row{applied.skipped.length === 1 ? '' : 's'} will be skipped
              for having no house number (line{applied.skipped.length === 1 ? '' : 's'}{' '}
              {applied.skipped.slice(0, 8).join(', ')}
              {applied.skipped.length > 8 ? '…' : ''}).
            </div>
          ) : null}

          {/* What will actually be created, not what is in the file. */}
          <div className="mt-3 overflow-hidden rounded-[10px] bg-white">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-3 px-3.5 py-2 text-[10.5px] font-extrabold tracking-label text-muted">
              {FIELD_ORDER.map((f) => (
                <span key={f}>{FIELD_LABELS[f].toUpperCase()}</span>
              ))}
            </div>
            {applied.houses.length === 0 ? (
              <div className="border-t border-hair px-3.5 py-3 text-[12.5px] text-muted">
                Nothing to import with these columns.
              </div>
            ) : (
              applied.houses.slice(0, 5).map((h, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-3 border-t border-hair px-3.5 py-2 text-[12.5px]"
                >
                  <span className="truncate font-bold">{h.house_number}</span>
                  <span className="truncate">
                    {h.landlord_name ?? <span className="text-muted">—</span>}
                  </span>
                  <span className="truncate text-muted">{h.landlord_phone ?? '—'}</span>
                  <span className="truncate text-muted">{h.landlord_email ?? '—'}</span>
                </div>
              ))
            )}
            {applied.houses.length > 5 ? (
              <div className="border-t border-hair px-3.5 py-2 text-[12px] text-muted">
                and {applied.houses.length - 5} more
              </div>
            ) : null}
          </div>

          <div className="mt-3.5 flex items-center gap-2.5">
            <Button
              onClick={() => void run()}
              disabled={busy || applied.houses.length === 0}
            >
              {busy
                ? 'Importing…'
                : `Import ${applied.houses.length} ${applied.houses.length === 1 ? 'house' : 'houses'}`}
            </Button>
            <Button variant="quiet" onClick={reset} disabled={busy}>
              Cancel
            </Button>
            <span className="text-[12px] text-muted">
              Nothing is created until you press Import.
            </span>
          </div>
        </div>
      ) : null}

      {/* ── result ──────────────────────────────────────────────────────── */}
      {result && counts ? (
        <div className="mt-4 rounded-[14px] border border-lime bg-lime-soft p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[13.5px] font-extrabold">
              {counts.created} created
              {counts.duplicate > 0 ? ` · ${counts.duplicate} already existed` : ''}
              {counts.invalid > 0 ? ` · ${counts.invalid} had no house number` : ''}
              {counts.failed > 0 ? ` · ${counts.failed} failed` : ''}
            </div>
            <div className="flex items-center gap-2.5">
              <Button variant="quiet" onClick={reset}>
                Done
              </Button>
              <Button onClick={() => exportResult(result)}>Download these codes</Button>
            </div>
          </div>

          <div className="mt-2 text-[12px] leading-[1.55] text-lime-ink">
            {counts.duplicate > 0
              ? 'Houses already on the roll were left exactly as they were — no code was changed, so anything already handed out still works. Their existing codes are in the download.'
              : 'Each house has its own code. A resident needs the estate code and their house code to join.'}
          </div>

          {counts.failed > 0 ? (
            <div className="mt-2 text-[12px] text-coral-ink">
              Importing the same file again will create the failed rows — nothing was written for
              them, and the houses that succeeded will simply report as duplicates.
            </div>
          ) : null}
        </div>
      ) : null}

      {!rows && !result && houses.length === 0 ? (
        <Empty>No houses yet. Import the roll, or add them one at a time below.</Empty>
      ) : null}
    </Card>
  );
}
