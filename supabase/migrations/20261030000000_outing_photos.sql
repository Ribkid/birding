-- Public outing photos and likes. Additive except for replacing delete_my_account so its storage cleanup
-- includes this bucket. Photo JPEGs are re-encoded on the phone before upload; no EXIF or GPS metadata is kept.
-- Public RPCs return only the fields their screens need. In particular, get_public_outing never returns lat/lng.

-- ---------------------------------------------------------------- public photo bucket

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('outing-photos', 'outing-photos', true, 3145728, array['image/jpeg'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "anyone reads outing photos" on storage.objects;
drop policy if exists "own outing photos insert" on storage.objects;
drop policy if exists "own outing photos update" on storage.objects;
drop policy if exists "own outing photos delete" on storage.objects;
create policy "anyone reads outing photos" on storage.objects for select to anon, authenticated
  using (bucket_id = 'outing-photos');
create policy "own outing photos insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'outing-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own outing photos update" on storage.objects for update to authenticated
  using (bucket_id = 'outing-photos' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'outing-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "own outing photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'outing-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------- photos and likes

create table if not exists public.outing_photos (
  id          uuid primary key default gen_random_uuid(),
  uid         text not null unique,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  outing_uid  text not null,
  path        text not null,
  thumb_path  text not null,
  taken_at    timestamptz,
  species_id  int,
  w           int,
  h           int,
  like_count  int not null default 0 check (like_count >= 0),
  created_at  timestamptz not null default now()
);

create index if not exists outing_photos_user_created on public.outing_photos (user_id, created_at desc);
create index if not exists outing_photos_outing on public.outing_photos (outing_uid, user_id);

create table if not exists public.photo_likes (
  photo_id    uuid not null references public.outing_photos (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (photo_id, user_id)
);

create index if not exists photo_likes_user on public.photo_likes (user_id);

alter table public.outing_photos enable row level security;
alter table public.photo_likes enable row level security;

drop policy if exists "anyone reads outing photo rows" on public.outing_photos;
drop policy if exists "owner inserts outing photos" on public.outing_photos;
drop policy if exists "owner updates outing photos" on public.outing_photos;
drop policy if exists "owner deletes outing photos" on public.outing_photos;
create policy "anyone reads outing photo rows" on public.outing_photos for select to anon, authenticated using (true);
create policy "owner inserts outing photos" on public.outing_photos for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "owner updates outing photos" on public.outing_photos for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "owner deletes outing photos" on public.outing_photos for delete to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "own photo like insert" on public.photo_likes;
drop policy if exists "own photo like delete" on public.photo_likes;
create policy "own photo like insert" on public.photo_likes for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own photo like delete" on public.photo_likes for delete to authenticated
  using (user_id = (select auth.uid()));

-- Column privileges keep uid, ownership and like_count from being rewritten through a table update or upsert.
revoke all on public.outing_photos, public.photo_likes from anon, authenticated;
grant select on public.outing_photos to anon, authenticated;
grant insert, delete on public.outing_photos to authenticated;
grant update (outing_uid, path, thumb_path, taken_at, species_id, w, h) on public.outing_photos to authenticated;
grant insert, delete on public.photo_likes to authenticated;

-- Check here too, not only in toggle_photo_like: a direct table insert must not get around the self-like rule.
create or replace function public.guard_photo_like()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
begin
  select p.user_id into owner from public.outing_photos p where p.id = new.photo_id;
  if owner is null then raise exception 'Photo not found'; end if;
  if new.user_id is distinct from auth.uid() then raise exception 'You can only like as yourself'; end if;
  if owner = new.user_id then raise exception 'You cannot like your own photo'; end if;
  return new;
end $$;

create or replace function public.update_photo_like_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.outing_photos set like_count = like_count + 1 where id = new.photo_id;
  else
    update public.outing_photos set like_count = greatest(0, like_count - 1) where id = old.photo_id;
  end if;
  return null;
end $$;

drop trigger if exists guard_photo_like on public.photo_likes;
create trigger guard_photo_like before insert on public.photo_likes
  for each row execute function public.guard_photo_like();
drop trigger if exists update_photo_like_count on public.photo_likes;
create trigger update_photo_like_count after insert or delete on public.photo_likes
  for each row execute function public.update_photo_like_count();

-- ---------------------------------------------------------------- likes

create or replace function public.toggle_photo_like(p_photo uuid)
returns table (liked boolean, like_count int)
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  owner uuid;
  was_liked boolean;
  now_liked boolean;
  n int;
begin
  if me is null then raise exception 'Sign in first'; end if;
  select p.user_id into owner from public.outing_photos p where p.id = p_photo;
  if owner is null then raise exception 'Photo not found'; end if;
  if owner = me then raise exception 'You cannot like your own photo'; end if;

  select exists (
    select 1 from public.photo_likes l where l.photo_id = p_photo and l.user_id = me
  ) into was_liked;
  if was_liked then
    delete from public.photo_likes l where l.photo_id = p_photo and l.user_id = me;
  else
    insert into public.photo_likes (photo_id, user_id) values (p_photo, me);
  end if;
  now_liked := not was_liked;
  select p.like_count into n from public.outing_photos p where p.id = p_photo;
  return query select now_liked, n;
end $$;

-- ---------------------------------------------------------------- one public outing
-- Only an outing with at least one photo is returned. There are deliberately no coordinate fields in this object.

create or replace function public.get_public_outing(p_public_id uuid, p_outing_uid text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  o record;
begin
  select o.uid, o."date", o.place, o.distance_km, o.duration_min, o.user_id
  into o
  from public.outings o
  join public.profiles pr on pr.user_id = o.user_id
  where pr.public_id = p_public_id and o.uid::text = p_outing_uid and o.deleted_at is null
    and exists (select 1 from public.outing_photos p where p.outing_uid = o.uid::text and p.user_id = o.user_id);
  if not found then return null; end if;

  return (
    select jsonb_build_object(
      'publicId', p_public_id,
      'outingUid', o.uid::text,
      'date', o."date",
      'place', o.place,
      'speciesCount', (select count(distinct s.species_id)::int from public.sightings s
        where s.outing_uid = o.uid and s.deleted_at is null),
      'distanceKm', o.distance_km,
      'durationMin', o.duration_min,
      'photos', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id, 'uid', p.uid, 'outingUid', p.outing_uid,
          'path', p.path, 'thumbPath', p.thumb_path, 'takenAt', p.taken_at,
          'speciesId', p.species_id, 'w', p.w, 'h', p.h,
          'likeCount', p.like_count,
          'liked', exists (select 1 from public.photo_likes l where l.photo_id = p.id and l.user_id = me)
        ) order by p.created_at desc, p.id)
        from public.outing_photos p
        where p.outing_uid = o.uid::text and p.user_id = o.user_id
      ), '[]'::jsonb)
    )
  );
end $$;

-- ---------------------------------------------------------------- profile photo sections

create or replace function public.get_profile_photos(p_public_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
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

  return jsonb_build_object(
    'mostLiked', coalesce((
      select jsonb_agg(x.photo) from (
        select jsonb_build_object(
          'id', p.id, 'uid', p.uid, 'outingUid', p.outing_uid,
          'path', p.path, 'thumbPath', p.thumb_path, 'takenAt', p.taken_at,
          'speciesId', p.species_id, 'w', p.w, 'h', p.h,
          'likeCount', p.like_count,
          'liked', exists (select 1 from public.photo_likes l where l.photo_id = p.id and l.user_id = me)
        ) as photo
        from public.outing_photos p
        where p.user_id = them.user_id
        order by p.like_count desc, p.created_at desc, p.id
        limit 9
      ) x
    ), '[]'::jsonb),
    'outings', coalesce((
      select jsonb_agg(x.outing) from (
        select jsonb_build_object(
          'outingUid', o.uid::text, 'date', o."date", 'place', o.place,
          'photoCount', count(p.id)::int,
          'coverThumb', (select p2.thumb_path from public.outing_photos p2
            where p2.outing_uid = o.uid::text and p2.user_id = o.user_id
            order by p2.created_at desc, p2.id limit 1)
        ) as outing
        from public.outings o
        join public.outing_photos p on p.outing_uid = o.uid::text and p.user_id = o.user_id
        where o.user_id = them.user_id and o.deleted_at is null
        group by o.uid, o."date", o.place, o.started_at_ms
        order by o."date" desc nulls last, o.started_at_ms desc nulls last, o.uid
      ) x
    ), '[]'::jsonb)
  );
end $$;

-- ---------------------------------------------------------------- delete my account
-- Keep the existing account cleanup and remove this bucket's files too. Table rows and likes cascade from auth.users.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first'; end if;
  delete from public.groups g where g.created_by = me
    and not exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id <> me);
  delete from storage.objects where bucket_id = 'outing-photos'
    and (storage.foldername(name))[1] = me::text;
  delete from auth.users where id = me;
end $$;

-- ---------------------------------------------------------------- function permissions

revoke execute on function public.toggle_photo_like(uuid), public.get_public_outing(uuid, text),
  public.get_profile_photos(uuid), public.delete_my_account(), public.guard_photo_like(),
  public.update_photo_like_count() from public, anon;
grant execute on function public.toggle_photo_like(uuid), public.get_profile_photos(uuid),
  public.delete_my_account() to authenticated;
grant execute on function public.get_public_outing(uuid, text) to authenticated, anon;
revoke execute on function public.guard_photo_like(), public.update_photo_like_count() from authenticated;
