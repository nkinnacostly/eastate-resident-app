import { clock, madeAt, shareMessage, timeLeft, validUntil } from '@/lib/format';

const NOW = Date.parse('2026-08-14T12:00:00.000Z');
const iso = (msFromNow: number) => new Date(NOW + msFromNow).toISOString();

describe('timeLeft', () => {
  it('formats hours and zero-padded minutes', () => {
    // `now` is injected so the assertion never races the wall clock.
    expect(timeLeft(iso(5 * 3600_000 + 9 * 60_000), NOW)).toBe('5h 09m');
  });

  it('drops the hour component under an hour', () => {
    expect(timeLeft(iso(24 * 60_000), NOW)).toBe('24m');
  });

  it('reports Expired once the instant has passed', () => {
    expect(timeLeft(iso(-1000), NOW)).toBe('Expired');
  });

  // The countdown is cosmetic — it must never be the thing that decides
  // validity, and it must not render garbage if a timestamp is missing.
  it('returns empty rather than NaN for an unparseable timestamp', () => {
    expect(timeLeft('not-a-date', NOW)).toBe('');
    expect(timeLeft('', NOW)).toBe('');
  });
});

describe('validUntil', () => {
  // The clock is pinned. Written as `new Date()` plus an hour, this failed for
  // the last hour of every day: after 23:00 the +1h lands on tomorrow, so it is
  // no longer the same day and " tonight" is correctly dropped. A test that is
  // red for one hour in twenty-four teaches people to ignore a red suite.
  it('names the time for a code expiring later the same day', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-14T18:00:00'));
    try {
      expect(validUntil(new Date('2026-08-14T19:00:00').toISOString())).toMatch(
        /^Valid until .+ tonight$/,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('drops "tonight" once the expiry falls on the next day', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-14T23:30:00'));
    try {
      const s = validUntil(new Date('2026-08-15T00:30:00').toISOString());
      expect(s).toMatch(/^Valid until /);
      expect(s).not.toMatch(/tonight/);
    } finally {
      jest.useRealTimers();
    }
  });

  // REGRESSION: a `+00:00` offset decodes to a space through a URL, which used
  // to render "Valid until Invalid Date" on the code screen.
  it('never renders "Invalid Date"', () => {
    for (const bad of ['2026-08-14T17:25:10.055740 00:00', 'nonsense', '']) {
      expect(validUntil(bad)).toBe('Valid for 6 hours');
      expect(validUntil(bad)).not.toMatch(/Invalid Date/);
    }
  });
});

describe('clock / madeAt', () => {
  it('degrade to empty on bad input instead of throwing', () => {
    expect(clock('nope')).toBe('');
    expect(madeAt('nope')).toBe('');
  });

  it('prefixes today with "Made"', () => {
    expect(madeAt(new Date().toISOString())).toMatch(/^Made /);
  });
});

describe('shareMessage', () => {
  it('carries code and estate so it stands alone in a chat', () => {
    const msg = shareMessage('7K4P92', 'Kelvin Grove', iso(3600_000));
    expect(msg).toContain('7K4P92');
    expect(msg).toContain('Kelvin Grove');
    expect(msg).not.toMatch(/Invalid Date|undefined|null/);
  });

  it('stays sane when the expiry is unusable', () => {
    const msg = shareMessage('7K4P92', 'Kelvin Grove', '');
    expect(msg).toBe('Your code for Kelvin Grove is 7K4P92. Valid for 6 hours.');
  });

  it('says nothing about delivery when there is no note', () => {
    for (const note of [undefined, null, '', '   ']) {
      expect(shareMessage('7K4P92', 'Kelvin Grove', iso(3600_000), note)).not.toMatch(
        /Delivery/i,
      );
    }
  });

  it('appends the instructions after the code, on their own line', () => {
    const msg = shareMessage('7K4P92', 'Kelvin Grove', iso(3600_000), 'Leave at the gate');
    expect(msg).toContain('Delivery instructions: Leave at the gate');
    // The rider is scanning for the code while holding a parcel — instructions
    // must never push it out of the first line.
    expect(msg.split('\n')[0]).toContain('7K4P92');
    expect(msg.indexOf('7K4P92')).toBeLessThan(msg.indexOf('Delivery instructions'));
  });

  it('trims the note it was handed', () => {
    const msg = shareMessage('7K4P92', 'Kelvin Grove', iso(3600_000), '  Ring twice  ');
    expect(msg).toContain('Delivery instructions: Ring twice');
  });
});
