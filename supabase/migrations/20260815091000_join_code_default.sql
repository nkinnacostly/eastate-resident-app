-- join_code needs a DEFAULT, not just NOT NULL.
--
-- The previous migration made estates.join_code NOT NULL but left it without a
-- default, which broke every path that inserts an estate without naming the
-- column — including public.create_estate(), the one function a platform owner
-- uses to onboard an estate at all. It failed with 23502 rather than doing
-- anything visible, so the platform owner dashboard would have been dead on
-- arrival.
--
-- A default generates the code at insert time, so create_estate(), the seed
-- script and the invariant suite all keep working untouched.
--
-- On collision the unique index raises rather than silently reusing a code.
-- At 32^8 (~1.1e12) across a handful of estates that is not a practical
-- concern; rotate_estate_join_code() retries in a loop for the same reason.

alter table public.estates
  alter column join_code set default public.generate_code(8);
