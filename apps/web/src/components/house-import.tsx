import { useRef, useState } from 'react';

import { importHouses, type HouseRow, type ImportedHouse } from '../lib/api';
import {
  downloadCsv, parseCsv, readHouses, slugFilename, toCsv,
  type HouseInput, type ReadHousesResult,
} from '../lib/csv';
import { Button, Card, Empty } from './ui';

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
 * codes off a screen one at a time, and the import has moved the tedium rather
 * than removed it.
 *
 * WHY THERE IS A PREVIEW STEP
 *
 * The file comes from a system we have never seen. Reading it wrong — a header
 * mistaken for data, the phone column read as the house number — would create
 * hundreds of junk houses that then have to be found and deactivated by hand.
 * So the mapping is shown and confirmed before anything is written.
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
  const [parsed, setParsed] = useState<ReadHousesResult | null>(null);
  const [filename, setFilename] = useState('');
  const [result, setResult] = useState<ImportedHouse[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setParsed(null);
    setResult(null);
    setFilename('');
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const pick = async (file: File) => {
    setError(null);
    setResult(null);
    try {
      const read = readHouses(parseCsv(await file.text()));
      setFilename(file.name);
      setParsed(read);
      if (read.houses.length === 0) {
        setError('No house numbers found in that file. Check that a column holds the house or unit number.');
      }
    } catch (e) {
      setError(`Could not read that file: ${(e as Error).message}`);
    }
  };

  const run = async () => {
    if (!parsed || parsed.houses.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await importHouses(estateId, parsed.houses));
      setParsed(null);
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
  const exportResult = (rows: ImportedHouse[]) => {
    downloadCsv(
      slugFilename(estateName, 'imported-house-codes'),
      toCsv([
        ['house_number', 'house_code', 'status'],
        ...rows
          .filter((r) => r.house_code)
          .map((r) => [r.house_number, r.house_code, r.status]),
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

  return (
    <Card className="mt-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-[14px] font-extrabold">Import the estate roll</div>
          <div className="mt-1 max-w-[62ch] text-[12px] leading-[1.55] text-muted">
            A CSV with one row per house. Only the house number is required — a column called
            house, unit, stand or erf is recognised, and so is a bare list with no header at all.
            Landlord name, phone and email are used if present.
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

      {/* ── preview ─────────────────────────────────────────────────────── */}
      {parsed && parsed.houses.length > 0 ? (
        <div className="mt-4 rounded-[14px] bg-field p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-[13px] font-extrabold">
              {parsed.houses.length} {parsed.houses.length === 1 ? 'house' : 'houses'} in{' '}
              {filename}
            </div>
            <div className="flex items-center gap-2.5">
              <Button variant="quiet" onClick={reset} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => void run()} disabled={busy}>
                {busy ? 'Importing…' : `Import ${parsed.houses.length}`}
              </Button>
            </div>
          </div>

          <div className="mt-3 text-[12px] text-muted">
            {parsed.hadHeader
              ? 'Read the first row as column names.'
              : 'No header row recognised, so the first row was read as a house.'}{' '}
            {Object.entries(parsed.mapping)
              .map(([field, col]) => `${field.replace('_', ' ')} ← ${col}`)
              .join(' · ')}
          </div>

          {parsed.skipped.length > 0 ? (
            <div className="mt-2 text-[12px] text-coral-ink">
              {parsed.skipped.length} row{parsed.skipped.length === 1 ? '' : 's'} had no house
              number and will be skipped (line{parsed.skipped.length === 1 ? '' : 's'}{' '}
              {parsed.skipped.slice(0, 8).join(', ')}
              {parsed.skipped.length > 8 ? '…' : ''}).
            </div>
          ) : null}

          {/* First few rows, so a wrong column mapping is visible rather than
              inferred from the header line above. */}
          <div className="mt-3 overflow-hidden rounded-[10px] bg-white">
            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-3 px-3.5 py-2 text-[10.5px] font-extrabold tracking-label text-muted">
              <span>HOUSE</span>
              <span>LANDLORD</span>
              <span>PHONE</span>
            </div>
            {parsed.houses.slice(0, 5).map((h: HouseInput, i) => (
              <div
                key={i}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-3 border-t border-hair px-3.5 py-2 text-[12.5px]"
              >
                <span className="truncate font-bold">{h.house_number}</span>
                <span className="truncate">{h.landlord_name ?? <span className="text-muted">—</span>}</span>
                <span className="truncate text-muted">{h.landlord_phone ?? '—'}</span>
              </div>
            ))}
            {parsed.houses.length > 5 ? (
              <div className="border-t border-hair px-3.5 py-2 text-[12px] text-muted">
                and {parsed.houses.length - 5} more
              </div>
            ) : null}
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

      {!parsed && !result && houses.length === 0 ? (
        <Empty>No houses yet. Import the roll, or add them one at a time below.</Empty>
      ) : null}
    </Card>
  );
}
