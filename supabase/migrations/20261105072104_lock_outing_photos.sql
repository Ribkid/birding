-- Close the outing-photo metadata leak found in security testing (2026-11-05).
--
-- get_public_outing() and get_profile_photos() deliberately gate who can see an outing's photos: the owner must be
-- on the leaderboard, or share a group with the viewer, or be the viewer (20261030130816_outing_photos.sql). But
-- outing_photos also carried a blanket
--     create policy "anyone reads outing photo rows" ... for select to anon, authenticated using (true)
-- so anyone holding the (public, by-design) anon key could read every row of the table — user_id, outing_uid and
-- the storage paths — for every user, including those NOT on the leaderboard. That walked straight around the gate
-- above and let the whole public outing-photos bucket be enumerated.
--
-- Direct table reads are now owner-only. The app only ever reads this table's own rows directly (the sync upsert,
-- the species tag update, and deleteAllOutingPhotos, all .eq('user_id', uid)); every public view goes through the
-- two RPCs above, which are SECURITY DEFINER and run as the table owner, so they bypass this policy and are
-- unaffected. get_public_outing stays granted to anon, so signed-out public outing pages keep working.
--
-- The bucket itself is still public; making it private (signed URLs behind a matching storage policy) is a separate
-- change that also touches the client's photo rendering.

drop policy if exists "anyone reads outing photo rows" on public.outing_photos;

create policy "owner reads own outing photos" on public.outing_photos for select to authenticated
  using (user_id = (select auth.uid()));

-- anon no longer reads the table at all; it uses get_public_outing (granted to anon) instead.
revoke select on public.outing_photos from anon;
