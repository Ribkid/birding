-- Public profiles and profile photos.
--   * profiles.public_id: an opaque id other people use to open a profile (auth user ids are never shown).
--   * profiles.avatar_path: a profile photo in the public 'avatars' bucket, always under the owner's own folder.
--   * profiles.show_dex: off by default. When on, the profile lists which species the person has found
--     (species only: never places, dates, notes or photos of sightings).
--   * get_leaderboard() also returns public_id and avatar_path so rows can open profiles and show photos.
--   * get_profile(public_id): name, photo, member since, counts by kind, outings, badges, and the found species
--     only when show_dex is on. Visible to signed-in people when the person is on the leaderboard or shares a
--     group with the viewer; always visible to its owner.
-- Additive only: no existing column, row or policy is changed or removed.

alter table public.profiles
  add column if not exists public_id uuid not null default gen_random_uuid(),
  add column if not exists avatar_path text,
  add column if not exists show_dex boolean not null default false;

create unique index if not exists profiles_public_id_key on public.profiles (public_id);

do $$ begin
  alter table public.profiles add constraint profiles_avatar_path_own
    check (avatar_path is null or (avatar_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]{1,80}$' and split_part(avatar_path, '/', 1) = user_id::text));
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- leaderboard: + public_id, + avatar_path
drop function if exists public.get_leaderboard(text, text, uuid, integer);
create function public.get_leaderboard(p_period text default 'life', p_kind text default null, p_group uuid default null, p_limit int default 50)
returns table (
  rank bigint, display_name text, avatar_species_id int, species int,
  bird int, mammal int, reptile int, frog int, butterfly int, plant int,
  outings int, badges int, is_me boolean, public_id uuid, avatar_path text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  today date := (now() at time zone 'Australia/Brisbane')::date;
  from_date date := case p_period when 'year' then date_trunc('year', today)::date
                                  when 'month' then date_trunc('month', today)::date end;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if p_group is not null and not public.is_group_member(p_group) then raise exception 'You are not in that group'; end if;
  if p_kind is not null and p_kind not in ('bird', 'mammal', 'reptile', 'frog', 'butterfly', 'plant') then raise exception 'Unknown kind'; end if;

  return query
  with people as (
    select p.user_id, p.display_name, p.avatar_species_id, p.badges_count, p.public_id, p.avatar_path
    from public.profiles p
    where case when p_group is null then p.show_on_leaderboard
               else exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = p.user_id) end
  ),
  seen as (
    select distinct s.user_id, s.species_id,
           coalesce(k.kind, case when s.species_id between 1 and 181 then 'bird' end) as kind
    from public.sightings s
    join people pe on pe.user_id = s.user_id
    left join public.species_kinds k on k.species_id = s.species_id
    where s.deleted_at is null and (from_date is null or s."date" >= from_date)
  ),
  counts as (
    select user_id,
           count(*) filter (where p_kind is null or kind = p_kind)::int as species,
           count(*) filter (where kind = 'bird')::int as bird,
           count(*) filter (where kind = 'mammal')::int as mammal,
           count(*) filter (where kind = 'reptile')::int as reptile,
           count(*) filter (where kind = 'frog')::int as frog,
           count(*) filter (where kind = 'butterfly')::int as butterfly,
           count(*) filter (where kind = 'plant')::int as plant
    from seen group by user_id
  ),
  outs as (
    select o.user_id, count(*)::int as n
    from public.outings o join people pe on pe.user_id = o.user_id
    where o.deleted_at is null and (from_date is null or o."date" >= from_date)
    group by o.user_id
  ),
  board as (
    select pe.user_id, pe.display_name, pe.avatar_species_id, pe.badges_count, pe.public_id, pe.avatar_path,
           coalesce(c.species, 0) as species, coalesce(c.bird, 0) as bird, coalesce(c.mammal, 0) as mammal,
           coalesce(c.reptile, 0) as reptile, coalesce(c.frog, 0) as frog, coalesce(c.butterfly, 0) as butterfly,
           coalesce(c.plant, 0) as plant, coalesce(ou.n, 0) as outings
    from people pe
    left join counts c on c.user_id = pe.user_id
    left join outs ou on ou.user_id = pe.user_id
  ),
  ranked as (
    select b.*, rank() over (order by b.species desc) as r
    from board b
    where b.species > 0 or b.user_id = me
  )
  select rk.r, coalesce(rk.display_name, 'Birder'), rk.avatar_species_id, rk.species,
         rk.bird, rk.mammal, rk.reptile, rk.frog, rk.butterfly, rk.plant,
         rk.outings, rk.badges_count, rk.user_id = me, rk.public_id, rk.avatar_path
  from ranked rk
  where rk.r <= greatest(1, least(coalesce(p_limit, 50), 200)) or rk.user_id = me
  order by rk.r, coalesce(rk.display_name, 'Birder');
end $$;

-- ---------------------------------------------------------------- one person's public profile
create or replace function public.get_profile(p_public_id uuid)
returns table (
  public_id uuid, display_name text, avatar_species_id int, avatar_path text, member_since date,
  species int, bird int, mammal int, reptile int, frog int, butterfly int, plant int,
  outings int, badges int, show_dex boolean, dex int[], is_me boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  them public.profiles%rowtype;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into them from public.profiles p where p.public_id = p_public_id;
  if not found then raise exception 'Profile not found'; end if;
  if them.user_id <> me and not them.show_on_leaderboard and not exists (
       select 1 from public.group_members a join public.group_members b on a.group_id = b.group_id
       where a.user_id = me and b.user_id = them.user_id) then
    raise exception 'Profile not found';
  end if;

  return query
  with seen as (
    select distinct s.species_id,
           coalesce(k.kind, case when s.species_id between 1 and 181 then 'bird' end) as kind
    from public.sightings s
    left join public.species_kinds k on k.species_id = s.species_id
    where s.user_id = them.user_id and s.deleted_at is null
  )
  select them.public_id, coalesce(them.display_name, 'Birder'), them.avatar_species_id, them.avatar_path,
         (them.created_at at time zone 'Australia/Brisbane')::date,
         (select count(*) from seen)::int,
         (select count(*) from seen where kind = 'bird')::int,
         (select count(*) from seen where kind = 'mammal')::int,
         (select count(*) from seen where kind = 'reptile')::int,
         (select count(*) from seen where kind = 'frog')::int,
         (select count(*) from seen where kind = 'butterfly')::int,
         (select count(*) from seen where kind = 'plant')::int,
         (select count(*) from public.outings o where o.user_id = them.user_id and o.deleted_at is null)::int,
         them.badges_count,
         them.show_dex,
         case when them.show_dex or them.user_id = me then (select array_agg(species_id order by species_id) from seen) end,
         them.user_id = me;
end $$;

revoke all on function public.get_leaderboard(text, text, uuid, integer) from public, anon;
revoke all on function public.get_profile(uuid) from public, anon;
grant execute on function public.get_leaderboard(text, text, uuid, integer) to authenticated;
grant execute on function public.get_profile(uuid) to authenticated;

-- ---------------------------------------------------------------- profile photos (public bucket)
-- Anyone may view a profile photo by its URL; only the owner can add, replace or remove files in their folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 400000, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do nothing;

do $$ begin
  create policy "own avatar insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own avatar update" on storage.objects for update to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
    with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "own avatar delete" on storage.objects for delete to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
exception when duplicate_object then null; end $$;
-- Owners can list their own folder (to tidy up old photos); public viewing goes through the public URL.
do $$ begin
  create policy "own avatar select" on storage.objects for select to authenticated
    using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
exception when duplicate_object then null; end $$;
