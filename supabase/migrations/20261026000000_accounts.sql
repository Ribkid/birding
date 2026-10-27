-- Sarah's BirdyDex: accounts, cloud sync, private photos, leaderboard and groups.
-- Run once in the Supabase SQL editor (or `supabase db push`). Safe to re-run.
--
-- Privacy model
--   * sightings, outings, patches, profiles: Row Level Security, owner only.
--   * photos: private Storage bucket, owner-only paths {user_id}/{uid}.jpg.
--   * groups: members only, joined with a 6-character code through RPCs.
--   * get_leaderboard(): security definer, returns ONLY aggregate counts (no places, dates, notes, photos).

-- ---------------------------------------------------------------- helpers

-- Last write wins: ignore an update that is older than what the server already has,
-- never let a row change owner, and stamp synced_at so other devices can pull it.
create or replace function public.keep_newest()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    if new.updated_at < old.updated_at then
      return null;  -- older edit: keep the newer row as it is
    end if;
    new.user_id := old.user_id;
  end if;
  new.synced_at := clock_timestamp();
  return new;
end $$;

-- ---------------------------------------------------------------- profiles

create table if not exists public.profiles (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  display_name        text check (display_name is null or char_length(display_name) between 1 and 40),
  avatar_species_id   int,
  show_on_leaderboard boolean not null default true,
  settings            jsonb not null default '{}'::jsonb,
  badges_count        int not null default 0 check (badges_count between 0 and 10000),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  synced_at           timestamptz not null default now()
);

-- A profile row appears as soon as someone signs up. Google gives a name; email sign-ups pick one in Settings.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), 40), ''))
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- sightings, outings, patches
-- Columns mirror the local IndexedDB records (js/app.js saveSighting, openStartOuting, openFinishOuting).
-- `uid` is made on the device; any field the app adds later travels in `extra`.

create table if not exists public.outings (
  uid           uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  "date"        date,
  "time"        text,
  started_at_ms bigint,
  past          boolean,
  place         text,
  lat           double precision,
  lng           double precision,
  ended_at_ms   bigint,
  complete      boolean,
  distance_km   double precision,
  duration_min  int,
  notes         text,
  extra         jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null,
  deleted_at    timestamptz,
  synced_at     timestamptz not null default now()
);

create table if not exists public.sightings (
  uid           uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  species_id    int not null,
  "count"       int,
  heard         boolean,
  "date"        date,
  "time"        text,
  lat           double precision,
  lng           double precision,
  acc           double precision,
  place         text,
  notes         text,
  photo_uid     uuid,
  outing_uid    uuid,
  created_at_ms bigint,
  extra         jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null,
  deleted_at    timestamptz,
  synced_at     timestamptz not null default now()
);

create table if not exists public.patches (
  uid        uuid primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name       text,
  lat        double precision,
  lng        double precision,
  radius_km  double precision,
  extra      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  synced_at  timestamptz not null default now()
);

create index if not exists sightings_user_synced on public.sightings (user_id, synced_at);
create index if not exists sightings_user_species on public.sightings (user_id, species_id) where deleted_at is null;
create index if not exists outings_user_synced on public.outings (user_id, synced_at);
create index if not exists patches_user_synced on public.patches (user_id, synced_at);

drop trigger if exists keep_newest on public.sightings;
create trigger keep_newest before insert or update on public.sightings for each row execute function public.keep_newest();
drop trigger if exists keep_newest on public.outings;
create trigger keep_newest before insert or update on public.outings for each row execute function public.keep_newest();
drop trigger if exists keep_newest on public.patches;
create trigger keep_newest before insert or update on public.patches for each row execute function public.keep_newest();
drop trigger if exists keep_newest on public.profiles;
create trigger keep_newest before insert or update on public.profiles for each row execute function public.keep_newest();

-- ---------------------------------------------------------------- row level security (owner only)

