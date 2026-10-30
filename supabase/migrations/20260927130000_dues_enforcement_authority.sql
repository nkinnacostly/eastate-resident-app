-- Estate Access Platform — enforcement needs authority, not just configuration
--
-- Blocking a resident's visitor codes over unpaid levies is lawful in a narrow
-- seam, and nowhere near as settled as "the estate decided to" would suggest.
-- This migration makes an estate say so explicitly before the gate will bite.
--
-- ─── The law, briefly, because it shapes the column ──────────────────────────
--
-- ZA COMMUNITY SCHEMES. The CSOS Consolidated Practice Directive 1 of 2025 lists as
-- UNDESIRABLE: "Rules preventing the member/tenant/occupier access to the
-- property for non-payment of levies will not be passed." The Chief Ombud's own
-- training material goes further -- "deny OR LIMIT access" -- and CSOS treats a
-- denial-of-access complaint as grounds for 24-hour urgent adjudication.
--
-- Against that, Koko v Mont Tremblant Estate HOA (2026/111982) is on this exact
-- mechanic. An HOA disabled a resident's estate-app profile; his own biometric
-- access still worked. The court distinguished the two: personal access is an
-- incident of possession and protected by spoliation, while visitor-management
-- functionality is "an administrative facility, not an incident of possession".
--
-- So the seam is real, and it is exactly where this feature sits: we gate
-- MINTING and never verification. A resident in arrears still opens their own
-- gate, and their visitor can still be admitted -- the guard's admit-and-flag
-- override is unaffected by any of this and cannot be switched off by an
-- arrears flag. That override is not a convenience; it is what keeps the
-- feature on the lawful side of every authority found.
--
-- But the seam is ONE first-instance judgment, in a jurisdiction whose
-- regulator reads the line more strictly, while the SCA has granted leave to
-- appeal a related case (Leggatt v Blair Atholl HOA). The commentary on Koko is
-- pointed: "Some HOAs may think this judgment gives them permission to punish
-- owners by cutting off app access. It does not."
--
-- NIGERIA has no HOA statute; the obligation is contractual. A Lagos High Court
-- ruling on Lekki Gardens upheld restricting main-gate access for an unpaid
-- service charge -- but conditioned on an alternative route existing, and the
-- merits reasoning was obiter after the case was struck out on procedure.
-- "Absolute blockage is unlawful."
--
-- ─── What that means for the schema ──────────────────────────────────────────
--
-- Configuring an amount is a billing decision. Withholding a service over
-- arrears is a legal one, and it is the estate's to make and to answer for --
-- what separates a scheme whose rules support it from one whose rule CSOS would
-- refuse to register. So it is a SEPARATE, EXPLICIT act with an actor, a
-- timestamp and a recorded basis, and dues_in_arrears returns false without it.
--
-- An estate can therefore bill dues through this platform and never restrict
-- anybody, which is the default and, for a ZA community scheme, the safer posture.

alter table public.estates
  add column dues_enforcement_authorised_at timestamptz;
alter table public.estates
  add column dues_enforcement_authorised_by uuid references public.memberships (id);
-- Free text on purpose. "AGM resolution 2026-03-14" and "MOI clause 11.4" are
-- both good answers and an enum would fit neither.
alter table public.estates
  add column dues_enforcement_basis text;

alter table public.estates
  add constraint estates_dues_enforcement_ck check (
    dues_enforcement_authorised_at is null
    or (dues_enforcement_authorised_by is not null
        and btrim(coalesce(dues_enforcement_basis, '')) <> '')
  );

comment on column public.estates.dues_enforcement_authorised_at is
  'When this estate recorded authority to withhold code generation for arrears. '
  'Null means bill but never restrict -- the default. See the migration header '
  'for why this is separate from configuring an amount.';

-- ─── The gate now requires it ────────────────────────────────────────────────

create or replace function public.dues_in_arrears(p_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    -- Unauthorised enforcement is not enforcement. An estate that has not
    -- recorded a basis bills normally and restricts nobody, however deep the
    -- arrears -- which is the correct default in a jurisdiction whose regulator
    -- classifies the opposite rule as undesirable.
    when e.dues_enforcement_authorised_at is null then false
    when e.dues_billing_mode = 'none' then false

    when e.dues_billing_mode = 'per_house' then
      m.house_id is not null and exists (
        select 1 from public.dues_charges c
         where c.house_id = m.house_id
           and c.status = 'open'
           and c.due_on < current_date)

    when e.dues_billing_mode = 'per_resident' then exists (
      select 1 from public.dues_charges c
       where c.membership_id = m.id
         and c.status = 'open'
         and c.due_on < current_date)
  end
  from public.memberships m
  join public.estates e on e.id = m.estate_id
  where m.id = p_membership_id;
$$;

-- ─── Recording the authority ─────────────────────────────────────────────────

create function public.set_dues_enforcement(
  p_estate_id uuid,
  p_authorised boolean,
  p_basis      text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.current_membership(p_estate_id, 'admin');
begin
  if v_admin is null and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_estate' using errcode = '42501';
  end if;

  if p_authorised then
    -- A basis is required because the estate will one day be asked for it, by
    -- a resident or by an adjudicator, and "the software let us" is not one.
    if btrim(coalesce(p_basis, '')) = '' then
      raise exception 'enforcement_basis_required' using errcode = '22023';
    end if;
    update public.estates
       set dues_enforcement_authorised_at = now(),
           dues_enforcement_authorised_by = v_admin,
           dues_enforcement_basis = btrim(p_basis)
     where id = p_estate_id;
  else
    -- Switching off clears the basis too: a stale basis left behind would
    -- later read as authority nobody currently claims.
    update public.estates
       set dues_enforcement_authorised_at = null,
           dues_enforcement_authorised_by = null,
           dues_enforcement_basis = null
     where id = p_estate_id;
  end if;
end;
$$;

revoke execute on function public.set_dues_enforcement(uuid, boolean, text) from public, anon;
grant  execute on function public.set_dues_enforcement(uuid, boolean, text) to authenticated;
