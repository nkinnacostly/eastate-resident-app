import { callEdgeFunction } from './edge';
import { supabase } from './supabase';

/**
 * The landlord portal's data.
 *
 * A landlord is not a membership. They are linked to a house by their
 * CONFIRMED email matching the address the estate recorded on it — which is
 * the same designation that already decides who receives a payment link, so an
 * account is no weaker than what shipped before it, and stronger in that
 * nothing payable sits in an inbox.
 *
 * Everything here is scoped by that match inside the database. Nothing on this
 * side supplies an identity, so there is nothing here to forge.
 */

export interface LandlordHouse {
  house_id: string;
  house_number: string;
  house_code: string;
  estate_id: string;
  estate_name: string;
  /** Null when the estate does not bill dues at all. */
  dues_payer: 'landlord' | 'residents' | null;
  dues_amount_minor: number | null;
  currency: string | null;
  residents: number;
  /**
   * What the LANDLORD owes on this house — zero where the residents are billed.
   * A tenant's own dues are between them and the estate, and are never counted
   * or shown here.
   */
  outstanding_minor: number;
  overdue_minor: number;
}

export interface LandlordCharge {
  charge_id: string;
  house_id: string;
  house_number: string;
  estate_name: string;
  period: string;
  amount_minor: number;
  currency: string;
  due_on: string;
  status: 'open' | 'paid' | 'waived';
  is_overdue: boolean;
  paid_at: string | null;
  waive_reason: string | null;
}

export async function myLandlordHouses(): Promise<LandlordHouse[]> {
  const { data, error } = await supabase.rpc('my_landlord_houses');
  if (error) throw new Error(error.message);
  return (data ?? []) as LandlordHouse[];
}

export async function landlordDues(): Promise<LandlordCharge[]> {
  const { data, error } = await supabase.rpc('landlord_dues');
  if (error) throw new Error(error.message);
  return (data ?? []) as LandlordCharge[];
}

const payError = (code: string) =>
  ({
    not_your_charge: 'That charge is not on a house you own.',
    charge_not_open: 'That charge has already been settled.',
    email_not_confirmed:
      'Confirm your email address first — that is how we know which houses are yours.',
    estate_has_no_settlement_account:
      'This estate has not finished setting up its bank account, so payments cannot be taken yet. The estate office can complete it.',
    checkout_unavailable: 'We could not reach the payment provider. Please try again shortly.',
    cannot_pay_ahead:
      'The estate is not billing this house that far ahead. Choose a shorter period.',
    invalid_term: 'Choose monthly, quarterly, half-yearly or yearly.',
  })[code] ?? 'We could not start that payment.';

/**
 * Open checkout for one of the landlord's charges.
 *
 * Through the Edge Function rather than straight to Flutterwave: the secret
 * key can do anything on the account and must never reach a browser bundle.
 * The amount is never sent from here — it is read from the charge row inside
 * the database, which is what stops a client choosing its own price.
 */
export async function startLandlordPayment(chargeId: string, months = 1): Promise<string> {
  // `months` is how far ahead to pay (1, 3, 6 or 12), never a price.
  const r = await callEdgeFunction<{ link: string }>(
    'dues-checkout',
    { charge_id: chargeId, as_landlord: true, months },
    payError,
  );
  return r.link;
}
