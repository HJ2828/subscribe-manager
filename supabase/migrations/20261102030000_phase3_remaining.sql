alter table public.items
  add column if not exists provider_name text,
  add column if not exists unit_name text,
  add column if not exists start_date_value text,
  add column if not exists start_date_precision text,
  add column if not exists target_date_value text,
  add column if not exists target_date_precision text,
  add column if not exists conditions text,
  add column if not exists lifecycle_status text not null default 'active',
  add column if not exists support_scope text not null default 'none',
  add column if not exists completed_at timestamptz;

update public.items
set
  start_date_value = coalesce(start_date_value, to_char(first_billing_date, 'YYYY-MM-DD')),
  start_date_precision = case when first_billing_date is not null then coalesce(start_date_precision, 'day') else start_date_precision end,
  target_date_value = coalesce(target_date_value, to_char(next_billing_date, 'YYYY-MM-DD')),
  target_date_precision = case when next_billing_date is not null then coalesce(target_date_precision, 'day') else target_date_precision end
where first_billing_date is not null or next_billing_date is not null;

alter table public.items
  add constraint items_start_precision_check
    check (start_date_precision is null or start_date_precision in ('day', 'month')),
  add constraint items_target_precision_check
    check (target_date_precision is null or target_date_precision in ('day', 'month')),
  add constraint items_start_value_precision_check
    check (
      start_date_value is null
      or (start_date_precision = 'month' and start_date_value ~ '^\d{4}-(0[1-9]|1[0-2])$')
      or (start_date_precision = 'day' and start_date_value ~ '^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$')
    ),
  add constraint items_target_value_precision_check
    check (
      target_date_value is null
      or (target_date_precision = 'month' and target_date_value ~ '^\d{4}-(0[1-9]|1[0-2])$')
      or (target_date_precision = 'day' and target_date_value ~ '^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$')
    ),
  add constraint items_lifecycle_status_check
    check (lifecycle_status in ('active', 'unused', 'used', 'ended', 'expired', 'needs_review')),
  add constraint items_support_scope_check
    check (support_scope in ('none', 'news', 'cancellation', 'both'));

alter table public.items drop constraint if exists items_reminder_days_range;
alter table public.items
  add constraint items_reminder_days_range
    check (cardinality(reminder_days_before) between 0 and 4 and reminder_days_before <@ array[0, 1, 3, 7, 14, 30]::smallint[]);

create index if not exists items_user_target_date_idx
  on public.items(user_id, target_date_value);

create table public.item_deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid,
  item_name text not null,
  management_type text not null,
  internal_status text not null default 'pending',
  image_cleanup_status text not null default 'not_applicable',
  calendar_cleanup_status text not null default 'not_applicable',
  relationship_cleanup_status text not null default 'not_applicable',
  retry_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint item_deletion_jobs_internal_status_check
    check (internal_status in ('pending', 'deleted', 'failed', 'blocked')),
  constraint item_deletion_jobs_cleanup_status_check
    check (
      image_cleanup_status in ('not_applicable', 'pending', 'completed', 'failed')
      and calendar_cleanup_status in ('not_applicable', 'pending', 'completed', 'failed')
      and relationship_cleanup_status in ('not_applicable', 'pending', 'completed', 'failed', 'blocked')
    )
);

create trigger item_deletion_jobs_set_updated_at
before update on public.item_deletion_jobs
for each row execute function private.set_updated_at();

alter table public.item_deletion_jobs enable row level security;
revoke all on table public.item_deletion_jobs from anon, authenticated;
grant select, insert, update on table public.item_deletion_jobs to authenticated;

create policy "item_deletion_jobs_select_own"
on public.item_deletion_jobs for select
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "item_deletion_jobs_insert_own"
on public.item_deletion_jobs for insert
to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "item_deletion_jobs_update_own"
on public.item_deletion_jobs for update
to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

comment on table public.item_deletion_jobs is
  'Tracks internal item deletion separately from future image, calendar, and relationship cleanup.';
comment on column public.items.start_date_value is
  'Confirmed start date stored without inventing a day for month-precision values.';
comment on column public.items.target_date_value is
  'Confirmed billing, renewal, expiry, or warranty date with explicit precision.';
