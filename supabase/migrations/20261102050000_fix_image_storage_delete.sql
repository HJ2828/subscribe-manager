drop policy if exists "user_images_select_own" on storage.objects;
create policy "user_images_select_own"
on storage.objects for select
to authenticated
using (
  bucket_id = 'user-images'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "user_images_update_own" on storage.objects;
create policy "user_images_update_own"
on storage.objects for update
to authenticated
using (
  bucket_id = 'user-images'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'user-images'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

drop policy if exists "user_images_delete_own" on storage.objects;
create policy "user_images_delete_own"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'user-images'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

comment on policy "user_images_delete_own" on storage.objects is
  'Authenticated users may delete only objects inside their own user-id folder.';
