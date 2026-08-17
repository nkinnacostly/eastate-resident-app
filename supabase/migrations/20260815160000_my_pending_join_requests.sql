-- Let an applicant see the request they are waiting on.
--
-- RLS already lets someone read their own `join_requests` row, but NOT the
-- `estates` or `houses` rows it points at: both policies require a membership,
-- which is precisely what a pending applicant does not have. So the join screen
-- could tell them a request exists and not where it went.
--
-- Widening those two policies to "anyone with a pending row" would turn one
-- guessed code into a readable estate record, so instead this definer function
-- returns the two labels the screen needs and nothing else. Scoped to
-- auth.uid(), never a caller-supplied id.
--
-- Why the screen needs it at all: the codes are collected at sign-up now, so by
-- the time the join screen mounts the request has usually already been sent.
-- Without a server read it would show an empty form to someone who is simply
-- waiting, and they would send the same request again.

create or replace function public.my_pending_join_requests()
returns table (
  estate_id    uuid,
  estate_name  text,
  house_number text,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select j.estate_id, e.name, h.house_number, j.created_at
    from public.join_requests j
    join public.estates e on e.id = j.estate_id
    -- left join: house_id is nullable for rows created before houses existed.
    left join public.houses h on h.id = j.house_id
   where j.user_id = (select auth.uid())
     and j.status = 'pending'
   order by j.created_at desc;
$$;

-- EXECUTE is granted to PUBLIC by default, which would make this anon-callable.
revoke execute on function public.my_pending_join_requests() from public;
grant execute on function public.my_pending_join_requests() to authenticated;
