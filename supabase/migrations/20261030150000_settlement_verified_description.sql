-- The payout-account description names account types, not a country.
--
-- 20260927190000 described estates.settlement_account_verified by country. It
-- now says NG and ZA accounts, the codes settlement_country already uses; that
-- file carries the same text, which this applies to the live database.
-- Description only: nothing else changes.

comment on column public.estates.settlement_account_verified is
  'True only where the bank confirmed the account holder name (NG accounts). '
  'A ZA account has no name lookup, so false there means unverified, not wrong.';
