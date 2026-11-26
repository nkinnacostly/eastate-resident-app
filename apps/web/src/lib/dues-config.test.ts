import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { defaultDuesCurrency, describeDuesError } from './api';

// The Dues form used to start at NGN whatever the payout account, so a South
// African estate's first save failed with a raw database error.
describe('the currency the Dues form starts with', () => {
  it('is rand for a South African payout account', () => {
    expect(defaultDuesCurrency(null, 'ZA')).toBe('ZAR');
  });
  it('is naira for a Nigerian one, or none yet', () => {
    expect(defaultDuesCurrency(null, 'NG')).toBe('NGN');
    expect(defaultDuesCurrency(null, null)).toBe('NGN');
    expect(defaultDuesCurrency(undefined, undefined)).toBe('NGN');
  });
  it('is whatever the estate already bills in, once set', () => {
    expect(defaultDuesCurrency('ZAR', 'ZA')).toBe('ZAR');
  });
});

describe('set_dues_config refusals', () => {
  it('become sentences an admin can act on', () => {
    expect(describeDuesError('currency_does_not_match_settlement_account')).toMatch(/rand \(ZAR\) for a South African account/);
    expect(describeDuesError('settlement_account_required')).toMatch(/payout account first/);
  });
  it('pass anything else through unchanged', () => {
    expect(describeDuesError('permission denied')).toBe('permission denied');
  });
});
