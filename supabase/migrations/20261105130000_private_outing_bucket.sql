-- Make the outing-photos bucket private so Storage RLS actually governs reads.
--
-- A public bucket serves /storage/v1/object/public/... with no auth and no RLS, so even after the table was locked
-- (20261105072104_lock_outing_photos.sql) any known path still downloaded for anyone, and a leaked URL was permanent.
-- The client now shows outing photos through short-lived signed URLs (createSignedUrls), which do enforce RLS. This
-- storage SELECT policy gates who may sign a path to the SAME rule as get_public_outing / get_profile_photos: the
-- owner, someone who shares a group with her, or anyone while she is on the leaderboard.
--
-- can_read_outing_photo() is SECURITY DEFINER so it can read profiles / group_members (which have their own RLS)
-- while being evaluated for an anon or authenticated caller. The object's owner is the first path segment
-- ({user_id}/{outingUid}/{uid}.jpg). Insert/update/delete storage policies are unchanged (owner-only).

create or replace function public.can_read_outing_photo(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles pr
    where pr.user_id::text = split_part(object_name, '/', 1)
      and (
        pr.show_on_leaderboard
        or pr.user_id = (select auth.uid())
        or exists (
          select 1 from public.group_members a
          join public.group_members b on a.group_id = b.group_id
          where a.user_id = (select auth.uid()) and b.user_id = pr.user_id
        )
      )
  );
$$;

revoke execute on function public.can_read_outing_photo(text) from public;
grant execute on function public.can_read_outing_photo(text) to anon, authenticated;

-- Reads were "anyone in the bucket"; now they are gated by visibility. Signing a path only succeeds when this passes.
drop policy if exists "anyone reads outing photos" on storage.objects;
create policy "read visible outing photos" on storage.objects for select to anon, authenticated
  using (bucket_id = 'outing-photos' and public.can_read_outing_photo(name));

-- Finally, take the bucket off the unauthenticated public route.
update storage.buckets set public = false where id = 'outing-photos';
