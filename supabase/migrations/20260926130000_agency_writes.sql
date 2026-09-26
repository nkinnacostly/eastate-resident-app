-- Estate Access Platform — agency write paths
--
-- 20260926110000 created the tables, the stamps and the revocation, and no way
-- whatsoever to create an agency, employ an officer or sign a contract. It
-- shipped a function for withdrawing officers who could never be added. This
-- closes that.
--
-- Every function here derives identity from auth.uid() and verifies authority
-- before touching anything. There is still no INSERT/UPDATE/DELETE policy on
-- any agency table: these definer functions remain the only write path, which
-- is what makes the authority checks below unavoidable rather than advisory.

-- ─── Who administers an agency ───────────────────────────────────────────────
--
-- The check agency_deactivate_officer wrote out inline. Extracted because it is
-- now asked in six places, and six copies of an authority check is five chances
-- for one of them to drift.
--
-- Definer, so it can read agency_memberships without RLS recursing on a policy
-- that queries the same table. Note SECURITY DEFINER does not by itself bypass
-- RLS -- it does so because the owner owns the table and FORCE ROW LEVEL
-- SECURITY is off. If FORCE is ever enabled on agency_memberships this starts
-- evaluating policies again and the recursion returns.

create function public.is_agency_admin(p_agency_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.agency_memberships am
     where am.agency_id = p_agency_id
       and am.user_id   = (select auth.uid())
       and am.role      = 'admin'
       and am.is_active
  );
$$;

revoke execute on function public.is_agency_admin(uuid) from public, anon;
grant  execute on function public.is_agency_admin(uuid) to authenticated;

-- ─── Creating an agency ──────────────────────────────────────────────────────
--
-- Platform admin only, deliberately. An agency appearing in this system is an
-- onboarding event with a contract and a compliance check behind it, not a
-- self-service signup: registration has to be looked up against the regulator
-- by a person, because no regulator publishes an API to look it up with. Making
-- this open would also let anyone mint a plausible-looking "Fidelity ADT" and
-- invite estates to contract with it.