alter table public.profiles  enable row level security;
alter table public.sightings enable row level security;
alter table public.outings   enable row level security;
alter table public.patches   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['sightings', 'outings', 'patches', 'profiles'] loop
    execute format('drop policy if exists "owner select" on public.%I', t);
    execute format('drop policy if exists "owner insert" on public.%I', t);
    execute format('drop policy if exists "owner update" on public.%I', t);
    execute format('drop policy if exists "owner delete" on public.%I', t);
    execute format('create policy "owner select" on public.%I for select to authenticated using (user_id = (select auth.uid()))', t);
    execute format('create policy "owner insert" on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t);
    execute format('create policy "owner update" on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
    execute format('create policy "owner delete" on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- Nobody signed out can touch anything.
revoke all on public.profiles, public.sightings, public.outings, public.patches from anon;

-- ---------------------------------------------------------------- species kinds (for leaderboard filters)
-- Filled by the companion migration made with `node scripts/species-kinds-sql.mjs`.

create table if not exists public.species_kinds (
  species_id int primary key,
  kind       text not null check (kind in ('bird', 'mammal', 'reptile', 'frog', 'butterfly', 'plant'))
);
alter table public.species_kinds enable row level security;
drop policy if exists "anyone reads kinds" on public.species_kinds;
create policy "anyone reads kinds" on public.species_kinds for select using (true);

-- ---------------------------------------------------------------- photos (private bucket)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "own photos select" on storage.objects;
drop policy if exists "own photos insert" on storage.objects;
drop policy if exists "own photos update" on storage.objects;
drop policy if exists "own photos delete" on storage.objects;
create policy "own photos select" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own photos insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own photos update" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------- groups

create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 40),
  code       text not null unique check (code ~ '^[A-Z2-9]{6}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id  uuid not null references public.groups (id) on delete cascade,
  user_id   uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_members_user on public.group_members (user_id);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;

create or replace function public.is_group_member(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.group_members where group_id = p_group and user_id = auth.uid());
$$;

-- Members can see their groups (name and code, to share it) and their own memberships.
-- Creating, joining and leaving go through the functions below.
drop policy if exists "members see group" on public.groups;
create policy "members see group" on public.groups for select to authenticated using (public.is_group_member(id));
drop policy if exists "see own memberships" on public.group_members;
create policy "see own memberships" on public.group_members for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.groups, public.group_members from anon;
revoke insert, update, delete on public.groups, public.group_members from authenticated;

create or replace function public.create_group(p_name text)
returns table (id uuid, name text, code text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  c text;
  g uuid;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if char_length(trim(coalesce(p_name, ''))) not between 1 and 40 then raise exception 'Give the group a name of up to 40 letters'; end if;
  if (select count(*) from public.groups gr where gr.created_by = me) >= 20 then raise exception 'You have made 20 groups already'; end if;
  loop
    c := '';
    for i in 1..6 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    begin
      insert into public.groups (name, code, created_by) values (trim(p_name), c, me) returning groups.id into g;
      exit;
    exception when unique_violation then
      -- code taken, try another
    end;
  end loop;
  insert into public.group_members (group_id, user_id) values (g, me);
  return query select g, trim(p_name), c;
end $$;

create or replace function public.join_group(p_code text)
returns table (id uuid, name text, code text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  me uuid := auth.uid();
  gr public.groups;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select * into gr from public.groups g where g.code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if gr.id is null then raise exception 'No group has that code'; end if;
  insert into public.group_members (group_id, user_id) values (gr.id, me) on conflict do nothing;
  return query select gr.id, gr.name, gr.code;
end $$;

create or replace function public.leave_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.group_members where group_id = p_group and user_id = auth.uid();
  delete from public.groups g where g.id = p_group and not exists (select 1 from public.group_members m where m.group_id = g.id);
end $$;

create or replace function public.my_groups()
returns table (id uuid, name text, code text, members int)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select g.id, g.name, g.code, (select count(*)::int from public.group_members m2 where m2.group_id = g.id)
  from public.groups g
  join public.group_members m on m.group_id = g.id and m.user_id = auth.uid()
  order by g.name;
$$;

-- ---------------------------------------------------------------- leaderboard
-- Returns only aggregates. "Everyone" lists people who left "Show me on the leaderboard" on;
-- a group board lists every member of that group (only members can ask for it).
-- p_period: 'life' | 'year' | 'month' (calendar, Brisbane time). p_kind: null for all, or a kind.

create or replace function public.get_leaderboard(p_period text default 'life', p_kind text default null, p_group uuid default null, p_limit int default 50)
returns table (
  rank bigint, display_name text, avatar_species_id int, species int,
  bird int, mammal int, reptile int, frog int, butterfly int, plant int,
  outings int, badges int, is_me boolean
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
    select p.user_id, p.display_name, p.avatar_species_id, p.badges_count
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
    select pe.user_id, pe.display_name, pe.avatar_species_id, pe.badges_count,
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
         rk.outings, rk.badges_count, rk.user_id = me
  from ranked rk
  where rk.r <= greatest(1, least(coalesce(p_limit, 50), 200)) or rk.user_id = me
  order by rk.r, coalesce(rk.display_name, 'Birder');
end $$;

-- ---------------------------------------------------------------- delete my account
-- The app removes the person's photos through the Storage API first, then calls this.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first'; end if;
  delete from public.groups g where g.created_by = me
    and not exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id <> me);
  delete from auth.users where id = me;  -- cascades to profiles, sightings, outings, patches, memberships
end $$;

-- ---------------------------------------------------------------- function permissions

revoke execute on function public.create_group(text), public.join_group(text), public.leave_group(uuid),
  public.my_groups(), public.get_leaderboard(text, text, uuid, int), public.delete_my_account(),
  public.is_group_member(uuid), public.handle_new_user(), public.keep_newest() from public, anon;
grant execute on function public.create_group(text), public.join_group(text), public.leave_group(uuid),
  public.my_groups(), public.get_leaderboard(text, text, uuid, int), public.delete_my_account(),
  public.is_group_member(uuid) to authenticated;
-- Trigger functions are never called directly.
revoke execute on function public.handle_new_user(), public.keep_newest() from authenticated;
