-- Tell people when an administrator approves their claim, and point them at the
-- short setup. Claims that match an email on file are approved on the spot and
-- land on setup directly, so only manual approvals need this.

alter table public.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('message', 'intro_request', 'intro_invite', 'intro_update', 'claim_approved'));

create function public.notify_claim_approved() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, kind, title, link, ref_id)
  values (new.user_id, 'claim_approved', 'You’re approved: finish setting up your Alumni Connect profile', '/welcome', new.id);
  return new;
end;
$$;

create trigger claim_requests_notify_approved
  after update of status on public.claim_requests
  for each row
  when (old.status = 'pending' and new.status = 'approved' and new.method = 'manual')
  execute function public.notify_claim_approved();
