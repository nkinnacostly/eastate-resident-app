-- Estate Access Platform — configuring dues
--
-- The Dues page could read a configuration and authorise enforcement, and there
-- was no way to set the configuration in the first place. This is that.
--
-- Deliberately separate from set_dues_enforcement. Choosing who is billed and
-- how much is an administrative decision an estate makes freely; withholding a
-- service over arrears is a legal one it has to be able to justify. Folding
-- them into one call would make it possible to switch enforcement on as a side
-- effect of editing an amount, which is exactly the slip the split exists to
-- prevent.

create function public.set_dues_config(
  p_estate_id    uuid,
  p_billing_mode public.dues_billing_mode,
  p_amount_minor bigint  default null,
  p_currency     text    default null,
  p_grace_days   integer default null
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

  if p_billing_mode <> 'none' then
    -- Checked here as well as by the table constraint so the caller gets a
    -- reason rather than a constraint name. Both matter: the constraint is what
    -- makes it true, this is what makes it explicable.
    if p_amount_minor is null or p_amount_minor <= 0 then
      raise exception 'dues_amount_required' using errcode = '22023';
    end if;
    if p_currency is null or p_currency not in ('NGN', 'ZAR') then
      raise exception 'unsupported_currency' using errcode = '22023';
    end if;
  end if;

  update public.estates
     set dues_billing_mode = p_billing_mode,
         -- Switching to 'none' clears the money rather than leaving a stale
         -- amount behind that would silently reappear if billing were switched
         -- back on months later at a rate nobody agreed to.
         dues_amount_minor = case when p_billing_mode = 'none' then null else p_amount_minor end,
         dues_currency     = case when p_billing_mode = 'none' then null else p_currency end,
         dues_grace_days   = coalesce(p_grace_days, dues_grace_days)
   where id = p_estate_id;

  if not found then
    raise exception 'no_such_estate' using errcode = '42704';
  end if;
end;
$$;

revoke execute on function public.set_dues_config(uuid, public.dues_billing_mode, bigint, text, integer)
  from public, anon;
grant execute on function public.set_dues_config(uuid, public.dues_billing_mode, bigint, text, integer)
  to authenticated;

comment on function public.set_dues_config is
  'Who is billed and how much. Says nothing about enforcement -- that is '
  'set_dues_enforcement, and it is separate because it is a legal decision '
  'rather than an administrative one.';

-- ─── Raising the first month immediately ─────────────────────────────────────
--
-- An estate configured on the 8th would otherwise owe nothing until the 1st of
-- next month, which reads as "it is not working" on the very screen the admin
-- just used. This raises the current period on demand, and is the same
-- re-runnable insert as the cron -- calling it twice bills nobody twice.

create function public.raise_current_dues(p_estate_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_admin uuid := public.current_membership(p_estate_id, 'admin');
  v_count integer;
begin
  if v_admin is null and not public.is_platform_admin() then
    raise exception 'not_an_admin_at_this_estate' using errcode = '42501';
  end if;

  -- Reuses the monthly run rather than duplicating its logic, so the two can
  -- never disagree about who is billable. It is estate-wide by design: the
  -- function is idempotent, and a second estate's charges for this month
  -- already exist by the time anyone calls this.
  v_count := public.generate_dues_charges(date_trunc('month', current_date)::date);
  return v_count;
end;
$$;

revoke execute on function public.raise_current_dues(uuid) from public, anon;
grant  execute on function public.raise_current_dues(uuid) to authenticated;
