import { useCallback, useEffect, useState } from 'react';

import { Button, Card, Empty, PageHead, Stat } from '../../components/ui';
import { answersToPsira, monthlyReturn, type ReturnRow } from '../../lib/agency';
import { useAuth } from '../../lib/auth-context';
import { downloadCsv, toCsv } from '../../lib/csv';
import { dayTime } from '../../lib/format';

// PSIRA agencies get a grade column; a Nigerian licence has no grade.
const COLS_PSIRA = 'grid grid-cols-[1.3fr_110px_60px_1.2fr_100px_80px] gap-4';
const COLS = 'grid grid-cols-[1.3fr_130px_1.2fr_100px_80px] gap-4';

/** The last twelve months, newest first. */
function recentMonths(): Date[] {
  const out: Date[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) out.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
  return out;
}

const monthLabel = (d: Date) =>
  d.toLocaleDateString('en-NG', { month: 'long', year: 'numeric' });

/**
 * The statutory monthly personnel return, assembled rather than typed.
 *
 * South African guarding companies have owed this since 1 April 2024: by the
 * 15th of each month, every officer employed or deployed that month, with names,
 * registration numbers, period of service and geographic area. A materially
 * false or misleading return carries a penalty of up to R500,000, which is why
 * nothing here is rounded or inferred -- every figure is read back off shift
 * records the officers themselves created at a gate.
 *
 * The reason this page can exist at all is that the platform authenticates a
 * PERSON. Regulation 10(7)(f) wants the officer's name, grade and registration
 * number against the site and the hours; a system that logs a shared gate
 * tablet in, as most of this category does, can never say which human was
 * there. As far as the research found, nobody has automated this.
 *
 * All of that is PSIRA's, and only a PSIRA-registered agency sees it framed
 * that way. The product is built for Nigerian estates; for any other agency the
 * same report goes out without PSIRA's name, grades or filing deadline on it.
 */
