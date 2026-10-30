-- Comments for the guard licence columns and their RPC, after the rename in
-- 20261030100000.
--
-- The columns kept the comments they had as psira_* columns, and two of them
-- never had one; record_guard_licence had none either. They now describe the
-- fields as they are used: regulator-neutral, Nigerian estates first, with the
-- PSIRA-only parts (the A-E grade) saying so.

comment on column public.profiles.licence_number is
  'The guard''s licence or registration number with the body that regulates private guards '
  '(the NSCDC in Nigeria, PSIRA in South Africa). Person-scoped and portable between employers. '
  'Opaque string: no regulator publishes a format to validate against.';

comment on column public.profiles.licence_grade is
  'PSIRA''s A-E grade, for a South African licence (profiles_licence_grade_ck). '
  'Null for a Nigerian licence, which has no grade.';

comment on column public.profiles.licence_expires_at is
  'When the licence lapses, as the employer recorded it. A typed-in claim, not a checked fact: '
  'see licence_verified_at.';

comment on column public.profiles.licence_verified_at is
  'When a human last checked this against the regulator. Never set automatically: there is no '
  'public API to check against, so the honest claim is "checked on this date", not "verified". '
  'Set only by record_guard_licence.';

comment on function public.record_guard_licence(uuid, text, text, timestamptz) is
  'Records a guard''s licence and stamps licence_verified_at as the moment a person checked it. '
  'Only the employer may: an admin of an agency the guard works for, an admin of an estate they '
  'guard, or the platform owner -- never the guard about themselves. Was record_psira_registration.';
