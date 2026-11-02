alter table public.profiles
  add column if not exists notification_days_before smallint[] not null default array[3, 0]::smallint[],
  add column if not exists notification_time time not null default '09:00',
  add column if not exists in_app_notifications_enabled boolean not null default true,
  add column if not exists push_notifications_enabled boolean not null default false;

alter table public.profiles
  add constraint profiles_country_code_format
    check (country_code ~ '^[A-Z]{2}$'),
  add constraint profiles_currency_format
    check (default_currency ~ '^[A-Z]{3}$'),
  add constraint profiles_notification_days_range
    check (
      cardinality(notification_days_before) between 1 and 4
      and notification_days_before <@ array[0, 1, 3, 7, 14, 30]::smallint[]
    );

create or replace function private.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists create_profile_after_signup on auth.users;
create trigger create_profile_after_signup
after insert on auth.users
for each row execute function private.create_profile_for_new_user();

insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  status text not null default 'processing'
    check (status in ('processing', 'retry_pending', 'completed')),
  attempts integer not null default 1 check (attempts > 0),
  last_error_code text,
  requested_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);

create index account_deletion_requests_retry_idx
on public.account_deletion_requests (status, updated_at)
where status = 'retry_pending';

create trigger account_deletion_requests_set_updated_at
before update on public.account_deletion_requests
for each row execute function private.set_updated_at();

alter table public.account_deletion_requests enable row level security;
revoke all on table public.account_deletion_requests from anon, authenticated;

comment on table public.account_deletion_requests is
  'Server-only deletion workflow log. Future phases attach image, notification, and interest cleanup steps here.';

create or replace function public.get_my_storage_usage()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(coalesce((metadata ->> 'size')::bigint, 0)), 0)::bigint
  from storage.objects
  where bucket_id = 'user-images'
    and owner_id = auth.uid()::text;
$$;

revoke all on function public.get_my_storage_usage() from public, anon;
grant execute on function public.get_my_storage_usage() to authenticated;