export function AgencyMonthlyReturn() {
  const { agencies } = useAuth();
  const agency = agencies[0] ?? null;
  const psira = answersToPsira(agency);
  const cols = psira ? COLS_PSIRA : COLS;
  const months = recentMonths();
  const [month, setMonth] = useState<Date>(months[0]);
  const [rows, setRows] = useState<ReturnRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!agency) return;
    setLoading(true);
    try {
      setRows(await monthlyReturn(agency.agency_id, month));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [agency, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const officers = new Set(rows.map((r) => r.officer_name)).size;
  const hours = rows.reduce((n, r) => n + Number(r.hours ?? 0), 0);
  // The return is worthless if an officer on it has no registration number --
  // that is the field the whole filing turns on.
  const missing = rows.filter((r) => !r.registration_number).length;

  const exportCsv = () => {
    const header = [
      'Officer', psira ? 'PSIRA number' : 'Licence number', ...(psira ? ['Grade'] : []), 'Contact',
      'Registration expires', 'Registration checked', 'Site', 'Site address', 'First shift',
      'Last shift', 'Shifts', 'Hours',
    ];
    const body = rows.map((r) => [
      r.officer_name, r.registration_number, ...(psira ? [r.grade] : []), r.contact_phone,
      r.registration_expires_at, r.registration_checked_at,
      r.estate_name, r.estate_address, r.first_shift_at, r.last_shift_at,
      String(r.shifts), String(r.hours),
    ]);
    // toCsv neutralises leading = + - @ so a name or note cannot execute as a
    // formula when the return is opened in Excel, and downloadCsv writes a BOM.
    const stamp = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`;
    downloadCsv(`${psira ? 'psira' : 'officer'}-return-${stamp}.csv`, toCsv([header, ...body]));
  };

  return (
    <>
      <PageHead
        title="Monthly return"
        blurb="Every officer your agency deployed this month, with the hours they worked at each site. Built from their own shift records, not typed in."
        right={
          <Button onClick={exportCsv} disabled={rows.length === 0}>
            Export CSV
          </Button>
        }
      />

      {error ? (
        <div className="mt-5 rounded-[14px] bg-coral-soft px-4 py-3 text-[13px] font-semibold text-coral-ink">
          {error}
        </div>
      ) : null}

      <div className="mt-6 flex items-center gap-2.5">
        <select
          value={month.toISOString()}
          onChange={(e) => setMonth(new Date(e.target.value))}
          className="h-11 rounded-[14px] bg-field px-4 text-[13px] font-semibold outline-none focus:ring-2 focus:ring-lime"
        >
          {months.map((m) => (
            <option key={m.toISOString()} value={m.toISOString()}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <Stat label="OFFICERS DEPLOYED" value={officers} />
        <Stat label="TOTAL HOURS" value={hours.toFixed(2)} />
        <Stat
          label={psira ? 'MISSING PSIRA NUMBER' : 'MISSING LICENCE NUMBER'}
          value={missing}
          tone={missing ? 'bad' : undefined}
        />
      </div>

      {missing > 0 ? (
        <div className="mt-3.5 rounded-[14px] bg-coral-soft px-4 py-3 text-[13px] font-semibold text-coral-ink">
          {missing} {missing === 1 ? 'line has' : 'lines have'} no {psira ? 'registration' : 'licence'} number.
          {psira
            ? ' Filing a return with those blank is worse than filing late — add them on the Officers page first.'
            : ' Add them on the Officers page before you send this return to anyone.'}
        </div>
      ) : null}

      <Card className="mt-3.5 py-4">
        <div className={`${cols} px-4 pb-2.5 text-[10.5px] font-extrabold tracking-label text-muted`}>
          <span>OFFICER</span>
          <span>{psira ? 'PSIRA NUMBER' : 'LICENCE NUMBER'}</span>
          {psira ? <span>GRADE</span> : null}
          <span>SITE</span>
          <span>PERIOD</span>
          <span>HOURS</span>
        </div>
        {loading ? (
          <Empty>Loading…</Empty>
        ) : rows.length === 0 ? (
          <Empty>No shifts recorded for {monthLabel(month)}.</Empty>
        ) : (
          rows.map((r, i) => (
            <div
              key={`${r.officer_name}-${r.estate_name}-${i}`}
              className={`${cols} items-center border-t border-hair px-4 py-3`}
            >
              <div className="truncate text-[13px] font-bold">{r.officer_name ?? 'Unnamed'}</div>
              <div
                className={`text-[12.5px] tracking-code ${
                  r.registration_number ? 'text-muted' : 'font-bold text-coral-ink'
                }`}
              >
                {r.registration_number ?? 'MISSING'}
              </div>
              {psira ? <div className="text-[12.5px] font-bold">{r.grade ?? '—'}</div> : null}
              <div className="min-w-0">
                <div className="truncate text-[12.5px] text-muted">{r.estate_name}</div>
                {r.estate_address ? (
                  <div className="truncate text-[11px] text-muted">{r.estate_address}</div>
                ) : null}
              </div>
              <div className="text-[12px] text-muted">
                {dayTime(r.first_shift_at)} – {dayTime(r.last_shift_at)}
              </div>
              <div className="text-[12.5px] font-bold">{Number(r.hours ?? 0).toFixed(2)}</div>
            </div>
          ))
        )}
      </Card>

      <Card className="mt-4 p-4">
        {psira ? (
          <p className="text-[12.5px] leading-[19px] text-muted">
            In South Africa this return is due to PSIRA by the 15th of the following month, covering
            every officer employed or deployed. The export carries the fields the return asks for —
            names, registration numbers, period of service and the site where each worked. Check it
            before you file it: we can only report the shifts your officers actually started in the
            app.
          </p>
        ) : (
          <p className="text-[12.5px] leading-[19px] text-muted">
            The export lists every officer deployed this month with their licence number, period of
            service and the site where each worked — ready to send to a client estate. Check it
            before you send it: we can only report the shifts your officers actually started in the
            app.
          </p>
        )}
      </Card>
    </>
  );
}
