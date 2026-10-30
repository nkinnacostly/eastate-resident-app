-- Three descriptions without the country: the licence number, the licence
-- grade and the agency monthly return.
--
-- 20261030100000 and 20261030110000 described the NSCDC and PSIRA by country.
-- The product is built for Nigerian estates; PSIRA is still supported, for an
-- agency registered with it, so the descriptions now say that instead. Both
-- files were updated to the same text, which this applies to the live database.
-- Descriptions only: nothing else changes.

comment on column public.profiles.licence_number is
  'The guard''s licence or registration number with the body that regulates private guards: '
  'the NSCDC for Nigerian estates, or PSIRA for a PSIRA-registered agency. Person-scoped and '
  'portable between employers. Opaque string: no regulator publishes a format to validate against.';

comment on column public.profiles.licence_grade is
  'A PSIRA grade, A to E (profiles_licence_grade_ck), recorded only for a PSIRA-registered '
  'agency''s guards. Null for a Nigerian licence, which has no grade.';

comment on function public.agency_monthly_return(uuid, date) is
  'Monthly personnel return assembled from stamped shifts: each officer''s licence number, sites '
  'and hours. For a PSIRA-registered agency it is the PSIRA GN 2209 return.';
