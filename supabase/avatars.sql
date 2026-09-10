-- ============================================================================
-- Avatars — private storage bucket, one file per user.
-- Paste into the Supabase SQL editor and run once. Safe to re-run.
-- ============================================================================

-- Private: an avatar is a photo of a person, so it is readable only by the
-- account it belongs to, through a short-lived signed URL. A public bucket
-- would serve it to anyone who learned the path.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Files live at <user-uuid>/avatar.jpg, so the first path segment is the owner.
drop policy if exists "own avatar select" on storage.objects;
create policy "own avatar select" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own avatar insert" on storage.objects;
create policy "own avatar insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own avatar update" on storage.objects;
create policy "own avatar update" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own avatar delete" on storage.objects;
create policy "own avatar delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