create function public.create_agency(
  p_name                text,
  p_registration_number text default null,
  p_registration_body   text default null,
  p_admin_user_id       uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'not_a_platform_admin' using errcode = '42501';
  end if;

  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'agency_name_required' using errcode = '22023';
  end if;

  insert into public.agencies (name, registration_number, registration_body)
  values (btrim(p_name), nullif(btrim(coalesce(p_registration_number, '')), ''),
          nullif(btrim(coalesce(p_registration_body, '')), ''))
  returning id into v_agency;

  -- Seeded with its first admin in the same transaction, or the agency is
  -- created with nobody able to administer it and needs a second privileged
  -- call to become usable at all.
  if p_admin_user_id is not null then
    insert into public.agency_memberships (agency_id, user_id, role)
    values (v_agency, p_admin_user_id, 'admin');
  end if;

  return v_agency;
end;
$$;

-- ─── Employing an officer ────────────────────────────────────────────────────

create function public.add_agency_officer(
  p_agency_id uuid,
  p_user_id   uuid,
  p_role      public.agency_role default 'officer'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- The platform-admin arm is not decoration: onboarding an agency means
  -- adding its first people before it has anyone who can add them.
  if not public.is_agency_admin(p_agency_id) and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_agency' using errcode = '42501';
  end if;

  -- Re-hiring flips is_active rather than adding a row, so an officer's
  -- employment history with one agency stays in one place and the unique
  -- constraint keeps it that way.
  insert into public.agency_memberships (agency_id, user_id, role)
  values (p_agency_id, p_user_id, p_role)
  on conflict (agency_id, user_id) do update
    set is_active = true, role = excluded.role
  returning id into v_id;

  return v_id;
end;
$$;

-- ─── The contract ────────────────────────────────────────────────────────────
--
-- The ESTATE signs. An agency cannot contract itself into an estate.
--
-- This is not a stylistic choice. PSIRA's Code of Conduct clause 9(10)(b)
-- already forbids a provider routing a client's security service through
-- another provider "unless the client has given consent thereto", and Microsoft
-- landed in the same place rebuilding partner access: the relationship is
-- bilaterally consented, never unilaterally asserted by the provider. An estate
-- discovering it had been contracted to a guarding company it never engaged is
-- the failure this prevents.

create function public.create_agency_contract(
  p_estate_id uuid,
  p_agency_id uuid,
  p_starts_on timestamptz default now(),
  p_ends_on   timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- p_estate_id is client-supplied, so an active admin membership AT THAT
  -- ESTATE is verified before anything is written.
  if public.current_membership(p_estate_id, 'admin') is null
     and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_estate' using errcode = '42501';
  end if;

  insert into public.agency_contracts (agency_id, estate_id, starts_on, ends_on)
  values (p_agency_id, p_estate_id, p_starts_on, p_ends_on)
  returning id into v_id;

  return v_id;
end;
$$;

-- Ending a contract is an ACT with a time and an actor, not the absence of one.
-- Either side may do it: an estate dismissing a provider and a provider
-- resigning an account are both real, and a model where only one party can
-- leave is not a contract.
create function public.end_agency_contract(p_contract_id uuid, p_revoked boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estate uuid;
  v_agency uuid;
begin
  select estate_id, agency_id into v_estate, v_agency
    from public.agency_contracts where id = p_contract_id;

  if v_estate is null then
    raise exception 'no_such_contract' using errcode = '42704';
  end if;

  if public.current_membership(v_estate, 'admin') is null
     and not public.is_agency_admin(v_agency)
     and not public.is_platform_admin() then
    raise exception 'not_a_party_to_this_contract' using errcode = '42501';
  end if;

  -- ends_on rather than a delete: the contract is the reason those events carry
  -- that agency's stamp, and deleting it would orphan the explanation.
  update public.agency_contracts
     set ends_on    = least(coalesce(ends_on, now()), now()),
         revoked_at = case when p_revoked then now() else revoked_at end
   where id = p_contract_id;

  -- The estate's guards go with the contract. Leaving them active is how a
  -- former provider's officers keep working at a gate for months -- the exact
  -- failure that has no answer in any product surveyed.
  update public.memberships
     set is_active = false
   where estate_id = v_estate
     and role = 'guard'
     and is_active
     and placed_by_agency_id = v_agency;
end;
$$;

-- ─── Placing an officer at a gate ────────────────────────────────────────────

create function public.place_officer_at_estate(
  p_agency_membership_id uuid,
  p_estate_id            uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid;
  v_agency uuid;
  v_id     uuid;
begin
  select am.user_id, am.agency_id into v_user, v_agency
    from public.agency_memberships am
   where am.id = p_agency_membership_id and am.is_active;

  if v_user is null then
    raise exception 'no_such_active_agency_membership' using errcode = '42704';
  end if;

  -- Dual authority, because both parties carry real risk: the agency deploys
  -- its own people, and the estate may place a guard at its own gate.
  if not public.is_agency_admin(v_agency)
     and public.current_membership(p_estate_id, 'admin') is null
     and not public.is_platform_admin() then
    raise exception 'not_authorised_to_place_here' using errcode = '42501';
  end if;

  -- THE confused-deputy check. We hold rights at every estate; the caller names
  -- the estate. Without this, an agency admin could place their own officers at
  -- any estate in the system by supplying its id -- including a rival's client.
  -- A live contract is what makes the placement legitimate, and liveness is
  -- derived here rather than read off a stored flag.
  if not exists (
    select 1 from public.agency_contracts c
     where c.agency_id = v_agency
       and c.estate_id = p_estate_id
       and c.during @> now()
       and c.revoked_at is null
  ) then
    raise exception 'no_live_contract_at_this_estate' using errcode = '42501';
  end if;

  insert into public.memberships (user_id, estate_id, role, placed_by_agency_id)
  values (v_user, p_estate_id, 'guard', v_agency)
  on conflict (user_id, estate_id, role) do update
    set is_active = true, placed_by_agency_id = excluded.placed_by_agency_id
  returning id into v_id;

  return v_id;
end;
$$;

-- ─── Recording a registration check ──────────────────────────────────────────
--
-- Written by whoever carries the legal duty to have checked, which is not the
-- officer. PSIRA's Code clause 11(2) requires an employer to "take all
-- reasonable steps to verify the registration status" BEFORE employing someone
-- as a security officer, and clause 23(b) puts the identical duty on an estate
-- that employs its guards in-house. So: the agency for its officers, the estate
-- admin for its own.

create function public.record_psira_registration(
  p_user_id             uuid,
  p_registration_number text,
  p_grade               text default null,
  p_expires_at          timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
        select 1 from public.agency_memberships am
         where am.user_id = p_user_id and am.is_active
           and public.is_agency_admin(am.agency_id))
     and not exists (
        select 1 from public.memberships m
         where m.user_id = p_user_id and m.role = 'guard' and m.is_active
           and public.current_membership(m.estate_id, 'admin') is not null)
     and not public.is_platform_admin() then
    raise exception 'not_this_officer_s_employer' using errcode = '42501';
  end if;

  update public.profiles
     set psira_registration_number = nullif(btrim(coalesce(p_registration_number, '')), ''),
         psira_grade               = p_grade,
         psira_expires_at          = p_expires_at,
         -- Set HERE and nowhere else, and only as a side effect of a person
         -- doing the check. It records that a human looked, on this date --
         -- never that a system verified, because there is no API to verify
         -- against and claiming otherwise would be the lie the field exists
         -- to prevent.
         psira_verified_at         = now()
   where id = p_user_id;

  if not found then
    raise exception 'no_such_profile' using errcode = '42704';
  end if;
end;
$$;

-- ─── Grants ──────────────────────────────────────────────────────────────────
--
-- Functions are EXECUTE to PUBLIC by default, so every one of these is
-- anon-callable until revoked. That has been a real bug in this schema before.

revoke execute on function public.create_agency(text, text, text, uuid) from public, anon;
revoke execute on function public.add_agency_officer(uuid, uuid, public.agency_role) from public, anon;
revoke execute on function public.create_agency_contract(uuid, uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.end_agency_contract(uuid, boolean) from public, anon;
revoke execute on function public.place_officer_at_estate(uuid, uuid) from public, anon;
revoke execute on function public.record_psira_registration(uuid, text, text, timestamptz) from public, anon;

grant execute on function public.create_agency(text, text, text, uuid) to authenticated;
grant execute on function public.add_agency_officer(uuid, uuid, public.agency_role) to authenticated;
grant execute on function public.create_agency_contract(uuid, uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.end_agency_contract(uuid, boolean) to authenticated;
grant execute on function public.place_officer_at_estate(uuid, uuid) to authenticated;
grant execute on function public.record_psira_registration(uuid, text, text, timestamptz) to authenticated;

-- ─── Fold the extracted check back into the original ─────────────────────────
--
-- agency_deactivate_officer shipped with this logic inline. Rewritten to call
-- the helper so there is one definition of "admin of this agency" rather than
-- two that can drift apart.

create or replace function public.agency_deactivate_officer(p_agency_membership_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid;
  v_agency   uuid;
  v_affected integer;
begin
  select am.user_id, am.agency_id into v_user, v_agency
    from public.agency_memberships am
   where am.id = p_agency_membership_id;

  if v_user is null then
    raise exception 'no_such_agency_membership' using errcode = '42704';
  end if;

  if not public.is_agency_admin(v_agency) and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_agency' using errcode = '42501';
  end if;

  update public.agency_memberships set is_active = false
   where id = p_agency_membership_id;

  update public.memberships m
     set is_active = false
   where m.user_id = v_user
     and m.role = 'guard'
     and m.is_active
     and m.placed_by_agency_id = v_agency;
  get diagnostics v_affected = row_count;

  return v_affected;
end;
$$;
