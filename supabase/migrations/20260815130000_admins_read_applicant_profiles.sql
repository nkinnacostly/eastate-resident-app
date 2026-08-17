-- An admin must be able to see WHO is asking to join.
--
-- The existing policy, "profiles: admins read their estate's members", requires
-- a membership:
--
--     exists (select 1 from memberships m where m.user_id = profiles.id ...)
--
-- A pending applicant has no membership yet — that is the entire point of the
-- request — so the admin could read the join_requests row but not the profile
-- attached to it. The approvals list rendered a request with a null name and no
-- phone: a decision to make about nobody in particular.
--
-- Scoped as tightly as the job allows: only profiles with a PENDING request at
-- an estate this caller administers. Once the request is approved the existing
-- membership policy takes over; once declined, visibility ends with it.

create policy "profiles: admins read pending applicants"
  on public.profiles for select to authenticated
  using (
    exists (
      select 1
        from public.join_requests j
       where j.user_id = profiles.id
         and j.status = 'pending'
         and public.has_membership(j.estate_id, 'admin')
    )
  );
