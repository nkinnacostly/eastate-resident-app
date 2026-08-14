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
  it('names the time for a code expiring today', () => {
    const d = new Date();
    d.setHours(d.getHours() + 1);
    expect(validUntil(d.toISOString())).toMatch(/^Valid until .+ tonight$/);
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
});
