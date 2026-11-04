-- Internal housekeeping: only the introduction functions (security definer) call this.
revoke execute on function public.expire_intro_requests() from authenticated;
