-- Alumni business directory (design/prototypes/screens/businesses.html).
-- Members list a business they own or run; the listing links to their profile.

create table public.business_listings (
  id             uuid primary key default gen_random_uuid(),
  owner_user_id  uuid not null references auth.users (id) on delete cascade,
  name           text not null check (char_length(name) between 1 and 200),
  category       text not null check (char_length(category) between 1 and 80),
  description    text check (char_length(description) <= 2000),
  website        text check (website is null or website ~* '^https?://'),
  place_id       integer references public.places (id),
  city           text check (char_length(city) <= 100),
  state          text check (char_length(state) <= 2),
  alumni_offer   text check (char_length(alumni_offer) <= 300),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index business_listings_owner_idx on public.business_listings (owner_user_id);

create function public.business_listings_before_write() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  if new.place_id is not null then
    select p.name, p.state into new.city, new.state from public.places p where p.id = new.place_id;
  end if;
  return new;
end;
$$;
create trigger business_listings_before_write before insert or update on public.business_listings
  for each row execute function public.business_listings_before_write();

alter table public.business_listings enable row level security;
revoke all on public.business_listings from anon, authenticated;
grant select, insert, delete on public.business_listings to authenticated;
grant update (name, category, description, website, place_id, city, state, alumni_offer) on public.business_listings to authenticated;

create policy "members read businesses" on public.business_listings
  for select to authenticated using (public.is_verified_member());
create policy "members list their business" on public.business_listings
  for insert to authenticated with check (owner_user_id = auth.uid() and public.is_verified_member());
create policy "owners and admins change listings" on public.business_listings
  for update to authenticated
  using (owner_user_id = auth.uid() or public.is_admin())
  with check (owner_user_id = auth.uid() or public.is_admin());
create policy "owners and admins delete listings" on public.business_listings
  for delete to authenticated using (owner_user_id = auth.uid() or public.is_admin());

create function public.business_directory()
returns table (id uuid, name text, category text, description text, website text, city text, state text, alumni_offer text,
               owner_name text, owner_person_id uuid, is_mine boolean)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.name, b.category, b.description, b.website, b.city, b.state, b.alumni_offer,
         public.member_display_name(b.owner_user_id),
         (select p.id from public.people p where p.claimed_by_user_id = b.owner_user_id limit 1),
         b.owner_user_id = auth.uid()
    from public.business_listings b
   where public.is_verified_member()
   order by b.name
   limit 500;
$$;

revoke all on function public.business_listings_before_write() from public, anon, authenticated;
revoke all on function public.business_directory() from public, anon;
grant execute on function public.business_directory() to authenticated;
