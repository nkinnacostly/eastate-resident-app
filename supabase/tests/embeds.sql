-- PostgREST embed ambiguity — a regression guard.
--
-- Run against the LINKED project:  npm run test:embeds
--
-- ─── The bug this exists to prevent ever shipping again ─────────────────────
--
-- Adding `estates.dues_enforcement_authorised_by -> memberships(id)` created a
-- SECOND foreign key between `memberships` and `estates`. PostgREST resolves
-- an embed like `estates(name)` by finding THE key between the two tables;
-- with two it cannot choose and refuses outright with HTTP 300 PGRST201.
--
-- Every app embeds exactly that way at startup, so one audit column logged
-- every user out of the admin dashboard, the resident app AND the guard app
-- simultaneously. Each of those call sites also declines to mark itself
-- "loaded" on failure -- correct for a network blip, disastrous for a
-- permanent error -- so the apps sat on a blank screen with nothing to press.
--
-- It passed every test we had. The SQL was correct; nothing modelled how
-- PostgREST reads the schema, and the damage was only visible through REST.
-- Hence a test about relationship SHAPE rather than behaviour.
--
-- Pure SQL, no psql meta-commands: `supabase db query` is not psql.

create temp table results (seq int, name text, detail text, pass boolean);

-- Relationships PostgREST can see between two tables, counting BOTH
-- directions -- the part that is easy to miss. The key that broke login
-- pointed estates -> memberships while the obvious one pointed the other way,
-- so a check looking only one way sees nothing wrong.
create or replace function pg_temp.fk_count(a text, b text) returns integer
language sql stable as $$
  select count(*)::integer
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
   where c.contype = 'f' and n.nspname = 'public'
     and ((c.conrelid = a::regclass and c.confrelid = b::regclass)
       or (c.conrelid = b::regclass and c.confrelid = a::regclass));
$$;

-- ─── Pairs a client embeds WITHOUT naming the constraint ─────────────────────
--
-- If one of these fails: drop the new foreign key, point it at auth.users
-- (usually right for an audit column), or name the constraint at the call site
-- -- estates!memberships_estate_id_fkey(name) -- and move it to the list below.

insert into results select 1, 'memberships <-> estates unambiguous (login, all three apps)',
  'fks='||pg_temp.fk_count('public.memberships','public.estates')::text,
  pg_temp.fk_count('public.memberships','public.estates') = 1;

insert into results select 2, 'memberships <-> houses unambiguous (resident + admin lists)',
  'fks='||pg_temp.fk_count('public.memberships','public.houses')::text,
  pg_temp.fk_count('public.memberships','public.houses') = 1;

insert into results select 3, 'memberships <-> profiles unambiguous (admin resident list)',
  'fks='||pg_temp.fk_count('public.memberships','public.profiles')::text,
  pg_temp.fk_count('public.memberships','public.profiles') = 1;

insert into results select 4, 'push_tokens <-> memberships unambiguous (push dispatch)',
  'fks='||pg_temp.fk_count('public.push_tokens','public.memberships')::text,
  pg_temp.fk_count('public.push_tokens','public.memberships') = 1;

-- ─── Pairs that ARE ambiguous, named explicitly at the call site ─────────────
--
-- Asserted rather than ignored: if one drops back to a single key, the
-- explicit !constraint_name in the query becomes wrong and breaks the other way.

insert into results select 5, 'access_codes <-> memberships ambiguous, api.ts names the constraint',
  'fks='||pg_temp.fk_count('public.access_codes','public.memberships')::text,
  pg_temp.fk_count('public.access_codes','public.memberships') > 1;

insert into results select 10, 'dues_charges <-> memberships ambiguous, api.ts names the constraint',
  'fks='||pg_temp.fk_count('public.dues_charges','public.memberships')::text,
  pg_temp.fk_count('public.dues_charges','public.memberships') > 1;

insert into results select 11, 'dues_charges_membership_id_fkey exists (named by api.ts)',
  'n='||count(*)::text, count(*) = 1
  from pg_constraint where conname = 'dues_charges_membership_id_fkey';

-- ─── Constraint names the clients hard-code ──────────────────────────────────
--
-- A rename is a silent break: the query still parses and starts 400ing.

insert into results select 6, 'memberships_estate_id_fkey exists (named by all three apps)',
  'n='||count(*)::text, count(*) = 1
  from pg_constraint where conname = 'memberships_estate_id_fkey';

insert into results select 7, 'access_codes_membership_id_fkey exists (named by api.ts)',
  'n='||count(*)::text, count(*) = 1
  from pg_constraint where conname = 'access_codes_membership_id_fkey';

-- ─── The column that caused the outage ───────────────────────────────────────

insert into results select 8, 'dues_enforcement_authorised_by points at auth.users, not memberships',
  'target='||coalesce(confrelid::regclass::text,'<missing>'),
  confrelid = 'auth.users'::regclass
  from pg_constraint where conname = 'estates_dues_enforcement_authorised_by_fkey';

-- ─── Nothing else has quietly become ambiguous ───────────────────────────────
--
-- The broad sweep. Any NEW ambiguous pair involving memberships is a candidate
-- outage, because memberships is what every client embeds from. Listed by name
-- so this fails loudly with the culprit rather than a bare count.

insert into results select 9, 'no unreviewed ambiguous pair involving memberships',
  coalesce(string_agg(other, ', '), 'none'),
  count(*) = 0
  from (
    select case when c.conrelid = 'public.memberships'::regclass
                then c.confrelid::regclass::text else c.conrelid::regclass::text end as other
      from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
     where c.contype = 'f' and n.nspname = 'public'
       and (c.conrelid = 'public.memberships'::regclass
         or c.confrelid = 'public.memberships'::regclass)
     group by 1
    having count(*) > 1
  ) t
  -- Known-ambiguous AND named at every call site that embeds them:
  --   access_codes  -> api.ts uses !access_codes_membership_id_fkey
  --   dues_charges  -> api.ts uses !dues_charges_membership_id_fkey
  -- Anything else appearing here is new and unreviewed.
  --
  -- An earlier version of this comment claimed dues_charges was not embedded
  -- anywhere. It was -- on the admin Dues page -- and that query was broken in
  -- production while this file asserted everything was fine. Which is why the
  -- authority on what the apps query is scripts/test-client-queries.mjs, which
  -- reads the app sources, not a comment.
  where other not in ('access_codes', 'dues_charges');

select seq, case when pass then 'PASS' else 'FAIL' end as status, name, detail
  from results order by seq;
