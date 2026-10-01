-- Detail views: the JSON each RPC returns, as key sets.
--
-- Runs after detail-views.sql, on its fixture. It asserts nothing itself: it
-- prints every object's keys, and scripts/test-detail-contract.mjs compares
-- them with the TypeScript interfaces in apps/web/src/lib/detail.ts. A key the
-- page reads that the RPC does not return renders as a silent blank, which no
-- typecheck and no SQL invariant would ever catch.

\set ON_ERROR_STOP on

create or replace function pg_temp.emit(label text, v jsonb) returns void
language plpgsql as $$
declare k text;
begin
  if v is null then return; end if;
  if jsonb_typeof(v) = 'object' then
    raise notice 'PASS  contract % %', label,
      (select string_agg(x, ',' order by x) from jsonb_object_keys(v) x);
    for k in select jsonb_object_keys(v) loop
      perform pg_temp.emit(label || '.' || k, v -> k);
    end loop;
  elsif jsonb_typeof(v) = 'array' and jsonb_array_length(v) > 0 then
    perform pg_temp.emit(label || '[]', v -> 0);
  end if;
end $$;

set test.uid = 'c9000000-0000-4000-8000-0000000000a1';
select pg_temp.emit('ResidentDetail', public.estate_resident_detail(
  'e9000000-0000-4000-8000-00000000000a', 'a9000000-0000-4000-8000-000000000001'));
select pg_temp.emit('HouseDetail', public.estate_house_detail(
  'e9000000-0000-4000-8000-00000000000a', 'f9000000-0000-4000-8000-000000000002'));

set test.uid = 'c9000000-0000-4000-8000-0000000000d0';
select pg_temp.emit('OperatorEstateDetail', public.operator_estate_detail('e9000000-0000-4000-8000-00000000000a'));
select pg_temp.emit('OperatorPersonDetail', public.operator_person_detail('c9000000-0000-4000-8000-000000000005'));

set test.uid = 'c9000000-0000-4000-8000-0000000000e1';
select pg_temp.emit('AgencyOfficerDetail', public.agency_officer_detail('ab900000-0000-4000-8000-000000000005'));
select pg_temp.emit('AgencyEstateDetail', public.agency_estate_detail(
  'b9000000-0000-4000-8000-00000000000a', 'e9000000-0000-4000-8000-00000000000a'));

set test.uid = 'c9000000-0000-4000-8000-000000000006';
select pg_temp.emit('LandlordHouseDetail', public.landlord_house_detail('f9000000-0000-4000-8000-000000000001'));
