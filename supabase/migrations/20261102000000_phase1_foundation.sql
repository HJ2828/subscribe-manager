create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  country_code text not null default 'KR',
  default_currency text not null default 'KRW',
  timezone text not null default 'Asia/Seoul',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table public.items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index items_user_id_idx on public.items(user_id);

create table public.services (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger items_set_updated_at
before update on public.items
for each row execute function private.set_updated_at();

create trigger services_set_updated_at
before update on public.services
for each row execute function private.set_updated_at();

alter table public.profiles enable row level security;
alter table public.items enable row level security;
alter table public.services enable row level security;

revoke all on table public.profiles, public.items, public.services from anon, authenticated;
grant select, insert, update, delete on table public.profiles, public.items to authenticated;
grant select on table public.services to authenticated;

create policy "profiles_select_own"
on public.profiles for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = id);

create policy "profiles_insert_own"
on public.profiles for insert
to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = id);

create policy "profiles_update_own"
on public.profiles for update
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = id)
with check ((select auth.uid()) is not null and (select auth.uid()) = id);

create policy "profiles_delete_own"
on public.profiles for delete
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = id);

create policy "items_select_own"
on public.items for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "items_insert_own"
on public.items for insert
to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "items_update_own"
on public.items for update
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "items_delete_own"
on public.items for delete
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "services_read_authenticated"
on public.services for select
to authenticated
using (true);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'user-images',
  'user-images',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "user_images_select_own"
on storage.objects for select
to authenticated
using (
  bucket_id = 'user-images'
  and owner_id = (select auth.uid()::text)
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "user_images_insert_own"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'user-images'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "user_images_update_own"
on storage.objects for update
to authenticated
using (
  bucket_id = 'user-images'
  and owner_id = (select auth.uid()::text)
  and (storage.foldername(name))[1] = (select auth.uid()::text)
)
with check (
  bucket_id = 'user-images'
  and owner_id = (select auth.uid()::text)
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);

create policy "user_images_delete_own"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'user-images'
  and owner_id = (select auth.uid()::text)
  and (storage.foldername(name))[1] = (select auth.uid()::text)
);
