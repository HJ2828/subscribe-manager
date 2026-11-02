create table public.image_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid references public.items(id) on delete set null,
  management_type text not null default 'recurring_subscription',
  bucket_id text not null default 'user-images',
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text,
  original_keep boolean not null default true,
  redaction_applied boolean not null default false,
  lifecycle_status text not null default 'active',
  analysis_status text not null default 'not_started',
  original_status text not null default 'kept',
  extraction_json jsonb not null default '{}'::jsonb,
  analysis_model text,
  last_error_code text,
  trashed_at timestamptz,
  purge_after timestamptz,
  confirmed_at timestamptz,
  original_deleted_at timestamptz,
  last_activity_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint image_assets_management_type_check check (management_type in (
    'recurring_subscription', 'fixed_term_membership', 'gifticon', 'coupon',
    'voucher', 'points', 'warranty', 'other_deadline'
  )),
  constraint image_assets_mime_check check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint image_assets_lifecycle_check check (lifecycle_status in ('active', 'trash', 'deleted', 'failed')),
  constraint image_assets_analysis_check check (analysis_status in ('not_started', 'processing', 'ready', 'failed')),
  constraint image_assets_original_status_check check (original_status in ('kept', 'pending_delete', 'deleted')),
  constraint image_assets_purge_check check ((lifecycle_status = 'trash' and purge_after is not null) or lifecycle_status <> 'trash')
);

create index image_assets_user_status_idx on public.image_assets(user_id, lifecycle_status, created_at desc);
create index image_assets_purge_idx on public.image_assets(purge_after) where lifecycle_status = 'trash';

create table public.image_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  image_asset_id uuid not null references public.image_assets(id) on delete cascade,
  status text not null,
  model text not null,
  estimated_cost_usd numeric(10, 4) not null default 0,
  error_code text,
  created_at timestamptz not null default timezone('utc', now()),
  constraint image_analysis_runs_status_check check (status in ('processing', 'completed', 'failed', 'refused')),
  constraint image_analysis_runs_cost_check check (estimated_cost_usd >= 0)
);

create index image_analysis_runs_daily_idx on public.image_analysis_runs(user_id, created_at);

create trigger image_assets_set_updated_at
before update on public.image_assets
for each row execute function private.set_updated_at();

alter table public.image_assets enable row level security;
alter table public.image_analysis_runs enable row level security;
revoke all on table public.image_assets, public.image_analysis_runs from anon, authenticated;
grant select, insert, update, delete on table public.image_assets to authenticated;
grant select, insert on table public.image_analysis_runs to authenticated;

create policy "image_assets_select_own" on public.image_assets for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy "image_assets_insert_own" on public.image_assets for insert to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy "image_assets_update_own" on public.image_assets for update to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy "image_assets_delete_own" on public.image_assets for delete to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "image_analysis_runs_select_own" on public.image_analysis_runs for select to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
create policy "image_analysis_runs_insert_own" on public.image_analysis_runs for insert to authenticated
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

comment on table public.image_assets is 'Private user image lifecycle and user-confirmed extraction draft metadata.';
comment on column public.image_assets.extraction_json is 'Structured draft only; never stores emails, phone numbers, addresses, or account IDs.';
comment on column public.image_assets.original_keep is 'User decision for original retention; independent from item usage status.';
