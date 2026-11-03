alter table public.content_collection_runs
  add column if not exists estimated_cost_usd numeric(10, 4) not null default 0
  check (estimated_cost_usd >= 0);

create table if not exists public.operator_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 160),
  body text not null check (length(btrim(body)) between 1 and 5000),
  status text not null default 'draft' check (status in ('draft','published','hidden')),
  published_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists operator_announcements_status_date_idx
  on public.operator_announcements(status, published_at desc);

alter table public.operator_announcements enable row level security;
revoke all on table public.operator_announcements from anon, authenticated;

alter table public.content_review_audit
  drop constraint if exists content_review_audit_entity_type_check;
alter table public.content_review_audit
  add constraint content_review_audit_entity_type_check
  check (entity_type in ('catalog','cancellation_guide','news','collection_run','announcement'));

alter table public.content_review_audit
  alter column operator_id drop not null;
alter table public.content_review_audit
  drop constraint if exists content_review_audit_operator_id_fkey;
alter table public.content_review_audit
  add constraint content_review_audit_operator_id_fkey
  foreign key (operator_id) references auth.users(id) on delete set null;

comment on table public.operator_announcements is
  'Operator-authored notices visible to all users only after publication.';
